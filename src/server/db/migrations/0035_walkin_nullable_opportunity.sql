ALTER TYPE "public"."freight_method" ADD VALUE 'INTERNAL_FLEET_CURBSIDE' BEFORE 'PRIORITY1_LTL';--> statement-breakpoint
ALTER TYPE "public"."freight_method" ADD VALUE 'INTERNAL_FLEET_WHITE_GLOVE' BEFORE 'PRIORITY1_LTL';--> statement-breakpoint
ALTER TYPE "public"."freight_method" ADD VALUE 'INTERNAL_FLEET_FLAT_RATE' BEFORE 'PRIORITY1_LTL';--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "ghl_opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "ghl_contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "ghl_opportunity_name" DROP NOT NULL;