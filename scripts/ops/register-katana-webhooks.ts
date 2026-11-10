/**
 * One-off: register the single production Katana webhook for the hub.
 *
 * One registration (not one per event) so Katana issues one signing token, which
 * must be set as KATANA_WEBHOOK_SECRET; `/api/webhooks/katana` verifies every
 * delivery against that single secret.
 *
 * Usage:
 *   npx tsx scripts/ops/register-katana-webhooks.ts --dry-run
 *   npx tsx scripts/ops/register-katana-webhooks.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const KATANA_BASE = "https://api.katanamrp.com/v1";
const WEBHOOK_URL = "https://hub.ccpatio.com/api/webhooks/katana";
const DESCRIPTION = "CC Patio hub (production)";

/**
 * Every action dispatched by src/app/api/webhooks/katana/route.ts. The route also
 * handles `stock_adjustment.deleted`, but Katana's webhook API does not offer it
 * (POST /webhooks rejects it with a 422 enum error).
 */
const SUBSCRIBED_EVENTS = [
  "sales_order.updated",
  "sales_order.packed",
  "sales_order.delivered",
  "sales_order.deleted",
  "manufacturing_order.done",
  "variant.updated",
  "purchase_order.received",
  "purchase_order.partially_received",
] as const;

type KatanaWebhook = {
  id: number;
  url: string;
  token?: string;
  enabled?: boolean;
  description?: string | null;
  subscribed_events?: string[];
};

const dryRun = process.argv.includes("--dry-run");

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function katana(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; raw: string; json: unknown }> {
  const res = await fetch(`${KATANA_BASE}${path}`, {
    method,
    headers: headers(apiKey),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  console.log(`\n${method} ${KATANA_BASE}${path} -> HTTP ${res.status}`);
  console.log(raw);
  return { status: res.status, raw, json };
}

function listOf(json: unknown): KatanaWebhook[] {
  if (Array.isArray(json)) return json as KatanaWebhook[];
  const data = (json as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as KatanaWebhook[]) : [];
}

async function main(): Promise<void> {
  const apiKey = process.env.KATANA_API_KEY?.trim();
  if (!apiKey) throw new Error("KATANA_API_KEY is not set in .env.local");

  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Target URL: ${WEBHOOK_URL}`);
  console.log(`Events (${SUBSCRIBED_EVENTS.length}): ${SUBSCRIBED_EVENTS.join(", ")}`);

  const list = await katana(apiKey, "GET", "/webhooks?limit=250");
  if (list.status < 200 || list.status >= 300) {
    throw new Error(`GET /webhooks failed with HTTP ${list.status}`);
  }
  const existing = listOf(list.json).filter((w) => w.url === WEBHOOK_URL);

  if (existing.length > 0) {
    for (const hook of existing) {
      const have = new Set(hook.subscribed_events ?? []);
      const missing = SUBSCRIBED_EVENTS.filter((e) => !have.has(e));
      console.log(
        `\nExisting webhook id=${hook.id} enabled=${hook.enabled} events=${[...have].join(", ")}`,
      );
      if (missing.length > 0) console.log(`  Missing events: ${missing.join(", ")}`);
    }
    throw new Error(
      `A webhook for ${WEBHOOK_URL} already exists (${existing.length}); refusing to create a duplicate.`,
    );
  }

  const payload = {
    url: WEBHOOK_URL,
    subscribed_events: [...SUBSCRIBED_EVENTS],
    description: DESCRIPTION,
  };

  if (dryRun) {
    console.log("\nNo existing webhook for this URL. Would POST /webhooks with:");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const created = await katana(apiKey, "POST", "/webhooks", payload);
  if (created.status < 200 || created.status >= 300) {
    throw new Error(`POST /webhooks failed with HTTP ${created.status}`);
  }
  const hook = created.json as KatanaWebhook | null;
  if (!hook?.token) throw new Error("Katana response did not include a signing token");

  console.log(`\nRegistered webhook id=${hook.id} enabled=${hook.enabled}`);
  console.log(`Subscribed events: ${(hook.subscribed_events ?? []).join(", ")}`);
  console.log(`\nKATANA_WEBHOOK_SECRET=${hook.token}`);
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
