"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Replace, X, ZoomIn, Grid3X3, Maximize } from "lucide-react";

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
}: FullResImageLightboxProps) {
  const [mode, setMode] = useState<ViewMode>("fit");
  const [resBadge, setResBadge] = useState<ResBadge>(null);
  const [imgError, setImgError] = useState(false);
  const panRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

  const imgSrc = fullResUrl || thumbUrl;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
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
  }, [imgSrc, open]);

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

  /* ── 1:1 pan via mouse drag ── */
  function onPanMouseDown(e: React.MouseEvent) {
    if (mode !== "zoom" || !panRef.current) return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: panRef.current.scrollLeft,
      scrollTop: panRef.current.scrollTop,
    };
    panRef.current.style.cursor = "grabbing";
  }
  function onPanMouseMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (!d.dragging || !panRef.current) return;
    panRef.current.scrollLeft = d.scrollLeft - (e.clientX - d.startX);
    panRef.current.scrollTop = d.scrollTop - (e.clientY - d.startY);
  }
  function onPanMouseUp() {
    dragRef.current.dragging = false;
    if (panRef.current) panRef.current.style.cursor = "grab";
  }

  if (!open) return null;

  const META_FIELDS: Array<{ label: string; value: string | null }> = [
    { label: "SKU", value: sku },
    { label: "Name", value: displayName },
    { label: "Category", value: category },
    { label: "APF Group", value: apfGroup },
    { label: "Provenance", value: sourceProvenance },
    { label: "Repeat / Scale", value: repeatScale },
    { label: "SHA-256", value: sha256 ? `${sha256.slice(0, 12)}…` : null },
  ];

  return (
    <div
      data-testid="full-res-lightbox"
      className="fixed inset-0 z-[9999] flex flex-col bg-black/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Full-res lightbox for ${displayName}`}
    >
      {/* ───── Header ───── */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-4 overflow-hidden">
          <h2 className="truncate text-sm font-semibold text-white">{displayName}</h2>
          {resBadge && (
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                resBadge.kind === "verified"
                  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                  : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
              }`}
            >
              {resBadge.kind === "verified"
                ? `✓ Verified Full-Res: ${resBadge.w} × ${resBadge.h} px`
                : `⚠ Low-Res: ${resBadge.w} × ${resBadge.h} px`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View-mode toggle pills */}
          <div className="flex rounded-lg bg-white/5 p-0.5">
            <button
              type="button"
              data-testid="full-res-mode-fit"
              onClick={() => setMode("fit")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === "fit" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Maximize size={12} /> Fit
            </button>
            <button
              type="button"
              data-testid="full-res-mode-zoom"
              onClick={() => setMode("zoom")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === "zoom" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <ZoomIn size={12} /> 1:1
            </button>
            <button
              type="button"
              data-testid="full-res-mode-tile"
              onClick={() => setMode("tile")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === "tile" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Grid3X3 size={12} /> 3×3 Tile
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close lightbox"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* ───── Body: sidebar + canvas ───── */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar metadata */}
        <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/10 px-4 py-3">
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

          <hr className="border-white/10" />

          {/* Actions */}
          {imgSrc && (
            <a
              href={imgSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <ExternalLink size={13} /> Open Full-Res in New Tab
            </a>
          )}

          {onReplace && (
            <>
              <button
                type="button"
                onClick={() => onReplace("thumb")}
                className="flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                <Replace size={13} /> Replace Swatch
              </button>
              <button
                type="button"
                onClick={() => onReplace("texture_2k")}
                className="flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                <Replace size={13} /> Replace 2048px Image
              </button>
            </>
          )}
        </aside>

        {/* ───── Canvas area ───── */}
        <div className="relative flex-1 overflow-hidden">
          {!imgSrc || imgError ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              No image available
            </div>
          ) : mode === "fit" ? (
            /* Fit: object-contain, centered */
            <div className="flex h-full w-full items-center justify-center p-6">
              <img
                src={imgSrc}
                alt={displayName}
                className="max-h-full max-w-full object-contain"
                onLoad={handleImgLoad}
                onError={() => setImgError(true)}
                draggable={false}
              />
            </div>
          ) : mode === "zoom" ? (
            /* 1:1 pixel zoom — natural size, scroll/drag to pan */
            <div
              ref={panRef}
              className="h-full w-full overflow-auto"
              style={{ cursor: "grab" }}
              onMouseDown={onPanMouseDown}
              onMouseMove={onPanMouseMove}
              onMouseUp={onPanMouseUp}
              onMouseLeave={onPanMouseUp}
            >
              <img
                src={imgSrc}
                alt={displayName}
                style={{ transform: "scale(1)", transformOrigin: "0 0" }}
                onLoad={handleImgLoad}
                onError={() => setImgError(true)}
                draggable={false}
              />
            </div>
          ) : (
            /* 3×3 seamless tile preview */
            <div
              className="h-full w-full"
              style={{
                backgroundImage: `url("${imgSrc.replace(/"/g, '\\"')}")`,
                backgroundSize: "33.333% 33.333%",
                backgroundRepeat: "repeat",
              }}
              role="img"
              aria-label={`3×3 seamless tile preview of ${displayName}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
