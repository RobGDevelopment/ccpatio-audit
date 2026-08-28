import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
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

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL missing");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function main() {
  await sql.unsafe(`
ALTER TABLE finished_goods_catalog
  ADD COLUMN IF NOT EXISTS weight text,
  ADD COLUMN IF NOT EXISTS cost text,
  ADD COLUMN IF NOT EXISTS qbo_item_code text,
  ADD COLUMN IF NOT EXISTS updated_by text;
`);

  await sql.unsafe(`
ALTER TABLE sku_mappings
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_by text;
`);

  const cols = await sql`
  select table_name, column_name
  from information_schema.columns
  where table_name in ('finished_goods_catalog', 'sku_mappings')
    and column_name in ('weight', 'cost', 'qbo_item_code', 'updated_by', 'updated_at')
  order by table_name, column_name
`;

  console.log(cols);
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
