"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Save,
  Search,
  UploadCloud,
} from "lucide-react";
import type { LiveStorefrontRow } from "@/server/woocommerce/handoff-spec-generator";
import {
  PHASE1_DEKTONS,
  PHASE1_FABRICS,
  PHASE1_POWDERS,
} from "@/server/ecommerce/phase1-portal";
import {
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
  ecommerceFinishBySku,
} from "@/server/ecommerce/ecommerce-32-finish-roster";

const SUNBRELLA_COUNT = ECOMMERCE_32_FINISHES.filter((f) => f.family === "sunbrella").length;
const ULTRALEATHER_COUNT = ECOMMERCE_32_FINISHES.filter((f) => f.family === "ultraleather").length;
const UPHOLSTERY_COUNT = SUNBRELLA_COUNT + ULTRALEATHER_COUNT;

export type PartnerFinishAsset = {
  sku: string;
  finishCategory: "fabric" | "powder" | "dekton";
  displayName: string;
  hexCode: string | null;
  swatchThumbUrl: string | null;
  texture2kUrl: string | null;
  sampleWidthIn: number | null;
  sampleHeightIn: number | null;
  patternRepeatWIn: number | null;
  patternRepeatHIn: number | null;
  qualityStatus: "placeholder_lowres" | "photoshoot_verified";
};

export type PartnerProduct3d = {
  glbUrl: string | null;
  usdzUrl: string | null;
  fileSize: number | null;
};

export type PartnerCalibrationInput = {
  sample_width_in: number | null;
  sample_height_in: number | null;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
};

export type PartnerCalibrationResult =
  | { ok: true; asset: PartnerFinishAsset }
  | { ok: false; error: string };

type Props = {
  token: string;
  generatedAtUtc: string;
  generatedAtMst: string;
  miaApprovedCount: number;
  miaLatestApprovedAt: string | null;
  sowItemCount: number;
  parentCount: number;
  uniquePurchasableSkus: number;
  variationCount: number;
  simpleCount: number;
  webhookUrl: string;
  storefrontRows: LiveStorefrontRow[];
  finishAssets: PartnerFinishAsset[];
  /** Existing 3D slots keyed by storefront Woo SKU. */
  product3d: Record<string, PartnerProduct3d>;
  finishAssetsError?: string | null;
  /** Server action (token re-validated server-side): saves sample size + pattern repeat. */
  onSaveCalibration: (
    token: string,
    sku: string,
    input: PartnerCalibrationInput,
  ) => Promise<PartnerCalibrationResult>;
};

type Artifact = "csv" | "spec" | "swatches" | "finishes";

function downloadHref(artifact: Artifact, token: string) {
  return `/api/partner/primeview-handoff/download?artifact=${artifact}&token=${encodeURIComponent(token)}`;
}

/* ───────────────────── upload helpers (partner auth) ───────────────────── */

const PARTNER_TOKEN_HEADER = "x-primeview-partner-token";
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

type UploadSlot = "thumb" | "texture_2k" | "glb" | "usdz";
type UploadResult = { ok: true; publicUrl: string; byteSize: number | null } | { ok: false; error: string };

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

/** presign-upload → PUT → commit-upload, authenticated with the partner token (query + header). */
async function uploadPartnerAsset(opts: {
  token: string;
  kind: "finish_swatch" | "product_3d";
  slot: UploadSlot;
  sku?: string;
  wooSku?: string;
  file: File;
  onProgress: (pct: number) => void;
}): Promise<UploadResult> {
  const q = `?token=${encodeURIComponent(opts.token)}`;
  const headers = { "content-type": "application/json", [PARTNER_TOKEN_HEADER]: opts.token };
  const base = {
    kind: opts.kind,
    slot: opts.slot,
    ...(opts.sku ? { sku: opts.sku } : {}),
    ...(opts.wooSku ? { woo_sku: opts.wooSku } : {}),
  };
  try {
    const presignRes = await fetch(`/api/assets/presign-upload${q}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        filename: opts.file.name,
        contentType: opts.file.type || undefined,
        byteSize: opts.file.size,
      }),
    });
    const presign = await readJson(presignRes);
    if (!presignRes.ok || presign.ok !== true) {
      return { ok: false, error: String(presign.error ?? `Presign failed (HTTP ${presignRes.status})`) };
    }
    await putWithProgress(
      String(presign.signedUrl),
      opts.file,
      String(presign.contentType ?? (opts.file.type || "application/octet-stream")),
      opts.onProgress,
    );
    const commitRes = await fetch(`/api/assets/commit-upload${q}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        bucket: presign.bucket,
        path: presign.path,
        byteSize: opts.file.size,
      }),
    });
    const commit = await readJson(commitRes);
    if (!commitRes.ok || commit.ok !== true) {
      return { ok: false, error: String(commit.error ?? `Commit failed (HTTP ${commitRes.status})`) };
    }
    return {
      ok: true,
      publicUrl: String(commit.publicUrl ?? presign.publicUrl ?? ""),
      byteSize: typeof commit.byteSize === "number" ? commit.byteSize : null,
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Upload failed" };
  }
}

function PartnerDrop({
  label,
  accept,
  busy,
  disabled,
  progress,
  onFile,
}: {
  label: string;
  accept: string;
  busy: boolean;
  disabled: boolean;
  progress: number | null;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy && !disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !busy && !disabled) onFile(file);
      }}
      className={`relative overflow-hidden rounded-lg border border-dashed text-[11px] font-semibold ${
        over ? "border-amber-400 bg-amber-400/10" : "border-white/20 bg-white/5 hover:border-amber-400/60"
      } ${disabled && !busy ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-slate-200 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
        {busy && progress != null ? `${label} · ${progress}%` : label}
      </button>
      {busy && progress != null ? (
        <span className="absolute bottom-0 left-0 h-0.5 bg-amber-400 transition-all" style={{ width: `${progress}%` }} />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function QualityBadge({ status }: { status: PartnerFinishAsset["qualityStatus"] }) {
  return status === "photoshoot_verified" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
      <CheckCircle2 className="h-3 w-3" /> Hi-Res 2K Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
      <AlertTriangle className="h-3 w-3" /> Low-Res Placeholder
    </span>
  );
}

type Note = { tone: "ok" | "warn" | "err"; text: string };

function NoteLine({ note }: { note: Note | null }) {
  if (!note) return null;
  const cls =
    note.tone === "err" ? "text-rose-400" : note.tone === "warn" ? "text-amber-300" : "text-emerald-400";
  return <span className={`text-[11px] ${cls}`}>{note.text}</span>;
}

/* ───────────────────── finish upload row ───────────────────── */

type CalDraft = { sw: string; sh: string; rw: string; rh: string };

function draftOf(a: PartnerFinishAsset): CalDraft {
  const f = (v: number | null) => (v == null ? "" : String(v));
  return {
    sw: f(a.sampleWidthIn),
    sh: f(a.sampleHeightIn),
    rw: f(a.patternRepeatWIn),
    rh: f(a.patternRepeatHIn),
  };
}

function parseNum(v: string): number | null | "invalid" {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

function FinishUploadRow({
  asset,
  token,
  onAssetChange,
  onSaveCalibration,
}: {
  asset: PartnerFinishAsset;
  token: string;
  onAssetChange: (next: PartnerFinishAsset) => void;
  onSaveCalibration: Props["onSaveCalibration"];
}) {
  const [draft, setDraft] = useState<CalDraft>(() => draftOf(asset));
  const [busy, setBusy] = useState<"thumb" | "texture_2k" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const calKey = [asset.sampleWidthIn, asset.sampleHeightIn, asset.patternRepeatWIn, asset.patternRepeatHIn].join("|");
  useEffect(() => {
    setDraft(draftOf(asset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calKey]);

  async function upload(slot: "thumb" | "texture_2k", file: File) {
    setNote(null);
    let warn = "";
    if (slot === "texture_2k") {
      const size = await readImageSize(file);
      if (size && Math.max(size.w, size.h) < 2048) {
        warn = ` ${size.w}×${size.h}px — 2048px recommended.`;
      }
    }
    setBusy(slot);
    setProgress(0);
    const res = await uploadPartnerAsset({
      token,
      kind: "finish_swatch",
      slot,
      sku: asset.sku,
      file,
      onProgress: setProgress,
    });
    setBusy(null);
    setProgress(null);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    onAssetChange({
      ...asset,
      ...(slot === "thumb" ? { swatchThumbUrl: res.publicUrl } : { texture2kUrl: res.publicUrl }),
      qualityStatus: "photoshoot_verified",
    });
    setNote({ tone: warn ? "warn" : "ok", text: `${slot === "thumb" ? "UI swatch" : "3D texture"} uploaded.${warn}` });
  }

  async function save() {
    const parsed = {
      sample_width_in: parseNum(draft.sw),
      sample_height_in: parseNum(draft.sh),
      pattern_repeat_w_in: parseNum(draft.rw),
      pattern_repeat_h_in: parseNum(draft.rh),
    };
    if (Object.values(parsed).includes("invalid")) {
      setNote({ tone: "err", text: "Sizes must be non-negative numbers (inches)." });
      return;
    }
    setSaving(true);
    setNote(null);
    const res = await onSaveCalibration(token, asset.sku, parsed as PartnerCalibrationInput);
    setSaving(false);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    onAssetChange(res.asset);
    setNote({ tone: "ok", text: "Scale saved" });
  }

  const fields: [keyof CalDraft, string][] = [
    ["sw", "Sample W"],
    ["sh", "Sample H"],
    ["rw", "Repeat W"],
    ["rh", "Repeat H"],
  ];

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid={`partner-finish-${asset.sku}`}>
      <div className="flex items-start gap-3">
        {asset.swatchThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.swatchThumbUrl}
            alt={asset.displayName}
            className="h-11 w-11 shrink-0 rounded-lg border border-white/10 object-cover"
          />
        ) : (
          <span
            className="h-11 w-11 shrink-0 rounded-lg border border-white/10"
            style={{ backgroundColor: asset.hexCode ?? "#334155" }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-amber-200/90">{asset.sku}</span>
            <QualityBadge status={asset.qualityStatus} />
          </div>
          <p className="truncate text-[11px] text-slate-400">{asset.displayName}</p>
        </div>
        <div className="grid w-60 shrink-0 grid-cols-2 gap-1.5">
          <PartnerDrop
            label="UI Swatch"
            accept={IMAGE_ACCEPT}
            busy={busy === "thumb"}
            disabled={busy !== null}
            progress={busy === "thumb" ? progress : null}
            onFile={(f) => void upload("thumb", f)}
          />
          <PartnerDrop
            label="3D Texture 2048px"
            accept={IMAGE_ACCEPT}
            busy={busy === "texture_2k"}
            disabled={busy !== null}
            progress={busy === "texture_2k" ? progress : null}
            onFile={(f) => void upload("texture_2k", f)}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-white/5 pt-2">
        {fields.map(([key, label]) => (
          <label key={key} className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {label} (in)
            <input
              inputMode="decimal"
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              placeholder="—"
              className="mt-0.5 block w-16 rounded border border-white/15 bg-[#0f1419] px-1.5 py-1 font-mono text-[11px] normal-case text-slate-100"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
        <NoteLine note={note} />
      </div>
    </li>
  );
}

/* ───────────────────── 3D model upload row ───────────────────── */

const FACING_RE = /-(LS|RS)(?:-|$)/i;

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ModelUploadRow({
  row,
  token,
  model,
  onModelChange,
}: {
  row: LiveStorefrontRow;
  token: string;
  model: PartnerProduct3d | undefined;
  onModelChange: (sku: string, next: PartnerProduct3d) => void;
}) {
  const [busy, setBusy] = useState<"glb" | "usdz" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [copied, setCopied] = useState(false);
  const facing = FACING_RE.exec(row.wooSku)?.[1]?.toUpperCase() ?? null;
  const current: PartnerProduct3d = model ?? { glbUrl: null, usdzUrl: null, fileSize: null };

  async function upload(slot: "glb" | "usdz", file: File) {
    const lower = file.name.toLowerCase();
    const ok = slot === "glb" ? /\.(glb|gltf)$/.test(lower) : lower.endsWith(".usdz");
    if (!ok) {
      setNote({ tone: "err", text: slot === "glb" ? "Choose a .glb file." : "Choose a .usdz file." });
      return;
    }
    setNote(null);
    setBusy(slot);
    setProgress(0);
    const res = await uploadPartnerAsset({
      token,
      kind: "product_3d",
      slot,
      wooSku: row.wooSku,
      file,
      onProgress: setProgress,
    });
    setBusy(null);
    setProgress(null);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    onModelChange(
      row.wooSku,
      slot === "glb"
        ? { ...current, glbUrl: res.publicUrl, fileSize: res.byteSize ?? current.fileSize }
        : { ...current, usdzUrl: res.publicUrl },
    );
    setNote({ tone: "ok", text: `${slot.toUpperCase()} uploaded` });
  }

  async function copyUrl() {
    if (!current.glbUrl) return;
    try {
      await navigator.clipboard.writeText(current.glbUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNote({ tone: "warn", text: current.glbUrl });
    }
  }

  return (
    <li
      className={`rounded-xl border p-3 ${
        facing ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-white/10 bg-white/[0.03]"
      }`}
      data-testid={`partner-model-${row.wooSku}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-amber-200/90">{row.wooSku}</span>
            {facing ? (
              <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                {facing === "LS" ? "Left-Side Facing" : "Right-Side Facing"}
              </span>
            ) : null}
            {current.glbUrl ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                3D Ready{current.fileSize ? ` · ${formatBytes(current.fileSize)}` : ""}
              </span>
            ) : (
              <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                No 3D yet
              </span>
            )}
            {current.usdzUrl ? (
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300">USDZ</span>
            ) : null}
          </div>
          <p className="truncate text-[11px] text-slate-400">{row.productName}</p>
        </div>
        <div className="grid w-60 shrink-0 grid-cols-2 gap-1.5">
          <PartnerDrop
            label="Drop .glb"
            accept=".glb,.gltf,model/gltf-binary"
            busy={busy === "glb"}
            disabled={busy !== null}
            progress={busy === "glb" ? progress : null}
            onFile={(f) => void upload("glb", f)}
          />
          <PartnerDrop
            label="Drop .usdz"
            accept=".usdz,model/vnd.usdz+zip"
            busy={busy === "usdz"}
            disabled={busy !== null}
            progress={busy === "usdz" ? progress : null}
            onFile={(f) => void upload("usdz", f)}
          />
        </div>
      </div>
      {current.glbUrl || note ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {current.glbUrl ? (
            <button
              type="button"
              onClick={() => void copyUrl()}
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
            >
              {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy CDN URL"}
            </button>
          ) : null}
          <NoteLine note={note} />
        </div>
      ) : null}
    </li>
  );
}

/* ───────────────────── page ───────────────────── */

type TabKey = "downloads" | "upload";
type FinishFilter = "fabric" | "powder" | "dekton" | "needs_hires";
type ModelFilter = "all" | "facing" | "ready" | "missing";

export default function PartnerHandoffClient(props: Props) {
  const [tab, setTab] = useState<TabKey>("downloads");
  const [assets, setAssets] = useState<PartnerFinishAsset[]>(props.finishAssets);
  const [models, setModels] = useState<Record<string, PartnerProduct3d>>(props.product3d);
  const [finishFilter, setFinishFilter] = useState<FinishFilter>("fabric");
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c = { fabric: 0, powder: 0, dekton: 0, needs_hires: 0 };
    for (const a of assets) {
      c[a.finishCategory] += 1;
      if (a.qualityStatus !== "photoshoot_verified") c.needs_hires += 1;
    }
    return c;
  }, [assets]);

  const visibleAssets = useMemo(
    () =>
      assets.filter((a) =>
        finishFilter === "needs_hires"
          ? a.qualityStatus !== "photoshoot_verified"
          : a.finishCategory === finishFilter,
      ),
    [assets, finishFilter],
  );

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.storefrontRows.filter((r) => {
      const has3d = Boolean(models[r.wooSku]?.glbUrl);
      if (modelFilter === "facing" && !FACING_RE.test(r.wooSku)) return false;
      if (modelFilter === "ready" && !has3d) return false;
      if (modelFilter === "missing" && has3d) return false;
      if (!q) return true;
      return (
        r.wooSku.toLowerCase().includes(q) ||
        r.canonicalSku.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.collection.toLowerCase().includes(q) ||
        r.parentId.toLowerCase().includes(q)
      );
    });
  }, [props.storefrontRows, models, modelFilter, query]);

  const groups = useMemo(() => {
    const map = new Map<string, LiveStorefrontRow[]>();
    for (const r of visibleRows) {
      const list = map.get(r.parentId) ?? [];
      list.push(r);
      map.set(r.parentId, list);
    }
    return [...map.entries()];
  }, [visibleRows]);

  const readyCount = props.storefrontRows.filter((r) => models[r.wooSku]?.glbUrl).length;

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
      active
        ? "border-amber-400 bg-amber-500 text-slate-950"
        : "border-white/15 bg-white/5 text-slate-300 hover:border-amber-400/50"
    }`;

  return (
    <div className="min-h-screen bg-[#0f1419] text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="border-b border-white/10 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
            CC Patio × PrimeView
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Phase 1 Handoff Portal
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Self-serve downloads and photoshoot asset uploads for Yardi on{" "}
            <span className="font-mono text-slate-300">ccpatiodev2.primeview.com</span>.
            No catalog edit, delete, or Katana/GHL mutation controls.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
              Mia Approved: {props.miaApprovedCount} / {props.sowItemCount}
            </span>
            <span className="text-xs text-slate-500">
              Last updated {props.generatedAtMst} MST ({props.generatedAtUtc})
              {props.miaLatestApprovedAt
                ? ` · latest approval ${props.miaLatestApprovedAt}`
                : ""}
            </span>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="partner-kpi-cards">
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Parents</dt>
              <dd className="text-lg font-semibold text-white">{props.parentCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Variations</dt>
              <dd className="text-lg font-semibold text-white">{props.variationCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Simple</dt>
              <dd className="text-lg font-semibold text-white">{props.simpleCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Purchasable SKUs</dt>
              <dd className="text-lg font-semibold text-white">{props.uniquePurchasableSkus}</dd>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Active Finishes</dt>
              <dd className="text-lg font-semibold text-white">{ECOMMERCE_32_FINISH_COUNT}</dd>
            </div>
          </dl>
        </header>

        <nav className="mt-6 flex flex-wrap gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "downloads"}
            data-testid="partner-tab-downloads"
            onClick={() => setTab("downloads")}
            className={chip(tab === "downloads")}
          >
            Phase 1 Downloads &amp; Integration Spec
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upload"}
            data-testid="partner-tab-upload"
            onClick={() => setTab("upload")}
            className={chip(tab === "upload")}
          >
            Upload Photoshoot Swatches &amp; 3D Models (.glb)
          </button>
        </nav>

        {tab === "downloads" ? (
          <div data-testid="partner-panel-downloads">
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                1-click downloads
              </h2>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={downloadHref("csv", props.token)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  Download Live 169-Column WooCommerce CSV
                </a>
                <a
                  href={downloadHref("spec", props.token)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download Live Technical Handoff Spec (.md)
                </a>
                <a
                  href={downloadHref("finishes", props.token)}
                  data-testid="download-finishes-manifest"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download Full 3D Finishes &amp; Swatches Manifest (.json)
                </a>
                <a
                  href={downloadHref("swatches", props.token)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download {ECOMMERCE_32_FINISH_COUNT} Active Finishes Manifest (.json)
                </a>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Production webhook:{" "}
                <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-slate-300">
                  {props.webhookUrl}
                </code>
              </p>
            </section>

            <section className="mt-10 grid gap-6 lg:grid-cols-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {UPHOLSTERY_COUNT} Upholstery Swatches [{SUNBRELLA_COUNT} Sunbrella +{" "}
                  {ULTRALEATHER_COUNT} Ultraleather]
                </h2>
                <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[#0f1419] text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Display Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PHASE1_FABRICS.map((sku) => (
                        <tr key={sku} className="border-t border-white/5">
                          <td className="px-3 py-1.5 font-mono text-amber-200/90">{sku}</td>
                          <td className="px-3 py-1.5 text-slate-300">
                            {ecommerceFinishBySku(sku)?.displayName ?? sku}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {PHASE1_DEKTONS.length} Dekton Stones
                </h2>
                <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-white/5 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Display Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PHASE1_DEKTONS.map((d) => (
                        <tr key={d.sku} className="border-t border-white/5">
                          <td className="px-3 py-1.5 font-mono text-amber-200/90">{d.sku}</td>
                          <td className="px-3 py-1.5 text-slate-300">
                            {ecommerceFinishBySku(d.sku)?.displayName ?? d.name}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {PHASE1_POWDERS.length} Powder-Coat Finishes
                </h2>
                <div className="mt-3 overflow-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-white/5 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Display Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PHASE1_POWDERS.map((sku) => (
                        <tr key={sku} className="border-t border-white/5">
                          <td className="px-3 py-1.5 font-mono text-amber-200/90">{sku}</td>
                          <td className="px-3 py-1.5 text-slate-300">
                            {ecommerceFinishBySku(sku)?.displayName ?? sku}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Map every APF dropdown to these Hub SKUs — never fictional{" "}
                  <code className="text-slate-400">FAB-SUN-5453-CAN</code> /{" "}
                  <code className="text-slate-400">PWD-BLK-MAT</code>.
                </p>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Phase 1 catalog (read-only)
              </h2>
              <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">Collection</th>
                      <th className="px-3 py-2.5 font-medium">Product &amp; Size</th>
                      <th className="px-3 py-2.5 font-medium">Woo SKU</th>
                      <th className="px-3 py-2.5 font-medium">Regular/Sale</th>
                      <th className="px-3 py-2.5 font-medium">Weight &amp; Ship</th>
                      <th className="px-3 py-2.5 font-medium">Options</th>
                      <th className="px-3 py-2.5 font-medium">Mia Approved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.storefrontRows.map((row) => (
                      <tr
                        key={row.wooSku}
                        className="border-t border-white/5 text-slate-200"
                      >
                        <td className="px-3 py-2 align-top text-slate-400">{row.collection}</td>
                        <td className="px-3 py-2 align-top">{row.productName}</td>
                        <td className="px-3 py-2 align-top font-mono text-xs text-amber-200/90">
                          {row.wooSku}
                        </td>
                        <td className="px-3 py-2 align-top tabular-nums">
                          ${row.regularPrice}
                          {row.salePrice ? (
                            <span className="text-emerald-400"> / ${row.salePrice}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top text-slate-400">
                          {row.weightLb} lb · {row.shippingClass}
                        </td>
                        <td className="px-3 py-2 align-top text-slate-500 max-w-[14rem] truncate">
                          {row.options || "—"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span
                            className={
                              row.miaApproved
                                ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300"
                                : "rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-400"
                            }
                          >
                            {row.miaApproved ? "Approved" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div data-testid="partner-panel-upload">
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Swatches &amp; textures
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                UI Swatch = storefront thumbnail. 3D Texture = 2048px map applied in the .glb viewer. Enter the physical
                sample size and pattern repeat in inches so the texture tiles at true scale.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ["fabric", `Fabrics (${counts.fabric})`],
                    ["powder", `Powders (${counts.powder})`],
                    ["dekton", `Dekton (${counts.dekton})`],
                    ["needs_hires", `Needs Hi-Res (${counts.needs_hires})`],
                  ] as [FinishFilter, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`partner-finish-filter-${key}`}
                    onClick={() => setFinishFilter(key)}
                    className={chip(finishFilter === key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {props.finishAssetsError ? (
                <p className="mt-3 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">{props.finishAssetsError}</p>
              ) : visibleAssets.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No finishes match this filter.</p>
              ) : (
                <ul className="mt-3 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                  {visibleAssets.map((a) => (
                    <FinishUploadRow
                      key={a.sku}
                      asset={a}
                      token={props.token}
                      onSaveCalibration={props.onSaveCalibration}
                      onAssetChange={(next) =>
                        setAssets((prev) => prev.map((p) => (p.sku === next.sku ? next : p)))
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-10">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  3D models (.glb / .usdz)
                </h2>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  3D Ready: {readyCount} / {props.storefrontRows.length}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Upload per storefront SKU. Left/Right-facing variations (
                <code className="text-slate-400">-LS</code> / <code className="text-slate-400">-RS</code>) are
                highlighted — each facing needs its own model.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search parent, product, or Woo SKU…"
                    data-testid="partner-model-search"
                    className="w-full rounded-xl border border-white/15 bg-white/5 py-2 pl-8 pr-3 text-sm text-slate-100 placeholder:text-slate-500"
                  />
                </div>
                {(
                  [
                    ["all", "All SKUs"],
                    ["facing", "-LS / -RS"],
                    ["missing", "Needs 3D"],
                    ["ready", "3D Ready"],
                  ] as [ModelFilter, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`partner-model-filter-${key}`}
                    onClick={() => setModelFilter(key)}
                    className={chip(modelFilter === key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 max-h-[40rem] space-y-4 overflow-y-auto pr-1">
                {groups.length === 0 ? (
                  <p className="text-xs text-slate-500">No SKUs match.</p>
                ) : (
                  groups.map(([parentId, rows]) => (
                    <div key={parentId}>
                      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {rows[0]!.collection} · parent {parentId} · {rows.length} SKU{rows.length === 1 ? "" : "s"}
                      </h3>
                      <ul className="space-y-2">
                        {rows.map((row) => (
                          <ModelUploadRow
                            key={row.wooSku}
                            row={row}
                            token={props.token}
                            model={models[row.wooSku]}
                            onModelChange={(sku, next) => setModels((prev) => ({ ...prev, [sku]: next }))}
                          />
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
