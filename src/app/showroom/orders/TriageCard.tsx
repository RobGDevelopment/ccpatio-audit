"use client";

import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { useMemo, useState, useTransition } from "react";
import { approveAndPushOrder } from "@/app/admin/order-triage/actions";
import { card, eyebrow, field, pillActive, pillBase } from "../showroom-ui";

export type ShowroomSku = { sku: string; name: string };
export type ShowroomOrder = {
  id: string;
  opportunityId: string;
  status: string;
  version: number;
  contactName: string | null;
  contactEmail: string | null;
  stageName: string | null;
  notes: string;
  lastError: string | null;
  urls: string[];
};

function matches(option: ShowroomSku, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return option.sku.toLowerCase().includes(needle) || option.name.toLowerCase().includes(needle);
}

function SkuCombobox({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ShowroomSku[];
  value: string;
  onChange: (sku: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => options.filter((option) => matches(option, query)).slice(0, 40),
    [options, query],
  );
  const selected = options.find((option) => option.sku === value) ?? null;

  return (
    <Combobox
      value={selected}
      onChange={(option: ShowroomSku | null) => onChange(option?.sku ?? "")}
      onClose={() => setQuery("")}
    >
      <label className="block space-y-2">
        <span className={eyebrow}>{label}</span>
        <ComboboxInput
          className={field}
          displayValue={(option: ShowroomSku | null) =>
            option ? `${option.sku} · ${option.name}` : ""
          }
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Choose ${label.toLowerCase()}`}
        />
      </label>
      <ComboboxOptions
        anchor="bottom start"
        className="z-20 mt-2 max-h-64 w-[var(--input-width)] overflow-auto rounded-2xl bg-white p-2 shadow-[0_8px_30px_rgb(0,0,0,0.08)] empty:hidden"
      >
        {filtered.map((option) => (
          <ComboboxOption
            key={option.sku}
            value={option}
            className="cursor-pointer rounded-xl px-3 py-2 text-sm data-focus:bg-slate-100"
          >
            <span className="font-medium">{option.sku}</span>
            <span className="ml-2 text-slate-500">{option.name}</span>
          </ComboboxOption>
        ))}
      </ComboboxOptions>
    </Combobox>
  );
}

export function TriageCard({
  order,
  finishedGoods,
  fabrics,
  onDone,
  onNotice,
}: {
  order: ShowroomOrder;
  finishedGoods: ShowroomSku[];
  fabrics: ShowroomSku[];
  onDone: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [finSku, setFinSku] = useState("");
  const [fabricSku, setFabricSku] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(order.lastError);
  const [pending, startTransition] = useTransition();

  function push() {
    const qty = Number(quantity);
    if (!finSku || !fabricSku || !Number.isFinite(qty) || qty <= 0) {
      setError("Choose a finished good, a fabric, and a quantity.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await approveAndPushOrder({
        id: order.id,
        version: order.version,
        lines: [{ finSku, fabricSku, quantity: qty }],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onNotice(result.message);
      onDone(order.id);
    });
  }

  return (
    <article className={`${card} grid gap-6 p-6 lg:grid-cols-2`}>
      <div className="space-y-3">
        <p className={eyebrow}>{order.stageName || "Opportunity"}</p>
        <h3 className="text-xl font-medium tracking-tight">
          {order.contactName || "Unnamed contact"}
        </h3>
        <p className="text-sm text-slate-500">{order.contactEmail || order.opportunityId}</p>
        {order.notes ? <p className="text-sm leading-6 text-slate-700">{order.notes}</p> : null}
        {order.urls.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {order.urls.map((url) => (
              <li key={url}>
                <a className="text-slate-900 underline decoration-slate-300" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs uppercase tracking-widest text-slate-400">{order.status}</p>
      </div>
      <div className="space-y-4">
        <SkuCombobox label="Finished good" options={finishedGoods} value={finSku} onChange={setFinSku} />
        <SkuCombobox label="Fabric" options={fabrics} value={fabricSku} onChange={setFabricSku} />
        <label className="block space-y-2">
          <span className={eyebrow}>Quantity</span>
          <input
            className={field}
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <button
          type="button"
          disabled={pending}
          onClick={push}
          className={`${pillBase} ${pillActive} disabled:opacity-50`}
        >
          {pending ? "Saving…" : "Push to Factory"}
        </button>
      </div>
    </article>
  );
}
