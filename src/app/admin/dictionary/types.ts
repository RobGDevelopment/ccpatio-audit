import type { ItemType, QboAccounts } from "@/server/db/schema";

export type CatalogFields = {
  msrp: string | null;
  cost: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  armHeight: string | null;
  sitHeight: string | null;
  weight: string | null;
  description: string | null;
  imageUrl: string | null;
  qboItemCode: string | null;
  naFields: string[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type SkuMappingRow = {
  globalSku: string;
  category: string;
  itemType: ItemType;
  originalName: string;
  sourceFile: string;
  isActive: boolean;
  uomPurchase: string | null;
  uomConsume: string | null;
  baseCost: string | null;
  katanaVariantId: number | null;
  katanaMaterialId: number | null;
  wooAttributeSlug: string | null;
  ghlDropdownValue: string | null;
  qboAccounts: QboAccounts;
  attributes: Record<string, unknown>;
  version: number;
  mappingUpdatedAt?: string | null;
  mappingUpdatedBy?: string | null;
  bomComponentCount: number;
  catalog: CatalogFields | null;
  displaySku?: string;
};

export type DictionaryTableMeta = {
  categoryOptions: string[];
  columnTab: string;
  flashSkus: Record<string, boolean>;
  onPatchSaved: (sku: string, patch: Partial<SkuMappingRow>) => void;
  onToggleActive: (sku: string) => void;
  onToggleExpand: (sku: string) => void;
  expanded: Record<string, boolean>;
  onNaChange: (sku: string, naFields: string[]) => void;
};
