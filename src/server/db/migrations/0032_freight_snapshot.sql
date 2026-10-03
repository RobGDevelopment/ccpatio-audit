CREATE TYPE "public"."quote_override_field" AS ENUM('freight_total', 'promise_date', 'distance_miles', 'hold_expires_at');--> statement-breakpoint
CREATE TABLE "dock_distances" (
	"dest_zip" char(5) PRIMARY KEY NOT NULL,
	"origin_zip" char(5) DEFAULT '85260' NOT NULL,
	"distance_miles" numeric(8, 2) NOT NULL,
	"source" text DEFAULT 'geocode' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dock_distances_miles_nonnegative" CHECK ("dock_distances"."distance_miles" >= 0),
	CONSTRAINT "dock_distances_source_geocode" CHECK ("dock_distances"."source" = 'geocode')
);
--> statement-breakpoint
CREATE TABLE "freight_rate_cache" (
	"input_hash" char(64) PRIMARY KEY NOT NULL,
	"dest_zip" char(5) NOT NULL,
	"plan" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"field" "quote_override_field" NOT NULL,
	"inventory_hold_id" uuid,
	"calculated_value" text NOT NULL,
	"override_value" text,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_overrides_reason_length" CHECK (char_length("quote_overrides"."reason") between 1 and 500),
	CONSTRAINT "quote_overrides_actor_role" CHECK ("quote_overrides"."actor_role" in ('Ops_Manager', 'SuperAdmin'))
);
--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD COLUMN "fleet_base_fee" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD COLUMN "fleet_per_mile" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD COLUMN "fleet_per_pound" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD COLUMN "fleet_transit_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD COLUMN "deposit_pct" numeric(5, 2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_overrides" ADD CONSTRAINT "quote_overrides_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_overrides" ADD CONSTRAINT "quote_overrides_inventory_hold_id_inventory_holds_id_fk" FOREIGN KEY ("inventory_hold_id") REFERENCES "public"."inventory_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_overrides_quote_idx" ON "quote_overrides" USING btree ("quote_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_freight_override_id_quote_overrides_id_fk" FOREIGN KEY ("freight_override_id") REFERENCES "public"."quote_overrides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD CONSTRAINT "logistics_settings_fleet_fees_nonnegative" CHECK ((
        ("logistics_settings"."fleet_base_fee" is null or "logistics_settings"."fleet_base_fee" >= 0) and
        ("logistics_settings"."fleet_per_mile" is null or "logistics_settings"."fleet_per_mile" >= 0) and
        ("logistics_settings"."fleet_per_pound" is null or "logistics_settings"."fleet_per_pound" >= 0)
      ));--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD CONSTRAINT "logistics_settings_fleet_transit_nonnegative" CHECK ("logistics_settings"."fleet_transit_days" >= 0);--> statement-breakpoint
ALTER TABLE "logistics_settings" ADD CONSTRAINT "logistics_settings_deposit_pct_band" CHECK ("logistics_settings"."deposit_pct" > 0 and "logistics_settings"."deposit_pct" <= 100);--> statement-breakpoint
ALTER TABLE "dock_distances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "freight_rate_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "dock_distances" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "freight_rate_cache" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "quote_overrides" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;