export interface FedExFreightQuoteResponse {
  carrier: string;
  rate: number;
  days: number;
}

/**
 * Prepares a request to the FedEx Freight LTL API and retrieves a quote.
 * Currently returns a mocked response.
 */
export async function getFedExFreightQuote(
  originZip: string,
  destZip: string,
  weightLb: number,
  freightClass: string
): Promise<FedExFreightQuoteResponse> {
  // Returning a mocked response for now
  return {
    carrier: 'FedEx Freight',
    rate: 845.50,
    days: 4,
  };
}
