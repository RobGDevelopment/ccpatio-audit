"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Download, Loader2, Package, Truck } from "lucide-react";

export type ShippingSimulatorSku = {
  sku: string;
  label: string;
};

type QuoteRate = {
  id: string;
  label: string;
  cost: number;
  taxable: boolean;
  rateSource: string;
  estimatedTransitDays: number | null;
};

type QuoteResponse = {
  ok?: boolean;
  quoteId?: string;
  originZip?: string;
  palletSummary?: {
    palletCount: number;
    totalWeightLbs: number;
    usedFallbackDims?: boolean;
  };
  rates?: QuoteRate[];
  error?: string;
};

const ZIP_PRESETS = [
  { label: "85254 Scottsdale", postcode: "85254", state: "AZ", city: "Scottsdale" },
  { label: "92075 Solana Beach", postcode: "92075", state: "CA", city: "Solana Beach" },
  { label: "10001 New York", postcode: "10001", state: "NY", city: "New York" },
] as const;

type Props = {
  /** Partner handoff token OR empty when GHL embed cookie/header auth is enough. */
  partnerToken?: string | null;
  /** GHL embed HMAC session token (iframe / CHIPS fallback). */
  embedToken?: string | null;
  skus: ShippingSimulatorSku[];
  /** Where the plugin ZIP is served from. */
  pluginHref: string;
  testIdPrefix?: string;
};

export default function ShippingTaxjarConsole({
  partnerToken,
  embedToken,
  skus,
  pluginHref,
  testIdPrefix = "shipping-taxjar",
}: Props) {
  const skuOptions = useMemo(() => {
    if (skus.length > 0) return skus;
    return [{ sku: "FIN-BRV-84-LS", label: "Fallback certified seating SKU" }];
  }, [skus]);
  const [sku, setSku] = useState(skuOptions[0]?.sku ?? "FIN-BRV-84-LS");
  const [qty, setQty] = useState(1);
  const [presetIdx, setPresetIdx] = useState(0);
  const [customZip, setCustomZip] = useState("");
  const [busy, start] = useTransition();
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  useEffect(() => {
    if (!sku && skuOptions[0]?.sku) setSku(skuOptions[0].sku);
    if (sku && !skuOptions.some((s) => s.sku === sku) && skuOptions[0]?.sku) {
      setSku(skuOptions[0].sku);
    }
  }, [sku, skuOptions]);

  const dest = useMemo(() => {
    const zip = customZip.trim();
    if (zip) {
      return { postcode: zip, state: "", city: "", country: "US", residential: true };
    }
    const p = ZIP_PRESETS[presetIdx] ?? ZIP_PRESETS[0]!;
    return {
      postcode: p.postcode,
      state: p.state,
      city: p.city,
      country: "US",
      residential: true,
    };
  }, [customZip, presetIdx]);

  function simulate() {
    setError(null);
    start(async () => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
        };
        if (partnerToken) {
          headers["X-CCPatio-Partner-Token"] = partnerToken;
        }
        if (embedToken) {
          headers["x-ccpatio-embed-token"] = embedToken;
        }
        const qs = new URLSearchParams();
        if (partnerToken) qs.set("token", partnerToken);
        if (embedToken) qs.set("embedToken", embedToken);
        const q = qs.toString();
        const url = q ? `/api/shipping/quote?${q}` : "/api/shipping/quote";
        const res = await fetch(url, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({
            currency: "USD",
            destination: dest,
            items: [{ sku, quantity: Math.max(1, qty) }],
          }),
        });
        const json = (await res.json()) as QuoteResponse;
        if (!res.ok) {
          setResult(null);
          setError(json.error || `HTTP ${res.status}`);
          return;
        }
        setResult(json);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Quote request failed");
      }
    });
  }

  return (
    <section
      className="rounded-2xl border border-white/10 bg-[#111827] p-5"
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400"
            data-testid={`${testIdPrefix}-heading`}
          >
            <Truck className="h-4 w-4 text-amber-400" />
            Shipping Bridge &amp; TaxJar Checkout Integration
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Hub owns FedEx LTL credentials, crate dims, and{" "}
            <code className="text-slate-300">90&quot; × 40&quot; × 45&quot;</code> pallet math.
            TaxJar Professional taxes (Subtotal + Shipping) inside Woo only — do{" "}
            <strong className="font-semibold text-amber-200">NOT</strong> connect QBO inside TaxJar.
          </p>
        </div>
        <a
          href={pluginHref}
          data-testid={`${testIdPrefix}-download-zip`}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400"
        >
          <Download className="h-4 w-4" />
          Download ccpatio-hub-shipping.zip
        </a>
      </div>

      <ol
        className="mt-4 list-decimal space-y-1.5 pl-5 text-xs text-slate-300"
        data-testid={`${testIdPrefix}-setup-steps`}
      >
        <li>
          Install the bridge plugin on Woo; add <code className="text-amber-200/90">CC Patio Hub Freight</code>{" "}
          to shipping zones.
        </li>
        <li>
          Hub URL <code className="text-slate-200">https://hub.ccpatio.com</code> · header{" "}
          <code className="text-slate-200">X-CCPatio-Shipping-Secret</code> · endpoint{" "}
          <code className="text-slate-200">POST /api/shipping/quote</code>.
        </li>
        <li>
          TaxJar Professional: ship-from Phoenix factory <code className="text-slate-200">85043</code>;
          nexus AZ Scottsdale + CA Solana Beach.
        </li>
        <li>Do NOT connect QuickBooks Online inside TaxJar — Hub passes exact TaxJar totals to QBO.</li>
      </ol>

      <div
        className="mt-5 rounded-xl border border-white/10 bg-[#0b0f17] p-4"
        data-testid={`${testIdPrefix}-simulator`}
      >
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Package className="h-3.5 w-3.5" />
          Interactive Live Checkout Shipping Quote Tester
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Certified SKU
            <select
              data-testid={`${testIdPrefix}-sku`}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="mt-0.5 block w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100"
            >
              {skuOptions.map((s) => (
                <option key={s.sku} value={s.sku}>
                  {s.sku} — {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Qty
            <input
              data-testid={`${testIdPrefix}-qty`}
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="mt-0.5 block w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100"
            />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Destination preset
            <select
              data-testid={`${testIdPrefix}-preset`}
              value={presetIdx}
              onChange={(e) => {
                setPresetIdx(Number(e.target.value));
                setCustomZip("");
              }}
              className="mt-0.5 block w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
            >
              {ZIP_PRESETS.map((p, i) => (
                <option key={p.postcode} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Or custom ZIP
            <input
              data-testid={`${testIdPrefix}-zip`}
              value={customZip}
              onChange={(e) => setCustomZip(e.target.value)}
              placeholder="e.g. 90210"
              className="mt-0.5 block w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100"
            />
          </label>
        </div>
        <button
          type="button"
          data-testid={`${testIdPrefix}-simulate`}
          onClick={simulate}
          disabled={busy || !sku}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Simulate Checkout Quote
        </button>

        {error ? (
          <p className="mt-3 text-xs text-rose-300" data-testid={`${testIdPrefix}-error`}>
            {error}
          </p>
        ) : null}

        {result?.rates ? (
          <div className="mt-4 space-y-3" data-testid={`${testIdPrefix}-result`}>
            <div className="flex flex-wrap gap-3 text-xs text-slate-300">
              <span>
                Pallets:{" "}
                <strong className="text-white">{result.palletSummary?.palletCount ?? "—"}</strong>
              </span>
              <span>
                Weight:{" "}
                <strong className="text-white">
                  {result.palletSummary?.totalWeightLbs ?? "—"} lbs
                </strong>
              </span>
              <span>
                Origin: <strong className="text-white">{result.originZip ?? "—"}</strong>
              </span>
              <span>
                Quote: <code className="text-amber-200/90">{result.quoteId}</code>
              </span>
              {result.palletSummary?.usedFallbackDims ? (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-200">
                  usedFallbackDims
                </span>
              ) : null}
            </div>
            <ul className="space-y-2" data-testid={`${testIdPrefix}-rates`}>
              {result.rates.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200"
                  data-testid={`${testIdPrefix}-rate-${r.id}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{r.label}</span>
                    <span className="tabular-nums font-semibold text-amber-200">
                      ${Number(r.cost).toFixed(2)}
                      {r.taxable ? " · taxable" : " · tax-exempt"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    source=<code className="text-slate-300">{r.rateSource}</code>
                    {r.estimatedTransitDays != null
                      ? ` · ~${r.estimatedTransitDays} day(s)`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-300 underline-offset-2 hover:underline"
              data-testid={`${testIdPrefix}-toggle-json`}
              onClick={() => setJsonOpen((v) => !v)}
            >
              {jsonOpen ? "Hide" : "Show"} expandable JSON
            </button>
            {jsonOpen ? (
              <pre
                data-testid={`${testIdPrefix}-json`}
                className="max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-slate-300 ring-1 ring-white/10"
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
