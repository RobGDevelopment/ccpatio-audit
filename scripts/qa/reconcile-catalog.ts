import * as fs from 'fs';
import * as path from 'path';

function parseCSV(filePath: string): any[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  
  // Find the actual header row (The Google Sheet has titles on rows 1-5)
  let headerIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Memo/Description') || lines[i].includes('Product_Name')) {
      headerIndex = i;
      break;
    }
  }

  const parseLine = (line: string) => {
    const result = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i+1] === '"') { cell += '"'; i++; }
      else if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { result.push(cell.trim()); cell = ''; }
      else { cell += char; }
    }
    result.push(cell.trim());
    return result;
  };

  const headers = parseLine(lines[headerIndex]);
  return lines.slice(headerIndex + 1).map(line => {
    const values = parseLine(line);
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index] !== undefined ? values[index] : '';
      return obj;
    }, {} as Record<string, string>);
  }).filter(row => Object.values(row).some(val => val !== '')); 
}

function normalize(str: string): string {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/['"]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function run() {
  console.log('🚀 Starting Catalog Reconciliation V3 (Skipping Headers)...');

  const dbPath = path.resolve(process.cwd(), 'data_migration/current_db_catalog.csv');
  const pricesPath = path.resolve(process.cwd(), 'data_migration/Pricing/sheet_prices.csv');

  const dbCatalog = parseCSV(dbPath);
  const sheetPrices = parseCSV(pricesPath).filter(row => row['Memo/Description']);

  const unmatchedSheetItems = new Set(sheetPrices.map(row => normalize(row['Memo/Description'])));
  const results = [];

  for (const dbItem of dbCatalog) {
    const normDbName = normalize(dbItem['Product_Name']);
    const normDbSku = normalize(dbItem['Global_SKU']);
    
    const match = sheetPrices.find(sheetItem => {
      const normSheet = normalize(sheetItem['Memo/Description']);
      if (!normSheet) return false;
      return normSheet === normDbName || normDbSku.includes(normSheet);
    });

    if (match) {
      unmatchedSheetItems.delete(normalize(match['Memo/Description']));
      results.push({
        Match_Status: '🟢 Matched',
        Global_SKU: dbItem['Global_SKU'],
        DB_Product_Name: dbItem['Product_Name'],
        Sheet_Description: match['Memo/Description'],
        New_Oct1_MSRP: match['Pricing Increase 10/01/26'] || match['MSRP'] || 'MISSING'
      });
    } else {
      results.push({
        Match_Status: '🟡 DB_Only (Orphan)',
        Global_SKU: dbItem['Global_SKU'],
        DB_Product_Name: dbItem['Product_Name'],
        Sheet_Description: 'N/A',
        New_Oct1_MSRP: 'N/A'
      });
    }
  }

  for (const sheetItem of sheetPrices) {
    const normSheet = normalize(sheetItem['Memo/Description']);
    if (normSheet && unmatchedSheetItems.has(normSheet)) {
      results.push({
        Match_Status: '🔴 Sheet_Only (Unmapped)',
        Global_SKU: 'N/A',
        DB_Product_Name: 'N/A',
        Sheet_Description: sheetItem['Memo/Description'],
        New_Oct1_MSRP: sheetItem['Pricing Increase 10/01/26'] || sheetItem['MSRP'] || 'MISSING'
      });
    }
  }

  const outputPath = path.resolve(process.cwd(), 'data_migration/Pricing/master_mapping_review.csv');
  const headers = ['Match_Status', 'Global_SKU', 'DB_Product_Name', 'Sheet_Description', 'New_Oct1_MSRP'];
  
  const csvContent = [
    headers.join(','),
    ...results.map(row => headers.map(h => `"${(row as any)[h] || ''}"`).join(','))
  ].join('\n');

  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`✅ Reconciliation V3 complete!`);
}

run().catch(console.error);