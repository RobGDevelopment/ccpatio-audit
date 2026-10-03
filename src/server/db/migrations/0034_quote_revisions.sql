CREATE TABLE "quote_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"merchandise_total" numeric(12, 2) NOT NULL,
	"freight_total" numeric(12, 2) NOT NULL,
	"deposit_pct" numeric(5, 2) NOT NULL,
	"amount_due" numeric(12, 2) NOT NULL,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_revisions_quote_revision_uidx" ON "quote_revisions" USING btree ("quote_id","revision_no");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_current_revision_id_quote_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "quote_revisions" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;