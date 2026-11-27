"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crop,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import { EMBED_TOKEN_HEADER } from "@/lib/embed-auth";
import {
  clampCropBox,
  defaultCenteredCrop,
  MIN_CROP_SIDE_PX,
  titleCaseStorefront,
  type CropBox,
} from "@/lib/intake-crop-math";
import type { FinishIntakeView, MaterialClass } from "@/server/ecommerce/finish-intake";
import {
  promoteFinishIntakeAction,
  searchFinishSkuAction,
  updateFinishIntakeAction,
  type FinishSkuSearchResult,
} from "../actions";
import { resolveEmbedUploadToken } from "./SwatchesFinishesDrawer";
import IntakeCropOverlay from "./IntakeCropOverlay";

/* ───────────────────────── constants ───────────────────────── */

type SubFilter = "all_pending" | "photoshoot" | "needs_media" | "recent_certified";
type CategoryFilter = "all" | "fabrics" | "dekton" | "powdercoat";

const CATEGORY_FILTERS: Array<{ key: CategoryFilter; label: string; stem: string }> = [
  { key: "all", label: "All", stem: "" },
  { key: "fabrics", label: "Fabrics", stem: "fabric" },
  { key: "dekton", label: "Dekton", stem: "dekton" },
  { key: "powdercoat", label: "PowderCoat", stem: "powder" },
];

const MATERIAL_OPTIONS: Array<{ value: MaterialClass; label: string }> = [
  { value: "sunbrella", label: "Sunbrella Fabric" },
  { value: "ultraleather", label: "Ultraleather" },
  { value: "dekton", label: "Dekton Stone" },
  { value: "powder", label: "Powder Coat" },
  { value: "addon", label: "Storefront Add-On" },
];

/** Display-name placeholder per Material Class ("Canvas Ivory" is add-on only). */
const DISPLAY_NAME_PLACEHOLDER: Record<MaterialClass, string> = {
  sunbrella: "e.g. Cabana Classic",
  ultraleather: "e.g. Beacon",
  dekton: "e.g. Aura 15",
  powder: "e.g. Gray",
  addon: "e.g. Canvas Ivory",
};

const DEFAULT_REPEAT_IN = "7";

const FIELD =
  "w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none";
const LABEL = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

/** webp/mp4/glb/pdf per the intake policy (+ jpg/png/webm/usdz which the sign route also accepts). */
export const INTAKE_MEDIA_ACCEPT =
  ".webp,.png,.jpg,.jpeg,.mp4,.webm,.glb,.usdz,.pdf,image/webp,image/png,image/jpeg,video/mp4,video/webm,model/gltf-binary,application/pdf";

function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
    active
      ? "border-amber-400 bg-amber-500 text-slate-950"
      : "border-slate-600 bg-slate-800/80 text-slate-300 hover:border-amber-400/50"
  }`;
}

function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

function bustUrl(url: string | null, v: number | undefined): string | null {
  if (!url || !v) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${v}`;
}

function statusDot(status: string): string {
  if (status === "certified") return "bg-emerald-400";
  if (status === "pending") return "bg-amber-400";
  return "bg-sky-400";
}

/* ───────────────────────── client upload helpers ───────────────────────── */

export type IntakeUploadKind = "product_render" | "product_video" | "product_3d" | "product_pdf";

export function intakeKindForFilename(filename: string): IntakeUploadKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["webp", "png", "jpg", "jpeg"].includes(ext)) return "product_render";
  if (["mp4", "webm"].includes(ext)) return "product_video";
  if (["glb", "usdz"].includes(ext)) return "product_3d";
  if (ext === "pdf") return "product_pdf";
  return null;
}

/** Client SHA-256 (Web Crypto) — hex. Throws when Web Crypto is unavailable (insecure context). */
export async function sha256Hex(file: Blob): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto unavailable (HTTPS required) — cannot compute SHA-256");
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type IntakeUploadResult =
  | {
      ok: true;
      kind: IntakeUploadKind;
      publicUrl: string;
      path: string;
      bucket: string;
      byteSize: number | null;
      sha256: string;
    }
  | { ok: false; error: string };

/**
 * SHA-256 (Web Crypto) → intake-upload-sign → PUT to signed Supabase URL → intake-upload-commit.
 * Embed auth mirrors uploadEmbedAsset (token header + credentials: include).
 */
async function uploadIntakeFile(opts: {
  embedToken: string | null;
  file: File;
  wooSku: string;
  onPhase: (phase: "hashing" | "uploading" | "committing") => void;
  onProgress: (pct: number) => void;
}): Promise<IntakeUploadResult> {
  const kind = intakeKindForFilename(opts.file.name);
  if (!kind) {
    return { ok: false, error: "Unsupported file — use .webp / .mp4 / .glb / .pdf" };
  }
  const token = resolveEmbedUploadToken(opts.embedToken);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers[EMBED_TOKEN_HEADER] = token;
  try {
    opts.onPhase("hashing");
    const sha256 = await sha256Hex(opts.file);

    opts.onPhase("uploading");
    const signRes = await fetch("/api/ecommerce/intake-upload-sign", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        kind,
        woo_sku: opts.wooSku,
        filename: opts.file.name,
        contentType: opts.file.type || undefined,
        byteSize: opts.file.size,
      }),
    });
    const sign = await readJson(signRes);
    if (!signRes.ok || sign.ok !== true) {
      return { ok: false, error: String(sign.error ?? `Sign failed (HTTP ${signRes.status})`) };
    }
    await putWithProgress(
      String(sign.signedUrl),
      opts.file,
      String(sign.contentType ?? (opts.file.type || "application/octet-stream")),
      opts.onProgress,
    );

    opts.onPhase("committing");
    const commitRes = await fetch("/api/ecommerce/intake-upload-commit", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        bucket: sign.bucket,
        path: sign.path,
        byteSize: opts.file.size,
        sha256,
      }),
    });
    const commit = await readJson(commitRes);
    if (!commitRes.ok || commit.ok !== true) {
      return {
        ok: false,
        error: String(commit.error ?? `Commit failed (HTTP ${commitRes.status})`),
      };
    }
    return {
      ok: true,
      kind,
      publicUrl: String(commit.publicUrl ?? sign.publicUrl ?? ""),
      path: String(commit.path ?? sign.path ?? ""),
      bucket: String(commit.bucket ?? sign.bucket ?? ""),
      byteSize: typeof commit.byteSize === "number" ? commit.byteSize : opts.file.size,
      sha256,
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Upload failed" };
  }
}

type CropApiResult = { ok: true; view: FinishIntakeView } | { ok: false; error: string };

/** POST /api/ecommerce/intake-crop — server-side sharp 2048 / 512 render of the 1:1 square. */
async function postIntakeCrop(
  embedToken: string | null,
  body: {
    id: string;
    cropX: number;
    cropY: number;
    cropSidePx: number;
    sourceWidth: number;
    sourceHeight: number;
  },
): Promise<CropApiResult> {
  const token = resolveEmbedUploadToken(embedToken);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers[EMBED_TOKEN_HEADER] = token;
  try {
    const res = await fetch("/api/ecommerce/intake-crop", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        id: body.id,
        cropX: body.cropX,
        cropY: body.cropY,
        cropSidePx: body.cropSidePx,
        sourceWidth: body.sourceWidth,
        sourceHeight: body.sourceHeight,
      }),
    });
    const json = await readJson(res);
    if (!res.ok || json.ok !== true || !json.view) {
      return { ok: false, error: String(json.error ?? `Crop failed (HTTP ${res.status})`) };
    }
    return { ok: true, view: json.view as FinishIntakeView };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Crop request failed" };
  }
}

/* ───────────────────────── live canvas previews ───────────────────────── */

type PreviewKind = "swatch" | "loupe" | "tile";
type Rect = { x: number; y: number; s: number };
type Dims = { w: number; h: number };

/** Centered source patch shown by the LOUPE (up to 256×256 source px, 1:1 at 256 canvas px). */
function loupeRect(crop: CropBox, dims: Dims): Rect {
  const s = Math.max(1, Math.floor(Math.min(256, dims.w, dims.h)));
  const x = Math.round(Math.max(0, Math.min(crop.cropX + crop.cropSidePx / 2 - s / 2, dims.w - s)));
  const y = Math.round(Math.max(0, Math.min(crop.cropY + crop.cropSidePx / 2 - s / 2, dims.h - s)));
  return { x, y, s };
}

function paintPreview(
  ctx: CanvasRenderingContext2D,
  kind: PreviewKind,
  img: HTMLImageElement,
  crop: CropBox,
  dims: Dims,
  size: number,
) {
  // Crop coordinates are in DB "source" pixels; scale to the loaded element's natural size.
  const kx = img.naturalWidth / dims.w;
  const ky = img.naturalHeight / dims.h;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = kind !== "loupe";
  ctx.imageSmoothingQuality = "high";
  if (kind === "loupe") {
    const r = loupeRect(crop, dims);
    ctx.drawImage(img, r.x * kx, r.y * ky, r.s * kx, r.s * ky, 0, 0, size, size);
    return;
  }
  const sx = crop.cropX * kx;
  const sy = crop.cropY * ky;
  const sw = crop.cropSidePx * kx;
  const sh = crop.cropSidePx * ky;
  if (kind === "swatch") {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    return;
  }
  const cell = size / 3;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.drawImage(img, sx, sy, sw, sh, col * cell, row * cell, cell, cell);
    }
  }
}

function bgForRect(url: string, dims: Dims, r: Rect): React.CSSProperties {
  return {
    backgroundImage: cssUrl(url),
    backgroundRepeat: "no-repeat",
    backgroundSize: `${(dims.w / r.s) * 100}% ${(dims.h / r.s) * 100}%`,
    backgroundPosition: `${dims.w > r.s ? (r.x / (dims.w - r.s)) * 100 : 0}% ${
      dims.h > r.s ? (r.y / (dims.h - r.s)) * 100 : 0
    }%`,
  };
}

/**
 * One live preview canvas. Redraws via requestAnimationFrame on every crop change straight from
 * the loaded <img>. If the canvas is tainted (CORS fallback) a CSS background-position/size
 * preview is layered over the canvas instead.
 */
function PreviewCanvas({
  kind,
  img,
  crop,
  dims,
  url,
  size,
  testId,
  label,
  onClick,
  className = "",
}: {
  kind: PreviewKind;
  img: HTMLImageElement | null;
  crop: CropBox | null;
  dims: Dims | null;
  url: string | null;
  size: number;
  testId: string;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [tainted, setTainted] = useState(false);
  const cx = crop?.cropX;
  const cy = crop?.cropY;
  const cs = crop?.cropSidePx;
  const dw = dims?.w;
  const dh = dims?.h;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !img || cx == null || cy == null || cs == null || !dw || !dh) return;
    const raf = requestAnimationFrame(() => {
      if (!img.complete || img.naturalWidth === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        paintPreview(ctx, kind, img, { cropX: cx, cropY: cy, cropSidePx: cs }, { w: dw, h: dh }, size);
        ctx.getImageData(0, 0, 1, 1); // throws SecurityError when tainted
        setTainted(false);
      } catch {
        setTainted(true);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [kind, img, cx, cy, cs, dw, dh, size]);

  const fallback = (() => {
    if (!tainted || !url || !crop || !dims) return null;
    if (kind === "swatch") {
      return (
        <div
          className="absolute inset-0"
          style={bgForRect(url, dims, { x: crop.cropX, y: crop.cropY, s: crop.cropSidePx })}
        />
      );
    }
    if (kind === "loupe") {
      return <div className="absolute inset-0" style={bgForRect(url, dims, loupeRect(crop, dims))} />;
    }
    const cellStyle = bgForRect(url, dims, { x: crop.cropX, y: crop.cropY, s: crop.cropSidePx });
    return (
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={cellStyle} />
        ))}
      </div>
    );
  })();

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={onClick ? "Click to enlarge" : undefined}
        data-tainted={tainted ? "true" : undefined}
        className="relative aspect-square w-full overflow-hidden rounded-md border border-slate-700 bg-slate-950 enabled:cursor-zoom-in"
      >
        <canvas
          ref={ref}
          width={size}
          height={size}
          data-testid={testId}
          className="block h-full w-full"
        />
        {fallback}
      </button>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
    </div>
  );
}

/* ───────────────────────── multi-file upload ───────────────────────── */

type UploadedMedia = {
  key: string;
  wooSku: string;
  filename: string;
  kind: IntakeUploadKind;
  publicUrl: string;
  sha256: string;
  byteSize: number | null;
};

type QueueEntry = {
  id: string;
  name: string;
  status: "queued" | "active" | "done" | "error";
  phase: "hashing" | "uploading" | "committing" | null;
  pct: number;
  error?: string;
};

function MultiFileDrop({
  embedToken,
  wooSku,
  testId,
  buttonTestId,
  label,
  disabled,
  onUploaded,
}: {
  embedToken: string | null;
  wooSku: string;
  testId: string;
  buttonTestId: string;
  label: string;
  disabled?: boolean;
  onUploaded: (media: UploadedMedia) => void;
}) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = queue.some((q) => q.status === "queued" || q.status === "active");

  const patch = useCallback((id: string, next: Partial<QueueEntry>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...next } : q)));
  }, []);

  async function handleFiles(files: File[]) {
    if (files.length === 0 || disabled) return;
    const stamp = Date.now();
    const entries: QueueEntry[] = files.map((f, i) => ({
      id: `${stamp}-${i}-${f.name}`,
      name: f.name,
      status: "queued",
      phase: null,
      pct: 0,
    }));
    setQueue((prev) => [...entries, ...prev].slice(0, 30));
    const sku = wooSku.trim() || "intake";
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const id = entries[i].id;
      patch(id, { status: "active", phase: "hashing" });
      const res = await uploadIntakeFile({
        embedToken,
        file,
        wooSku: sku,
        onPhase: (phase) => patch(id, { phase }),
        onProgress: (pct) => patch(id, { pct }),
      });
      if (!res.ok) {
        patch(id, { status: "error", phase: null, error: res.error });
        continue;
      }
      patch(id, { status: "done", phase: null, pct: 100 });
      onUploaded({
        key: `${res.path}:${res.sha256.slice(0, 8)}`,
        wooSku: sku,
        filename: file.name,
        kind: res.kind,
        publicUrl: res.publicUrl,
        sha256: res.sha256,
        byteSize: res.byteSize,
      });
    }
  }

  return (
    <div data-testid={testId} className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handleFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          over ? "border-amber-400 bg-slate-800" : "border-slate-600 bg-slate-900/60"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <button
          type="button"
          data-testid={buttonTestId}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-amber-400 hover:text-amber-300 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
          {label}
        </button>
        <p className="mt-2 text-[11px] text-slate-400">
          Drop multiple files here — .jpg / .png / .webp / .mp4 / .webm / .glb / .usdz / .pdf. SHA-256
          is computed in your browser before commit.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={INTAKE_MEDIA_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void handleFiles(files);
          }}
        />
      </div>
      {queue.length > 0 ? (
        <ul className="space-y-1.5" data-testid="intake-upload-progress">
          {queue.map((q) => (
            <li key={q.id} className="text-[11px] text-slate-300">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{q.name}</span>
                <span className="shrink-0 text-slate-500">
                  {q.status === "queued"
                    ? "Queued"
                    : q.status === "done"
                      ? "Done ✓"
                      : q.status === "error"
                        ? "Failed"
                        : q.phase === "hashing"
                          ? "Computing SHA-256…"
                          : q.phase === "committing"
                            ? "Verifying upload…"
                            : `Uploading… ${q.pct}%`}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    q.status === "error" ? "bg-rose-500" : "bg-amber-500"
                  }`}
                  style={{
                    width: `${q.status === "error" ? 100 : q.phase === "hashing" ? 5 : q.pct}%`,
                  }}
                />
              </div>
              {q.error ? (
                <p role="alert" className="mt-0.5 font-semibold text-rose-300" data-testid="intake-upload-error">
                  {q.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function UploadResults({ items }: { items: UploadedMedia[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="intake-upload-results">
      {items.map((u) => (
        <li
          key={u.key}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-[11px] text-slate-300"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-mono text-amber-300">{u.wooSku}</span>
          <span className="truncate">{u.filename}</span>
          <span className="text-slate-500">{u.kind.replace("product_", "")}</span>
          <span className="font-mono text-slate-500" title={u.sha256}>
            sha256 {u.sha256.slice(0, 12)}…
          </span>
          <a
            href={u.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-300 hover:underline"
          >
            open
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────── filmstrip ───────────────────────── */

type FilmRow = {
  id: string;
  title: string;
  subtitle?: string;
  thumbUrl: string | null;
  badge?: string;
  status?: string;
};

function Filmstrip({
  rows,
  selectedId,
  onSelect,
  onPrev,
  onNext,
  search,
  onSearch,
}: {
  rows: FilmRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  search?: string;
  onSearch?: (value: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const idx = rows.findIndex((r) => r.id === selectedId);

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-[#111827]">
      <div className="flex items-center gap-1.5 border-b border-white/10 p-2">
        <button
          type="button"
          data-testid="intake-prev"
          onClick={onPrev}
          disabled={idx <= 0}
          title="Previous (Alt+↑)"
          className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronUp className="h-3.5 w-3.5" /> Prev
        </button>
        <button
          type="button"
          data-testid="intake-next"
          onClick={onNext}
          disabled={idx < 0 || idx >= rows.length - 1}
          title="Next (Alt+↓)"
          className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown className="h-3.5 w-3.5" /> Next
        </button>
        <span className="ml-auto text-[10px] text-slate-500">
          {idx >= 0 ? idx + 1 : 0}/{rows.length}
        </span>
      </div>
      {onSearch ? (
        <div className="border-b border-white/10 p-2">
          <input
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search SKU or title…"
            data-testid="intake-filmstrip-search"
            className={FIELD}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="intake-filmstrip">
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-slate-500">Nothing here.</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row, i) => {
              const selected = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    ref={selected ? selectedRef : undefined}
                    data-testid={`intake-film-row-${row.id}`}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(row.id)}
                    className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition-colors ${
                      selected
                        ? "border-amber-400 bg-amber-500/10"
                        : "border-transparent hover:border-slate-600 hover:bg-slate-800/60"
                    }`}
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-[10px] text-slate-500">
                      #{i + 1}
                    </span>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-700 bg-slate-950">
                      {row.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.thumbUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-slate-100">
                        {row.title}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {row.badge ? (
                          <span className="rounded bg-slate-800 px-1 py-px text-[9px] font-semibold uppercase text-slate-400">
                            {row.badge}
                          </span>
                        ) : null}
                        {row.subtitle ? (
                          <span className="truncate text-[10px] text-slate-500">{row.subtitle}</span>
                        ) : null}
                      </span>
                    </span>
                    {row.status ? (
                      <span
                        title={row.status.replace("_", " ")}
                        data-testid="intake-film-status"
                        className={`h-2 w-2 shrink-0 rounded-full ${statusDot(row.status)}`}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

/* ───────────────────────── Mode A · selected finish (center + right) ───────────────────────── */

function FinishStudioDetail({
  item,
  embedToken,
  onItemUpdated,
  onPromoted,
  onToast,
}: {
  item: FinishIntakeView;
  embedToken: string | null;
  onItemUpdated: (next: FinishIntakeView) => void;
  onPromoted: (next: FinishIntakeView, canonicalSku: string) => void;
  onToast: (text: string) => void;
}) {
  const certified = item.status === "certified";
  const [materialClass, setMaterialClass] = useState<MaterialClass | "">(item.materialClass ?? "");
  const [displayName, setDisplayName] = useState(item.displayName ?? "");
  const [vendorSku, setVendorSku] = useState(item.vendorSku ?? "");
  const [description, setDescription] = useState(item.materialDescription ?? "");
  const [patternMode, setPatternMode] = useState<"solid" | "striped">(item.patternMode ?? "solid");
  const [repeatW, setRepeatW] = useState(
    item.repeatWIn != null ? String(item.repeatWIn) : DEFAULT_REPEAT_IN,
  );
  const [repeatH, setRepeatH] = useState(
    item.repeatHIn != null ? String(item.repeatHIn) : DEFAULT_REPEAT_IN,
  );
  const [proposedSku, setProposedSku] = useState(item.proposedSku ?? "");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);
  const [draftCrop, setDraftCrop] = useState<CropBox | null>(null);
  const [busy, setBusy] = useState<"crop" | "approve" | "save" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [lightbox, setLightbox] = useState<PreviewKind | null>(null);
  const [preview, setPreview] = useState<FinishSkuSearchResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const requestId = useRef(0);

  const dims = useMemo<Dims | null>(() => {
    const w = item.sourceWidth ?? natural?.w ?? null;
    const h = item.sourceHeight ?? natural?.h ?? null;
    return w && h ? { w, h } : null;
  }, [item.sourceHeight, item.sourceWidth, natural]);

  const persistedCrop: CropBox | null =
    item.cropX != null && item.cropY != null && item.cropSidePx != null
      ? { cropX: item.cropX, cropY: item.cropY, cropSidePx: item.cropSidePx }
      : null;

  const crop: CropBox | null =
    draftCrop ?? persistedCrop ?? (dims ? defaultCenteredCrop(dims.w, dims.h) : null);

  const cropDirty =
    draftCrop != null &&
    (persistedCrop == null ||
      draftCrop.cropX !== persistedCrop.cropX ||
      draftCrop.cropY !== persistedCrop.cropY ||
      draftCrop.cropSidePx !== persistedCrop.cropSidePx);

  // Live SKU preview — debounced server action (searchFinishSkuMatches + mint/bind).
  const previewQuery = (proposedSku || vendorSku || displayName).trim();
  useEffect(() => {
    if (certified) return;
    if (!previewQuery && !displayName.trim()) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const mine = ++requestId.current;
    setPreviewing(true);
    const t = window.setTimeout(() => {
      void searchFinishSkuAction({
        query: previewQuery,
        displayName: displayName.trim() || null,
        materialClass: materialClass || null,
        proposedSku: proposedSku.trim() || null,
      }).then((res) => {
        if (mine !== requestId.current) return;
        setPreviewing(false);
        if (res.ok) {
          setPreview(res);
          setPreviewError(null);
        } else {
          setPreview(null);
          setPreviewError(res.error);
        }
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [certified, displayName, materialClass, previewQuery, proposedSku]);

  const handleCropChange = useCallback(
    (next: CropBox) => {
      if (!dims) return;
      setDraftCrop(clampCropBox(next, dims.w, dims.h));
      setMessage(null);
    },
    [dims],
  );

  function parseRepeat(value: string): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function detailsPatch(name: string) {
    const striped = patternMode === "striped";
    return {
      materialClass: materialClass || null,
      displayName: name,
      vendorSku: vendorSku.trim() || null,
      materialDescription: description.trim() || null,
      patternMode,
      repeatWIn: striped ? (parseRepeat(repeatW) ?? Number(DEFAULT_REPEAT_IN)) : null,
      repeatHIn: striped ? (parseRepeat(repeatH) ?? Number(DEFAULT_REPEAT_IN)) : null,
      proposedSku: proposedSku.trim() || null,
    };
  }

  /** Calls /api/ecommerce/intake-crop (NOT the server action). */
  async function runApplyCrop(): Promise<FinishIntakeView | null> {
    if (!dims || !crop) {
      setMessage({ tone: "error", text: "Image size unknown — wait for the photo to load." });
      return null;
    }
    const safe = clampCropBox(crop, dims.w, dims.h);
    if (safe.cropSidePx < MIN_CROP_SIDE_PX) {
      setMessage({ tone: "error", text: `Crop must be at least ${MIN_CROP_SIDE_PX}px.` });
      return null;
    }
    const res = await postIntakeCrop(embedToken, {
      id: item.id,
      cropX: safe.cropX,
      cropY: safe.cropY,
      cropSidePx: safe.cropSidePx,
      sourceWidth: dims.w,
      sourceHeight: dims.h,
    });
    if (!res.ok) {
      setMessage({ tone: "error", text: res.error });
      return null;
    }
    setDraftCrop(null);
    return res.view;
  }

  async function applyCrop() {
    setBusy("crop");
    setMessage(null);
    const view = await runApplyCrop();
    setBusy(null);
    if (view) {
      onItemUpdated(view);
      setMessage({ tone: "ok", text: "Applied 2048×2048 square crop ✓" });
      onToast("Applied 2048×2048 square crop ✓");
    }
  }

  async function saveDetails() {
    const name = titleCaseStorefront(displayName);
    setBusy("save");
    setMessage(null);
    setDisplayName(name);
    const saved = await updateFinishIntakeAction(item.id, detailsPatch(name));
    setBusy(null);
    if (!saved.ok) {
      setMessage({ tone: "error", text: saved.error });
      return;
    }
    onItemUpdated(saved.view);
    setMessage({ tone: "ok", text: "Details saved ✓" });
  }

  async function approveAndPromote() {
    const name = titleCaseStorefront(displayName);
    if (!name) {
      setMessage({ tone: "error", text: "Storefront Display Name is required." });
      return;
    }
    if (!materialClass) {
      setMessage({ tone: "error", text: "Select a Material Class first." });
      return;
    }
    setBusy("approve");
    setMessage(null);
    setDisplayName(name);
    const saved = await updateFinishIntakeAction(item.id, detailsPatch(name));
    if (!saved.ok) {
      setBusy(null);
      setMessage({ tone: "error", text: saved.error });
      return;
    }
    if (cropDirty || !saved.view.texture2048Url) {
      const cropped = await runApplyCrop();
      if (!cropped) {
        setBusy(null);
        return;
      }
      onItemUpdated(cropped);
    }
    const promoted = await promoteFinishIntakeAction(item.id);
    setBusy(null);
    if (!promoted.ok) {
      setMessage({ tone: "error", text: promoted.error });
      return;
    }
    setMessage({ tone: "ok", text: `Certified as ${promoted.canonicalSku}` });
    onPromoted(promoted.view, promoted.canonicalSku);
  }

  const canApprove = !certified && busy === null && displayName.trim() !== "" && materialClass !== "";
  const placeholder = materialClass
    ? DISPLAY_NAME_PLACEHOLDER[materialClass]
    : "Select a Material Class first";
  const rawUrl = item.rawReferenceUrl;

  return (
    <>
      {/* CENTER — crop stage + live canvas strip */}
      <section
        data-testid="intake-center-stage"
        data-intake-status={item.status}
        className="min-h-0 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#111827] p-3"
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] text-amber-300" title={item.sourceKey}>
              {item.originalFilename}
            </p>
            <p className="text-[10px] text-slate-500">
              {item.categoryFolder}
              {dims ? ` · ${dims.w}×${dims.h}px` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cropDirty ? (
              <span
                data-testid="intake-unsaved-crop"
                className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200"
              >
                Unsaved crop nudge
              </span>
            ) : null}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                certified
                  ? "bg-emerald-500/15 text-emerald-300"
                  : item.status === "pending"
                    ? "bg-amber-500/15 text-amber-200"
                    : "bg-sky-500/15 text-sky-200"
              }`}
              data-testid="intake-status-badge"
            >
              {certified ? `Certified · ${item.canonicalSku ?? ""}` : item.status.replace("_", " ")}
            </span>
          </div>
        </header>

        {rawUrl ? (
          <div className="flex justify-center">
            <IntakeCropOverlay
              imageUrl={rawUrl}
              alt={`${item.originalFilename} — uncropped reference`}
              sourceWidth={dims?.w ?? null}
              sourceHeight={dims?.h ?? null}
              crop={crop}
              onChange={handleCropChange}
              onNaturalSize={(w, h) => setNatural((prev) => (prev?.w === w && prev?.h === h ? prev : { w, h }))}
              onImageLoad={(img) => setLoadedImg(img)}
              disabled={certified || busy !== null}
            />
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-900 text-xs text-slate-500">
            No uncropped reference image for this item.
          </div>
        )}

        {crop && dims ? (
          <p className="font-mono text-[10px] text-slate-500" data-testid="intake-crop-readout">
            x {crop.cropX} · y {crop.cropY} · side {crop.cropSidePx}px
            {cropDirty ? " · unsaved" : ""}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2" data-testid="intake-live-canvas-strip">
          <PreviewCanvas
            kind="swatch"
            img={loadedImg}
            crop={crop}
            dims={dims}
            url={rawUrl}
            size={256}
            testId="intake-canvas-512"
            label="512 swatch"
            onClick={() => setLightbox("swatch")}
          />
          <PreviewCanvas
            kind="loupe"
            img={loadedImg}
            crop={crop}
            dims={dims}
            url={rawUrl}
            size={256}
            testId="intake-canvas-loupe"
            label="2048 loupe 1:1"
            onClick={() => setLightbox("loupe")}
          />
          <PreviewCanvas
            kind="tile"
            img={loadedImg}
            crop={crop}
            dims={dims}
            url={rawUrl}
            size={270}
            testId="intake-canvas-tile"
            label="3×3 tile"
            onClick={() => setLightbox("tile")}
          />
        </div>
      </section>

      {/* RIGHT — metadata */}
      <section
        data-testid="intake-meta-panel"
        className="min-h-0 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#111827] p-3"
      >
        <label className={LABEL}>
          Material class
          <select
            value={materialClass}
            disabled={certified}
            onChange={(e) => setMaterialClass(e.target.value as MaterialClass | "")}
            data-testid="intake-material-class"
            className={`mt-0.5 ${FIELD}`}
          >
            <option value="">Select…</option>
            {MATERIAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Storefront display name <span className="text-rose-400">*</span>
          <input
            value={displayName}
            disabled={certified}
            required
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => setDisplayName((v) => titleCaseStorefront(v))}
            placeholder={placeholder}
            data-testid="intake-display-name"
            className={`mt-0.5 ${FIELD}`}
          />
        </label>
        <label className={LABEL}>
          Vendor / Mill SKU
          <input
            value={vendorSku}
            disabled={certified}
            onChange={(e) => setVendorSku(e.target.value)}
            placeholder="e.g. 5404-0000"
            data-testid="intake-vendor-sku"
            className={`mt-0.5 font-mono ${FIELD}`}
          />
        </label>
        <label className={LABEL}>
          Material Description / Grade
          <textarea
            value={description}
            disabled={certified}
            maxLength={500}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Grade A solution-dyed acrylic, 54in width"
            data-testid="intake-material-description"
            className={`mt-0.5 resize-y ${FIELD}`}
          />
        </label>

        <div>
          <span className={LABEL}>Pattern mode</span>
          <div className="mt-1 flex flex-wrap gap-2" data-testid="intake-pattern-mode">
            {(["solid", "striped"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={certified}
                aria-pressed={patternMode === mode}
                data-testid={`intake-pattern-${mode}`}
                onClick={() => setPatternMode(mode)}
                className={chip(patternMode === mode)}
              >
                {mode === "solid" ? "Solid / Textured" : "Striped / Patterned"}
              </button>
            ))}
          </div>
          {patternMode === "striped" ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className={LABEL}>
                Repeat W (in)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={repeatW}
                  disabled={certified}
                  onChange={(e) => setRepeatW(e.target.value)}
                  data-testid="intake-repeat-w"
                  className={`mt-0.5 ${FIELD}`}
                />
              </label>
              <label className={LABEL}>
                Repeat H (in)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={repeatH}
                  disabled={certified}
                  onChange={(e) => setRepeatH(e.target.value)}
                  data-testid="intake-repeat-h"
                  className={`mt-0.5 ${FIELD}`}
                />
              </label>
            </div>
          ) : null}
        </div>

        {/* SKU combobox — typeahead (searchFinishSkuAction) + bind / mint */}
        <div
          className="rounded-lg border border-slate-700 bg-slate-900/70 p-3"
          data-testid="intake-sku-preview"
        >
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-3 w-3 text-amber-400" />
            SKU · bind existing or mint new
            {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          </p>
          {certified ? (
            <p className="mt-1 font-mono text-xs text-emerald-300">{item.canonicalSku}</p>
          ) : (
            <>
              <input
                role="combobox"
                aria-expanded={(preview?.matches.length ?? 0) > 0}
                aria-controls={`intake-sku-list-${item.id}`}
                aria-autocomplete="list"
                value={proposedSku}
                onChange={(e) => setProposedSku(e.target.value)}
                placeholder="Type to search roster SKUs, or enter a new one…"
                data-testid="intake-sku-input"
                className={`mt-1.5 font-mono ${FIELD}`}
              />
              {previewError ? (
                <p className="mt-1.5 text-[11px] text-rose-300">{previewError}</p>
              ) : preview ? (
                <div className="mt-1.5 space-y-1.5 text-[11px] text-slate-300">
                  <p data-testid="intake-sku-target">
                    {preview.boundExistingSku ? "Binds to existing " : "Mints new "}
                    <span className="font-mono font-semibold text-amber-300">
                      {preview.boundExistingSku ??
                        (proposedSku.trim().toUpperCase() || preview.mintedSku || "—")}
                    </span>
                  </p>
                  {preview.apfGroup ? (
                    <p className="text-slate-400">
                      APF group · {preview.apfGroup}
                      {preview.uvScale != null ? ` · default UV scale ${preview.uvScale}"` : ""}
                    </p>
                  ) : null}
                  {preview.matches.length > 0 ? (
                    <ul
                      id={`intake-sku-list-${item.id}`}
                      role="listbox"
                      className="max-h-32 divide-y divide-slate-800 overflow-y-auto rounded-md border border-slate-700"
                    >
                      {preview.matches.map((m) => (
                        <li key={m.sku} role="option" aria-selected={proposedSku === m.sku}>
                          <button
                            type="button"
                            title={`${m.displayName} (${m.family})${
                              m.bridgeSkus.length ? ` · bridge ${m.bridgeSkus.join(", ")}` : ""
                            }`}
                            onClick={() => setProposedSku(m.sku)}
                            className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-slate-800"
                          >
                            <span className="font-mono text-[10px] text-amber-200">{m.sku}</span>
                            <span className="truncate text-[10px] text-slate-400">{m.displayName}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-500">No existing roster match.</p>
                  )}
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Enter a display name or vendor SKU to preview the Katana-safe SKU.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            data-testid="intake-apply-crop"
            disabled={certified || busy !== null || !rawUrl || !dims}
            onClick={() => void applyCrop()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-amber-400 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "crop" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Crop className="h-3.5 w-3.5" />
            )}
            {busy === "crop" ? "Cropping 2048px…" : "Apply Crop"}
          </button>
          <button
            type="button"
            data-testid="intake-save-details"
            disabled={certified || busy !== null}
            onClick={() => void saveDetails()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-amber-400 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "save" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save details
          </button>
          <button
            type="button"
            data-testid="intake-approve-promote"
            disabled={!canApprove}
            onClick={() => void approveAndPromote()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "approve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Approve &amp; Promote to Certified
          </button>
        </div>
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            data-testid="intake-card-message"
            className={`text-[11px] font-semibold ${
              message.tone === "error" ? "text-rose-300" : "text-emerald-300"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged preview"
          data-testid="intake-lightbox"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
        >
          <div className="w-[min(85dvh,90vw)]">
            <PreviewCanvas
              kind={lightbox}
              img={loadedImg}
              crop={crop}
              dims={dims}
              url={rawUrl}
              size={768}
              testId="intake-lightbox-canvas"
              label="Click anywhere to close"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ───────────────────────── Mode B · product media ───────────────────────── */

type NeedsMediaProduct = { wooSku: string; title: string };

function ProductMediaCenter({
  product,
  embedToken,
  uploaded,
  onUploaded,
}: {
  product: NeedsMediaProduct | null;
  embedToken: string | null;
  uploaded: UploadedMedia[];
  onUploaded: (media: UploadedMedia) => void;
}) {
  const [manualSku, setManualSku] = useState("");
  const sku = product?.wooSku ?? manualSku;
  const mine = uploaded.filter((u) => u.wooSku === sku.trim());
  return (
    <section
      data-testid="intake-center-stage"
      className="min-h-0 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#111827] p-3"
    >
      <div data-testid="intake-product-media" className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Product media (Mode B)</h3>
          <p className="mt-1 text-xs text-slate-400">
            Direct-to-Supabase signed upload — images, .mp4 video, .glb model, .pdf. SHA-256 is
            computed in your browser before commit.
          </p>
        </div>
        <label className={LABEL}>
          Product SKU
          <input
            value={sku}
            readOnly={product != null}
            onChange={(e) => setManualSku(e.target.value)}
            placeholder="Pick a product at left, or type a SKU…"
            data-testid="intake-media-sku"
            className={`mt-0.5 font-mono ${FIELD}`}
          />
        </label>
        <MultiFileDrop
          embedToken={embedToken}
          wooSku={sku}
          disabled={!sku.trim()}
          testId="intake-media-dropzone"
          buttonTestId="intake-media-upload-btn"
          label="Upload .webp / .mp4 / .glb / .pdf"
          onUploaded={onUploaded}
        />
        {mine.length > 0 ? (
          <div className="grid grid-cols-3 gap-2" data-testid="intake-media-previews">
            {mine.map((u) => (
              <div
                key={u.key}
                className="aspect-square overflow-hidden rounded-md border border-slate-700 bg-slate-950"
                title={u.filename}
              >
                {u.kind === "product_render" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.publicUrl} alt={u.filename} className="h-full w-full object-cover" />
                ) : u.kind === "product_video" ? (
                  <video src={u.publicUrl} muted controls className="h-full w-full object-cover" />
                ) : (
                  <a
                    href={u.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-sky-300 hover:underline"
                  >
                    {u.filename}
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <UploadResults items={uploaded} />
      </div>
    </section>
  );
}

function ProductSavePanel({
  product,
  uploadedCount,
}: {
  product: NeedsMediaProduct | null;
  uploadedCount: number;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  return (
    <section
      data-testid="intake-meta-panel"
      className="min-h-0 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#111827] p-3"
    >
      <div data-testid="intake-needs-media-panel" className="space-y-3">
        <p className="font-mono text-[11px] text-amber-300">{product?.wooSku ?? "No product selected"}</p>
        <label className={LABEL}>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={product?.title ?? "Product title"}
            data-testid="intake-product-title"
            className={`mt-0.5 ${FIELD}`}
          />
        </label>
        <label className={LABEL}>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Product description"
            data-testid="intake-product-description"
            className={`mt-0.5 resize-y ${FIELD}`}
          />
        </label>
        <p className="text-[11px] text-slate-400">
          {uploadedCount} file{uploadedCount === 1 ? "" : "s"} uploaded this session. Uploads commit
          straight to storage; title / description certification for products is not wired in this
          panel yet.
        </p>
        <button
          type="button"
          disabled
          data-testid="intake-product-save"
          title="Product certify actions are not wired yet"
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
      </div>
    </section>
  );
}

/* ───────────────────────── studio ───────────────────────── */

export type IntakeMediaStudioProps = {
  initialItems: FinishIntakeView[];
  onRefresh?: () => void;
  productsNeedingMedia?: Array<{ wooSku: string; title: string }>;
};

const SPLIT_GRID =
  "grid gap-3 lg:grid-cols-[270px_minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)] max-h-[min(78dvh,900px)]";

export default function IntakeMediaStudio({
  initialItems,
  onRefresh,
  productsNeedingMedia = [],
}: IntakeMediaStudioProps) {
  const { embedToken } = useEmbedSession();
  const [items, setItems] = useState<FinishIntakeView[]>(initialItems);
  const [prevInitial, setPrevInitial] = useState(initialItems);
  const [subFilter, setSubFilter] = useState<SubFilter>("all_pending");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSku, setUploadSku] = useState("");
  const [uploaded, setUploaded] = useState<UploadedMedia[]>([]);
  const [bust, setBust] = useState<Record<string, number>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Re-sync when the parent hands down a refreshed queue (adjust-state-during-render pattern).
  if (initialItems !== prevInitial) {
    setPrevInitial(initialItems);
    setItems(initialItems);
  }

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const allPending = useMemo(() => items.filter((i) => i.status !== "certified"), [items]);
  const photoshoot = useMemo(() => items.filter((i) => i.rawSourceFile != null), [items]);
  const recentCertified = useMemo(
    () =>
      items
        .filter((i) => i.status === "certified")
        .sort((a, b) => (b.certifiedAt ?? "").localeCompare(a.certifiedAt ?? ""))
        .slice(0, 40),
    [items],
  );

  const categoryStem = CATEGORY_FILTERS.find((c) => c.key === category)?.stem ?? "";
  const visible = useMemo(() => {
    const base =
      subFilter === "all_pending"
        ? allPending
        : subFilter === "photoshoot"
          ? photoshoot
          : subFilter === "recent_certified"
            ? recentCertified
            : [];
    if (!categoryStem) return base;
    return base.filter((i) => i.categoryFolder.toLowerCase().replace(/[^a-z0-9]/g, "").includes(categoryStem));
  }, [allPending, categoryStem, photoshoot, recentCertified, subFilter]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return productsNeedingMedia;
    return productsNeedingMedia.filter(
      (p) => p.wooSku.toLowerCase().includes(q) || p.title.toLowerCase().includes(q),
    );
  }, [productSearch, productsNeedingMedia]);

  const needsMedia = subFilter === "needs_media";
  const selected = visible.find((i) => i.id === selectedId) ?? visible[0] ?? null;
  const selectedProduct =
    filteredProducts.find((p) => p.wooSku === selectedSku) ?? filteredProducts[0] ?? null;

  const replaceItem = useCallback((next: FinishIntakeView) => {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
    setBust((prev) => ({ ...prev, [next.id]: Date.now() }));
  }, []);

  const navigate = useCallback(
    (delta: number) => {
      if (needsMedia) {
        const idx = filteredProducts.findIndex((p) => p.wooSku === selectedProduct?.wooSku);
        const next = filteredProducts[Math.max(0, Math.min(filteredProducts.length - 1, idx + delta))];
        if (next) setSelectedSku(next.wooSku);
        return;
      }
      const idx = visible.findIndex((i) => i.id === selected?.id);
      const next = visible[Math.max(0, Math.min(visible.length - 1, idx + delta))];
      if (next) setSelectedId(next.id);
    },
    [filteredProducts, needsMedia, selected?.id, selectedProduct?.wooSku, visible],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navigate(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const handlePromoted = useCallback(
    (next: FinishIntakeView, sku: string) => {
      replaceItem(next);
      setBanner(`${next.displayName ?? sku} certified as ${sku}.`);
      setToast(`${next.displayName ?? sku} certified as ${sku} ✓`);
      // Jump to the next Pending row (wrapping), based on the pre-promotion list order.
      const idx = visible.findIndex((i) => i.id === next.id);
      const ordered = [...visible.slice(idx + 1), ...visible.slice(0, Math.max(idx, 0))];
      const nextPending = ordered.find((i) => i.id !== next.id && i.status !== "certified");
      if (nextPending) setSelectedId(nextPending.id);
      onRefresh?.();
    },
    [onRefresh, replaceItem, visible],
  );

  const filters: Array<[SubFilter, string]> = [
    ["all_pending", `All Pending Intake (${allPending.length})`],
    ["photoshoot", `Photoshoot Finishes (${photoshoot.length})`],
    ["needs_media", `Products Needing Media / Dims (${productsNeedingMedia.length})`],
    ["recent_certified", `Recently Certified (${recentCertified.length})`],
  ];

  const finishRows: FilmRow[] = visible.map((i) => ({
    id: i.id,
    title: i.displayName?.trim() || i.originalFilename,
    subtitle: i.displayName?.trim() ? i.originalFilename : undefined,
    thumbUrl: bustUrl(i.thumb512Url, bust[i.id]) ?? i.rawReferenceUrl,
    badge: i.categoryFolder,
    status: i.status,
  }));

  const productRows: FilmRow[] = filteredProducts.map((p) => ({
    id: p.wooSku,
    title: p.wooSku,
    subtitle: p.title,
    thumbUrl: null,
    badge: "needs media",
  }));

  return (
    <div className="mt-6 space-y-3" data-testid="portal-panel-intake">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Intake &amp; Media Studio
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Crop each studio photo to an exact 1:1 square, classify it, then Approve &amp; Promote —
            SKU binding and cloud file naming happen on approval. Nothing reaches WooCommerce until
            it is Certified.
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            data-testid="intake-refresh"
            onClick={() => onRefresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-amber-400 hover:text-amber-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh queue
          </button>
        ) : null}
      </div>

      {/* Top studio bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="intake-studio-bar">
        <div className="flex flex-wrap gap-2" data-testid="portal-intake-subfilters">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`intake-subfilter-${key}`}
              aria-pressed={subFilter === key}
              onClick={() => setSubFilter(key)}
              className={chip(subFilter === key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" data-testid="intake-category-filter">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c.key}
              type="button"
              data-testid={`intake-category-${c.key}`}
              aria-pressed={category === c.key}
              onClick={() => setCategory(c.key)}
              className={chip(category === c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="intake-upload-toggle"
          aria-expanded={uploadOpen}
          onClick={() => setUploadOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-400/60 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-slate-700"
        >
          <UploadCloud className="h-3.5 w-3.5" />
          + Upload New Media / Swatches / MP4 / 3D
        </button>
      </div>

      {uploadOpen ? (
        <div
          className="space-y-2 rounded-xl border border-white/10 bg-[#111827] p-3"
          data-testid="intake-upload-dropzone"
        >
          <label className={`${LABEL} max-w-sm`}>
            Target SKU / folder (optional)
            <input
              value={uploadSku}
              onChange={(e) => setUploadSku(e.target.value)}
              placeholder="e.g. a Woo SKU — blank files under “intake”"
              data-testid="intake-upload-sku"
              className={`mt-0.5 font-mono ${FIELD}`}
            />
          </label>
          <MultiFileDrop
            embedToken={embedToken}
            wooSku={uploadSku}
            testId="intake-upload-multi"
            buttonTestId="intake-upload-btn"
            label="Choose files"
            onUploaded={(m) => setUploaded((prev) => [m, ...prev])}
          />
          <UploadResults items={uploaded} />
        </div>
      ) : null}

      {banner ? (
        <p
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200"
          data-testid="intake-banner"
        >
          {banner}
        </p>
      ) : null}

      {needsMedia ? (
        productsNeedingMedia.length === 0 ? (
          <div className="space-y-3">
            <p className="rounded-xl border border-white/10 bg-[#111827] px-4 py-6 text-center text-xs text-slate-400">
              Every loaded product has media and freight dimensions.
            </p>
            <ProductMediaCenter
              product={null}
              embedToken={embedToken}
              uploaded={uploaded}
              onUploaded={(m) => setUploaded((prev) => [m, ...prev])}
            />
          </div>
        ) : (
          <div className={SPLIT_GRID} data-testid="intake-split-studio" data-mode="needs_media">
            <div className="hidden" data-testid="intake-products-needing-media" aria-hidden="true">
              {productsNeedingMedia.slice(0, 60).map((p) => p.wooSku).join(" ")}
            </div>
            <Filmstrip
              rows={productRows}
              selectedId={selectedProduct?.wooSku ?? null}
              onSelect={setSelectedSku}
              onPrev={() => navigate(-1)}
              onNext={() => navigate(1)}
              search={productSearch}
              onSearch={setProductSearch}
            />
            <ProductMediaCenter
              key={selectedProduct?.wooSku ?? "none"}
              product={selectedProduct}
              embedToken={embedToken}
              uploaded={uploaded}
              onUploaded={(m) => setUploaded((prev) => [m, ...prev])}
            />
            <ProductSavePanel
              key={selectedProduct?.wooSku ?? "none"}
              product={selectedProduct}
              uploadedCount={
                uploaded.filter((u) => u.wooSku === selectedProduct?.wooSku).length
              }
            />
          </div>
        )
      ) : visible.length === 0 || !selected ? (
        <p
          className="rounded-xl border border-white/10 bg-[#111827] px-4 py-10 text-center text-sm text-slate-400"
          data-testid="intake-empty"
        >
          {items.length === 0
            ? "No intake items yet — seed the 27 photoshoot finishes (scripts/ops/seed-intake-photoshoot.ts)."
            : "Nothing in this queue."}
        </p>
      ) : (
        <div className={SPLIT_GRID} data-testid="intake-split-studio" data-mode="finishes">
          <Filmstrip
            rows={finishRows}
            selectedId={selected.id}
            onSelect={setSelectedId}
            onPrev={() => navigate(-1)}
            onNext={() => navigate(1)}
          />
          <FinishStudioDetail
            key={selected.id}
            item={selected}
            embedToken={embedToken}
            onItemUpdated={replaceItem}
            onPromoted={handlePromoted}
            onToast={setToast}
          />
        </div>
      )}

      {toast ? (
        <div
          role="status"
          data-testid="intake-toast"
          className="fixed bottom-4 right-4 z-50 rounded-lg border border-emerald-500/40 bg-slate-900 px-4 py-2 text-xs font-semibold text-emerald-200 shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
