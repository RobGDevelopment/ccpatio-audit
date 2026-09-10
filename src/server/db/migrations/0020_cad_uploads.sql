-- CAD upload pipeline: private cad-models bucket metadata + job tracker.
-- Storage bucket policies live in supabase/migrations (separate).

DO $$ BEGIN
  CREATE TYPE "public"."cad_upload_status" AS ENUM (
    'uploaded',
    'queued',
    'processing',
    'draft_ready',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."cad_upload_thumbnail_source" AS ENUM (
    'skp_embed',
    'operator_upload',
    'none'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cad_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "global_sku" text NOT NULL,
  "storage_path" text NOT NULL,
  "original_filename" text NOT NULL,
  "content_type" text,
  "byte_size" integer,
  "sha256" text,
  "ext" text NOT NULL,
  "status" "cad_upload_status" NOT NULL DEFAULT 'uploaded',
  "inngest_event_id" text,
  "error_message" text,
  "thumbnail_source" "cad_upload_thumbnail_source" NOT NULL DEFAULT 'none',
  "thumbnail_url" text,
  "force_rename" boolean NOT NULL DEFAULT false,
  "replace_image" boolean NOT NULL DEFAULT false,
  "uploaded_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cad_uploads_global_sku_fkey"
    FOREIGN KEY ("global_sku") REFERENCES "sku_mappings"("global_sku")
    ON UPDATE CASCADE ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cad_uploads_global_sku_idx"
  ON "cad_uploads" ("global_sku");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cad_uploads_status_idx"
  ON "cad_uploads" ("status");
--> statement-breakpoint

ALTER TABLE "cad_uploads" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  REVOKE ALL ON TABLE "cad_uploads" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
