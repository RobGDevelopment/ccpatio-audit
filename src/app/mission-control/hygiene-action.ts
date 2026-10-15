"use server";

import { revalidatePath } from "next/cache";
import { requireMissionControlAuth } from "@/app/mission-control/actions";
import { logError } from "@/lib/log/structured";
import {
  applyHygienePatch,
  scanHygieneRadar,
  type HygienePatchInput,
  type RadarResult,
} from "@/server/mission-control/hygiene";

export async function getHygieneRadarAction(): Promise<
  { ok: true; data: RadarResult } | { ok: false; error: string }
> {
  await requireMissionControlAuth();
  try {
    return { ok: true, data: await scanHygieneRadar() };
  } catch (error: unknown) {
    const ref = logError("hygiene-radar-scan", error);
    return { ok: false, error: `Failed to scan the catalog. Reference ${ref}.` };
  }
}

/**
 * Quick Access patch. Writes the Next.js catalog row only: the accounting ledger is never touched, and the
 * PIM audit trail records who changed which field.
 */
export async function patchHygieneAction(
  input: HygienePatchInput,
): Promise<{ ok: true; changed: boolean; fields: string[] } | { ok: false; error: string }> {
  const session = await requireMissionControlAuth();
  const email = session.email ?? `user:${session.id}`;

  try {
    const outcome = await applyHygienePatch(input, { email, label: `Mission Control (${session.role})` });
    if (outcome.ok && outcome.changed) revalidatePath("/mission-control");
    return outcome;
  } catch (error: unknown) {
    const ref = logError("hygiene-radar-patch", error);
    return { ok: false, error: `The update was not saved. Reference ${ref}.` };
  }
}
