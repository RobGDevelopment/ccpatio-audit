/**
 * Generated from Shipping/v2.json.
 * LTL POST /v2/ltl/quotes/rates: RateQuoteRequest, RateQuoteResponse, QuoteLineItem.
 * Do not edit by hand. Regenerate from the OpenAPI spec.
 */

export interface AccessorialService {
  /** The code for the requested accessorial service. */
  code?: string | null;
}

export interface ApiConfiguration {
  /** Number of seconds to wait for a capacity provider to return a rate quote. (default: 15) */
  timeout?: number | null;
}

export interface Charge {
  /** Code that identifies this line item charge */
  code?: string | null;
  /** Readable description of the line item charge */
  description?: string | null;
  /** The actual amount charged for this line item (adds into the total). This amount may be negative (e.g., for discounts) */
  amount?: number | null;
}

export type FreightClassType = "50" | "55" | "60" | "65" | "70" | "77.5" | "85" | "92.5" | "100" | "110" | "125" | "150" | "175" | "200" | "250" | "300" | "400" | "500";

export interface Message {
  severity?: string | null;
  text?: string | null;
  source?: string | null;
  id?: number | null;
}

export type PackagingType = "Bag" | "Bale" | "Box" | "Bucket" | "Bundle" | "Can" | "Carton" | "Case" | "Coil" | "Crate" | "Cylinder" | "Drums" | "Pail" | "Pieces" | "Pallet" | "Reel" | "Roll" | "Skid" | "Tube" | "Tote";

export interface QuoteEnhancedHandlingUnit {
  handlingUnitType: PackagingType;
  /** The number of units composing this enhanced handling unit */
  units: number;
  /** Length measurement (inches) */
  handlingUnitLength: number;
  /** Width measurement (inches) */
  handlingUnitWidth: number;
  /** Height measurement (inches) */
  handlingUnitHeight: number;
  /** Whether the packages composing this enhanced handling unit are stackable. (default: 'false') */
  isStackable?: boolean;
  /** Whether the packages composing this enhanced handling unit are machinery. (default: 'false') */
  isMachinery?: boolean;
  /** Description of the enhanced handling unit. */
  description?: string | null;
  /** Packages */
  packages: QuotePackage[];
}

export interface QuoteLineItem {
  freightClass: FreightClassType;
  packagingType: PackagingType;
  /** The number of units composing this line item */
  units: number;
  /** The number of pieces composing 1 unit of line item */
  pieces?: number;
  /** Total weight of all packages composing this line item (pounds) */
  totalWeight: number;
  /** Length measurement (inches) */
  length: number;
  /** Width measurement (inches) */
  width: number;
  /** Height measurement (inches) */
  height: number;
  /** Whether the packages composing this line item are stackable. (default: 'false') */
  isStackable?: boolean;
  /** Whether the packages composing this line item are hazardous. (default: 'false') */
  isHazardous?: boolean;
  /** Whether the packages composing this line item are used. (default: 'false') */
  isUsed?: boolean;
  /** Whether the packages composing this line item are machinery. (default: 'false') */
  isMachinery?: boolean;
  /** NMFC prefix code for all packages composing this line item. If NmfcItemCode is provided, must include NmfcSubCode */
  nmfcItemCode?: string | null;
  /** NMFC suffix code for all packages composing this line item. If NmfcItemCode is provided, must include NmfcSubCode */
  nmfcSubCode?: string | null;
  /** Description of the item. */
  description?: string | null;
}

export interface QuotePackage {
  packageFreightClass: FreightClassType;
  /** Type of this package. (default: 'Pallet') */
  weightPerPackage: number;
  /** The quantity of packages. */
  quantity: number;
  /** The number of pieces of this package. */
  pieces: number;
  packagingType: PackagingType;
  /** Length measurement (inches) */
  packageLength: number;
  /** Width measurement (inches) */
  packageWidth: number;
  /** Height measurement (inches) */
  packageHeight: number;
  /** Is package hazardous. (default: 'false') */
  packageIsHazardous?: boolean;
  /** Is package used. (default: 'false') */
  packageIsUsed?: boolean;
  /** Is package machinery. (default: 'false') */
  packageIsMachinery?: boolean;
  /** NMFC prefix code for this package. If NmfcItemCode is provided, must include NmfcSubCode */
  packageNmfcItemCode?: string | null;
  /** NMFC suffix code for for this package. If NmfcItemCode is provided, must include NmfcSubCode */
  packageNmfcSubCode?: string | null;
  /** Description of the package. */
  packageDescription?: string | null;
}

export interface RateQuote {
  /** Priority1's identifier for this rate quote */
  id?: number;
  /** Name of the carrier to which this rate quote applies */
  carrierName?: string | null;
  /** SCAC of the carrier to which this rate quote applies */
  carrierCode?: string | null;
  /** The service level of this rate quote */
  serviceLevel?: string | null;
  /** Description of service level code of this rate quote */
  serviceLevelDescription?: string | null;
  /** The number of service days to deliver the shipment being quoted after it is picked up, if provided */
  transitDays?: number;
  /** The lane type for this rate quote (DIRECT, INTERLINE, UNSPECIFIED) */
  laneType?: string | null;
  /** The delivery date and time for this rate quote in the timezone of the destination, if provided */
  deliveryDate?: string | null;
  /** The effective date and time for this quote, if provided */
  effectiveDate?: string | null;
  /** The date and time this quote expires with the capacity provider, if provided */
  expirationDate?: string | null;
  /** The estimated carrier liability for new goods */
  totalNewCarrierLiabilityAmount?: number;
  /** The estimated carrier liability for used goods */
  totalUsedCarrierLiabilityAmount?: number;
  /** The estimated carrier liability for used goods */
  totalMachineryCarrierLiabilityAmount?: number;
  /** The carrier's identifier for this rate quote, if provided */
  carrierQuoteNumber?: string | null;
  rateQuoteDetail?: RateQuoteDetail;
  /** The mode which was used for quote creation */
  mode?: string | null;
  /** Notification or informational message details for this quote */
  message?: string | null;
}

export interface RateQuoteDetail {
  /** The final total for this quote. */
  total?: number;
  /** The base cost for this quote. */
  baseCost?: number;
  /** A list of individual charges making up the total, if provided */
  charges?: Charge[] | null;
}

export interface RateQuoteError {
  /** SCAC of the carrier to which this rate quote applies. */
  carrierCode?: string | null;
  /** Name of the carrier to which this rate quote applies. */
  carrierName?: string | null;
  /** System messages and messages from the capacity provider. */
  errorMessages?: Message[] | null;
}

export interface RateQuoteRequest {
  /** The origin city of the shipment to be quoted */
  originCity?: string | null;
  /** The origin state abbreviation of the shipment to be quoted */
  originStateAbbreviation?: string | null;
  /** The origin ZIP or postal code of the shipment to be quoted */
  originZipCode: string;
  /** The origin country code of the shipment to be quoted. If null, will default to United States or Canada if the postal code contains a letter. Supported country codes: United States (US), Canada (CA), Mexico (MX), and Puerto Rico (PR) */
  originCountryCode?: string | null;
  /** The destination city of the shipment to be quoted */
  destinationCity?: string | null;
  /** The destination state abbreviation of the shipment to be quoted */
  destinationStateAbbreviation?: string | null;
  /** The destination ZIP or postal code of the shipment to be quoted */
  destinationZipCode: string;
  /** The destination country code of the shipment to be quoted. If null, will default to United States or Canada if the postal code contains a letter. Supported country codes: United States (US), Canada (CA), Mexico (MX), and Puerto Rico (PR) */
  destinationCountryCode?: string | null;
  /** The pickup date and time range in the timezone of the origin location of the shipment to be quoted */
  pickupDate: string;
  /** The line items composing the shipment to be quoted */
  items: QuoteLineItem[];
  /** The enhanced handling units composing the shipment to be quoted. */
  enhancedHandlingUnits?: QuoteEnhancedHandlingUnit[] | null;
  /** List of accessorial services for the shipment to be quoted. List of available accessorials: https://api.priority1.com/about#reference-data */
  accessorialServices?: AccessorialService[] | null;
  apiConfiguration?: ApiConfiguration;
}

export interface RateQuoteRequestDetail {
  /** The origin ZIP or postal code of the quoted shipment */
  originZipCode?: string | null;
  /** The origin city used for this quote. May differ from the city originally supplied if it did not match the origin ZIP or postal code. */
  originCity?: string | null;
  /** The origin state abbreviation used for this quote. */
  originStateAbbreviation?: string | null;
  /** The destination ZIP or postal code of the quoted shipment */
  destinationZipCode?: string | null;
  /** The destination city used for this quote. May differ from the city originally supplied if it did not match the destination ZIP or postal code. */
  destinationCity?: string | null;
  /** The destination state abbreviation used for this quote. */
  destinationStateAbbreviation?: string | null;
  /** The pickup date and time range in the timezone of the origin location of the quoted shipment */
  pickupDate?: string;
  /** The line items composing the quoted shipment */
  items?: QuoteLineItem[] | null;
  /** The enhanced handling units composing the quoted shipment */
  enhancedHandlingUnits?: QuoteEnhancedHandlingUnit[] | null;
  /** List of accessorial services for the quoted shipment */
  accessorialServices?: AccessorialService[] | null;
  /** The calculated linear feet for the quoted shipment */
  linearFeet?: number;
  /** The distance (miles) from origin to destination */
  distance?: number;
  /** The total weight (pounds) of the quoted shipment */
  totalWeight?: number;
}

export interface RateQuoteResponse {
  /** Priority1's identifier for this rate quote response */
  id?: number;
  /** List of rate quotes from all capacity providers requested. */
  rateQuotes?: RateQuote[] | null;
  /** List of rate quotes */
  invalidRateQuotes?: RateQuoteError[] | null;
  rateQuoteRequestDetail?: RateQuoteRequestDetail;
  /** Non-fatal messages about this quote, such as warnings that a supplied city did not match its postal code and was normalized. */
  messages?: Message[] | null;
}
