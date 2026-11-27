"use client";

import { useCallback, useRef, useState } from "react";
import {
  clampCropBox,
  cropBoxToCssPercent,
  maxSideFromAnchor,
  MIN_CROP_SIDE_PX,
  type CropBox,
} from "@/lib/intake-crop-math";

export type CropCorner = "nw" | "ne" | "sw" | "se";

const CORNERS: CropCorner[] = ["nw", "ne", "sw", "se"];

// Handles sit INSIDE the box corners: the stage clips overflow (box-shadow dimming), so
// outward-hanging handles would be cut in half when the crop touches the image edge.
const CORNER_CLASS: Record<CropCorner, string> = {
  nw: "left-0 top-0 cursor-nwse-resize",
  ne: "right-0 top-0 cursor-nesw-resize",
  sw: "bottom-0 left-0 cursor-nesw-resize",
  se: "bottom-0 right-0 cursor-nwse-resize",
};

type DragState =
  | {
      mode: "move";
      startClientX: number;
      startClientY: number;
      origin: CropBox;
    }
  | {
      mode: "resize";
      corner: CropCorner;
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
  /** Exposes the live <img> element (null on unmount) so callers can draw it to a canvas. */
  onImgRef?: (img: HTMLImageElement | null) => void;
  /**
   * Fires after every successful load. `corsFallback` is true when the CORS-enabled request
   * failed and the image was re-requested without `crossOrigin` (canvas reads will be tainted).
   */
  onImageLoad?: (img: HTMLImageElement, info: { corsFallback: boolean }) => void;
  disabled?: boolean;
};

/**
 * Zero-letterbox crop stage.
 *
 * The wrapper is `inline-block leading-none` and shrink-wraps the <img> (`w-auto h-auto`,
 * capped by max-h / max-w), so the wrapper box === the rendered image box. Percentages on the
 * crop box therefore map 1:1 to SOURCE pixels:
 *   left = cropX/W, top = cropY/H, width = side/W, height = side/H.
 * Drag the box to move; drag any corner (nw/ne/sw/se) to resize — always an exact 1:1 square.
 */
export default function IntakeCropOverlay({
  imageUrl,
  alt,
  sourceWidth,
  sourceHeight,
  crop,
  onChange,
  onNaturalSize,
  onImgRef,
  onImageLoad,
  disabled = false,
}: IntakeCropOverlayProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // URL for which the CORS-enabled request failed → retry without crossOrigin.
  const [corsFailedUrl, setCorsFailedUrl] = useState<string | null>(null);
  const corsFallback = corsFailedUrl === imageUrl;

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

  const setImgRef = useCallback(
    (el: HTMLImageElement | null) => {
      imgRef.current = el;
      onImgRef?.(el);
    },
    [onImgRef],
  );

  const begin = useCallback(
    (mode: "move" | CropCorner, e: React.PointerEvent<HTMLElement>) => {
      if (disabled || !crop) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current =
        mode === "move"
          ? {
              mode: "move",
              startClientX: e.clientX,
              startClientY: e.clientY,
              origin: { ...crop },
            }
          : {
              mode: "resize",
              corner: mode,
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
      const rect = (imgRef.current ?? stageRef.current)?.getBoundingClientRect();
      if (!drag || !rect || !sourceWidth || !sourceHeight || rect.width <= 0 || rect.height <= 0) {
        return;
      }
      // screen px → source px, per axis. Stage box === image box, so there is no letterbox term.
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

      // Corner resize: the OPPOSITE corner stays fixed; side follows the dominant axis.
      const east = drag.corner === "ne" || drag.corner === "se";
      const south = drag.corner === "sw" || drag.corner === "se";
      const sx = east ? 1 : -1;
      const sy = south ? 1 : -1;
      const o = drag.origin;
      const anchorX = east ? o.cropX : o.cropX + o.cropSidePx;
      const anchorY = south ? o.cropY : o.cropY + o.cropSidePx;
      const dAxisX = dx * sx;
      const dAxisY = dy * sy;
      const delta = Math.abs(dAxisX) >= Math.abs(dAxisY) ? dAxisX : dAxisY;
      // Mirror the anchor so "room toward the dragged corner" is always right/bottom room.
      const maxSide = maxSideFromAnchor(
        east ? anchorX : sourceWidth - anchorX,
        south ? anchorY : sourceHeight - anchorY,
        sourceWidth,
        sourceHeight,
      );
      const side = Math.round(
        Math.max(Math.min(MIN_CROP_SIDE_PX, maxSide), Math.min(maxSide, o.cropSidePx + delta)),
      );
      onChange(
        clampCropBox(
          {
            cropX: east ? anchorX : anchorX - side,
            cropY: south ? anchorY : anchorY - side,
            cropSidePx: side,
          },
          sourceWidth,
          sourceHeight,
        ),
      );
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
      ref={stageRef}
      className="relative inline-block max-w-full select-none overflow-hidden rounded-lg border border-slate-700 bg-slate-950 leading-none"
      data-testid="intake-crop-overlay"
      data-crop-left={css ? css.left.toFixed(4) : undefined}
      data-crop-top={css ? css.top.toFixed(4) : undefined}
      data-crop-width={css ? css.width.toFixed(4) : undefined}
      data-crop-height={css ? css.height.toFixed(4) : undefined}
      data-cors-fallback={corsFallback ? "true" : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`${imageUrl}|${corsFallback ? "plain" : "cors"}`}
        ref={setImgRef}
        src={imageUrl}
        alt={alt}
        crossOrigin={corsFallback ? undefined : "anonymous"}
        draggable={false}
        onError={() => {
          if (!corsFallback) setCorsFailedUrl(imageUrl);
        }}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            onNaturalSize?.(img.naturalWidth, img.naturalHeight);
            onImageLoad?.(img, { corsFallback });
          }
        }}
        className="block h-auto max-h-[38dvh] w-auto max-w-full select-none"
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
          {CORNERS.map((corner) => (
            <span
              key={corner}
              data-testid="intake-crop-handle"
              data-corner={corner}
              role="presentation"
              onPointerDown={(e) => begin(corner, e)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className={`absolute h-4 w-4 rounded-sm border-2 border-slate-950 bg-amber-400 ${CORNER_CLASS[corner]}`}
              style={{ touchAction: "none" }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
