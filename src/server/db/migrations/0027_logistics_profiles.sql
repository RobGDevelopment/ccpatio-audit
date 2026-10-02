CREATE TABLE "logistics_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"katana_variant_id" integer NOT NULL,
	"variant_sku" varchar(128) NOT NULL,
	"length_in" numeric(12, 4),
	"width_in" numeric(12, 4),
	"height_in" numeric(12, 4),
	"weight_lb" numeric(12, 4),
	"ltl_class" varchar(8),
	"asset_3d_url" text,
	"is_modular_component" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_profiles_katana_variant_id_unique" UNIQUE("katana_variant_id"),
	CONSTRAINT "logistics_profiles_variant_sku_unique" UNIQUE("variant_sku"),
	CONSTRAINT "logistics_profiles_dims_positive" CHECK ((
        ("logistics_profiles"."length_in" is null or "logistics_profiles"."length_in" > 0) and
        ("logistics_profiles"."width_in" is null or "logistics_profiles"."width_in" > 0) and
        ("logistics_profiles"."height_in" is null or "logistics_profiles"."height_in" > 0) and
        ("logistics_profiles"."weight_lb" is null or "logistics_profiles"."weight_lb" > 0)
      )),
	CONSTRAINT "logistics_profiles_ltl_class_known" CHECK ("logistics_profiles"."ltl_class" is null or "logistics_profiles"."ltl_class" in ('50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500'))
);
--> statement-breakpoint
ALTER TABLE "logistics_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "logistics_profiles" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
