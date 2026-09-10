import type { ItemType } from "@/server/db/schema";

export type KatanaProductSyncFlags = {
  is_sellable: boolean;
  is_producible: boolean;
  is_purchasable: boolean;
};

/**
 * Katana product flags derived from PIM `item_type`.
 * Sub-assemblies are producible but never sellable.
 */
export function katanaProductSyncFlags(
  itemType: ItemType | null | undefined,
): KatanaProductSyncFlags {
  switch (itemType) {
    case "sub_assembly":
      return {
        is_sellable: false,
        is_producible: true,
        is_purchasable: false,
      };
    case "service":
      return {
        is_sellable: true,
        is_producible: false,
        is_purchasable: false,
      };
    case "raw_material":
      return {
        is_sellable: false,
        is_producible: false,
        is_purchasable: true,
      };
    case "finished_good":
    default:
      return {
        is_sellable: true,
        is_producible: true,
        is_purchasable: false,
      };
  }
}

/**
 * Sellable Katana products are Master SKUs only (`FIN-*` finished goods)
 * plus rare `service` rows. Colorways, SAs, and materials never sell.
 */
export function katanaIsSellableProduct(
  itemType: ItemType | null | undefined,
  sku: string,
): boolean {
  const flags = katanaProductSyncFlags(itemType);
  if (!flags.is_sellable) return false;
  if (itemType === "service") return true;
  return (
    itemType === "finished_good" &&
    sku.trim().toUpperCase().startsWith("FIN-")
  );
}
