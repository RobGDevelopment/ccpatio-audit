ALTER TYPE "public"."quote_line_kind" ADD VALUE 'custom';--> statement-breakpoint
ALTER TABLE "quote_line_items" ALTER COLUMN "katana_variant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "bill_to_address" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "ship_to_address" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discount_type" varchar(16) DEFAULT 'FLAT' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_type" CHECK ("quotes"."discount_type" in ('PERCENTAGE', 'FLAT'));--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_amount_nonnegative" CHECK ("quotes"."discount_amount" >= 0);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tax_amount_nonnegative" CHECK ("quotes"."tax_amount" >= 0);