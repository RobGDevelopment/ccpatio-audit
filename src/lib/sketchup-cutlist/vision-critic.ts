/**
 * Vision / heuristic critic — flags only, never writes the database.
 * Optional image paths are recorded for a human/LLM review step; this module
 * itself does deterministic envelope checks so CI can run without an API key.
 */
import type { InstantiatedPlan, WalkerExport } from "./types";
import { shortPointFromLong } from "./long-point";

export type CriticFinding = {
  severity: "info" | "warn" | "error";
  code: string;
  message: string;
};

export type CriticReport = {
  finSku: string;
  findings: CriticFinding[];
  imagePaths: string[];
  /** True when findings are safe for draft write (no errors). */
  okForDraft: boolean;
};

export function critiqueCutlistPlan(input: {
  plan: InstantiatedPlan;
  walker?: WalkerExport;
  /** Orthogonal PNG/JPEG paths for optional multimodal review — not ingested here. */
  imagePaths?: string[];
}): CriticReport {
  const findings: CriticFinding[] = [];
  const plan = input.plan;
  const overall = input.walker?.overall.lengthIn ?? 34;

  for (const flag of plan.flags) {
    findings.push({
      severity: flag.startsWith("convention_") ? "warn" : "info",
      code: "plan_flag",
      message: flag,
    });
  }

  const metalParents = new Set(
    plan.lines
      .filter((l) => l.childSku.startsWith("RM-MET-"))
      .map((l) => l.parentSku),
  );
  if (!metalParents.has(plan.seatSku)) {
    findings.push({
      severity: "error",
      code: "missing_seat_metal",
      message: `No metal RM lines under ${plan.seatSku}`,
    });
  }
  if (plan.armSku && !metalParents.has(plan.armSku)) {
    findings.push({
      severity: "error",
      code: "missing_arm_metal",
      message: `No metal RM lines under ${plan.armSku}`,
    });
  }
  if (plan.backSku && !metalParents.has(plan.backSku)) {
    findings.push({
      severity: "error",
      code: "missing_back_metal",
      message: `No metal RM lines under ${plan.backSku}`,
    });
  }

  if (plan.armSku) {
    const fgArm = plan.lines.find(
      (l) => l.parentSku === plan.finSku && l.childSku === plan.armSku,
    );
    if (!fgArm || fgArm.quantity !== 2) {
      findings.push({
        severity: "error",
        code: "arm_qty",
        message: "Finished good must consume shared ARM at qty 2",
      });
    }
  }

  // Envelope: seat rails at long-point should equal overall width
  for (const line of plan.lines) {
    for (const cut of line.cutList) {
      if (/SEAT FRAME/i.test(cut.role) && cut.endA === 45 && cut.endB === 45) {
        if (Math.abs(cut.lengthIn - overall) > 0.15) {
          findings.push({
            severity: "warn",
            code: "seat_envelope",
            message: `Seat rail ${cut.lengthIn}" vs overall ${overall}" — verify long-point`,
          });
        }
      }
      if (/BACK TOP/i.test(cut.role) && cut.endA === 45 && cut.endB === 45) {
        const short = shortPointFromLong(
          cut.lengthIn,
          2,
          cut.endA,
          cut.endB,
        );
        // If cut is still 30 while overall is 34, name was short — flag
        if (Math.abs(cut.lengthIn - (overall - 4)) < 0.15) {
          findings.push({
            severity: "warn",
            code: "back_top_short_point",
            message: `Back top ${cut.lengthIn}" matches short-point of ${overall}" chair (short=${short}). Confirm before chop saw.`,
          });
        }
      }
    }
  }

  // Never mint CUT-* as recipe children
  for (const line of plan.lines) {
    if (line.childSku.startsWith("CUT-")) {
      findings.push({
        severity: "error",
        code: "cut_sku_as_child",
        message: `CUT-* must stay in notes, not child_sku (${line.childSku})`,
      });
    }
  }

  if (input.imagePaths?.length) {
    findings.push({
      severity: "info",
      code: "images_attached",
      message: `${input.imagePaths.length} orthogonal image(s) ready for optional multimodal review — not auto-written to DB`,
    });
  }

  const okForDraft = !findings.some((f) => f.severity === "error");
  return {
    finSku: plan.finSku,
    findings,
    imagePaths: input.imagePaths ?? [],
    okForDraft,
  };
}
