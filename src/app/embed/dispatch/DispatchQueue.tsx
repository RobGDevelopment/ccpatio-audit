"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { card, eyebrow, pillActive, pillBase } from "@/app/showroom/showroom-ui";
import { FreightEstimateNote } from "@/components/dispatch/FreightEstimateNote";
import { orderDeskPathFromHref, readActorFromHref } from "@/lib/embed-actor-params";
import { calculateFulfillmentOptions } from "@/server/actions/freight";
import { freezeDispatchOpportunity, type ReadyToShipOrder, type ReadyToShipSkidItem } from "@/server/actions/dispatch";
import { createDispatchEstimate } from "@/server/actions/order-desk";
import type {
  FreightSkid,
  FulfillmentMethod,
  FulfillmentOption,
  FulfillmentPlan,
} from "@/types/freight";

/** Packed height for one mixed skid. Product heights are not stacked. */
const PACKED_HEIGHT_IN = 40;

type CardState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "quoted"; plan: FulfillmentPlan; route: FulfillmentMethod | null };

function money(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function toFreightSkid(items: ReadyToShipSkidItem[]): FreightSkid {
  let length = 0;
  let width = 0;
  let weight = 0;
  let best = items[0]?.freightClass ?? "";
  let bestValue = Number(best);
  for (const item of items) {
    length = Math.max(length, item.lengthIn);
    width = Math.max(width, item.widthIn);
    weight += item.weightLb;
    const value = Number(item.freightClass);
    if (value > bestValue) {
      bestValue = value;
      best = item.freightClass;
    }
  }
  return {
    items: [
      {
        freightClass: best,
        weight,
        length,
        width,
        height: PACKED_HEIGHT_IN,
        packagingType: "Pallet",
        isStackable: true,
      },
    ],
  };
}

const FREIGHT_LOCK_CONFIRM =
  "Confirm Freight Selection: Proceeding will lock in this freight rate, update the Opportunity value in GoHighLevel, and freeze this quote. Do you want to continue?";

function stripMocked(value: string): string {
  return value.replace(/\bMocked\b/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

function optionFor(
  plan: FulfillmentPlan,
  method: FulfillmentMethod,
): FulfillmentOption | undefined {
  return plan.options.find((option) => option.method === method);
}

function defaultFleetMethod(plan: FulfillmentPlan): FulfillmentMethod | null {
  if (optionFor(plan, "INTERNAL_FLEET_CURBSIDE")) return "INTERNAL_FLEET_CURBSIDE";
  if (optionFor(plan, "INTERNAL_FLEET_WHITE_GLOVE")) return "INTERNAL_FLEET_WHITE_GLOVE";
  return null;
}

const estimateButtonClass =
  "inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60";

function skidLabel(items: ReadyToShipSkidItem[]): string {
  return items
    .map((item) => `${item.weightLb} lb · class ${item.freightClass}`)
    .join(", ");
}

function OrderCard({ order }: { order: ReadyToShipOrder }) {
  const router = useRouter();
  const [state, setState] = useState<CardState>({ status: "idle" });
  const [selectedLtlCarrierId, setSelectedLtlCarrierId] = useState<number | null>(null);
  const [selectedFleetMethod, setSelectedFleetMethod] = useState<FulfillmentMethod | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [handoffPending, startHandoff] = useTransition();

  function runQuote() {
    setState({ status: "idle" });
    startTransition(async () => {
      try {
        const plan = await calculateFulfillmentOptions(
          order.destZip,
          order.distanceMiles,
          toFreightSkid(order.skidItems),
        );
        const ltlOpt = optionFor(plan, "PRIORITY1_LTL");
        if (ltlOpt?.carriers?.length) {
          setSelectedLtlCarrierId(ltlOpt.carriers[0].id);
        } else {
          setSelectedLtlCarrierId(null);
        }
        setSelectedFleetMethod(defaultFleetMethod(plan));
        setHandoffError(null);
        setState({ status: "quoted", plan, route: null });
      } catch (error) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Freight quote failed.",
        });
      }
    });
  }

  function chooseRoute(method: FulfillmentMethod, selectedCarrierUsd?: number, selectedCarrierName?: string) {
    if (method.startsWith("INTERNAL_FLEET") || method === "PRIORITY1_LTL") {
      if (!window.confirm(FREIGHT_LOCK_CONFIRM)) return;
      
      if (order.ghlOpportunityId && selectedCarrierUsd != null && selectedCarrierName) {
        startTransition(async () => {
          try {
            await freezeDispatchOpportunity(order.ghlOpportunityId, selectedCarrierUsd, selectedCarrierName);
            setState((current) =>
              current.status === "quoted" ? { ...current, route: method } : current,
            );
          } catch (error) {
            setState({
              status: "error",
              message: error instanceof Error ? error.message : "GoHighLevel update failed.",
            });
          }
        });
        return;
      }
    }
    setState((current) =>
      current.status === "quoted" ? { ...current, route: method } : current,
    );
  }

  function addToEstimate(method: FulfillmentMethod, label: string, freightUsd: number) {
    setHandoffError(null);
    startHandoff(async () => {
      try {
        const actor = readActorFromHref(window.location.href);
        const result = await createDispatchEstimate({
          opportunityId: order.ghlOpportunityId,
          destZip: order.destZip,
          distanceMiles: order.distanceMiles,
          method,
          label,
          freightUsd,
          ghlUserId: actor.ghlUserId,
          ghlUserEmail: actor.ghlUserEmail,
        });
        if (!result.ok) {
          setHandoffError(result.error);
          return;
        }
        router.push(orderDeskPathFromHref(window.location.href, result));
      } catch (error) {
        setHandoffError(error instanceof Error ? error.message : "Could not add this estimate.");
      }
    });
  }

  const plan = state.status === "quoted" ? state.plan : null;
  const local = plan ? optionFor(plan, "LOCAL_WHITE_GLOVE") : undefined;
  const fleetCurbside = plan ? optionFor(plan, "INTERNAL_FLEET_CURBSIDE") : undefined;
  const fleetWhiteGlove = plan ? optionFor(plan, "INTERNAL_FLEET_WHITE_GLOVE") : undefined;
  const fleet = fleetCurbside || fleetWhiteGlove;
  const ltl = plan ? optionFor(plan, "PRIORITY1_LTL") : undefined;
  const chosen = state.status === "quoted" ? state.route : null;

  return (
    <article className={`${card} space-y-4 p-6`}>
      <div className="space-y-1">
        <p className={eyebrow}>Sales order</p>
        <h2 className="text-xl font-medium tracking-tight">{order.salesOrderNumber}</h2>
        <p className="text-sm text-slate-800">{order.customerName}</p>
        <p className="text-sm text-slate-500">Destination {order.destZip}</p>
        <p className="text-xs text-slate-400">
          {order.distanceMiles.toLocaleString("en-US")} mi · {skidLabel(order.skidItems)}
        </p>
      </div>

      {state.status !== "quoted" ? (
        <button
          type="button"
          disabled={pending}
          onClick={runQuote}
          className={`${pillBase} ${pillActive} disabled:opacity-50`}
        >
          {pending ? "Quoting…" : "Run Freight Quote"}
        </button>
      ) : null}

      {state.status === "error" ? (
        <p className="text-sm text-rose-700" role="alert">
          {state.message}
        </p>
      ) : null}

      {plan ? (
        <div className="space-y-3" aria-live="polite">
          <ul className="space-y-1 text-sm text-slate-600">
            {plan.options.map((option) => (
              <li key={option.method}>{stripMocked(option.summary)}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {local && local.priceUsd != null ? (
              <button
                type="button"
                aria-pressed={chosen === "LOCAL_WHITE_GLOVE"}
                onClick={() => chooseRoute("LOCAL_WHITE_GLOVE")}
                className={`${pillBase} bg-emerald-600 text-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:bg-emerald-500 ${
                  chosen === "LOCAL_WHITE_GLOVE" ? "ring-2 ring-emerald-800 ring-offset-2" : ""
                }`}
              >
                Dispatch CC Patio Fleet ({money(local.priceUsd)})
              </button>
            ) : null}
            {!local && fleetCurbside && fleetWhiteGlove ? (
              <div className="w-full space-y-3 pt-4 border-t border-slate-100">
                <p className="text-sm font-medium text-slate-900">CC Patio Fleet Delivery</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={selectedFleetMethod === "INTERNAL_FLEET_CURBSIDE"}
                    onClick={() => setSelectedFleetMethod("INTERNAL_FLEET_CURBSIDE")}
                    className={`${pillBase} ${pillActive} ${
                      selectedFleetMethod === "INTERNAL_FLEET_CURBSIDE" ? "ring-2 ring-slate-900 ring-offset-2" : ""
                    }`}
                  >
                    Curbside Delivery
                    {fleetCurbside.priceUsd != null ? ` (${money(fleetCurbside.priceUsd)})` : ""}
                  </button>
                  <button
                    type="button"
                    aria-pressed={selectedFleetMethod === "INTERNAL_FLEET_WHITE_GLOVE"}
                    onClick={() => setSelectedFleetMethod("INTERNAL_FLEET_WHITE_GLOVE")}
                    className={`${pillBase} ${pillActive} ${
                      selectedFleetMethod === "INTERNAL_FLEET_WHITE_GLOVE" ? "ring-2 ring-slate-900 ring-offset-2" : ""
                    }`}
                  >
                    White Glove Delivery
                    {fleetWhiteGlove.priceUsd != null ? ` (${money(fleetWhiteGlove.priceUsd)})` : ""}
                  </button>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 space-y-2">
                  {selectedFleetMethod === "INTERNAL_FLEET_CURBSIDE" ? (
                    <p><strong>Curbside:</strong> Delivered by CC Patio truck to the driveway or curb. Driver unloads to the ground; customer handles backyard placement and packaging disposal.</p>
                  ) : selectedFleetMethod === "INTERNAL_FLEET_WHITE_GLOVE" ? (
                    <p><strong>White Glove:</strong> Dedicated two-man CC Patio crew brings furniture directly to your patio, unpacks, stages the layout, inspects all pieces, and removes all pallets and debris.</p>
                  ) : (
                    <>
                      <p><strong>Curbside:</strong> Delivered by CC Patio truck to the driveway or curb. Driver unloads to the ground; customer handles backyard placement and packaging disposal.</p>
                      <p><strong>White Glove:</strong> Dedicated two-man CC Patio crew brings furniture directly to your patio, unpacks, stages the layout, inspects all pieces, and removes all pallets and debris.</p>
                    </>
                  )}
                </div>
                {selectedFleetMethod === "INTERNAL_FLEET_CURBSIDE" && fleetCurbside.priceUsd != null ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid={`dispatch-fleet-book-${order.salesOrderNumber}`}
                      aria-pressed={chosen === "INTERNAL_FLEET_CURBSIDE"}
                      onClick={() =>
                        chooseRoute("INTERNAL_FLEET_CURBSIDE", fleetCurbside.priceUsd ?? undefined, "CC Patio Fleet Curbside")
                      }
                      className={`${pillBase} bg-sky-700 text-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:bg-sky-600 ${
                        chosen === "INTERNAL_FLEET_CURBSIDE" ? "ring-2 ring-sky-900 ring-offset-2" : ""
                      }`}
                    >
                      Book Fleet - Curbside ({money(fleetCurbside.priceUsd)})
                    </button>
                    <button
                      type="button"
                      data-testid={`dispatch-fleet-estimate-${order.salesOrderNumber}`}
                      disabled={handoffPending}
                      onClick={() =>
                        addToEstimate("INTERNAL_FLEET_CURBSIDE", "CC Patio Fleet Curbside", fleetCurbside.priceUsd ?? 0)
                      }
                      className={estimateButtonClass}
                    >
                      Add to Estimate
                    </button>
                  </div>
                ) : null}
                {selectedFleetMethod === "INTERNAL_FLEET_WHITE_GLOVE" && fleetWhiteGlove.priceUsd != null ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid={`dispatch-fleet-book-${order.salesOrderNumber}`}
                      aria-pressed={chosen === "INTERNAL_FLEET_WHITE_GLOVE"}
                      onClick={() =>
                        chooseRoute(
                          "INTERNAL_FLEET_WHITE_GLOVE",
                          fleetWhiteGlove.priceUsd ?? undefined,
                          "CC Patio Fleet White Glove",
                        )
                      }
                      className={`${pillBase} bg-sky-700 text-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:bg-sky-600 ${
                        chosen === "INTERNAL_FLEET_WHITE_GLOVE" ? "ring-2 ring-sky-900 ring-offset-2" : ""
                      }`}
                    >
                      Book Fleet - White Glove ({money(fleetWhiteGlove.priceUsd)})
                    </button>
                    <button
                      type="button"
                      data-testid={`dispatch-fleet-estimate-${order.salesOrderNumber}`}
                      disabled={handoffPending}
                      onClick={() =>
                        addToEstimate(
                          "INTERNAL_FLEET_WHITE_GLOVE",
                          "CC Patio Fleet White Glove",
                          fleetWhiteGlove.priceUsd ?? 0,
                        )
                      }
                      className={estimateButtonClass}
                    >
                      Add to Estimate
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            
            {!local && ltl && ltl.carriers && ltl.carriers.length > 0 ? (
              <div className="w-full space-y-3 pt-4 border-t border-slate-100">
                <p className="text-sm font-medium text-slate-900 flex items-center justify-between">
                  Multi-Carrier LTL Options
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                    LTL Curbside Delivery Only
                  </span>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ltl.carriers.map((carrier) => (
                    <button
                      key={carrier.id}
                      type="button"
                      onClick={() => setSelectedLtlCarrierId(carrier.id)}
                      className={`rounded-xl border p-4 text-left shadow-sm transition-all ${
                        selectedLtlCarrierId === carrier.id 
                          ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600" 
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{carrier.carrierName}</span>
                        <span className="font-medium text-slate-900">{money(carrier.customerTotalUsd)}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {carrier.transitDays ? `${carrier.transitDays} Days Transit` : "Standard Transit"}
                      </div>
                    </button>
                  ))}
                </div>
                
                {selectedLtlCarrierId ? (() => {
                   const selected = ltl.carriers?.find(c => c.id === selectedLtlCarrierId);
                   if (!selected) return null;
                   return (
                     <div className="flex flex-wrap gap-2">
                       <button
                         type="button"
                         data-testid={`dispatch-ltl-book-${order.salesOrderNumber}`}
                         aria-pressed={chosen === "PRIORITY1_LTL"}
                         onClick={() => chooseRoute("PRIORITY1_LTL", selected.customerTotalUsd, selected.carrierName)}
                         className={`${pillBase} bg-sky-700 text-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:bg-sky-600 ${
                           chosen === "PRIORITY1_LTL" ? "ring-2 ring-sky-900 ring-offset-2" : ""
                         }`}
                       >
                         Book LTL - {selected.carrierName} ({money(selected.customerTotalUsd)})
                       </button>
                       <button
                         type="button"
                         data-testid={`dispatch-ltl-estimate-${order.salesOrderNumber}`}
                         disabled={handoffPending}
                         onClick={() =>
                           addToEstimate("PRIORITY1_LTL", selected.carrierName, selected.customerTotalUsd)
                         }
                         className={estimateButtonClass}
                       >
                         Add to Estimate
                       </button>
                     </div>
                   );
                })() : null}
                <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 mt-2">
                  <p><strong>Note:</strong> Third-party freight delivery via liftgate to curb or driveway only. Carrier drivers will not enter property, navigate steps, or remove pallets/debris.</p>
                </div>
              </div>
            ) : null}
          </div>
          {chosen ? (
            <p className="text-sm text-slate-700">Route selected for {order.salesOrderNumber}.</p>
          ) : null}
          {handoffError ? (
            <p className="text-sm text-rose-700" role="alert">
              {handoffError}
            </p>
          ) : null}
          <FreightEstimateNote />
        </div>
      ) : null}
    </article>
  );
}

export function DispatchQueue({
  orders,
  ghlUserId,
}: {
  orders: ReadyToShipOrder[];
  ghlUserId?: string;
}) {
  return (
    <section className="space-y-6">
      <div>
        <p className={eyebrow}>Logistics</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">Ready to Ship</h1>
        <p className="mt-2 text-sm text-slate-500">
          {orders.length === 0 ? "The queue is clear." : `${orders.length} orders waiting`}
        </p>
        {ghlUserId ? (
          <p className="mt-1 text-xs text-slate-400">GoHighLevel user {ghlUserId}</p>
        ) : null}
      </div>
      <div className="space-y-4">
        {orders.map((order) => (
          <OrderCard key={order.salesOrderNumber} order={order} />
        ))}
      </div>
    </section>
  );
}
