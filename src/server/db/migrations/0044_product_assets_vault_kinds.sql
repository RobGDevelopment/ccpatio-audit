ALTER TYPE "public"."product_asset_kind" ADD VALUE 'primary_image';--> statement-breakpoint
ALTER TYPE "public"."product_asset_kind" ADD VALUE 'care_guide';--> statement-breakpoint
ALTER TYPE "public"."product_asset_kind" ADD VALUE 'warranty';--> statement-breakpoint
CREATE UNIQUE INDEX "product_assets_one_current_uidx" ON "product_assets" USING btree ("global_sku","kind") WHERE "product_assets"."is_current" AND "product_assets"."kind" <> 'gallery';--> statement-breakpoint
CREATE UNIQUE INDEX "product_assets_revision_uidx" ON "product_assets" USING btree ("global_sku","kind","revision") WHERE "product_assets"."kind" <> 'gallery';