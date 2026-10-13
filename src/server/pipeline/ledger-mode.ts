/**
 * Ledger pipeline mutation gate (Clover -> QuickBooks).
 *
 * log  — fetch/translate/format run, but NOTHING is posted to QBO (dry run)
 * live — the QBO SalesReceipt POST is allowed
 *
 * Fail closed: unset, empty, or unrecognized values resolve to "log".
 * Read straight from process.env (do NOT import src/env.ts here: its Proxy
 * throws when POSTGRES_URL is missing and this runs in hot paths).
 */

export type LedgerPipelineMode = "log" | "live";

export function getLedgerPipelineMode(): LedgerPipelineMode {
  const raw = process.env.LEDGER_PIPELINE_MODE?.trim().toLowerCase();
  return raw === "live" ? "live" : "log";
}

/** True only when ledger (QBO) POSTs are allowed. */
export function canMutateLedger(
  mode: LedgerPipelineMode = getLedgerPipelineMode(),
): boolean {
  return mode === "live";
}
