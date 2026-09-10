/**
 * Apply 0018 sketchup cutlist notes migration idempotently.
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
loadEnvConfig(process.cwd());
import postgres from "postgres";

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL missing");
  const sql = postgres(url, { max: 1 });
  const file = path.join(
    process.cwd(),
    "src/server/db/migrations/0018_sketchup_cutlist_notes.sql",
  );
  const raw = fs.readFileSync(file, "utf8");
  // Strip drizzle breakpoints
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    for (const stmt of statements) {
      console.log("exec:", stmt.slice(0, 80).replace(/\s+/g, " "), "...");
      await sql.unsafe(stmt);
    }
    console.log("0018 applied");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
