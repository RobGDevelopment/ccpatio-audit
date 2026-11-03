/**
 * Ledger pipeline mutation gates (§I.3).
 *
 * log  — fetch/translate/format run, but NOTHING is posted to QBO (dry run)
 * live — QBO POST is allowed when both master (`QBO_LEDGER_MODE`) and lane allow it
 *
 * Fail closed: unset, empty, or unrecognized values resolve to "log".
 * Read straight from `process.env` (or an injected env map for tests) — do NOT import
 * `src/env.ts` here: its Proxy throws when `POSTGRES_URL` is missing and this runs in hot paths.
 * Never read `process.env` at module scope.
 */

export type LedgerPipelineMode = "log" | "live";
export type LedgerLane = "qbo" | "clover" | "woo";

function parseLiveOrLog(raw: string | undefined): LedgerPipelineMode {
  return raw?.trim().toLowerCase() === "live" ? "live" : "log";
}

/**
 * Deprecated Phase 9/10 wrapper preserved during Phase 15 so untouched Woo modules compile.
 */
export function getLedgerPipelineMode(
  env: Record<string, string | undefined> = process.env,
): LedgerPipelineMode {
  return parseLiveOrLog(env.LEDGER_PIPELINE_MODE);
}

/**
 * Lane-specific ledger mode (§I.3):
 * - `woo`: reads `WOO_LEDGER_MODE` only (no fallback to `LEDGER_PIPELINE_MODE`).
 * - `qbo`: reads `QBO_LEDGER_MODE`; if unset/empty, falls back to `LEDGER_PIPELINE_MODE`; else `log`.
 * - `clover`: reads `CLOVER_LEDGER_MODE`; if unset/empty, falls back to `LEDGER_PIPELINE_MODE`; else `log`.
 */
export function getLedgerMode(
  lane: LedgerLane,
  env: Record<string, string | undefined> = process.env,
): LedgerPipelineMode {
  if (lane === "woo") {
    return parseLiveOrLog(env.WOO_LEDGER_MODE);
  }
  const explicit =
    lane === "qbo" ? env.QBO_LEDGER_MODE?.trim() : env.CLOVER_LEDGER_MODE?.trim();
  if (explicit) {
    return parseLiveOrLog(explicit);
  }
  return parseLiveOrLog(env.LEDGER_PIPELINE_MODE);
}

/**
 * Master AND lane gate: true only when `QBO_LEDGER_MODE` (or fallback) is `live`
 * AND the requested lane is `live`.
 */
export function canPostToQbo(
  lane: "qbo" | "clover",
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getLedgerMode("qbo", env) === "live" && getLedgerMode(lane, env) === "live";
}

/** Deprecated wrapper: true only when legacy ledger (QBO) POSTs are allowed. */
export function canMutateLedger(
  mode: LedgerPipelineMode = getLedgerPipelineMode(),
): boolean {
  return mode === "live";
}
