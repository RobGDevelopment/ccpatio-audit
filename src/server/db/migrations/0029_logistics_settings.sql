CREATE TABLE "logistics_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"local_white_glove_fee" numeric(10, 2) DEFAULT '150.00' NOT NULL,
	"local_radius_miles" integer DEFAULT 50 NOT NULL,
	"fleet_max_radius_miles" integer DEFAULT 500 NOT NULL,
	"ltl_handling_markup_pct" numeric(6, 2) DEFAULT '15.00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_settings_singleton" CHECK ("logistics_settings"."id" = 1),
	CONSTRAINT "logistics_settings_fees_nonnegative" CHECK ("logistics_settings"."local_white_glove_fee" >= 0 and "logistics_settings"."ltl_handling_markup_pct" >= 0),
	CONSTRAINT "logistics_settings_radii_ordered" CHECK ("logistics_settings"."local_radius_miles" > 0 and "logistics_settings"."fleet_max_radius_miles" >= "logistics_settings"."local_radius_miles")
);
--> statement-breakpoint
ALTER TABLE "logistics_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "logistics_settings" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
INSERT INTO "logistics_settings" ("id")
VALUES (1)
ON CONFLICT ("id") DO NOTHING;
