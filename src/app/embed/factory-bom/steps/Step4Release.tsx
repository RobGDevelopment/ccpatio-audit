"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { IntakeSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import { evaluateAirlock } from "@/server/factory-bom/evaluate-airlock";
import { releaseButton } from "@/app/admin/factory-bom/factory-bom-ui";
import { UNIT_OPTIONS, type AirlockDossier } from "@/server/factory-bom/airlock.schema";
import { submitAirlockAction } from "@/server/factory-bom/airlock-actions";
import { translateBlockingCode, BLOCKING_CODE_MESSAGES } from "@/lib/intake/copy";

type ProductMeta = FactoryProductRow & {
  itemType?: string;
  category?: string;
  katanaVariantId?: number | null;
};

type CutItem = {
  role?: string;
  profile?: string;
  lengthIn?: number;
  endA?: unknown;
  endB?: unknown;
  qtyEa?: unknown;
  lengthConvention?: unknown;
  sourceName?: string;
  confidence?: unknown;
  drawingPartNumber?: unknown;
};

interface Step4ReleaseProps {
  snapshot: IntakeSnapshot;
  products: ProductMeta[];
}

function formatFriendlyError(
  error?: string,
  fallback = "The design could not be marked complete. Please try again."
): string {
  if (!error) return fallback;
  if (error === "design_locked_release_started" || error === "illegal_transition") {
    return "This design cannot be submitted from its current state. Ask an Ops Manager if it is already in review.";
  }
  if (error === "not_authenticated") {
    return "Please reopen this page from GoHighLevel.";
  }
  if (error === "no_custom_build") {
    return "This piece is not on a custom build, so it cannot be sent to the factory manager.";
  }
  if (error === "airlock_schema_pending") {
    return "Factory review tracking is not ready yet. Submit again after that update is applied.";
  }
  if (error === "checklist") {
    return "Confirm every item on the checklist before submitting.";
  }
  if (BLOCKING_CODE_MESSAGES[error]) {
    return BLOCKING_CODE_MESSAGES[error];
  }
  if (error.includes("_") || error.match(/[A-Z]{2,}/)) {
    return fallback;
  }
  return error;
}

export function Step4Release({ snapshot, products }: Step4ReleaseProps) {
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [cutListConfirmed, setCutListConfirmed] = useState(false);
  const [operationsConfirmed, setOperationsConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionBlockingCodes, setActionBlockingCodes] = useState<string[]>([]);
  const router = useRouter();
  const allChecked =
    identityConfirmed && cutListConfirmed && operationsConfirmed && reviewConfirmed;

  const evaluatedBlockingCodes = useMemo(() => {
    const rootMeta = products.find((p) => p.sku === snapshot.rootSku);
    if (!rootMeta) return ["MISSING_ROOT_META"];

    let cadNode = null;
    if (
      snapshot.cadUpload &&
      (snapshot.cadUpload.ext === "dae" || snapshot.cadUpload.ext === "glb")
    ) {
      const snap = snapshot.cadUpload.geometry_snapshot as { hygiene?: string } | null;
      cadNode = {
        uploadId: snapshot.cadUpload.id,
        ext: snapshot.cadUpload.ext as "dae" | "glb",
        status: (snapshot.cadUpload.status === "failed" ? "failed" : "draft_ready") as
          | "draft_ready"
          | "failed",
        sha256: snapshot.cadUpload.sha256 || "",
        hygiene: (snap?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
      };
    }

    const allSkus = new Set<string>();
    allSkus.add(snapshot.rootSku);
    snapshot.lines.forEach((l) => {
      allSkus.add(l.parent_sku);
      allSkus.add(l.child_sku);
    });

    const parents = Array.from(allSkus).filter(
      (s) => s === snapshot.rootSku || snapshot.lines.some((l) => l.parent_sku === s)
    );

    const nodes = parents.map((parentSku) => {
      const pMeta = products.find((p) => p.sku === parentSku);
      const parentLines = snapshot.lines
        .filter((l) => l.parent_sku === parentSku)
        .map((l) => {
          const cMeta = products.find((p) => p.sku === l.child_sku);
          const cat = cMeta?.category || "";
          const cutListArray = Array.isArray(l.cut_list) ? (l.cut_list as CutItem[]) : [];
          const firstCut = cutListArray[0];
          const isMetal = Boolean(
            cat.match(/metal|aluminum|tube|flat bar/i) ||
              (cutListArray.length > 0 && firstCut?.profile !== "UNKNOWN") ||
              ((l.unit_of_measure === "in" || l.unit_of_measure === "ft") &&
                cutListArray.length > 0)
          );

          const isUom = (val: string): val is (typeof UNIT_OPTIONS)[number] =>
            (UNIT_OPTIONS as readonly string[]).includes(val);
          const validUom = isUom(l.unit_of_measure) ? l.unit_of_measure : "ea";

          return {
            parentSku: l.parent_sku,
            childSku: l.child_sku,
            itemType: (cMeta?.itemType === "sub_assembly"
              ? "sub_assembly"
              : "raw_material") as "raw_material" | "sub_assembly",
            quantity: Number(l.quantity),
            scrapFactor: Number(l.scrap_factor),
            unitOfMeasure: validUom,
            status: l.status || "draft",
            source: l.source,
            notes: l.notes,
            cutList: cutListArray.map((c) => ({
              role: c.role || "",
              profile: (c.profile || "SQ2-16") as
                | "SQ2-16"
                | "RT1.5x0.75-16"
                | "FB0.125x1.5"
                | "SQ2x1-16",
              lengthIn: Number(c.lengthIn) || 0,
              endA: (c.endA === 45 ? 45 : 90) as 45 | 90,
              endB: (c.endB === 45 ? 45 : 90) as 45 | 90,
              qtyEa: Number(c.qtyEa) || 1,
              lengthConvention: (c.lengthConvention || "square") as
                | "long_point"
                | "short_point"
                | "square",
              sourceName: c.sourceName || "",
              confidence: (c.confidence || "stated") as
                | "stated"
                | "inferred"
                | "inferred_override",
              drawingPartNumber: typeof c.drawingPartNumber === "string" ? c.drawingPartNumber : null,
            })),
            isMetal,
          };
        });

      const parentOps = snapshot.operations
        .filter((o) => o.item_sku === parentSku)
        .map((o) => ({
          itemSku: o.item_sku,
          workCenter: o.work_center,
          sequence: o.sequence,
          setupTimeMins: o.setup_time_mins ? Number(o.setup_time_mins) : 0,
          runTimeMins: o.run_time_mins ? Number(o.run_time_mins) : 0,
        }));

      return {
        sku: parentSku,
        itemType: (parentSku === snapshot.rootSku
          ? "finished_good"
          : pMeta?.itemType === "finished_good"
          ? "finished_good"
          : "sub_assembly") as "finished_good" | "sub_assembly",
        lines: parentLines,
        operations: parentOps,
      };
    });

    const dossier: AirlockDossier = {
      rootSku: snapshot.rootSku,
      identity: {
        itemType: (rootMeta.itemType === "sub_assembly"
          ? "sub_assembly"
          : "finished_good") as "finished_good" | "sub_assembly",
        originalName: rootMeta.name || "",
        katanaVariantId: rootMeta.katanaVariantId || null,
        cad: cadNode,
        cadWaived: false,
      },
      nodes,
      checklist: {
        identityConfirmed: identityConfirmed as true,
        cutListConfirmed: cutListConfirmed as true,
        operationsConfirmed: operationsConfirmed as true,
        reviewConfirmed: reviewConfirmed as true,
        quarantineConfirmed: reviewConfirmed as true,
      },
    };

    try {
      return evaluateAirlock(dossier);
    } catch {
      return ["Something went wrong during evaluation."];
    }
  }, [
    snapshot,
    products,
    identityConfirmed,
    cutListConfirmed,
    operationsConfirmed,
    reviewConfirmed,
  ]);

  const allBlockingCodes = Array.from(
    new Set([...evaluatedBlockingCodes, ...actionBlockingCodes])
  );
  const canRelease = allChecked && allBlockingCodes.length === 0;

  const handleSubmit = async () => {
    setIsPublishing(true);
    setSubmitError(null);
    setActionBlockingCodes([]);

    try {
      const res = await submitAirlockAction({
        rootSku: snapshot.rootSku,
        identityConfirmed,
        cutListConfirmed,
        operationsConfirmed,
        reviewConfirmed,
      });
      if (res.ok) {
        setPendingReview(true);
        router.refresh();
        return;
      }
      if (res.blockingCodes && res.blockingCodes.length > 0) {
        setActionBlockingCodes(res.blockingCodes);
        return;
      }
      if (res.error === "illegal_transition" && res.status === "pending_manager") {
        setPendingReview(true);
        return;
      }
      setSubmitError(formatFriendlyError(res.error, "The design could not be submitted for review."));
    } catch {
      setSubmitError("The design could not be submitted for review. Please retry.");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Commerce Readiness Card */}
      <div className="flex flex-col gap-2 rounded-2xl border border-sky-200/80 bg-sky-50/50 dark:bg-sky-950/20 dark:border-sky-800/50 p-5">
        <h3 className="font-semibold text-xs uppercase tracking-wide text-sky-900 dark:text-sky-300">
          Commerce readiness
        </h3>
        <ul className="text-xs text-sky-800 dark:text-sky-200 space-y-1 mt-1">
          <li>
            Production recipe: <strong>{snapshot.commerceReadiness.katanaRecipe}</strong>
          </li>
          <li>
            Website listing: <strong>{snapshot.commerceReadiness.woo}</strong>
          </li>
          <li>
            Product photo: <strong>{snapshot.commerceReadiness.image}</strong>
          </li>
        </ul>
      </div>

      {/* Ready-to-build Checklist Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-stone-900 dark:text-stone-100">
          Ready-to-build checklist
        </h2>
        <p className="text-xs text-stone-500">
          Please confirm all structural parameters before sending to the factory floor.
        </p>
      </div>

      {/* Checklist items */}
      <div className="flex flex-col gap-3 rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/60 dark:bg-stone-900/60 p-5">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-stone-300 accent-amber-500"
            checked={identityConfirmed}
            onChange={(e) => setIdentityConfirmed(e.target.checked)}
          />
          <span className="text-xs sm:text-sm font-medium text-stone-800 dark:text-stone-200">
            This is the right piece and the right 3D model
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-stone-300 accent-amber-500"
            checked={cutListConfirmed}
            onChange={(e) => setCutListConfirmed(e.target.checked)}
          />
          <span className="text-xs sm:text-sm font-medium text-stone-800 dark:text-stone-200">
            The material list looks right
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-stone-300 accent-amber-500"
            checked={operationsConfirmed}
            onChange={(e) => setOperationsConfirmed(e.target.checked)}
          />
          <span className="text-xs sm:text-sm font-medium text-stone-800 dark:text-stone-200">
            The build steps and times look right
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-stone-300 accent-amber-500"
            checked={reviewConfirmed}
            onChange={(e) => setReviewConfirmed(e.target.checked)}
          />
          <span className="text-xs sm:text-sm font-medium text-stone-800 dark:text-stone-200">
            I understand this sends the design to the Factory Manager for review.
          </span>
        </label>
      </div>

      {/* Blocking Issues Banner */}
      {allBlockingCodes.length > 0 && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 rounded-2xl border border-rose-200 dark:border-rose-800/50 space-y-2">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <p className="font-semibold text-xs sm:text-sm">
              Fix these before sending to the factory:
            </p>
          </div>
          <ul className="list-disc pl-6 text-xs space-y-1">
            {allBlockingCodes.map((code) => (
              <li key={code}>{translateBlockingCode(code)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Submit Error Banner */}
      {submitError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 rounded-2xl border border-rose-200 dark:border-rose-800/50 text-xs flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      {pendingReview ? (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Pending Factory Manager Review.</p>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canRelease || isPublishing}
          onClick={handleSubmit}
          className={releaseButton}
        >
          {isPublishing ? (
            <span className="flex items-center justify-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Submitting…</span>
            </span>
          ) : (
            "Submit to Factory"
          )}
        </button>
      )}
    </div>
  );
}
