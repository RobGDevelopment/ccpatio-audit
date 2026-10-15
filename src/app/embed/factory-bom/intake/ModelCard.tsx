"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { Box, AlertTriangle, Eye, CheckCircle2 } from "lucide-react";
import type { GlbSummary } from "@/lib/intake/glb-summary";

const DynamicViewer = dynamic(() => import("./viewer/ModelViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-72 sm:h-80 bg-stone-100 dark:bg-stone-900 rounded-xl animate-pulse flex flex-col items-center justify-center text-xs text-stone-400 border border-stone-200 dark:border-stone-800">
      <Box className="w-8 h-8 mb-2 opacity-40 animate-bounce" />
      <span>Loading 3D canvas…</span>
    </div>
  ),
});

function canUseWebGl(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ModelCardProps {
  file: File;
  summary?: GlbSummary | null;
  onRemove?: () => void;
}

export function ModelCard({ file, summary, onRemove }: ModelCardProps) {
  const [showViewer, setShowViewer] = useState(false);
  const [webGlSupported, setWebGlSupported] = useState(false);

  const ext = useMemo(() => {
    const name = file.name.toLowerCase();
    const lastDot = name.lastIndexOf(".");
    return lastDot !== -1 ? name.slice(lastDot) : "";
  }, [file.name]);

  const isGlb = ext === ".glb";
  const isValidGlb = isGlb && summary?.valid === true;

  // Create blob URL for 3D viewer in useEffect with proper cleanup to prevent memory leaks
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isGlb || !showViewer) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file, isGlb, showViewer]);

  useEffect(() => {
    setWebGlSupported(canUseWebGl());
  }, []);

  const dimensionsFormatted = useMemo(() => {
    if (!summary?.boundsInches) return null;
    const [w, h, d] = summary.boundsInches;
    return `${w.toFixed(1)}" × ${d.toFixed(1)}" × ${h.toFixed(1)}"`;
  }, [summary]);

  return (
    <div className="bg-white/80 dark:bg-stone-900/80 backdrop-blur-md rounded-2xl border border-stone-200/80 dark:border-stone-800/80 p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate max-w-[240px] sm:max-w-md">
              {file.name}
            </h4>
            <p className="text-xs text-stone-500">{formatBytes(file.size)}</p>
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 font-medium"
          >
            Change
          </button>
        )}
      </div>

      {/* Metadata Badges / Info */}
      <div className="flex flex-wrap gap-2 text-xs">
        {summary?.valid === true && !summary?.reason && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 font-medium border border-emerald-200/50 dark:border-emerald-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            3D model readable
          </span>
        )}
        {summary && summary.meshCount !== undefined && summary.meshCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-medium border border-stone-200 dark:border-stone-700">
            {summary.meshCount} {summary.meshCount === 1 ? "part" : "parts"}
          </span>
        )}
        {summary && dimensionsFormatted && (
          <span className="px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-mono border border-stone-200 dark:border-stone-700">
            {dimensionsFormatted}
          </span>
        )}
      </div>

      {/* Units Warning */}
      {summary?.unitsLookOdd && (
        <div className="flex items-center space-x-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/50">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            These dimensions look unusually large or small. Check your 3D unit export settings before building.
          </span>
        </div>
      )}

      {/* 3D Toggle (OD2: ONLY for .glb) */}
      {isGlb && isValidGlb && webGlSupported && (
        <div className="pt-2 border-t border-stone-100 dark:border-stone-800/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Eye className="w-4 h-4 text-stone-400" />
            <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
              3D preview
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showViewer}
            onClick={() => setShowViewer(!showViewer)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
              showViewer ? "bg-amber-500" : "bg-stone-200 dark:bg-stone-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                showViewer ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      )}

      {/* Notice for non-GLB files (OD2) */}
      {!isGlb && (
        <p className="text-xs text-stone-400 italic pt-1">
          3D preview is available for .glb files. Other formats are read after upload.
        </p>
      )}

      {/* Interactive 3D Viewer Area */}
      {isGlb && showViewer && blobUrl && (
        <div className="pt-2">
          <DynamicViewer blobUrl={blobUrl} />
        </div>
      )}
    </div>
  );
}
