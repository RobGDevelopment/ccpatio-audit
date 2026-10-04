CREATE TYPE "public"."product_origin" AS ENUM('manufactured', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."product_relation_role" AS ENUM('composes_with', 'requires', 'accessory', 'successor');--> statement-breakpoint
CREATE TYPE "public"."ship_mode" AS ENUM('ltl', 'parcel', 'white_glove_only', 'not_shipped');--> statement-breakpoint
CREATE TYPE "public"."third_party_fulfillment" AS ENUM('showroom_stock', 'special_order');--> statement-breakpoint
CREATE TABLE "catalog_ship_profiles" (
	"global_sku" text PRIMARY KEY NOT NULL,
	"length_in" numeric(10, 2),
	"width_in" numeric(10, 2),
	"height_in" numeric(10, 2),
	"weight_lb" numeric(10, 2),
	"dim_weight_lb" numeric(10, 2),
	"billable_weight_lb" numeric(10, 2),
	"ltl_class" text,
	"nmfc_item" text,
	"ship_mode" "ship_mode",
	"stackable" boolean DEFAULT false NOT NULL,
	"assembly_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nomenclature_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nomenclature_categories_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "nomenclature_collections" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nomenclature_collections_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "product_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_sku" text NOT NULL,
	"to_sku" text NOT NULL,
	"role" "product_relation_role" NOT NULL,
	"note" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "third_party_sources" (
	"global_sku" text PRIMARY KEY NOT NULL,
	"vendor_name" text NOT NULL,
	"vendor_sku" text NOT NULL,
	"wholesale_cost" numeric(12, 4) NOT NULL,
	"country_of_origin" text,
	"fulfillment" "third_party_fulfillment",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN "seo_description" text;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "assembly_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "warranty_term_months" integer;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "warranty_covers" text;--> statement-breakpoint
ALTER TABLE "product_assets" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_assets" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "product_assets" ADD COLUMN "effective_on" date DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "product_assets" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "product_assets" ADD COLUMN "superseded_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_assets" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "product_assets" ADD COLUMN "alt_text" text;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "product_origin" "product_origin";--> statement-breakpoint
ALTER TABLE "catalog_ship_profiles" ADD CONSTRAINT "catalog_ship_profiles_global_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("global_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_from_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("from_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_to_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("to_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "third_party_sources" ADD CONSTRAINT "third_party_sources_global_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("global_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "product_relations_unq" ON "product_relations" USING btree ("from_sku","to_sku","role");--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD CONSTRAINT "origin_check" CHECK ((product_origin = 'manufactured' AND global_sku LIKE 'FIN-%') OR (product_origin = 'third_party' AND global_sku LIKE '3P-%') OR (product_origin IS NULL));