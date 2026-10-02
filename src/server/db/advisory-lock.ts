import postgres from "postgres";

/**
 * Session lock on one dedicated connection, held across the Katana calls
 * inside `fn`. A pool connection cannot own this lock.
 */
export async function withAdvisoryLock<T>(
  variantId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  if (!Number.isInteger(variantId) || variantId <= 0) {
    throw new Error("Advisory lock requires a positive variant id.");
  }

  const sql = postgres(url, { max: 1 });
  let locked = false;
  try {
    await sql`select pg_advisory_lock(${variantId}::bigint)`;
    locked = true;
    return await fn();
  } finally {
    try {
      if (locked) {
        await sql`select pg_advisory_unlock(${variantId}::bigint)`;
      }
    } catch (error: unknown) {
      console.error("[soft-hold] advisory unlock failed", error);
    }
    try {
      await sql.end({ timeout: 5 });
    } catch (error: unknown) {
      console.error("[soft-hold] advisory connection close failed", error);
    }
  }
}
