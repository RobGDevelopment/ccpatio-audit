"use client";

import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Database,
  Cloud,
  ShoppingCart,
  ImagePlus,
  Check,
  X,
  PlusCircle,
  Loader2,
  ChevronDown,
  Printer,
  Download,
  Zap,
  Activity,
} from "lucide-react";
import {
  getActiveCatalog,
  getQuarantineQueue,
  getEcommerceRoster,
  getPhase1PortalRows,
  getLiveEcommerceRows,
  getPhase2PortalRows,
  promoteToLiveEcommerce,
  healAndLinkKatana,
  getWooConnectionBadge,
  testWooConnectionAction,
  dryRunWooPushForSku,
  pushSkuToWoo,
  syncApprovedToWoo,
  toggleMiaApproval,
  approveAllVisibleSkus,
  getPrimeviewPartnerHandoffLink,
  getPrimeviewHandoffDownloadUrls,
  recalculateAluminumUpcharge,
  roundHalfCentAluminumPrices,
  roundListingAluminumNearest5,
  updateListingAluminumMsrp,
  exportMiaAluminumPriceListCsv,
  updateListingMsrp,
  updateListingUrl,
  updateListingLegacySku,
  mintHubSkuFromGap,
  updateProductMSRP,
  toggleWebVisibility,
  mintProductFromQuarantine,
  updateListingInDrawer,
  updateHubInDrawer,
  createNewProduct,
  getSystemHealthAction,
  getEcommercePortalAccess,
  type CatalogItem,
  type QuarantineItem,
  type EcommerceListing,
  type EcommerceRoster,
  type Phase1PortalView,
  type WooSyncStatus,
  type FinishAssetView,
} from "./actions";
import type { StackLayerPill } from "@/server/ecommerce/executive-stack-health";
import SystemHealthDrawer from "./ecommerce/SystemHealthDrawer";
import ExecutiveAuthGate from "./ecommerce/ExecutiveAuthGate";
import {
  normalizeLegacySku,
  normalizeProductUrl,
  sharedLegacyPatches,
} from "@/lib/ecommerce-roster";
import { isPhase1StorefrontRow } from "@/server/ecommerce/phase1-portal";
import EcommerceGrid from "./ecommerce/EcommerceGrid";
import NewProductDrawer from "./ecommerce/NewProductDrawer";
import SwatchesFinishesDrawer from "./ecommerce/SwatchesFinishesDrawer";
import EcommerceCertificationPortal from "./ecommerce/EcommerceCertificationPortal";
import Product3dMediaDrawer from "./ecommerce/Product3dMediaDrawer";
import ProductDrawer from "./ecommerce/ProductDrawer";
import PortalProductDrawer from "./ecommerce/PortalProductDrawer";
import {
  Phase1FlatGrid,
  wooDotClass,
  wooTitle,
  type Phase1Listing,
} from "./ecommerce/Phase1PortalViews";
import {
  LiveToolbar,
  Phase2StagingGrid,
  Phase2SubFilterBar,
  type Phase2Listing,
} from "./ecommerce/Phase2PortalViews";
import type { Phase2SubFilter } from "@/server/ecommerce/two-tab-portal";
import {
  isLiveEcommerceRow,
  needsMiaSpotCheck,
  STOREFRONT_POLICY_BANNER,
} from "@/server/ecommerce/two-tab-portal";
import {
  PHASE1_PARENT_COUNT,
  PHASE1_PURCHASABLE_SKU_COUNT,
  PHASE1_SIMPLE_COUNT,
  PHASE1_SOW_ITEM_COUNT,
  PHASE1_VARIATION_COUNT,
  reconcileMiaApprovedCounts,
} from "@/server/ecommerce/phase1-portal";
import { DEFAULT_ALU_UPCHARGE_PCT } from "@/server/ecommerce/alu10-pricing";

function DrawerLoadingShell() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-white/50 backdrop-blur-md rounded-2xl border border-white/40 shadow-sm p-12 gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Loading Roster...</span>
    </div>
  );
}

/** Applies per-listing patches to roster state (no-op while the roster is unloaded). */
function patchListings(
  prev: EcommerceRoster | null,
  patches: (Partial<EcommerceListing> & { id: string })[],
): EcommerceRoster | null {
  if (!prev) return prev;
  const byId = new Map<string, Partial<EcommerceListing>>();
  for (const p of patches) byId.set(p.id, { ...byId.get(p.id), ...p });
  return {
    ...prev,
    listings: prev.listings.map((l) => {
      const p = byId.get(l.id);
      return p ? { ...l, ...p } : l;
    }),
  };
}

/* ───────────────────────── helpers ───────────────────────── */

type ViewMode =
  | "all"
  | "broken"
  | "photos"
  | "ecommerce"
  | "collection"
  | "tier";

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "all", label: "All" },
  { key: "broken", label: "Broken Syncs" },
  { key: "photos", label: "Missing Photos" },
  { key: "ecommerce", label: "E-Commerce" },
  { key: "collection", label: "By Collection" },
  { key: "tier", label: "By Price Tier" },
];

const COLLECTION_NAMES: Record<string, string> = {
  BRV: "Bravada",
  BRK: "Brooklyn",
  OCN: "Ocean",
  MLN: "Milan",
  WFT: "Waterfall",
  DAI: "Daisy",
  TAY: "Taylor",
};

const TIERS = [
  "Under $2,500",
  "$2,500 – $5,000",
  "$5,000 – $10,000",
  "$10,000+",
  "No Price",
];

function parseMsrp(msrp: string): number {
  const n = Number(msrp.replace(/[^0-9.-]+/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function collectionOf(sku: string): string {
  const code = sku.split("-")[1] ?? "";
  return COLLECTION_NAMES[code]
    ? `${COLLECTION_NAMES[code]} Collection`
    : code
      ? `${code} (Other)`
      : "Other";
}

function tierOf(msrp: string): string {
  const n = parseMsrp(msrp);
  if (n <= 0) return "No Price";
  if (n < 2500) return TIERS[0];
  if (n < 5000) return TIERS[1];
  if (n < 10000) return TIERS[2];
  return TIERS[3];
}

function isBroken(i: CatalogItem) {
  return !i.dbSynced || !i.katanaSynced || !i.wooSynced;
}

function csvCell(v: string | number | boolean | null): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/** Permanent high-visibility status pill. */
function StatusPill({
  active,
  title,
  children,
  tone,
}: {
  active: boolean;
  title: string;
  children: React.ReactNode;
  /** Optional 3-light Woo tone override. */
  tone?: WooSyncStatus;
}) {
  const toneClass =
    tone === "synced"
      ? "bg-emerald-100 text-emerald-600"
      : tone === "dirty"
        ? "bg-amber-100 text-amber-700"
        : tone === "error"
          ? "bg-rose-100 text-rose-600"
          : tone === "never"
            ? "bg-slate-100 text-slate-400"
            : active
              ? "bg-emerald-100 text-emerald-600"
              : "bg-slate-100 text-slate-400";
  return (
    <span
      title={tone ? wooTitle(tone) : `${title}: ${active ? "Synced" : "Missing"}`}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${toneClass}`}
    >
      {children}
    </span>
  );
}

export type MasterCatalogClientProps = {
  initialCanAccess?: boolean;
  initialCanFullCatalog?: boolean;
  initialAssets?: FinishAssetView[];
  initialStackLayers?: StackLayerPill[];
};

/* ───────────────────────── page ───────────────────────── */

export default function MasterCatalogClient(props: MasterCatalogClientProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0b0f17] text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
        </div>
      }
    >
      <MasterCatalogAdminInner {...props} />
    </Suspense>
  );
}

function MasterCatalogAdminInner({
  initialCanAccess = true,
  initialCanFullCatalog = false,
  initialAssets,
  initialStackLayers,
}: MasterCatalogClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** 2-tab command center: Live storefront vs Phase 2 staging. */
  const [activeTab, setActiveTab] = useState<"live" | "phase2" | "quarantine">("live");
  const [view, setView] = useState<ViewMode>("ecommerce");
  const [liveSubView, setLiveSubView] = useState<"grouped_parents" | "sheet_grid">(
    "grouped_parents",
  );
  const [phase2Filter, setPhase2Filter] = useState<Phase2SubFilter>("phase2_sow");
  const [phase1View, setPhase1View] = useState<Phase1PortalView>("phase1_parents");
  const [searchQuery, setSearchQuery] = useState("");
  const [liveCollection, setLiveCollection] = useState("");
  const [loading, setLoading] = useState(true);
  const [swatchesOpen, setSwatchesOpen] = useState(false);
  const [portalEditListing, setPortalEditListing] = useState<Phase1Listing | null>(null);
  const [portalDrawerFocus, setPortalDrawerFocus] = useState<
    "freight" | "media" | "surface" | "title" | undefined
  >(undefined);
  const [upchargePct, setUpchargePct] = useState(DEFAULT_ALU_UPCHARGE_PCT);
  const [spotCheckOnly, setSpotCheckOnly] = useState(false);
  const [portalAccess, setPortalAccess] = useState<{
    canAccess: boolean;
    canFullCatalog: boolean;
  }>({
    canAccess: initialCanAccess,
    canFullCatalog: initialCanFullCatalog,
  });

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);

  // E-Commerce roster: loaded once, on first visit to the view
  const [ecommerce, setEcommerce] = useState<EcommerceRoster | null>(null);
  const [phase1Listings, setPhase1Listings] = useState<Phase1Listing[]>([]);
  const [phase2Listings, setPhase2Listings] = useState<Phase2Listing[]>([]);
  const [ecommerceLoading, setEcommerceLoading] = useState(false);
  const [ecommerceError, setEcommerceError] = useState<string | null>(null);
  const [wooBadge, setWooBadge] = useState<{ configured: boolean; label: string } | null>(null);
  const [systemHealth, setSystemHealth] = useState<"Healthy" | "Attention Needed" | null>(null);
  const [healthDrawerOpen, setHealthDrawerOpen] = useState(false);
  const [dryRunJson, setDryRunJson] = useState<string | null>(null);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);

  // Actions hub
  const [menuOpen, setMenuOpen] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Minting modal
  const [modalOpen, setModalOpen] = useState(false);
  const [creatingNewProduct, setCreatingNewProduct] = useState(false);
  const [selectedQuarantine, setSelectedQuarantine] =
    useState<QuarantineItem | null>(null);
  const [collection, setCollection] = useState("BRV");
  const [baseName, setBaseName] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("31");
  const [mintPrice, setMintPrice] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [a, q, badge, health, access] = await Promise.all([
          getActiveCatalog(),
          getQuarantineQueue(),
          getWooConnectionBadge(),
          getSystemHealthAction(),
          getEcommercePortalAccess(),
        ]);
        setCatalog(a);
        setQuarantine(q);
        setWooBadge(badge);
        if (health.ok) setSystemHealth(health.snapshot.overall);
        if (access.ok) {
          setPortalAccess({
            canAccess: access.canAccess,
            canFullCatalog: access.canFullCatalog,
          });
          // Mia / Kian / Rob / embed: lock to E-Commerce tab; Superadmin keeps full catalog toggle.
          if (access.canAccess && !access.canFullCatalog) {
            setView("ecommerce");
          }
        } else {
          // Never leave portalAccess ambiguous — half-auth shells are forbidden.
          setPortalAccess({ canAccess: false, canFullCatalog: false });
        }
      } catch (err) {
        console.error("Failed to load catalog data:", err);
        setPortalAccess({ canAccess: false, canFullCatalog: false });
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Lazy-load Live + Phase 2 rosters for the 2-tab command center
  useEffect(() => {
    if (ecommerceLoading || ecommerceError) return;
    if (ecommerce && phase1Listings.length > 0) return;
    setEcommerceLoading(true);
    Promise.all([getEcommerceRoster(), getLiveEcommerceRows(), getPhase2PortalRows(phase2Filter)])
      .then(([roster, live, phase2]) => {
        setEcommerce(roster);
        setPhase1Listings(live.listings as Phase1Listing[]);
        setPhase2Listings(phase2.listings as Phase2Listing[]);
      })
      .catch((err) => {
        console.error("Failed to load E-Commerce roster:", err);
        setEcommerceError(
          "Could not load the E-Commerce roster. Run `npm run db:migrate`, then the roster seed script.",
        );
      })
      .finally(() => setEcommerceLoading(false));
  }, [ecommerce, ecommerceLoading, ecommerceError, phase1Listings.length, phase2Filter]);

  useEffect(() => {
    if (activeTab !== "live") return;
    void getLiveEcommerceRows().then((live) => {
      setPhase1Listings(live.listings as Phase1Listing[]);
    });
  }, [activeTab, liveSubView]);

  useEffect(() => {
    if (activeTab !== "phase2") return;
    void getPhase2PortalRows(phase2Filter).then((phase2) => {
      setPhase2Listings(phase2.listings as Phase2Listing[]);
    });
  }, [activeTab, phase2Filter]);

  useEffect(() => {
    setPhase1View(liveSubView === "sheet_grid" ? "phase1_flat" : "phase1_parents");
  }, [liveSubView]);

  // Close the Actions menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── Derived: filtered rows, then groups. Recomputed on every state change,
        so an edited MSRP instantly re-buckets its row. ── */
  const q = searchQuery.toLowerCase();

  const visibleItems = useMemo(() => {
    return catalog.filter((item) => {
      if (
        q &&
        !item.productName.toLowerCase().includes(q) &&
        !item.globalSku.toLowerCase().includes(q)
      )
        return false;
      if (view === "broken") return isBroken(item);
      if (view === "photos") return !item.imageUrl;
      return true;
    });
  }, [catalog, q, view]);

  const groups = useMemo(() => {
    if (view !== "collection" && view !== "tier") {
      return [{ label: null as string | null, items: visibleItems }];
    }
    const map = new Map<string, CatalogItem[]>();
    for (const item of visibleItems) {
      const key =
        view === "collection" ? collectionOf(item.globalSku) : tierOf(item.msrp);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    const keys = [...map.keys()];
    if (view === "tier") keys.sort((a, b) => TIERS.indexOf(a) - TIERS.indexOf(b));
    else keys.sort();
    return keys.map((k) => ({ label: k, items: map.get(k)! }));
  }, [visibleItems, view]);

  const filteredQuarantine = quarantine.filter((item) =>
    item.sheetDescription.toLowerCase().includes(q),
  );

  const generatedSku = `FIN-${collection}-${baseName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .slice(0, 7)}-${length || "0"}X${width || "0"}`;

  /* ── Handlers ── */
  async function handlePriceSave(id: string) {
    if (!editPrice.trim()) {
      setEditingId(null);
      return;
    }
    setSavingId(id);
    try {
      await updateProductMSRP(id, editPrice);
      const n = parseMsrp(editPrice);
      const formatted = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      setCatalog((prev) =>
        prev.map((item) => (item.id === id ? { ...item, msrp: formatted } : item)),
      );
      setJustSavedId(id);
      setTimeout(() => setJustSavedId(null), 1500);
    } catch (err) {
      console.error(err);
      setToast("Failed to save price");
    } finally {
      setSavingId(null);
      setEditingId(null);
    }
  }

  async function handleToggleWeb(id: string, currentStatus: boolean) {
    setCatalog((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isWebVisible: !currentStatus } : item,
      ),
    );
    try {
      await toggleWebVisibility(id, currentStatus);
    } catch (err) {
      console.error(err);
      setCatalog((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, isWebVisible: currentStatus } : item,
        ),
      );
    }
  }

  async function handleMintSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedQuarantine) return;

    const quarantined = selectedQuarantine;
    const payload = {
      quarantineId: quarantined.id,
      productName: `${baseName} ${length}" x ${width}" x ${height}"`,
      globalSku: generatedSku,
      msrp: mintPrice,
      isWebVisible: quarantined.isWebVisible,
    };

    const optimisticNewItem: CatalogItem = {
      id: payload.globalSku,
      productName: payload.productName,
      globalSku: payload.globalSku,
      msrp: payload.msrp,
      isWebVisible: payload.isWebVisible,
      imageUrl: null,
      dbSynced: true,
      katanaSynced: false,
      wooSynced: false,
    };

    setQuarantine((prev) => prev.filter((x) => x.id !== quarantined.id));
    setCatalog((prev) => [optimisticNewItem, ...prev]);
    setModalOpen(false);

    try {
      await mintProductFromQuarantine(payload);
    } catch (err) {
      console.error("Mint failed:", err);
      setCatalog((prev) => prev.filter((x) => x.id !== payload.globalSku));
      setQuarantine((prev) => [quarantined, ...prev]);
    }
  }

  /**
   * Steel MSRP edit from the E-Commerce grid, keyed by listing id. The server
   * mirrors to finished_goods_catalog only for single-listing hub SKUs; the All
   * tab is synced only in that case.
   */
  async function handleEcommerceMsrp(listingId: string, rawPrice: string) {
    let mirroredSku: string | null = null;
    let version: number;
    try {
      ({ mirroredSku, version } = await updateListingMsrp(listingId, rawPrice));
    } catch (err) {
      setToast("Failed to save price");
      throw err;
    }
    const n = parseMsrp(rawPrice);
    const formatted = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    setEcommerce((prev) =>
      prev
        ? {
            ...prev,
            listings: prev.listings.map((l) =>
              l.id === listingId ? { ...l, msrp: formatted, msrpValue: n, version } : l,
            ),
          }
        : prev,
    );
    if (mirroredSku) {
      setCatalog((prev) =>
        prev.map((item) =>
          item.id === mirroredSku ? { ...item, msrp: formatted } : item,
        ),
      );
    }
  }

  /**
   * Inline link save. Patch state first, call the action, restore the row if it
   * throws (the grid keeps its input open and shows the message).
   */
  async function handleEcommerceUrl(listingId: string, raw: string) {
    const n = normalizeProductUrl(raw);
    if (!n.ok) throw new Error(n.error);
    const before = ecommerce?.listings.find((l) => l.id === listingId);
    if (!before) throw new Error("Listing not found");
    setEcommerce((prev) =>
      patchListings(prev, [{ id: listingId, productUrl: n.value, urlSource: "row" }]),
    );
    try {
      const { url, version } = await updateListingUrl(listingId, raw);
      setEcommerce((prev) =>
        patchListings(prev, [{ id: listingId, productUrl: url, urlSource: "row", version }]),
      );
      setToast("Link saved");
    } catch (err) {
      setEcommerce((prev) =>
        patchListings(prev, [
          { id: listingId, productUrl: before.productUrl, urlSource: before.urlSource },
        ]),
      );
      throw err;
    }
  }

  /**
   * Inline legacy SKU save. The shared chip is predicted locally, then replaced
   * by the server's patches (which include a previous twin that lost its chip).
   */
  async function handleEcommerceLegacy(listingId: string, raw: string) {
    const n = normalizeLegacySku(raw);
    if (!n.ok) throw new Error(n.error);
    const all = ecommerce?.listings ?? [];
    const before = all.find((l) => l.id === listingId);
    if (!before) throw new Error("Listing not found");
    const predicted = sharedLegacyPatches(
      all.map((l) => (l.id === listingId ? { ...l, legacyBaseSku: n.value } : l)),
    );
    const flagsBefore = predicted.map((p) => ({
      id: p.id,
      legacySkuShared: all.find((l) => l.id === p.id)?.legacySkuShared ?? false,
    }));
    setEcommerce((prev) =>
      patchListings(prev, [{ id: listingId, legacyBaseSku: n.value }, ...predicted]),
    );
    try {
      const res = await updateListingLegacySku(listingId, raw);
      setEcommerce((prev) =>
        patchListings(prev, [
          ...flagsBefore,
          { id: listingId, legacyBaseSku: res.legacyBaseSku, version: res.version },
          ...res.sharedPatches,
        ]),
      );
      setToast("Legacy SKU saved");
    } catch (err) {
      setEcommerce((prev) =>
        patchListings(prev, [
          { id: listingId, legacyBaseSku: before.legacyBaseSku },
          ...flagsBefore,
        ]),
      );
      throw err;
    }
  }

  /**
   * Mint a hub SKU for a gap group. No optimistic delete: wait for the
   * transaction, then drop the promoted gaps and append the new listings.
   */
  async function handleMintHub(globalSku: string) {
    const r = await mintHubSkuFromGap(globalSku);
    setEcommerce((prev) => {
      if (!prev) return prev;
      const promoted = new Set(r.promotedGapNames);
      const known = new Set(prev.listings.map((l) => l.id));
      const patched = patchListings(prev, r.sharedPatches)!.listings;
      return {
        listings: [...patched, ...r.listings.filter((l) => !known.has(l.id))],
        gaps: prev.gaps.filter((g) => !promoted.has(g.productName)),
      };
    });
    setToast(
      `${r.listings.length} listing${r.listings.length === 1 ? "" : "s"} joined the roster`,
    );
  }

  async function handleEcommerceListingDrawer(id: string, expectedVersion: number, payload: any) {
    const res = await updateListingInDrawer(id, expectedVersion, payload);
    setEcommerce((prev) => {
      const patched = patchListings(prev, res.sharedPatches);
      return patchListings(patched, [{
        id,
        collectionLabel: payload.collectionLabel,
        msrp: payload.steelMsrp ? `$${parseMsrp(payload.steelMsrp).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—",
        legacyBaseSku: payload.legacyBaseSku,
        productUrl: payload.productUrl,
        version: expectedVersion + 1,
      }]);
    });
    setToast("Listing saved");
  }

  function handleListingPatched(id: string, patch: Partial<EcommerceListing>) {
    setEcommerce((prev) => patchListings(prev, [{ id, ...patch }]));
  }

  /** Re-pull Live + Phase 2 rows so the 3D badge reflects a fresh upload. */
  async function refresh3dListings() {
    const live = await getLiveEcommerceRows();
    setPhase1Listings(live.listings as Phase1Listing[]);
    setEcommerce({ listings: live.listings, gaps: live.gaps });
    const phase2 = await getPhase2PortalRows(phase2Filter);
    setPhase2Listings(phase2.listings as Phase2Listing[]);
  }

  function openCatalogDrawer(globalSku: string) {
    const match = ecommerce?.listings.find((l) => l.globalSku === globalSku && !l.archivedAt);
    const params = new URLSearchParams(window.location.search);
    if (match) {
      params.set("listing", match.id);
      params.delete("hubOnly");
    } else {
      params.set("hubOnly", globalSku);
      params.delete("listing");
    }
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    setView("ecommerce");
  }

  async function handleEcommerceHubDrawer(listingId: string, globalSku: string, expectedVersion: number, payload: any) {
    await updateHubInDrawer(listingId, globalSku, expectedVersion, payload);
    setEcommerce((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        listings: prev.listings.map(l => l.globalSku === globalSku ? {
          ...l,
          hubLength: payload.length !== undefined ? payload.length : l.hubLength,
          hubDepth: payload.depth !== undefined ? payload.depth : l.hubDepth,
          syncToWoo: payload.syncToWoo !== undefined ? payload.syncToWoo : l.syncToWoo,
          syncToClover: payload.syncToClover !== undefined ? payload.syncToClover : l.syncToClover,
          hubVersion: expectedVersion + 1,
        } : l)
      };
    });
    setToast("Hub saved");
  }

  function handlePrint() {
    setMenuOpen(false);
    setPrintMode(true);
    setActiveTab("live");
    // Let the print styles apply before opening the dialog.
    setTimeout(() => {
      window.print();
      setPrintMode(false);
    }, 150);
  }

  /** Marketing feed = the E-Commerce roster (not is_web_visible). */
  async function handleCsvExport() {
    setMenuOpen(false);
    let roster = ecommerce;
    if (!roster) {
      try {
        roster = await getEcommerceRoster();
        setEcommerce(roster);
      } catch (err) {
        console.error(err);
        setToast("E-Commerce roster unavailable — run db:migrate and the roster seed");
        return;
      }
    }
    const imageBySku = new Map(catalog.map((c) => [c.globalSku, c.imageUrl]));
    const header = [
      "id",
      "title",
      "sku",
      "price",
      "availability",
      "image_link",
      "link",
      "collection",
    ];
    const lines = [header.join(",")];
    for (const l of roster.listings) {
      lines.push(
        [
          csvCell(l.id),
          csvCell(l.productName),
          csvCell(l.globalSku),
          csvCell(l.msrpValue === null ? "" : `${l.msrpValue.toFixed(2)} USD`),
          csvCell("in stock"),
          csvCell(imageBySku.get(l.globalSku) ?? null),
          csvCell(l.productUrl),
          csvCell(l.collectionLabel),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `marketing-feed-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`Marketing feed exported (${roster.listings.length} roster items)`);
  }

  const colCount = 6;

  // legacy-admin spreadsheet retired — always unify into the dark Executive Control Center
  void searchParams.get("view");
  const miaCounts = useMemo(
    () => reconcileMiaApprovedCounts(phase1Listings),
    [phase1Listings],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0f17] text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    );
  }
  if (!portalAccess.canAccess) {
    return (
      <div data-testid="ecommerce-access-denied">
        <ExecutiveAuthGate
          message="Limited to Mia, Kian, Rob (rjg.cal@gmail.com), SuperAdmin, and authorized executive GHL embed sessions. Showroom / floor roles cannot open this surface."
          setupUrl="/embed/admin/master-catalog?key=<GHL_EMBED_SECRET>&email={{user.email}}"
        />
      </div>
    );
  }
  return (
    <>
      <EcommerceCertificationPortal
        listings={phase1Listings}
        listingsLoading={ecommerceLoading || loading}
        listingsError={ecommerceError}
        miaApprovedCount={miaCounts.miaApprovedCount}
        sowItemCount={miaCounts.sowItemCount || PHASE1_SOW_ITEM_COUNT}
        parentCount={PHASE1_PARENT_COUNT}
        variationCount={PHASE1_VARIATION_COUNT}
        simpleCount={PHASE1_SIMPLE_COUNT}
        purchasableSkuCount={PHASE1_PURCHASABLE_SKU_COUNT}
        wooBadgeLabel={wooBadge?.label ?? null}
        wooConfigured={Boolean(wooBadge?.configured)}
        onToast={setToast}
        onListingsChange={setPhase1Listings}
        onOpenProductEdit={(listing, focus) => {
          setPortalDrawerFocus(focus);
          setPortalEditListing(listing);
        }}
        initialAssets={initialAssets}
        initialStackLayers={initialStackLayers}
      />
      {portalEditListing ? (
        <PortalProductDrawer
          open={Boolean(portalEditListing)}
          sku={portalEditListing.globalSku}
          focusSection={portalDrawerFocus}
          onClose={() => {
            setPortalEditListing(null);
            setPortalDrawerFocus(undefined);
          }}
          onToast={setToast}
          onSaved={() => void refresh3dListings()}
        />
      ) : null}
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-xl">
          {toast}
        </div>
      ) : null}
    </>
  );
}
