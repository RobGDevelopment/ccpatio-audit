import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';
import { getDb, closeDb } from '../../src/server/db/client';
import { sku_mappings } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const db = getDb();
  
  // 1. Locate and read the master pricing CSV
  const csvPath = path.resolve(process.cwd(), 'docs/Vividworks/vividworks_master_skus.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Could not find pricing file at ${csvPath}`);
    process.exit(1);
  }

  const workbook = xlsx.readFile(csvPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const pricingData = xlsx.utils.sheet_to_json<any>(sheet);

  // Map CSV data by SKU
  const csvPricingMap = new Map<string, string>();
  for (const row of pricingData) {
    const sku = row['Canonical Hub SKU'] || row['Base SKU'] || row['Official SKU'];
    if (sku) {
      csvPricingMap.set(sku.trim(), row['MSRP']);
    }
  }

  // 2. Fetch all finished good SKUs from the database
  const catalog = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.item_type, 'finished_good'));

  let totalValidated = 0;
  const missingPricingSkus: { sku: string; name: string; reason: string }[] = [];

  // 3. Cross-reference every finished good SKU
  for (const item of catalog) {
    totalValidated++;
    const sku = item.sku;
    
    // Check if missing from CSV
    if (!csvPricingMap.has(sku)) {
      missingPricingSkus.push({
        sku,
        name: item.name,
        reason: 'Missing from pricing spreadsheet',
      });
      continue;
    }

    const msrpStr = csvPricingMap.get(sku);
    
    // a) The MSRP is null, undefined, or completely blank.
    if (!msrpStr || String(msrpStr).trim() === '') {
      missingPricingSkus.push({
        sku,
        name: item.name,
        reason: 'MSRP is blank/null',
      });
      continue;
    }

    // b) The MSRP is $0 or 0.00.
    const numericMsrp = parseFloat(String(msrpStr).replace(/[^0-9.]/g, ''));
    if (isNaN(numericMsrp) || numericMsrp === 0) {
      missingPricingSkus.push({
        sku,
        name: item.name,
        reason: `MSRP is $0 or invalid (${msrpStr})`,
      });
      continue;
    }
  }

  await closeDb();

  // 4. Terminal Output Formatting
  console.log('\n==================================================');
  console.log('         CC PATIO - PRICING AUDIT REPORT          ');
  console.log('==================================================\n');

  console.log(`\x1b[36mTotal Products Validated:\x1b[0m ${totalValidated}`);
  
  if (missingPricingSkus.length > 0) {
    console.log(`\x1b[31mTotal Products Missing Pricing:\x1b[0m ${missingPricingSkus.length}\n`);
    console.log('\x1b[33m--- ACTION REQUIRED: Missing Pricing List ---\x1b[0m');
    console.table(missingPricingSkus);
    process.exit(1);
  } else {
    console.log(`\x1b[32mTotal Products Missing Pricing:\x1b[0m 0\n`);
    console.log('\x1b[32m✅ All finished goods have valid pricing.\x1b[0m');
    process.exit(0);
  }
}

main().catch(async (e) => {
  console.error('Fatal Error:', e);
  await closeDb();
  process.exit(1);
});
