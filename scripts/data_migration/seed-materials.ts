/**
 * Seed the Hub material dictionary (powders and the 30 web-fabric swatches).
 *
 * raw_materials_catalog.sku is a foreign key to sku_mappings.global_sku.
 * This script inserts a sku_mappings shell only when the SKU is missing
 * (onConflictDoNothing — existing dictionary rows are not rewritten), then
 * upserts the catalog row.
 *
 * Powder prefix is PWD-, the live Katana / hub colorway namespace
 * (src/lib/raw-material-sku.ts). POW- is not a hub prefix and would mint
 * a second set of materials. PWR- is a separate legacy prefix. Edit a sku
 * below if you still want a new code.
 *
 * Gloss White and Silver are not in the purchasing dictionary. Solve Linen
 * is not in the fabric dictionary (nearby rows: FAB-SOL-CLA, FAB-SOL-DEN,
 * FAB-SOL-SEA). Those three guesses are marked REVIEW.
 *
 * Fabric hero files live in docs/Vividworks/Handoff/web-fabrics/ and are
 * uploaded separately (npm run migrate:upload-fabrics). This table has no
 * image column.
 *
 *   npm run migrate:seed-materials -- --dry-run
 *   npm run migrate:seed-materials
 */
import { closeDb, getDb } from "../../src/server/db/client";
import { raw_materials_catalog, sku_mappings } from "../../src/server/db/schema";

type MaterialSeed = {
  sku: string;
  name: string;
  category: "Powder" | "Fabric";
  unitOfMeasure: "lb" | "yd";
};

/** Sellable powder colorways, plus two review guesses that are not in Katana yet. */
export const POWDER_FINISHES: MaterialSeed[] = [
  // Dictionary original_name: BLACK POWDER
  { sku: "PWD-BLACK", name: "Matte Black", category: "Powder", unitOfMeasure: "lb" },
  // REVIEW: no gloss-white powder in the purchasing dictionary.
  { sku: "PWD-GLOSS-WHI", name: "Gloss White", category: "Powder", unitOfMeasure: "lb" },
  // Dictionary original_name: OIL RUB BRONZE POWDER
  { sku: "PWD-OIL-RUB-BRONZE", name: "Bronze", category: "Powder", unitOfMeasure: "lb" },
  // REVIEW: no silver powder in the purchasing dictionary.
  { sku: "PWD-SILVER", name: "Silver", category: "Powder", unitOfMeasure: "lb" },
  { sku: "PWD-BONE", name: "Bone", category: "Powder", unitOfMeasure: "lb" },
  { sku: "PWD-LITE-BEIGE", name: "Lite Beige", category: "Powder", unitOfMeasure: "lb" },
  { sku: "PWD-WILD-RICE", name: "Wild Rice", category: "Powder", unitOfMeasure: "lb" },
  { sku: "PWD-FANUC-GRAY", name: "Fanuc Gray", category: "Powder", unitOfMeasure: "lb" },
];

/**
 * The 30 JPEGs in docs/Vividworks/Handoff/web-fabrics/.
 * SKUs are the dictionary matches (CANVAS WHITE → FAB-CAN-WHI), except Solve Linen.
 */
export const FABRIC_SWATCHES: MaterialSeed[] = [
  // REVIEW: not in the dictionary. Nearby: FAB-SOL-CLA, FAB-SOL-DEN, FAB-SOL-SEA.
  { sku: "FAB-SOL-LIN", name: "SOLVE LINEN", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-CAB-CLA", name: "CABANA CLASSIC", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-CAN-BLA", name: "CANVAS BLACK", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-CAN-WHI", name: "CANVAS WHITE", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-CASS-CORA", name: "CASSAVA CORAL", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-CASS-SLAT", name: "CASSAVA SLATE", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-CRU-ASH", name: "CRUSH ASH", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-CRU-SNO", name: "CRUSH SNOW", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-DUM-STU", name: "DUMONT STUCCO", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-EST-MAR", name: "ESTI MARINE", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-EST-ONY", name: "ESTI ONYX", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-HER-PAP", name: "HERITAGE PAPYRUS", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-KIN-SIL", name: "KINDLE SILK", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-LIN-PAR", name: "LINVILLE PARCHMENT", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-LIN-SPA", name: "LINVILLE SPA", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-MET-CLO", name: "METAMORPHIC CLOUD", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-MET-LAG", name: "METAMORPHIC LAGOON", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-MET-SAN", name: "METAMORPHIC SAND", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-MET-SNO", name: "METAMORPHIC SNOW", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-MID-STO", name: "MIDORI STONE", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-MOU-SNO", name: "MOUNTAINS SNOW", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-POS-SAP", name: "POSH SAPPHIRE", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-PRE-FAW", name: "PRECISE FAWN", category: "Fabric", unitOfMeasure: "yd" },
  // Dictionary spelling is COSTAL.
  { sku: "FAB-RUE-COS", name: "RUE COSTAL", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-UND-STO", name: "UNDERCURRENT STORM", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-RIT-ROS", name: "RITSY ROSEMARY", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-RIT-NEC", name: "RITSY NECTAR", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-SHE-LIN", name: "SHELTER LINEN", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-SHE-WHI", name: "SHELTER WHITE", category: "Fabric", unitOfMeasure: "yd" },
  { sku: "FAB-RIT-CHA", name: "RITSY CHAMBRAY", category: "Fabric", unitOfMeasure: "yd" },
];

const MATERIALS: MaterialSeed[] = [...POWDER_FINISHES, ...FABRIC_SWATCHES];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const skus = MATERIALS.map((row) => row.sku);
  const unique = new Set(skus);
  if (unique.size !== skus.length) {
    throw new Error("Material seed contains a duplicate SKU");
  }

  if (dryRun) {
    for (const row of MATERIALS) {
      console.log(`[dry-run] ${row.sku} ${row.name} (${row.category}, ${row.unitOfMeasure})`);
    }
    console.log(JSON.stringify({ dryRun: true, powders: POWDER_FINISHES.length, fabrics: FABRIC_SWATCHES.length }));
    return;
  }

  const db = getDb();
  let upserted = 0;
  for (const row of MATERIALS) {
    await db
      .insert(sku_mappings)
      .values({
        global_sku: row.sku,
        category: row.category,
        item_type: "raw_material",
        original_name: row.name,
        source_file: "scripts/data_migration/seed-materials.ts",
        uom_purchase: row.unitOfMeasure,
        uom_consume: row.unitOfMeasure,
        updated_by: "migrate:seed-materials",
      })
      .onConflictDoNothing();

    await db
      .insert(raw_materials_catalog)
      .values({
        sku: row.sku,
        name: row.name,
        category: row.category,
        unit_of_measure: row.unitOfMeasure,
      })
      .onConflictDoUpdate({
        target: raw_materials_catalog.sku,
        set: {
          name: row.name,
          category: row.category,
          unit_of_measure: row.unitOfMeasure,
          updated_at: new Date(),
        },
      });
    upserted += 1;
    console.log(`[upserted] ${row.sku} ${row.name}`);
  }

  console.log(
    JSON.stringify({
      dryRun: false,
      upserted,
      powders: POWDER_FINISHES.length,
      fabrics: FABRIC_SWATCHES.length,
    }),
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
