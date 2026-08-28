import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();
const sql = postgres(process.env.POSTGRES_URL!, { max: 1 });

async function main() {
  const migrations = await sql`
    select id, hash, created_at
    from drizzle.__drizzle_migrations
    order by id
  `;
  console.log("applied_migration_rows:", migrations.length);
  console.log(migrations);

  const catalog = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'finished_goods_catalog'
      and column_name in ('weight','cost','qbo_item_code','updated_by','na_fields')
    order by column_name
  `;
  const mapping = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sku_mappings'
      and column_name in ('updated_at','updated_by')
    order by column_name
  `;
  console.log("finished_goods_catalog extras:", catalog);
  console.log("sku_mappings extras:", mapping);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
