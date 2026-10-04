ALTER TABLE "nomenclature_categories" ADD COLUMN "aliases" text[];--> statement-breakpoint
ALTER TABLE "nomenclature_collections" ADD COLUMN "aliases" text[];--> statement-breakpoint
ALTER TABLE "nomenclature_categories" ADD CONSTRAINT "nomenclature_categories_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "nomenclature_collections" ADD CONSTRAINT "nomenclature_collections_code_unique" UNIQUE("code");