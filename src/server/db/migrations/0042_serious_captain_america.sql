ALTER TABLE "nomenclature_categories" DROP CONSTRAINT "nomenclature_categories_pkey";
ALTER TABLE "nomenclature_collections" DROP CONSTRAINT "nomenclature_collections_pkey";

ALTER TABLE "nomenclature_categories" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE "nomenclature_collections" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;

UPDATE sku_mappings SET product_origin = 'manufactured' WHERE global_sku LIKE 'FIN-%';
UPDATE sku_mappings SET product_origin = 'third_party' WHERE global_sku LIKE '3P-%';