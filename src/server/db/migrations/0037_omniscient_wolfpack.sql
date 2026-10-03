CREATE TABLE "qbo_auth_tokens" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"realm_id" varchar(255),
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "quarantine_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_description" varchar(255) NOT NULL,
	"target_msrp" numeric(10, 2),
	"is_web_visible" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finished_goods_catalog" ADD COLUMN "is_web_visible" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "woo_product_id" varchar(255);--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "clover_item_id" varchar(255);--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "qbo_item_id" varchar(255);