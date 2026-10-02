ALTER TABLE "inventory_holds" ALTER COLUMN "ghl_user_id" SET DATA TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "inventory_holds" ALTER COLUMN "expires_at" SET DEFAULT (now() + interval '14 days');--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD COLUMN "warning_sent_at" timestamp with time zone;