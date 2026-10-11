/** Plain-English inbox copy. Raw provider bodies never leave this module. */

export const UNKNOWN_ISSUE_COPY = "Sync failed. Open the run before retrying.";

export const HTTP_401_COPY = "Access denied. The vendor rejected the key.";

const HTTP_COPY: Record<number, string> = {
  401: HTTP_401_COPY,
  403: "Access denied. The vendor refused this account.",
  409: "This record is already on the spoke. Open the run before retrying.",
  429: "The vendor is rate limiting. Wait, then retry.",
};

const CATALOG_CHANNELS = new Set(["katana", "woocommerce", "clover"]);

export type InboxIssue = {
  id: string;
  kind: "run" | "sync";
  title: string;
  spoke: string;
  sku: string | null;
  at: string;
  summary: string;
  runId: string | null;
};

export type FailedRunCandidate = {
  run_id?: unknown;
  function_id?: unknown;
  started_at?: unknown;
  error?: { message?: unknown } | null;
  event?: { data?: unknown } | null;
};

export type ChannelSyncCandidate = {
  id: string;
  channel: string;
  status: string;
  globalSku: string;
  updatedAt: Date | string;
  lastError?: string | null;
};

function containsSecretOrProviderBody(raw: string): boolean {
  if (/bearer/i.test(raw)) return true;
  if (/authorization\s*:/i.test(raw)) return true;
  if (raw.includes("{") || raw.includes("}")) return true;
  if (/sk_live_|sk_test_|whsec_|rk_live_/i.test(raw)) return true;
  return false;
}

function detectHttpStatus(raw: string): number | null {
  const match = raw.match(/\b(401|403|409|429)\b/);
  if (!match) return null;
  return Number(match[1]);
}

/** Map a known status or function failure. Anything else, including provider JSON, becomes the fixed sentence. */
export function plainEnglishError(raw: string | null | undefined): string {
  if (raw == null) return UNKNOWN_ISSUE_COPY;
  const text = raw.trim();
  if (!text) return UNKNOWN_ISSUE_COPY;
  if (containsSecretOrProviderBody(text)) return UNKNOWN_ISSUE_COPY;
  const status = detectHttpStatus(text);
  if (status != null && HTTP_COPY[status]) return HTTP_COPY[status];
  return UNKNOWN_ISSUE_COPY;
}

function describeFunction(functionId: string): { title: string; spoke: string } {
  const id = functionId.toLowerCase();
  if (id.includes("publish-approved-product")) {
    return { title: "Catalog publish failed", spoke: "Catalog" };
  }
  if (id.includes("push-approved-factory-order")) {
    return { title: "Factory order did not reach Katana", spoke: "Katana" };
  }
  if (id.includes("archive-katana-variant")) {
    return { title: "Katana archive failed", spoke: "Katana" };
  }
  if (id.includes("process-cad-upload")) {
    return { title: "CAD upload failed", spoke: "Factory" };
  }
  if (id.includes("release-custom-job")) {
    return { title: "Custom job release failed", spoke: "Katana" };
  }
  if (id.includes("clover-payment-sync")) {
    return { title: "Clover payment sync failed", spoke: "Clover" };
  }
  if (id.includes("woocommerce")) {
    return { title: "WooCommerce sync failed", spoke: "WooCommerce" };
  }
  return { title: "Sync failed", spoke: "Catalog" };
}

function spokeLabel(channel: string): string {
  if (channel === "katana") return "Katana";
  if (channel === "woocommerce") return "WooCommerce";
  if (channel === "clover") return "Clover";
  return "Catalog";
}

function syncTitle(channel: string): string {
  return `${spokeLabel(channel)} sync failed`;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function skuFromEventData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  return asString(record.globalSku) ?? asString(record.global_sku) ?? asString(record.sku);
}

function asIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Failed publish runs become translated rows. Event data is not copied. */
export function selectFailedRunIssues(runs: readonly FailedRunCandidate[]): InboxIssue[] {
  const issues: InboxIssue[] = [];
  for (const run of runs) {
    const runId = asString(run.run_id);
    if (!runId) continue;
    const functionId = asString(run.function_id) ?? "";
    const described = describeFunction(functionId);
    const message = asString(run.error?.message);
    issues.push({
      id: `run:${runId}`,
      kind: "run",
      title: described.title,
      spoke: described.spoke,
      sku: skuFromEventData(run.event?.data),
      at: asString(run.started_at) ?? "",
      summary: plainEnglishError(message),
      runId,
    });
  }
  return issues;
}

/** Pending, success, and unknown channels are omitted. `lastError` is translated, then dropped. */
export function selectFailedSyncIssues(rows: readonly ChannelSyncCandidate[]): InboxIssue[] {
  const issues: InboxIssue[] = [];
  for (const row of rows) {
    if (row.status !== "failed") continue;
    if (!CATALOG_CHANNELS.has(row.channel)) continue;
    issues.push({
      id: `sync:${row.id}`,
      kind: "sync",
      title: syncTitle(row.channel),
      spoke: spokeLabel(row.channel),
      sku: row.globalSku,
      at: asIso(row.updatedAt),
      summary: plainEnglishError(row.lastError),
      runId: null,
    });
  }
  return issues;
}
