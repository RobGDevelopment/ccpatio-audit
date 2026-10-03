import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

/**
 * Session lock on one dedicated connection, held across the Katana calls
 * inside `fn`. A pool connection cannot own this lock.
 *
 * Nested calls reuse that connection. Postgres advisory locks are per
 * session, so a second connection locking the same variant would wait on
 * the outer call and deadlock.
 */
type LockSession = {
  sql: postgres.Sql;
  held: Set<number>;
};

const lockSession = new AsyncLocalStorage<LockSession>();

/** Unique positive variant ids, lowest first, so two swaps cannot deadlock. */
export function advisoryLockOrder(variantIds: number[]): number[] {
  if (variantIds.length === 0) {
    throw new Error("Advisory lock requires a positive variant id.");
  }
  const unique = [...new Set(variantIds)];
  for (const id of unique) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Advisory lock requires a positive variant id.");
    }
  }
  unique.sort((a, b) => a - b);
  return unique;
}

async function lockAll(
  sql: postgres.Sql,
  ids: number[],
  held: Set<number>,
): Promise<number[]> {
  const acquired: number[] = [];
  for (const id of ids) {
    if (held.has(id)) continue;
    await sql`select pg_advisory_lock(${id}::bigint)`;
    held.add(id);
    acquired.push(id);
  }
  return acquired;
}

async function unlockAll(sql: postgres.Sql, ids: number[], held: Set<number>): Promise<void> {
  for (const id of [...ids].reverse()) {
    held.delete(id);
    try {
      await sql`select pg_advisory_unlock(${id}::bigint)`;
    } catch (error: unknown) {
      console.error("[soft-hold] advisory unlock failed", error);
    }
  }
}

export async function withAdvisoryLocks<T>(
  variantIds: number[],
  fn: () => Promise<T>,
): Promise<T> {
  const ids = advisoryLockOrder(variantIds);
  const existing = lockSession.getStore();
  if (existing) {
    const acquired = await lockAll(existing.sql, ids, existing.held);
    try {
      return await fn();
    } finally {
      await unlockAll(existing.sql, acquired, existing.held);
    }
  }

  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }

  const sql = postgres(url, { max: 1 });
  const held = new Set<number>();
  try {
    await lockAll(sql, ids, held);
    return await lockSession.run({ sql, held }, fn);
  } finally {
    await unlockAll(sql, [...held], held);
    try {
      await sql.end({ timeout: 5 });
    } catch (error: unknown) {
      console.error("[soft-hold] advisory connection close failed", error);
    }
  }
}

export async function withAdvisoryLock<T>(
  variantId: number,
  fn: () => Promise<T>,
): Promise<T> {
  return withAdvisoryLocks([variantId], fn);
}
