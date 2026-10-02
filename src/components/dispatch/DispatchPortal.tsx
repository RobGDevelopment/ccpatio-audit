"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { card, eyebrow, softField } from "@/app/showroom/showroom-ui";
import { LTL_FREIGHT_CLASSES } from "@/lib/logistics-profile";
import {
  getEstimatedDistance,
  searchGhlOpportunities,
  type GhlDispatchOpportunity,
} from "@/server/actions/dispatch";
import { calculateFulfillmentOptions } from "@/server/actions/freight";
import type {
  FreightSkid,
  FulfillmentMethod,
  FulfillmentOption,
  FulfillmentPlan,
} from "@/types/freight";

/** One physical pallet until Katana line dimensions replace this footprint. */
const MOCK_SKID_LENGTH_IN = 90;
const MOCK_SKID_WIDTH_IN = 40;
const MOCK_SKID_HEIGHT_IN = 40;

type QuoteMode = "quick" | "opportunity";

type SkidDraft = {
  key: string;
  weightLb: string;
  freightClass: string;
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

function freshSkid(key: string): SkidDraft {
  return { key, weightLb: "", freightClass: "70" };
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

/**
 * Products share one pallet. Packed height stays inside the 36–45 in band
 * the freight rater requires, matching the ready-to-ship queue.
 */
function toFreightSkid(rows: SkidDraft[]): FreightSkid {
  const count = rows.length;
  const height =
    count <= 1
      ? MOCK_SKID_HEIGHT_IN
      : Math.round((MOCK_SKID_HEIGHT_IN / count) * 100) / 100;
  return {
    items: rows.map((row) => ({
      freightClass: row.freightClass,
      weight: Number(row.weightLb),
      length: MOCK_SKID_LENGTH_IN,
      width: MOCK_SKID_WIDTH_IN,
      height,
      packagingType: "Pallet",
      isStackable: true,
    })),
  };
}

function quoteIssue(destZip: string, rows: SkidDraft[]): string | null {
  if (!/^\d{5}$/.test(destZip.trim())) {
    return "Enter a 5-digit ZIP code.";
  }
  if (rows.length === 0) return "Add at least one skid item.";
  for (const [index, row] of rows.entries()) {
    const weight = Number(row.weightLb);
    if (!Number.isFinite(weight) || weight <= 0) {
      return `Skid item ${index + 1} needs a weight greater than 0.`;
    }
    if (!(LTL_FREIGHT_CLASSES as readonly string[]).includes(row.freightClass)) {
      return `Skid item ${index + 1} needs a standard NMFC class.`;
    }
  }
  return null;
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
  const nextSkid = useRef(2);
  const [mode, setMode] = useState<QuoteMode>("quick");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [settledQuery, setSettledQuery] = useState("");
  const [results, setResults] = useState<GhlDispatchOpportunity[]>([]);
  const [opportunity, setOpportunity] = useState<GhlDispatchOpportunity | null>(null);
  const [destZip, setDestZip] = useState("");
  const [skids, setSkids] = useState<SkidDraft[]>([freshSkid("skid-1")]);
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

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
        .catch((error: unknown) => {
          if (requestId !== searchRequest.current) return;
          setSearching(false);
          setSettledQuery(needle);
          setResults([]);
          setQuote({
            status: "error",
            message: error instanceof Error ? error.message : "Opportunity search failed.",
          });
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [mode, opportunity, query]);

  function chooseMode(next: QuoteMode) {
    setMode(next);
    setQuote({ status: "idle" });
  }

  function updateSkid(key: string, patch: Partial<Pick<SkidDraft, "weightLb" | "freightClass">>) {
    setSkids((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addSkid() {
    const key = `skid-${nextSkid.current}`;
    nextSkid.current += 1;
    setSkids((current) => [...current, freshSkid(key)]);
  }

  function removeSkid(key: string) {
    setSkids((current) => {
      if (current.length <= 1) return current;
      return current.filter((row) => row.key !== key);
    });
  }

  function runQuote() {
    const issue = quoteIssue(destZip, skids);
    if (issue) {
      setQuote({ status: "error", message: issue });
      return;
    }
    const zip = destZip.trim();
    const skid = toFreightSkid(skids);
    setQuote({ status: "idle" });
    startTransition(async () => {
      try {
        const miles = await getEstimatedDistance(zip);
        const plan = await calculateFulfillmentOptions(zip, miles, skid);
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

  return (
    <section className="space-y-6" data-testid="dispatch-portal">
      <header>
        <p className={eyebrow}>Logistics</p>
        <h1 id={titleId} className="mt-2 text-2xl font-medium tracking-tight text-zinc-900">
          Logistics & Dispatch
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-500">
          Quote a delivery from a ZIP code, or pull the destination from an opportunity.
        </p>
      </header>

      <div className="inline-flex rounded-full bg-white p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)]" role="tablist" aria-label="Quote source">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "quick"}
          data-testid="dispatch-mode-quick"
          onClick={() => chooseMode("quick")}
          className={`rounded-full px-4 py-2 text-sm transition ${
            mode === "quick" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"
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
            mode === "opportunity" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"
          }`}
        >
          Opportunity Quote
        </button>
      </div>

      <form
        className={`${card} space-y-5 p-6`}
        onSubmit={(event) => {
          event.preventDefault();
          runQuote();
        }}
      >
        {mode === "opportunity" ? (
          <div className="relative">
            <label className="block text-xs uppercase tracking-widest text-zinc-500" htmlFor={`${titleId}-opp`}>
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
              aria-expanded={!opportunity && results.length > 0}
              aria-controls={`${titleId}-opps`}
              aria-autocomplete="list"
              placeholder="Search contacts or ZIP codes"
              className={`${softField} mt-1`}
            />
            {opportunity ? (
              <p className="mt-2 text-xs text-zinc-500" data-testid="dispatch-opportunity-selected">
                {opportunity.contactName} · {opportunity.destZip} · {money(opportunity.totalValue)}
              </p>
            ) : null}
            {!opportunity &&
            query.trim().length >= 2 &&
            (searching || settledQuery === query.trim()) ? (
              <ul
                id={`${titleId}-opps`}
                role="listbox"
                className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-zinc-100 bg-white py-1 shadow-[0_8px_30px_rgb(0,0,0,0.08)]"
              >
                {searching ? <li className="px-3 py-2 text-sm text-zinc-500">Searching…</li> : null}
                {!searching && results.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-zinc-500">No matching opportunities.</li>
                ) : null}
                {results.map((hit) => (
                  <li key={hit.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      data-testid={`dispatch-opportunity-${hit.id}`}
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-zinc-50"
                      onClick={() => {
                        setOpportunity(hit);
                        setQuery(hit.contactName);
                        setDestZip(hit.destZip);
                        setResults([]);
                        setQuote({ status: "idle" });
                      }}
                    >
                      <span className="text-sm text-zinc-900">{hit.contactName}</span>
                      <span className="text-xs text-zinc-500">
                        {hit.destZip} · {money(hit.totalValue)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="block text-xs uppercase tracking-widest text-zinc-500" htmlFor={`${titleId}-zip`}>
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

        <fieldset className="space-y-3">
          <legend className="text-xs uppercase tracking-widest text-zinc-500">Skid Items</legend>
          <p className="text-xs text-zinc-500">Rated together as one pallet.</p>
          {skids.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <label className="block text-xs text-zinc-500">
                Weight (lbs)
                <input
                  data-testid={`dispatch-weight-${index}`}
                  value={row.weightLb}
                  onChange={(event) => updateSkid(row.key, { weightLb: event.target.value })}
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  className={`${softField} mt-1`}
                />
              </label>
              <label className="block text-xs text-zinc-500">
                NMFC Class
                <select
                  data-testid={`dispatch-class-${index}`}
                  value={row.freightClass}
                  onChange={(event) => updateSkid(row.key, { freightClass: event.target.value })}
                  className={`${softField} mt-1`}
                >
                  {LTL_FREIGHT_CLASSES.map((freightClass) => (
                    <option key={freightClass} value={freightClass}>
                      {freightClass}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={skids.length <= 1}
                onClick={() => removeSkid(row.key)}
                className="rounded-xl px-3 py-3 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:invisible"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            data-testid="dispatch-add-skid"
            onClick={addSkid}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:bg-zinc-50"
          >
            + Add Skid Item
          </button>
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
          className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Quoting…" : "Run Freight Quote"}
        </button>
      </form>

      {plan && quote.status === "quoted" ? (
        <div className={`${card} space-y-4 p-6`} data-testid="dispatch-results" aria-live="polite">
          <div>
            <p className={eyebrow}>Quote</p>
            <h2 className="mt-2 text-lg font-medium text-zinc-900">
              {plan.destinationZip} · {quote.miles.toLocaleString("en-US")} miles
            </h2>
          </div>
          <ul className="space-y-1 text-sm text-zinc-600">
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
                className="bg-white text-zinc-900 ring-zinc-900 ring-1 ring-zinc-100 hover:bg-zinc-50"
                title="Route to CC Patio Fleet"
                detail="Company truck"
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
              className="w-full bg-zinc-800 text-sky-100 ring-sky-400 hover:bg-zinc-700"
              title={`Book Priority1 LTL - ${money(ltl.priceUsd)}`}
              detail={carrierLabel(ltl)}
            />
          ) : null}

          {chosen ? (
            <p className="text-sm text-zinc-700" data-testid="dispatch-route-chosen">
              Route selected.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
