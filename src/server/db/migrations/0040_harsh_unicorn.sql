CREATE TYPE "public"."product_asset_kind" AS ENUM('tear_sheet', 'assembly', 'gallery');--> statement-breakpoint
CREATE TABLE "product_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"global_sku" text NOT NULL,
	"kind" "product_asset_kind" NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_global_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("global_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "product_assets_global_sku_idx" ON "product_assets" USING btree ("global_sku");--> statement-breakpoint
CREATE INDEX "product_assets_kind_idx" ON "product_assets" USING btree ("kind");