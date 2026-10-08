"use client";
import { useState, useEffect } from "react";
import { X, AlertCircle, Plus, Lock } from "lucide-react";
import { previewSkuAction, getDictionaries, createDictionaryCode, canEditDictionary, getHubProductForDrawer, getListingScoreAction, updateHubInDrawer } from "../actions";
import { SkuPreviewResult } from "@/server/master-catalog/sku-preview";
import { usePathname } from "next/navigation";
import { ListingContentPanels } from "./ListingContentPanels";
import { FreightPanel } from "./FreightPanel";
import { TokenCombobox } from "./TokenCombobox";

type DictRow = { code: string; label: string; aliases?: string[] | null };
type DictOption = { key: string; code: string; label: string; display: string };

/**
 * Flatten dictionary rows so BOTH the primary label and every alias render as a
 * distinct selectable option. Every option resolves to the canonical `code`.
 */
function flattenDictOptions(rows: DictRow[]): DictOption[] {
  const out: DictOption[] = [];
  for (const r of rows) {
    const names = [r.label, ...(r.aliases ?? [])].filter(
      (n, i, arr) => !!n && arr.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i,
    );
    names.forEach((name, idx) => {
      out.push({ key: `${r.code}::${idx}`, code: r.code, label: name, display: `${name} (${r.code})` });
    });
  }
  return out;
}

export default function NewProductDrawer({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (payload: any) => Promise<string>;
}) {
  const pathname = usePathname();
  const [canEdit, setCanEdit] = useState(false);
  const [activeTab, setActiveTab] = useState("asset_vault");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedListingId, setSavedListingId] = useState<string | null>(null);
  const [hubVersion, setHubVersion] = useState(1);
  const [syncToWoo, setSyncToWoo] = useState(false);
  const [syncToClover, setSyncToClover] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelSaving, setChannelSaving] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [canSyncWoo, setCanSyncWoo] = useState(false);
  const [canSyncClover, setCanSyncClover] = useState(false);

  const [origin, setOrigin] = useState<"manufactured" | "third_party">("manufactured");
  const [productName, setProductName] = useState("");
  const [collectionCode, setCollectionCode] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [length, setLength] = useState("");
  const [depth, setDepth] = useState("");
  
  // 3rd party fields
  const [token, setToken] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorSku, setVendorSku] = useState("");
  const [wholesaleCost, setWholesaleCost] = useState("");

  const [preview, setPreview] = useState<SkuPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [collections, setCollections] = useState<DictRow[]>([]);
  const [categories, setCategories] = useState<DictRow[]>([]);
  const [tokens, setTokens] = useState<DictRow[]>([]);
  // Selected option keys (label/alias specific); the submitted value is always the canonical code.
  const [collectionOptKey, setCollectionOptKey] = useState("");
  const [categoryOptKey, setCategoryOptKey] = useState("");
  const collectionOptions = flattenDictOptions(collections);
  const categoryOptions = flattenDictOptions(categories);

  // Add Dictionary State
  const [addingDict, setAddingDict] = useState<"collection" | "category" | null>(null);
  const [dictCode, setDictCode] = useState("");
  const [dictLabel, setDictLabel] = useState("");
  const [dictSaving, setDictSaving] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);

  const loadDictionaries = () => {
    getDictionaries().then((res) => {
      setCollections(res.collections);
      setCategories(res.categories);
      setTokens(res.tokens);
      if (res.collections.length > 0 && !collectionCode) {
        setCollectionCode(res.collections[0].code);
        setCollectionOptKey(`${res.collections[0].code}::0`);
      }
      if (res.categories.length > 0 && !categoryCode) {
        setCategoryCode(res.categories[0].code);
        setCategoryOptKey(`${res.categories[0].code}::0`);
      }
    });
  };

  useEffect(() => {
    loadDictionaries();
    canEditDictionary().then(setCanEdit);
  }, []);

  useEffect(() => {
    if (activeTab !== "channels" || !savedListingId || !preview?.sku) return;
    let cancelled = false;
    const sku = preview.sku;
    const listingId = savedListingId;
    getHubProductForDrawer(sku)
      .then((hub) => getListingScoreAction(sku, listingId, hub?.factory.state ?? "missing_cad"))
      .then((score) => {
        if (cancelled || !score) return;
        setCanSyncWoo(Boolean(score.canSyncWoo));
        setCanSyncClover(Boolean(score.canSyncClover));
      })
      .catch((err) => {
        if (!cancelled) setChannelError(err instanceof Error ? err.message : "Could not load channel status");
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, savedListingId, preview?.sku]);

  async function saveChannels(confirmedPublish: boolean) {
    if (!savedListingId || !preview?.sku) return;
    if (!confirmedPublish && syncToWoo) {
      setPublishConfirmOpen(true);
      return;
    }
    setPublishConfirmOpen(false);
    setChannelSaving(true);
    setChannelError(null);
    try {
      await updateHubInDrawer(savedListingId, preview.sku, hubVersion, {
        syncToWoo,
        syncToClover,
        publishConfirmed: confirmedPublish,
      });
      setHubVersion((v) => v + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Channel save failed";
      try {
        const parsed = JSON.parse(message) as { error?: string; score?: number; failing?: string[] };
        if (parsed.error === "publish_unconfirmed") {
          setPublishConfirmOpen(true);
          return;
        }
        if (parsed.error === "sync_blocked") {
          setChannelError(`Sync blocked. Completeness score is ${parsed.score}%. Failing gates: ${(parsed.failing ?? []).join(", ")}`);
          return;
        }
      } catch {
        // not a structured gate error
      }
      setChannelError(message);
    } finally {
      setChannelSaving(false);
    }
  }

  // The EXACT label/alias the operator selected (server re-validates it against the code's row).
  const currentCollectionLabel = collectionOptions.find(o => o.key === collectionOptKey && o.code === collectionCode)?.label || "";
  const currentCategoryLabel = categoryOptions.find(o => o.key === categoryOptKey && o.code === categoryCode)?.label || "";

  useEffect(() => {
    if (savedListingId) return; // Freeze preview after save
    
    if (!productName || !collectionCode || !categoryCode || !currentCollectionLabel || !currentCategoryLabel) {
      setPreview(null);
      return;
    }
    if (origin === "manufactured" && (!length || !depth)) {
      setPreview(null);
      return;
    }
    if (origin === "third_party" && !token) {
      setPreview(null);
      return;
    }

    const t = setTimeout(() => {
      setPreviewing(true);
      previewSkuAction(productName, currentCollectionLabel, categoryCode, length, depth, null, origin, token, collectionCode, currentCategoryLabel)
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewing(false));
    }, 500);
    return () => clearTimeout(t);
  }, [productName, currentCollectionLabel, currentCategoryLabel, collectionCode, categoryCode, length, depth, origin, token, savedListingId]);

  async function handleAddDictionary() {
    if (!addingDict || !dictCode || !dictLabel) return;
    setDictSaving(true);
    setDictError(null);
    try {
      await createDictionaryCode(addingDict, dictCode, dictLabel);
      if (addingDict === "collection") {
        setCollectionCode(dictCode.toUpperCase());
        setCollectionOptKey(`${dictCode.toUpperCase()}::0`);
      } else {
        setCategoryCode(dictCode.toUpperCase());
        setCategoryOptKey(`${dictCode.toUpperCase()}::0`);
      }
      setAddingDict(null);
      setDictCode("");
      setDictLabel("");
      loadDictionaries();
    } catch (err) {
      setDictError(err instanceof Error ? err.message : "Failed to add dictionary code");
    } finally {
      setDictSaving(false);
    }
  }

  async function handleSave() {
    if (!productName || !collectionCode || !categoryCode) {
      setError("Name, Collection, and Category are required");
      return;
    }
    if (origin === "manufactured" && (!length || !depth)) {
      setError("Length and depth are required for manufactured products");
      return;
    }
    if (origin === "third_party" && (!token || !vendorName || !vendorSku || !wholesaleCost)) {
      setError("All 3rd party fields are required");
      return;
    }

    if (preview?.isCollision) {
      setError("SKU Collision: Choose a different name or dimensions.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const listingId = await onCreate({ 
        productName, 
        collectionLabel: currentCollectionLabel, 
        categoryCode, 
        categoryLabel: currentCategoryLabel,
        length, 
        depth,
        origin,
        token,
        collectionCode,
        thirdPartyFields: origin === "third_party" ? {
          vendorName,
          vendorSku,
          wholesaleCost
        } : undefined
      });
      setSavedListingId(listingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div 
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 transition-opacity" 
        onClick={() => {
          if (!savedListingId) onClose();
        }} 
      />
      <div className="fixed inset-y-0 right-0 w-[500px] bg-slate-50 shadow-2xl z-50 flex flex-col border-l border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white">
        <h2 className="font-bold text-lg text-slate-800">{savedListingId ? "Edit Product" : "Add New Product"}</h2>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 ${savedListingId ? "opacity-75 pointer-events-none" : ""}`}>
          <h3 className="font-bold text-slate-700 border-b border-slate-100 pb-2">Identity & Dimensions</h3>
          
          <div className="flex items-center gap-4 mb-4">
            <button 
              className={`flex-1 py-2 text-sm font-bold rounded-lg border transition-all ${origin === "manufactured" ? "bg-sky-50 text-sky-700 border-sky-200 shadow-inner" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
              onClick={() => setOrigin("manufactured")}
            >
              Manufactured
            </button>
            <button 
              className={`flex-1 py-2 text-sm font-bold rounded-lg border transition-all ${origin === "third_party" ? "bg-sky-50 text-sky-700 border-sky-200 shadow-inner" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
              onClick={() => setOrigin("third_party")}
            >
              3rd Party
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase">Collection</label>
                {!savedListingId && canEdit && (
                  <button onClick={() => setAddingDict("collection")} className="text-xs text-sky-600 font-bold hover:text-sky-700 flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Add Collection
                  </button>
                )}
              </div>
              {savedListingId ? (
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={collectionCode}
                    disabled
                    className="w-full p-2 pl-9 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono cursor-not-allowed"
                  />
                </div>
              ) : (
                <select
                  value={collectionOptKey}
                  onChange={e => {
                    const opt = collectionOptions.find(o => o.key === e.target.value);
                    if (!opt) return;
                    setCollectionOptKey(opt.key);
                    setCollectionCode(opt.code);
                  }}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                >
                  {collectionOptions.map(o => (
                    <option key={o.key} value={o.key}>{o.display}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase">Category</label>
                {!savedListingId && canEdit && (
                  <button onClick={() => setAddingDict("category")} className="text-xs text-sky-600 font-bold hover:text-sky-700 flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Add Category
                  </button>
                )}
              </div>
              {savedListingId ? (
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={categoryCode}
                    disabled
                    className="w-full p-2 pl-9 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono cursor-not-allowed"
                  />
                </div>
              ) : (
                <select
                  value={categoryOptKey}
                  onChange={e => {
                    const opt = categoryOptions.find(o => o.key === e.target.value);
                    if (!opt) return;
                    setCategoryOptKey(opt.key);
                    setCategoryCode(opt.code);
                  }}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                >
                  {categoryOptions.map(o => (
                    <option key={o.key} value={o.key}>{o.display}</option>
                  ))}
                </select>
              )}
            </div>
            
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Product Name</label>
              <input
                type="text"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                className="w-full mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              />
              <p className="text-[10px] text-slate-500 mt-1">Customer-facing Display Name used on the website and tear sheets (e.g., &apos;Bravada Armless Sofa 34&quot;&apos;).</p>
            </div>

            {origin === "third_party" ? (
              <div className="space-y-4 p-4 bg-amber-50 rounded-lg border border-amber-100">
                <div>
                  <label className="text-xs font-semibold text-amber-700 uppercase">SKU Token</label>
                  <TokenCombobox
                    value={token}
                    tokens={tokens}
                    onChange={setToken}
                    onCommitCustom={(code) => {
                      if (tokens.some((row) => row.code === code)) return;
                      createDictionaryCode("token", code, code)
                        .then(() => loadDictionaries())
                        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                    }}
                  />
                  <p className="text-[10px] text-amber-600 mt-1">Pick a dictionary token, or type a new one. A new token is saved with the code as its meaning until you rename it.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-amber-700 uppercase">Vendor Name</label>
                  <input
                    type="text"
                    value={vendorName}
                    onChange={e => setVendorName(e.target.value)}
                    placeholder="e.g. Sunset Brands"
                    className="w-full mt-1.5 p-2 bg-white border border-amber-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-amber-700 uppercase">Vendor SKU</label>
                  <input
                    type="text"
                    value={vendorSku}
                    onChange={e => setVendorSku(e.target.value)}
                    placeholder="e.g. SNST-1234"
                    className="w-full mt-1.5 p-2 bg-white border border-amber-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-amber-700 uppercase">Wholesale Cost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={wholesaleCost}
                    onChange={e => setWholesaleCost(e.target.value)}
                    placeholder="e.g. 450.00"
                    className="w-full mt-1.5 p-2 bg-white border border-amber-200 rounded-lg text-sm"
                  />
                  <div className="text-[10px] font-bold text-rose-600 tracking-wide mt-1">INTERNAL COST ONLY - NEVER SYNCED TO WEB OR POS</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Length (&quot;)</label>
                  <input
                    type="number"
                    value={length}
                    onChange={e => setLength(e.target.value)}
                    placeholder="e.g. 34"
                    className="w-full mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Depth (&quot;)</label>
                  <input
                    type="number"
                    value={depth}
                    onChange={e => setDepth(e.target.value)}
                    placeholder="e.g. 34"
                    className="w-full mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 p-5 rounded-xl text-white space-y-2">
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            Nomenclature Engine
          </p>
          <div className="flex items-center gap-3">
            <p className="font-mono text-lg text-sky-400 font-bold">
              {previewing ? "..." : preview?.sku || "Waiting for input..."}
            </p>
            {preview?.isCollision && (
              <span className="bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded text-xs font-bold border border-rose-500/50">
                COLLISION
              </span>
            )}
            {savedListingId && (
              <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs font-bold border border-green-500/50">
                MINTED
              </span>
            )}
          </div>
          {preview?.isCollision ? (
            <p className="text-xs text-rose-300 mt-2 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              SKU already taken by: {preview.existingProductName}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-2">
              This SKU is permanent upon creation.
            </p>
          )}
        </div>

        {savedListingId ? (
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
             <div className="flex gap-4 border-b border-slate-100 pb-2 text-sm">
                <button onClick={() => setActiveTab("asset_vault")} className={`font-bold pb-2 ${activeTab === 'asset_vault' ? 'text-sky-600 border-b-2 border-sky-600' : 'text-slate-500'}`}>Asset Vault</button>
                <button onClick={() => setActiveTab("story")} className={`font-bold pb-2 ${activeTab === 'story' ? 'text-sky-600 border-b-2 border-sky-600' : 'text-slate-500'}`}>Story</button>
                <button onClick={() => setActiveTab("seo")} className={`font-bold pb-2 ${activeTab === 'seo' ? 'text-sky-600 border-b-2 border-sky-600' : 'text-slate-500'}`}>SEO</button>
                <button onClick={() => setActiveTab("freight")} className={`font-bold pb-2 ${activeTab === 'freight' ? 'text-sky-600 border-b-2 border-sky-600' : 'text-slate-500'}`}>Freight</button>
                <button onClick={() => setActiveTab("channels")} className={`font-bold pb-2 ${activeTab === 'channels' ? 'text-sky-600 border-b-2 border-sky-600' : 'text-slate-500'}`}>Channels</button>
             </div>
             {preview?.sku && (
               <ListingContentPanels
                 listingId={savedListingId}
                 globalSku={preview.sku}
                 active={activeTab === 'asset_vault' || activeTab === 'story' || activeTab === 'seo' ? activeTab : null}
               />
             )}
             {activeTab === 'freight' && preview?.sku && savedListingId && (
               <FreightPanel
                 globalSku={preview.sku}
                 hubLength={length}
                 hubDepth={depth}
                 hubHeight=""
                 hubWeight=""
                 onDisplayExtracted={(dims) => {
                   setLength(dims.length);
                   setDepth(dims.depth);
                 }}
               />
             )}
             {activeTab === 'freight' && !savedListingId && (
               <p className="text-sm text-slate-500 p-4 text-center">Save the product before setting freight.</p>
             )}
             {activeTab === 'channels' && !savedListingId && (
               <p className="text-sm text-slate-500 p-4 text-center">Save the product before setting channels.</p>
             )}
             {activeTab === 'channels' && preview?.sku && savedListingId && (
               <MintChannelPanel
                 syncToWoo={syncToWoo}
                 syncToClover={syncToClover}
                 canSyncWoo={canSyncWoo}
                 canSyncClover={canSyncClover}
                 saving={channelSaving}
                 error={channelError}
                 onToggleWoo={setSyncToWoo}
                 onToggleClover={setSyncToClover}
                 onSave={(confirmed) => saveChannels(confirmed)}
               />
             )}
          </div>
        ) : (
          <div className="opacity-50 pointer-events-none filter grayscale transition-all">
             <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-700 border-b border-slate-100 pb-2">Asset Vault</h3>
                <p className="text-xs text-slate-500">Save the product first to generate its Hub ID and unlock the Asset Vault.</p>
             </div>
          </div>
        )}
      </div>

      {!savedListingId && (
        <div className="p-4 bg-white border-t border-slate-200">
          {error && <div className="mb-4 text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100">{error}</div>}
          <button
            onClick={handleSave}
            disabled={saving || !preview || preview.isCollision}
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:hover:bg-sky-600 text-white rounded-lg text-sm font-bold shadow-md transition-all"
          >
            {saving ? "Minting..." : "Mint New Product"}
          </button>
        </div>
      )}

      {/* Dictionary Modal */}
      {addingDict && (
        <div className="absolute inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full p-5 space-y-4">
            <h3 className="font-bold text-slate-800">
              Add New {addingDict === "collection" ? "Collection" : "Category"}
            </h3>
            {dictError && <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100">{dictError}</div>}
            
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Code</label>
              <input
                type="text"
                value={dictCode}
                onChange={e => setDictCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                placeholder="Enter 2-4 letter code (e.g., BRV)"
                className="w-full mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              />
              <p className="text-[10px] text-slate-500 mt-1">This code is permanent once any global SKU contains it.</p>
            </div>
            
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Label</label>
              <input
                type="text"
                value={dictLabel}
                onChange={e => setDictLabel(e.target.value)}
                placeholder="e.g. New Label"
                className="w-full mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button 
                onClick={() => setAddingDict(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddDictionary}
                disabled={dictSaving || !dictCode || !dictLabel}
                className="px-4 py-2 bg-sky-600 text-white text-sm font-semibold rounded-lg hover:bg-sky-500 disabled:opacity-50"
              >
                {dictSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {publishConfirmOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setPublishConfirmOpen(false)} />
          <div
            className="relative bg-white rounded-xl shadow-2xl max-w-sm w-full p-6"
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
              <button type="button" autoFocus onClick={() => setPublishConfirmOpen(false)} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-md">
                Cancel
              </button>
              <button type="button" onClick={() => saveChannels(true)} className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md">
                Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function MintChannelPanel({
  syncToWoo,
  syncToClover,
  canSyncWoo,
  canSyncClover,
  saving,
  error,
  onToggleWoo,
  onToggleClover,
  onSave,
}: {
  syncToWoo: boolean;
  syncToClover: boolean;
  canSyncWoo: boolean;
  canSyncClover: boolean;
  saving: boolean;
  error: string | null;
  onToggleWoo: (value: boolean) => void;
  onToggleClover: (value: boolean) => void;
  onSave: (confirmed: boolean) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      {error && <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100">{error}</div>}
      <label className="flex items-center gap-2 text-slate-700">
        <input type="checkbox" checked={canSyncWoo ? syncToWoo : false} disabled={!canSyncWoo || saving} onChange={(e) => onToggleWoo(e.target.checked)} />
        Sync to WooCommerce
      </label>
      <label className="flex items-center gap-2 text-slate-700">
        <input type="checkbox" checked={canSyncClover ? syncToClover : false} disabled={!canSyncClover || saving} onChange={(e) => onToggleClover(e.target.checked)} />
        Sync to Clover
      </label>
      {!canSyncWoo && (
        <p className="text-xs text-slate-500">Woo sync stays off until this product scores 100 and is web visible with a primary image.</p>
      )}
      <button
        type="button"
        onClick={() => onSave(false)}
        disabled={saving}
        className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-md disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Channels"}
      </button>
    </div>
  );
}
