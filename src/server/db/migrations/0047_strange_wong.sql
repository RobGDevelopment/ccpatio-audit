ALTER TABLE "ecommerce_listings" ADD COLUMN "sale_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ecommerce_listings" ADD COLUMN "sale_ends_at" timestamp with time zone;