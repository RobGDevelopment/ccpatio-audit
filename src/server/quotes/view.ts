import type { DiscountType } from "@/lib/quote-financials";
import type {
  DistanceSource,
  FreightMethodColumn,
  QuoteLineKind,
  QuoteStatus,
} from "@/server/db/schema";
import type { FulfillmentMethod, FulfillmentPlan } from "@/types/freight";

export type OrderDeskFreightOption = {
  method: FulfillmentMethod;
  priceUsd: number | null;
};

const FREIGHT_METHODS = new Set<FulfillmentMethod>([
  "LOCAL_WHITE_GLOVE",
  "INTERNAL_FLEET",
  "PRIORITY1_LTL",
]);

export function readFreightOptions(snapshot: unknown): OrderDeskFreightOption[] {
  if (!snapshot || typeof snapshot !== "object" || !("options" in snapshot)) return [];
  const options = (snapshot as FulfillmentPlan).options;
  if (!Array.isArray(options)) return [];
  const parsed: OrderDeskFreightOption[] = [];
  for (const option of options) {
    if (!option || typeof option !== "object") continue;
    if (!FREIGHT_METHODS.has(option.method)) continue;
    parsed.push({
      method: option.method,
      priceUsd: typeof option.priceUsd === "number" ? option.priceUsd : null,
    });
  }
  return parsed;
}

export type OrderDeskLine = {
  id: string;
  lineNo: number;
  lineKind: QuoteLineKind;
  sku: string;
  qty: string;
  unitPrice: string | null;
  priceError: string | null;
  description: string;
  holdId: string | null;
};

export type OrderDeskSuggestion = {
  holdId: string;
  sku: string;
  qty: string;
  note: string;
  expiresAt: string;
};

export type OrderDeskQuote = {
  state: "quote";
  readOnly: boolean;
  closedOpportunity: boolean;
  quoteId: string;
  version: number;
  status: QuoteStatus;
  opportunityId: string | null;
  opportunityName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  billToAddress: string | null;
  shipToAddress: string | null;
  discountAmount: string;
  discountType: DiscountType;
  taxAmount: string;
  selectedCarrierCode: string | null;
  destZip: string | null;
  distanceMiles: string | null;
  distanceSource: DistanceSource | null;
  merchandiseTotal: string | null;
  freightMethod: FreightMethodColumn | null;
  freightTotal: string | null;
  freightError: string | null;
  freightOptions: OrderDeskFreightOption[];
  executedBy: string;
  promiseDate: string | null;
  calculatedPromiseDate: string | null;
  promiseTruckCode: string | null;
  promiseError: string | null;
  ghlSyncError: string | null;
  voidReason: string | null;
  lines: OrderDeskLine[];
  suggestions: OrderDeskSuggestion[];
};

export type OrderDeskModel =
  | { state: "needs-opportunity" }
  | { state: "error"; message: string }
  | OrderDeskQuote;
