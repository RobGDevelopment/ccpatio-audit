-- Redundant drizzle-kit snapshot (originally duplicated CREATE TABLE for
-- finished_goods_catalog / product_bom / sku_mappings / etc.).
-- Those objects already exist from 0001–0004 + 0005_incoming_webhooks.
-- Kept as a no-op so the journal hash sequence stays continuous.
SELECT 1;
