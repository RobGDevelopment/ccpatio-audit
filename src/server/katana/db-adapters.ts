/**
 * Drizzle adapters for KatanaService ports.
 * Reads sku_mappings only — never invents Katana IDs.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { katana_mo_records, sku_mappings } from "../db/schema";
import type { GlobalE2ESku } from "../../generated/global-e2e-skus";
import type { KatanaMoIndex, SkuMappingLookup } from "./katana.service";

export class DrizzleSkuMappingLookup implements SkuMappingLookup {
  async resolve(sku: GlobalE2ESku): Promise<{
    variant_id: number | null;
    material_id: number | null;
  }> {
    const rows = await getDb()
      .select({
        variant_id: sku_mappings.katana_variant_id,
        material_id: sku_mappings.katana_material_id,
      })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return { variant_id: null, material_id: null };
    }

    return {
      variant_id: row.variant_id,
      material_id: row.material_id,
    };
  }
}

export class DrizzleKatanaMoIndex implements KatanaMoIndex {
  async getMoId(externalRef: string): Promise<string | null> {
    const rows = await getDb()
      .select({ katana_mo_id: katana_mo_records.katana_mo_id })
      .from(katana_mo_records)
      .where(eq(katana_mo_records.external_ref, externalRef))
      .limit(1);

    return rows[0]?.katana_mo_id ?? null;
  }

  async saveMoId(externalRef: string, moId: string): Promise<void> {
    await getDb()
      .insert(katana_mo_records)
      .values({
        external_ref: externalRef,
        katana_mo_id: moId,
        status: "created",
      })
      .onConflictDoUpdate({
        target: katana_mo_records.external_ref,
        set: {
          katana_mo_id: moId,
          status: "created",
          updated_at: new Date(),
        },
      });
  }
}
