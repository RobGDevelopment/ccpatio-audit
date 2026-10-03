import fs from 'fs';
import path from 'path';
import { getDb, closeDb } from '../../src/server/db/client';
import { sku_mappings, finished_goods_catalog } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const db = getDb();

  // Query DB for every item in sku_mappings where item_type is 'finished_good'
  const catalog = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      collection: sku_mappings.category, // using category as Collection
      msrp: finished_goods_catalog.msrp,
    })
    .from(sku_mappings)
    .leftJoin(finished_goods_catalog, eq(sku_mappings.global_sku, finished_goods_catalog.global_sku))
    .where(eq(sku_mappings.item_type, 'finished_good'));

  // CSV Headers: Global_SKU, Product_Name, Collection, Current_DB_MSRP
  const csvHeaders = ['Global_SKU', 'Product_Name', 'Collection', 'Current_DB_MSRP'];
  
  // Convert rows to CSV standard format safely (wrapping quotes and escaping inner quotes)
  const rows = catalog.map((item) => {
    const escapeCsv = (str: string | null | undefined) => {
      if (str === null || str === undefined) return '';
      const stringified = String(str);
      if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
        return `"${stringified.replace(/"/g, '""')}"`;
      }
      return stringified;
    };

    return [
      escapeCsv(item.sku),
      escapeCsv(item.name),
      escapeCsv(item.collection),
      escapeCsv(item.msrp),
    ].join(',');
  });

  const csvContent = [csvHeaders.join(','), ...rows].join('\n');

  const outputPath = path.resolve(process.cwd(), 'data_migration/current_db_catalog.csv');
  
  // Ensure the data_migration directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`✅ Successfully exported ${catalog.length} finished goods to ${outputPath}`);

  await closeDb();
}

main().catch(async (e) => {
  console.error('Fatal Error:', e);
  await closeDb();
  process.exit(1);
});
