"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { card, eyebrow, softField } from "@/app/showroom/showroom-ui";
import { LTL_FREIGHT_CLASSES } from "@/lib/logistics-profile";
import {
  lookupDockMiles,
  searchGhlOpportunities,
  type GhlDispatchOpportunity,
} from "@/server/actions/dispatch";
import { rateProductsFromLogisticsProfiles } from "@/server/actions/freight";
import {
  getQuotingProducts,
  type QuotingProduct,
} from "@/server/actions/logistics";
import type {
  FulfillmentMethod,
  FulfillmentOption,
  FulfillmentPlan,
} from "@/types/freight";

const PRODUCT_MATCH_LIMIT = 40;

const floatCard = `${card} relative overflow-hidden border border-slate-100`;

type QuoteMode = "quick" | "opportunity";

type ProductDraft = {
  key: string;
  variantSku: string;
  name: string;
  weightLb: string;
  freightClass: string;
  lengthIn: number;
  widthIn: number;
};

type QuoteState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "quoted";
      plan: FulfillmentPlan;
      miles: number;
      route: FulfillmentMethod | null;
    };

function money(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function optionFor(
  plan: FulfillmentPlan,
  method: FulfillmentMethod,
): FulfillmentOption | undefined {
  return plan.options.find((option) => option.method === method);
}

function carrierLabel(option: FulfillmentOption): string {
  const name = option.carriers?.[0]?.carrierName?.trim();
  return name || "Shadow Pricing Matrix";
}

function specLabel(
  weightLb: string,
  freightClass: string,
  lengthIn?: number,
  widthIn?: number,
): string {
  const weight = Number(weightLb);
  const lbs = Number.isFinite(weight)
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(weight)} lbs`
    : "";
  const freight = freightClass ? `Class ${freightClass}` : "";
  const footprint =
    lengthIn != null && widthIn != null ? `${lengthIn} × ${widthIn} in` : "";
  return [lbs, freight, footprint].filter(Boolean).join(" • ");
}

function matchesProduct(product: QuotingProduct, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  return (
    product.variantSku.toLowerCase().includes(query) ||
    product.name.toLowerCase().includes(query) ||
    product.collection.toLowerCase().includes(query)
  );
}

function collectionSlug(collection: string): string {
  return collection.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function quoteIssue(destZip: string, rows: ProductDraft[]): string | null {
  if (!/^\d{5}$/.test(destZip.trim())) {
    return "Enter a 5-digit ZIP code.";
  }
  if (rows.length === 0) return "Add at least one product.";
  for (const [index, row] of rows.entries()) {
    const weight = Number(row.weightLb);
    if (!row.variantSku || !Number.isFinite(weight) || weight <= 0) {
      return `Choose a product for line ${index + 1}.`;
    }
    if (!(LTL_FREIGHT_CLASSES as readonly string[]).includes(row.freightClass)) {
      return `Choose a product for line ${index + 1}.`;
    }
  }
  return null;
}

function GoldBeam() {
  return (
    <span
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden"
      aria-hidden="true"
    >
      <span className="animate-beam-glide-lux absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent" />
    </span>
  );
}

function RouteButton({
  pressed,
  onClick,
  className,
  testId,
  title,
  detail,
}: {
  pressed: boolean;
  onClick: () => void;
  className: string;
  testId: string;
  title: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition ${className} ${
        pressed ? "ring-2 ring-offset-2" : ""
      }`}
    >
      <span className="block">{title}</span>
      {detail ? <span className="mt-1 block text-xs font-medium opacity-80">{detail}</span> : null}
    </button>
  );
}

export function DispatchPortal() {
  const titleId = useId();
  const searchRequest = useRef(0);
  const nextProduct = useRef(1);
  const [mode, setMode] = useState<QuoteMode>("quick");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [settledQuery, setSettledQuery] = useState("");
  const [results, setResults] = useState<GhlDispatchOpportunity[]>([]);
  const [opportunity, setOpportunity] = useState<GhlDispatchOpportunity | null>(null);
  const [destZip, setDestZip] = useState("");
  const [products, setProducts] = useState<QuotingProduct[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [lines, setLines] = useState<ProductDraft[]>([]);
  const [collection, setCollection] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void getQuotingProducts()
      .then((rows) => {
        if (!active) return;
        setProducts(rows);
        setCatalogError(null);
        setCatalogReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProducts([]);
        setCatalogReady(true);
        setCatalogError(error instanceof Error ? error.message : "Could not load products.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== "opportunity" || opportunity) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      setSearching(false);
      setSettledQuery("");
      return;
    }
    const requestId = ++searchRequest.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchGhlOpportunities(needle)
        .then((hits) => {
          if (requestId !== searchRequest.current) return;
          setSearching(false);
          setSettledQuery(needle);
          setResults(hits);
        })
        .catch(() => {
          if (requestId !== searchRequest.current) return;
          setSearching(false);
          setSettledQuery(needle);
          setResults([]);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [mode, opportunity, query]);

  function chooseMode(next: QuoteMode) {
    setMode(next);
    setQuote({ status: "idle" });
  }

  function chooseOpportunity(hit: GhlDispatchOpportunity) {
    setOpportunity(hit);
    setQuery(hit.contactName);
    setDestZip(hit.destZip);
    setResults([]);
    setQuote({ status: "idle" });
  }

  function chooseCollection(next: string) {
    const clearing = collection === next;
    setCollection(clearing ? null : next);
    setProductQuery("");
    setProductMenuOpen(!clearing);
    setQuote({ status: "idle" });
  }

  function commitProduct(product: QuotingProduct) {
    const key = `product-${nextProduct.current}`;
    nextProduct.current += 1;
    setLines((current) => [
      ...current,
      {
        key,
        variantSku: product.variantSku,
        name: product.name,
        weightLb: String(product.weightLb),
        freightClass: product.ltlClass,
        lengthIn: product.lengthIn,
        widthIn: product.widthIn,
      },
    ]);
    setCollection(null);
    setProductQuery("");
    setProductMenuOpen(false);
    setQuote({ status: "idle" });
  }

  function removeProduct(key: string) {
    setLines((current) => current.filter((row) => row.key !== key));
  }

  function runQuote() {
    const issue = quoteIssue(destZip, lines);
    if (issue) {
      setQuote({ status: "error", message: issue });
      return;
    }
    const zip = destZip.trim();
    setQuote({ status: "idle" });
    startTransition(async () => {
      try {
        const miles = await lookupDockMiles(zip);
        const plan = await rateProductsFromLogisticsProfiles({
          destZip: zip,
          distanceMiles: miles,
          variantSkus: lines.map((row) => row.variantSku),
        });
        setQuote({ status: "quoted", plan, miles, route: null });
      } catch (error) {
        setQuote({
          status: "error",
          message: error instanceof Error ? error.message : "Freight quote failed.",
        });
      }
    });
  }

  function chooseRoute(method: FulfillmentMethod) {
    setQuote((current) =>
      current.status === "quoted" ? { ...current, route: method } : current,
    );
  }

  const plan = quote.status === "quoted" ? quote.plan : null;
  const local = plan ? optionFor(plan, "LOCAL_WHITE_GLOVE") : undefined;
  const fleet = plan ? optionFor(plan, "INTERNAL_FLEET") : undefined;
  const ltl = plan ? optionFor(plan, "PRIORITY1_LTL") : undefined;
  const chosen = quote.status === "quoted" ? quote.route : null;
  const showPair = Boolean(fleet && ltl && !local);
  const showLtlOnly = Boolean(ltl && !local && !fleet);
  const showOpportunityList =
    !opportunity && query.trim().length >= 2 && (searching || settledQuery === query.trim());
  const collections = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const product of products) {
      if (seen.has(product.collection)) continue;
      seen.add(product.collection);
      names.push(product.collection);
    }
    return names;
  }, [products]);
  const collectionProducts = useMemo(() => {
    if (!collection) return [];
    return products
      .filter((product) => product.collection === collection && matchesProduct(product, productQuery))
      .slice(0, PRODUCT_MATCH_LIMIT);
  }, [products, collection, productQuery]);

  return (
    <section
      className="relative overflow-hidden rounded-3xl bg-[#F8F9FA] text-slate-900"
      data-testid="dispatch-portal"
    >
      <GoldBeam />
      <div className="space-y-6 p-6 sm:p-8">
        <header>
          <p className={eyebrow}>Logistics</p>
          <h1 id={titleId} className="mt-2 text-2xl font-medium tracking-tight text-slate-900">
            Shipping Quote
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-500">
            Choose a collection, then a product. Weight and freight class come from the catalog.
          </p>
        </header>

        <div
          className="inline-flex rounded-full bg-white p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          role="tablist"
          aria-label="Quote source"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "quick"}
            data-testid="dispatch-mode-quick"
            onClick={() => chooseMode("quick")}
            className={`rounded-full px-4 py-2 text-sm transition ${
              mode === "quick" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Quick Quote
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "opportunity"}
            data-testid="dispatch-mode-opportunity"
            onClick={() => chooseMode("opportunity")}
            className={`rounded-full px-4 py-2 text-sm transition ${
              mode === "opportunity" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Opportunity Quote
          </button>
        </div>

        <form
          className={`${floatCard} space-y-5 p-6`}
          onSubmit={(event) => {
            event.preventDefault();
            runQuote();
          }}
        >
          <GoldBeam />
          {mode === "opportunity" ? (
            <div className="relative">
              <label className="block text-xs uppercase tracking-widest text-slate-500" htmlFor={`${titleId}-opp`}>
                Opportunity
              </label>
              <input
                id={`${titleId}-opp`}
                data-testid="dispatch-opportunity-search"
                value={opportunity ? opportunity.contactName : query}
                onChange={(event) => {
                  setOpportunity(null);
                  setQuery(event.target.value);
                }}
                autoComplete="off"
                role="combobox"
                aria-expanded={showOpportunityList}
                aria-controls={`${titleId}-opps`}
                aria-autocomplete="list"
                placeholder="Search contacts"
                className={`${softField} mt-1`}
              />
              {opportunity ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="dispatch-opportunity-selected">
                  {opportunity.contactName}
                  {opportunity.destZip ? ` · ${opportunity.destZip}` : " · No ZIP on file"}
                  {opportunity.totalValue ? ` · ${money(opportunity.totalValue)}` : ""}
                </p>
              ) : null}
              {showOpportunityList ? (
                <ul
                  id={`${titleId}-opps`}
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-slate-100 bg-white py-1 shadow-[0_8px_30px_rgb(0,0,0,0.08)]"
                >
                  {searching ? <li className="px-3 py-2 text-sm text-slate-500">Searching…</li> : null}
                  {!searching && results.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-500">No matching opportunities.</li>
                  ) : null}
                  {results.map((hit) => (
                    <li key={hit.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        data-testid={`dispatch-opportunity-${hit.id}`}
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => chooseOpportunity(hit)}
                      >
                        <span className="text-sm text-slate-900">{hit.contactName}</span>
                        <span className="text-xs text-slate-500">
                          {hit.destZip || "No ZIP on file"}
                          {hit.totalValue ? ` · ${money(hit.totalValue)}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-500" htmlFor={`${titleId}-zip`}>
              Destination ZIP Code
            </label>
            <input
              id={`${titleId}-zip`}
              data-testid="dispatch-zip"
              value={destZip}
              onChange={(event) => setDestZip(event.target.value)}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              placeholder="85255"
              className={`${softField} mt-1 max-w-xs`}
            />
          </div>

          <fieldset className="space-y-4">
            <legend className="text-xs uppercase tracking-widest text-slate-500">Products</legend>
            <p className="text-xs text-slate-500">Rated together as one pallet.</p>
            {catalogError ? (
              <p className="text-sm text-rose-700" role="alert">
                {catalogError}
              </p>
            ) : null}
            {!catalogReady && !catalogError ? (
              <p className="text-sm text-slate-500">Loading products…</p>
            ) : null}
            {catalogReady && !catalogError && products.length === 0 ? (
              <p className="text-sm text-slate-500">No quoteable products are in the logistics catalog yet.</p>
            ) : null}
            {lines.length > 0 ? (
              <ul className="space-y-2">
                {lines.map((row, index) => (
                  <CommittedProduct
                    key={row.key}
                    row={row}
                    index={index}
                    onRemove={() => removeProduct(row.key)}
                  />
                ))}
              </ul>
            ) : null}
            {collections.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-widest text-slate-500">Collection</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Collection">
                  {collections.map((name) => {
                    const selected = collection === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={selected}
                        data-testid={`dispatch-collection-${collectionSlug(name)}`}
                        onClick={() => chooseCollection(name)}
                        className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                          selected
                            ? "border-blue-600 bg-blue-600 text-white shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
                            : "border-zinc-200 bg-zinc-100 text-zinc-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-zinc-300 hover:bg-white"
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
                {collection ? (
                  <ProductPicker
                    titleId={titleId}
                    collection={collection}
                    query={productQuery}
                    open={productMenuOpen}
                    catalogReady={catalogReady}
                    products={collectionProducts}
                    onQuery={setProductQuery}
                    onOpen={() => setProductMenuOpen(true)}
                    onClose={() => setProductMenuOpen(false)}
                    onSelect={commitProduct}
                  />
                ) : null}
              </div>
            ) : null}
          </fieldset>

          {quote.status === "error" ? (
            <p className="text-sm text-rose-700" role="alert" data-testid="dispatch-error">
              {quote.message}
            </p>
          ) : null}

          <button
            type="submit"
            data-testid="dispatch-run-quote"
            disabled={pending}
            className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Quoting…" : "Run Freight Quote"}
          </button>
        </form>

        {plan && quote.status === "quoted" ? (
          <div className={`${floatCard} space-y-4 p-6`} data-testid="dispatch-results" aria-live="polite">
            <GoldBeam />
            <div>
              <p className={eyebrow}>Quote</p>
              <h2 className="mt-2 text-lg font-medium text-slate-900">
                {plan.destinationZip} · {quote.miles.toLocaleString("en-US")} miles
              </h2>
            </div>
            <ul className="space-y-1 text-sm text-slate-600">
              {plan.options.map((option) => (
                <li key={option.method}>{option.summary}</li>
              ))}
            </ul>

            {local && local.priceUsd != null ? (
              <RouteButton
                testId="dispatch-local"
                pressed={chosen === "LOCAL_WHITE_GLOVE"}
                onClick={() => chooseRoute("LOCAL_WHITE_GLOVE")}
                className="w-full bg-emerald-600 text-white ring-emerald-800 hover:bg-emerald-500"
                title={`Dispatch CC Patio Fleet - ${money(local.priceUsd)}`}
              />
            ) : null}

            {showPair && fleet && ltl && ltl.priceUsd != null ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <RouteButton
                  testId="dispatch-fleet"
                  pressed={chosen === "INTERNAL_FLEET"}
                  onClick={() => chooseRoute("INTERNAL_FLEET")}
                  className="bg-white text-slate-900 ring-slate-900 ring-1 ring-slate-100 hover:bg-slate-50"
                  title="Route to CC Patio Fleet"
                  detail={
                    fleet.priceUsd != null ? money(fleet.priceUsd) : "Company truck"
                  }
                />
                <RouteButton
                  testId="dispatch-ltl"
                  pressed={chosen === "PRIORITY1_LTL"}
                  onClick={() => chooseRoute("PRIORITY1_LTL")}
                  className="bg-sky-700 text-white ring-sky-900 hover:bg-sky-600"
                  title={`Book Priority1 LTL - ${money(ltl.priceUsd)}`}
                  detail={carrierLabel(ltl)}
                />
              </div>
            ) : null}

            {showLtlOnly && ltl && ltl.priceUsd != null ? (
              <RouteButton
                testId="dispatch-ltl-only"
                pressed={chosen === "PRIORITY1_LTL"}
                onClick={() => chooseRoute("PRIORITY1_LTL")}
                className="w-full bg-slate-800 text-sky-100 ring-sky-400 hover:bg-slate-700"
                title={`Book Priority1 LTL - ${money(ltl.priceUsd)}`}
                detail={carrierLabel(ltl)}
              />
            ) : null}

            {chosen ? (
              <p className="text-sm text-slate-700" data-testid="dispatch-route-chosen">
                Route selected.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CommittedProduct({
  row,
  index,
  onRemove,
}: {
  row: ProductDraft;
  index: number;
  onRemove: () => void;
}) {
  const spec = specLabel(row.weightLb, row.freightClass, row.lengthIn, row.widthIn);
  const showSku = row.name.trim().toUpperCase() !== row.variantSku.trim().toUpperCase();

  return (
    <li className="flex items-start gap-2">
      <div
        className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
        data-testid={`dispatch-product-${index}`}
      >
        <p className="text-sm font-medium text-slate-900">{row.name}</p>
        {showSku ? <p className="mt-0.5 font-mono text-xs text-slate-500">{row.variantSku}</p> : null}
        {spec ? (
          <p className="mt-0.5 text-xs text-slate-500" data-testid={`dispatch-product-spec-${index}`}>
            {spec}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Remove ${row.name}`}
        data-testid={`dispatch-remove-product-${index}`}
        onClick={onRemove}
        className="rounded-xl p-3 text-slate-400 hover:bg-white hover:text-rose-600"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

function ProductPicker({
  titleId,
  collection,
  query,
  open,
  catalogReady,
  products,
  onQuery,
  onOpen,
  onClose,
  onSelect,
}: {
  titleId: string;
  collection: string;
  query: string;
  open: boolean;
  catalogReady: boolean;
  products: QuotingProduct[];
  onQuery: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (product: QuotingProduct) => void;
}) {
  const listId = `${titleId}-products`;

  return (
    <div className="relative">
      <label className="block text-xs uppercase tracking-widest text-slate-500" htmlFor={listId}>
        {collection} products
      </label>
      <input
        id={listId}
        data-testid="dispatch-product-search"
        value={query}
        onChange={(event) => {
          onQuery(event.target.value);
          onOpen();
        }}
        onFocus={onOpen}
        onBlur={() => window.setTimeout(onClose, 150)}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={`Search ${collection}`}
        className={`${softField} mt-1`}
      />
      {open ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-slate-100 bg-white py-1 shadow-[0_8px_30px_rgb(0,0,0,0.08)]"
        >
          {!catalogReady ? <li className="px-3 py-2 text-sm text-slate-500">Loading products…</li> : null}
          {catalogReady && products.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No matching products.</li>
          ) : null}
          {products.map((product) => (
            <li key={product.variantSku} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={false}
                data-testid={`dispatch-product-option-${product.variantSku}`}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(product)}
              >
                <span className="text-sm text-slate-900">{product.name}</span>
                <span className="text-xs text-slate-500">
                  {product.variantSku}
                  {" · "}
                  {specLabel(
                    String(product.weightLb),
                    product.ltlClass,
                    product.lengthIn,
                    product.widthIn,
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
