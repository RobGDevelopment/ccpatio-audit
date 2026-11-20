"use client";

import { useCallback, useEffect, useState } from "react";
import { Box, Check, Copy, Loader2, RefreshCw, Save, X } from "lucide-react";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import {
  getProduct3dSlots,
  saveProduct3dMaterialSlots,
  syncProduct3dToWoo,
  type Product3dSlots,
} from "../actions";
import { DropButton, uploadEmbedAsset } from "./SwatchesFinishesDrawer";

export const MATERIAL_SLOT_TAGS = [
  { key: "frame_metal", label: "frame_metal" },
  { key: "cushion_fabric", label: "cushion_fabric" },
  { key: "stone_top", label: "stone_top" },
  { key: "accent_pillow", label: "accent_pillow" },
] as const;

type SlotKey = (typeof MATERIAL_SLOT_TAGS)[number]["key"];

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function UrlLine({ label, url }: { label: string; url: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-12 shrink-0 font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {url ? (
        <>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate font-mono text-sky-700 hover:underline"
            title={url}
          >
            {url}
          </a>
          <button
            type="button"
            aria-label={`Copy ${label} URL`}
            className="shrink-0 text-slate-400 hover:text-slate-700"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard unavailable: link is still selectable */
              }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </>
      ) : (
        <span className="text-slate-400">Not uploaded</span>
      )}
    </div>
  );
}

export default function Product3dMediaDrawer({
  open,
  sku,
  productName,
  onClose,
  onChanged,
  onToast,
}: {
  open: boolean;
  /** Woo (storefront) SKU preferred; an unambiguous global SKU also resolves. */
  sku: string | null;
  productName?: string;
  onClose: () => void;
  /** Called after a successful upload / save so the grid can refresh. */
  onChanged?: () => void;
  onToast?: (msg: string) => void;
}) {
  const { embedToken } = useEmbedSession();
  const [slots, setSlots] = useState<Product3dSlots | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Set<SlotKey>>(new Set());
  const [busy, setBusy] = useState<"glb" | "usdz" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!sku) return;
    setLoading(true);
    const res = await getProduct3dSlots(sku);
    if (res.ok) {
      setSlots(res.slots);
      setTags(new Set(res.slots.materialSlots.map((s) => s.slot)));
      setError(null);
    } else {
      setSlots(null);
      setError(res.error);
    }
    setLoading(false);
  }, [sku]);

  useEffect(() => {
    if (open && sku) {
      setNote(null);
      void load();
    }
  }, [open, sku, load]);

  if (!open || !sku) return null;

  async function upload(slot: "glb" | "usdz", file: File) {
    if (!sku) return;
    const lower = file.name.toLowerCase();
    const okExt = slot === "glb" ? /\.(glb|gltf)$/.test(lower) : lower.endsWith(".usdz");
    if (!okExt) {
      setNote({ tone: "err", text: slot === "glb" ? "Choose a .glb file." : "Choose a .usdz file." });
      return;
    }
    setNote(null);
    setBusy(slot);
    setProgress(0);
    const res = await uploadEmbedAsset({
      embedToken,
      kind: "product_3d",
      slot,
      ...(slots?.wooSku ? { wooSku: slots.wooSku } : { sku: slots?.globalSku ?? sku }),
      file,
      onProgress: setProgress,
    });
    setBusy(null);
    setProgress(null);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    setNote({ tone: "ok", text: `${slot.toUpperCase()} uploaded` });
    onToast?.(`${sku}: .${slot} uploaded`);
    await load();
    onChanged?.();
  }

  async function saveTags() {
    if (!sku) return;
    setSaving(true);
    setNote(null);
    const res = await saveProduct3dMaterialSlots(
      sku,
      MATERIAL_SLOT_TAGS.filter((t) => tags.has(t.key)).map((t) => ({
        slot: t.key,
        mesh_name: slots?.materialSlots.find((m) => m.slot === t.key)?.mesh_name ?? null,
      })),
    );
    setSaving(false);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    setNote({ tone: "ok", text: "Material slots saved" });
    onChanged?.();
  }

  async function sync() {
    if (!sku) return;
    setSyncing(true);
    setNote(null);
    const res = await syncProduct3dToWoo(sku);
    setSyncing(false);
    if (!res.ok) {
      setNote({ tone: "err", text: res.error });
      return;
    }
    setNote({ tone: "ok", text: `Synced ${res.globalSku} to WooCommerce` });
    onToast?.(`Synced 3D & swatches for ${res.globalSku}`);
    onChanged?.();
  }

  return (
    <div
      className="print:hidden fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs"
      onClick={onClose}
    >
      <aside
        data-testid="product-3d-drawer"
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Box className="h-4 w-4 text-sky-600" /> 3D Media
            </h3>
            <p className="truncate text-[11px] text-slate-500">
              {productName ? `${productName} · ` : ""}
              <span className="font-mono">{sku}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>
          ) : loading && !slots ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading 3D slots…
            </div>
          ) : slots ? (
            <>
              <section className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <UrlLine label=".glb" url={slots.glbUrl} />
                <UrlLine label=".usdz" url={slots.usdzUrl} />
                <dl className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500">Size</dt>
                    <dd className="text-slate-800">{formatBytes(slots.fileSize)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500">Uploader</dt>
                    <dd className="truncate text-slate-800">{slots.uploadedBy ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500">Updated</dt>
                    <dd className="text-slate-800">
                      {slots.updatedAt ? new Date(slots.updatedAt).toLocaleDateString() : "—"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Upload</h4>
                <div className="grid grid-cols-2 gap-2">
                  <DropButton
                    label="Drop .glb"
                    accept=".glb,.gltf,model/gltf-binary"
                    busy={busy === "glb"}
                    disabled={busy !== null}
                    progress={busy === "glb" ? progress : null}
                    onFile={(f) => void upload("glb", f)}
                    testId="upload-glb"
                  />
                  <DropButton
                    label="Drop .usdz"
                    accept=".usdz,model/vnd.usdz+zip"
                    busy={busy === "usdz"}
                    disabled={busy !== null}
                    progress={busy === "usdz" ? progress : null}
                    onFile={(f) => void upload("usdz", f)}
                    testId="upload-usdz"
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  Binary glTF up to 100 MB. The .glb is stored on the listing and is never added to Woo images.
                </p>
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Material slots</h4>
                <div className="flex flex-wrap gap-1.5">
                  {MATERIAL_SLOT_TAGS.map((t) => {
                    const on = tags.has(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        aria-pressed={on}
                        data-testid={`material-slot-${t.key}`}
                        onClick={() =>
                          setTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(t.key)) next.delete(t.key);
                            else next.add(t.key);
                            return next;
                          })
                        }
                        className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${
                          on
                            ? "border-sky-600 bg-sky-50 text-sky-800"
                            : "border-slate-200 bg-white text-slate-500 hover:border-sky-300"
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => void saveTags()}
                  disabled={saving}
                  data-testid="save-material-slots"
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save slots
                </button>
              </section>
            </>
          ) : null}

          {note ? (
            <p className={`text-xs ${note.tone === "err" ? "text-rose-600" : "text-emerald-700"}`}>{note.text}</p>
          ) : null}
        </div>

        <footer className="border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing || !slots?.glbUrl}
            data-testid="sync-3d-woo"
            title={slots?.glbUrl ? undefined : "Upload a .glb first"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync 3D &amp; Swatches to WooCommerce
          </button>
        </footer>
      </aside>
    </div>
  );
}
