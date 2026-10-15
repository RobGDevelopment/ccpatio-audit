"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertCircle,
  FileText,
  ExternalLink,
  Edit3,
  Loader2,
} from "lucide-react";
import { CadUploadDropzone } from "@/app/admin/factory-bom/CadUploadDropzone";
import { assemblyBadge } from "@/app/admin/factory-bom/factory-bom-ui";
import type { IntakeSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import type { IntakeSubject } from "@/server/factory-bom/intake/load-subject";
import {
  getPacketDownloadLinkAction,
  updateFinishesAction,
} from "@/app/embed/factory-bom/actions";
import { FinishSelect } from "../intake/FinishSelect";
import type { FinishChoice } from "@/lib/intake/types";

type GeometryFailure = { name?: string; reason?: string };

function normalizeFinish(f: unknown): FinishChoice | undefined {
  if (!f) return undefined;
  if (typeof f === "string") return { kind: "sku", sku: f };
  if (typeof f === "object" && f !== null) {
    const obj = f as Record<string, unknown>;
    if (obj.kind === "sku" && typeof obj.sku === "string") {
      return { kind: "sku", sku: obj.sku };
    }
    if (obj.kind === "tbd" && typeof obj.note === "string") {
      return { kind: "tbd", note: obj.note };
    }
    if (obj.tbd === true) {
      return { kind: "tbd", note: typeof obj.note === "string" ? obj.note : "" };
    }
    if (typeof obj.sku === "string") {
      return { kind: "sku", sku: obj.sku };
    }
  }
  return undefined;
}

export function step1AllowsContinue(
  snapshot: IntakeSnapshot,
  originalName: string,
  isClientPiece?: boolean,
  hasPacket?: boolean
): boolean {
  const name = originalName.trim();
  if (!name) return false;
  const cad = snapshot.cadUpload;
  if (!cad || (cad.ext !== "dae" && cad.ext !== "glb")) return false;
  const isHygiene = (cad.error_message ?? "").startsWith("GEOM_HYGIENE");
  if (cad.status !== "draft_ready" && !(cad.status === "failed" && isHygiene)) {
    return false;
  }
  if (isClientPiece && !hasPacket) {
    return false;
  }
  return true;
}

interface Step1CadProps {
  snapshot: IntakeSnapshot;
  subject?: IntakeSubject | null;
  originalName: string;
  itemType: string;
  isPending: boolean;
  reportedUserEmail?: string;
}

export function Step1Cad({
  snapshot,
  subject,
  originalName,
  itemType,
  isPending,
  reportedUserEmail,
}: Step1CadProps) {
  const router = useRouter();
  const [showReplaceCad, setShowReplaceCad] = useState(false);
  const [isEditingFinishes, setIsEditingFinishes] = useState(false);
  const [viewingPacket, setViewingPacket] = useState(false);
  const [packetError, setPacketError] = useState<string | null>(null);

  // Finishes editing state
  const currentFinishes = (subject?.finishes || {}) as Record<string, unknown>;
  const [frame, setFrame] = useState<FinishChoice | undefined>(
    normalizeFinish(currentFinishes.frame)
  );
  const [powder, setPowder] = useState<FinishChoice | undefined>(
    normalizeFinish(currentFinishes.powder)
  );
  const [fabric, setFabric] = useState<FinishChoice | undefined>(
    normalizeFinish(currentFinishes.fabric)
  );
  const [isSavingFinishes, setIsSavingFinishes] = useState(false);
  const [finishesError, setFinishesError] = useState<string | null>(null);

  const cad = snapshot.cadUpload;
  const geomSnap = cad?.geometry_snapshot as {
    failures?: GeometryFailure[];
    rejected?: GeometryFailure[];
  } | null;
  const isGeomHygiene = Boolean(cad?.error_message?.startsWith("GEOM_HYGIENE"));
  const rejected = Array.isArray(geomSnap?.failures)
    ? geomSnap.failures
    : Array.isArray(geomSnap?.rejected)
    ? geomSnap.rejected
    : [];
  const rejectedNames = rejected.map((r) => r.name).filter(Boolean).join(", ");

  const isClientPiece = Boolean(subject?.customBuild || snapshot.rootSku.startsWith("JOB-"));
  const packetOnFile = Boolean(subject?.packet);

  const hasTbdFinish =
    frame?.kind === "tbd" || powder?.kind === "tbd" || fabric?.kind === "tbd";

  const handleViewPacket = async () => {
    setPacketError(null);
    setViewingPacket(true);
    try {
      const res = await getPacketDownloadLinkAction({
        sku: snapshot.rootSku,
        reportedUserEmail,
      });
      if (res.ok) {
        window.open(res.data.downloadUrl, "_blank", "noopener,noreferrer");
      } else {
        setPacketError(res.message);
      }
    } catch {
      setPacketError("Could not retrieve the factory order.");
    } finally {
      setViewingPacket(false);
    }
  };

  const handleSaveFinishes = async () => {
    if (!frame || !powder || !fabric) {
      setFinishesError("All three finishes are required.");
      return;
    }
    setIsSavingFinishes(true);
    setFinishesError(null);
    try {
      const res = await updateFinishesAction({
        sku: snapshot.rootSku,
        finishes: {
          frame,
          powder,
          fabric,
        },
        reportedUserEmail,
      });
      if (res.ok) {
        setIsEditingFinishes(false);
        router.refresh();
      } else {
        setFinishesError(res.message);
      }
    } catch {
      setFinishesError("Could not update finishes. Please try again.");
    } finally {
      setIsSavingFinishes(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {originalName || "Custom piece"}
          </h2>
          <div className="flex items-center space-x-2 text-xs text-stone-500 font-mono mt-0.5">
            <span>Item code: {snapshot.rootSku}</span>
            <span>•</span>
            <span className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">
              {assemblyBadge(snapshot.rootSku, itemType)}
            </span>
          </div>
        </div>
      </div>

      {/* Model Status Card */}
      <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/60 dark:bg-stone-900/60 backdrop-blur-sm p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                cad?.status === "draft_ready"
                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                  : isGeomHygiene
                  ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                  : cad?.status === "processing"
                  ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-500"
              }`}
            >
              {cad?.status === "draft_ready" ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : cad?.status === "processing" ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isGeomHygiene ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {cad?.status === "draft_ready"
                  ? "3D model read"
                  : cad?.status === "processing"
                  ? "Reading your 3D model…"
                  : isGeomHygiene
                  ? "3D model read with notes"
                  : "3D model ready for upload"}
              </p>
              <p className="text-xs text-stone-500">
                {cad?.original_filename || "Model attached"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowReplaceCad(!showReplaceCad)}
            className="text-xs font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400 py-1 px-2.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 transition"
          >
            {showReplaceCad ? "Hide" : "Replace 3D model"}
          </button>
        </div>

        {/* Geometry Hygiene Friendly Banner */}
        {isGeomHygiene && (
          <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/30 rounded-xl border border-amber-200/80 dark:border-amber-800/50 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <p className="font-semibold">
              Some parts of the model can&apos;t be measured
              {rejectedNames ? `: ${rejectedNames}` : ""}.
            </p>
            <p className="text-stone-600 dark:text-stone-400">
              You can continue and type the cut list by hand on the next step.
            </p>
          </div>
        )}

        {/* Replace CAD Dropzone */}
        {showReplaceCad && (
          <div className="pt-2 border-t border-stone-100 dark:border-stone-800">
            <CadUploadDropzone
              globalSku={snapshot.rootSku}
              isPending={isPending}
              onDraftReady={() => {
                setShowReplaceCad(false);
                router.refresh();
              }}
            />
          </div>
        )}
      </div>

      {/* Factory Order (PDF) Status Card */}
      <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/60 dark:bg-stone-900/60 backdrop-blur-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                packetOnFile
                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                  : isClientPiece
                  ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-500"
              }`}
            >
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {packetOnFile
                  ? "Factory order (PDF) on file ✓"
                  : isClientPiece
                  ? "Factory order (PDF) missing"
                  : "Factory order (PDF) optional"}
              </p>
              <p className="text-xs text-stone-500">
                {packetOnFile
                  ? "Linked to project record"
                  : isClientPiece
                  ? "Required for client projects before continuing"
                  : "Standard catalog pieces do not require a factory order"}
              </p>
            </div>
          </div>

          {packetOnFile && (
            <button
              type="button"
              disabled={viewingPacket}
              onClick={handleViewPacket}
              className="flex items-center space-x-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:text-stone-900 py-1.5 px-3 rounded-lg border border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 transition"
            >
              {viewingPacket ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              <span>View factory order</span>
            </button>
          )}
        </div>

        {packetError && (
          <p className="text-xs text-rose-600">{packetError}</p>
        )}
      </div>

      {/* Finishes Card */}
      {isClientPiece && (
        <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/60 dark:bg-stone-900/60 backdrop-blur-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                Selected finishes
              </h3>
              <p className="text-xs text-stone-500">
                Frame, powder coat, and fabric selections
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsEditingFinishes(!isEditingFinishes)}
              className="flex items-center space-x-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 py-1 px-2.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 transition"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isEditingFinishes ? "Cancel" : "Edit finishes"}</span>
            </button>
          </div>

          {!isEditingFinishes ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 bg-stone-50 dark:bg-stone-800/50 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
                <span className="text-[11px] font-medium text-stone-400 block uppercase">
                  Frame
                </span>
                <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 mt-0.5 block truncate">
                  {frame?.kind === "tbd"
                    ? `TBD: ${frame.note || ""}`
                    : frame?.kind === "sku"
                    ? frame.sku
                    : "Not selected"}
                </span>
              </div>
              <div className="p-3 bg-stone-50 dark:bg-stone-800/50 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
                <span className="text-[11px] font-medium text-stone-400 block uppercase">
                  Powder coat
                </span>
                <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 mt-0.5 block truncate">
                  {powder?.kind === "tbd"
                    ? `TBD: ${powder.note || ""}`
                    : powder?.kind === "sku"
                    ? powder.sku
                    : "Not selected"}
                </span>
              </div>
              <div className="p-3 bg-stone-50 dark:bg-stone-800/50 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
                <span className="text-[11px] font-medium text-stone-400 block uppercase">
                  Fabric
                </span>
                <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 mt-0.5 block truncate">
                  {fabric?.kind === "tbd"
                    ? `TBD: ${fabric.note || ""}`
                    : fabric?.kind === "sku"
                    ? fabric.sku
                    : "Not selected"}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2 border-t border-stone-100 dark:border-stone-800">
              <FinishSelect
                label="Frame"
                kind="frame"
                value={frame}
                onChange={setFrame}
              />
              <FinishSelect
                label="Powder coat"
                kind="powder"
                value={powder}
                onChange={setPowder}
              />
              <FinishSelect
                label="Fabric"
                kind="fabric"
                value={fabric}
                onChange={setFabric}
              />

              {finishesError && (
                <p className="text-xs text-rose-600">{finishesError}</p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditingFinishes(false)}
                  className="py-1.5 px-3 rounded-xl border border-stone-200 dark:border-stone-700 text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingFinishes || !frame || !powder || !fabric}
                  onClick={handleSaveFinishes}
                  className="py-1.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-xs font-semibold text-white shadow-sm transition"
                >
                  {isSavingFinishes ? "Saving…" : "Save finishes"}
                </button>
              </div>
            </div>
          )}

          {hasTbdFinish && (
            <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 rounded-xl border border-amber-200/80 dark:border-amber-800/50 text-xs text-amber-900 dark:text-amber-200">
              Finishes pending — this piece can&apos;t be marked complete until they&apos;re chosen.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
