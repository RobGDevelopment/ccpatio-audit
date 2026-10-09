import re

with open('src/lib/katana.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update syncBOMToKatana signature
content = content.replace('options: { allowEmpty?: boolean } = {},', 'options: { allowEmpty?: boolean, idempotencyKey?: string, fromAirlock?: boolean } = {},')

# 2. Update scrap factor check
scrap_code = 'const effectiveQty = qty * (Number.isFinite(scrap) && scrap > 0 ? scrap : 1);'
new_scrap_code = '''if (options.fromAirlock && (!Number.isFinite(scrap) || scrap <= 0)) {
            return { ok: false, error: `Invalid scrap factor for component ${childSku}.` };
          }
          const effectiveQty = qty * (Number.isFinite(scrap) && scrap > 0 ? scrap : 1);'''
content = content.replace(scrap_code, new_scrap_code)

# 3. Pass idempotencyKey to postKatanaManufacturingBom
content = content.replace('await postKatanaManufacturingBom(recipeRows, productVariantId);', 'await postKatanaManufacturingBom(recipeRows, productVariantId, options.idempotencyKey);')

# 4. Update postKatanaManufacturingBom signature
# Let's use regex for postKatanaManufacturingBom signature
content = re.sub(
    r'(async function postKatanaManufacturingBom\([^)]+\)\s*\{)',
    r'async function postKatanaManufacturingBom(\n  recipeRows: Array<{ product_variant_id: number; ingredient_variant_id: number; quantity: number; notes?: string; product_sku?: string; ingredient_sku?: string; }>,\n  productVariantId: number,\n  idempotencyKey?: string\n) {',
    content
)

# 5. Inject idempotencyKey header into recipe batch call. Where does it call Katana?
# Wait, postKatanaManufacturingBom doesn't have idempotencyKey natively in its signature? Let me check how it calls Katana.
# It probably calls katanaFetch.
# Let's find postKatanaManufacturingBom to see what it does.
with open('rewrite_katana.ts', 'w', encoding='utf-8') as f:
    f.write(content)
