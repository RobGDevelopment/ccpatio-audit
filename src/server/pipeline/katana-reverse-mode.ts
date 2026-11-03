/**
 * Katana reverse-flow GHL stage push gate (§I.1, D-5).
 *
 * log  — Katana SO/MO snapshots still sync into the hub (`order_intake` / `custom_build_jobs`),
 *        but zero GoHighLevel GET/PUT requests are issued.
 * live — GHL opportunity stage validation and monotonic stage PUTs are enabled.
 *
 * Fail closed: unset, empty, or unrecognized values resolve to "log".
 * Do NOT import `src/env.ts` here, and never read `process.env` at module scope.
 */

export type KatanaReverseSyncMode = "log" | "live";

/** Event emitted by `sync-katana-order-status` and consumed by `push-ghl-factory-stage`. */
export const GHL_FACTORY_STAGE_PUSH_EVENT = "ghl/factory_stage.push_requested" as const;

export function getKatanaReverseSyncMode(
  env: Record<string, string | undefined> = process.env,
): KatanaReverseSyncMode {
  const raw = env.KATANA_REVERSE_SYNC_MODE?.trim().toLowerCase();
  return raw === "live" ? "live" : "log";
}

export function canPushGhlFactoryStage(
  modeOrEnv: KatanaReverseSyncMode | Record<string, string | undefined> = process.env,
): boolean {
  const mode =
    typeof modeOrEnv === "string"
      ? modeOrEnv
      : getKatanaReverseSyncMode(modeOrEnv);
  return mode === "live";
}

