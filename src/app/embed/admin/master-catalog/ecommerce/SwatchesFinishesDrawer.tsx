"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, Loader2, Minus, Plus, Save, UploadCloud, X } from "lucide-react";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import { EMBED_TOKEN_HEADER } from "@/lib/embed-auth";
import { PHASE1_ADDON_ACF_KEYS } from "@/server/ecommerce/phase1-portal";
import { ECOMMERCE_32_FINISH_COUNT, isFinishSkuLocked } from "@/lib/ecommerce-roster";
import {
  addFinishRowForPortal,
  disableFinishRowForPortal,
  listFinishAssetsForPortal,
  saveFinishCalibration,
  updateFinishDisplayForPortal,
  type FinishAssetCategory,
  type FinishAssetView,
} from "../actions";

/* ───────────────────────── shared upload helper (embed) ───────────────────────── */

export type StudioUploadSlot = "thumb" | "texture_2k" | "glb" | "usdz" | "poster";

export type StudioUploadResult =
  | { ok: true; publicUrl: string; byteSize: number | null }
  | { ok: false; error: string };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0 || part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Embed auth for Asset Studio calls. The signed session token comes from EmbedSessionProvider;
 * when it is not in React state the mirrored cookie is read. Cookies are always sent
 * (`credentials: "include"`) so the server-side cookie check still applies as a fallback.
 */
export function resolveEmbedUploadToken(embedToken: string | null): string | null {
  return embedToken || readCookie(EMBED_TOKEN_HEADER);
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
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

/**
 * presign-upload → PUT to the signed Supabase URL → commit-upload.
 * `progress` is the PUT byte progress (0-100).
 */
export async function uploadEmbedAsset(opts: {
  embedToken: string | null;
  kind: "finish_swatch" | "product_3d";
  slot: StudioUploadSlot;
  sku?: string;
  wooSku?: string;
  file: File;
  onProgress?: (pct: number) => void;
}): Promise<StudioUploadResult> {
  const token = resolveEmbedUploadToken(opts.embedToken);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers[EMBED_TOKEN_HEADER] = token;
  const base = {
    kind: opts.kind,
    slot: opts.slot,
    ...(opts.sku ? { sku: opts.sku } : {}),
    ...(opts.wooSku ? { woo_sku: opts.wooSku } : {}),
  };
  try {
    const presignRes = await fetch("/api/assets/presign-upload", {
      method: "POST",
      credentials: "include",
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
    const commitRes = await fetch("/api/assets/commit-upload", {
      method: "POST",
      credentials: "include",
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

/* ───────────────────────── drag-drop button ───────────────────────── */

export function DropButton({
  label,
  accept,
  progress,
  busy,
  disabled,
  onFile,
  testId,
}: {
  label: string;
  accept: string;
  progress?: number | null;
  busy?: boolean;
  disabled?: boolean;
  onFile: (file: File) => void;
  testId?: string;
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
        if (busy || disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`relative overflow-hidden rounded-lg border border-dashed text-[11px] font-semibold ${
        over ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-white hover:border-sky-300"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        disabled={busy || disabled}
        data-testid={testId}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-slate-700 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
        {busy && typeof progress === "number" ? `${label} · ${progress}%` : label}
      </button>
      {busy && typeof progress === "number" ? (
        <span
          className="absolute bottom-0 left-0 h-0.5 bg-sky-500 transition-all"
          style={{ width: `${progress}%` }}
        />
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

/* ───────────────────────── drawer ───────────────────────── */

type TabKey = FinishAssetCategory | "addons";

const TAB_LABEL: Record<TabKey, string> = {
  fabric: "Fabrics",
  powder: "Powder Coats",
  dekton: "Dekton Stone",
  addons: "Add-Ons",
};

const DEFAULT_COUNT: Partial<Record<TabKey, number>> = { fabric: 20, powder: 6, dekton: 6 };

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/** Best-effort pixel-size read so a sub-2048px texture is flagged (never blocked). */
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

function QualityBadge({ status }: { status: FinishAssetView["qualityStatus"] }) {
  return status === "photoshoot_verified" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />
      Hi-Res 2K Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      Low-Res Placeholder
    </span>
  );
}

const CAL_FIELDS = [
  ["sampleWidthIn", "Sample W"],
  ["sampleHeightIn", "Sample H"],
  ["patternRepeatWIn", "Repeat W"],
  ["patternRepeatHIn", "Repeat H"],
] as const;

type CalDraft = Record<(typeof CAL_FIELDS)[number][0], string>;

function draftFromAsset(a: FinishAssetView): CalDraft {
  const f = (v: number | null) => (v == null ? "" : String(v));
  return {
    sampleWidthIn: f(a.sampleWidthIn),
    sampleHeightIn: f(a.sampleHeightIn),
    patternRepeatWIn: f(a.patternRepeatWIn),
    patternRepeatHIn: f(a.patternRepeatHIn),
  };
}

function parseDraft(v: string): number | null | "invalid" {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

function FinishRow({
  asset,
  embedToken,
  onChanged,
  onToast,
  onRemove,
}: {
  asset: FinishAssetView;
  embedToken: string | null;
  onChanged: () => void;
  onToast: (msg: string) => void;
  onRemove: (sku: string) => void;
}) {
  const [draft, setDraft] = useState<CalDraft>(() => draftFromAsset(asset));
  const [displayName, setDisplayName] = useState(asset.displayName);
  const [progress, setProgress] = useState<Partial<Record<"thumb" | "texture_2k", number>>>({});
  const [busy, setBusy] = useState<"thumb" | "texture_2k" | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const skuLocked = isFinishSkuLocked(asset.sku);

  const calKey = [
    asset.sampleWidthIn,
    asset.sampleHeightIn,
    asset.patternRepeatWIn,
    asset.patternRepeatHIn,
  ].join("|");
  useEffect(() => {
    setDraft(draftFromAsset(asset));
    setDisplayName(asset.displayName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calKey, asset.displayName]);

  async function upload(slot: "thumb" | "texture_2k", file: File) {
    setNote(null);
    let warn: string | null = null;
    if (slot === "texture_2k") {
      const size = await readImageSize(file);
      if (size && Math.max(size.w, size.h) < 2048) {
        warn = `Texture is ${size.w}×${size.h}px — 2048px recommended.`;
      }
    }
    setBusy(slot);
    setProgress((p) => ({ ...p, [slot]: 0 }));
    const res = await uploadEmbedAsset({
      embedToken,
      kind: "finish_swatch",
      slot,
      sku: asset.sku,
      file,
      onProgress: (pct) => setProgress((p) => ({ ...p, [slot]: pct })),
    });
    setBusy(null);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    setNote(
      warn
        ? { tone: "warn", text: `Uploaded. ${warn}` }
        : { tone: "ok", text: slot === "thumb" ? "UI swatch updated" : "3D texture updated" },
    );
    onToast(`${asset.sku}: ${slot === "thumb" ? "UI swatch" : "3D texture"} uploaded`);
    onChanged();
  }

  async function save() {
    const parsed = {
      sample_width_in: parseDraft(draft.sampleWidthIn),
      sample_height_in: parseDraft(draft.sampleHeightIn),
      pattern_repeat_w_in: parseDraft(draft.patternRepeatWIn),
      pattern_repeat_h_in: parseDraft(draft.patternRepeatHIn),
    };
    if (Object.values(parsed).includes("invalid")) {
      setNote({ tone: "err", text: "Sizes must be non-negative numbers (inches)." });
      return;
    }
    setSaving(true);
    setNote(null);
    if (displayName.trim() && displayName.trim() !== asset.displayName) {
      const renamed = await updateFinishDisplayForPortal(asset.sku, {
        displayName: displayName.trim(),
      });
      if (!renamed.ok) {
        setSaving(false);
        setNote({ tone: "err", text: renamed.error });
        return;
      }
    }
    const res = await saveFinishCalibration(asset.sku, {
      sample_width_in: parsed.sample_width_in as number | null,
      sample_height_in: parsed.sample_height_in as number | null,
      pattern_repeat_w_in: parsed.pattern_repeat_w_in as number | null,
      pattern_repeat_h_in: parsed.pattern_repeat_h_in as number | null,
    });
    setSaving(false);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    setNote({ tone: "ok", text: "Saved (SKU locked)" });
    onChanged();
  }

  const noteClass =
    note?.tone === "err" ? "text-rose-600" : note?.tone === "warn" ? "text-amber-700" : "text-emerald-700";

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`finish-row-${asset.sku}`}>
      <div className="flex items-start gap-3">
        {asset.swatchThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.swatchThumbUrl}
            alt={asset.displayName}
            className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
          />
        ) : (
          <span
            className="h-12 w-12 shrink-0 rounded-lg border border-slate-200"
            style={{ backgroundColor: asset.hexCode ?? "#e2e8f0" }}
            title={asset.hexCode ?? "No swatch yet"}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-slate-800"
              title="System-generated SKU — locked"
              data-testid={`finish-sku-locked-${asset.sku}`}
            >
              {skuLocked ? <Lock className="h-3 w-3 text-slate-400" /> : null}
              <input
                readOnly
                value={asset.sku}
                aria-readonly="true"
                className="w-36 cursor-not-allowed rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
              />
            </span>
            <QualityBadge status={asset.qualityStatus} />
            <button
              type="button"
              data-testid={`finish-row-remove-${asset.sku}`}
              title="Remove from e-commerce roster (−)"
              onClick={() => onRemove(asset.sku)}
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
          <label className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              data-testid={`finish-display-${asset.sku}`}
              className="mt-0.5 block w-full max-w-xs rounded border border-slate-300 px-1.5 py-1 text-[12px] font-medium normal-case text-slate-900"
            />
          </label>
        </div>
        <div className="grid w-64 shrink-0 grid-cols-2 gap-1.5">
          <DropButton
            label="UI Swatch"
            accept={IMAGE_ACCEPT}
            busy={busy === "thumb"}
            disabled={busy !== null}
            progress={progress.thumb}
            onFile={(f) => void upload("thumb", f)}
            testId={`upload-thumb-${asset.sku}`}
          />
          <DropButton
            label="3D Texture 2048px"
            accept={IMAGE_ACCEPT}
            busy={busy === "texture_2k"}
            disabled={busy !== null}
            progress={progress.texture_2k}
            onFile={(f) => void upload("texture_2k", f)}
            testId={`upload-texture-${asset.sku}`}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
        {CAL_FIELDS.map(([key, label]) => (
          <label key={key} className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {label} (in)
            <input
              inputMode="decimal"
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              data-testid={`cal-${key}-${asset.sku}`}
              className="mt-0.5 block w-16 rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px] normal-case text-slate-900"
              placeholder="—"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          data-testid={`cal-save-${asset.sku}`}
          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
        {note ? <span className={`text-[11px] ${noteClass}`}>{note.text}</span> : null}
      </div>
    </li>
  );
}

export default function SwatchesFinishesDrawer({
  open,
  onClose,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onToast?: (msg: string) => void;
}) {
  const { embedToken } = useEmbedSession();
  const [tab, setTab] = useState<TabKey>("fabric");
  const [assets, setAssets] = useState<FinishAssetView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listFinishAssetsForPortal();
    if (res.ok) {
      setAssets(res.assets);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const counts = useMemo(() => {
    const c: Record<FinishAssetCategory, number> = { fabric: 0, powder: 0, dekton: 0 };
    for (const a of assets) c[a.finishCategory] += 1;
    return c;
  }, [assets]);

  const rows = useMemo(
    () => (tab === "addons" ? [] : assets.filter((a) => a.finishCategory === tab)),
    [assets, tab],
  );

  async function handleAdd() {
    if (tab === "addons") return;
    const name = newName.trim();
    if (!name) {
      setError("Enter a display name before adding a finish row.");
      return;
    }
    setAdding(true);
    const res = await addFinishRowForPortal({ category: tab, displayName: name });
    setAdding(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNewName("");
    onToast?.(`Added ${res.asset.sku} (SKU locked)`);
    await load();
  }

  async function handleRemove(sku: string) {
    const res = await disableFinishRowForPortal(sku);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onToast?.(`Removed ${sku} from e-commerce roster`);
    await load();
  }

  if (!open) return null;

  const tabs: TabKey[] = ["fabric", "powder", "dekton", "addons"];
  const tabLabel = (k: TabKey) =>
    k === "addons"
      ? `${PHASE1_ADDON_ACF_KEYS.length} Add-Ons`
      : `${TAB_LABEL[k]} (${assets.length ? counts[k] : (DEFAULT_COUNT[k] ?? counts[k])})`;

  return (
    <div
      className="print:hidden fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs"
      onClick={onClose}
    >
      <aside
        data-testid="swatches-drawer"
        className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              E-Commerce Finishes ({ECOMMERCE_32_FINISH_COUNT})
            </h3>
            <p className="text-[11px] text-slate-500">
              Exact 32 storefront finishes · SKUs auto-generated &amp; locked · Aluminum frames only · Steel hidden on web.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </header>

        <nav className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-2">
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`finish-tab-${k}`}
              onClick={() => setTab(k)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                tab === k
                  ? "border-sky-600 bg-sky-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
              }`}
            >
              {tabLabel(k)}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error ? (
            <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>
          ) : loading && assets.length === 0 ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading finishes…
            </div>
          ) : tab === "addons" ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Add-on prices are Hub-authoritative ACF meta; they have no swatch assets.
              </p>
              <ul className="grid grid-cols-2 gap-1.5">
                {PHASE1_ADDON_ACF_KEYS.map((key) => (
                  <li
                    key={key}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700"
                  >
                    {key}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-sky-300 bg-sky-50/60 p-3"
                data-testid="finish-row-add"
              >
                <label className="min-w-[12rem] flex-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  New {TAB_LABEL[tab].slice(0, -1)} display name
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Canvas Ivory"
                    data-testid="finish-add-name"
                    className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1.5 text-[12px] font-medium normal-case text-slate-900"
                  />
                </label>
                <button
                  type="button"
                  data-testid="finish-add-btn"
                  disabled={adding}
                  onClick={() => void handleAdd()}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add row (+)
                </button>
                <p className="w-full text-[10px] text-slate-500">
                  SKU is minted automatically (FAB-/PWD-/DKT-) and stays read-only.
                </p>
              </div>
              {rows.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-400">
                  No active {TAB_LABEL[tab].toLowerCase()} on the e-commerce roster. Use + to add one, or run the finish-assets seed.
                </p>
              ) : (
                <ul className="space-y-2">
                  {rows.map((a) => (
                    <FinishRow
                      key={a.sku}
                      asset={a}
                      embedToken={embedToken}
                      onChanged={() => void load()}
                      onToast={(m) => onToast?.(m)}
                      onRemove={(sku) => void handleRemove(sku)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
