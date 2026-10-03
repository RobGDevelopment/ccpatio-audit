CREATE TYPE "public"."distance_source" AS ENUM('geocode', 'manual_override');--> statement-breakpoint
CREATE TYPE "public"."freight_method" AS ENUM('LOCAL_WHITE_GLOVE', 'INTERNAL_FLEET', 'PRIORITY1_LTL');--> statement-breakpoint
CREATE TYPE "public"."quote_line_kind" AS ENUM('stock_hold', 'configured');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'deposit_paid', 'paid', 'converted', 'void', 'expired');--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"line_kind" "quote_line_kind" NOT NULL,
	"sku" text NOT NULL,
	"katana_variant_id" integer NOT NULL,
	"qty" numeric(12, 4) NOT NULL,
	"unit_price" numeric(12, 2),
	"price_error" text,
	"description" text NOT NULL,
	"inventory_hold_id" uuid,
	"weight_lb" numeric(12, 4),
	"ltl_class" varchar(8),
	"length_in" numeric(12, 4),
	"width_in" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_line_items_qty_positive" CHECK ("quote_line_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ghl_opportunity_id" text NOT NULL,
	"ghl_contact_id" text NOT NULL,
	"ghl_opportunity_name" text NOT NULL,
	"ghl_user_id" varchar(128) NOT NULL,
	"ghl_user_name" text NOT NULL,
	"ghl_user_email" text,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"dest_zip" char(5),
	"distance_miles" numeric(8, 2),
	"distance_source" "distance_source",
	"packed_height_in" numeric(6, 2) DEFAULT '40.00' NOT NULL,
	"merchandise_total" numeric(12, 2),
	"freight_method" "freight_method",
	"freight_total" numeric(12, 2),
	"calculated_freight_total" numeric(12, 2),
	"freight_snapshot" jsonb,
	"freight_input_hash" char(64),
	"freight_quoted_at" timestamp with time zone,
	"freight_error" text,
	"selected_carrier_code" text,
	"freight_override_id" uuid,
	"executed_by" date NOT NULL,
	"promise_date" date,
	"calculated_promise_date" date,
	"promise_truck_code" text,
	"promise_formula" text,
	"promise_calculated_at" timestamp with time zone,
	"promise_error" text,
	"promise_override_id" uuid,
	"deposit_pct" numeric(5, 2),
	"current_revision_id" uuid,
	"order_intake_id" uuid,
	"katana_sales_order_id" integer,
	"katana_order_no" text,
	"commercial_conflict" text,
	"void_reason" text,
	"ghl_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_packed_height_band" CHECK ("quotes"."packed_height_in" >= 36 and "quotes"."packed_height_in" <= 45)
);
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_inventory_hold_id_inventory_holds_id_fk" FOREIGN KEY ("inventory_hold_id") REFERENCES "public"."inventory_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_order_intake_id_order_intake_id_fk" FOREIGN KEY ("order_intake_id") REFERENCES "public"."order_intake"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_line_items_quote_line_uidx" ON "quote_line_items" USING btree ("quote_id","line_no");--> statement-breakpoint
CREATE INDEX "quote_line_items_quote_idx" ON "quote_line_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_line_items_hold_idx" ON "quote_line_items" USING btree ("inventory_hold_id") WHERE "quote_line_items"."inventory_hold_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_open_opportunity_uidx" ON "quotes" USING btree ("ghl_opportunity_id") WHERE "quotes"."status" in ('draft', 'sent');--> statement-breakpoint
CREATE INDEX "quotes_opportunity_idx" ON "quotes" USING btree ("ghl_opportunity_id");--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_line_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "quotes" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "quote_line_items" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;