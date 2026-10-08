import { getDb } from "../src/server/db/client";
import { sql } from "drizzle-orm";

async function run() {
  const db = getDb();
  await db.execute(sql`
    DELETE FROM nomenclature_collections 
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER(PARTITION BY code ORDER BY created_at) as rn 
        FROM nomenclature_collections
      ) t WHERE t.rn > 1
    );
  `);
  await db.execute(sql`
    DELETE FROM nomenclature_categories 
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER(PARTITION BY code ORDER BY created_at) as rn 
        FROM nomenclature_categories
      ) t WHERE t.rn > 1
    );
  `);
  console.log("Deduped!");
  process.exit(0);
}
run();
