"use client";

import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
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
} from "./actions";
import SystemHealthDrawer from "./ecommerce/SystemHealthDrawer";
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

/* ───────────────────────── page ───────────────────────── */

export default function MasterCatalogAdmin() {
  const router = useRouter();
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
  const [model3dTarget, setModel3dTarget] = useState<{ sku: string; name: string } | null>(null);
  const [upchargePct, setUpchargePct] = useState(DEFAULT_ALU_UPCHARGE_PCT);
  const [spotCheckOnly, setSpotCheckOnly] = useState(false);
  const [portalAccess, setPortalAccess] = useState<{
    canAccess: boolean;
    canFullCatalog: boolean;
  } | null>(null);

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
          // Mia / Kian / embed: lock to E-Commerce tab; Superadmin keeps full catalog toggle.
          if (access.canAccess && !access.canFullCatalog) {
            setView("ecommerce");
          }
        }
      } catch (err) {
        console.error("Failed to load catalog data:", err);
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

  return (
    <div
      className={`min-h-screen w-full px-4 md:px-8 py-4 md:py-6 text-slate-800 flex flex-col ${
        printMode ? "bg-white" : "bg-slate-900/40"
      } print:bg-white print:p-0 print:min-h-0`}
    >
      {/* Print-only overrides: white page, hide controls & shadows */}
      <style>{`
        @media print {
          html, body { background: #fff !important; }
          .mc-card-cell { box-shadow: none !important; }
          .mc-scroll { overflow: visible !important; height: auto !important; }
          .mc-shell { height: auto !important; }
          .mc-panel { background: #fff !important; box-shadow: none !important; border: 0 !important; backdrop-filter: none !important; }
          thead { position: static !important; }
        }
      `}</style>

      {/* Hidden camera / file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && activeUploadId) {
            const previewUrl = URL.createObjectURL(file);
            setCatalog((prev) =>
              prev.map((item) =>
                item.id === activeUploadId
                  ? { ...item, imageUrl: previewUrl }
                  : item,
              ),
            );
          }
          e.target.value = "";
        }}
      />

      <div className="mc-shell w-full flex flex-col flex-1 h-[calc(100vh-3rem)]">
        {/* Command bar */}
        <div className="mc-panel print:hidden bg-white/80 backdrop-blur-md rounded-2xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.06)] p-4 mb-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                GoHighLevel · CC Patio
              </p>
              <h1 className="text-lg font-semibold text-slate-900">
                E-Commerce Master Catalog
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="system-health-pill"
                onClick={() => setHealthDrawerOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  systemHealth === "Attention Needed"
                    ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
                    : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                }`}
                title="System Health, Held Orders & Admin Runbook"
              >
                <Activity className="h-3.5 w-3.5" />
                System Health · {systemHealth ?? "…"}
              </button>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  wooBadge?.configured
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {wooBadge?.label ?? "Checking Woo…"}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const result = await testWooConnectionAction();
                  setToast(result.ok ? `Connected to ${result.host}` : result.reason);
                  const badge = await getWooConnectionBadge();
                  setWooBadge(badge);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Test Woo Connection
              </button>
              <button
                type="button"
                onClick={async () => {
                  const sample = phase1Listings[0]?.globalSku;
                  if (!sample) {
                    setToast("No Phase 1 rows loaded yet.");
                    return;
                  }
                  const preview = await dryRunWooPushForSku(sample);
                  if (!preview.ok) {
                    setToast(preview.error);
                    return;
                  }
                  setDryRunJson(JSON.stringify(preview.preview, null, 2));
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Dry-Run Payload Preview
              </button>
            </div>
          </div>
          <div
            className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3"
            data-testid="storefront-policy-banner"
          >
            <div className="flex-1">
              <p className="text-sm font-semibold text-sky-950">{STOREFRONT_POLICY_BANNER}</p>
              <p className="text-xs text-sky-800 mt-0.5">
                Website Regular Price = Mia&apos;s Aluminum PDF (Oct 1 base + manual $0/$5 rounding). Steel MSRP is reference-only — do not use it on the storefront. No separate APF/ACF frame upcharges.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-sky-900 flex items-center gap-1">
                Upcharge %
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={upchargePct}
                  onChange={(e) => setUpchargePct(Number(e.target.value) || 0)}
                  className="w-14 rounded border border-sky-200 px-1.5 py-1 text-xs"
                  data-testid="upcharge-pct-input"
                />
              </label>
              <button
                type="button"
                data-testid="recalculate-upcharge-btn"
                onClick={async () => {
                  const result = await recalculateAluminumUpcharge(upchargePct);
                  if (!result.ok) {
                    setToast(result.error);
                    return;
                  }
                  setToast(
                    `Recalculated ${result.updated} row(s) at +${result.pct}% (skipped ${result.skippedLocked} locked)`,
                  );
                  const live = await getLiveEcommerceRows();
                  setPhase1Listings(live.listings as Phase1Listing[]);
                  setEcommerce({ listings: live.listings, gaps: live.gaps });
                }}
                className="rounded-xl bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Recalculate Upcharge %
              </button>
              <button
                type="button"
                data-testid="round-half-cent-btn"
                onClick={async () => {
                  const result = await roundHalfCentAluminumPrices();
                  if (!result.ok) {
                    setToast(result.error);
                    return;
                  }
                  setToast(
                    result.rounded.length
                      ? `Rounded ${result.rounded.length} .50¢ item(s) to whole dollars`
                      : "No .50¢ Aluminum prices found",
                  );
                  const live = await getLiveEcommerceRows();
                  setPhase1Listings(live.listings as Phase1Listing[]);
                  setEcommerce({ listings: live.listings, gaps: live.gaps });
                }}
                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900"
              >
                Round .50 Cents Items (4 Taylor SKUs)
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2" data-testid="ecommerce-tabs">
              <button
                data-testid="tab-live-ecommerce"
                onClick={() => setActiveTab("live")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === "live"
                    ? "bg-sky-600 text-white shadow-sm ring-1 ring-sky-700/20"
                    : "bg-transparent text-slate-600 hover:bg-slate-100/80"
                }`}
              >
                Live E-Commerce
                <span className="ml-1 text-xs opacity-80">({phase1Listings.length})</span>
              </button>
              <button
                data-testid="tab-phase2"
                onClick={() => setActiveTab("phase2")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === "phase2"
                    ? "bg-violet-700 text-white shadow-sm ring-1 ring-violet-800/20"
                    : "bg-transparent text-slate-600 hover:bg-slate-100/80"
                }`}
              >
                Phase 2 & New Products
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="held-quarantine-btn"
                onClick={() => setActiveTab("quarantine")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Held Orders ({quarantine.length})
              </button>
              <button
                type="button"
                data-testid="global-swatches-btn"
                onClick={() => setSwatchesOpen((o) => !o)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Swatches, Finishes &amp; Add-Ons
              </button>
              <button
                onClick={() => setCreatingNewProduct(true)}
                data-testid="create-new-product"
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-all shadow-sm"
              >
                <PlusCircle className="h-4 w-4" />
                Create New Product
              </button>

              {/* Actions dropdown */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-all shadow-sm"
                >
                  <Zap className="h-4 w-4 text-sky-400" />
                  Actions
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      menuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 bg-white rounded-xl border border-slate-200 shadow-xl z-40 py-1.5 overflow-hidden"
                  >
                    <button
                      role="menuitem"
                      onClick={handlePrint}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <Printer className="h-4 w-4 text-slate-500" />
                      Print View
                    </button>
                    <button
                      role="menuitem"
                      onClick={handleCsvExport}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      Marketing CSV Feed
                    </button>
                    <button
                      role="menuitem"
                      onClick={async () => {
                        const result = await exportMiaAluminumPriceListCsv();
                        setMenuOpen(false);
                        if (!result.ok) {
                          setToast(result.error);
                          return;
                        }
                        const blob = new Blob([result.csv], {
                          type: "text/csv;charset=utf-8",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "mia-aluminum-price-list.csv";
                        a.click();
                        URL.revokeObjectURL(url);
                        setToast("Exported Mia's Aluminum Price List");
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      Export Mia&apos;s Aluminum Price List (.csv)
                    </button>
                    <button
                      role="menuitem"
                      onClick={async () => {
                        const urls = await getPrimeviewHandoffDownloadUrls();
                        setMenuOpen(false);
                        if (!urls.ok) {
                          setToast(urls.error);
                          return;
                        }
                        window.open(urls.csv, "_blank", "noopener,noreferrer");
                        setToast("Downloading live 169-col PrimeView CSV");
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      Export PrimeView 169-Col Woo CSV
                    </button>
                    <button
                      role="menuitem"
                      onClick={async () => {
                        const urls = await getPrimeviewHandoffDownloadUrls();
                        setMenuOpen(false);
                        if (!urls.ok) {
                          setToast(urls.error);
                          return;
                        }
                        window.open(urls.spec, "_blank", "noopener,noreferrer");
                        setToast("Downloading live Technical Handoff Spec");
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      Download Live Technical Handoff Spec (.md)
                    </button>
                    <button
                      role="menuitem"
                      onClick={async () => {
                        const link = await getPrimeviewPartnerHandoffLink();
                        setMenuOpen(false);
                        if (!link.ok) {
                          setToast(link.error);
                          return;
                        }
                        try {
                          await navigator.clipboard.writeText(link.url);
                          setToast("Copied PrimeView Partner Link");
                        } catch {
                          setToast(link.url);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      Copy PrimeView Partner Link
                    </button>
                    <button
                      role="menuitem"
                      onClick={async () => {
                        const approved = phase1Listings
                          .filter((l) => l.miaApproved)
                          .map((l) => l.globalSku);
                        const result = await syncApprovedToWoo(approved);
                        setMenuOpen(false);
                        if (!result.ok) {
                          setToast(result.error);
                          return;
                        }
                        const failed = result.results.filter((r) => !r.ok).length;
                        setToast(
                          failed
                            ? `Synced with ${failed} error(s)`
                            : `Synced ${result.results.length} approved SKU(s) to Woo`,
                        );
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <ShoppingCart className="h-4 w-4 text-slate-500" />
                      Sync Approved to WooCommerce
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {portalAccess && !portalAccess.canAccess ? (
          <div
            className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-sm text-amber-950"
            data-testid="ecommerce-access-denied"
          >
            The E-Commerce tab is limited to Mia, Kian, and Superadmin. Ask an admin if you need access.
          </div>
        ) : (
          <EcommerceCertificationPortal
            miaApprovedCount={phase1Listings.filter((l) => l.miaApproved).length}
            sowItemCount={phase1Listings.length || 102}
            canFullCatalog={portalAccess?.canFullCatalog ?? false}
            onOpenFinishes={() => setSwatchesOpen(true)}
            onOpenFullCatalog={
              portalAccess?.canFullCatalog
                ? () => {
                    window.open("/admin/mission-control", "_blank", "noopener,noreferrer");
                  }
                : undefined
            }
            onOpenPrimeviewHandoff={async () => {
              const link = await getPrimeviewPartnerHandoffLink();
              if (!link.ok) {
                setToast(link.error);
                return;
              }
              window.open(link.url, "_blank", "noopener,noreferrer");
            }}
          />
        )}

        {/* Tab 1: Live E-Commerce */}
        {portalAccess && !portalAccess.canAccess ? null : activeTab === "live" ? (
          <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="live-ecommerce-panel">
            {ecommerceError ? (
              <div className="rounded-2xl border border-rose-100 bg-white/90 p-8 text-sm text-rose-600">
                {ecommerceError}
              </div>
            ) : !ecommerce ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
                <span>Loading Live E-Commerce…</span>
              </div>
            ) : (
              <>
                <LiveToolbar
                  subView={liveSubView}
                  onSubView={setLiveSubView}
                  approvedCount={phase1Listings.filter((l) => l.miaApproved).length}
                  totalVisible={phase1Listings.length || 102}
                  search={searchQuery}
                  onSearch={setSearchQuery}
                  collection={liveCollection}
                  onCollection={setLiveCollection}
                  collections={[...new Set(phase1Listings.map((l) => l.collectionLabel).filter(Boolean))]}
                  spotCheckOnly={spotCheckOnly}
                  onSpotCheckOnly={setSpotCheckOnly}
                  spotCheckCount={
                    phase1Listings.filter((l) =>
                      needsMiaSpotCheck({
                        globalSku: l.globalSku,
                        attributes: l.attributes,
                        wooSku: l.wooSku,
                      }),
                    ).length || 7
                  }
                  onApproveAll={async () => {
                    const skus = phase1Listings.map((l) => l.globalSku);
                    const result = await approveAllVisibleSkus(skus);
                    if (!result.ok) {
                      setToast(result.error);
                      return;
                    }
                    setPhase1Listings((prev) => prev.map((l) => ({ ...l, miaApproved: true })));
                    setToast(`Approved ${result.count} visible SKU(s)`);
                  }}
                />
                {liveSubView === "sheet_grid" ? (
                  <Phase1FlatGrid
                    spotCheckOnly={spotCheckOnly}
                    listings={phase1Listings.filter((l) => {
                      if (liveCollection && l.collectionLabel !== liveCollection) return false;
                      if (!searchQuery) return true;
                      const q = searchQuery.toLowerCase();
                      return (
                        l.productName.toLowerCase().includes(q) ||
                        l.globalSku.toLowerCase().includes(q)
                      );
                    })}
                    onToggleMia={async (sku, approved) => {
                      const result = await toggleMiaApproval(sku, approved);
                      if (!result.ok) {
                        setToast(result.error);
                        return;
                      }
                      setPhase1Listings((prev) =>
                        prev.map((l) =>
                          l.globalSku === sku
                            ? { ...l, miaApproved: approved, miaApprovedAt: result.approvedAt }
                            : l,
                        ),
                      );
                    }}
                    onPush={async (sku) => {
                      const result = await pushSkuToWoo(sku);
                      setToast(result.ok ? `Pushed ${sku}` : result.error);
                    }}
                    onSaveAluPrice={async (listingId, price) => {
                      const result = await updateListingAluminumMsrp(listingId, price);
                      if (!result.ok) {
                        setToast(result.error);
                        return;
                      }
                      setToast("Saved Website Price (Aluminum) — Mia override locked");
                      const live = await getLiveEcommerceRows();
                      setPhase1Listings(live.listings as Phase1Listing[]);
                      setEcommerce({ listings: live.listings, gaps: live.gaps });
                    }}
                    onOpen3d={(sku, name) => setModel3dTarget({ sku, name })}
                    onRoundNearest5={async (listingId) => {
                      const result = await roundListingAluminumNearest5(listingId);
                      if (!result.ok) {
                        setToast(result.error);
                        return;
                      }
                      setToast(
                        `Rounded to nearest $5 → $${result.to.toFixed(2)} (was $${result.from.toFixed(2)})`,
                      );
                      const live = await getLiveEcommerceRows();
                      setPhase1Listings(live.listings as Phase1Listing[]);
                      setEcommerce({ listings: live.listings, gaps: live.gaps });
                    }}
                  />
                ) : (
                  <Suspense fallback={<DrawerLoadingShell />}>
                    <EcommerceGrid
                      listings={ecommerce.listings.filter((l) => {
                        if (
                          !isLiveEcommerceRow({
                            globalSku: l.globalSku,
                            syncToWoo: Boolean(l.syncToWoo),
                            productName: l.productName,
                            msrpValue: l.msrpValue,
                          })
                        ) {
                          return false;
                        }
                        if (liveCollection && l.collectionLabel !== liveCollection) return false;
                        if (!searchQuery) return true;
                        const q = searchQuery.toLowerCase();
                        return (
                          l.productName.toLowerCase().includes(q) ||
                          l.globalSku.toLowerCase().includes(q)
                        );
                      })}
                      gaps={ecommerce.gaps}
                      onSaveMsrp={handleEcommerceMsrp}
                      onSaveUrl={handleEcommerceUrl}
                      onSaveLegacy={handleEcommerceLegacy}
                      onMintHub={handleMintHub}
                      onSaveListingDrawer={handleEcommerceListingDrawer}
                      onSaveHubDrawer={handleEcommerceHubDrawer}
                      onListingPatched={handleListingPatched}
                    />
                  </Suspense>
                )}
              </>
            )}
          </div>
        ) : activeTab === "phase2" ? (
          <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="phase2-panel">
            <Phase2SubFilterBar
              filter={phase2Filter}
              onChange={setPhase2Filter}
              counts={{ phase2_sow: phase2Listings.length }}
            />
            <Phase2StagingGrid
              listings={phase2Listings}
              onOpen3d={(sku, name) => setModel3dTarget({ sku, name })}
              onPromote={async (sku) => {
                const result = await promoteToLiveEcommerce(sku);
                setToast(result.ok ? `Promoted ${sku}` : result.error);
                if (result.ok) {
                  const phase2 = await getPhase2PortalRows(phase2Filter);
                  setPhase2Listings(phase2.listings as Phase2Listing[]);
                }
              }}
              onHeal={async (sku) => {
                const result = await healAndLinkKatana(sku);
                setToast(
                  result.ok
                    ? `${sku}: ${result.bomReadiness}${result.provisional ? " (provisional shell)" : ""}`
                    : result.error,
                );
                if (result.ok) {
                  const phase2 = await getPhase2PortalRows(phase2Filter);
                  setPhase2Listings(phase2.listings as Phase2Listing[]);
                }
              }}
            />
          </div>
        ) : (
          <div
            className="mc-panel bg-white/80 backdrop-blur-md rounded-2xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.06)] flex-1 overflow-hidden flex flex-col"
            data-testid="quarantine-panel"
          >
            {loading ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
                <span>Loading Quarantine...</span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {filteredQuarantine.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                    <Check className="h-8 w-8 text-emerald-500 mb-2" />
                    <p className="text-sm font-medium">
                      All items mapped! Quarantine queue is clean.
                    </p>
                  </div>
                ) : (
                  filteredQuarantine.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white rounded-xl border border-slate-200/70 shadow-sm hover:shadow-md hover:border-sky-200 transition-all gap-4"
                    >
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">
                          {item.sheetDescription}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Target MSRP:{" "}
                          <span className="font-bold text-slate-700">
                            {item.targetMsrp}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedQuarantine(item);
                          setBaseName(item.sheetDescription.split(/\d+/)[0].trim());
                          setMintPrice(item.targetMsrp);
                          setModalOpen(true);
                        }}
                        className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5"
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        Mint Product
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <SwatchesFinishesDrawer
        open={swatchesOpen}
        onClose={() => setSwatchesOpen(false)}
        onToast={setToast}
      />
      <Product3dMediaDrawer
        open={model3dTarget !== null}
        sku={model3dTarget?.sku ?? null}
        productName={model3dTarget?.name}
        onClose={() => setModel3dTarget(null)}
        onChanged={() => void refresh3dListings()}
        onToast={setToast}
      />
      <SystemHealthDrawer
        open={healthDrawerOpen}
        onClose={() => {
          setHealthDrawerOpen(false);
          void getSystemHealthAction().then((h) => {
            if (h.ok) setSystemHealth(h.snapshot.overall);
          });
        }}
      />

      {/* Toast */}
      {toast && (
        <div className="print:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      {dryRunJson && (
        <div className="print:hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-800">Dry-Run Payload Preview</h3>
              <button type="button" onClick={() => setDryRunJson(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <pre className="max-h-[70vh] overflow-auto bg-slate-950 p-4 text-[11px] text-emerald-300">
              {dryRunJson}
            </pre>
          </div>
        </div>
      )}

      {/* Slide-over minting modal */}
      {modalOpen && (
        <div className="print:hidden fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                <h3 className="font-bold text-slate-800 text-base">
                  Mint New Finished Good
                </h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-3 bg-slate-900 rounded-xl text-white mb-6">
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Generated Katana SKU
                </p>
                <p className="font-mono text-sm text-sky-400 font-bold mt-0.5">
                  {generatedSku}
                </p>
              </div>

              <form onSubmit={handleMintSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600">
                    Collection
                  </label>
                  <select
                    value={collection}
                    onChange={(e) => setCollection(e.target.value)}
                    className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                  >
                    <option value="BRV">Bravada (BRV)</option>
                    <option value="BRK">Brooklyn (BRK)</option>
                    <option value="OCN">Ocean (OCN)</option>
                    <option value="MLN">Milan (MLN)</option>
                    <option value="WFT">Waterfall (WFT)</option>
                    <option value="DAI">Daisy (DAI)</option>
                    <option value="TAY">Taylor (TAY)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">
                    Base Name
                  </label>
                  <input
                    type="text"
                    required
                    value={baseName}
                    onChange={(e) => setBaseName(e.target.value)}
                    className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                    placeholder="e.g. Daybed"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Length", v: length, set: setLength, ph: "84", req: true },
                    { label: "Width", v: width, set: setWidth, ph: "78", req: true },
                    { label: "Height", v: height, set: setHeight, ph: "27", req: false },
                  ].map((f) => (
                    <div key={f.label}>
                      <label className="text-xs font-semibold text-slate-600">
                        {f.label} (&quot;)
                      </label>
                      <input
                        type="number"
                        required={f.req}
                        value={f.v}
                        onChange={(e) => f.set(e.target.value)}
                        className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                        placeholder={f.ph}
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">
                    MSRP ($)
                  </label>
                  <input
                    type="text"
                    required
                    value={mintPrice}
                    onChange={(e) => setMintPrice(e.target.value)}
                    className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                    placeholder="$7,400"
                  />
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-semibold shadow-sm transition-all"
                  >
                    Confirm &amp; Mint Product
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {creatingNewProduct && (
        <>
          <NewProductDrawer
            onClose={() => setCreatingNewProduct(false)}
            onCreate={async (payload) => {
              const res = await createNewProduct(payload);
              setToast("New product minted successfully");
              // Force roster refresh in background
              getEcommerceRoster().then(roster => {
                setEcommerce(roster);
              });
              
              // Switch to ecommerce view
              setView("ecommerce");
              return res.id;
            }}
          />
        </>
      )}
    </div>
  );
}
