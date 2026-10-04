"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { normalizeLegacySku, normalizeProductUrl } from "@/lib/ecommerce-roster";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Search,
} from "lucide-react";
import type { EcommerceListing, EcommerceRosterGap } from "../actions";
import EcommerceFilters, {
  applyEcommerceFilters,
  type EcommerceFilterState,
} from "./EcommerceFilters";
import EcommerceExpandedRow, { FactoryBadge } from "./EcommerceExpandedRow";

type SortKey = "name" | "sku" | "legacy" | "msrp";
type SortDir = "asc" | "desc";
type PillKey =
  | "listings"
  | "gaps"
  | "missing_links"
  | "missing_legacy"
  | "not_published";

const COLUMN_COUNT = 7; // chevron, name, canonical SKU, legacy SKU, MSRP, factory, link

type EditorField = "url" | "legacy";
interface InlineEditor {
  id: string;
  field: EditorField;
  value: string;
  error: string | null;
  saving: boolean;
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={`py-3 px-4 ${className}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`flex items-center gap-1 uppercase text-[11px] font-semibold tracking-wider transition-colors ${
          active ? "text-sky-700" : "text-slate-400 hover:text-slate-600"
        }`}
      >
        {label}
        {active &&
          (sort.dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          ))}
      </button>
    </th>
  );
}

function StatPill({
  label,
  value,
  warn,
  pressed,
  onClick,
}: {
  label: string;
  value: number;
  warn?: boolean;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border transition-all ${
        pressed
          ? "bg-sky-600 border-sky-600 shadow-sm"
          : "bg-white border-slate-200 hover:border-sky-300"
      }`}
    >
      <span
        className={`text-lg font-bold ${
          pressed
            ? "text-white"
            : warn && value > 0
              ? "text-amber-600"
              : "text-slate-800"
        }`}
      >
        {value}
      </span>
      <span className={`text-xs ${pressed ? "text-sky-100" : "text-slate-500"}`}>
        {label}
      </span>
    </button>
  );
}

export default function EcommerceGrid({
  listings,
  gaps,
  onSaveMsrp,
  onSaveUrl,
  onSaveLegacy,
  onMintHub,
}: {
  listings: EcommerceListing[];
  gaps: EcommerceRosterGap[];
  /** Persists a steel MSRP edit for a listing id (parent calls updateListingMsrp + updates state). */
  onSaveMsrp: (listingId: string, rawPrice: string) => Promise<void>;
  /** Optimistic link save; the parent patches state and rolls back + throws on failure. */
  onSaveUrl: (listingId: string, raw: string) => Promise<void>;
  /** Optimistic legacy SKU save; same contract as onSaveUrl. */
  onSaveLegacy: (listingId: string, raw: string) => Promise<void>;
  /** Mints the hub SKU for a gap group; resolves after the transaction commits. */
  onMintHub: (globalSku: string) => Promise<void>;
}) {
  const [filters, setFilters] = useState<EcommerceFilterState>({
    search: "",
    collections: new Set(),
    types: new Set(),
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "name",
    dir: "asc",
  });
  const [expandedId, setExpandedId] = useState<string | null>(null); // one at a time
  const [pill, setPill] = useState<PillKey>("listings"); // exclusive; re-click returns to listings

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);

  // Inline link / legacy SKU editor. Lives here (not in the cell) so a failed
  // save keeps the input open with its error even after the row is restored.
  const [editor, setEditor] = useState<InlineEditor | null>(null);
  const settledRef = useRef(false); // ignores the blur that follows Enter
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editor && !editor.saving && editor.error) inputRef.current?.focus();
  }, [editor]);

  // Hub gap mint: wait for the server; no optimistic delete.
  const [mintingSku, setMintingSku] = useState<string | null>(null);
  const [mintError, setMintError] = useState<{ sku: string; message: string } | null>(
    null,
  );

  // Pill slice first; search + facets then narrow within it.
  const slice = useMemo(() => {
    switch (pill) {
      case "missing_links":
        return listings.filter((l) => l.urlSource === "missing");
      case "missing_legacy":
        return listings.filter((l) => !l.legacyBaseSku);
      case "not_published":
        return listings.filter((l) => l.factory.state !== "published");
      default:
        return listings;
    }
  }, [listings, pill]);

  const gapRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return gaps;
    return gaps.filter(
      (g) =>
        g.productName.toLowerCase().includes(q) ||
        g.globalSku.toLowerCase().includes(q) ||
        g.reason.toLowerCase().includes(q),
    );
  }, [gaps, filters.search]);

  const rows = useMemo(() => {
    const filtered = applyEcommerceFilters(slice, filters);
    const dir = sort.dir === "asc" ? 1 : -1;
    const str = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) * dir;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return str(a.productName, b.productName);
        case "sku":
          return str(a.globalSku, b.globalSku);
        case "legacy": {
          // Null legacy SKUs always sort last, regardless of direction.
          if (!a.legacyBaseSku && !b.legacyBaseSku) return 0;
          if (!a.legacyBaseSku) return 1;
          if (!b.legacyBaseSku) return -1;
          return str(a.legacyBaseSku, b.legacyBaseSku);
        }
        case "msrp": {
          // Null prices always sort last, regardless of direction.
          if (a.msrpValue === null && b.msrpValue === null) return 0;
          if (a.msrpValue === null) return 1;
          if (b.msrpValue === null) return -1;
          return (a.msrpValue - b.msrpValue) * dir; // numeric parse, not string
        }
      }
    });
  }, [slice, filters, sort]);

  const missingLinks = listings.filter((l) => l.urlSource === "missing").length;
  const missingLegacy = listings.filter((l) => !l.legacyBaseSku).length;
  const notPublished = listings.filter((l) => l.factory.state !== "published").length;
  const gapsView = pill === "gaps";

  function togglePill(next: PillKey) {
    setPill((cur) => (cur === next ? "listings" : next));
    setExpandedId(null);
    setEditingId(null);
  }

  function handleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  function openEditor(id: string, field: EditorField) {
    if (editor?.saving) return;
    settledRef.current = false;
    setEditor({ id, field, value: "", error: null, saving: false });
  }

  function cancelEditor() {
    if (editor?.saving) return;
    settledRef.current = true;
    setEditor(null);
  }

  async function commitEditor() {
    if (!editor || editor.saving || settledRef.current) return;
    const check =
      editor.field === "url"
        ? normalizeProductUrl(editor.value)
        : normalizeLegacySku(editor.value);
    if (!check.ok) {
      setEditor({ ...editor, error: check.error });
      return;
    }
    settledRef.current = true;
    const { id, field, value } = editor;
    setEditor({ ...editor, error: null, saving: true });
    try {
      await (field === "url" ? onSaveUrl(id, value) : onSaveLegacy(id, value));
      setEditor(null);
    } catch (err) {
      settledRef.current = false;
      setEditor((cur) =>
        cur
          ? {
              ...cur,
              saving: false,
              error: err instanceof Error ? err.message : "Save failed.",
            }
          : cur,
      );
    }
  }

  async function mint(globalSku: string) {
    if (mintingSku) return;
    setMintingSku(globalSku);
    setMintError(null);
    try {
      await onMintHub(globalSku);
    } catch (err) {
      setMintError({
        sku: globalSku,
        message: err instanceof Error ? err.message : "Mint failed.",
      });
    } finally {
      setMintingSku(null);
    }
  }

  const isEditing = (id: string, field: EditorField) =>
    editor?.id === id && editor.field === field;

  function renderEditorInput(placeholder: string) {
    if (!editor) return null;
    return (
      <div className="flex flex-col gap-1">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={editor.value}
          disabled={editor.saving}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={editor.error ? true : undefined}
          onChange={(e) => setEditor({ ...editor, value: e.target.value, error: null })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitEditor();
            }
            if (e.key === "Escape") cancelEditor();
          }}
          onBlur={() => {
            if (settledRef.current) return; // Enter already handled this edit
            if (!editor.value.trim()) cancelEditor();
            else void commitEditor();
          }}
          className={`w-44 px-2 py-1 bg-white border rounded-md text-xs text-slate-800 focus:outline-none ring-2 disabled:opacity-60 ${
            editor.error
              ? "border-rose-400 ring-rose-500/20"
              : "border-sky-400 ring-sky-500/20"
          }`}
        />
        {editor.error && (
          <span role="alert" className="text-[10px] text-rose-600 max-w-[16rem]">
            {editor.error}
          </span>
        )}
      </div>
    );
  }

  function renderGhost(id: string, field: EditorField, label: string) {
    return (
      <button
        type="button"
        onClick={() => openEditor(id, field)}
        disabled={editor?.saving === true}
        className="px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-[11px] font-semibold text-slate-400 hover:border-sky-400 hover:text-sky-700 transition-colors disabled:opacity-50"
      >
        {label}
      </button>
    );
  }

  async function save(id: string) {
    if (!editPrice.trim()) {
      setEditingId(null);
      return;
    }
    setSavingId(id);
    try {
      await onSaveMsrp(id, editPrice);
      setJustSavedId(id);
      setTimeout(() => setJustSavedId(null), 1500);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingId(null);
      setEditingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white/90 backdrop-blur shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header: exclusive toggle pills + filters */}
      <div className="p-5 border-b border-slate-100 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatPill
            label="listings"
            value={listings.length}
            pressed={pill === "listings"}
            onClick={() => togglePill("listings")}
          />
          <StatPill
            label="hub gaps"
            value={gaps.length}
            warn
            pressed={pill === "gaps"}
            onClick={() => togglePill("gaps")}
          />
          <StatPill
            label="missing links"
            value={missingLinks}
            warn
            pressed={pill === "missing_links"}
            onClick={() => togglePill("missing_links")}
          />
          <StatPill
            label="missing legacy SKU"
            value={missingLegacy}
            warn
            pressed={pill === "missing_legacy"}
            onClick={() => togglePill("missing_legacy")}
          />
          <StatPill
            label="not published"
            value={notPublished}
            warn
            pressed={pill === "not_published"}
            onClick={() => togglePill("not_published")}
          />
          <span className="ml-auto text-xs text-slate-400">
            {gapsView
              ? `Showing ${gapRows.length} of ${gaps.length}`
              : `Showing ${rows.length} of ${slice.length}`}
          </span>
        </div>
        {gapsView ? (
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Search name, missing SKU, or reason..."
              aria-label="Search hub gaps"
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all placeholder:text-slate-400"
            />
          </div>
        ) : (
          <EcommerceFilters listings={slice} filters={filters} onChange={setFilters} />
        )}
      </div>

      {gapsView ? (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-100">
              <tr className="uppercase text-[11px] font-semibold tracking-wider text-slate-400">
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">Missing SKU</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Resolution</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {gapRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-slate-400">
                    No hub gaps match this search.
                  </td>
                </tr>
              )}
              {gapRows.map((g) => {
                const minting = mintingSku === g.globalSku;
                return (
                  <tr
                    key={`${g.globalSku}|${g.productName}`}
                    className={`border-b border-slate-100 ${
                      minting ? "opacity-60" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <td className="py-3 px-4 font-medium text-slate-800">{g.productName}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{g.globalSku}</td>
                    <td className="py-3 px-4 text-slate-600">{g.reason}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col items-start gap-1.5">
                        <span className="text-xs text-slate-500">
                          Hub SKU is not in the hub. Mint it here before a CAD drop will stick.
                        </span>
                        <button
                          type="button"
                          onClick={() => void mint(g.globalSku)}
                          disabled={mintingSku !== null}
                          className="px-3 py-1 rounded-full text-xs font-semibold bg-sky-600 text-white hover:bg-sky-700 transition-colors disabled:opacity-50"
                        >
                          {minting ? "Minting…" : "Mint hub SKU"}
                        </button>
                        {mintError?.sku === g.globalSku && (
                          <span role="alert" className="text-[11px] text-rose-600">
                            {mintError.message}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
      /* Scroll container with sticky header */
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-100">
            <tr>
              <th className="py-3 px-4 w-10" aria-label="Expand" />
              <SortHeader label="Product Name" k="name" sort={sort} onSort={handleSort} />
              <SortHeader
                label="Canonical Hub SKU"
                k="sku"
                sort={sort}
                onSort={handleSort}
              />
              <SortHeader label="Legacy SKU" k="legacy" sort={sort} onSort={handleSort} />
              <SortHeader
                label="MSRP"
                k="msrp"
                sort={sort}
                onSort={handleSort}
                className="w-36"
              />
              <th className="py-3 px-4 uppercase text-[11px] font-semibold tracking-wider text-slate-400">
                Factory
              </th>
              <th className="py-3 px-4 uppercase text-[11px] font-semibold tracking-wider text-slate-400">
                Product Link
              </th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="py-16 text-center text-slate-400">
                  No listings match these filters.
                </td>
              </tr>
            )}
            {rows.map((l) => {
              const open = expandedId === l.id;
              const flash = justSavedId === l.id;
              return (
                <React.Fragment key={l.id}>
                  <tr
                    className={`border-b border-slate-100 transition-colors ${
                      flash ? "bg-emerald-50" : open ? "bg-sky-50/40" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : l.id)}
                        aria-expanded={open}
                        aria-label={open ? "Collapse row" : "Expand row"}
                        className="text-slate-400 hover:text-sky-600 transition-colors"
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>

                    <td className="py-3 px-4 font-medium text-slate-800">
                      {l.productName}
                    </td>

                    <td className="py-3 px-4 text-xs">
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-slate-600">{l.globalSku}</span>
                        {l.canonicalSkuShared && (
                          <span
                            title="Another listing uses this canonical hub SKU"
                            className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide"
                          >
                            shared
                          </span>
                        )}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-xs">
                      {isEditing(l.id, "legacy") ? (
                        renderEditorInput("LEGACY-SKU")
                      ) : l.legacyBaseSku ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono text-slate-500">
                            {l.legacyBaseSku}
                          </span>
                          {l.legacySkuShared && (
                            <span
                              title="Another canonical SKU uses this legacy base SKU"
                              className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide"
                            >
                              shared
                            </span>
                          )}
                        </span>
                      ) : (
                        renderGhost(l.id, "legacy", "+ Add Legacy SKU")
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {editingId === l.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") save(l.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-24 px-2 py-1 bg-white border border-sky-400 rounded-md text-sm font-semibold text-slate-800 focus:outline-none ring-2 ring-sky-500/20"
                          />
                          <button
                            type="button"
                            onClick={() => save(l.id)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            aria-label="Save price"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => {
                            setEditingId(l.id);
                            setEditPrice(l.msrpValue === null ? "" : l.msrp);
                          }}
                          className="cursor-pointer hover:underline font-semibold text-slate-700 hover:text-sky-700"
                          title="Click to edit steel MSRP"
                        >
                          {savingId === l.id ? "Saving..." : l.msrp}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <FactoryBadge factory={l.factory} />
                    </td>

                    <td className="py-3 px-4 text-xs">
                      {isEditing(l.id, "url") ? (
                        renderEditorInput("https://…")
                      ) : l.productUrl ? (
                        <span className="inline-flex items-center gap-2">
                          <a
                            href={l.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-700 hover:underline whitespace-nowrap"
                          >
                            ↗ View Live
                          </a>
                          {l.urlSource === "sibling" && (
                            <span className="text-[10px] text-slate-400">shared page</span>
                          )}
                        </span>
                      ) : (
                        renderGhost(l.id, "url", "+ Add Link")
                      )}
                    </td>
                  </tr>
                  {open && <EcommerceExpandedRow listing={l} colSpan={COLUMN_COUNT} />}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
