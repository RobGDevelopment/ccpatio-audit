import React, { useState, useEffect } from "react";
import { X, Save, Loader2, Download, Lock } from "lucide-react";
import { EcommerceListing, getDictionaries, getListingScoreAction, generateTearSheetAction } from "../actions";
import { matchHubSku } from "@/lib/hub-sku-codes";
import { useRouter } from "next/navigation";
import { ListingContentPanels, type ListingPanelTab, type ListingPatch } from "./ListingContentPanels";
import { FreightPanel } from "./FreightPanel";

export interface ListingDrawerPayload {
  productName: string;
  drawingSection: string;
  collectionLabel: string;
  steelMsrp: string | null;
  legacyBaseSku: string | null;
  productUrl: string | null;
  salePrice: string | null;
  saleEndsAt: string | null;
  aluminumMsrp: string | null;
}

export interface HubDrawerPayload {
  length?: string | null;
  depth?: string | null;
  height?: string | null;
  armHeight?: string | null;
  sitHeight?: string | null;
  weight?: string | null;
  imageUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  slug?: string | null;
  isWebVisible?: boolean;
  marketingDescription?: string | null;
  baseCost?: string | null;
  cost?: string | null;
  syncToWoo?: boolean;
  syncToClover?: boolean;
  naFields?: string[];
  publishConfirmed?: boolean;
  assemblyRequired?: boolean;
  warrantyTermMonths?: number | null;
  warrantyCovers?: string | null;
  vendorName?: string | null;
  vendorSku?: string | null;
  wholesaleCost?: string | null;
}

export default function ProductDrawer({
  listing,
  onClose,
  onSaveListing,
  onSaveHub,
  onListingPatched,
  hubOnly,
}: {
  listing: EcommerceListing;
  onClose: () => void;
  onSaveListing: (id: string, version: number, payload: ListingDrawerPayload) => Promise<void>;
  onSaveHub: (listingId: string, globalSku: string, version: number, payload: HubDrawerPayload) => Promise<void>;
  /** Story / SEO / asset saves push their results back to the roster state. */
  onListingPatched?: (id: string, patch: Partial<EcommerceListing>) => void;
  hubOnly?: boolean;
}) {
  const [tab, setTab] = useState<"details" | ListingPanelTab>("details");
  const [localVersion, setLocalVersion] = useState(listing.version);
  const listingVersion = Math.max(localVersion, listing.version);

  const [listingSaving, setListingSaving] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  
  const [hubSaving, setHubSaving] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);

  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [skuCodes, setSkuCodes] = useState({ collectionCode: "", categoryCode: "" });
  const [skuCodeError, setSkuCodeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDictionaries()
      .then((dicts) => {
        if (cancelled) return;
        const matched = matchHubSku(
          listing.globalSku,
          dicts.collections.map((c) => c.code),
          dicts.categories.map((c) => c.code),
        );
        setSkuCodes({ collectionCode: matched.collectionCode, categoryCode: matched.categoryCode });
        setSkuCodeError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSkuCodes({ collectionCode: "", categoryCode: "" });
        setSkuCodeError(err instanceof Error ? err.message : "Could not load nomenclature codes");
      });
    return () => {
      cancelled = true;
    };
  }, [listing.globalSku]);

  // Listing state
  const [productName, setProductName] = useState(listing.productName);
  const [drawingSection, setDrawingSection] = useState(listing.drawingSection);
  const [collectionLabel, setCollectionLabel] = useState(listing.collectionLabel);
  const [msrp, setMsrp] = useState(listing.msrp === "—" ? "" : listing.msrp);
  const [legacySku, setLegacySku] = useState(listing.legacyBaseSku || "");
  const [url, setUrl] = useState(listing.productUrl || "");
  const [salePrice, setSalePrice] = useState(listing.salePrice || "");
  const [saleEndsAt, setSaleEndsAt] = useState(listing.saleEndsAt ? new Date(listing.saleEndsAt).toISOString().slice(0, 16) : "");
  const [aluminumMsrp, setAluminumMsrp] = useState(listing.aluminumMsrp ? listing.aluminumMsrp : "");
  const [marketingDescription, setMarketingDescription] = useState(listing.marketingDescription || "");
  const [constructionDetails, setConstructionDetails] = useState(listing.constructionDetails || "");

  // Hub state
  const [length, setLength] = useState(listing.hubLength || "");
  const [depth, setDepth] = useState(listing.hubDepth || "");
  const [height, setHeight] = useState(listing.hubHeight || "");
  const [armHeight, setArmHeight] = useState(listing.hubArmHeight || "");
  const [sitHeight, setSitHeight] = useState(listing.hubSitHeight || "");
  const [weight, setWeight] = useState(listing.hubWeight || "");
  const [imageUrl, setImageUrl] = useState(listing.imageUrl || "");
  const [syncToWoo, setSyncToWoo] = useState(listing.syncToWoo || false);
  const [syncToClover, setSyncToClover] = useState(listing.syncToClover || false);
  const [isWebVisible, setIsWebVisible] = useState(listing.isWebVisible || false);
  const [assemblyRequired, setAssemblyRequired] = useState(listing.assemblyRequired || false);
  const [warrantyTermMonths, setWarrantyTermMonths] = useState(listing.warrantyTermMonths?.toString() || "");
  const [warrantyCovers, setWarrantyCovers] = useState(listing.warrantyCovers || "");
  const [vendorName, setVendorName] = useState(listing.thirdParty?.vendorName || "");
  const [vendorSku, setVendorSku] = useState(listing.thirdParty?.vendorSku || "");
  const [wholesaleCost, setWholesaleCost] = useState(listing.thirdParty?.wholesaleCost || "");

  const [naFields, setNaFields] = useState<string[]>(listing.hubNaFields || []);

  const toggleNaField = (field: string) => {
    setNaFields(prev => prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]);
  };

  function handlePanelPatch(patch: ListingPatch) {
    if (patch.version !== undefined) setLocalVersion((v) => Math.max(v, patch.version!));
    if ("marketingDescription" in patch) setMarketingDescription(patch.marketingDescription ?? "");
    if ("constructionDetails" in patch) setConstructionDetails(patch.constructionDetails ?? "");
    onListingPatched?.(listing.id, {
      ...(patch.version !== undefined ? { version: patch.version } : {}),
      ...("marketingDescription" in patch ? { marketingDescription: patch.marketingDescription ?? null } : {}),
      ...("constructionDetails" in patch ? { constructionDetails: patch.constructionDetails ?? null } : {}),
    });
  }

  function handleImageUploaded(url: string) {
    setImageUrl(url);
    onListingPatched?.(listing.id, { imageUrl: url });
  }

  const [scoreData, setScoreData] = useState<{
    score: number;
    gates: any[];
    canSyncWoo: boolean;
    canSyncClover: boolean;
    heroNaAllowed: boolean;
  } | null>(null);

  useEffect(() => {
    getListingScoreAction(listing.globalSku, listing.id, listing.factory.state).then(setScoreData);
  }, [listing.globalSku, listing.id, listing.factory.state, localVersion]);

  const isComplete = scoreData?.score === 100;
  const isArchived = !!listing.archivedAt;
  
  const hasUnsavedListingEdits = 
    productName !== listing.productName ||
    drawingSection !== listing.drawingSection ||
    marketingDescription !== (listing.marketingDescription || "") ||
    msrp !== (listing.msrp === "—" ? "" : listing.msrp) ||
    url !== (listing.productUrl || "") ||
    collectionLabel !== listing.collectionLabel ||
    legacySku !== (listing.legacyBaseSku || "") ||
    salePrice !== (listing.salePrice || "") ||
    saleEndsAt !== (listing.saleEndsAt ? new Date(listing.saleEndsAt).toISOString().slice(0, 16) : "");

  const editsClear = !isArchived && !hasUnsavedListingEdits;
  const wooEnabled = editsClear && !!scoreData?.canSyncWoo;
  const cloverEnabled = editsClear && !!scoreData?.canSyncClover;
  const heroNaSet = naFields.includes("primary_image");
  const heroNaAllowed = !!scoreData?.heroNaAllowed;

  async function handleListingSave() {
    setListingSaving(true);
    setListingError(null);
    try {
      if (salePrice) {
        if (!saleEndsAt) throw new Error("Sale price requires an end date");
        const sVal = parseFloat(salePrice);
        const mVal = parseFloat(msrp.replace(/[^0-9.]/g, ""));
        if (isNaN(sVal) || sVal <= 0) throw new Error("Sale price must be > 0");
        if (!isNaN(mVal) && sVal >= mVal) throw new Error("Sale price must be < MSRP");
      }
      await onSaveListing(listing.id, listingVersion, {
        productName,
        drawingSection,
        collectionLabel,
        steelMsrp: msrp || null,
        aluminumMsrp: aluminumMsrp || null,
        legacyBaseSku: legacySku || null,
        productUrl: url || null,
        salePrice: salePrice || null,
        saleEndsAt: salePrice && saleEndsAt ? new Date(saleEndsAt).toISOString() : null,
      });
      setLocalVersion(listingVersion + 1);
    } catch (err) {
      setListingError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setListingSaving(false);
    }
  }

  async function handleHubSave(confirmedPublish = false) {
    if (!confirmedPublish && syncToWoo && !listing.syncToWoo) {
      setPublishConfirmOpen(true);
      return;
    }
    setPublishConfirmOpen(false);

    setHubSaving(true);
    setHubError(null);
    try {
      await onSaveHub(listing.id, listing.globalSku, listing.hubVersion, {
        length: length || null,
        depth: depth || null,
        height: height || null,
        armHeight: armHeight || null,
        sitHeight: sitHeight || null,
        weight: weight || null,
        syncToWoo,
        syncToClover,
        naFields,
        publishConfirmed: confirmedPublish,
        isWebVisible,
        assemblyRequired,
        warrantyTermMonths: warrantyTermMonths ? parseInt(warrantyTermMonths, 10) : null,
        warrantyCovers: warrantyCovers || null,
        vendorName: vendorName || null,
        vendorSku: vendorSku || null,
        wholesaleCost: wholesaleCost || null,
      });
      // trigger re-score
      setLocalVersion(v => v + 1);
    } catch (err) {
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.error === "sync_blocked") {
            setHubError(`Sync blocked. Completeness score is ${parsed.score}%. Failing gates: ${parsed.failing.join(", ")}`);
            return;
          } else if (parsed.error === "publish_unconfirmed") {
            setPublishConfirmOpen(true);
            return;
          }
        } catch { }
      }
      setHubError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setHubSaving(false);
    }
  }

  function handleDisplayExtracted(dims: { length: string; depth: string; height: string }) {
    setLength(dims.length);
    setDepth(dims.depth);
    setHeight(dims.height);
    setLocalVersion((v) => v + 1);
  }

  async function handleDownloadTearSheet() {
    try {
      const { pdf, omitted } = await generateTearSheetAction(listing.globalSku, listing.id);
      if (omitted?.length > 0) {
        alert("Omitted: " + omitted.map(o => o.reason).join(", "));
      }
      if (pdf) {
        const a = document.createElement("a");
        a.href = pdf.startsWith("data:") ? pdf : `data:application/pdf;base64,${pdf}`;
        a.download = `TearSheet-${listing.globalSku}.pdf`;
        a.click();
      }
    } catch (e: any) {
      alert("Error generating tear sheet: " + e.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer Panel */}
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-slate-800">
              {listing.productName}
            </h2>
            <div className="flex items-center gap-2 text-sm text-slate-500 font-mono">
              <span className="px-2 py-1 bg-slate-200/50 rounded border border-slate-200 font-bold">{listing.globalSku}</span>
              <span className="text-xs text-slate-400">This SKU is permanent.</span>
            </div>
            {listing.canonicalSkuShared && (
              <p className="text-xs font-medium text-amber-600 mt-1">
                Shared by multiple listings. Hub edits apply to all of them.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {!hubOnly && (
              <button
                onClick={handleDownloadTearSheet}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
                title="Download Tear Sheet"
              >
                <Download className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex gap-1 px-6 border-b border-slate-100 bg-white">
          {([
            ["details", "Details"],
            ["asset_vault", "Asset Vault"],
            ["story", "Story"],
            ["seo", "SEO"],
            ["freight", "Freight"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              id={`drawer-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === id
                  ? "text-sky-600 border-sky-600"
                  : "text-slate-500 border-transparent hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
          {tab === "details" && (<>
          {!hubOnly && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Listing (Applies to this row)
                </h3>
              <button
                onClick={handleListingSave}
                disabled={listingSaving}
                className="px-3 py-1.5 bg-sky-600 text-white text-xs font-semibold rounded-md hover:bg-sky-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {listingSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Listing
              </button>
            </div>
            {listingError && (
              <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded-md">
                {listingError}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-xs font-medium text-slate-600">Product Name</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Collection Label</label>
                <input
                  type="text"
                  value={collectionLabel}
                  onChange={(e) => setCollectionLabel(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Drawing Section</label>
                <input
                  type="text"
                  value={drawingSection}
                  onChange={(e) => setDrawingSection(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5 opacity-60">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Collection Code
                </label>
                <input
                  type="text"
                  value={skuCodes.collectionCode}
                  disabled
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm bg-slate-50 cursor-not-allowed"
                />
              </div>
              <div className="flex flex-col gap-1.5 opacity-60">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Category Code
                </label>
                <input
                  type="text"
                  value={skuCodes.categoryCode}
                  disabled
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm bg-slate-50 cursor-not-allowed"
                />
                {skuCodeError && <p className="text-[10px] text-rose-600">{skuCodeError}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">Steel MSRP</label>
                  <label className="text-[10px] flex items-center gap-1 text-slate-400">
                    <input type="checkbox" checked={naFields.includes("steel_msrp")} onChange={() => toggleNaField("steel_msrp")} /> N/A
                  </label>
                </div>
                <input
                  type="text"
                  value={msrp}
                  onChange={(e) => setMsrp(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">Aluminum MSRP</label>
                  <label className="text-[10px] flex items-center gap-1 text-slate-400">
                    <input type="checkbox" checked={naFields.includes("aluminum_msrp")} onChange={() => toggleNaField("aluminum_msrp")} /> N/A
                  </label>
                </div>
                <input
                  type="text"
                  value={aluminumMsrp}
                  onChange={(e) => setAluminumMsrp(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Sale Price</label>
                <input
                  type="text"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  placeholder="Leave empty for no sale"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Sale Ends At</label>
                <input
                  type="datetime-local"
                  value={saleEndsAt}
                  onChange={(e) => setSaleEndsAt(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  required={!!salePrice}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Legacy SKU</label>
                <input
                  type="text"
                  value={legacySku}
                  onChange={(e) => setLegacySku(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Product URL</label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Marketing copy and construction details are edited in the Story tab.
            </p>
          </section>
          )}

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Hub (Applies to all shared)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleHubSave()}
                  disabled={hubSaving}
                  className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-md hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {hubSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save Hub
                </button>
              </div>
            </div>
            {hubError && (
              <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded-md">
                {hubError}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Catalog Length</label>
                <input
                  type="text"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Catalog Depth</label>
                <input
                  type="text"
                  value={depth}
                  onChange={(e) => setDepth(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">Height</label>
                  <label className="text-[10px] flex items-center gap-1 text-slate-400">
                    <input type="checkbox" checked={naFields.includes("height")} onChange={() => toggleNaField("height")} /> N/A
                  </label>
                </div>
                <input
                  type="text"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">Arm Height</label>
                  <label className="text-[10px] flex items-center gap-1 text-slate-400">
                    <input type="checkbox" checked={naFields.includes("arm_height")} onChange={() => toggleNaField("arm_height")} /> N/A
                  </label>
                </div>
                <input
                  type="text"
                  value={armHeight}
                  onChange={(e) => setArmHeight(e.target.value)}
                  disabled={naFields.includes("arm_height")}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">Seat Height</label>
                  <label className="text-[10px] flex items-center gap-1 text-slate-400">
                    <input type="checkbox" checked={naFields.includes("sit_height")} onChange={() => toggleNaField("sit_height")} /> N/A
                  </label>
                </div>
                <input
                  type="text"
                  value={sitHeight}
                  onChange={(e) => setSitHeight(e.target.value)}
                  disabled={naFields.includes("sit_height")}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">Weight</label>
                  <label className="text-[10px] flex items-center gap-1 text-slate-400">
                    <input type="checkbox" checked={naFields.includes("weight")} onChange={() => toggleNaField("weight")} /> N/A
                  </label>
                </div>
                <input
                  type="text"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex items-center gap-2 mt-6">
                <input type="checkbox" id="assembly-req" checked={assemblyRequired} onChange={(e) => setAssemblyRequired(e.target.checked)} className="rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                <label htmlFor="assembly-req" className="text-sm font-medium text-slate-600">Assembly Required</label>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Warranty Term (Months)</label>
                <input
                  type="number"
                  value={warrantyTermMonths}
                  onChange={(e) => setWarrantyTermMonths(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-xs font-medium text-slate-600">Warranty Covers (Comma separated)</label>
                <input
                  type="text"
                  value={warrantyCovers}
                  onChange={(e) => setWarrantyCovers(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  placeholder="e.g. Frame, Fabric, Workmanship"
                />
              </div>
              {listing.globalSku.startsWith("3P-") && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-600">Vendor Name</label>
                    <input
                      type="text"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-600">Vendor SKU</label>
                    <input
                      type="text"
                      value={vendorSku}
                      onChange={(e) => setVendorSku(e.target.value)}
                      className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-600">Wholesale Cost</label>
                    <input
                      type="text"
                      value={wholesaleCost}
                      onChange={(e) => setWholesaleCost(e.target.value)}
                      className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                    <div className="text-[10px] font-bold text-rose-600 tracking-wide">INTERNAL COST ONLY - NEVER SYNCED TO WEB OR POS</div>
                  </div>
                </>
              )}
            </div>
            
            <div className="flex flex-col gap-1.5 mt-4 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={isWebVisible} 
                    onChange={(e) => setIsWebVisible(e.target.checked)}
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  Web Visible
                </label>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Freight Profile</h4>
              <FreightPanel
                globalSku={listing.globalSku}
                hubLength={length}
                hubDepth={depth}
                hubHeight={height}
                hubWeight={weight}
                onDisplayExtracted={handleDisplayExtracted}
              />
            </div>
            
            <div className="flex flex-col gap-1.5 mt-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-600">Factory Readiness: <span className="font-mono text-slate-800">{listing.factory.state}</span></label>
                <label className="text-[10px] flex items-center gap-1 text-slate-400">
                  <input type="checkbox" checked={naFields.includes("factory_readiness")} onChange={() => toggleNaField("factory_readiness")} /> N/A
                </label>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Primary Image</h3>
              {(heroNaAllowed || heroNaSet) && (
                <label className="text-xs flex items-center gap-1 text-slate-500">
                  <input type="checkbox" checked={heroNaSet} onChange={() => toggleNaField("primary_image")} /> N/A
                </label>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Primary" className="h-14 w-14 rounded-md object-cover border border-slate-200" />
              ) : (
                <span className="h-14 w-14 rounded-md border border-dashed border-slate-200 bg-slate-50" />
              )}
              <span>
                {imageUrl ? "Primary image on file." : "No primary image yet."}{" "}
                <button type="button" onClick={() => setTab("asset_vault")} className="font-semibold text-sky-600 hover:text-sky-700">
                  Manage in Asset Vault
                </button>
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Completeness Checklist {scoreData ? `(${scoreData.score}%)` : ""}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {scoreData?.gates?.map((g, i) => (
                <div key={g.id || i} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    {g.passed ? <span className="text-emerald-500">✓</span> : <span className="text-slate-300">○</span>}
                    <span className={g.passed ? "text-slate-700 font-medium" : "text-slate-400"}>{g.id}</span>
                  </div>
                  {!g.passed && g.reason && (
                    <span className="text-[10px] text-slate-400 ml-6">{g.reason}</span>
                  )}
                </div>
              ))}
            </div>
            
            <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={wooEnabled ? syncToWoo : false} 
                    onChange={(e) => setSyncToWoo(e.target.checked)}
                    disabled={!wooEnabled} 
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-50"
                  />
                  Sync to WooCommerce
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={cloverEnabled ? syncToClover : false}
                    onChange={(e) => setSyncToClover(e.target.checked)}
                    disabled={!cloverEnabled} 
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-50"
                  />
                  Sync to Clover
                </label>
              </div>
              {hasUnsavedListingEdits && isComplete && (
                <p className="text-xs text-amber-600 font-medium">
                  Please "Save Listing" to commit your changes before enabling sync.
                </p>
              )}
            </div>
          </section>
          </>)}

          <ListingContentPanels
            listingId={listing.id}
            globalSku={listing.globalSku}
            active={tab === "details" ? null : tab}
            externalVersion={listingVersion}
            onListingPatched={handlePanelPatch}
            onImageUploaded={handleImageUploaded}
            hubLength={length}
            hubDepth={depth}
            hubHeight={height}
            hubWeight={weight}
            onDisplayExtracted={handleDisplayExtracted}
          />
        </div>
      </div>
      
      {/* Publish Confirmation Modal */}
      {publishConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setPublishConfirmOpen(false)} />
          <div 
            className="relative bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPublishConfirmOpen(false);
            }}
          >
            <h3 className="text-lg font-bold text-slate-800 mb-2">Publish Live</h3>
            <p className="text-sm text-slate-600 mb-6 font-medium">
              WARNING: This action will publish this product live to the public e-commerce store. Are you sure you want to proceed?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                autoFocus
                onClick={() => setPublishConfirmOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition-colors focus:ring-2 focus:ring-slate-400 outline-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleHubSave(true)}
                className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors"
              >
                Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
