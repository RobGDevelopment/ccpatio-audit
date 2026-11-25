"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Replace,
  X,
  ZoomIn,
  Grid3X3,
  Maximize,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type ViewMode = "fit" | "zoom" | "tile";

export type FullResImageLightboxProps = {
  open: boolean;
  onClose: () => void;
  sku: string;
  displayName: string;
  category: string;
  apfGroup: string;
  sourceProvenance: string;
  repeatScale: string;
  sha256: string | null;
  thumbUrl: string | null;
  fullResUrl: string | null;
  onReplace?: (slot: "thumb" | "texture_2k") => void;
  /** Optional navigation across the active finish list. */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
};

type ResBadge =
  | { kind: "verified"; w: number; h: number }
  | { kind: "warning"; w: number; h: number }
  | null;

export default function FullResImageLightbox({
  open,
  onClose,
  sku,
  displayName,
  category,
  apfGroup,
  sourceProvenance,
  repeatScale,
  sha256,
  thumbUrl,
  fullResUrl,
  onReplace,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: FullResImageLightboxProps) {
  const [mode, setMode] = useState<ViewMode>("fit");
  const [resBadge, setResBadge] = useState<ResBadge>(null);
  const [imgError, setImgError] = useState(false);
  const panRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const imgSrc = fullResUrl || thumbUrl;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    },
    [onClose, onPrev, onNext],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  useEffect(() => {
    setResBadge(null);
    setImgError(false);
    setMode("fit");
  }, [imgSrc, open, sku]);

  useEffect(() => {
    if (mode !== "zoom" || !panRef.current) return;
    const el = panRef.current;
    const center = () => {
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
      el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
    };
    requestAnimationFrame(center);
  }, [mode, imgSrc]);

  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w >= 2048 && h >= 2048) {
      setResBadge({ kind: "verified", w, h });
    } else {
      setResBadge({ kind: "warning", w, h });
    }
  }

  function onPanPointerDown(e: React.PointerEvent) {
    if (mode !== "zoom" || !panRef.current) return;
    panRef.current.setPointerCapture(e.pointerId);
    dragRef.current = {
      dragging: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: panRef.current.scrollLeft,
      scrollTop: panRef.current.scrollTop,
    };
  }
  function onPanPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d.dragging || !panRef.current || e.pointerId !== d.pointerId) return;
    panRef.current.scrollLeft = d.scrollLeft - (e.clientX - d.startX);
    panRef.current.scrollTop = d.scrollTop - (e.clientY - d.startY);
  }
  function onPanPointerUp(e: React.PointerEvent) {
    if (e.pointerId !== dragRef.current.pointerId) return;
    dragRef.current.dragging = false;
  }

  if (!open) return null;

  const META_FIELDS: Array<{ label: string; value: string | null }> = [
    { label: "SKU", value: sku },
    { label: "Category", value: category },
    { label: "APF Group", value: apfGroup },
    { label: "Provenance", value: sourceProvenance },
    { label: "Repeat / Scale", value: repeatScale },
    { label: "SHA-256", value: sha256 ? `${sha256.slice(0, 12)}…` : null },
  ];

  return (
    <div
      data-testid="full-res-lightbox"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Full-res lightbox for ${displayName}`}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-white">{displayName}</h2>
            {resBadge ? (
              <span
                data-testid="lightbox-verified-badge"
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  resBadge.kind === "verified"
                    ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                }`}
              >
                {resBadge.kind === "verified"
                  ? `Verified: ${resBadge.w} × ${resBadge.h} px`
                  : `Low-Res: ${resBadge.w} × ${resBadge.h} px`}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="lightbox-prev"
              disabled={!hasPrev || !onPrev}
              onClick={() => onPrev?.()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800/90 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:text-amber-300 disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              type="button"
              data-testid="lightbox-next"
              disabled={!hasNext || !onNext}
              onClick={() => onNext?.()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800/90 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:text-amber-300 disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>

            <div className="ml-1 flex rounded-lg bg-slate-900 p-0.5 ring-1 ring-slate-700">
              <button
                type="button"
                data-testid="full-res-mode-fit"
                onClick={() => setMode("fit")}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  mode === "fit" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <Maximize size={12} /> Fit
              </button>
              <button
                type="button"
                data-testid="full-res-mode-zoom"
                onClick={() => setMode("zoom")}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  mode === "zoom" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <ZoomIn size={12} /> 1:1
              </button>
              <button
                type="button"
                data-testid="full-res-mode-tile"
                onClick={() => setMode("tile")}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  mode === "tile" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <Grid3X3 size={12} /> 3×3 Tile
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              aria-label="Close lightbox"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 md:flex-row">
          <aside className="flex w-full shrink-0 flex-col gap-3 md:w-52">
            {META_FIELDS.map((f) =>
              f.value ? (
                <div key={f.label}>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {f.label}
                  </dt>
                  <dd className="mt-0.5 break-all text-xs text-slate-300">{f.value}</dd>
                </div>
              ) : null,
            )}

            <hr className="border-slate-700" />

            {imgSrc ? (
              <a
                href={imgSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800/90 px-3 py-2 text-xs font-medium text-slate-100 transition hover:text-amber-300"
              >
                <ExternalLink size={13} /> Open Full-Res in New Tab
              </a>
            ) : null}

            {onReplace ? (
              <button
                type="button"
                data-testid="lightbox-replace"
                onClick={() => onReplace("texture_2k")}
                className="flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800/90 px-3 py-2 text-xs font-medium text-slate-100 transition hover:text-amber-300"
              >
                <Replace size={13} /> ↑ Replace Swatch / 2048px Image
              </button>
            ) : null}
          </aside>

          {/* Exact 1:1 square stage */}
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div
              data-testid="lightbox-stage"
              className="aspect-square h-[min(72dvh,620px)] w-[min(72dvh,620px)] shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
            >
              {!imgSrc || imgError ? (
                <div className="flex h-full items-center justify-center text-slate-500">
                  No image available
                </div>
              ) : mode === "fit" ? (
                <img
                  src={imgSrc}
                  alt={displayName}
                  className="block h-full w-full object-cover"
                  onLoad={handleImgLoad}
                  onError={() => setImgError(true)}
                  draggable={false}
                />
              ) : mode === "zoom" ? (
                <div
                  ref={panRef}
                  data-testid="lightbox-pan"
                  className="h-full w-full cursor-grab overflow-auto active:cursor-grabbing"
                  onPointerDown={onPanPointerDown}
                  onPointerMove={onPanPointerMove}
                  onPointerUp={onPanPointerUp}
                  onPointerCancel={onPanPointerUp}
                >
                  <img
                    src={imgSrc}
                    alt={displayName}
                    width={2048}
                    height={2048}
                    style={{ width: 2048, height: 2048, maxWidth: "none" }}
                    onLoad={handleImgLoad}
                    onError={() => setImgError(true)}
                    draggable={false}
                  />
                </div>
              ) : (
                <div
                  data-testid="lightbox-tile"
                  className="h-full w-full"
                  style={{
                    backgroundImage: `url("${imgSrc.replace(/"/g, '\\"')}")`,
                    backgroundSize: "33.3333% 33.3333%",
                    backgroundRepeat: "repeat",
                  }}
                  role="img"
                  aria-label={`3×3 seamless tile preview of ${displayName}`}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
