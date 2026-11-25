/**
 * Clear wedged Katana shared rate-limit bucket + showroom sync lock in Hub Postgres.
 * Never mutates Katana ERP records.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/reset-katana-rate-limit-bucket.ts
 */
import { resetKatanaRateLimitBucket, getKatanaBucketHealth } from "@/server/sre/katana-throttle";
import { releaseShowroomSyncLock } from "@/server/stock/showroom-snapshot";

async function main() {
  if (!process.env.POSTGRES_URL?.trim()) {
    console.error("POSTGRES_URL missing — cannot reset Hub bucket state.");
    process.exit(1);
  }
  const before = await getKatanaBucketHealth().catch((err) => {
    console.warn("pre-reset health probe failed:", err instanceof Error ? err.message : err);
    return null;
  });
  if (before) {
    console.log("before:", before);
  }
  const result = await resetKatanaRateLimitBucket();
  await releaseShowroomSyncLock().catch(() => undefined);
  const after = await getKatanaBucketHealth();
  console.log(JSON.stringify({ ok: true, reset: result, after }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
