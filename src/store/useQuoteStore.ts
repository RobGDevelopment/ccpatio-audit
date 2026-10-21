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
  taxAmount: number;
  shipping: number;
  grandTotal: number;
  depositPct: number;
  depositRequired: number;
  requiredDeposit: number;
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
  lineItems?: QuoteLineDraft[];
  quoteItems?: QuoteLineDraft[];
  discountAmount: string;
  discountType: DiscountType;
  taxAmount?: string;
  taxRate?: number | string;
  freightTotal?: string | null;
  shippingCost?: string | number | null;
  depositPct: number;
}): QuoteFinancialBreakdown {
  const items = state.lineItems ?? state.quoteItems ?? [];
  const subtotal = roundMoney(
    items.reduce(
      (sum, item) => sum + (lineExtended(item.unitPrice, item.qty) ?? 0),
      0,
    ),
  );
  const rawDiscount = Number(state.discountAmount.replace(/[$,\s]/g, ""));
  const rawTax = Number((state.taxAmount ?? "0").replace(/[$,\s]/g, ""));
  const rawTaxRate = state.taxRate != null ? Number(String(state.taxRate).replace(/[%,\s]/g, "")) : 0;
  const shippingSource =
    state.shippingCost !== undefined && state.shippingCost !== null && String(state.shippingCost).trim() !== ""
      ? state.shippingCost
      : state.freightTotal;
  const rawShipping =
    shippingSource != null ? Number(String(shippingSource).replace(/[$,\s]/g, "")) : 0;

  const validDiscount = Number.isFinite(rawDiscount) && rawDiscount >= 0 ? rawDiscount : 0;
  const computedDiscount = discountDollars(subtotal, validDiscount, state.discountType);
  const netBeforeTax = Math.max(0, roundMoney(subtotal - computedDiscount));
  const rateTax =
    Number.isFinite(rawTaxRate) && rawTaxRate > 0
      ? roundMoney((netBeforeTax * rawTaxRate) / 100)
      : 0;
  const effectiveTax =
    Number.isFinite(rawTax) && rawTax > 0
      ? rawTax
      : rateTax;

  const summary = quoteGrandTotal({
    subtotal,
    discountAmount: validDiscount,
    discountType: state.discountType,
    tax: effectiveTax,
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
    discountDollars: computedDiscount,
    tax: summary.tax,
    taxAmount: summary.tax,
    shipping: summary.shipping,
    grandTotal: summary.total,
    depositPct: pct,
    depositRequired,
    requiredDeposit: depositRequired,
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
  depositUnlocked: boolean;
  discountAmount: string;
  discountType: DiscountType;
  taxRate: number;
  taxAmount: string;
  shippingCost: string;
  freightTotal: string | null;
  lineItems: QuoteLineDraft[];
  quoteItems: QuoteLineDraft[];
  hydrateModel: (model: OrderDeskModel) => void;
  patchQuoteState: (updater: (current: OrderDeskQuote) => OrderDeskQuote) => void;
  setVersion: (version: number) => void;
  setCustomerName: (customerName: string) => void;
  setCustomerEmail: (customerEmail: string) => void;
  setBillToAddress: (billToAddress: string) => void;
  setShipToAddress: (shipToAddress: string) => void;
  setDestZip: (destZip: string) => void;
  setExecutedBy: (executedBy: string) => void;
  setDepositPct: (depositPct: number) => void;
  setDepositUnlocked: (depositUnlocked: boolean) => void;
  setDiscountAmount: (discountAmount: string) => void;
  setDiscountType: (discountType: DiscountType) => void;
  setTaxRate: (taxRate: number) => void;
  setTaxAmount: (taxAmount: string) => void;
  setShippingCost: (shippingCost: string) => void;
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
      depositUnlocked: false,
      discountAmount: "0",
      discountType: "FLAT" as DiscountType,
      taxRate: 0,
      taxAmount: "0",
      shippingCost: "",
      freightTotal: null,
      lineItems: [],
      quoteItems: [],
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

  const lineItems = toLineDrafts(model.lines).map((draft) => {
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
  });

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
    depositUnlocked: prev?.quoteId === model.quoteId ? prev.depositUnlocked : false,
    discountAmount: amountInputText(model.discountAmount),
    discountType: model.discountType,
    taxRate: prev?.quoteId === model.quoteId ? prev.taxRate : 0,
    taxAmount: amountInputText(model.taxAmount),
    shippingCost: model.freightTotal ?? "",
    freightTotal: model.freightTotal,
    lineItems,
    quoteItems: lineItems,
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
        shippingCost: nextQuote.freightTotal ?? state.shippingCost,
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
  setDepositPct: (depositPct) =>
    set({
      depositPct:
        Number.isFinite(depositPct) && depositPct >= 0 && depositPct <= 100
          ? depositPct
          : 50,
    }),
  setDepositUnlocked: (depositUnlocked) => set({ depositUnlocked }),
  setDiscountAmount: (discountAmount) => set({ discountAmount }),
  setDiscountType: (discountType) => set({ discountType }),
  setTaxRate: (taxRate) =>
    set((state) => {
      const rate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0;
      const subtotal = roundMoney(
        state.lineItems.reduce(
          (sum, item) => sum + (lineExtended(item.unitPrice, item.qty) ?? 0),
          0,
        ),
      );
      const rawDiscount = Number(state.discountAmount.replace(/[$,\s]/g, ""));
      const validDiscount = Number.isFinite(rawDiscount) && rawDiscount >= 0 ? rawDiscount : 0;
      const computedDiscount = discountDollars(subtotal, validDiscount, state.discountType);
      const netBeforeTax = Math.max(0, roundMoney(subtotal - computedDiscount));
      const computedTax = roundMoney((netBeforeTax * rate) / 100);
      return {
        taxRate: rate,
        taxAmount: String(computedTax),
      };
    }),
  setTaxAmount: (taxAmount) => set({ taxAmount }),
  setShippingCost: (shippingCost) =>
    set({
      shippingCost,
      freightTotal: shippingCost.trim() === "" ? null : shippingCost,
    }),

  updateLineQty: (lineId, qty) =>
    set((state) => {
      const lineItems = state.lineItems.map((item) =>
        item.id === lineId ? { ...item, qty } : item,
      );
      return {
        lineItems,
        quoteItems: lineItems,
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
        quoteItems: lineItems,
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
        quoteItems: lineItems,
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
        quoteItems: lineItems,
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
        quoteItems: lineItems,
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
