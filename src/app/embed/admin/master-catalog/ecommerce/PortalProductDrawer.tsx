"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, Save, UploadCloud, X } from "lucide-react";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import {
  getProduct3dSlots,
  savePortalProductDetail,
  saveProduct3dMaterialSlots,
  type PortalProductDetail,
  type Product3dSlots,
} from "../actions";
import {
  SURFACE_PROFILE_OPTIONS,
  freightDimsBadge,
  type SurfaceProfile,
} from "@/server/ecommerce/portal-readiness";
import { DropButton, uploadEmbedAsset } from "./SwatchesFinishesDrawer";

export type PortalDrawerFocus = "freight" | "media" | "surface" | "title";

const MATERIAL_SLOTS = [
  { key: "frame_finish", label: "frame_finish" },
  { key: "cushion_fabric", label: "cushion_fabric" },
  { key: "table_top", label: "table_top" },
  { key: "accent_accents", label: "accent_accents" },
] as const;

type SlotKey = (typeof MATERIAL_SLOTS)[number]["key"];

type Props = {
  sku: string;
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  onSaved?: () => void;
  focusSection?: PortalDrawerFocus;
};

/**
 * Merged dark Product & 3D drawer for the Executive Control Center.
 * Loads via /api/ecommerce/portal-product with embed token headers
 * so cross-origin iframes work when third-party cookies are blocked.
 */
export default function PortalProductDrawer({
  sku,
  open,
  onClose,
  onToast,
  onSaved,
  focusSection,
}: Props) {
  const { embedFetch, embedToken } = useEmbedSession();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PortalProductDetail | null>(null);
  const [slots, setSlots] = useState<Product3dSlots | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [aluminumMsrp, setAluminumMsrp] = useState("");
  const [surfaceProfile, setSurfaceProfile] = useState<SurfaceProfile>("Cushion + Frame");
  const [preserveWp, setPreserveWp] = useState(true);
  const [weightLb, setWeightLb] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [uploadBusy, setUploadBusy] = useState<"photo" | "glb" | "usdz" | null>(null);
  const [materialTags, setMaterialTags] = useState<Set<SlotKey>>(new Set());

  const titleRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLSelectElement>(null);
  const freightRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !sku) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setSlots(null);
    void (async () => {
      try {
        const [res, slotsRes] = await Promise.all([
          embedFetch(`/api/ecommerce/portal-product?sku=${encodeURIComponent(sku)}`),
          getProduct3dSlots(sku),
        ]);
        const json = (await res.json()) as
          | { ok: true; detail: PortalProductDetail }
          | { ok: false; error: string };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(
            !json.ok
              ? json.error
              : `Failed to load ${sku} detail: HTTP ${res.status}`,
          );
          setLoading(false);
          return;
        }
        setDetail(json.detail);
        setTitle(json.detail.storefrontTitle);
        setDescription(json.detail.description);
        setAluminumMsrp(
          json.detail.aluminumMsrpValue != null
            ? String(json.detail.aluminumMsrpValue)
            : json.detail.aluminumMsrp?.replace(/[^0-9.]/g, "") ?? "",
        );
        setSurfaceProfile(json.detail.surfaceProfile);
        setPreserveWp(json.detail.preserveWpGallery);
        setWeightLb(json.detail.freight.weightLb);
        setLengthIn(json.detail.freight.lengthIn);
        setWidthIn(json.detail.freight.widthIn);
        setHeightIn(json.detail.freight.heightIn);
        if (slotsRes.ok) {
          setSlots(slotsRes.slots);
          const mapped = new Set<SlotKey>();
          for (const m of slotsRes.slots.materialSlots) {
            if (m.slot === "frame_metal" || m.slot === "frame_finish") mapped.add("frame_finish");
            if (m.slot === "cushion_fabric") mapped.add("cushion_fabric");
            if (m.slot === "stone_top" || m.slot === "table_top") mapped.add("table_top");
            if (m.slot === "accent_pillow" || m.slot === "accent_accents") {
              mapped.add("accent_accents");
            }
          }
          setMaterialTags(mapped);
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(
          `Failed to load ${sku} detail: ${err instanceof Error ? err.message : "network error"}`,
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sku, embedFetch]);

  useEffect(() => {
    if (!open || loading || !detail) return;
    const t = window.setTimeout(() => {
      if (focusSection === "title") titleRef.current?.focus();
      if (focusSection === "surface") surfaceRef.current?.focus();
      if (focusSection === "freight") freightRef.current?.scrollIntoView({ block: "center" });
      if (focusSection === "media") mediaRef.current?.scrollIntoView({ block: "center" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [open, loading, detail, focusSection]);

  if (!open) return null;

  const dimsBadge = freightDimsBadge({
    weightLb,
    lengthIn,
    widthIn,
    heightIn,
  });

  const hasVariations = (detail?.childSkus?.length ?? 0) > 0;

  async function handleSave() {
    if (!detail) return;
    setSaving(true);
    const res = await savePortalProductDetail({
      listingId: detail.listingId,
      parentSku: detail.parentSku,
      storefrontTitle: title,
      description,
      aluminumMsrp: aluminumMsrp || null,
      surfaceProfile,
      preserveWpGallery: preserveWp,
      freight: { weightLb, lengthIn, widthIn, heightIn },
    });
    if (res.ok) {
      const slotAlias: Record<SlotKey, string> = {
        frame_finish: "frame_finish",
        cushion_fabric: "cushion_fabric",
        table_top: "table_top",
        accent_accents: "accent_accents",
      };
      await saveProduct3dMaterialSlots(
        detail.parentSku,
        MATERIAL_SLOTS.filter((t) => materialTags.has(t.key)).map((t) => ({
          slot: slotAlias[t.key] as
            | "frame_finish"
            | "cushion_fabric"
            | "table_top"
            | "accent_accents",
          mesh_name: null,
        })),
      );
    }
    setSaving(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast("Product details saved");
    onSaved?.();
  }

  async function uploadMedia(kind: "photo" | "glb" | "usdz", file: File) {
    if (!detail) return;
    setUploadBusy(kind);
    const res = await uploadEmbedAsset({
      embedToken,
      kind: "product_3d",
      slot: kind === "photo" ? "poster" : kind,
      wooSku: detail.parentSku,
      file,
    });
    setUploadBusy(null);
    onToast(
      res.ok
        ? `${kind === "photo" ? "Photo" : `.${kind}`} uploaded`
        : res.error,
    );
    if (res.ok) {
      const refreshed = await getProduct3dSlots(detail.parentSku);
      if (refreshed.ok) setSlots(refreshed.slots);
    }
  }

  const inputClass =
    "mt-0.5 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none";
  const optionClass = "bg-slate-900 text-slate-100";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="portal-product-drawer">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-[#0b0f17] text-slate-100 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 bg-[#111827] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-400/90">
              Edit Details · 3D &amp; Gallery Studio
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-white">
              {detail?.storefrontTitle || sku}
            </h2>
            <p className="mt-1 whitespace-nowrap font-mono text-[11px] text-amber-300/90">{sku}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-24">
          {loading ? (
            <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              Loading product…
            </div>
          ) : null}
          {error ? (
            <p
              className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300"
              data-testid="portal-drawer-error"
            >
              {error}
            </p>
          ) : null}
          {detail ? (
            <div className="space-y-5">
              <section className="rounded-xl border border-white/10 bg-[#111827] p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Read-Only Locked SKUs
                </h3>
                <div className="mt-2 space-y-1.5">
                  <p className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-amber-300">
                    <Lock className="h-3 w-3" />
                    Parent: {detail.parentSku}
                  </p>
                  {hasVariations
                    ? detail.childSkus.map((c) => (
                        <p
                          key={c}
                          className="whitespace-nowrap font-mono text-[11px] text-slate-400"
                        >
                          Variation: {c}
                        </p>
                      ))
                    : (
                      <p className="text-[11px] text-slate-500">
                        Simple item — no -LS / -RS variations
                      </p>
                    )}
                </div>
              </section>

              {detail.spotCheckNote ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {detail.spotCheckNote}
                </p>
              ) : null}

              <section>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Storefront Display Title
                  <input
                    ref={titleRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    data-testid="portal-drawer-title"
                    className={inputClass}
                  />
                </label>
                <p className="mt-1 text-[10px] text-slate-500">
                  Factory name: {detail.factoryName}
                  {" · "}Preserve acronyms BH / SH / OD / LED
                </p>
              </section>

              <section>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Description / Copy
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    data-testid="portal-drawer-description"
                    className={inputClass}
                  />
                </label>
              </section>

              <section>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Aluminum Storefront MSRP
                  <input
                    value={aluminumMsrp}
                    onChange={(e) => setAluminumMsrp(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    data-testid="portal-drawer-alu-msrp"
                    className={inputClass}
                  />
                </label>
              </section>

              <section>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Surface Profile
                  <select
                    ref={surfaceRef}
                    value={surfaceProfile}
                    onChange={(e) => setSurfaceProfile(e.target.value as SurfaceProfile)}
                    data-testid="portal-drawer-surface-profile"
                    className={inputClass}
                  >
                    {SURFACE_PROFILE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt} className={optionClass}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section
                ref={freightRef}
                className="rounded-xl border border-white/10 bg-[#111827] p-4"
                data-testid="portal-drawer-freight"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Freight Packaging
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      dimsBadge === "Ready"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-200"
                    }`}
                    data-testid="portal-drawer-freight-badge"
                  >
                    {dimsBadge}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-[10px] font-semibold uppercase text-slate-500">
                    Weight lbs
                    <input
                      value={weightLb}
                      onChange={(e) => setWeightLb(e.target.value)}
                      className={inputClass}
                      data-testid="portal-drawer-weight"
                    />
                  </label>
                  <label className="text-[10px] font-semibold uppercase text-slate-500">
                    Length in
                    <input
                      value={lengthIn}
                      onChange={(e) => setLengthIn(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-[10px] font-semibold uppercase text-slate-500">
                    Width in
                    <input
                      value={widthIn}
                      onChange={(e) => setWidthIn(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-[10px] font-semibold uppercase text-slate-500">
                    Height in
                    <input
                      value={heightIn}
                      onChange={(e) => setHeightIn(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-[#111827] p-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">Legacy SKU</p>
                  <p className="mt-1 whitespace-nowrap font-mono text-xs text-slate-200">
                    {(detail as { legacySku?: string | null }).legacySku ?? "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#111827] p-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                    Factory Approved
                  </p>
                  <p className="mt-1 text-xs text-slate-200">
                    {(detail as { factoryApproved?: boolean }).factoryApproved
                      ? "Yes"
                      : "Pending"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#111827] p-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                    View on Staging
                  </p>
                  {(detail as { stagingUrl?: string | null }).stagingUrl ? (
                    <a
                      href={(detail as { stagingUrl?: string }).stagingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs font-semibold text-sky-300 hover:underline"
                    >
                      Open staging →
                    </a>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Not linked</p>
                  )}
                </div>
              </section>

              <section
                ref={mediaRef}
                className="rounded-xl border border-white/10 bg-[#111827] p-4"
                data-testid="portal-drawer-3d-studio"
              >
                <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <UploadCloud className="h-3.5 w-3.5" />
                  3D &amp; Gallery Studio
                </h3>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-500">GLB</dt>
                    <dd className="truncate text-slate-200">{slots?.glbUrl ? "Ready" : "Missing"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">USDZ</dt>
                    <dd className="truncate text-slate-200">
                      {slots?.usdzUrl ? "Ready" : "Missing"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">SHA-256</dt>
                    <dd className="truncate font-mono text-slate-200">
                      {(slots as { sha256?: string | null } | null)?.sha256 ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Size</dt>
                    <dd className="text-slate-200">
                      {slots?.fileSize != null ? `${Math.round(slots.fileSize / 1024)} KB` : "—"}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Material Slots
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {MATERIAL_SLOTS.map((slot) => {
                    const on = materialTags.has(slot.key);
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        data-testid={`material-slot-${slot.key}`}
                        onClick={() => {
                          setMaterialTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(slot.key)) next.delete(slot.key);
                            else next.add(slot.key);
                            return next;
                          });
                        }}
                        className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold ring-1 ${
                          on
                            ? "bg-amber-500/20 text-amber-100 ring-amber-400/40"
                            : "bg-white/5 text-slate-400 ring-white/10"
                        }`}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>

                <label className="mt-3 flex items-start gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={preserveWp}
                    onChange={(e) => setPreserveWp(e.target.checked)}
                    data-testid="portal-drawer-preserve-wp"
                    className="mt-0.5"
                  />
                  <span>
                    Preserve WP Gallery Images
                    <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      {preserveWp ? "ON" : "OFF"}
                    </span>
                  </span>
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-400/40">
                    {uploadBusy === "photo" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Gallery Photos
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadMedia("photo", f);
                      }}
                    />
                  </label>
                  <DropButton
                    label="GLB"
                    accept=".glb,model/gltf-binary"
                    busy={uploadBusy === "glb"}
                    disabled={uploadBusy !== null}
                    onFile={(f) => void uploadMedia("glb", f)}
                    testId="portal-drawer-glb"
                  />
                  <DropButton
                    label="USDZ"
                    accept=".usdz"
                    busy={uploadBusy === "usdz"}
                    disabled={uploadBusy !== null}
                    onFile={(f) => void uploadMedia("usdz", f)}
                    testId="portal-drawer-usdz"
                  />
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <footer className="border-t border-white/10 bg-[#111827] px-5 py-3">
          <button
            type="button"
            disabled={!detail || saving}
            onClick={() => void handleSave()}
            data-testid="portal-drawer-save"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Details
          </button>
        </footer>
      </div>
    </div>
  );
}
