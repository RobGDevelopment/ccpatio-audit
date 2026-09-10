import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import postgres from "postgres";

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL missing");
  const sql = postgres(url, { max: 1 });
  try {
    const cols = await sql`
      select column_name
      from information_schema.columns
      where table_name = 'product_bom'
        and column_name in ('notes', 'cut_list')
      order by column_name
    `;
    const enumVals = await sql`
      select e.enumlabel
      from pg_enum e
      join pg_type t on e.enumtypid = t.oid
      where t.typname = 'recipe_source'
      order by e.enumsortorder
    `;
    const mig = await sql`
      select id, hash, created_at
      from drizzle.__drizzle_migrations
      order by created_at desc
      limit 5
    `;
    console.log(JSON.stringify({ cols, enumVals, mig }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
