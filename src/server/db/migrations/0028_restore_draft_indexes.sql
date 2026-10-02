ALTER TABLE "recipe_estimates_draft" ALTER COLUMN "carton_lwh_in" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recipe_estimates_draft" ALTER COLUMN "packaging_bom" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_uploads_global_sku_idx" ON "cad_uploads" USING btree ("global_sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_uploads_status_idx" ON "cad_uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_operations_draft_item_sku_idx" ON "item_operations_draft" USING btree ("item_sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_bom_draft_parent_sku_idx" ON "product_bom_draft" USING btree ("parent_sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_bom_draft_status_idx" ON "product_bom_draft" USING btree ("status");