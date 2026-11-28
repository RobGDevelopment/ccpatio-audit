"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Palette,
  RefreshCw,
  Search,
  ShoppingBag,
} from "lucide-react";
import FullResImageLightbox from "@/app/embed/admin/master-catalog/ecommerce/FullResImageLightbox";
import { formatFinishRepeatScaleLabel } from "@/lib/finish-physical-scale";
import {
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import {
  PHASE1_PARENT_COUNT,
  PHASE1_PURCHASABLE_SKU_COUNT,
  PHASE1_SIMPLE_COUNT,
  PHASE1_SOW_ITEM_COUNT,
  PHASE1_VARIATION_COUNT,
} from "@/server/ecommerce/phase1-portal";
import type {
  PartnerFinishView,
  PartnerProductView,
  PartnerWooProbe,
} from "@/server/ecommerce/primeview-handoff-ssot";
import {
  partnerCopyWooDiagnostic,
  partnerDryRunPayload,
  partnerRetestWooStaging,
} from "./actions";
import ShippingTaxjarConsole from "@/components/shipping/ShippingTaxjarConsole";

type PartnerTab = "finishes" | "products" | "sync";
type FinishSubFilter =
  | "all_active"
  | "sunbrella"
  | "ultraleather"
  | "dekton"
  | "powder"
  | "addons";
type CatalogShapeFilter = "all" | "parents" | "variations" | "simple" | "purchasable";
type ReadinessFilter = "none" | "has_media" | "missing_dims";

type Props = {
  token: string;
  generatedAtUtc: string;
  generatedAtMst: string;
  webhookUrl: string;
  finishes: PartnerFinishView[];
  products: PartnerProductView[];
  finishCount: number;
  parentCount: number;
  variationCount: number;
  simpleCount: number;
  purchasableSkuCount: number;
  miaApprovedCount: number;
  sowItemCount: number;
  miaLatestApprovedAt: string | null;
  powderDedupOk: boolean;
  initialWooProbe: PartnerWooProbe;
  finishesError?: string | null;
  productsError?: string | null;
};

type Artifact =
  | "finishes-json"
  | "finishes-csv"
  | "products-csv"
  | "products-json"
  | "addons-json"
  | "spec";

function downloadHref(artifact: Artifact, token: string) {
  return `/api/partner/primeview-handoff/download?artifact=${artifact}&token=${encodeURIComponent(token)}`;
}

function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
    active
      ? "border-amber-400 bg-amber-500 text-slate-950"
      : "border-white/15 bg-white/5 text-slate-300 hover:border-amber-400/50"
  }`;
}

const STOREFRONT_ADDONS = [
  { title: "Cushion Core/Fill", desc: "Foam density, quick-dry fill, Dacron wrap options." },
  { title: "Accent Pillows", desc: "Lumbar & throw pillow pairings per finish family." },
  { title: "Protective Covers", desc: "All-weather covers matched to product dimensions." },
  { title: "Dekton Tabletop Rules", desc: "Slab size constraints and edge-profile selections." },
  { title: "Umbrella Bases", desc: "Weight & bolt-down base pairings per umbrella SKU." },
] as const;

const FAMILY_GROUPS = [
  {
    key: "sunbrella" as const,
    title: "Sunbrella Fabrics",
    count: 16,
  },
  {
    key: "ultraleather" as const,
    title: "Ultraleather",
    count: 4,
  },
  {
    key: "dekton" as const,
    title: "Dekton Stones",
    count: 6,
  },
  {
    key: "powder" as const,
    title: "Aluminum Frame Powder Coats",
    count: 6,
  },
];

export default function PartnerHandoffClient(props: Props) {
  const [tab, setTab] = useState<PartnerTab>("finishes");
  const [finishSubFilter, setFinishSubFilter] = useState<FinishSubFilter>("all_active");
  const [finishQuery, setFinishQuery] = useState("");
  const [catalogShape, setCatalogShape] = useState<CatalogShapeFilter>("all");
  const [readiness, setReadiness] = useState<ReadinessFilter>("none");
  const [productQuery, setProductQuery] = useState("");
  const [collection, setCollection] = useState<string>("all");
  const [lightboxSku, setLightboxSku] = useState<string | null>(null);
  const [drawerSku, setDrawerSku] = useState<string | null>(null);
  const [wooProbe, setWooProbe] = useState<PartnerWooProbe>(props.initialWooProbe);
  const [probing, setProbing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [syncQuery, setSyncQuery] = useState("");
  const [syncSku, setSyncSku] = useState("");
  const [payloadJson, setPayloadJson] = useState<string | null>(null);
  const [payloadBusy, startPayload] = useTransition();

  const powderCount = props.finishes.filter((f) => f.family === "powder").length;
  const sunbrellaCount = props.finishes.filter((f) => f.family === "sunbrella").length;
  const ultraleatherCount = props.finishes.filter((f) => f.family === "ultraleather").length;
  const dektonCount = props.finishes.filter((f) => f.family === "dekton").length;

  const collections = useMemo(() => {
    const set = new Set(props.products.map((p) => p.collectionLabel).filter(Boolean));
    return ["all", ...[...set].sort()];
  }, [props.products]);

  const filteredFinishes = useMemo(() => {
    const q = finishQuery.trim().toLowerCase();
    return props.finishes.filter((f) => {
      if (finishSubFilter === "addons") return false;
      if (finishSubFilter !== "all_active" && f.family !== finishSubFilter) return false;
      if (!q) return true;
      return (
        f.sku.toLowerCase().includes(q) ||
        f.displayName.toLowerCase().includes(q) ||
        (f.vendorSku ?? "").toLowerCase().includes(q)
      );
    });
  }, [props.finishes, finishSubFilter, finishQuery]);

  const lightboxList = filteredFinishes.length ? filteredFinishes : props.finishes;
  const lightboxAsset = lightboxSku
    ? lightboxList.find((f) => f.sku === lightboxSku) ??
      props.finishes.find((f) => f.sku === lightboxSku) ??
      null
    : null;
  const lightboxIdx = lightboxAsset
    ? lightboxList.findIndex((f) => f.sku === lightboxAsset.sku)
    : -1;

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return props.products.filter((p) => {
      if (collection !== "all" && p.collectionLabel !== collection) return false;
      if (catalogShape === "parents" && !p.isParent) return false;
      if (catalogShape === "variations" && !p.isVariation) return false;
      if (catalogShape === "simple" && !p.isSimple) return false;
      if (catalogShape === "purchasable" && !(p.isSimple || p.isVariation || p.isParent))
        return false;
      if (readiness === "has_media" && !p.hasMedia) return false;
      if (readiness === "missing_dims" && !p.missingFreightDims) return false;
      if (!q) return true;
      return (
        p.wooSku.toLowerCase().includes(q) ||
        p.globalSku.toLowerCase().includes(q) ||
        p.storefrontTitle.toLowerCase().includes(q) ||
        p.collectionLabel.toLowerCase().includes(q)
      );
    });
  }, [props.products, catalogShape, readiness, productQuery, collection]);

  const drawerProduct = drawerSku
    ? props.products.find((p) => p.wooSku === drawerSku || p.globalSku === drawerSku) ?? null
    : null;

  const missingDimsCount = props.products.filter((p) => p.missingFreightDims).length;

  const syncOptions = useMemo(() => {
    const q = syncQuery.trim().toLowerCase();
    const finishOpts = props.finishes.map((f) => ({
      sku: f.sku,
      label: f.displayName,
      kind: "finish" as const,
    }));
    const productOpts = props.products.map((p) => ({
      sku: p.wooSku,
      label: p.storefrontTitle,
      kind: "product" as const,
    }));
    const all = [...productOpts, ...finishOpts];
    if (!q) return all.slice(0, 40);
    return all
      .filter(
        (o) =>
          o.sku.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [props.finishes, props.products, syncQuery]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  async function retestStaging() {
    setProbing(true);
    const res = await partnerRetestWooStaging(props.token);
    setProbing(false);
    if (!res.ok) {
      showToast(res.error);
      return;
    }
    setWooProbe(res.probe);
    showToast(res.probe.state === "ok" ? "Staging REST healthy" : res.probe.reason);
  }

  async function copyDiagnostic() {
    const res = await partnerCopyWooDiagnostic(props.token);
    if (!res.ok) {
      showToast(res.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(res.report);
      showToast("CCP-DIAG-WOO diagnostic copied");
    } catch {
      showToast("Clipboard blocked — open console for report");
      console.info(res.report);
    }
  }

  function loadPayload(sku: string) {
    startPayload(async () => {
      const res = await partnerDryRunPayload(props.token, sku);
      if (!res.ok) {
        showToast(res.error);
        return;
      }
      setPayloadJson(JSON.stringify(res.preview, null, 2));
      setSyncSku(sku);
    });
  }

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      data-testid="partner-handoff-portal"
      data-force-dynamic="true"
    >
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="border-b border-white/10 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
                CC Patio · Certified E-Commerce Handoff &amp; WooCommerce Spec
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                CC Patio × PrimeView Certified Storefront Handoff Portal
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Read-only live SSOT for Yardi on{" "}
                <span className="font-mono text-slate-300">ccpatiodev2.primeview.com</span>.
                Aluminum-Only · Locked Canonical SKUs · No Hub mutations.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="text-[11px] text-slate-500" data-testid="partner-last-synced">
                Last Synced from Hub SSOT (UTC):{" "}
                <span className="font-mono text-slate-300">{props.generatedAtUtc}</span>
                <span className="ml-2 text-slate-600">· {props.generatedAtMst} MST</span>
              </p>
              <button
                type="button"
                data-testid="partner-refresh-live"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-400/50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh Live Data
              </button>
            </div>
          </div>

          {/* Staging telemetry banner */}
          <div
            data-testid="partner-staging-banner"
            data-woo-state={wooProbe.state}
            className={`mt-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
              wooProbe.state === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : "border-rose-500/40 bg-rose-500/10 text-rose-100"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" data-testid="partner-staging-status">
                {wooProbe.state === "ok"
                  ? `ccpatiodev2.primeview.com: Connected · REST API Healthy — Ready for Sync`
                  : wooProbe.reason}
              </p>
              <p className="mt-0.5 text-[11px] opacity-80">
                Live probe · HTTP {wooProbe.httpStatus ?? "—"} · {wooProbe.checkedAt}
              </p>
            </div>
            <button
              type="button"
              data-testid="partner-retest-staging"
              disabled={probing}
              onClick={() => void retestStaging()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/30 disabled:opacity-50"
            >
              {probing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Re-Test Staging REST API
            </button>
            <button
              type="button"
              data-testid="partner-copy-diagnostic"
              onClick={() => void copyDiagnostic()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/30"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Technical Diagnostic Report
            </button>
          </div>

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-amber-200/80">
            Storefront Policy: Aluminum-Only · Locked Canonical SKUs
            {props.powderDedupOk ? " · Powder Coats 6/6 deduped" : ""}
          </p>

          {/* KPI strip */}
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="partner-kpi-cards">
            <button
              type="button"
              data-testid="partner-kpi-finishes"
              onClick={() => {
                setTab("finishes");
                setFinishSubFilter("all_active");
              }}
              className="rounded-lg bg-[#111827] px-3 py-2 text-left ring-1 ring-white/10 hover:ring-amber-400/40"
            >
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Certified Finishes
              </dt>
              <dd className="text-lg font-semibold text-white">
                {props.finishCount || ECOMMERCE_32_FINISH_COUNT}
              </dd>
              <dd className="text-[10px] text-slate-500">
                {powderCount}/6 Powder · {sunbrellaCount} Sunbrella · {ultraleatherCount}{" "}
                Ultraleather · {dektonCount} Dekton
              </dd>
            </button>
            {(
              [
                ["Parents", props.parentCount || PHASE1_PARENT_COUNT, "parents"],
                ["Variations", props.variationCount || PHASE1_VARIATION_COUNT, "variations"],
                ["Simple", props.simpleCount || PHASE1_SIMPLE_COUNT, "simple"],
                [
                  "Purchasable Aluminum SKUs",
                  props.purchasableSkuCount || PHASE1_PURCHASABLE_SKU_COUNT,
                  "purchasable",
                ],
              ] as const
            ).map(([label, n, shape]) => (
              <button
                key={label}
                type="button"
                data-testid={`partner-kpi-${shape}`}
                onClick={() => {
                  setTab("products");
                  setCatalogShape(shape);
                  setReadiness("none");
                }}
                className="rounded-lg bg-[#111827] px-3 py-2 text-left ring-1 ring-white/10 hover:ring-amber-400/40"
              >
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="text-lg font-semibold text-white">{n}</dd>
              </button>
            ))}
            <button
              type="button"
              data-testid="partner-kpi-mia"
              onClick={() => {
                setTab("products");
                setCatalogShape("all");
              }}
              className="rounded-lg bg-[#111827] px-3 py-2 text-left ring-1 ring-white/10 hover:ring-amber-400/40"
            >
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Mia Approved</dt>
              <dd className="text-lg font-semibold text-emerald-300">
                {props.miaApprovedCount} / {props.sowItemCount || PHASE1_SOW_ITEM_COUNT}
              </dd>
            </button>
          </dl>
        </header>

        {toast ? (
          <p
            className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-100"
            data-testid="partner-toast"
          >
            {toast}
          </p>
        ) : null}

        <nav
          className="sticky top-0 z-20 mt-6 flex flex-wrap gap-2 bg-slate-950/95 py-2 backdrop-blur"
          role="tablist"
          data-testid="partner-pill-tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "finishes"}
            data-testid="partner-tab-finishes"
            onClick={() => setTab("finishes")}
            className={chip(tab === "finishes")}
          >
            <span className="inline-flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" />
              Certified Finishes, Swatches &amp; Add-Ons ({props.finishCount || 32} Active)
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "products"}
            data-testid="partner-tab-products"
            onClick={() => setTab("products")}
            className={chip(tab === "products")}
          >
            <span className="inline-flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              Certified Aluminum Products ({props.purchasableSkuCount || 107} SKUs)
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sync"}
            data-testid="partner-tab-sync"
            onClick={() => setTab("sync")}
            className={chip(tab === "sync")}
          >
            <span className="inline-flex items-center gap-1.5">
              <ShoppingBag className="h-3.5 w-3.5" />
              WooCommerce Payloads, ACF Schema &amp; Downloads
            </span>
          </button>
        </nav>

        {/* ───── Tab 1: Finishes ───── */}
        {tab === "finishes" ? (
          <div className="mt-6 space-y-5" data-testid="partner-panel-finishes">
            <div className="flex flex-wrap gap-2" data-testid="partner-finish-subfilters">
              {(
                [
                  ["all_active", `All Active (${props.finishes.length})`],
                  ["sunbrella", `Sunbrella (${sunbrellaCount})`],
                  ["ultraleather", `Ultraleather (${ultraleatherCount})`],
                  ["dekton", `Dekton (${dektonCount})`],
                  ["powder", `Powder Coats (${powderCount})`],
                  ["addons", `Storefront Add-Ons (${STOREFRONT_ADDONS.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`partner-finish-subfilter-${key}`}
                  onClick={() => setFinishSubFilter(key)}
                  className={chip(finishSubFilter === key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {finishSubFilter !== "addons" ? (
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  value={finishQuery}
                  onChange={(e) => setFinishQuery(e.target.value)}
                  placeholder="Search finish SKU or display name…"
                  data-testid="partner-finish-search"
                  className="w-full rounded-xl border border-white/15 bg-white/5 py-2 pl-8 pr-3 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </div>
            ) : null}

            {props.finishesError ? (
              <p className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">
                {props.finishesError}
              </p>
            ) : null}

            {finishSubFilter === "addons" ? (
              <section
                className="rounded-2xl border border-white/10 bg-[#111827] p-5"
                data-testid="partner-storefront-addons"
              >
                <h2 className="text-sm font-semibold text-white">Certified Storefront Add-Ons</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Read-only matrix for PrimeView storefront configuration.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {STOREFRONT_ADDONS.map((addon) => (
                    <div
                      key={addon.title}
                      className="rounded-xl border border-white/10 bg-slate-900/60 p-4"
                    >
                      <h3 className="text-xs font-semibold text-amber-300">{addon.title}</h3>
                      <p className="mt-1 text-[11px] text-slate-400">{addon.desc}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              FAMILY_GROUPS.filter((g) =>
                finishSubFilter === "all_active" ? true : finishSubFilter === g.key,
              ).map((group) => {
                const rows = filteredFinishes.filter((f) => f.family === group.key);
                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]"
                    data-testid={`partner-finish-group-${group.key}`}
                  >
                    <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <h2 className="text-sm font-semibold text-white">{group.title}</h2>
                      <span
                        className="text-xs text-slate-400"
                        data-testid={`partner-finish-group-count-${group.key}`}
                      >
                        {rows.length} / {group.count}
                      </span>
                    </header>
                    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {rows.map((asset) => (
                        <article
                          key={asset.sku}
                          data-testid={`partner-finish-card-${asset.sku}`}
                          className="rounded-xl border border-white/10 bg-slate-950/60 p-3"
                        >
                          <button
                            type="button"
                            data-testid={`partner-swatch-${asset.sku}`}
                            onClick={() => setLightboxSku(asset.sku)}
                            className="block w-full overflow-hidden rounded-lg border border-white/10"
                          >
                            {asset.swatchThumbUrl || asset.texture2kUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={asset.swatchThumbUrl || asset.texture2kUrl || ""}
                                alt={asset.displayName}
                                className="aspect-square w-full object-cover"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <span
                                className="block aspect-square w-full"
                                style={{ backgroundColor: asset.hexCode ?? "#334155" }}
                              />
                            )}
                          </button>
                          <div className="mt-2 space-y-1">
                            <p className="font-mono text-[11px] font-semibold text-amber-200/90">
                              {asset.sku}
                            </p>
                            <p className="text-sm font-semibold text-white">{asset.displayName}</p>
                            {asset.factorySkuRef ? (
                              <p className="text-[10px] text-slate-500">
                                Factory/mill ref: {asset.factorySkuRef}
                              </p>
                            ) : null}
                            <button
                              type="button"
                              title={`Copy APF slot ${asset.apfSlotKey}`}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(asset.apfSlotKey);
                                  showToast(`Copied ${asset.apfSlotKey}`);
                                } catch {
                                  showToast(asset.apfSlotKey);
                                }
                              }}
                              className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200"
                              data-testid={`partner-apf-${asset.sku}`}
                            >
                              {asset.apfGroup}
                            </button>
                            <p className="text-[10px] text-slate-400">
                              Pattern Repeat:{" "}
                              {asset.patternRepeatWIn != null && asset.patternRepeatHIn != null
                                ? `${asset.patternRepeatWIn}" × ${asset.patternRepeatHIn}"`
                                : "Solid / N/A"}
                              {" · "}
                              Texture Scale: {asset.textureScale}
                            </p>
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {(asset.textureWidthPx ?? 0) >= 2048 &&
                              (asset.textureHeightPx ?? 0) >= 2048 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                  <CheckCircle2 className="h-3 w-3" /> 2048px Ready
                                </span>
                              ) : asset.qualityStatus === "photoshoot_verified" ? (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                  Photoshoot Verified
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                  <AlertTriangle className="h-3 w-3" /> Pending Hi-Res
                                </span>
                              )}
                              {asset.texture2kUrl ? (
                                <a
                                  href={asset.texture2kUrl}
                                  download
                                  className="rounded-lg bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white ring-1 ring-white/15"
                                >
                                  Download 2048px
                                </a>
                              ) : null}
                              {asset.texture2kUrl || asset.swatchThumbUrl ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const url = asset.texture2kUrl || asset.swatchThumbUrl || "";
                                    try {
                                      await navigator.clipboard.writeText(url);
                                      showToast("URL copied");
                                    } catch {
                                      showToast(url);
                                    }
                                  }}
                                  className="rounded-lg bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white ring-1 ring-white/15"
                                >
                                  Copy URL
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        ) : null}

        {/* ───── Tab 2: Products ───── */}
        {tab === "products" ? (
          <div className="mt-6 space-y-4" data-testid="partner-panel-products">
            {props.productsError ? (
              <p className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">
                {props.productsError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Search Title or FIN-* SKU…"
                  data-testid="partner-product-search"
                  className="w-full rounded-xl border border-white/15 bg-white/5 py-2 pl-8 pr-3 text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="partner-product-type-pills">
              {(
                [
                  ["all", "All"],
                  ["parents", `Parents (${props.parentCount || PHASE1_PARENT_COUNT})`],
                  ["variations", `Variations (${props.variationCount || PHASE1_VARIATION_COUNT})`],
                  ["simple", `Simple (${props.simpleCount || PHASE1_SIMPLE_COUNT})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`partner-product-type-${key}`}
                  onClick={() => setCatalogShape(key)}
                  className={chip(catalogShape === key)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                data-testid="partner-readiness-has_media"
                onClick={() =>
                  setReadiness((r) => (r === "has_media" ? "none" : "has_media"))
                }
                className={chip(readiness === "has_media")}
              >
                Has Media / 3D
              </button>
              <button
                type="button"
                data-testid="partner-readiness-missing_dims"
                onClick={() =>
                  setReadiness((r) => (r === "missing_dims" ? "none" : "missing_dims"))
                }
                className={chip(readiness === "missing_dims")}
              >
                Missing Freight Dims ({missingDimsCount})
              </button>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="partner-collection-pills">
              {collections.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCollection(c)}
                  className={chip(collection === c)}
                >
                  {c === "all" ? "All Collections" : c}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111827]">
              <table className="min-w-full text-left text-sm" data-testid="partner-products-table">
                <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Hero</th>
                    <th className="px-3 py-2.5">SKU / Title</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">MSRP</th>
                    <th className="px-3 py-2.5">Surface</th>
                    <th className="px-3 py-2.5">Freight</th>
                    <th className="px-3 py-2.5">Media</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                        No products match.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((row) => (
                      <tr
                        key={row.id || row.wooSku}
                        data-testid={`partner-product-row-${row.globalSku}`}
                        className="cursor-pointer border-t border-white/5 hover:bg-white/[0.03]"
                        onClick={() => setDrawerSku(row.wooSku)}
                      >
                        <td className="px-3 py-2">
                          {row.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.imageUrl}
                              alt=""
                              className="h-10 w-10 rounded-md object-cover"
                            />
                          ) : (
                            <span className="grid h-10 w-10 place-items-center rounded-md bg-slate-800 text-[10px] text-slate-500">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-mono text-[11px] text-amber-200/90">{row.wooSku}</p>
                          <p className="font-semibold text-white">{row.storefrontTitle}</p>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                            {row.typeBadge}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-200">
                          {row.aluminumMsrp ?? row.msrp}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">{row.surfaceProfile}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {row.weightLb ? `${row.weightLb} lbs` : "—"}
                          {row.lengthIn || row.widthIn || row.heightIn
                            ? ` · ${row.lengthIn ?? "—"}×${row.widthIn ?? "—"}×${row.heightIn ?? "—"} in`
                            : ""}
                          {row.missingFreightDims ? (
                            <span className="ml-1 text-amber-300">Missing</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {row.imageUrl ? (
                              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-200">
                                Photos
                              </span>
                            ) : null}
                            {row.productVideoUrl ? (
                              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-200">
                                MP4 Video
                              </span>
                            ) : null}
                            {row.model3dGlbUrl ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
                                3D .glb
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ───── Tab 3: Sync / Downloads ───── */}
        {tab === "sync" ? (
          <div className="mt-6 space-y-6" data-testid="partner-panel-sync">
            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Searchable SKU / Finish Payload Inspector
              </h2>
              <div className="relative mt-3 max-w-lg">
                <input
                  value={syncQuery || syncSku}
                  onChange={(e) => {
                    setSyncQuery(e.target.value);
                    setSyncSku("");
                  }}
                  placeholder="Search any of 107 SKUs or 32 Finishes…"
                  data-testid="partner-sync-sku-combobox"
                  className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                />
                {syncQuery ? (
                  <ul
                    data-testid="partner-sync-sku-list"
                    className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-600 bg-slate-900 py-1 shadow-xl"
                  >
                    {syncOptions.map((o) => (
                      <li key={`${o.kind}-${o.sku}`}>
                        <button
                          type="button"
                          className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-amber-500/15"
                          onClick={() => {
                            setSyncSku(o.sku);
                            setSyncQuery("");
                            loadPayload(o.sku);
                          }}
                        >
                          <span className="font-mono text-[11px] text-amber-300">{o.sku}</span>
                          <span className="text-[10px] text-slate-400">
                            {o.kind} · {o.label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {payloadBusy ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building dry-run payload…
                </p>
              ) : null}
              {payloadJson ? (
                <pre
                  data-testid="partner-payload-json"
                  className="mt-3 max-h-80 overflow-auto rounded-xl bg-[#0b0f17] p-3 text-[11px] text-slate-300 ring-1 ring-white/10"
                >
                  {payloadJson}
                </pre>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  Select a SKU to inspect live WooCommerce REST v3 + ACF schema (
                  <code className="text-slate-400">acf_*_swatches_json</code>,{" "}
                  <code className="text-slate-400">_ccpatio_product_video_url</code>).
                </p>
              )}
            </section>

            <ShippingTaxjarConsole
              partnerToken={props.token}
              testIdPrefix="partner-shipping-taxjar"
              pluginHref={`/api/partner/primeview-handoff/shipping-plugin?token=${encodeURIComponent(props.token)}`}
              skus={(props.products.length
                ? props.products
                : []
              )
                .slice(0, 107)
                .map((p) => ({
                  sku: p.wooSku || p.globalSku,
                  label: p.storefrontTitle || p.productName,
                }))}
            />

            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                1-Click Certified Exports
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <a
                  href={downloadHref("finishes-json", props.token)}
                  data-testid="partner-download-finishes-json"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  Download 32 Certified Finishes (JSON)
                </a>
                <a
                  href={downloadHref("finishes-csv", props.token)}
                  data-testid="partner-download-finishes-csv"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download 32 Certified Finishes (CSV)
                </a>
                <a
                  href={downloadHref("products-csv", props.token)}
                  data-testid="partner-download-products-csv"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download 107 Certified Aluminum Products (WooCommerce CSV)
                </a>
                <a
                  href={downloadHref("products-json", props.token)}
                  data-testid="partner-download-products-json"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download 107 Certified Aluminum Products (REST JSON)
                </a>
                <a
                  href={downloadHref("addons-json", props.token)}
                  data-testid="partner-download-addons-json"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download Storefront Add-Ons &amp; APF Slot Mapping (JSON)
                </a>
                <a
                  href={downloadHref("spec", props.token)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download Technical Handoff Spec (.md)
                </a>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Production webhook:{" "}
                <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-slate-300">
                  {props.webhookUrl}
                </code>
              </p>
              {/* Explicitly no legacy 38-finish download */}
            </section>
          </div>
        ) : null}
      </div>

      {/* Read-only product drawer */}
      {drawerProduct ? (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/60"
          data-testid="partner-product-drawer"
          onClick={() => setDrawerSku(null)}
        >
          <aside
            className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-slate-950 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-amber-200/90">{drawerProduct.wooSku}</p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {drawerProduct.storefrontTitle}
                </h2>
                <p className="mt-1 text-xs text-slate-400">{drawerProduct.typeBadge}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerSku(null)}
                className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-300"
              >
                Close
              </button>
            </div>
            {drawerProduct.marketingDescription ? (
              <p className="mt-4 text-sm text-slate-300">{drawerProduct.marketingDescription}</p>
            ) : null}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-slate-500">Aluminum MSRP</dt>
                <dd className="text-slate-100">
                  {drawerProduct.aluminumMsrp ?? drawerProduct.msrp}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Surface Profile</dt>
                <dd className="text-slate-100">{drawerProduct.surfaceProfile}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Freight</dt>
                <dd className="text-slate-100">
                  {drawerProduct.weightLb ?? "—"} lbs · {drawerProduct.lengthIn ?? "—"}×
                  {drawerProduct.widthIn ?? "—"}×{drawerProduct.heightIn ?? "—"} in
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Mia</dt>
                <dd className="text-slate-100">
                  {drawerProduct.miaApproved ? "Approved" : "Pending"}
                </dd>
              </div>
            </dl>
            {drawerProduct.productVideoUrl ? (
              <video
                className="mt-4 w-full rounded-lg border border-white/10"
                controls
                src={drawerProduct.productVideoUrl}
                data-testid="partner-product-video"
              />
            ) : null}
            {drawerProduct.model3dGlbUrl ? (
              <a
                href={drawerProduct.model3dGlbUrl}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-300"
                target="_blank"
                rel="noreferrer"
              >
                Download .glb <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <button
              type="button"
              className="mt-4 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950"
              onClick={() => {
                setTab("sync");
                loadPayload(drawerProduct.wooSku);
                setDrawerSku(null);
              }}
            >
              Inspect Woo REST JSON
            </button>
          </aside>
        </div>
      ) : null}

      {lightboxAsset ? (
        <FullResImageLightbox
          open
          onClose={() => setLightboxSku(null)}
          sku={lightboxAsset.sku}
          displayName={lightboxAsset.displayName}
          category={lightboxAsset.finishCategory}
          apfGroup={lightboxAsset.apfGroup}
          sourceProvenance={
            lightboxAsset.sourceType === "studio_photo"
              ? `Studio Photo: ${lightboxAsset.sourceFilename ?? "unknown"}`
              : lightboxAsset.sourceType === "synthetic_fallback"
                ? "Synthetic Fallback"
                : "—"
          }
          repeatScale={formatFinishRepeatScaleLabel({
            sku: lightboxAsset.sku,
            textureScale: lightboxAsset.textureScale,
            patternRepeatWIn: lightboxAsset.patternRepeatWIn,
            patternRepeatHIn: lightboxAsset.patternRepeatHIn,
          })}
          sha256={lightboxAsset.textureSha256}
          thumbUrl={lightboxAsset.swatchThumbUrl}
          fullResUrl={lightboxAsset.texture2kUrl}
          hasPrev={lightboxIdx > 0}
          hasNext={lightboxIdx >= 0 && lightboxIdx < lightboxList.length - 1}
          onPrev={() => {
            if (lightboxIdx > 0) setLightboxSku(lightboxList[lightboxIdx - 1]!.sku);
          }}
          onNext={() => {
            if (lightboxIdx >= 0 && lightboxIdx < lightboxList.length - 1) {
              setLightboxSku(lightboxList[lightboxIdx + 1]!.sku);
            }
          }}
        />
      ) : null}

      {/* Hard assertion surface for tests: roster length constants */}
      <span className="hidden" data-testid="partner-roster-constants">
        finishes={ECOMMERCE_32_FINISH_COUNT};products={PHASE1_PURCHASABLE_SKU_COUNT};mia=
        {PHASE1_SOW_ITEM_COUNT};roster={ECOMMERCE_32_FINISHES.length}
      </span>
    </div>
  );
}
