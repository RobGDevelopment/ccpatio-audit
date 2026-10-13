import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type MiddlewareDb = PostgresJsDatabase<typeof schema>;

let queryClient: ReturnType<typeof postgres> | null = null;
let dbSingleton: MiddlewareDb | null = null;

let mutexClient: ReturnType<typeof postgres> | null = null;
let mutexDbSingleton: MiddlewareDb | null = null;

/** Lazy connect so `next build` can import routes without POSTGRES_URL. */
export function getDb(): MiddlewareDb {
  if (dbSingleton) return dbSingleton;
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  queryClient = postgres(url, { prepare: false });
  dbSingleton = drizzle(queryClient, { schema });
  return dbSingleton;
}

export type MutexConnectionMode =
  /** Supavisor transaction pooler (6543). Needs `prepare: false`. Safe for `pg_advisory_xact_lock`. */
  | "transaction-pooler"
  /** Direct Postgres connection. Safe for transaction and session advisory locks. */
  | "direct"
  /** Supavisor session pooler (5432). Works, but pins one backend per client and exhausts the pooler. */
  | "session-pooler";

export type MutexConnection = {
  url: string;
  mode: MutexConnectionMode;
  /** Which env var supplied the URL. */
  source: "POSTGRES_URL_TX" | "POSTGRES_URL";
  /** Set when the resolved mode is not the one the roadmap mandates. */
  warning?: string;
};

function modeFor(rawUrl: string): MutexConnectionMode {
  let host = "";
  let port = "";
  try {
    const parsed = new URL(rawUrl);
    host = parsed.hostname;
    port = parsed.port;
  } catch {
    throw new Error("Mutex Postgres URL is not a valid URL");
  }
  const pooler = host.endsWith(".pooler.supabase.com");
  if (port === "6543") return "transaction-pooler";
  if (pooler) return "session-pooler";
  return "direct";
}

/**
 * Picks the connection the QBO token mutex (`pg_advisory_xact_lock`) runs on.
 *
 * `POSTGRES_URL_TX` wins: it must be the Supavisor transaction pooler (port 6543)
 * or a direct connection. Without it the mutex falls back to `POSTGRES_URL`, and
 * if that is the Supavisor session pooler (5432) the result carries a warning.
 * The fallback keeps QBO working today, and the dedicated `max: 1` client in
 * `getMutexDb` already stops it borrowing from the shared 10-connection pool.
 * Pure function: no I/O, no env reads beyond the `env` argument.
 */
export function resolveMutexConnection(
  env: Record<string, string | undefined> = process.env,
): MutexConnection {
  const tx = env.POSTGRES_URL_TX?.trim();
  if (tx) {
    const mode = modeFor(tx);
    if (mode === "session-pooler") {
      throw new Error(
        "POSTGRES_URL_TX points at the Supavisor session pooler (5432). Use the transaction pooler (6543) or a direct connection.",
      );
    }
    return { url: tx, mode, source: "POSTGRES_URL_TX" };
  }

  const base = env.POSTGRES_URL?.trim();
  if (!base) {
    throw new Error("POSTGRES_URL is not set");
  }
  const mode = modeFor(base);
  return {
    url: base,
    mode,
    source: "POSTGRES_URL",
    ...(mode === "session-pooler"
      ? {
          warning:
            "QBO mutex is on the Supavisor session pooler (5432). Set POSTGRES_URL_TX to the transaction pooler (6543) to avoid 'max clients reached'.",
        }
      : {}),
  };
}

let mutexWarned = false;

/**
 * Dedicated, single-connection client for the QBO token mutex. Never shared with
 * the default pool, so a webhook burst cannot starve it and it cannot starve the
 * pool. `prepare: false` is required by the transaction pooler and harmless elsewhere.
 */
export function getMutexDb(): MiddlewareDb {
  if (mutexDbSingleton) return mutexDbSingleton;
  const resolved = resolveMutexConnection();
  if (resolved.warning && !mutexWarned) {
    mutexWarned = true;
    console.warn(`[db] ${resolved.warning}`);
  }
  mutexClient = postgres(resolved.url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  mutexDbSingleton = drizzle(mutexClient, { schema });
  return mutexDbSingleton;
}

export async function closeDb(): Promise<void> {
  if (queryClient) {
    await queryClient.end({ timeout: 5 });
    queryClient = null;
    dbSingleton = null;
  }
  if (mutexClient) {
    await mutexClient.end({ timeout: 5 });
    mutexClient = null;
    mutexDbSingleton = null;
  }
}
