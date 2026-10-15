"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ArrowRight, AlertTriangle } from "lucide-react";
import { CollisionPrompt } from "./CollisionPrompt";
import { PacketSlot } from "./PacketSlot";
import type { GlbSummary } from "@/lib/intake/glb-summary";
import type { IntakeCatalogInput } from "@/lib/intake/types";
import type { TaxonomyEntry } from "@/server/factory-bom/intake/taxonomy";

interface CatalogDetailsStepProps {
  cadFile: File;
  packetFile: File | null;
  summary: GlbSummary | null;
  collections: TaxonomyEntry[];
  categories: TaxonomyEntry[];
  onPacketChange: (file: File | null) => void;
  onBack: () => void;
  onSubmit: (input: IntakeCatalogInput) => void;
  isSubmitting?: boolean;
}

export function CatalogDetailsStep({
  cadFile,
  packetFile,
  summary,
  collections,
  categories,
  onPacketChange,
  onBack,
  onSubmit,
  isSubmitting = false,
}: CatalogDetailsStepProps) {
  const [productName, setProductName] = useState(() => {
    return cadFile.name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
  });
  const [collectionCode, setCollectionCode] = useState(collections[0]?.code || "");
  const [categoryCode, setCategoryCode] = useState(categories[0]?.code || "");

  // Prefill length and depth from GLB summary bounds if available
  const [lengthInches, setLengthInches] = useState(() => {
    if (summary?.boundsInches) {
      return summary.boundsInches[0].toFixed(1);
    }
    return "";
  });
  const [depthInches, setDepthInches] = useState(() => {
    if (summary?.boundsInches) {
      return summary.boundsInches[1].toFixed(1);
    }
    return "";
  });

  const [collision, setCollision] = useState<{
    sku: string;
    existingProductName?: string;
    suggestedVariantSku?: string;
  } | null>(null);
  const [collisionDecision, setCollisionDecision] = useState<"update_model" | "different" | undefined>();
  const [previewSku, setPreviewSku] = useState<string>("");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const selectedCollection = collections.find((c) => c.code === collectionCode);
  const selectedCategory = categories.find((c) => c.code === categoryCode);

  // Check SKU preview and collision on debounced input change
  useEffect(() => {
    if (!productName.trim() || !collectionCode || !categoryCode || !lengthInches || !depthInches) {
      return;
    }

    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setFetchError(null);
      try {
        const url = `/embed/factory-bom/api/sku-check?mode=catalog&col=${encodeURIComponent(
          collectionCode
        )}&colLabel=${encodeURIComponent(
          selectedCollection?.label || collectionCode
        )}&cat=${encodeURIComponent(categoryCode)}&catLabel=${encodeURIComponent(
          selectedCategory?.label || categoryCode
        )}&name=${encodeURIComponent(productName.trim())}&l=${encodeURIComponent(
          lengthInches
        )}&d=${encodeURIComponent(depthInches)}`;

        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) {
          throw new Error(`Failed to check catalog product (HTTP ${res.status})`);
        }
        const json = await res.json();
        if (!json.ok) {
          throw new Error(json.message || "Failed to check catalog product");
        }
        setPreviewSku(json.sku);
        if (json.collision && !collisionDecision) {
          setCollision({
            sku: json.sku,
            existingProductName: json.existingProductName,
            suggestedVariantSku: json.suggestedVariantSku,
          });
        } else {
          setCollision(null);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        console.error("sku-check catalog fetch failed:", err);
        setFetchError(err instanceof Error ? err.message : "Failed to check catalog product");
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [productName, collectionCode, categoryCode, lengthInches, depthInches, selectedCollection, selectedCategory, collisionDecision]);

  // Dimension mismatch warning (> 10% difference from 3D model)
  const dimensionMismatchWarning = useMemo(() => {
    if (!summary?.boundsInches) return null;
    const [modelL, modelD] = summary.boundsInches;
    const typedL = Number(lengthInches);
    const typedD = Number(depthInches);

    if (typedL > 0 && Math.abs(typedL - modelL) / modelL > 0.1) {
      return `Entered length (${typedL}") differs from 3D model (${modelL.toFixed(1)}") by more than 10%.`;
    }
    if (typedD > 0 && Math.abs(typedD - modelD) / modelD > 0.1) {
      return `Entered depth (${typedD}") differs from 3D model (${modelD.toFixed(1)}") by more than 10%.`;
    }
    return null;
  }, [summary, lengthInches, depthInches]);

  const validationDisabledReason = useMemo(() => {
    if (productName.trim().length < 3) return "Product name must be at least 3 characters.";
    if (!collectionCode) return "Select a collection.";
    if (!categoryCode) return "Select a product type.";
    const l = Number(lengthInches);
    const d = Number(depthInches);
    if (!Number.isFinite(l) || l <= 0 || l > 999) return "Enter a valid length (up to 999 inches).";
    if (!Number.isFinite(d) || d <= 0 || d > 999) return "Enter a valid depth (up to 999 inches).";
    if (collision && !collisionDecision) return "Resolve the catalog collision.";
    return null;
  }, [productName, collectionCode, categoryCode, lengthInches, depthInches, collision, collisionDecision]);

  const canSubmit = !validationDisabledReason && !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit || !selectedCollection || !selectedCategory) return;

    onSubmit({
      mode: "catalog",
      intakeKey: crypto.randomUUID(),
      productName: productName.trim(),
      collectionCode,
      collectionLabel: selectedCollection.label,
      categoryCode,
      categoryLabel: selectedCategory.label,
      length: Number(lengthInches),
      depth: Number(depthInches),
      collisionDecision,
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
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Standard catalog product
        </h2>
        <p className="text-xs text-stone-500">
          Define nomenclature, dimensions, and assign collection for manufacturing.
        </p>
      </div>

      {/* Product Name */}
      <div className="space-y-1.5">
        <label
          htmlFor="f_catalog_name"
          className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
        >
          Product name
        </label>
        <input
          id="f_catalog_name"
          name="f_catalog_name"
          type="text"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          disabled={isSubmitting}
          value={productName}
          onChange={(e) => {
            setProductName(e.target.value);
            setCollisionDecision(undefined);
          }}
          placeholder="e.g. Malibu 3-Seat Sofa"
          className="w-full h-11 px-3.5 text-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
        />
      </div>

      {/* Collection & Product Type (Taxonomy) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label
            htmlFor="f_collection_select"
            className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
          >
            Collection
          </label>
          <select
            id="f_collection_select"
            name="f_collection_select"
            disabled={isSubmitting}
            value={collectionCode}
            onChange={(e) => {
              setCollectionCode(e.target.value);
              setCollisionDecision(undefined);
            }}
            className="w-full h-11 px-3 text-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
          >
            {collections.map((col) => (
              <option key={col.code} value={col.code}>
                {col.label} ({col.code})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="f_category_select"
            className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
          >
            Product type
          </label>
          <select
            id="f_category_select"
            name="f_category_select"
            disabled={isSubmitting}
            value={categoryCode}
            onChange={(e) => {
              setCategoryCode(e.target.value);
              setCollisionDecision(undefined);
            }}
            className="w-full h-11 px-3 text-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
          >
            {categories.map((cat) => (
              <option key={cat.code} value={cat.code}>
                {cat.label} ({cat.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Dimensions (Overall Length and Depth) */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label
            htmlFor="f_length_in"
            className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
          >
            Overall length (in)
          </label>
          <input
            id="f_length_in"
            name="f_length_in"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            disabled={isSubmitting}
            value={lengthInches}
            onChange={(e) => {
              setLengthInches(e.target.value);
              setCollisionDecision(undefined);
            }}
            placeholder="e.g. 96"
            className="w-full h-11 px-3.5 text-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="f_depth_in"
            className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
          >
            Depth (in)
          </label>
          <input
            id="f_depth_in"
            name="f_depth_in"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            disabled={isSubmitting}
            value={depthInches}
            onChange={(e) => {
              setDepthInches(e.target.value);
              setCollisionDecision(undefined);
            }}
            placeholder="e.g. 38"
            className="w-full h-11 px-3.5 text-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
          />
        </div>
      </div>

      {/* Sku-check fetch error banner */}
      {fetchError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 rounded-2xl border border-rose-200 dark:border-rose-800/60 flex items-start space-x-3 text-xs text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
          <p>{fetchError}</p>
        </div>
      )}

      {/* Dimension Mismatch Warning Banner */}
      {dimensionMismatchWarning && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800/60 flex items-center space-x-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>{dimensionMismatchWarning}</span>
        </div>
      )}

      {/* Collision Prompt */}
      {collision && !collisionDecision && (
        <CollisionPrompt
          mode="catalog"
          productName={collision.existingProductName || productName}
          existingSku={collision.sku}
          suggestedVariantSku={collision.suggestedVariantSku}
          onDecision={(d) => setCollisionDecision(d)}
        />
      )}

      {/* Optional PDF / Drawing */}
      <div className="space-y-2 pt-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
          Shop Drawing or Packet (Optional)
        </h3>
        <PacketSlot
          file={packetFile}
          isRequired={false}
          onSelect={(file) => onPacketChange(file)}
          onRemove={() => onPacketChange(null)}
        />
      </div>

      {/* Generated Item Code Preview */}
      {previewSku && (
        <div className="p-3 bg-stone-100/70 dark:bg-stone-800/50 rounded-xl flex items-center justify-between text-xs">
          <span className="text-stone-500 font-medium">Item code preview</span>
          <span className="font-mono font-semibold text-stone-800 dark:text-stone-200">
            {previewSku}
            {collisionDecision === "different" && collision?.suggestedVariantSku
              ? ` → ${collision.suggestedVariantSku}`
              : ""}
          </span>
        </div>
      )}

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
            <span>{isSubmitting ? "Creating product…" : "Create and read 3D model"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
