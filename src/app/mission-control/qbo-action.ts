"use server";

import { requireMissionControlAuth } from "@/app/mission-control/actions";
import { logError } from "@/lib/log/structured";
import { readQboConnectionPanel } from "@/server/mission-control/qbo-connection";

/**
 * Read-only QuickBooks connection panel for Mission Control reconnect UX.
 * Never refreshes tokens or calls Intuit.
 */
export async function getQboConnectionAction() {
  await requireMissionControlAuth();

  try {
    return { ok: true as const, data: await readQboConnectionPanel() };
  } catch (error: unknown) {
    const ref = logError("mission-control-qbo-connection", error);
    return {
      ok: false as const,
      error: `Failed to load QuickBooks connection. Reference ${ref}.`,
    };
  }
}
