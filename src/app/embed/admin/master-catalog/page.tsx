"use client";

import React, { useState, useRef, useEffect } from "react";
import { ImagePlus, Search, Check, X, Database, Cloud, ShoppingCart } from "lucide-react";

type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  msrp: string;
  webVisible: boolean;
  syncDb: boolean;
  syncKat: boolean;
  syncWoo: boolean;
  thumbnailUrl?: string;
};

type QuarantineItem = {
  id: string;
  rawDescription: string;
  targetMsrp: string;
};

const INITIAL_CATALOG: CatalogItem[] = [
  {
    id: "1",
    sku: "FIN-BRV-CLB-CHA-34X34",
    name: "Bravada Club Chair",
    msrp: "$2,080.00",
    webVisible: true,
    syncDb: true,
    syncKat: true,
    syncWoo: true,
  },
  {
    id: "2",
    sku: "FIN-OCN-COF-TAB-56X56",
    name: "Ocean Coffee Table",
    msrp: "$4,560.00",
    webVisible: true,
    syncDb: true,
    syncKat: false,
    syncWoo: true,
  },
];

const INITIAL_QUARANTINE: QuarantineItem[] = [
  { id: "q1", rawDescription: "Custom 96in Bench with extra padding", targetMsrp: "$3,400.00" },
  { id: "q2", rawDescription: "Taylor Dining Chair V2 (Teak)", targetMsrp: "$1,250.00" },
];

function InlineEditableCell({
  value,
  onSave,
  type = "text",
}: {
  value: string;
  onSave: (val: string) => void;
  type?: "text" | "msrp";
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (localValue !== value) {
      onSave(localValue);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1000);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setLocalValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="w-full rounded border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`cursor-text truncate rounded px-2 py-1 text-sm transition-colors hover:bg-slate-100 ${
        justSaved ? "bg-emerald-50 text-emerald-700 transition-none" : ""
      }`}
    >
      {value}
    </div>
  );
}

export default function MasterCatalogPage() {
  const [activeTab, setActiveTab] = useState<"catalog" | "quarantine">("catalog");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>(INITIAL_CATALOG);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>(INITIAL_QUARANTINE);

  // Modal State
  const [isMinting, setIsMinting] = useState(false);
  const [mintSource, setMintSource] = useState<QuarantineItem | null>(null);

  const [mintCollection, setMintCollection] = useState("");
  const [mintBaseName, setMintBaseName] = useState("");
  const [mintLength, setMintLength] = useState("");
  const [mintWidth, setMintWidth] = useState("");
  const [mintHeight, setMintHeight] = useState("");

  const handleMintOpen = (item: QuarantineItem) => {
    setMintSource(item);
    setMintCollection("");
    setMintBaseName("");
    setMintLength("");
    setMintWidth("");
    setMintHeight("");
    setIsMinting(true);
  };

  // Real-time SKU generator
  const generatedSku = React.useMemo(() => {
    const colPart = mintCollection ? mintCollection.substring(0, 3).toUpperCase() : "COL";
    const basePart = mintBaseName ? mintBaseName.substring(0, 3).toUpperCase() : "BAS";
    const lPart = mintLength || "L";
    const wPart = mintWidth || "W";
    return `FIN-${colPart}-${basePart}-${lPart}X${wPart}`;
  }, [mintCollection, mintBaseName, mintLength, mintWidth]);

  const isMintValid = mintCollection && mintBaseName && mintLength && mintWidth && mintHeight;

  const handleMintSave = () => {
    if (!isMintValid || !mintSource) return;

    // Optimistic Transfer
    const newItem: CatalogItem = {
      id: `new-${Date.now()}`,
      sku: generatedSku,
      name: `${mintCollection} ${mintBaseName}`,
      msrp: mintSource.targetMsrp,
      webVisible: false,
      syncDb: true,
      syncKat: false,
      syncWoo: false,
    };

    setCatalog((prev) => [newItem, ...prev]);
    setQuarantine((prev) => prev.filter((q) => q.id !== mintSource.id));
    setIsMinting(false);
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 font-sans">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header / Control Bar */}
        <div className="flex items-center justify-between rounded-2xl border border-white/40 bg-white/80 p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-md">
          <div className="flex items-center space-x-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setActiveTab("catalog")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
                activeTab === "catalog" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Active Catalog
            </button>
            <button
              onClick={() => setActiveTab("quarantine")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
                activeTab === "quarantine" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Quarantine Queue
              {quarantine.length > 0 && (
                <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-600">
                  {quarantine.length}
                </span>
              )}
            </button>
          </div>

          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search SKUs or Products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border-slate-200 bg-white/50 pl-9 pr-4 py-2 text-sm focus:border-sky-500 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Data Grid Card */}
        <div className="rounded-2xl border border-white/40 bg-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-md overflow-hidden">
          {activeTab === "catalog" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-100 bg-slate-50/50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-medium">Image</th>
                    <th className="px-6 py-4 font-medium">Product Name</th>
                    <th className="px-6 py-4 font-medium">Global SKU</th>
                    <th className="px-6 py-4 font-medium">MSRP</th>
                    <th className="px-6 py-4 font-medium">Web Visible</th>
                    <th className="px-6 py-4 font-medium">Sync Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {catalog.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-slate-50/50">
                      <td className="px-6 py-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-sky-600 cursor-pointer transition-colors">
                          <ImagePlus className="h-5 w-5" />
                        </div>
                      </td>
                      <td className="px-6 py-3 font-medium text-slate-900 w-1/4">
                        <InlineEditableCell
                          value={item.name}
                          onSave={(val) => setCatalog((c) => c.map((i) => (i.id === item.id ? { ...i, name: val } : i)))}
                        />
                      </td>
                      <td className="px-6 py-3 text-slate-500 font-mono text-xs">{item.sku}</td>
                      <td className="px-6 py-3 w-32">
                        <InlineEditableCell
                          value={item.msrp}
                          type="msrp"
                          onSave={(val) => setCatalog((c) => c.map((i) => (i.id === item.id ? { ...i, msrp: val } : i)))}
                        />
                      </td>
                      <td className="px-6 py-3">
                        <button
                          onClick={() => setCatalog((c) => c.map((i) => (i.id === item.id ? { ...i, webVisible: !i.webVisible } : i)))}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            item.webVisible ? "bg-emerald-500" : "bg-slate-200"
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              item.webVisible ? "translate-x-5" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center space-x-2">
                          <span title="Database"><Database className={`h-4 w-4 ${item.syncDb ? "text-emerald-500" : "text-slate-300"}`} /></span>
                          <span title="Katana"><Cloud className={`h-4 w-4 ${item.syncKat ? "text-sky-500" : "text-slate-300"}`} /></span>
                          <span title="WooCommerce"><ShoppingCart className={`h-4 w-4 ${item.syncWoo ? "text-purple-500" : "text-slate-300"}`} /></span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {catalog.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                        No catalog items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-100 bg-slate-50/50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-medium">Raw Description</th>
                    <th className="px-6 py-4 font-medium">Target MSRP</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {quarantine.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-slate-50/50">
                      <td className="px-6 py-4 font-medium text-slate-900">{item.rawDescription}</td>
                      <td className="px-6 py-4 text-slate-500">{item.targetMsrp}</td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                          Link Existing
                        </button>
                        <button
                          onClick={() => handleMintOpen(item)}
                          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-500"
                        >
                          Mint New
                        </button>
                      </td>
                    </tr>
                  ))}
                  {quarantine.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-slate-500">
                        Quarantine queue is empty. Great job!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Minting Slide-Over Modal */}
      {isMinting && (
        <div className="fixed inset-0 z-50 flex items-center justify-end">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={() => setIsMinting(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-in slide-in-from-right">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Mint New Product</h2>
              <button onClick={() => setIsMinting(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="rounded-xl border border-sky-100 bg-sky-50 p-4">
                <p className="text-xs font-medium text-sky-800 mb-1">Live SKU Preview</p>
                <div className="font-mono text-lg font-bold text-sky-900">{generatedSku}</div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Collection <span className="text-rose-500">*</span></label>
                  <select
                    value={mintCollection}
                    onChange={(e) => setMintCollection(e.target.value)}
                    className="w-full rounded-lg border-slate-200 py-2 text-sm focus:border-sky-500 focus:ring-sky-500"
                  >
                    <option value="">Select a collection...</option>
                    <option value="Bravada">Bravada</option>
                    <option value="Ocean">Ocean</option>
                    <option value="Taylor">Taylor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Base Name <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    placeholder="e.g., Club Chair"
                    value={mintBaseName}
                    onChange={(e) => setMintBaseName(e.target.value)}
                    className="w-full rounded-lg border-slate-200 py-2 text-sm focus:border-sky-500 focus:ring-sky-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Length <span className="text-rose-500">*</span></label>
                    <input
                      type="number"
                      placeholder="Inches"
                      value={mintLength}
                      onChange={(e) => setMintLength(e.target.value)}
                      className="w-full rounded-lg border-slate-200 py-2 text-sm focus:border-sky-500 focus:ring-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Width <span className="text-rose-500">*</span></label>
                    <input
                      type="number"
                      placeholder="Inches"
                      value={mintWidth}
                      onChange={(e) => setMintWidth(e.target.value)}
                      className="w-full rounded-lg border-slate-200 py-2 text-sm focus:border-sky-500 focus:ring-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Height <span className="text-rose-500">*</span></label>
                    <input
                      type="number"
                      placeholder="Inches"
                      value={mintHeight}
                      onChange={(e) => setMintHeight(e.target.value)}
                      className="w-full rounded-lg border-slate-200 py-2 text-sm focus:border-sky-500 focus:ring-sky-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 p-6 bg-slate-50">
              <button
                disabled={!isMintValid}
                onClick={handleMintSave}
                className="w-full flex items-center justify-center space-x-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="h-4 w-4" />
                <span>Save to Catalog</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
