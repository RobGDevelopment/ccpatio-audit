CREATE TABLE "ecommerce_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"global_sku" text NOT NULL,
	"product_name" text NOT NULL,
	"steel_msrp" numeric(10, 2),
	"legacy_base_sku" text,
	"legacy_sku_shared" boolean DEFAULT false NOT NULL,
	"canonical_sku_shared" boolean DEFAULT false NOT NULL,
	"product_url" text,
	"url_source" text DEFAULT 'missing' NOT NULL,
	"drawing_section" text NOT NULL,
	"collection_label" text NOT NULL,
	"aluminum_msrp" numeric(10, 2),
	"marketing_description" text,
	"construction_details" text,
	"sheet_order" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecommerce_roster_gaps" (
	"product_name" text PRIMARY KEY NOT NULL,
	"global_sku" text NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD CONSTRAINT "ecommerce_listings_global_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("global_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ecommerce_listings_global_sku_idx" ON "ecommerce_listings" USING btree ("global_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "ecommerce_listings_product_name_uidx" ON "ecommerce_listings" USING btree ("product_name");