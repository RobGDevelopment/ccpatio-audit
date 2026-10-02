"use server";

import { KatanaApiError } from "@/lib/katana";
import { isStockPrefix } from "@/lib/stock-display";
import { stockCheckerAuthorized } from "@/lib/stock-checker-token";
import {
  searchKatanaStock,
  type StockSearchResult,
} from "@/server/stock/search-katana-stock";

export async function searchStock(input: {
  token: string;
  query?: string;
  prefix?: string;
}): Promise<StockSearchResult> {
  if (!stockCheckerAuthorized(input.token)) {
    return { ok: false, error: "This link is not authorized." };
  }
  if (input.prefix && !isStockPrefix(input.prefix)) {
    return { ok: false, error: "Unknown stock filter." };
  }
  try {
    return await searchKatanaStock({ query: input.query, prefix: input.prefix });
  } catch (error: unknown) {
    if (error instanceof KatanaApiError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Inventory lookup failed." };
  }
}
