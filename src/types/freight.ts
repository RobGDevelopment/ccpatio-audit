import type {
  QuoteLineItem,
  RateQuote,
  RateQuoteRequest,
  RateQuoteResponse,
} from "@/types/priority1-ltl.generated";

export type {
  AccessorialService,
  ApiConfiguration,
  Charge,
  FreightClassType,
  Message,
  PackagingType,
  QuoteEnhancedHandlingUnit,
  QuoteLineItem,
  QuotePackage,
  RateQuote,
  RateQuoteDetail,
  RateQuoteError,
  RateQuoteRequest,
  RateQuoteRequestDetail,
  RateQuoteResponse,
} from "@/types/priority1-ltl.generated";

/** How a CC Patio order leaves the dock. */
export type FulfillmentMethod =
  | "LOCAL_WHITE_GLOVE"
  | "INTERNAL_FLEET"
  | "PRIORITY1_LTL";

/**
 * Accessorials we send for residential patio delivery.
 * RESDEL residential, LGDEL liftgate, APPT appointment.
 */
export type Priority1AccessorialCode = "RESDEL" | "LGDEL" | "APPT";

/** One product sitting on a shared skid. Dimensions are inches, weight is pounds. */
export type FreightSkidItem = {
  freightClass: string;
  weight: number;
  length: number;
  width: number;
  height: number;
  packagingType: "Pallet";
  isStackable: boolean;
};

/** Products that ship together as a single physical skid. */
export type FreightSkid = {
  items: FreightSkidItem[];
};

/** Spec names used by the mixed-skid rater. */
export type Priority1QuoteLineItem = QuoteLineItem;
export type Priority1RateQuote = RateQuote;
export type Priority1RateQuoteRequest = RateQuoteRequest;
export type Priority1RateQuoteResponse = RateQuoteResponse;

export type Priority1QuoteResult = {
  request: RateQuoteRequest;
  response: RateQuoteResponse;
};

export type FulfillmentCarrierQuote = {
  id: number;
  carrierName: string;
  carrierCode: string;
  transitDays: number | null;
  serviceLevel: string | null;
  brokerTotalUsd: number;
  customerTotalUsd: number;
};

export type FulfillmentOption = {
  method: FulfillmentMethod;
  /** Customer price. Fleet uses the logistics tariff. Null only when a price was not produced. */
  priceUsd: number | null;
  currency: "USD";
  summary: string;
  carriers?: FulfillmentCarrierQuote[];
};

export type FulfillmentPlan = {
  originZip: string;
  destinationZip: string;
  distanceMiles: number;
  options: FulfillmentOption[];
};
