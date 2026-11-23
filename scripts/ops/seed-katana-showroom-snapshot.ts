/**
 * Seed Hub Postgres katana_showroom_snapshot from live Katana (429 backoff).
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/seed-katana-showroom-snapshot.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { closeDb } from "../../src/server/db/client";
import {
  ensureShowroomSnapshotTables,
  refreshShowroomSnapshotFromKatana,
} from "../../src/server/stock/showroom-snapshot";

async function main() {
  console.log("[showroom-snapshot] ensuring tables…");
  await ensureShowroomSnapshotTables();
  console.log("[showroom-snapshot] pulling Katana (throttled / 429 backoff)…");
  const hub = await refreshShowroomSnapshotFromKatana({ force: true });
  console.log(
    JSON.stringify(
      {
        ok: true,
        rowCount: hub.rowCount,
        lastSyncedAt: hub.lastSyncedAt,
        stale: hub.stale,
        error: hub.error,
      },
      null,
      2,
    ),
  );
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
