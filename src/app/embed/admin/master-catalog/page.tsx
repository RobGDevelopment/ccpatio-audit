"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
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
  FileText,
  Download,
  Zap,
} from "lucide-react";
import {
  getActiveCatalog,
  getQuarantineQueue,
  getEcommerceRoster,
  updateListingMsrp,
  updateProductMSRP,
  toggleWebVisibility,
  mintProductFromQuarantine,
  type CatalogItem,
  type QuarantineItem,
  type EcommerceRoster,
} from "./actions";
import EcommerceGrid from "./ecommerce/EcommerceGrid";

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
}: {
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={`${title}: ${active ? "Synced" : "Missing"}`}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
        active
          ? "bg-emerald-100 text-emerald-600"
          : "bg-slate-100 text-slate-400"
      }`}
    >
      {children}
    </span>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function MasterCatalogAdmin() {
  const [activeTab, setActiveTab] = useState<"active" | "quarantine">("active");
  const [view, setView] = useState<ViewMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);

  // E-Commerce roster: loaded once, on first visit to the view
  const [ecommerce, setEcommerce] = useState<EcommerceRoster | null>(null);
  const [ecommerceLoading, setEcommerceLoading] = useState(false);
  const [ecommerceError, setEcommerceError] = useState<string | null>(null);

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
        const [a, q] = await Promise.all([
          getActiveCatalog(),
          getQuarantineQueue(),
        ]);
        setCatalog(a);
        setQuarantine(q);
      } catch (err) {
        console.error("Failed to load catalog data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Lazy-load the roster the first time the E-Commerce view opens
  useEffect(() => {
    if (view !== "ecommerce" || ecommerce || ecommerceLoading || ecommerceError)
      return;
    setEcommerceLoading(true);
    getEcommerceRoster()
      .then(setEcommerce)
      .catch((err) => {
        console.error("Failed to load E-Commerce roster:", err);
        setEcommerceError(
          "Could not load the E-Commerce roster. Run `npm run db:migrate`, then the roster seed script.",
        );
      })
      .finally(() => setEcommerceLoading(false));
  }, [view, ecommerce, ecommerceLoading, ecommerceError]);

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
    try {
      ({ mirroredSku } = await updateListingMsrp(listingId, rawPrice));
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
              l.id === listingId ? { ...l, msrp: formatted, msrpValue: n } : l,
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

  function handlePrint() {
    setMenuOpen(false);
    setPrintMode(true);
    setActiveTab("active");
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
          csvCell(`${l.msrpValue.toFixed(2)} USD`),
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

  function handleTearSheets() {
    setMenuOpen(false);
    setToast("Tear sheet PDF generation coming soon");
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
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("active")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === "active"
                    ? "bg-sky-600 text-white shadow-sm ring-1 ring-sky-700/20"
                    : "bg-transparent text-slate-600 hover:bg-slate-100/80"
                }`}
              >
                Active Catalog{" "}
                <span className="ml-1 text-xs opacity-80">({catalog.length})</span>
              </button>
              <button
                onClick={() => setActiveTab("quarantine")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
                  activeTab === "quarantine"
                    ? "bg-sky-600 text-white shadow-sm ring-1 ring-sky-700/20"
                    : "bg-transparent text-slate-600 hover:bg-slate-100/80"
                }`}
              >
                Quarantine Queue
                {quarantine.length > 0 && (
                  <span className="bg-rose-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                    {quarantine.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div
                className={`relative min-w-[260px] md:min-w-[340px] ${
                  activeTab === "active" && view === "ecommerce" ? "hidden" : ""
                }`}
              >
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search SKUs or Products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all placeholder:text-slate-400"
                />
              </div>

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
                      onClick={handleTearSheets}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <FileText className="h-4 w-4 text-slate-500" />
                      Generate Tear Sheets (PDF)
                    </button>
                    <button
                      role="menuitem"
                      onClick={handleCsvExport}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      Marketing CSV Feed
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* View pills */}
          {activeTab === "active" && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    view === v.key
                      ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                      : "bg-white text-slate-600 border-slate-200 hover:border-sky-300 hover:text-sky-700"
                  }`}
                >
                  {v.label}
                </button>
              ))}
              <span className="ml-auto shrink-0 text-xs text-slate-400 pl-4">
                {view === "ecommerce"
                  ? `${ecommerce?.listings.length ?? 0} roster listings`
                  : `${visibleItems.length} of ${catalog.length} items`}
              </span>
            </div>
          )}
        </div>

        {/* E-Commerce roster view */}
        {activeTab === "active" && view === "ecommerce" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {ecommerceError ? (
              <div className="rounded-2xl border border-rose-100 bg-white/90 p-8 text-sm text-rose-600">
                {ecommerceError}
              </div>
            ) : !ecommerce ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
                <span>Loading E-Commerce roster...</span>
              </div>
            ) : (
              <EcommerceGrid
                listings={ecommerce.listings}
                gaps={ecommerce.gaps}
                onSaveMsrp={handleEcommerceMsrp}
              />
            )}
          </div>
        ) : (
        <div className="mc-panel bg-white/80 backdrop-blur-md rounded-2xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.06)] flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
              <span>Loading Catalog Master...</span>
            </div>
          ) : activeTab === "active" ? (
            <div className="mc-scroll flex-1 overflow-y-auto px-4">
              <table className="table border-separate border-spacing-y-3 w-full text-left">
                <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm text-slate-400 uppercase text-[11px] font-semibold tracking-wider">
                  <tr>
                    <th className="py-3 px-4 w-16">Image</th>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-4">Global SKU</th>
                    <th className="py-3 px-4 w-36">MSRP</th>
                    <th className="py-3 px-4 w-28 text-center print:hidden">
                      Web Visible
                    </th>
                    <th className="py-3 px-4 w-40 text-center">Sync Status</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {visibleItems.length === 0 && (
                    <tr>
                      <td
                        colSpan={colCount}
                        className="py-16 text-center text-slate-400"
                      >
                        No items match this view.
                      </td>
                    </tr>
                  )}
                  {groups.map((group) => (
                    <React.Fragment key={group.label ?? "__all"}>
                      {group.label && (
                        <tr className="bg-transparent">
                          <td
                            colSpan={colCount}
                            className="text-slate-500 font-bold uppercase text-xs pt-4 pb-2 px-2"
                          >
                            {group.label}{" "}
                            <span className="font-medium text-slate-400">
                              · {group.items.length}
                            </span>
                          </td>
                        </tr>
                      )}
                      {group.items.map((item) => {
                        // Card styling lives on the <td>s: with border-separate,
                        // <tr> can't render borders/radius/shadow.
                        const flash = justSavedId === item.id;
                        const cell = `mc-card-cell py-3 px-4 border-y border-slate-200/70 shadow-sm transition-all group-hover/row:shadow-md group-hover/row:border-sky-200 ${
                          flash ? "bg-emerald-50" : "bg-white"
                        }`;
                        return (
                          <tr
                            key={item.id}
                            className="group/row break-inside-avoid"
                          >
                            <td
                              className={`${cell} border-l rounded-l-xl`}
                            >
                              {item.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.imageUrl}
                                  alt=""
                                  className="w-10 h-10 rounded-lg object-cover border border-slate-200"
                                />
                              ) : (
                                <button
                                  onClick={() => {
                                    setActiveUploadId(item.id);
                                    fileInputRef.current?.click();
                                  }}
                                  className="w-10 h-10 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:text-sky-600 hover:border-sky-500 hover:bg-sky-50/50 transition-all print:hidden"
                                  title="Upload Photo or Snap Camera"
                                >
                                  <ImagePlus className="h-4 w-4" />
                                </button>
                              )}
                            </td>

                            <td className={`${cell} font-medium text-slate-800`}>
                              {item.productName}
                            </td>

                            <td
                              className={`${cell} font-mono text-xs text-slate-500`}
                            >
                              {item.globalSku}
                            </td>

                            <td className={cell}>
                              {editingId === item.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={editPrice}
                                    onChange={(e) => setEditPrice(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter")
                                        handlePriceSave(item.id);
                                      if (e.key === "Escape") setEditingId(null);
                                    }}
                                    className="w-24 px-2 py-1 bg-white border border-sky-400 rounded-md text-sm font-semibold text-slate-800 focus:outline-none ring-2 ring-sky-500/20"
                                  />
                                  <button
                                    onClick={() => handlePriceSave(item.id)}
                                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : (
                                <span
                                  onClick={() => {
                                    setEditingId(item.id);
                                    setEditPrice(item.msrp);
                                  }}
                                  className="cursor-pointer hover:underline font-semibold text-slate-700 hover:text-sky-700"
                                  title="Click to edit MSRP"
                                >
                                  {savingId === item.id ? "Saving..." : item.msrp}
                                </span>
                              )}
                            </td>

                            <td className={`${cell} text-center print:hidden`}>
                              <button
                                onClick={() =>
                                  handleToggleWeb(item.id, item.isWebVisible)
                                }
                                className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors mx-auto ${
                                  item.isWebVisible ? "bg-sky-600" : "bg-slate-200"
                                }`}
                                aria-label="Toggle web visibility"
                              >
                                <div
                                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                                    item.isWebVisible
                                      ? "translate-x-5"
                                      : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </td>

                            <td className={`${cell} border-r rounded-r-xl`}>
                              <div className="flex items-center justify-center gap-2">
                                <StatusPill
                                  active={item.dbSynced}
                                  title="Supabase DB"
                                >
                                  <Database className="h-4 w-4" />
                                </StatusPill>
                                <StatusPill
                                  active={item.katanaSynced}
                                  title="Katana MRP"
                                >
                                  <Cloud className="h-4 w-4" />
                                </StatusPill>
                                <StatusPill
                                  active={item.wooSynced}
                                  title="WooCommerce"
                                >
                                  <ShoppingCart className="h-4 w-4" />
                                </StatusPill>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
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

      {/* Toast */}
      {toast && (
        <div className="print:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
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
    </div>
  );
}
