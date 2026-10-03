import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';
import { getDb, closeDb } from '../../src/server/db/client';
import { finished_goods_catalog, quarantine_catalog } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const db = getDb();

  const csvPath = path.resolve(process.cwd(), 'data_migration/Pricing/master_mapping_review.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`Error: File not found at ${csvPath}`);
    process.exit(1);
  }

  const workbook = xlsx.readFile(csvPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json<any>(sheet);

  let updatedActive = 0;
  let quarantinedItems = 0;

  for (const row of rows) {
    const rawMsrp = row['New_Oct1_MSRP'] || '';
    const sheetDesc = row['Sheet_Description'] || 'N/A';
    const globalSku = row['Global_SKU'] || '';

    // sanitize MSRP
    let msrpNumStr: string | null = null;
    let msrpNumVal: number | null = null;
    
    if (rawMsrp !== 'N/A' && rawMsrp !== '') {
      const cleaned = String(rawMsrp).replace(/[$,]/g, '').trim();
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0) {
        msrpNumVal = parsed;
        msrpNumStr = parsed.toFixed(2);
      }
    }

    // 1) Match FIN-* SKUs -> update finished_goods_catalog
    if (globalSku && globalSku.startsWith('FIN-')) {
      if (msrpNumVal !== null) {
        // format nicely for the DB string field
        const formattedMsrp = `$${msrpNumVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        
        await db
          .update(finished_goods_catalog)
          .set({
            msrp: formattedMsrp,
            is_web_visible: true,
            updated_at: new Date(),
          })
          .where(eq(finished_goods_catalog.global_sku, globalSku));
          
        updatedActive++;
      }
    } 
    // 2) Blank/N/A SKUs -> send to quarantine_catalog
    else if (!globalSku || globalSku === 'N/A' || globalSku.trim() === '') {
      if (sheetDesc !== 'N/A' && sheetDesc !== '') {
        await db.insert(quarantine_catalog).values({
          sheet_description: sheetDesc,
          target_msrp: msrpNumStr, // numeric(10,2) handles valid number strings
          is_web_visible: false,
        });
        quarantinedItems++;
      }
    }
  }

  console.log(`\n✅ Successfully Updated ${updatedActive} Active Items`);
  console.log(`⚠️ Quarantined ${quarantinedItems} Items\n`);

  await closeDb();
}

main().catch(async (e) => {
  console.error('Fatal Error:', e);
  await closeDb();
  process.exit(1);
});
