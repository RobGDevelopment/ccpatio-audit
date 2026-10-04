/**
 * One-time ledger fix: record 0037_omniscient_wolfpack as applied WITHOUT
 * running its SQL (its tables/columns already exist in this database).
 * Idempotent: does nothing if a row with that created_at already exists.
 *
 * Usage: npx dotenv -e .env.local -- tsx scripts/db/fix-migration-ledger.ts
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const TAG = "0037_omniscient_wolfpack";
const CREATED_AT = 1791068285458; // journal "when" for idx 37

async function main() {
  const file = readFileSync(`src/server/db/migrations/${TAG}.sql`, "utf8");
  const hash = createHash("sha256").update(file).digest("hex");
  const sql = postgres(process.env.POSTGRES_URL!);
  try {
    const existing = await sql`
      select id from drizzle.__drizzle_migrations
      where created_at = ${CREATED_AT} or hash = ${hash}`;
    if (existing.length) {
      console.log(`${TAG} already recorded (id ${existing[0].id}) — nothing to do.`);
      return;
    }
    await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${CREATED_AT})`;
    console.log(`Recorded ${TAG} (hash ${hash.slice(0, 12)}…, created_at ${CREATED_AT}).`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
