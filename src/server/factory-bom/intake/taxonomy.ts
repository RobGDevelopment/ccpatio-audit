import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { nomenclature_collections, nomenclature_categories } from "@/server/db/schema";

export type TaxonomyEntry = {
  code: string;
  label: string;
  aliases: string[];
};

export type IntakeTaxonomy = {
  collections: TaxonomyEntry[];
  categories: TaxonomyEntry[];
};

export async function loadIntakeTaxonomy(): Promise<IntakeTaxonomy> {
  const db = getDb();

  const [cols, cats] = await Promise.all([
    db.query.nomenclature_collections.findMany({
      where: eq(nomenclature_collections.is_active, true),
      orderBy: (tbl, { asc }) => [asc(tbl.label)],
    }),
    db.query.nomenclature_categories.findMany({
      where: eq(nomenclature_categories.is_active, true),
      orderBy: (tbl, { asc }) => [asc(tbl.label)],
    }),
  ]);

  return {
    collections: cols.map((c) => ({
      code: c.code,
      label: c.label,
      aliases: (c.aliases as string[]) || [],
    })),
    categories: cats.map((c) => ({
      code: c.code,
      label: c.label,
      aliases: (c.aliases as string[]) || [],
    })),
  };
}
