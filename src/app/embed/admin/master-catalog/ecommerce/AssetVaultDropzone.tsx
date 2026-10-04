"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  History,
  ExternalLink,
  Palette,
  CheckCircle2,
  Trash2,
  Box,
} from "lucide-react";
import {
  requestAssetUpload,
  confirmAsset,
  getProductAssets,
  deleteGalleryAsset,
  updateAssetAltText,
  type VaultAssetWithUrl,
} from "../actions";
import {
  requestCadUpload,
  confirmCadUpload,
  getLatestCadUpload,
  type CadUploadRow,
} from "@/app/admin/factory-bom/actions";

type VaultKind =
  | "primary_image"
  | "gallery"
  | "tear_sheet"
  | "assembly"
  | "care_guide"
  | "warranty";

const SLOTS: {
  kind: VaultKind;
  label: string;
  hint: string;
  accept: string;
  type: "image" | "pdf";
}[] = [
  { kind: "primary_image", label: "Primary Image", hint: ".jpg / .png / .webp", accept: ".png,.jpg,.jpeg,.webp", type: "image" },
  { kind: "gallery", label: "Gallery", hint: ".jpg / .png / .webp (many)", accept: ".png,.jpg,.jpeg,.webp", type: "image" },
  { kind: "tear_sheet", label: "Tear Sheet", hint: ".pdf", accept: ".pdf", type: "pdf" },
  { kind: "assembly", label: "Assembly", hint: ".pdf", accept: ".pdf", type: "pdf" },
  { kind: "care_guide", label: "Care Guide", hint: ".pdf", accept: ".pdf", type: "pdf" },
  { kind: "warranty", label: "Warranty", hint: ".pdf", accept: ".pdf", type: "pdf" },
];

const CAD_STATUS: Record<CadUploadRow["status"], { label: string; tone: string }> = {
  uploaded: { label: "Uploaded", tone: "bg-amber-50 text-amber-700 border-amber-100" },
  queued: { label: "Queued", tone: "bg-amber-50 text-amber-700 border-amber-100" },
  processing: { label: "Processing", tone: "bg-amber-50 text-amber-700 border-amber-100" },
  draft_ready: { label: "Draft ready", tone: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  failed: { label: "Failed", tone: "bg-rose-50 text-rose-700 border-rose-100" },
};

const CAD_IN_FLIGHT = new Set<CadUploadRow["status"]>(["uploaded", "queued", "processing"]);

function inferMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** Saves on blur / Enter, only when the value actually changed. */
function AltTextField({
  id,
  initial,
  onSave,
}: {
  id: string;
  initial: string | null;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function commit() {
    if (value.trim() === saved.trim() || state === "saving") return;
    setState("saving");
    try {
      await onSave(value);
      setSaved(value);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        id={id}
        type="text"
        value={value}
        maxLength={300}
        placeholder="Alt text"
        aria-label="Alt text"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
        className={`w-full rounded border px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-400 ${
          state === "error" ? "border-rose-400" : "border-slate-200"
        }`}
      />
      {state === "saving" && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-400" />}
    </div>
  );
}

export function AssetVaultDropzone({
  globalSku,
  onImageUploaded,
}: {
  globalSku: string;
  onImageUploaded?: (url: string) => void;
}) {
  const [assets, setAssets] = useState<VaultAssetWithUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<VaultKind | null>(null);
  const [altDraft, setAltDraft] = useState<Record<"primary_image" | "gallery", string>>({
    primary_image: "",
    gallery: "",
  });
  const [openHistory, setOpenHistory] = useState<VaultKind | null>(null);
  const [cad, setCad] = useState<CadUploadRow | null>(null);
  const [cadLoaded, setCadLoaded] = useState(false);
  const cadInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setAssets(await getProductAssets(globalSku));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load assets");
    } finally {
      setLoading(false);
    }
  }, [globalSku]);

  const refreshCad = useCallback(async () => {
    try {
      setCad(await getLatestCadUpload(globalSku));
    } catch {
      /* status is informational; keep the last known value */
    } finally {
      setCadLoaded(true);
    }
  }, [globalSku]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    void refreshCad();
  }, [refresh, refreshCad]);

  // Poll the latest cad_uploads row while the pipeline is still working on it.
  useEffect(() => {
    if (!cad || !CAD_IN_FLIGHT.has(cad.status)) return;
    const handle = window.setInterval(() => void refreshCad(), 3000);
    return () => window.clearInterval(handle);
  }, [cad, refreshCad]);

  async function upload(kind: VaultKind, file: File | undefined) {
    if (!file) return;
    setBusyKind(kind);
    setError(null);
    setNotice(null);
    try {
      // 1. Server validates bucket/ext/filename and picks the object key.
      const signed = await requestAssetUpload({
        globalSku,
        kind,
        filename: file.name,
        byteSize: file.size,
      });
      // 2. Browser uploads the bytes to the server-chosen key.
      const mime = file.type || inferMime(file.name);
      const put = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");
      // 3. Server re-reads the object: magic bytes, sha256, then the revision engine.
      const altText =
        kind === "gallery" || kind === "primary_image" ? altDraft[kind].trim() || null : null;
      const confirmed = await confirmAsset({
        globalSku,
        kind,
        storagePath: signed.path,
        originalFilename: file.name,
        altText,
      });
      if (kind === "gallery" || kind === "primary_image") {
        setAltDraft((d) => ({ ...d, [kind]: "" }));
      }
      if (kind === "primary_image" && confirmed.publicUrl && onImageUploaded) {
        onImageUploaded(confirmed.publicUrl);
      }
      setNotice(
        kind === "gallery"
          ? "Gallery image added."
          : `Saved as revision ${confirmed.revision}${confirmed.supersededRevision ? ` (replaced revision ${confirmed.supersededRevision}, kept in history)` : ""}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusyKind(null);
    }
  }

  async function removeGallery(asset: VaultAssetWithUrl) {
    if (!window.confirm(`Delete "${asset.filename}" from the gallery? This cannot be undone.`)) return;
    setBusyKind(`delete:${asset.id}`);
    setError(null);
    setNotice(null);
    try {
      await deleteGalleryAsset({ globalSku, assetId: asset.id });
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      setNotice("Gallery image deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyKind(null);
    }
  }

  async function handleCad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusyKind("cad");
    setError(null);
    setNotice(null);
    try {
      const requested = await requestCadUpload({
        globalSku,
        filename: file.name,
        byteSize: file.size,
        contentType: file.type || undefined,
        forceRename: true,
      });
      if (!requested.ok) throw new Error(requested.error);
      const mime = file.type || inferMime(file.name);
      const put = await fetch(requested.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");
      await confirmCadUpload(requested.uploadId);
      setNotice("CAD model queued for the Factory BOM pipeline.");
      await refreshCad();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CAD upload failed");
    } finally {
      setBusyKind(null);
      if (cadInput.current) cadInput.current.value = "";
    }
  }

  const busy = busyKind !== null;
  const cadStatus = cad ? CAD_STATUS[cad.status] : null;

  return (
    <div id="asset-vault-panel" className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-700 border-b border-slate-100 pb-2 flex items-center justify-between">
        Asset Vault
        {(busy || loading) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </h3>
      {error && <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
      {notice && !error && (
        <p className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" /> {notice}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        {SLOTS.map((slot) => {
          const rows = assets.filter((a) => a.kind === slot.kind);
          const isGallery = slot.kind === "gallery";
          const current = isGallery ? null : rows.find((a) => a.isCurrent) ?? null;
          // The server already orders gallery rows by sort_order; keep that order here.
          const gallery = isGallery
            ? rows
                .filter((a) => a.isCurrent)
                .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER))
            : [];
          const history = isGallery ? [] : rows.filter((a) => !a.isCurrent).sort((a, b) => b.revision - a.revision);
          const Icon = slot.type === "image" ? ImageIcon : FileText;
          const isBusy = busyKind === slot.kind;
          const hasCurrent = isGallery ? gallery.length > 0 : !!current;
          const takesAlt = slot.kind === "gallery" || slot.kind === "primary_image";

          return (
            <div
              key={slot.kind}
              id={`vault-slot-${slot.kind}`}
              onDragOver={(e) => {
                if (busy) return;
                e.preventDefault();
                setDragKind(slot.kind);
              }}
              onDragLeave={() => setDragKind((k) => (k === slot.kind ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                setDragKind(null);
                if (!busy) void upload(slot.kind, e.dataTransfer.files?.[0]);
              }}
              className={`border-2 border-dashed rounded-xl p-4 flex flex-col gap-2 transition relative group ${
                isGallery ? "col-span-2" : ""
              } ${dragKind === slot.kind ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-slate-400 group-hover:text-sky-500" />
                <span className="text-xs font-semibold text-slate-700">{slot.label}</span>
                {current && (
                  <span className="ml-auto text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5">
                    Rev {current.revision}
                  </span>
                )}
                {isGallery && gallery.length > 0 && (
                  <span className="ml-auto text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5">
                    {gallery.length}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">{slot.hint}</span>

              {current && (
                <div className="text-[10px] text-slate-500 space-y-0.5">
                  <p className="truncate font-medium text-slate-600" title={current.filename}>
                    {current.filename}
                  </p>
                  <p>
                    {formatBytes(current.byteSize)} · effective {current.effectiveOn}
                  </p>
                  {current.sha256 && <p className="font-mono">sha256 {current.sha256.slice(0, 10)}…</p>}
                  {current.url && (
                    <a
                      href={current.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 font-semibold"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {slot.kind === "primary_image" && (
                    <AltTextField
                      key={`${current.id}:${current.altText ?? ""}`}
                      id="vault-alt-primary_image"
                      initial={current.altText}
                      onSave={async (v) => {
                        const res = await updateAssetAltText({ globalSku, assetId: current.id, altText: v });
                        setAssets((prev) =>
                          prev.map((a) => (a.id === current.id ? { ...a, altText: res.altText } : a)),
                        );
                      }}
                    />
                  )}
                </div>
              )}

              {history.length > 0 && (
                <div className="text-[10px]">
                  <button
                    type="button"
                    onClick={() => setOpenHistory((k) => (k === slot.kind ? null : slot.kind))}
                    className="flex items-center gap-1 text-slate-400 hover:text-slate-600"
                    data-testid={`vault-history-toggle-${slot.kind}`}
                  >
                    <History className="h-3 w-3" /> {history.length} previous revision{history.length === 1 ? "" : "s"}
                  </button>
                  {openHistory === slot.kind && (
                    <ul className="mt-1 space-y-1 border-l-2 border-slate-100 pl-2" data-testid={`vault-history-${slot.kind}`}>
                      {history.map((h) => (
                        <li key={h.id} className="flex items-center gap-1.5 text-slate-500">
                          <span className="font-bold text-slate-600">Rev {h.revision}</span>
                          <span className="truncate" title={h.filename}>
                            {h.filename}
                          </span>
                          <span className="text-slate-400">
                            {h.supersededAt ? `replaced ${formatDate(h.supersededAt)}` : formatDate(h.createdAt)}
                          </span>
                          {h.url ? (
                            <a
                              href={h.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-auto inline-flex items-center gap-0.5 text-sky-600 hover:text-sky-700 font-semibold"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="ml-auto text-slate-300">unavailable</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {isGallery && gallery.length > 0 && (
                <ul className="grid grid-cols-3 gap-3" data-testid="vault-gallery-list">
                  {gallery.map((g) => (
                    <li key={g.id} className="rounded-lg border border-slate-200 bg-white p-1.5 space-y-1.5">
                      {g.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.url}
                          alt={g.altText ?? g.filename}
                          className="h-20 w-full rounded object-cover border border-slate-100"
                        />
                      ) : (
                        <span className="block h-20 w-full rounded bg-slate-100 border border-slate-200" />
                      )}
                      <AltTextField
                        key={`${g.id}:${g.altText ?? ""}`}
                        id={`vault-alt-${g.id}`}
                        initial={g.altText}
                        onSave={async (v) => {
                          const res = await updateAssetAltText({ globalSku, assetId: g.id, altText: v });
                          setAssets((prev) => prev.map((a) => (a.id === g.id ? { ...a, altText: res.altText } : a)));
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void removeGallery(g)}
                        disabled={busy}
                        data-testid={`vault-delete-${g.id}`}
                        className="w-full inline-flex items-center justify-center gap-1 rounded border border-rose-200 px-1.5 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {busyKind === `delete:${g.id}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {takesAlt && (
                <input
                  type="text"
                  value={altDraft[slot.kind as "primary_image" | "gallery"]}
                  maxLength={300}
                  disabled={busy}
                  onChange={(e) =>
                    setAltDraft((d) => ({ ...d, [slot.kind as "primary_image" | "gallery"]: e.target.value }))
                  }
                  placeholder={`Alt text for the next ${isGallery ? "gallery image" : "primary image"} (optional)`}
                  aria-label={`Alt text for the next ${slot.label} upload`}
                  data-testid={`vault-alt-draft-${slot.kind}`}
                  className="w-full rounded border border-slate-200 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-400"
                />
              )}

              <label
                className={`mt-1 text-center text-[11px] font-semibold rounded-md border px-2 py-1.5 cursor-pointer transition ${
                  isBusy
                    ? "bg-slate-100 text-slate-400 border-slate-200"
                    : "bg-white text-sky-700 border-sky-200 hover:bg-sky-50"
                } ${busy && !isBusy ? "opacity-50 pointer-events-none" : ""}`}
              >
                {isBusy ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Verifying…
                  </span>
                ) : isGallery ? (
                  "Add image"
                ) : hasCurrent ? (
                  `Replace (new revision ${(current?.revision ?? 0) + 1})`
                ) : (
                  "Upload"
                )}
                <input
                  type="file"
                  accept={slot.accept}
                  className="sr-only"
                  data-testid={`vault-input-${slot.kind}`}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    void upload(slot.kind, f);
                  }}
                />
              </label>
            </div>
          );
        })}

        {/* CAD stays on the existing Factory BOM pipeline (blueprint §7.1); status = latest cad_uploads row. */}
        <div
          id="vault-slot-cad"
          className="col-span-2 border-2 border-dashed border-slate-200 rounded-xl p-4 flex items-center gap-4 hover:bg-slate-50 transition cursor-pointer relative group"
        >
          <UploadCloud className="h-6 w-6 shrink-0 text-slate-400 group-hover:text-sky-500" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">CAD Model</span>
              {!cadLoaded ? (
                <Loader2 className="h-3 w-3 animate-spin text-slate-300" />
              ) : cadStatus ? (
                <span
                  id="vault-cad-status"
                  data-status={cad!.status}
                  className={`text-[10px] font-bold uppercase tracking-wide rounded-full border px-2 py-0.5 ${cadStatus.tone}`}
                >
                  {cadStatus.label}
                  {CAD_IN_FLIGHT.has(cad!.status) && <Loader2 className="ml-1 inline h-2.5 w-2.5 animate-spin" />}
                </span>
              ) : (
                <span id="vault-cad-status" data-status="none" className="text-[10px] text-slate-400">
                  No CAD uploaded
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400">.dae / .skp · Factory BOM</p>
            {cad && (
              <p className="text-[10px] text-slate-500 truncate" title={cad.originalFilename}>
                <Box className="mr-1 inline h-3 w-3 text-slate-400" />
                {cad.originalFilename} · updated {formatDate(cad.updatedAt)}
                {cad.status === "draft_ready" && " · ready for Factory BOM review"}
              </p>
            )}
            {cad?.status === "failed" && cad.errorMessage && (
              <p className="text-[10px] text-rose-600">{cad.errorMessage}</p>
            )}
          </div>
          <input
            type="file"
            ref={cadInput}
            accept=".dae,.skp"
            onChange={handleCad}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            disabled={busy}
            aria-label="Upload CAD model"
          />
        </div>
      </div>

      {/* Finish swatches: read-only until the collection-scoped finish library exists. */}
      <div
        id="vault-finish-swatches"
        className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3"
        aria-readonly="true"
      >
        <Palette className="h-5 w-5 text-slate-300 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-slate-600">Finish Swatches</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Finish imagery is collection-scoped and is not on this SKU yet
          </p>
        </div>
      </div>
    </div>
  );
}
