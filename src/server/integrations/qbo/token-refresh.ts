/**
 * Phase 9 Task 4 — QBO token refresh mutex (testable core).
 *
 * Why this exists: Intuit rotates the refresh token on every refresh. If two workers
 * refresh concurrently, one of them burns the other's refresh token and the connection
 * is lost until someone redoes OAuth. So:
 *
 *  - exactly ONE worker per QBO environment refreshes at a time (`pg_advisory_xact_lock`);
 *  - every waiter re-reads the row after acquiring the lock (double-checked refresh), so
 *    N concurrent callers produce exactly ONE call to Intuit;
 *  - all token READS outside the lock use `getDb()`. The mutex client is `max: 1`, so
 *    reading through it (or touching `getMutexDb()` again inside the lock callback)
 *    would starve or deadlock the process. Inside the callback use ONLY `tx`.
 *
 * Transaction pooler (6543) safe: only the transaction-scoped `pg_advisory_xact_*` family is used (never a
 * session-level advisory lock), and the clients already run with `prepare: false`.
 *
 * Do not import `src/env.ts` here (its Proxy throws when POSTGRES_URL is missing);
 * read `process.env` directly, like the rest of the QBO client.
 */
import { eq, sql } from "drizzle-orm";
import { getDb, getMutexDb, type MiddlewareDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { sendOhCrapAlert, type OhCrapAlertInput } from "@/server/alerts/oh-crap";
import { logError, logStructured } from "@/lib/log/structured";

export type QboLockEnvironment = "sandbox" | "production";

export const QBO_REFRESH_LOCK_NAMESPACE = "ccpatio:qbo_token_refresh";
export const QBO_REFRESH_TIMEOUT_MS = 10_000;
export const QBO_API_TIMEOUT_MS = 20_000;
export const QBO_LOCK_TIMEOUT = "15s";
export const QBO_STATEMENT_TIMEOUT = "30s";
/** Refresh when fewer than this many ms of validity remain. */
export const QBO_EXPIRY_SKEW_MS = 5 * 60 * 1000;
export const QBO_TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

/* ------------------------------------------------------------------ typed errors */

export class QboRefreshTimeoutError extends Error {
  readonly code = "QBO_REFRESH_TIMEOUT";
  constructor(ms: number = QBO_REFRESH_TIMEOUT_MS) {
    super(`QBO token refresh timed out after ${ms}ms`);
    this.name = "QboRefreshTimeoutError";
  }
}

export class QboApiTimeoutError extends Error {
  readonly code = "QBO_API_TIMEOUT";
  constructor(ms: number = QBO_API_TIMEOUT_MS) {
    super(`QBO API request timed out after ${ms}ms`);
    this.name = "QboApiTimeoutError";
  }
}

export class QboRefreshError extends Error {
  readonly code = "QBO_REFRESH_FAILED";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "QboRefreshError";
  }
}

/** Second 401 in a row: refreshing did not help, a human has to reconnect QBO. */
export class QboAuthError extends Error {
  readonly code = "QBO_AUTH_FAILED";
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "QboAuthError";
  }
}

export class QboApiError extends Error {
  readonly code = "QBO_API_ERROR";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "QboApiError";
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/* ------------------------------------------------------------------ lock keys */

/** FNV-1a 32-bit, returned as a signed int32 (the range of a Postgres int4). */
function fnv1aInt4(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash | 0;
}

/**
 * Two int4 keys for `pg_advisory_xact_lock(k1, k2)`.
 *  k1: fixed namespace constant (all QBO refresh locks share it)
 *  k2: derived from the environment, so sandbox and production never block each other
 * `namespace` is overridable ONLY so integration tests can use a private lock space and
 * never contend with a real refresh.
 */
export function qboRefreshLockKeys(
  env: QboLockEnvironment,
  namespace: string = QBO_REFRESH_LOCK_NAMESPACE,
): [number, number] {
  return [fnv1aInt4(namespace), fnv1aInt4(`env:${env}`)];
}

type LockTx = Parameters<Parameters<MiddlewareDb["transaction"]>[0]>[0];

/**
 * Runs `fn` inside a transaction on the dedicated mutex connection, holding the
 * per-environment advisory lock. Inside `fn` use ONLY `tx`.
 */
export async function withQboRefreshLock<T>(
  env: QboLockEnvironment,
  fn: (tx: LockTx) => Promise<T>,
  opts: { namespace?: string; db?: MiddlewareDb } = {},
): Promise<T> {
  const db = opts.db ?? getMutexDb();
  const [k1, k2] = qboRefreshLockKeys(env, opts.namespace);
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${QBO_LOCK_TIMEOUT}'`));
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${QBO_STATEMENT_TIMEOUT}'`));
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${k1}::int, ${k2}::int)`);
    return fn(tx);
  });
}

/* ------------------------------------------------------------------ token store */

export type QboTokenRow = {
  id: boolean;
  realm_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | null;
};

export type QboTokenPatch = {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
};

/** What a caller may do while holding the lock. */
export type LockedTokenAccess = {
  read(id: boolean): Promise<QboTokenRow | undefined>;
  update(id: boolean, patch: QboTokenPatch): Promise<QboTokenRow>;
};

export type QboTokenStore = {
  /** Plain read, NOT under the lock, NOT on the mutex connection. */
  read(id: boolean): Promise<QboTokenRow | undefined>;
  withLock<T>(
    env: QboLockEnvironment,
    fn: (locked: LockedTokenAccess) => Promise<T>,
  ): Promise<T>;
};

export function createDefaultTokenStore(): QboTokenStore {
  return {
    async read(id) {
      const [row] = await getDb()
        .select()
        .from(qbo_auth_tokens)
        .where(eq(qbo_auth_tokens.id, id));
      return row;
    },
    withLock(env, fn) {
      return withQboRefreshLock(env, (tx) =>
        fn({
          async read(id) {
            const [row] = await tx
              .select()
              .from(qbo_auth_tokens)
              .where(eq(qbo_auth_tokens.id, id));
            return row;
          },
          async update(id, patch) {
            const [row] = await tx
              .update(qbo_auth_tokens)
              .set(patch)
              .where(eq(qbo_auth_tokens.id, id))
              .returning();
            if (!row) throw new Error("QBO token row vanished during refresh.");
            return row;
          },
        }),
      );
    },
  };
}

/* ------------------------------------------------------------------ refresh + fetch */

export type QboFetchDeps = {
  store: QboTokenStore;
  fetch: typeof fetch;
  now: () => number;
  alert: (input: OhCrapAlertInput) => Promise<unknown>;
  env: QboLockEnvironment;
  /** Row id for `env` (production -> true, sandbox -> false). */
  targetId: boolean;
  baseUrl: string;
  credentials: () => { clientId: string; clientSecret: string };
};

function needsRefresh(row: QboTokenRow, now: number): boolean {
  if (!row.access_token) return true;
  return Boolean(row.expires_at && row.expires_at.getTime() - now < QBO_EXPIRY_SKEW_MS);
}

function lockEnvFor(row: QboTokenRow): QboLockEnvironment {
  // Lock follows the row actually being refreshed. The legacy fallback (sandbox env, but
  // the id=true row) must serialize with real production refreshes of that same row.
  return row.id ? "production" : "sandbox";
}

async function readRow(deps: QboFetchDeps): Promise<QboTokenRow> {
  let row = await deps.store.read(deps.targetId);
  // Existing graceful fallback: sandbox row not initialised yet -> legacy singleton id=true.
  if (!row && !deps.targetId) {
    row = await deps.store.read(true);
  }
  if (!row) {
    throw new Error(
      `No QBO auth tokens found for environment "${deps.env}". Please complete OAuth flow first.`,
    );
  }
  return row;
}

/** Calls Intuit. Validates the response BEFORE anything is persisted. */
async function callIntuitRefresh(
  deps: QboFetchDeps,
  refreshToken: string,
): Promise<QboTokenPatch> {
  const { clientId, clientSecret } = deps.credentials();
  if (!clientId || !clientSecret) {
    throw new QboRefreshError("QBO_CLIENT_ID / QBO_CLIENT_SECRET are not configured.");
  }
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let res: Response;
  try {
    res = await deps.fetch(QBO_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(QBO_REFRESH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLike(error)) throw new QboRefreshTimeoutError();
    throw error;
  }

  if (!res.ok) {
    // Truncated; Intuit error bodies describe the failure, they do not echo our tokens.
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch (readError) {
      // The refresh already failed; an unreadable body only loses detail. Say so, and go on.
      logError("qbo-refresh-error-body-unreadable", readError, { status: res.status });
    }
    throw new QboRefreshError(`Failed to refresh QBO token (HTTP ${res.status}): ${body}`, res.status);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (parseError) {
    logError("qbo-refresh-response-not-json", parseError, { status: res.status });
    throw new QboRefreshError("QBO token refresh returned a non-JSON body.", res.status);
  }
  const record = (data ?? {}) as Record<string, unknown>;
  const accessToken = record.access_token;
  const newRefreshToken = record.refresh_token;
  const expiresIn = record.expires_in;

  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new QboRefreshError("QBO token refresh response is missing access_token.");
  }
  if (typeof newRefreshToken !== "string" || !newRefreshToken.trim()) {
    throw new QboRefreshError("QBO token refresh response is missing refresh_token.");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new QboRefreshError("QBO token refresh response has an invalid expires_in.");
  }

  return {
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_at: new Date(deps.now() + expiresIn * 1000),
  };
}

async function safeAlert(deps: QboFetchDeps, input: OhCrapAlertInput): Promise<void> {
  try {
    await deps.alert(input);
  } catch (alertError) {
    // The alert path must never mask the real failure.
    logError("qbo-ops-alert-failed", alertError, { reason: input.reason });
  }
}

/**
 * Takes the lock, re-reads the row, and refreshes only if `shouldRefresh(current)`.
 * Returns the row to use. If Intuit issued new tokens but persisting them fails (UPDATE
 * or COMMIT), alerts WITHOUT token values and rethrows. Never swallowed.
 */
async function refreshUnderLock(
  deps: QboFetchDeps,
  rowId: boolean,
  lockEnv: QboLockEnvironment,
  shouldRefresh: (current: QboTokenRow) => boolean,
): Promise<QboTokenRow> {
  let intuitIssuedNewTokens = false;
  try {
    return await deps.store.withLock(lockEnv, async (locked) => {
      const current = await locked.read(rowId);
      if (!current) throw new Error("No QBO auth tokens found during lock escalation.");

      // Double-check: another worker may have refreshed while we waited for the lock.
      if (!shouldRefresh(current)) return current;
      if (!current.refresh_token) {
        throw new QboRefreshError("No QBO refresh token stored. Reconnect QuickBooks (OAuth).");
      }

      logStructured("info", "qbo-token-refresh-start", { env: deps.env, lockEnv });
      const patch = await callIntuitRefresh(deps, current.refresh_token);
      intuitIssuedNewTokens = true;
      return locked.update(rowId, patch);
    });
  } catch (error) {
    if (intuitIssuedNewTokens) {
      await safeAlert(deps, {
        reason: "qbo_token_persist_failed",
        source: "qbo",
        externalId: `qbo:${deps.env}`,
        message:
          "Intuit issued new QBO tokens but they could not be saved to the database. " +
          "The rotated refresh token may be lost; reconnect QuickBooks if API calls start failing. " +
          `Cause: ${error instanceof Error ? error.name : "unknown error"}`,
      });
    }
    throw error;
  }
}

async function callQboApi(
  deps: QboFetchDeps,
  endpoint: string,
  options: RequestInit,
  accessToken: string,
): Promise<Response> {
  try {
    return await deps.fetch(`${deps.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(QBO_API_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLike(error)) throw new QboApiTimeoutError();
    throw error;
  }
}

/**
 * Authenticated QBO call with proactive refresh, one 401-triggered retry, and typed
 * timeouts. Returns the parsed JSON body.
 */
export async function qboFetchWithRefresh(
  endpoint: string,
  options: RequestInit,
  deps: QboFetchDeps,
): Promise<unknown> {
  let row = await readRow(deps);

  if (needsRefresh(row, deps.now())) {
    row = await refreshUnderLock(deps, row.id, lockEnvFor(row), (current) =>
      needsRefresh(current, deps.now()),
    );
  }

  let accessToken = row.access_token as string;
  let response = await callQboApi(deps, endpoint, options, accessToken);

  if (response.status === 401) {
    const failedToken = accessToken;
    // Another worker may already have refreshed (token changed) -> just use theirs.
    // Otherwise force a refresh. Either way: ONE retry only.
    row = await refreshUnderLock(
      deps,
      row.id,
      lockEnvFor(row),
      (current) => !current.access_token || current.access_token === failedToken,
    );
    accessToken = row.access_token as string;
    response = await callQboApi(deps, endpoint, options, accessToken);

    if (response.status === 401) {
      await safeAlert(deps, {
        reason: "qbo_auth_failed",
        source: "qbo",
        externalId: `qbo:${deps.env}`,
        message:
          "QBO API returned 401 again after a token refresh. QuickBooks must be reconnected (OAuth).",
      });
      throw new QboAuthError(
        "QBO API returned 401 after token refresh and one retry. Reconnect QuickBooks.",
      );
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new QboApiError(
      `QBO Fetch Failed: ${response.status} ${response.statusText} - ${errorText}`,
      response.status,
    );
  }

  return response.json();
}

export function createDefaultQboFetchDeps(
  base: Pick<QboFetchDeps, "env" | "targetId" | "baseUrl">,
): QboFetchDeps {
  return {
    ...base,
    store: createDefaultTokenStore(),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    alert: sendOhCrapAlert,
    credentials: () => ({
      clientId: process.env.QBO_CLIENT_ID ?? "",
      clientSecret: process.env.QBO_CLIENT_SECRET ?? "",
    }),
  };
}
