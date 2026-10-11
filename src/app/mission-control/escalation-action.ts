"use server";

import { requireMissionControlAuth } from "@/app/mission-control/actions";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { MissionControlUnauthorizedError } from "@/server/mission-control/require-role";

const MESSAGE_MAX = 500;

export async function raiseEscalationAction(
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireMissionControlAuth();
  } catch (error: unknown) {
    if (error instanceof MissionControlUnauthorizedError) {
      return { ok: false, error: "Unauthorized." };
    }
    throw error;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "A message is required." };
  }
  if (trimmed.length > MESSAGE_MAX) {
    return { ok: false, error: "Message must be 500 characters or fewer." };
  }

  const result = await sendOhCrapAlert({
    reason: "unknown",
    source: "system",
    externalId: "mission-control",
    message: trimmed,
    resolutionPath: "/mission-control",
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}
