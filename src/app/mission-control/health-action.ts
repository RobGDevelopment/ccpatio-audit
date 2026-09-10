"use server";

import { runSpokeTokenHealthCheck } from "@/server/mdm/token-health";
import { requireMissionControlAuth } from "@/app/mission-control/actions";

export async function getSystemHealthAction() {
  await requireMissionControlAuth();
  
  try {
    const health = await runSpokeTokenHealthCheck(true); // silent = true
    return { ok: true, data: health.results };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
}
