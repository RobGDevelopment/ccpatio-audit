CREATE TYPE "public"."channel_sync_channel" AS ENUM('katana', 'woocommerce', 'clover');--> statement-breakpoint
CREATE TYPE "public"."channel_sync_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('raw_material', 'sub_assembly', 'finished_good', 'service');--> statement-breakpoint
CREATE TYPE "public"."product_intake_status" AS ENUM('quarantined', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SuperAdmin', 'IT_Admin', 'Ops_Manager', 'Designer');--> statement-breakpoint
CREATE TABLE "channel_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"global_sku" text NOT NULL,
	"channel" "channel_sync_channel" NOT NULL,
	"external_id" varchar(255),
	"status" "channel_sync_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_sku" text NOT NULL,
	"work_center" varchar(120) NOT NULL,
	"sequence" integer DEFAULT 10 NOT NULL,
	"setup_time_mins" numeric(12, 4),
	"run_time_mins" numeric(12, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pim_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_email" text NOT NULL,
	"operator_name" text,
	"global_sku" text,
	"action" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pim_operators" (
	"email" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_intake" (
	"export_id" uuid PRIMARY KEY NOT NULL,
	"status" "product_intake_status" DEFAULT 'quarantined' NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"zod_issues" jsonb,
	"proposed_sku" varchar(120),
	"created_by" varchar(255),
	"reject_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"global_sku" text,
	"panel_location" text NOT NULL,
	"operator_email" text NOT NULL,
	"note" text NOT NULL,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_name" varchar(255) NOT NULL,
	"encrypted_token" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_credentials_service_name_unique" UNIQUE("service_name")
);
--> statement-breakpoint
ALTER TABLE "product_bom" RENAME COLUMN "finished_good_sku" TO "parent_sku";--> statement-breakpoint
ALTER TABLE "product_bom" RENAME COLUMN "component_sku" TO "child_sku";--> statement-breakpoint
ALTER TABLE "product_bom" DROP CONSTRAINT "product_bom_finished_good_sku_finished_goods_catalog_global_sku_fk";
--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "cost" text;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "weight" text;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "qbo_item_code" text;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "seo_description" text;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "na_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "product_bom" ADD COLUMN "scrap_factor" numeric(12, 4) DEFAULT '1.0000' NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "item_type" "item_type" DEFAULT 'raw_material' NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "sync_to_woo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "sync_to_clover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "uom_purchase" text;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "uom_consume" text;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "base_cost" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "qbo_accounts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_sync" ADD CONSTRAINT "channel_sync_global_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("global_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "item_operations" ADD CONSTRAINT "item_operations_item_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("item_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "vendor_credentials" ADD CONSTRAINT "vendor_credentials_updated_by_user_roles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_sync_sku_channel_uidx" ON "channel_sync" USING btree ("global_sku","channel");--> statement-breakpoint
ALTER TABLE "product_bom" ADD CONSTRAINT "product_bom_parent_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("parent_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_bom" ADD CONSTRAINT "product_bom_child_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("child_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "raw_materials_catalog" ADD CONSTRAINT "raw_materials_catalog_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "product_bom_parent_child_uidx" ON "product_bom" USING btree ("parent_sku","child_sku");