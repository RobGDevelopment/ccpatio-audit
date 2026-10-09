CREATE TYPE "public"."factory_release_status" AS ENUM('quarantined', 'released');--> statement-breakpoint
CREATE TABLE "factory_release_gate" (
	"root_sku" text PRIMARY KEY NOT NULL,
	"status" "factory_release_status" DEFAULT 'quarantined' NOT NULL,
	"blocking_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dossier_hash" varchar(64),
	"released_by" text,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "factory_release_gate_released_attested" CHECK ((status = 'quarantined') OR (status = 'released' AND released_by IS NOT NULL AND released_at IS NOT NULL AND dossier_hash IS NOT NULL AND jsonb_array_length(blocking_codes) = 0))
);
--> statement-breakpoint
ALTER TABLE "factory_release_gate" ADD CONSTRAINT "factory_release_gate_root_sku_sku_mappings_global_sku_fk" FOREIGN KEY ("root_sku") REFERENCES "public"."sku_mappings"("global_sku") ON DELETE cascade ON UPDATE cascade;