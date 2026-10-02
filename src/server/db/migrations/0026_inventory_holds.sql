-- inventory_holds only. drizzle-kit generate also replayed tables that later
-- hand-written migrations already created, because snapshots stopped at 0015.
CREATE TYPE "public"."inventory_hold_release_reason" AS ENUM('expired', 'lost', 'abandoned', 'manual');--> statement-breakpoint
CREATE TYPE "public"."inventory_hold_status" AS ENUM('active', 'releasing', 'released', 'converting', 'converted');--> statement-breakpoint
CREATE TABLE "inventory_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"katana_variant_id" integer NOT NULL,
	"sku" text NOT NULL,
	"qty" numeric(12, 4) NOT NULL,
	"ghl_user_id" text NOT NULL,
	"ghl_user_name" text NOT NULL,
	"ghl_user_email" text,
	"ghl_contact_id" text NOT NULL,
	"ghl_opportunity_id" text NOT NULL,
	"ghl_opportunity_name" text NOT NULL,
	"note" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "inventory_hold_status" DEFAULT 'active' NOT NULL,
	"release_reason" "inventory_hold_release_reason",
	"released_by" text,
	"released_at" timestamp with time zone,
	"katana_dummy_so_id" integer NOT NULL,
	"katana_sales_order_row_id" integer,
	"order_no" text NOT NULL,
	"conversion_order_intake_id" uuid,
	"converted_katana_so_id" integer,
	"converted_order_no" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_holds_katana_dummy_so_id_unique" UNIQUE("katana_dummy_so_id"),
	CONSTRAINT "inventory_holds_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "inventory_holds_qty_positive" CHECK ("inventory_holds"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_conversion_order_intake_id_order_intake_id_fk" FOREIGN KEY ("conversion_order_intake_id") REFERENCES "public"."order_intake"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_holds_status_expires_idx" ON "inventory_holds" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_holds_opportunity_status_idx" ON "inventory_holds" USING btree ("ghl_opportunity_id","status");--> statement-breakpoint
CREATE INDEX "inventory_holds_variant_status_idx" ON "inventory_holds" USING btree ("katana_variant_id","status");--> statement-breakpoint
ALTER TABLE "inventory_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "inventory_holds" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
