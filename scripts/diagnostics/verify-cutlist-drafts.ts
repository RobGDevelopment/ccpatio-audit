import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import { product_bom_draft } from "../../src/server/db/schema";

async function main() {
  const db = getDb();
  const rows = await db
    .select({
      parent: product_bom_draft.parent_sku,
      child: product_bom_draft.child_sku,
      qty: product_bom_draft.quantity,
      uom: product_bom_draft.unit_of_measure,
      source: product_bom_draft.source,
      notes: product_bom_draft.notes,
    })
    .from(product_bom_draft)
    .where(eq(product_bom_draft.source, "sketchup_geometry"));
  console.log(`sketchup_geometry draft rows: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${r.parent} → ${r.child}  ${r.qty} ${r.uom}  notes=${(r.notes ?? "").slice(0, 60)}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
