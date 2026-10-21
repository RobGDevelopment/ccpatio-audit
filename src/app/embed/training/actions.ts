"use server";

import { revalidatePath } from "next/cache";
import { requireMissionControlAuth } from "../actions";

export interface TrainingSignOffInput {
  employeeName: string;
  roleId: string;
  roleLabel: string;
  acknowledgedQboImpact: boolean;
}

export type TrainingSignOffResult =
  | {
      ok: true;
      confirmationId: string;
      employeeName: string;
      roleLabel: string;
      signedAtIso: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function submitTrainingSignOffAction(
  input: TrainingSignOffInput,
): Promise<TrainingSignOffResult> {
  await requireMissionControlAuth();

  const trimmedName = (input.employeeName ?? "").trim();
  if (trimmedName.length < 2) {
    return {
      ok: false,
      error: "Please enter your full Employee Name before signing off.",
    };
  }

  if (!input.acknowledgedQboImpact) {
    return {
      ok: false,
      error: "You must check 'I understand my actions impact QuickBooks Online' to submit.",
    };
  }

  const now = new Date();
  const shortHash = Math.random().toString(36).substring(2, 8).toUpperCase();
  const confirmationId = `SOP-ACK-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${shortHash}`;

  revalidatePath("/mission-control/training");

  return {
    ok: true,
    confirmationId,
    employeeName: trimmedName,
    roleLabel: input.roleLabel,
    signedAtIso: now.toISOString(),
  };
}
