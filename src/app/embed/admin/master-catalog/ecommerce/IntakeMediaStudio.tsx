"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Crop, Loader2, RefreshCw, Sparkles } from "lucide-react";
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
  applyFinishIntakeCropAction,
  promoteFinishIntakeAction,
  searchFinishSkuAction,
  updateFinishIntakeAction,
  type FinishSkuSearchResult,
} from "../actions";
import { DropButton, resolveEmbedUploadToken } from "./SwatchesFinishesDrawer";
import IntakeCropOverlay from "./IntakeCropOverlay";

/* ───────────────────────── constants ───────────────────────── */

type SubFilter = "all_pending" | "photoshoot" | "needs_media" | "recent_certified";

const MATERIAL_OPTIONS: Array<{ value: MaterialClass; label: string }> = [
  { value: "sunbrella", label: "Sunbrella Fabric" },
  { value: "ultraleather", label: "Ultraleather" },
  { value: "dekton", label: "Dekton Stone" },
  { value: "powder", label: "Powder Coat" },
  { value: "addon", label: "Storefront Add-On" },
];

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

/* ───────────────────────── Mode A · finish card ───────────────────────── */

function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

function PreviewTile({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1" data-testid={testId}>
      <div className="aspect-square w-full overflow-hidden rounded-md border border-slate-700 bg-slate-950">
        {children}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
    </div>
  );
}

function PreviewEmpty() {
  return (
    <span className="flex h-full w-full items-center justify-center px-1 text-center text-[9px] text-slate-500">
      Apply crop to generate
    </span>
  );
}

function FinishIntakeCard({
  item,
  onItemUpdated,
  onPromoted,
}: {
  item: FinishIntakeView;
  onItemUpdated: (next: FinishIntakeView) => void;
  onPromoted: (next: FinishIntakeView, canonicalSku: string) => void;
}) {
  const certified = item.status === "certified";
  const [materialClass, setMaterialClass] = useState<MaterialClass | "">(item.materialClass ?? "");
  const [displayName, setDisplayName] = useState(item.displayName ?? "");
  const [vendorSku, setVendorSku] = useState(item.vendorSku ?? "");
  const [patternMode, setPatternMode] = useState<"solid" | "striped">(item.patternMode ?? "solid");
  const [proposedSku, setProposedSku] = useState(item.proposedSku ?? "");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [draftCrop, setDraftCrop] = useState<CropBox | null>(null);
  const [busy, setBusy] = useState<"crop" | "approve" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<FinishSkuSearchResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const requestId = useRef(0);

  const dims = useMemo(() => {
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
    const res = await applyFinishIntakeCropAction({
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
      setMessage({ tone: "ok", text: "Crop applied — 2048 / 512 / 3×3 previews refreshed." });
      onItemUpdated(view);
    }
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
    const saved = await updateFinishIntakeAction(item.id, {
      materialClass,
      displayName: name,
      vendorSku: vendorSku.trim() || null,
      patternMode,
      proposedSku: proposedSku.trim() || null,
    });
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

  const thumbUrl = item.thumb512Url;
  const textureUrl = item.texture2048Url;
  const tileSource = textureUrl ?? thumbUrl;
  const liveThumb =
    !thumbUrl && item.rawReferenceUrl && dims && crop
      ? {
          backgroundImage: cssUrl(item.rawReferenceUrl),
          backgroundSize: `${(dims.w / crop.cropSidePx) * 100}% ${(dims.h / crop.cropSidePx) * 100}%`,
          backgroundPosition: `${
            dims.w > crop.cropSidePx ? (crop.cropX / (dims.w - crop.cropSidePx)) * 100 : 0
          }% ${dims.h > crop.cropSidePx ? (crop.cropY / (dims.h - crop.cropSidePx)) * 100 : 0}%`,
          backgroundRepeat: "no-repeat",
        }
      : null;

  const canApprove = !certified && busy === null && displayName.trim() !== "" && materialClass !== "";

  return (
    <article
      data-testid={`intake-card-${item.id}`}
      data-intake-status={item.status}
      className="rounded-2xl border border-white/10 bg-[#111827] p-4"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] text-amber-300" title={item.sourceKey}>
            {item.sourceKey}
          </p>
          <p className="text-[10px] text-slate-500">
            {item.categoryFolder}
            {dims ? ` · ${dims.w}×${dims.h}px` : ""}
          </p>
        </div>
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
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT — crop + previews */}
        <div className="space-y-3">
          {item.rawReferenceUrl ? (
            <IntakeCropOverlay
              imageUrl={item.rawReferenceUrl}
              alt={`${item.originalFilename} — uncropped reference`}
              sourceWidth={dims?.w ?? null}
              sourceHeight={dims?.h ?? null}
              crop={crop}
              onChange={handleCropChange}
              onNaturalSize={(w, h) => setNatural({ w, h })}
              disabled={certified || busy !== null}
            />
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
          <div className="grid grid-cols-3 gap-2" data-testid="intake-preview-row">
            <PreviewTile label="512 thumb" testId="intake-preview-thumb">
              {thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt="512 thumbnail" className="h-full w-full object-cover" />
              ) : liveThumb ? (
                <div className="h-full w-full" style={liveThumb} title="Live crop preview" />
              ) : (
                <PreviewEmpty />
              )}
            </PreviewTile>
            <PreviewTile label="2048 texture" testId="intake-preview-2048">
              {textureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={textureUrl} alt="2048 texture" className="h-full w-full object-cover" />
              ) : (
                <PreviewEmpty />
              )}
            </PreviewTile>
            <PreviewTile label="3×3 tile" testId="intake-preview-3x3">
              {tileSource ? (
                <div
                  className="h-full w-full"
                  style={{
                    backgroundImage: cssUrl(tileSource),
                    backgroundSize: "33.3333% 33.3333%",
                    backgroundRepeat: "repeat",
                  }}
                />
              ) : (
                <PreviewEmpty />
              )}
            </PreviewTile>
          </div>
        </div>

        {/* RIGHT — classification */}
        <div className="space-y-3">
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
            Storefront display name
            <input
              value={displayName}
              disabled={certified}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => setDisplayName((v) => titleCaseStorefront(v))}
              placeholder="e.g. Canvas Ivory"
              data-testid="intake-display-name"
              className={`mt-0.5 ${FIELD}`}
            />
          </label>
          <label className={LABEL}>
            Vendor SKU
            <input
              value={vendorSku}
              disabled={certified}
              onChange={(e) => setVendorSku(e.target.value)}
              placeholder="e.g. 5404-0000"
              data-testid="intake-vendor-sku"
              className={`mt-0.5 font-mono ${FIELD}`}
            />
          </label>
          <div>
            <span className={LABEL}>Pattern mode</span>
            <div className="mt-1 flex gap-2" data-testid="intake-pattern-mode">
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
                  {mode === "solid" ? "Solid" : "Striped"}
                </button>
              ))}
            </div>
          </div>

          <div
            className="rounded-lg border border-slate-700 bg-slate-900/70 p-3"
            data-testid="intake-sku-preview"
          >
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-3 w-3 text-amber-400" />
              Live SKU preview
              {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            </p>
            {certified ? (
              <p className="mt-1 font-mono text-xs text-emerald-300">{item.canonicalSku}</p>
            ) : previewError ? (
              <p className="mt-1 text-[11px] text-rose-300">{previewError}</p>
            ) : preview ? (
              <div className="mt-1 space-y-1.5 text-[11px] text-slate-300">
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
                  <div className="flex flex-wrap gap-1">
                    {preview.matches.map((m) => (
                      <button
                        key={m.sku}
                        type="button"
                        title={`${m.displayName} (${m.family})${
                          m.bridgeSkus.length ? ` · bridge ${m.bridgeSkus.join(", ")}` : ""
                        }`}
                        onClick={() => setProposedSku(m.sku)}
                        className="rounded-md border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-amber-200 hover:border-amber-400"
                      >
                        {m.sku}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500">No existing roster match.</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                Enter a display name or vendor SKU to preview the Katana-safe SKU.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              data-testid="intake-apply-crop"
              disabled={certified || busy !== null || !item.rawReferenceUrl || !dims}
              onClick={() => void applyCrop()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-amber-400 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "crop" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Crop className="h-3.5 w-3.5" />
              )}
              Apply Crop
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
        </div>
      </div>
    </article>
  );
}

/* ───────────────────────── Mode B · product media dropzone ───────────────────────── */

type UploadedMedia = {
  key: string;
  wooSku: string;
  filename: string;
  kind: IntakeUploadKind;
  publicUrl: string;
  sha256: string;
  byteSize: number | null;
};

function ProductMediaDropzone({
  products,
  embedToken,
}: {
  products: Array<{ wooSku: string; title: string }>;
  embedToken: string | null;
}) {
  const [wooSku, setWooSku] = useState(products[0]?.wooSku ?? "");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"hashing" | "uploading" | "committing" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedMedia[]>([]);

  async function handleFile(file: File) {
    const sku = wooSku.trim();
    if (!sku) {
      setError("Pick or type a product SKU first.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(0);
    const res = await uploadIntakeFile({
      embedToken,
      file,
      wooSku: sku,
      onPhase: setPhase,
      onProgress: setProgress,
    });
    setBusy(false);
    setPhase(null);
    setProgress(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setUploaded((prev) => [
      {
        key: `${res.path}:${res.sha256.slice(0, 8)}`,
        wooSku: sku,
        filename: file.name,
        kind: res.kind,
        publicUrl: res.publicUrl,
        sha256: res.sha256,
        byteSize: res.byteSize,
      },
      ...prev,
    ]);
  }

  return (
    <section
      className="rounded-2xl border border-white/10 bg-[#111827] p-4"
      data-testid="intake-product-media"
    >
      <h3 className="text-sm font-semibold text-white">Product media (Mode B)</h3>
      <p className="mt-1 text-xs text-slate-400">
        Direct-to-Supabase signed upload — .webp renders, .mp4 video, .glb model, .pdf. SHA-256 is
        computed in your browser before commit.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className={`${LABEL} min-w-[14rem] flex-1`}>
          Product SKU
          <input
            value={wooSku}
            list="intake-products-needing-media"
            onChange={(e) => setWooSku(e.target.value)}
            placeholder="Search SKU or type one…"
            data-testid="intake-media-sku"
            className={`mt-0.5 font-mono ${FIELD}`}
          />
          <datalist id="intake-products-needing-media">
            {products.map((p) => (
              <option key={p.wooSku} value={p.wooSku}>
                {p.title}
              </option>
            ))}
          </datalist>
        </label>
        <div className="min-w-[12rem] flex-1" data-testid="intake-media-dropzone">
          <DropButton
            label="Upload .webp / .mp4 / .glb / .pdf"
            accept={INTAKE_MEDIA_ACCEPT}
            busy={busy}
            disabled={busy || !wooSku.trim()}
            progress={progress}
            testId="intake-media-upload-btn"
            variant="dark"
            onFile={(f) => void handleFile(f)}
          />
        </div>
      </div>
      {busy || progress != null ? (
        <div className="mt-3" data-testid="intake-upload-progress">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${phase === "hashing" ? 5 : (progress ?? 0)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            {phase === "hashing"
              ? "Computing SHA-256…"
              : phase === "committing"
                ? "Verifying upload…"
                : `Uploading… ${progress ?? 0}%`}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-rose-300" data-testid="intake-upload-error">
          {error}
        </p>
      ) : null}
      {uploaded.length > 0 ? (
        <ul className="mt-3 space-y-1.5" data-testid="intake-upload-results">
          {uploaded.map((u) => (
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
      ) : null}
    </section>
  );
}

/* ───────────────────────── studio ───────────────────────── */

export type IntakeMediaStudioProps = {
  initialItems: FinishIntakeView[];
  onRefresh?: () => void;
  productsNeedingMedia?: Array<{ wooSku: string; title: string }>;
};

export default function IntakeMediaStudio({
  initialItems,
  onRefresh,
  productsNeedingMedia = [],
}: IntakeMediaStudioProps) {
  const { embedToken } = useEmbedSession();
  const [items, setItems] = useState<FinishIntakeView[]>(initialItems);
  const [prevInitial, setPrevInitial] = useState(initialItems);
  const [subFilter, setSubFilter] = useState<SubFilter>("all_pending");
  const [banner, setBanner] = useState<string | null>(null);

  // Re-sync when the parent hands down a refreshed queue (adjust-state-during-render pattern).
  if (initialItems !== prevInitial) {
    setPrevInitial(initialItems);
    setItems(initialItems);
  }

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

  const visible =
    subFilter === "all_pending"
      ? allPending
      : subFilter === "photoshoot"
        ? photoshoot
        : subFilter === "recent_certified"
          ? recentCertified
          : [];

  const replaceItem = useCallback((next: FinishIntakeView) => {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  }, []);

  const filters: Array<[SubFilter, string]> = [
    ["all_pending", `All Pending Intake (${allPending.length})`],
    ["photoshoot", `Photoshoot Finishes (${photoshoot.length})`],
    ["needs_media", `Products Needing Media / Dims (${productsNeedingMedia.length})`],
    ["recent_certified", `Recently Certified (${recentCertified.length})`],
  ];

  return (
    <div className="mt-6 space-y-5" data-testid="portal-panel-intake">
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

      {banner ? (
        <p
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200"
          data-testid="intake-banner"
        >
          {banner}
        </p>
      ) : null}

      {subFilter === "needs_media" ? (
        <div className="space-y-4">
          {productsNeedingMedia.length > 0 ? (
            <div
              className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-white/10 bg-[#111827] p-3"
              data-testid="intake-products-needing-media"
            >
              {productsNeedingMedia.slice(0, 60).map((p) => (
                <span
                  key={p.wooSku}
                  title={p.title}
                  className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-[10px] text-amber-200"
                >
                  {p.wooSku}
                </span>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-white/10 bg-[#111827] px-4 py-6 text-center text-xs text-slate-400">
              Every loaded product has media and freight dimensions.
            </p>
          )}
          <ProductMediaDropzone products={productsNeedingMedia} embedToken={embedToken} />
        </div>
      ) : visible.length === 0 ? (
        <p
          className="rounded-xl border border-white/10 bg-[#111827] px-4 py-10 text-center text-sm text-slate-400"
          data-testid="intake-empty"
        >
          {items.length === 0
            ? "No intake items yet — seed the 27 photoshoot finishes (scripts/ops/seed-intake-photoshoot.ts)."
            : "Nothing in this queue."}
        </p>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-2" data-testid="intake-card-list">
          {visible.map((item) => (
            <FinishIntakeCard
              key={item.id}
              item={item}
              onItemUpdated={replaceItem}
              onPromoted={(next, sku) => {
                replaceItem(next);
                setBanner(`${next.displayName ?? sku} certified as ${sku}.`);
                onRefresh?.();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
