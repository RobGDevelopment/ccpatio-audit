CREATE TABLE "custom_build_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_slug" text NOT NULL,
	"display_name" text NOT NULL,
	"ghl_opportunity_id" text,
	"architect_name" text,
	"designer_name" text,
	"packet_storage_path" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "custom_build_jobs_ghl_opportunity_id_unique" UNIQUE("ghl_opportunity_id")
);
