CREATE TYPE "public"."cushion_fulfillment_mode" AS ENUM('standard', 'vacuum_compressed');--> statement-breakpoint
ALTER TABLE "recipe_estimates_draft" ADD COLUMN "gross_freight_weight_lbs" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "recipe_estimates_draft" ADD COLUMN "cushion_fulfillment_mode" "cushion_fulfillment_mode" DEFAULT 'standard' NOT NULL;