"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  Minus,
  Palette,
  Plus,
  Search,
  Shield,
  UploadCloud,
} from "lucide-react";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import {
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
  isFinishSkuLocked,
} from "@/lib/ecommerce-roster";
import {
  PHASE1_PARENT_COUNT,
  PHASE1_PURCHASABLE_SKU_COUNT,
  PHASE1_SIMPLE_COUNT,
  PHASE1_SOW_ITEM_COUNT,
  PHASE1_VARIATION_COUNT,
  reconcileMiaApprovedCounts,
} from "@/server/ecommerce/phase1-portal";
import { needsMiaSpotCheck, STOREFRONT_POLICY_BANNER } from "@/server/ecommerce/two-tab-portal";
import {
  addFinishRowForPortal,
  disableFinishRowForPortal,
  dryRunWooPushForSku,
  getPrimeviewHandoffDownloadUrls,
  getPrimeviewPartnerHandoffLink,
  listFinishAssetsForPortal,
  saveFinishCalibration,
  testWooConnectionAction,
  toggleMiaApproval,
  updateFinishDisplayForPortal,
  type FinishAssetCategory,
  type FinishAssetView,
} from "../actions";
import { DropButton, uploadEmbedAsset } from "./SwatchesFinishesDrawer";
import { Model3dCell, type Phase1Listing } from "./Phase1PortalViews";

type PortalTab = "finishes" | "products" | "sync";
type StatusFilter = "all" | "spot_check" | "approved";

type Props = {
  listings: Phase1Listing[];
  listingsLoading: boolean;
  listingsError: string | null;
  miaApprovedCount: number;
  sowItemCount: number;
  parentCount?: number;
  variationCount?: number;
  simpleCount?: number;
  purchasableSkuCount?: number;
  canFullCatalog: boolean;
  wooBadgeLabel: string | null;
  wooConfigured: boolean;
  systemHealth: "Healthy" | "Attention Needed" | null;
  onOpenSystemHealth: () => void;
  onToast: (msg: string) => void;
  onListingsChange: (next: Phase1Listing[]) => void;
  onOpenProductEdit: (listing: Phase1Listing) => void;
  onOpen3d: (sku: string, name: string) => void;
};

const FAMILY_GROUPS = [
  {
    key: "sunbrella" as const,
    title: "Sunbrella Fabrics",
    count: 16,
    category: "fabric" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "sunbrella").map((f) => f.sku),
  },
  {
    key: "ultraleather" as const,
    title: "Ultraleather",
    count: 4,
    category: "fabric" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "ultraleather").map((f) => f.sku),
  },
  {
    key: "dekton" as const,
    title: "Dekton Stones",
    count: 6,
    category: "dekton" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "dekton").map((f) => f.sku),
  },
  {
    key: "powder" as const,
    title: "Aluminum Frame Powder Coats",
    count: 6,
    category: "powder" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder").map((f) => f.sku),
    policyBadge: true,
  },
];

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
    active
      ? "border-amber-400 bg-amber-500 text-slate-950"
      : "border-white/15 bg-white/5 text-slate-300 hover:border-amber-400/50"
  }`;
}

function DarkFinishRow({
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
  const [displayName, setDisplayName] = useState(asset.displayName);
  const [repeatW, setRepeatW] = useState(asset.patternRepeatWIn?.toString() ?? "");
  const [repeatH, setRepeatH] = useState(asset.patternRepeatHIn?.toString() ?? "");
  const [textureScale, setTextureScale] = useState(
    asset.patternRepeatWIn?.toString() ?? asset.sampleWidthIn?.toString() ?? "",
  );
  const [busy, setBusy] = useState<"thumb" | "texture_2k" | null>(null);
  const [progress, setProgress] = useState<Partial<Record<"thumb" | "texture_2k", number>>>({});
  const [saving, setSaving] = useState(false);
  const skuLocked = isFinishSkuLocked(asset.sku);

  useEffect(() => {
    setDisplayName(asset.displayName);
    setRepeatW(asset.patternRepeatWIn?.toString() ?? "");
    setRepeatH(asset.patternRepeatHIn?.toString() ?? "");
    setTextureScale(asset.patternRepeatWIn?.toString() ?? asset.sampleWidthIn?.toString() ?? "");
  }, [asset]);

  async function upload(slot: "thumb" | "texture_2k", file: File) {
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
      onToast(res.error);
      return;
    }
    onToast(`${asset.sku}: ${slot === "thumb" ? "swatch" : "2048px texture"} uploaded`);
    onChanged();
  }

  async function save() {
    setSaving(true);
    if (displayName.trim() && displayName.trim() !== asset.displayName) {
      const renamed = await updateFinishDisplayForPortal(asset.sku, {
        displayName: displayName.trim(),
      });
      if (!renamed.ok) {
        setSaving(false);
        onToast(renamed.error);
        return;
      }
    }
    const parse = (v: string) => {
      const t = v.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const scale = parse(textureScale);
    const res = await saveFinishCalibration(asset.sku, {
      sample_width_in: scale,
      sample_height_in: scale,
      pattern_repeat_w_in: parse(repeatW) ?? scale,
      pattern_repeat_h_in: parse(repeatH) ?? scale,
    });
    setSaving(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`${asset.sku} saved`);
    onChanged();
  }

  return (
    <tr className="border-t border-white/5" data-testid={`finish-row-${asset.sku}`}>
      <td className="px-3 py-2.5">
        {asset.swatchThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.swatchThumbUrl}
            alt={asset.displayName}
            className="h-10 w-10 rounded-lg border border-white/10 object-cover"
          />
        ) : (
          <span
            className="block h-10 w-10 rounded-lg border border-white/10"
            style={{ backgroundColor: asset.hexCode ?? "#334155" }}
          />
        )}
      </td>
      <td className="px-3 py-2.5">
        {asset.qualityStatus === "photoshoot_verified" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            2048px Ready
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
            Needs 2048px
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span
          className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-amber-300"
          data-testid={`finish-sku-locked-${asset.sku}`}
          title="System-generated SKU — locked"
        >
          {skuLocked ? <Lock className="h-3 w-3 text-amber-400/70" /> : null}
          <input
            readOnly
            value={asset.sku}
            aria-readonly="true"
            className="w-32 cursor-not-allowed rounded border border-white/10 bg-[#0b0f17] px-1.5 py-0.5 font-mono text-[11px] text-amber-300"
          />
        </span>
      </td>
      <td className="px-3 py-2.5">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => void save()}
          data-testid={`finish-display-${asset.sku}`}
          className="w-full min-w-[8rem] rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100"
        />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <input
            inputMode="decimal"
            value={repeatW}
            onChange={(e) => setRepeatW(e.target.value)}
            onBlur={() => void save()}
            placeholder="W"
            className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-[11px] text-slate-100"
            data-testid={`cal-patternRepeatWIn-${asset.sku}`}
          />
          <span className="text-slate-600">×</span>
          <input
            inputMode="decimal"
            value={repeatH}
            onChange={(e) => setRepeatH(e.target.value)}
            onBlur={() => void save()}
            placeholder="H"
            className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-[11px] text-slate-100"
            data-testid={`cal-patternRepeatHIn-${asset.sku}`}
          />
        </div>
      </td>
      <td className="px-3 py-2.5">
        <input
          inputMode="decimal"
          value={textureScale}
          onChange={(e) => setTextureScale(e.target.value)}
          onBlur={() => void save()}
          placeholder="Scale"
          title="Texture Scale (in) for Yardi 3D plugin"
          className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-[11px] text-slate-100"
          data-testid={`cal-textureScale-${asset.sku}`}
        />
      </td>
      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">
        {asset.finishCategory === "fabric"
          ? "fabric_sku"
          : asset.finishCategory === "powder"
            ? "powder_coat"
            : "dekton"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex min-w-[10rem] flex-col gap-1">
          <DropButton
            label="Swatch"
            accept={IMAGE_ACCEPT}
            busy={busy === "thumb"}
            disabled={busy !== null || saving}
            progress={progress.thumb}
            onFile={(f) => void upload("thumb", f)}
            testId={`upload-thumb-${asset.sku}`}
          />
          <DropButton
            label="2048px Texture"
            accept={IMAGE_ACCEPT}
            busy={busy === "texture_2k"}
            disabled={busy !== null || saving}
            progress={progress.texture_2k}
            onFile={(f) => void upload("texture_2k", f)}
            testId={`upload-texture-${asset.sku}`}
          />
        </div>
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          data-testid={`finish-row-remove-${asset.sku}`}
          title="Soft-disable from e-commerce roster"
          onClick={() => onRemove(asset.sku)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function GlbUploadZone({
  listings,
  embedToken,
  onToast,
}: {
  listings: Phase1Listing[];
  embedToken: string | null;
  onToast: (msg: string) => void;
}) {
  const [wooSku, setWooSku] = useState(listings[0]?.wooSku || listings[0]?.globalSku || "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!wooSku && listings[0]) {
      setWooSku(listings[0].wooSku || listings[0].globalSku);
    }
  }, [listings, wooSku]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="glb-upload-zone">
      <label className="min-w-[14rem] flex-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Woo / Hub SKU
        <input
          value={wooSku}
          onChange={(e) => setWooSku(e.target.value)}
          list="portal-glb-sku-options"
          className="mt-0.5 block w-full rounded border border-white/10 bg-[#0b0f17] px-2 py-1.5 font-mono text-xs text-slate-100"
        />
        <datalist id="portal-glb-sku-options">
          {listings.slice(0, 120).map((l) => (
            <option key={l.id} value={l.wooSku || l.globalSku}>
              {l.productName}
            </option>
          ))}
        </datalist>
      </label>
      <div className="min-w-[12rem] flex-1">
        <DropButton
          label="Upload .glb"
          accept=".glb,model/gltf-binary"
          busy={busy}
          disabled={!wooSku.trim() || busy}
          progress={progress}
          testId="glb-upload-btn"
          onFile={async (file) => {
            setBusy(true);
            setProgress(0);
            const res = await uploadEmbedAsset({
              embedToken,
              kind: "product_3d",
              slot: "glb",
              wooSku: wooSku.trim(),
              file,
              onProgress: (pct) => setProgress(pct),
            });
            setBusy(false);
            setProgress(null);
            onToast(res.ok ? `.glb uploaded for ${wooSku.trim()}` : res.error);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Unified dark E-Commerce Certification & Handoff Portal —
 * default surface for `/embed/admin/master-catalog` (GHL tab).
 */
export default function EcommerceCertificationPortal({
  listings,
  listingsLoading,
  listingsError,
  miaApprovedCount,
  sowItemCount,
  parentCount = PHASE1_PARENT_COUNT,
  variationCount = PHASE1_VARIATION_COUNT,
  simpleCount = PHASE1_SIMPLE_COUNT,
  purchasableSkuCount = PHASE1_PURCHASABLE_SKU_COUNT,
  canFullCatalog,
  wooBadgeLabel,
  wooConfigured,
  systemHealth,
  onOpenSystemHealth,
  onToast,
  onListingsChange,
  onOpenProductEdit,
  onOpen3d,
}: Props) {
  const { embedToken } = useEmbedSession();
  const [tab, setTab] = useState<PortalTab>("finishes");
  const [assets, setAssets] = useState<FinishAssetView[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [addName, setAddName] = useState<Partial<Record<FinishAssetCategory, string>>>({});
  const [adding, setAdding] = useState<FinishAssetCategory | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [downloadUrls, setDownloadUrls] = useState<{
    csv: string;
    spec: string;
    swatches: string;
    finishes: string;
  } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("https://hub.ccpatio.com/api/webhooks/woocommerce");
  const [dryRunJson, setDryRunJson] = useState<string | null>(null);

  const reconciled = useMemo(
    () => reconcileMiaApprovedCounts(listings),
    [listings],
  );
  const approvedShown = listings.length ? reconciled.miaApprovedCount : miaApprovedCount;
  const sowShown = listings.length ? reconciled.sowItemCount : sowItemCount || PHASE1_SOW_ITEM_COUNT;

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    const res = await listFinishAssetsForPortal();
    if (res.ok) {
      setAssets(res.assets);
      setAssetsError(null);
    } else {
      setAssetsError(res.error);
    }
    setAssetsLoading(false);
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    void getPrimeviewHandoffDownloadUrls().then((res) => {
      if (!res.ok) return;
      setDownloadUrls({
        csv: res.csv,
        spec: res.spec,
        swatches: res.swatches,
        finishes: res.finishes ?? res.swatches,
      });
    });
  }, []);

  const collections = useMemo(
    () => [...new Set(listings.map((l) => l.collectionLabel).filter(Boolean))].sort(),
    [listings],
  );

  const productRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return listings
      .filter((l) => {
        if (collection && l.collectionLabel !== collection) return false;
        if (statusFilter === "approved" && !l.miaApproved) return false;
        if (
          statusFilter === "spot_check" &&
          !needsMiaSpotCheck({
            globalSku: l.globalSku,
            attributes: l.attributes,
            wooSku: l.wooSku,
          })
        ) {
          return false;
        }
        if (!q) return true;
        return (
          l.productName.toLowerCase().includes(q) ||
          l.globalSku.toLowerCase().includes(q) ||
          (l.wooSku ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.sheetOrder - b.sheetOrder || a.globalSku.localeCompare(b.globalSku));
  }, [listings, search, collection, statusFilter]);

  async function handleAdd(category: FinishAssetCategory) {
    const name = (addName[category] ?? "").trim();
    if (!name) {
      onToast("Enter a display name before adding a finish.");
      return;
    }
    setAdding(category);
    const res = await addFinishRowForPortal({ category, displayName: name });
    setAdding(null);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    setAddName((prev) => ({ ...prev, [category]: "" }));
    onToast(`Added ${res.asset.sku} (SKU locked)`);
    await loadAssets();
  }

  async function handleRemove(sku: string) {
    const res = await disableFinishRowForPortal(sku);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`Removed ${sku} from e-commerce roster`);
    await loadAssets();
  }

  return (
    <div
      className="min-h-screen bg-[#0b0f17] text-slate-100"
      data-testid="ecommerce-certification-portal"
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <header className="border-b border-white/10 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
                CC PATIO · E-COMMERCE SINGLE SOURCE OF TRUTH
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                E-Commerce Certification &amp; Handoff Portal
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Exact {ECOMMERCE_32_FINISH_COUNT} storefront finishes · locked system SKUs · Mia / Kian /
                Superadmin certification lane for GHL.
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/20">
                <Shield className="h-3.5 w-3.5" />
                Mia · Kian · Superadmin
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30"
                data-testid="mia-approved-pill"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mia Approved {approvedShown} / {sowShown}
              </span>
              <button
                type="button"
                data-testid="system-health-pill"
                onClick={onOpenSystemHealth}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                  systemHealth === "Attention Needed"
                    ? "bg-amber-500/15 text-amber-200 ring-amber-500/30"
                    : "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                System Health · {systemHealth ?? "…"}
              </button>
              {canFullCatalog ? (
                <>
                  <a
                    href="/embed/admin/master-catalog?view=legacy-admin"
                    data-testid="superadmin-raw-catalog-link"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-amber-400/40 hover:text-amber-200"
                  >
                    Raw Catalog Grid →
                  </a>
                  <a
                    href="/admin/mission-control"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="superadmin-mission-control-link"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-amber-400/40 hover:text-amber-200"
                  >
                    Mission Control →
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="portal-kpi-cards">
            {(
              [
                ["Parents", parentCount],
                ["Variations", variationCount],
                ["Simple", simpleCount],
                ["Purchasable SKUs", purchasableSkuCount],
                ["Active Finishes", ECOMMERCE_32_FINISH_COUNT],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-lg bg-[#111827] px-3 py-2 ring-1 ring-white/10">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="text-lg font-semibold text-white">{n}</dd>
              </div>
            ))}
          </dl>
        </header>

        <nav className="mt-6 flex flex-wrap gap-2" role="tablist" data-testid="portal-pill-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "finishes"}
            data-testid="portal-tab-finishes"
            onClick={() => setTab("finishes")}
            className={chip(tab === "finishes")}
          >
            <span className="inline-flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" />
              {ECOMMERCE_32_FINISH_COUNT} Finishes &amp; Swatches
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "products"}
            data-testid="portal-tab-products"
            onClick={() => setTab("products")}
            className={chip(tab === "products")}
          >
            {PHASE1_PURCHASABLE_SKU_COUNT} E-Commerce Products
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sync"}
            data-testid="portal-tab-sync"
            onClick={() => setTab("sync")}
            className={chip(tab === "sync")}
          >
            PrimeView Sync &amp; Downloads
          </button>
        </nav>

        {tab === "finishes" ? (
          <div className="mt-6 space-y-6" data-testid="portal-panel-finishes">
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              {STOREFRONT_POLICY_BANNER}
              <span className="mt-1 block text-amber-200/80">
                Aluminum-Only Storefront Policy — Steel/+10% Excluded from web export.
              </span>
            </p>
            {assetsError ? (
              <p className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">{assetsError}</p>
            ) : null}
            {assetsLoading && assets.length === 0 ? (
              <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading finishes…
              </div>
            ) : (
              FAMILY_GROUPS.map((group) => {
                const rosterSkus = new Set(group.skus());
                const rows = assets.filter(
                  (a) => a.finishCategory === group.category && rosterSkus.has(a.sku),
                );
                const fallbackRows =
                  rows.length > 0
                    ? rows
                    : assets.filter((a) => {
                        const def = ECOMMERCE_32_FINISHES.find((f) => f.sku === a.sku);
                        return def?.family === group.key;
                      });
                const shown = fallbackRows.length ? fallbackRows : rows;
                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]"
                    data-testid={`finish-group-${group.key}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          {group.title}{" "}
                          <span className="text-slate-400">({group.count})</span>
                        </h2>
                        {group.policyBadge ? (
                          <p className="mt-1 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                            Aluminum-Only Storefront Policy — Steel/+10% Excluded
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-end gap-2" data-testid={`finish-add-${group.category}`}>
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Display name
                          <input
                            value={addName[group.category] ?? ""}
                            onChange={(e) =>
                              setAddName((prev) => ({
                                ...prev,
                                [group.category]: e.target.value,
                              }))
                            }
                            placeholder="e.g. Canvas Ivory"
                            className="mt-0.5 block w-44 rounded border border-white/10 bg-[#0b0f17] px-2 py-1.5 text-[12px] font-medium normal-case text-slate-100"
                          />
                        </label>
                        <button
                          type="button"
                          data-testid={`finish-add-btn-${group.category}`}
                          disabled={adding === group.category}
                          onClick={() => void handleAdd(group.category)}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 disabled:opacity-50"
                        >
                          {adding === group.category ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                          + Add Finish
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Swatch</th>
                            <th className="px-3 py-2">2048px</th>
                            <th className="px-3 py-2">Canonical SKU</th>
                            <th className="px-3 py-2">Display Name</th>
                            <th className="px-3 py-2">Pattern Repeat (in)</th>
                            <th className="px-3 py-2">Texture Scale</th>
                            <th className="px-3 py-2">Woo / APF</th>
                            <th className="px-3 py-2">Upload</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {shown.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                                No active rows — use + Add Finish (SKU auto-locks).
                              </td>
                            </tr>
                          ) : (
                            shown.map((a) => (
                              <DarkFinishRow
                                key={a.sku}
                                asset={a}
                                embedToken={embedToken}
                                onChanged={() => void loadAssets()}
                                onToast={onToast}
                                onRemove={(sku) => void handleRemove(sku)}
                              />
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })
            )}
          </div>
        ) : null}

        {tab === "products" ? (
          <div className="mt-6 space-y-4" data-testid="portal-panel-products">
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#111827] p-4">
              <div className="relative max-w-xl" data-testid="portal-product-search">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products or FIN-* SKU…"
                  className="w-full rounded-xl border border-white/10 bg-[#0b0f17] py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-600"
                  data-testid="portal-search-input"
                />
              </div>
              <div className="flex flex-wrap gap-2" data-testid="portal-collection-pills">
                <button
                  type="button"
                  onClick={() => setCollection("")}
                  className={chip(!collection)}
                >
                  All collections
                </button>
                {collections.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCollection(c)}
                    className={chip(collection === c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" data-testid="portal-status-filters">
                {(
                  [
                    ["all", "All"],
                    ["spot_check", "Needs Mia Spot-Check"],
                    ["approved", "Mia Approved"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`portal-status-${key}`}
                    onClick={() => setStatusFilter(key)}
                    className={chip(statusFilter === key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {listingsError ? (
              <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{listingsError}</p>
            ) : listingsLoading && listings.length === 0 ? (
              <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111827]">
                <table className="min-w-full text-left text-sm" data-testid="portal-products-table">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">Product Name</th>
                      <th className="px-3 py-2.5">Canonical Hub SKU</th>
                      <th className="px-3 py-2.5">Variations / Facing</th>
                      <th className="px-3 py-2.5">Aluminum MSRP</th>
                      <th className="px-3 py-2.5">Media / 3D</th>
                      <th className="px-3 py-2.5">Mia Approved</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((row) => {
                      const facing =
                        /-(LS|RS)$/i.test(row.globalSku) || /-(LS|RS)$/i.test(row.wooSku ?? "")
                          ? row.globalSku.match(/-(LS|RS)$/i)?.[1]?.toUpperCase() ?? "—"
                          : "—";
                      return (
                        <tr key={row.id} className="border-t border-white/5 text-slate-200">
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-white">{row.productName}</div>
                            <div className="text-[11px] text-slate-500">{row.collectionLabel}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-amber-300">
                              <Lock className="h-3 w-3 text-amber-400/60" />
                              {row.globalSku}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-400">
                            {row.wooSku && row.wooSku !== row.globalSku ? row.wooSku : "1"}
                            {facing !== "—" ? ` · ${facing}` : ""}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {row.aluminumMsrp
                              ? row.aluminumMsrp
                              : row.aluminumMsrpValue != null
                                ? `$${row.aluminumMsrpValue.toFixed(2)}`
                                : row.msrpValue != null
                                  ? `$${row.msrpValue.toFixed(2)}`
                                  : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <Model3dCell
                              glbUrl={row.model3dGlbUrl}
                              sku={row.globalSku}
                              onOpen={() => onOpen3d(row.globalSku, row.productName)}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              data-testid={`mia-toggle-${row.globalSku}`}
                              onClick={async () => {
                                const next = !row.miaApproved;
                                const result = await toggleMiaApproval(row.globalSku, next);
                                if (!result.ok) {
                                  onToast(result.error);
                                  return;
                                }
                                onListingsChange(
                                  listings.map((l) =>
                                    l.globalSku === row.globalSku
                                      ? {
                                          ...l,
                                          miaApproved: next,
                                          miaApprovedAt: result.approvedAt,
                                        }
                                      : l,
                                  ),
                                );
                              }}
                              className={
                                row.miaApproved
                                  ? "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30"
                                  : "rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-400 ring-1 ring-white/10"
                              }
                            >
                              {row.miaApproved ? "Mia Approved" : "Approve"}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              data-testid={`edit-details-${row.globalSku}`}
                              onClick={() => onOpenProductEdit(row)}
                              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-amber-400/40"
                            >
                              Edit Details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {tab === "sync" ? (
          <div className="mt-6 space-y-6" data-testid="portal-panel-sync">
            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                1-click artifacts
              </h2>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={downloadUrls?.csv ?? "#"}
                  data-testid="download-woo-csv"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  Download Live WooCommerce CSV
                </a>
                <a
                  href={downloadUrls?.spec ?? "#"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download Live Technical Handoff Spec (.md)
                </a>
                <a
                  href={downloadUrls?.finishes ?? "#"}
                  data-testid="download-finishes-manifest"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download Full 3D Finishes &amp; Swatches Manifest (.json)
                </a>
                <a
                  href={downloadUrls?.swatches ?? "#"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download {ECOMMERCE_32_FINISH_COUNT} Active Finishes Manifest (.json)
                </a>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                WooCommerce staging
              </h2>
              <p className="mt-1 font-mono text-sm text-amber-200/90">ccpatiodev2.primeview.com</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    wooConfigured
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-200"
                  }`}
                >
                  {wooBadgeLabel ?? "Checking Woo…"}
                </span>
                <button
                  type="button"
                  data-testid="test-woo-connection"
                  onClick={async () => {
                    const result = await testWooConnectionAction();
                    onToast(result.ok ? `Connected to ${result.host}` : result.reason);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
                >
                  Test Woo Connection
                </button>
                <button
                  type="button"
                  data-testid="dry-run-payload"
                  onClick={async () => {
                    const sample = listings[0]?.globalSku;
                    if (!sample) {
                      onToast("No Phase 1 rows loaded yet.");
                      return;
                    }
                    const preview = await dryRunWooPushForSku(sample);
                    if (!preview.ok) {
                      onToast(preview.error);
                      return;
                    }
                    setDryRunJson(JSON.stringify(preview.preview, null, 2));
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
                >
                  Dry Run Payload Preview
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const link = await getPrimeviewPartnerHandoffLink();
                    if (!link.ok) {
                      onToast(link.error);
                      return;
                    }
                    window.open(link.url, "_blank", "noopener,noreferrer");
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
                >
                  Open Partner Handoff
                  <ExternalLink className="ml-1 inline h-3 w-3" />
                </button>
              </div>
              {dryRunJson ? (
                <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-[#0b0f17] p-3 text-[11px] text-slate-300 ring-1 ring-white/10">
                  {dryRunJson}
                </pre>
              ) : null}
              <div className="mt-4">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Production webhook URL
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    readOnly
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    data-testid="webhook-url-box"
                    className="flex-1 rounded-xl border border-white/10 bg-[#0b0f17] px-3 py-2 font-mono text-xs text-slate-300"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(webhookUrl);
                      onToast("Webhook URL copied");
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <UploadCloud className="h-4 w-4" />
                Photoshoot / .glb 3D upload
              </h2>
              <p className="mb-3 text-xs text-slate-400">
                Drop a <code className="text-slate-300">.glb</code> for a storefront Woo SKU. Photoshoot
                swatches upload from the Finishes tab; open a product&apos;s Media/3D badge for full slot
                management.
              </p>
              <GlbUploadZone
                listings={listings}
                embedToken={embedToken}
                onToast={onToast}
              />
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
