/**
 * Shared hub graph types for provider mappers (pure — no HTTP).
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 3.
 */
import type { ItemType } from "@/server/db/schema";

export type HubSkuNode = {
  globalSku: string;
  itemType: ItemType;
  originalName: string;
  category: string;
  uomPurchase?: string | null;
  uomConsume?: string | null;
  baseCost?: string | null;
  katanaVariantId?: number | null;
  katanaMaterialId?: number | null;
  attributes?: Record<string, unknown> | null;
};

export type HubBomEdge = {
  parentSku: string;
  childSku: string;
  quantity: number;
  scrapFactor: number;
  unitOfMeasure: string;
  /** Chop-saw cut-list notes for Katana recipe rows. */
  notes?: string | null;
};

export type HubOperation = {
  itemSku: string;
  workCenter: string;
  sequence: number;
  setupTimeMins?: number | null;
  runTimeMins?: number | null;
};

export type HubFinishedGoodCommerce = {
  globalSku: string;
  name: string;
  msrp?: string | null;
  cost?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  slug?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  syncToWoo: boolean;
  syncToClover: boolean;
};

/** Approved product graph ready for fan-out mapping. */
export type HubProductGraph = {
  rootSku: string;
  skus: HubSkuNode[];
  edges: HubBomEdge[];
  operations: HubOperation[];
  commerce: HubFinishedGoodCommerce;
};

export function parseMoney(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
