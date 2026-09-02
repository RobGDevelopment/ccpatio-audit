-- Phase 1: Katana bulk materials → sku_mappings + raw_materials_catalog
-- IDs copied from docs/katana_live_state (pulled 2026-09-01T01:00:23.665Z).
-- Prefer: npx tsx scripts/seed-katana-bulk-materials.ts
-- This SQL is the equivalent upsert for a Supabase SQL editor.

INSERT INTO sku_mappings (
  global_sku, category, item_type, original_name, source_file,
  is_active, uom_purchase, uom_consume, base_cost,
  katana_variant_id, katana_material_id, attributes, updated_by, updated_at
) VALUES
  ('RM-MET-2X2-TUBING', 'Metal', 'raw_material', '2x2 Tubing', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ft', 'ft', 1.8300, 23143123, 10592485, '{"katana_uom":"Ft","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-MET-2X1-TUBING', 'Metal', 'raw_material', '2x1 Tubing', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ft', 'ft', 1.3900, 23143509, 10592707, '{"katana_uom":"Ft","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-MET-15X075-TUBING', 'Metal', 'raw_material', '1.5x3/4 Tubing', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ft', 'ft', 1.0000, 23143128, 10592490, '{"katana_uom":"Ft","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-MET-2X075-TUBING', 'Metal', 'raw_material', '2x3/4 Tubing', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ft', 'ft', 2.1400, 23143516, 10592711, '{"katana_uom":"Ft","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-MET-FLATBAR', 'Metal', 'raw_material', 'Flatbar', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ft', 'ft', 0.4800, 23143136, 10592493, '{"katana_uom":"Ft","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-FAB-GENERIC', 'Fabric', 'raw_material', 'Fabric (generic placeholder)', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'yd', 'yd', 30.0000, 23178514, 10609851, '{"katana_uom":"Yards","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-RAW-FOAM', 'Foam', 'raw_material', 'Foam', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'boardft', 'boardft', 0.7000, 23178511, 10609849, '{"katana_uom":"BoardFt","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-DKT-GENERIC-SLAB', 'Dekton', 'raw_material', 'Dekton (generic slab)', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'slab', 'slab', 7.6000, 23178678, 10609927, '{"katana_uom":"Slab","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-HRD-SPACERS', 'Hardware', 'raw_material', 'Spacers', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ea', 'ea', NULL, 41147406, 17465332, '{"katana_uom":"pcs","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-HRD-2X2-METAL-CAP', 'Hardware', 'raw_material', '2x2 Metal Cap', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ea', 'ea', NULL, 41147427, 17465339, '{"katana_uom":"pcs","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-HRD-UMBRELLA-HOLDER', 'Hardware', 'raw_material', 'Umbrella Holder', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ea', 'ea', NULL, 41339591, 17594967, '{"katana_uom":"pcs","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-HRD-METAL-RING', 'Hardware', 'raw_material', 'Metal ring', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ea', 'ea', NULL, 41341491, 17595618, '{"katana_uom":"pcs","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now()),
  ('RM-RAW-IRON-WOOD', 'Wood', 'raw_material', 'Iron Wood', 'docs/katana_live_state/materials.json @ 2026-09-01T01:00:23.665Z', true, 'ea', 'ea', 10.4200, 23143214, 10592547, '{"katana_uom":"pcs","factory_placeholder":true}'::jsonb, 'katana-identity-seed', now())
ON CONFLICT (global_sku) DO UPDATE SET
  category = EXCLUDED.category,
  item_type = EXCLUDED.item_type,
  original_name = EXCLUDED.original_name,
  source_file = EXCLUDED.source_file,
  uom_purchase = EXCLUDED.uom_purchase,
  uom_consume = EXCLUDED.uom_consume,
  base_cost = EXCLUDED.base_cost,
  katana_variant_id = EXCLUDED.katana_variant_id,
  katana_material_id = EXCLUDED.katana_material_id,
  attributes = EXCLUDED.attributes,
  updated_by = EXCLUDED.updated_by,
  updated_at = EXCLUDED.updated_at;

INSERT INTO raw_materials_catalog (sku, name, category, unit_of_measure, cost_per_unit, updated_at)
SELECT global_sku, original_name, category, uom_consume, base_cost, now()
FROM sku_mappings
WHERE global_sku LIKE 'RM-%'
  AND katana_material_id IS NOT NULL
  AND global_sku IN (
    'RM-MET-2X2-TUBING','RM-MET-2X1-TUBING','RM-MET-15X075-TUBING','RM-MET-2X075-TUBING',
    'RM-MET-FLATBAR','RM-FAB-GENERIC','RM-RAW-FOAM','RM-DKT-GENERIC-SLAB',
    'RM-HRD-SPACERS','RM-HRD-2X2-METAL-CAP','RM-HRD-UMBRELLA-HOLDER','RM-HRD-METAL-RING',
    'RM-RAW-IRON-WOOD'
  )
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  unit_of_measure = EXCLUDED.unit_of_measure,
  cost_per_unit = EXCLUDED.cost_per_unit,
  updated_at = EXCLUDED.updated_at;
