/**
 * Daily keep-alive / dead-man's-switch probes for QBO, Katana sync age, and held Woo orders.
 * Exception-only alerting via Resend → OPS_ALERT_EMAILS (graceful no-op when unset).
 */
import { eq } from "drizzle-orm";
import { logStructured } from "@/lib/log/structured";
import { getDb, getMutexDb } from "@/server/db/client";
import { katana_sync_meta, qbo_auth_tokens } from "@/server/db/schema";
import {
  QBO_EXPIRY_SKEW_MS,
  QBO_TOKEN_ENDPOINT,
  createDefaultTokenStore,
  withQboRefreshLock,
  type QboTokenRow,
} from "@/server/integrations/qbo/token-refresh";
import { getQboEnvironment, getQboTokenId } from "@/server/integrations/qbo/client";
import { runSpokeTokenHealthCheck } from "@/server/mdm/token-health";
import { listOpenWooQuarantine } from "@/server/woocommerce/quarantine-store";
import { SHOWROOM_SYNC_META_ID } from "@/server/stock/showroom-snapshot";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";

export const KATANA_SYNC_STALE_MS = 6 * 60 * 60 * 1000;

export type LampState = "healthy" | "degraded" | "critical";

export type KeepaliveCheck = {
  id: "qbo" | "katana_api" | "katana_sync_age" | "held_woo_orders" | "woo_webhook";
  label: string;
  state: LampState;
  detail: string;
  fixSteps: string[];
};

export type KeepaliveReport = {
  checkedAt: string;
  overall: "Healthy" | "Attention Needed";
  checks: KeepaliveCheck[];
  alerted: boolean;
  emailed: boolean;
};

function needsRefresh(row: QboTokenRow, now: number): boolean {
  if (!row.access_token) return true;
  return Boolean(row.expires_at && row.expires_at.getTime() - now < QBO_EXPIRY_SKEW_MS);
}

function resolveOpsAlertEmails(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const raw = env.OPS_ALERT_EMAILS?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Proactively refresh the QBO access token when nearing expiry.
 * Holds the refresh under `getMutexDb()` via `withQboRefreshLock`.
 */
export async function ensureQboTokenFresh(now: number = Date.now()): Promise<KeepaliveCheck> {
  const env = getQboEnvironment();
  const targetId = getQboTokenId(env);
  const store = createDefaultTokenStore();

  // Contract: keepalive must route refresh through the mutex client.
  void getMutexDb;

  try {
    let row = await store.read(targetId);
    if (!row && !targetId) row = await store.read(true);
    if (!row || !row.refresh_token) {
      return {
        id: "qbo",
        label: "QuickBooks Connection",
        state: "critical",
        detail: "No QBO refresh token stored.",
        fixSteps: [
          "Open Mission Control → QuickBooks.",
          "Click Reconnect and complete the Intuit OAuth flow.",
          "Confirm a token row appears in qbo_auth_tokens.",
        ],
      };
    }

    if (needsRefresh(row, now)) {
      await withQboRefreshLock(env, async (tx) => {
        const [current] = await tx
          .select()
          .from(qbo_auth_tokens)
          .where(eq(qbo_auth_tokens.id, row!.id));
        if (!current?.refresh_token || !needsRefresh(current, Date.now())) return;

        const clientId = process.env.QBO_CLIENT_ID ?? "";
        const clientSecret = process.env.QBO_CLIENT_SECRET ?? "";
        if (!clientId || !clientSecret) {
          throw new Error("QBO_CLIENT_ID / QBO_CLIENT_SECRET are not configured.");
        }
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const res = await fetch(QBO_TOKEN_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: current.refresh_token,
          }),
        });
        if (!res.ok) {
          throw new Error(`QBO refresh HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (!body.access_token || !body.refresh_token || !body.expires_in) {
          throw new Error("QBO refresh response missing tokens.");
        }
        await tx
          .update(qbo_auth_tokens)
          .set({
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            expires_at: new Date(Date.now() + body.expires_in * 1000),
          })
          .where(eq(qbo_auth_tokens.id, current.id));
      });
      return {
        id: "qbo",
        label: "QuickBooks Connection",
        state: "healthy",
        detail: "Token refreshed under mutex lock.",
        fixSteps: [],
      };
    }

    return {
      id: "qbo",
      label: "QuickBooks Connection",
      state: "healthy",
      detail: row.expires_at
        ? `Access token valid until ${row.expires_at.toISOString()}.`
        : "Connected (expiry unknown).",
      fixSteps: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "QBO probe failed";
    return {
      id: "qbo",
      label: "QuickBooks Connection",
      state: "critical",
      detail: message,
      fixSteps: [
        "Reconnect QuickBooks OAuth from Mission Control.",
        "Verify QBO_CLIENT_ID / QBO_CLIENT_SECRET in Vercel env.",
        "If Intuit rotated the refresh token, complete OAuth again immediately.",
      ],
    };
  }
}

export async function checkKatanaHealth(): Promise<{
  api: KeepaliveCheck;
  syncAge: KeepaliveCheck;
}> {
  // silent=true: keepalive owns exception-only alerting; do not double-fire Oh-Crap here.
  const spoke = await runSpokeTokenHealthCheck(true);
  const katana = spoke.results.find((s) => s.spoke === "Katana");
  const api: KeepaliveCheck = {
    id: "katana_api",
    label: "Katana API",
    state: katana?.ok ? "healthy" : katana?.authFailed ? "critical" : "degraded",
    detail: katana?.detail ?? "Katana probe unavailable",
    fixSteps: katana?.ok
      ? []
      : [
          "Rotate / restore the Katana API token in Vault.",
          "Confirm https://api.katanamrp.com/v1 answers for this tenant.",
          "Click Run Self-Heal Sync Now in the System Health drawer.",
        ],
  };

  const db = getDb();
  const [meta] = await db
    .select()
    .from(katana_sync_meta)
    .where(eq(katana_sync_meta.id, SHOWROOM_SYNC_META_ID))
    .limit(1);
  const last = meta?.last_synced_at ?? null;
  const ageMs = last ? Date.now() - last.getTime() : Number.POSITIVE_INFINITY;
  const stale = ageMs > KATANA_SYNC_STALE_MS;
  const syncAge: KeepaliveCheck = {
    id: "katana_sync_age",
    label: "Katana Sync Age",
    state: !last ? "critical" : stale ? "degraded" : "healthy",
    detail: !last
      ? "No showroom snapshot sync recorded."
      : stale
        ? `Last sync ${last.toISOString()} (>6h stale).`
        : `Last sync ${last.toISOString()}.`,
    fixSteps: stale || !last
      ? [
          "Open Master Catalog → System Health → Run Self-Heal Sync Now.",
          "Confirm the Inngest function `katana-catalog-reconcile` is registered.",
          "Check Katana API health above if sync keeps failing.",
        ]
      : [],
  };

  return { api, syncAge };
}

export async function checkHeldWooOrders(): Promise<KeepaliveCheck> {
  const rows = await listOpenWooQuarantine();
  const pending = rows.filter((r) => r.status === "pending_review");
  const count = pending.length;
  return {
    id: "held_woo_orders",
    label: "Held Website Orders",
    state: count === 0 ? "healthy" : "degraded",
    detail:
      count === 0
        ? "No quarantined Woo orders awaiting replay."
        : `${count} Woo order(s) held for SKU / finish validation.`,
    fixSteps:
      count === 0
        ? []
        : [
            "Open Master Catalog → System Health → Held Website Orders.",
            "Fix the typoed SKU in the dictionary or listing.",
            "Click Re-Verify SKU & Replay Order for each WOO-* row.",
          ],
  };
}

export async function checkWooWebhookConfigured(
  env: Record<string, string | undefined> = process.env,
): Promise<KeepaliveCheck> {
  const secret = env.WOOCOMMERCE_WEBHOOK_SECRET?.trim() ?? env.WOO_WEBHOOK_SECRET?.trim() ?? "";
  const url = env.WOOCOMMERCE_URL?.trim() ?? "";
  const ok = Boolean(secret && url);
  return {
    id: "woo_webhook",
    label: "WooCommerce Webhook",
    state: ok ? "healthy" : "degraded",
    detail: ok
      ? "Webhook secret + store URL configured."
      : "WooCommerce webhook secret or store URL missing.",
    fixSteps: ok
      ? []
      : [
          "Set WOOCOMMERCE_URL and WOOCOMMERCE_WEBHOOK_SECRET in Vercel.",
          "Confirm the Woo webhook points at /api/webhooks/woocommerce.",
        ],
  };
}

function formatAlertEmail(report: KeepaliveReport): { subject: string; text: string } {
  const bad = report.checks.filter((c) => c.state !== "healthy");
  const lines = [
    "CC Patio System Health — Attention Needed",
    "",
    `Checked at: ${report.checkedAt}`,
    "",
    ...bad.flatMap((c) => [
      `• ${c.label}: ${c.detail}`,
      ...c.fixSteps.map((s) => `    → ${s}`),
      "",
    ]),
    "Open /embed/admin/master-catalog → System Health for 1-click self-heal and held-order replay.",
  ];
  return {
    subject: `[CC Patio Ops] System Health — ${bad.length} check(s) need attention`,
    text: lines.join("\n"),
  };
}

async function sendOpsAlertEmail(report: KeepaliveReport): Promise<boolean> {
  const recipients = resolveOpsAlertEmails();
  if (recipients.length === 0) {
    logStructured("info", "ops-keepalive-alert-skipped", {
      reason: "OPS_ALERT_EMAILS unset",
      overall: report.overall,
    });
    return false;
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const { subject, text } = formatAlertEmail(report);
  if (!resendKey) {
    logStructured("warn", "ops-keepalive-alert-logged-only", {
      reason: "RESEND_API_KEY missing",
      recipients,
      subject,
    });
    console.error("[ops-keepalive]", { subject, text, recipients });
    return false;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:
        process.env.OPS_ALERT_FROM_EMAIL?.trim() ||
        process.env.OH_CRAP_FROM_EMAIL?.trim() ||
        "CC Patio Middleware <onboarding@resend.dev>",
      to: recipients,
      subject,
      text,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    logStructured("error", "ops-keepalive-resend-failed", {
      status: response.status,
      detail: detail.slice(0, 500),
    });
    return false;
  }
  return true;
}

/** Aggregate all probes; email only when something degrades. */
export async function runOpsKeepaliveMonitor(): Promise<KeepaliveReport> {
  const qbo = await ensureQboTokenFresh();
  const { api, syncAge } = await checkKatanaHealth();
  const held = await checkHeldWooOrders();
  const woo = await checkWooWebhookConfigured();
  const checks = [qbo, api, syncAge, woo, held];
  const needsAttention = checks.some((c) => c.state !== "healthy");
  const report: KeepaliveReport = {
    checkedAt: new Date().toISOString(),
    overall: needsAttention ? "Attention Needed" : "Healthy",
    checks,
    alerted: false,
    emailed: false,
  };

  if (needsAttention) {
    report.alerted = true;
    report.emailed = await sendOpsAlertEmail(report);
    // Also fan into Oh-Crap when QBO is critical so existing ops paths light up.
    if (qbo.state === "critical") {
      await sendOhCrapAlert({
        reason: "qbo_auth_failed",
        source: "qbo",
        externalId: "ops-keepalive",
        message: qbo.detail,
        resolutionPath: "/embed/admin/master-catalog",
      });
    }
  }

  logStructured("info", "ops-keepalive-complete", {
    overall: report.overall,
    alerted: report.alerted,
    emailed: report.emailed,
  });
  return report;
}

/** Compact snapshot for the GHL System Health drawer (no side effects). */
export async function getSystemHealthSnapshot(): Promise<{
  overall: "Healthy" | "Attention Needed";
  katanaSyncAge: KeepaliveCheck;
  wooWebhook: KeepaliveCheck;
  qbo: KeepaliveCheck;
  heldOrders: KeepaliveCheck;
  heldOrderRows: Array<{
    id: number;
    externalId: string;
    status: string;
    reason: string;
    updatedAt: string;
  }>;
}> {
  const [{ api: _api, syncAge }, held, woo, qbo, open] = await Promise.all([
    checkKatanaHealth(),
    checkHeldWooOrders(),
    checkWooWebhookConfigured(),
    (async (): Promise<KeepaliveCheck> => {
      // Read-only QBO lamp for the drawer — never refreshes tokens on page load.
      try {
        const env = getQboEnvironment();
        const targetId = getQboTokenId(env);
        const store = createDefaultTokenStore();
        let row = await store.read(targetId);
        if (!row && !targetId) row = await store.read(true);
        if (!row?.refresh_token) {
          return {
            id: "qbo",
            label: "QuickBooks Connection",
            state: "critical",
            detail: "Not connected.",
            fixSteps: ["Reconnect QuickBooks OAuth."],
          };
        }
        return {
          id: "qbo",
          label: "QuickBooks Connection",
          state: "healthy",
          detail: row.expires_at
            ? `Token valid until ${row.expires_at.toISOString()}`
            : "Connected.",
          fixSteps: [],
        };
      } catch (error) {
        return {
          id: "qbo",
          label: "QuickBooks Connection",
          state: "degraded",
          detail: error instanceof Error ? error.message : "QBO read failed",
          fixSteps: ["Reconnect QuickBooks OAuth."],
        };
      }
    })(),
    listOpenWooQuarantine(),
  ]);

  void _api;
  const checks = [syncAge, woo, qbo, held];
  const overall = checks.some((c) => c.state !== "healthy")
    ? "Attention Needed"
    : "Healthy";

  return {
    overall,
    katanaSyncAge: syncAge,
    wooWebhook: woo,
    qbo,
    heldOrders: held,
    heldOrderRows: open.map((row) => {
      const firstIssue = row.issues[0];
      return {
        id: row.id,
        externalId: row.externalId.startsWith("WOO-")
          ? row.externalId
          : `WOO-${row.externalId}`,
        status: row.status,
        reason: firstIssue
          ? `${firstIssue.path}: ${firstIssue.message}`
          : row.status === "pending_review"
            ? "SKU or finish validation failed — fix the typo, then replay."
            : "Order edited after payment — compare with Katana, then acknowledge.",
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  };
}
