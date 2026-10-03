CREATE TABLE "delivery_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_date" date NOT NULL,
	"truck_code" text NOT NULL,
	"zone_code" text NOT NULL,
	"capacity_stops" integer NOT NULL,
	"capacity_weight_lb" numeric(12, 2) NOT NULL,
	"stops_booked" integer DEFAULT 0 NOT NULL,
	"weight_booked_lb" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "delivery_days_capacity_stops_positive" CHECK ("delivery_days"."capacity_stops" > 0),
	CONSTRAINT "delivery_days_capacity_weight_positive" CHECK ("delivery_days"."capacity_weight_lb" > 0),
	CONSTRAINT "delivery_days_stops_booked_band" CHECK ("delivery_days"."stops_booked" >= 0 and "delivery_days"."stops_booked" <= "delivery_days"."capacity_stops"),
	CONSTRAINT "delivery_days_weight_booked_nonnegative" CHECK ("delivery_days"."weight_booked_lb" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"zip5" char(5) PRIMARY KEY NOT NULL,
	"zone_code" text NOT NULL,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logistics_profiles" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_days_truck_day_uidx" ON "delivery_days" USING btree ("service_date","truck_code","zone_code");--> statement-breakpoint
CREATE INDEX "delivery_zones_zone_code_idx" ON "delivery_zones" USING btree ("zone_code");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_promise_override_id_quote_overrides_id_fk" FOREIGN KEY ("promise_override_id") REFERENCES "public"."quote_overrides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_profiles" ADD CONSTRAINT "logistics_profiles_lead_time_nonnegative" CHECK ("logistics_profiles"."lead_time_days" is null or "logistics_profiles"."lead_time_days" >= 0);--> statement-breakpoint
ALTER TABLE "delivery_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "delivery_zones" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "delivery_days" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;