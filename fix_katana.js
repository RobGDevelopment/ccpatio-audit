const fs = require('fs');

let content = fs.readFileSync('src/lib/katana.ts', 'utf8');

// 1. Update syncBOMToKatana signature
content = content.replace('options: { allowEmpty?: boolean } = {},', 'options: { allowEmpty?: boolean, idempotencyKey?: string, fromAirlock?: boolean } = {},');

// 2. Update scrap factor check
const scrapCode = 'const effectiveQty = qty * (Number.isFinite(scrap) && scrap > 0 ? scrap : 1);';
const newScrapCode = `if (options.fromAirlock && (!Number.isFinite(scrap) || scrap <= 0)) {
            return { ok: false, error: \`Invalid scrap factor for component \${childSku}.\` };
          }
          const effectiveQty = qty * (Number.isFinite(scrap) && scrap > 0 ? scrap : 1);`;
content = content.replace(scrapCode, newScrapCode);

// 3. Update postKatanaManufacturingBom signature
content = content.replace(
  /async function postKatanaManufacturingBom\([^)]+\)\s*\{/,
  `async function postKatanaManufacturingBom(
  recipeRows: Array<{ product_variant_id: number; ingredient_variant_id: number; quantity: number; notes?: string; product_sku?: string; ingredient_sku?: string; }>,
  productVariantId: number,
  idempotencyKey?: string
) {`
);

// 4. Pass idempotencyKey to postKatanaManufacturingBom
content = content.replace(
  'await postKatanaManufacturingBom(recipeRows, productVariantId);', 
  'await postKatanaManufacturingBom(recipeRows, productVariantId, options.idempotencyKey);'
);

// 5. Pass idempotencyKey into katanaFetch inside postKatanaManufacturingBom
// postKatanaManufacturingBom calls katanaFetch(KATANA_BOM_ROWS_PATH, ...) or similar?
// It probably loops and calls katanaFetch. Let's inspect that part manually first.

fs.writeFileSync('src/lib/katana.ts', content, 'utf8');
console.log('Fixed katana.ts');
