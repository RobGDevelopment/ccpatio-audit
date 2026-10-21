import { create } from "zustand";
import {
  discountDollars,
  lineExtended,
  quoteGrandTotal,
  roundMoney,
  type DiscountType,
} from "@/lib/quote-financials";
import type { OrderDeskLine, OrderDeskModel, OrderDeskQuote } from "@/server/quotes/view";

export type QuoteLineDraft = OrderDeskLine & {
  defaultUnitPrice: string | null;
  priceOverridden: boolean;
};

export type QuoteFinancialBreakdown = {
  subtotal: number;
  discountDollars: number;
  tax: number;
  shipping: number;
  grandTotal: number;
  depositPct: number;
  depositRequired: number;
  balanceDue: number;
};

function amountInputText(value: string | null | undefined): string {
  if (value == null) return "0";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return String(parsed);
}

function toLineDrafts(lines: OrderDeskLine[]): QuoteLineDraft[] {
  return lines.map((line) => ({
    ...line,
    defaultUnitPrice: line.unitPrice,
    priceOverridden: false,
  }));
}

export function selectQuoteFinancials(state: {
  lineItems: QuoteLineDraft[];
  discountAmount: string;
  discountType: DiscountType;
  taxAmount: string;
  freightTotal: string | null;
  depositPct: number;
}): QuoteFinancialBreakdown {
  const subtotal = roundMoney(
    state.lineItems.reduce(
      (sum, item) => sum + (lineExtended(item.unitPrice, item.qty) ?? 0),
      0,
    ),
  );
  const rawDiscount = Number(state.discountAmount.replace(/[$,\s]/g, ""));
  const rawTax = Number(state.taxAmount.replace(/[$,\s]/g, ""));
  const rawShipping = state.freightTotal != null ? Number(state.freightTotal) : 0;

  const summary = quoteGrandTotal({
    subtotal,
    discountAmount: Number.isFinite(rawDiscount) && rawDiscount >= 0 ? rawDiscount : 0,
    discountType: state.discountType,
    tax: Number.isFinite(rawTax) && rawTax >= 0 ? rawTax : 0,
    shipping: Number.isFinite(rawShipping) && rawShipping >= 0 ? rawShipping : 0,
  });

  const pct =
    Number.isFinite(state.depositPct) && state.depositPct > 0 && state.depositPct <= 100
      ? state.depositPct
      : 50;
  const depositRequired = roundMoney((summary.total * pct) / 100);
  const balanceDue = roundMoney(Math.max(0, summary.total - depositRequired));

  return {
    subtotal,
    discountDollars: discountDollars(
      subtotal,
      Number.isFinite(rawDiscount) && rawDiscount >= 0 ? rawDiscount : 0,
      state.discountType,
    ),
    tax: summary.tax,
    shipping: summary.shipping,
    grandTotal: summary.total,
    depositPct: pct,
    depositRequired,
    balanceDue,
  };
}

export interface QuoteStoreState {
  model: OrderDeskModel;
  quoteId: string | null;
  version: number;
  customerName: string;
  customerEmail: string;
  billToAddress: string;
  shipToAddress: string;
  destZip: string;
  executedBy: string;
  depositPct: number;
  discountAmount: string;
  discountType: DiscountType;
  taxAmount: string;
  freightTotal: string | null;
  lineItems: QuoteLineDraft[];
  hydrateModel: (model: OrderDeskModel) => void;
  patchQuoteState: (updater: (current: OrderDeskQuote) => OrderDeskQuote) => void;
  setVersion: (version: number) => void;
  setCustomerName: (customerName: string) => void;
  setCustomerEmail: (customerEmail: string) => void;
  setBillToAddress: (billToAddress: string) => void;
  setShipToAddress: (shipToAddress: string) => void;
  setDestZip: (destZip: string) => void;
  setExecutedBy: (executedBy: string) => void;
  setDiscountAmount: (discountAmount: string) => void;
  setDiscountType: (discountType: DiscountType) => void;
  setTaxAmount: (taxAmount: string) => void;
  updateLineQty: (lineId: string, qty: string) => void;
  updateLinePrice: (lineId: string, unitPrice: string) => void;
  updateLineDescription: (lineId: string, description: string) => void;
  removeLine: (lineId: string) => void;
  appendLine: (line: OrderDeskLine, version: number, merchandiseTotal: string | null) => void;
}

function buildStateFromModel(model: OrderDeskModel, prev?: QuoteStoreState) {
  if (model.state !== "quote") {
    return {
      model,
      quoteId: null,
      version: 1,
      customerName: "",
      customerEmail: "",
      billToAddress: "",
      shipToAddress: "",
      destZip: "",
      executedBy: "",
      depositPct: 50,
      discountAmount: "0",
      discountType: "FLAT" as DiscountType,
      taxAmount: "0",
      freightTotal: null,
      lineItems: [],
    };
  }

  const prevDefaults = new Map<string, { defaultUnitPrice: string | null; priceOverridden: boolean }>();
  if (prev && prev.quoteId === model.quoteId) {
    for (const item of prev.lineItems) {
      prevDefaults.set(item.id, {
        defaultUnitPrice: item.defaultUnitPrice,
        priceOverridden: item.priceOverridden,
      });
    }
  }

  const parsedDeposit = Number(model.depositPct ?? "50");
  const depositPct =
    Number.isFinite(parsedDeposit) && parsedDeposit > 0 && parsedDeposit <= 100
      ? parsedDeposit
      : 50;

  return {
    model,
    quoteId: model.quoteId,
    version: model.version,
    customerName: model.customerName ?? "",
    customerEmail: model.customerEmail ?? "",
    billToAddress: model.billToAddress ?? "",
    shipToAddress: model.shipToAddress ?? "",
    destZip: model.destZip ?? "",
    executedBy: model.executedBy ?? "",
    depositPct,
    discountAmount: amountInputText(model.discountAmount),
    discountType: model.discountType,
    taxAmount: amountInputText(model.taxAmount),
    freightTotal: model.freightTotal,
    lineItems: toLineDrafts(model.lines).map((draft) => {
      const prior = prevDefaults.get(draft.id);
      if (!prior) return draft;
      const defaultPrice = prior.defaultUnitPrice ?? draft.unitPrice;
      const overridden =
        prior.priceOverridden ||
        (defaultPrice != null &&
          draft.unitPrice != null &&
          Number(defaultPrice) !== Number(draft.unitPrice));
      return {
        ...draft,
        defaultUnitPrice: defaultPrice,
        priceOverridden: overridden,
      };
    }),
  };
}

export const useQuoteStore = create<QuoteStoreState>((set) => ({
  ...buildStateFromModel({ state: "needs-opportunity" }),

  hydrateModel: (model) =>
    set((state) => buildStateFromModel(model, state)),

  patchQuoteState: (updater) =>
    set((state) => {
      if (state.model.state !== "quote") return state;
      const nextQuote = updater(state.model);
      return {
        ...state,
        model: nextQuote,
        version: nextQuote.version,
        destZip: nextQuote.destZip ?? state.destZip,
        executedBy: nextQuote.executedBy ?? state.executedBy,
        freightTotal: nextQuote.freightTotal,
      };
    }),

  setVersion: (version) =>
    set((state) => ({
      version,
      model: state.model.state === "quote" ? { ...state.model, version } : state.model,
    })),

  setCustomerName: (customerName) => set({ customerName }),
  setCustomerEmail: (customerEmail) => set({ customerEmail }),
  setBillToAddress: (billToAddress) => set({ billToAddress }),
  setShipToAddress: (shipToAddress) => set({ shipToAddress }),
  setDestZip: (destZip) => set({ destZip }),
  setExecutedBy: (executedBy) => set({ executedBy }),
  setDiscountAmount: (discountAmount) => set({ discountAmount }),
  setDiscountType: (discountType) => set({ discountType }),
  setTaxAmount: (taxAmount) => set({ taxAmount }),

  updateLineQty: (lineId, qty) =>
    set((state) => {
      const lineItems = state.lineItems.map((item) =>
        item.id === lineId ? { ...item, qty } : item,
      );
      return {
        lineItems,
        model:
          state.model.state === "quote"
            ? {
                ...state.model,
                lines: state.model.lines.map((line) =>
                  line.id === lineId ? { ...line, qty } : line,
                ),
              }
            : state.model,
      };
    }),

  updateLinePrice: (lineId, unitPrice) =>
    set((state) => {
      const lineItems = state.lineItems.map((item) => {
        if (item.id !== lineId) return item;
        const cleaned = unitPrice.trim().replace(/[$,\s]/g, "");
        const defaultNum = item.defaultUnitPrice != null ? Number(item.defaultUnitPrice) : null;
        const nextNum = cleaned ? Number(cleaned) : null;
        const priceOverridden =
          defaultNum != null && nextNum != null && Number.isFinite(nextNum)
            ? Math.abs(defaultNum - nextNum) > 0.004
            : cleaned.length > 0;
        return {
          ...item,
          unitPrice: cleaned,
          priceError: null,
          priceOverridden,
        };
      });
      return {
        lineItems,
        model:
          state.model.state === "quote"
            ? {
                ...state.model,
                lines: state.model.lines.map((line) =>
                  line.id === lineId
                    ? { ...line, unitPrice: unitPrice.trim().replace(/[$,\s]/g, ""), priceError: null }
                    : line,
                ),
              }
            : state.model,
      };
    }),

  updateLineDescription: (lineId, description) =>
    set((state) => {
      const lineItems = state.lineItems.map((item) =>
        item.id === lineId ? { ...item, description } : item,
      );
      return {
        lineItems,
        model:
          state.model.state === "quote"
            ? {
                ...state.model,
                lines: state.model.lines.map((line) =>
                  line.id === lineId ? { ...line, description } : line,
                ),
              }
            : state.model,
      };
    }),

  removeLine: (lineId) =>
    set((state) => {
      const lineItems = state.lineItems.filter((item) => item.id !== lineId);
      return {
        lineItems,
        model:
          state.model.state === "quote"
            ? {
                ...state.model,
                lines: state.model.lines.filter((line) => line.id !== lineId),
              }
            : state.model,
      };
    }),

  appendLine: (line, version, merchandiseTotal) =>
    set((state) => {
      const nextDraft: QuoteLineDraft = {
        ...line,
        defaultUnitPrice: line.unitPrice,
        priceOverridden: false,
      };
      const lineItems = [...state.lineItems, nextDraft];
      return {
        version,
        lineItems,
        model:
          state.model.state === "quote"
            ? {
                ...state.model,
                version,
                merchandiseTotal,
                lines: [...state.model.lines, line],
              }
            : state.model,
      };
    }),
}));
