"use client";

import { useCallback, useRef } from "react";
import {
  clampCropBox,
  cropBoxToCssPercent,
  maxSideFromAnchor,
  MIN_CROP_SIDE_PX,
  type CropBox,
} from "@/lib/intake-crop-math";

type DragState =
  | {
      mode: "move";
      startClientX: number;
      startClientY: number;
      origin: CropBox;
    }
  | {
      mode: "resize";
      startClientX: number;
      startClientY: number;
      origin: CropBox;
    };

export type IntakeCropOverlayProps = {
  imageUrl: string;
  alt: string;
  /** Effective source pixel size (DB value, or the image's natural size once loaded). */
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** Current square in SOURCE pixels. */
  crop: CropBox | null;
  onChange: (next: CropBox) => void;
  /** Reports the loaded image's natural size so callers can fall back when the DB has none. */
  onNaturalSize?: (width: number, height: number) => void;
  disabled?: boolean;
};

/**
 * Uncropped photo + absolutely-positioned 1:1 crop square.
 * Box position/size are percentages computed with `cropBoxToCssPercent`
 * (height% uses sourceHeight so the square stays visually square on 3:2 / 4:3 photos).
 * Drag the box to move it; drag the amber corner handle to resize. Emits SOURCE pixels.
 */
export default function IntakeCropOverlay({
  imageUrl,
  alt,
  sourceWidth,
  sourceHeight,
  crop,
  onChange,
  onNaturalSize,
  disabled = false,
}: IntakeCropOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const ready =
    sourceWidth != null && sourceHeight != null && sourceWidth > 0 && sourceHeight > 0 && crop != null;

  const css = ready
    ? cropBoxToCssPercent({
        cropX: crop.cropX,
        cropY: crop.cropY,
        cropSidePx: crop.cropSidePx,
        sourceWidth,
        sourceHeight,
      })
    : null;

  const begin = useCallback(
    (mode: DragState["mode"], e: React.PointerEvent<HTMLElement>) => {
      if (disabled || !crop) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origin: { ...crop },
      };
    },
    [crop, disabled],
  );

  const move = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!drag || !rect || !sourceWidth || !sourceHeight || rect.width <= 0 || rect.height <= 0) {
        return;
      }
      // screen px → source px, per axis (container keeps the photo's aspect ratio).
      const pxX = sourceWidth / rect.width;
      const pxY = sourceHeight / rect.height;
      const dx = (e.clientX - drag.startClientX) * pxX;
      const dy = (e.clientY - drag.startClientY) * pxY;
      if (drag.mode === "move") {
        onChange(
          clampCropBox(
            {
              cropX: drag.origin.cropX + dx,
              cropY: drag.origin.cropY + dy,
              cropSidePx: drag.origin.cropSidePx,
            },
            sourceWidth,
            sourceHeight,
          ),
        );
        return;
      }
      // resize from the bottom-right handle; stay square — follow the dominant axis.
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const maxSide = maxSideFromAnchor(
        drag.origin.cropX,
        drag.origin.cropY,
        sourceWidth,
        sourceHeight,
      );
      const side = Math.max(
        Math.min(MIN_CROP_SIDE_PX, maxSide),
        Math.min(maxSide, drag.origin.cropSidePx + delta),
      );
      onChange({
        cropX: drag.origin.cropX,
        cropY: drag.origin.cropY,
        cropSidePx: Math.round(side),
      });
    },
    [onChange, sourceHeight, sourceWidth],
  );

  const end = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="intake-crop-overlay"
      data-crop-left={css ? css.left.toFixed(4) : undefined}
      data-crop-top={css ? css.top.toFixed(4) : undefined}
      data-crop-width={css ? css.width.toFixed(4) : undefined}
      data-crop-height={css ? css.height.toFixed(4) : undefined}
      className="relative w-full select-none overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
      style={
        ready ? { aspectRatio: `${sourceWidth} / ${sourceHeight}` } : { minHeight: "10rem" }
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        draggable={false}
        loading="lazy"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            onNaturalSize?.(img.naturalWidth, img.naturalHeight);
          }
        }}
        className={
          ready
            ? "pointer-events-none absolute inset-0 h-full w-full object-fill"
            : "block h-auto w-full"
        }
      />
      {css ? (
        <div
          data-testid="intake-crop-box"
          role="presentation"
          onPointerDown={(e) => begin("move", e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className={`absolute border-2 border-amber-400 ${
            disabled ? "cursor-not-allowed" : "cursor-move"
          }`}
          style={{
            left: `${css.left}%`,
            top: `${css.top}%`,
            width: `${css.width}%`,
            height: `${css.height}%`,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.62)",
            touchAction: "none",
          }}
        >
          {/* rule-of-thirds guides — mirror the 3×3 tile preview */}
          <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-amber-300/30" />
          <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-amber-300/30" />
          <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-amber-300/30" />
          <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-amber-300/30" />
          <span
            data-testid="intake-crop-handle"
            role="presentation"
            onPointerDown={(e) => begin("resize", e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-slate-950 bg-amber-400"
            style={{ touchAction: "none" }}
          />
        </div>
      ) : null}
    </div>
  );
}
