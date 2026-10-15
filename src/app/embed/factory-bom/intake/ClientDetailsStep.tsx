"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ArrowRight, Minus, Plus, AlertCircle, CheckCircle2 } from "lucide-react";
import { OpportunityCombobox } from "./OpportunityCombobox";
import { FinishSelect } from "./FinishSelect";
import { CollisionPrompt } from "./CollisionPrompt";
import { PacketSlot } from "./PacketSlot";
import type { OpportunityHit } from "@/server/ghl/search-opportunities";
import type { FinishChoice, IntakeClientInput } from "@/lib/intake/types";
import { deriveClientCode, deriveItemCode, buildClientSku } from "@/lib/intake/naming";
import type { ProjectStatus } from "@/server/factory-bom/intake/project-status";

interface ClientDetailsStepProps {
  cadFile: File;
  packetFile: File | null;
  initialOpportunity?: OpportunityHit | null;
  onPacketChange: (file: File | null) => void;
  onBack: () => void;
  onSubmit: (input: IntakeClientInput) => void;
  isSubmitting?: boolean;
}

export function ClientDetailsStep({
  cadFile,
  packetFile,
  initialOpportunity = null,
  onPacketChange,
  onBack,
  onSubmit,
  isSubmitting = false,
}: ClientDetailsStepProps) {
  const [opportunity, setOpportunity] = useState<OpportunityHit | null>(initialOpportunity);
  const [pieceName, setPieceName] = useState(() => {
    // Suggest clean name from CAD filename
    return cadFile.name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
  });
  const [quantity, setQuantity] = useState(1);
  const [frame, setFrame] = useState<FinishChoice | undefined>();
  const [powder, setPowder] = useState<FinishChoice | undefined>();
  const [fabric, setFabric] = useState<FinishChoice | undefined>();

  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    pieceName: string;
    suggestedVariantSku?: string;
  } | null>(null);
  const [duplicateDecision, setDuplicateDecision] = useState<"replace_model" | "add_another" | undefined>();

  // Check project status and duplicate piece when project or pieceName changes
  useEffect(() => {
    if (!opportunity?.id || pieceName.trim().length < 3) return;

    const ac = new AbortController();
    async function check() {
      setFetchError(null);
      try {
        const url = `/embed/factory-bom/api/sku-check?mode=client&opp=${encodeURIComponent(
          opportunity!.id
        )}&piece=${encodeURIComponent(pieceName.trim())}`;
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) {
          throw new Error(`Failed to check project status (HTTP ${res.status})`);
        }
        const json = await res.json();
        if (!json.ok) {
          throw new Error(json.message || "Failed to check project status");
        }
        setProjectStatus(json.project);
        if (json.duplicate && !duplicateDecision) {
          setDuplicateConflict({
            pieceName: json.duplicate.pieceName,
            suggestedVariantSku: json.suggestedVariantSku,
          });
        } else {
          setDuplicateConflict(null);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        console.error("sku-check client fetch failed:", err);
        setFetchError(err instanceof Error ? err.message : "Failed to check project status");
      }
    }

    check();
    return () => ac.abort();
  }, [opportunity?.id, pieceName, duplicateDecision]);

  const clientSlug = useMemo(() => {
    if (!opportunity) return "CLIENT";
    try {
      return deriveClientCode(opportunity.contactName, opportunity.name);
    } catch {
      return "CLIENT";
    }
  }, [opportunity]);

  const itemCode = useMemo(() => {
    if (!pieceName.trim()) return "PIECE";
    try {
      return deriveItemCode(pieceName);
    } catch {
      return "PIECE";
    }
  }, [pieceName]);

  const previewSku = useMemo(() => {
    return buildClientSku(clientSlug, itemCode);
  }, [clientSlug, itemCode]);

  const hasPacketOnFile = Boolean(projectStatus?.packet);
  const effectivePacket = packetFile || (hasPacketOnFile ? true : null);

  const finishesComplete = Boolean(
    frame &&
      powder &&
      fabric &&
      (frame.kind !== "tbd" || frame.note.trim().length >= 5) &&
      (powder.kind !== "tbd" || powder.note.trim().length >= 5) &&
      (fabric.kind !== "tbd" || fabric.note.trim().length >= 5)
  );

  const isLocked = Boolean(projectStatus?.locked);

  const validationDisabledReason = useMemo(() => {
    if (!opportunity) return "Choose the client project first.";
    if (isLocked) return "This project was already sent to production.";
    if (pieceName.trim().length < 3) return "Piece name must be at least 3 characters.";
    if (!finishesComplete) return "Choose the frame, powder coat and fabric (or pick TBD with a note).";
    if (!effectivePacket) return "Add the factory order PDF for this client piece.";
    if (duplicateConflict && !duplicateDecision) return "Resolve the duplicate piece name conflict.";
    return null;
  }, [opportunity, isLocked, pieceName, finishesComplete, effectivePacket, duplicateConflict, duplicateDecision]);

  const canSubmit = !validationDisabledReason && !isSubmitting;

  const handleSubmit = () => {
    if (!opportunity || !frame || !powder || !fabric || !canSubmit) return;

    onSubmit({
      mode: "client_project",
      intakeKey: crypto.randomUUID(),
      opportunityId: opportunity.id,
      pieceName: pieceName.trim(),
      quantity,
      finishes: {
        frame,
        powder,
        fabric,
      },
      files: {
        cad: {
          filename: cadFile.name,
          byteSize: cadFile.size,
        },
        packet: packetFile
          ? {
              filename: packetFile.name,
              byteSize: packetFile.size,
            }
          : undefined,
      },
      duplicateDecision,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Client project details
        </h2>
        <p className="text-xs text-stone-500">
          Link to a GoHighLevel project, assign finishes, and confirm pieces.
        </p>
      </div>

      {/* Project Combobox */}
      <OpportunityCombobox
        value={opportunity}
        onChange={(opp) => {
          setOpportunity(opp);
          setDuplicateConflict(null);
          setDuplicateDecision(undefined);
        }}
        disabled={isSubmitting}
      />

      {/* Project Locked Warning */}
      {isLocked && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 rounded-2xl border border-rose-200 dark:border-rose-800/60 flex items-start space-x-3 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
          <div className="space-y-1">
            <p className="font-semibold">Project already sent to production</p>
            <p>
              This client project was already released. New or modified pieces must be handled through a change order with an Ops Manager.
            </p>
          </div>
        </div>
      )}

      {/* Sku-check fetch error banner */}
      {fetchError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 rounded-2xl border border-rose-200 dark:border-rose-800/60 flex items-start space-x-3 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
          <p>{fetchError}</p>
        </div>
      )}

      {/* Piece Name & Quantity Stepper */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="sm:col-span-3 space-y-1.5">
          <label
            htmlFor="f_piece_name"
            className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
          >
            Piece name
          </label>
          <input
            id="f_piece_name"
            name="f_piece_name"
            type="text"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            disabled={isSubmitting || isLocked}
            value={pieceName}
            onChange={(e) => {
              setPieceName(e.target.value);
              setDuplicateDecision(undefined);
            }}
            placeholder="e.g. Dining Chair, Sectional Wedge"
            className="w-full h-11 px-3.5 text-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
            Quantity
          </label>
          <div className="h-11 px-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 flex items-center justify-between">
            <button
              type="button"
              disabled={quantity <= 1 || isSubmitting || isLocked}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 transition"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="font-semibold text-sm text-stone-900 dark:text-stone-100">
              {quantity}
            </span>
            <button
              type="button"
              disabled={quantity >= 99 || isSubmitting || isLocked}
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 transition"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Duplicate piece collision prompt */}
      {duplicateConflict && !duplicateDecision && (
        <CollisionPrompt
          mode="client"
          pieceName={duplicateConflict.pieceName}
          suggestedVariantSku={duplicateConflict.suggestedVariantSku}
          onDecision={(d) => setDuplicateDecision(d)}
        />
      )}

      {/* Finishes Selection (OD3: REQUIRED) */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
            Project Finishes (Required)
          </h3>
          <span className="text-[11px] text-stone-400">All 3 selections required</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FinishSelect
            label="Frame"
            kind="frame"
            value={frame}
            onChange={(c) => setFrame(c)}
            disabled={isSubmitting || isLocked}
          />
          <FinishSelect
            label="Powder Coat"
            kind="powder"
            value={powder}
            onChange={(c) => setPowder(c)}
            disabled={isSubmitting || isLocked}
          />
          <FinishSelect
            label="Fabric"
            kind="fabric"
            value={fabric}
            onChange={(c) => setFabric(c)}
            disabled={isSubmitting || isLocked}
          />
        </div>
      </div>

      {/* Factory Packet Status */}
      <div className="space-y-2 pt-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
          Factory Order PDF (Required)
        </h3>
        {hasPacketOnFile && !packetFile ? (
          <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Using the factory order already on file for this project</span>
            </div>
            <label className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline cursor-pointer">
              Replace
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) onPacketChange(e.target.files[0]);
                }}
              />
            </label>
          </div>
        ) : (
          <PacketSlot
            file={packetFile}
            isRequired={true}
            onSelect={(file) => onPacketChange(file)}
            onRemove={() => onPacketChange(null)}
          />
        )}
      </div>

      {/* Generated Item Code Preview (Mono ticket style) */}
      <div className="p-3 bg-stone-100/70 dark:bg-stone-800/50 rounded-xl flex items-center justify-between text-xs">
        <span className="text-stone-500 font-medium">Generated Item Code</span>
        <span className="font-mono font-semibold text-stone-800 dark:text-stone-200">
          {previewSku}
          {duplicateDecision === "add_another" ? "-V2" : ""}
        </span>
      </div>

      {/* Actions */}
      <div className="pt-2 space-y-2">
        {validationDisabledReason && (
          <p className="text-xs text-center text-stone-400">
            {validationDisabledReason}
          </p>
        )}
        <div className="flex items-center justify-between space-x-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onBack}
            className="h-12 px-5 flex items-center space-x-2 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 text-xs font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="h-12 flex-1 flex items-center justify-center space-x-2 rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold text-sm shadow-sm transition"
          >
            <span>{isSubmitting ? "Creating piece…" : "Create and read 3D model"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
