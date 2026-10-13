import { describe, expect, it, vi } from "vitest";
import {
  QboApiTimeoutError,
  QboAuthError,
  QboRefreshError,
  QboRefreshTimeoutError,
  qboFetchWithRefresh,
  qboRefreshLockKeys,
  type LockedTokenAccess,
  type QboFetchDeps,
  type QboLockEnvironment,
  type QboTokenRow,
  type QboTokenStore,
} from "@/server/integrations/qbo/token-refresh";

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function row(over: Partial<QboTokenRow> = {}): QboTokenRow {
  return {
    id: true,
    realm_id: "realm-1",
    access_token: "ACCESS_OLD",
    refresh_token: "REFRESH_OLD",
    expires_at: new Date(NOW + HOUR),
    ...over,
  };
}

/** In-memory token store with a real mutex (waiters queue, like pg_advisory_xact_lock). */
function makeStore(initial: QboTokenRow[], opts: { failUpdate?: boolean; failCommit?: boolean } = {}) {
  const rows = new Map<boolean, QboTokenRow>(initial.map((r) => [r.id, { ...r }]));
  let tail: Promise<void> = Promise.resolve();
  const lockEnvs: QboLockEnvironment[] = [];
  const store: QboTokenStore = {
    read: vi.fn(async (id: boolean) => {
      const r = rows.get(id);
      return r ? { ...r } : undefined;
    }),
    async withLock<T>(env: QboLockEnvironment, fn: (l: LockedTokenAccess) => Promise<T>): Promise<T> {
      lockEnvs.push(env);
      const prev = tail;
      let release!: () => void;
      tail = new Promise<void>((r) => (release = r));
      await prev;
      try {
        const result = await fn({
          async read(id) {
            const r = rows.get(id);
            return r ? { ...r } : undefined;
          },
          async update(id, patch) {
            if (opts.failUpdate) throw new Error("db write failed");
            const next = { ...rows.get(id)!, ...patch };
            rows.set(id, next);
            return { ...next };
          },
        });
        if (opts.failCommit) throw new Error("commit failed");
        return result;
      } finally {
        release();
      }
    },
  };
  return { store, rows, lockEnvs };
}

function refreshOk(n = 1) {
  return new Response(
    JSON.stringify({
      access_token: `ACCESS_NEW_${n}`,
      refresh_token: `REFRESH_NEW_${n}`,
      expires_in: 3600,
    }),
    { status: 200 },
  );
}

function makeDeps(
  store: QboTokenStore,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  over: Partial<QboFetchDeps> = {},
): QboFetchDeps & { alerts: Array<Record<string, unknown>> } {
  const alerts: Array<Record<string, unknown>> = [];
  return {
    store,
    fetch: ((url: string, init: RequestInit) => fetchImpl(String(url), init)) as typeof fetch,
    now: () => NOW,
    alert: vi.fn(async (input) => {
      alerts.push(input as unknown as Record<string, unknown>);
    }),
    env: "production",
    targetId: true,
    baseUrl: "https://qbo.test",
    credentials: () => ({ clientId: "cid", clientSecret: "csecret" }),
    alerts,
    ...over,
  };
}

async function caught(p: Promise<unknown>): Promise<Error & { status?: number; code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { status?: number; code?: string };
  }
  throw new Error("expected the promise to reject");
}

const isRefreshUrl = (url: string) => url.includes("oauth.platform.intuit.com");
const bearer = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;
const ok = () => new Response(JSON.stringify({ SalesReceipt: { Id: "1" } }), { status: 200 });
const unauthorized = () => new Response("unauthorized", { status: 401 });

describe("qboRefreshLockKeys", () => {
  it("returns two int4 keys, namespace-constant first, env-derived second", () => {
    const prod = qboRefreshLockKeys("production");
    const sandbox = qboRefreshLockKeys("sandbox");
    for (const key of [...prod, ...sandbox]) {
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(key).toBeLessThanOrEqual(2 ** 31 - 1);
    }
    expect(prod[0]).toBe(sandbox[0]);
    expect(prod[1]).not.toBe(sandbox[1]);
    expect(qboRefreshLockKeys("production")).toEqual(prod);
  });

  it("namespace override gives integration tests a private lock space", () => {
    expect(qboRefreshLockKeys("production", "test:abc")[0]).not.toBe(qboRefreshLockKeys("production")[0]);
  });
});

describe("double-checked refresh", () => {
  it("10 concurrent callers with an expired token produce exactly ONE Intuit refresh", async () => {
    const { store } = makeStore([row({ expires_at: new Date(NOW - 1000) })]);
    let refreshCalls = 0;
    const seenTokens: string[] = [];
    const deps = makeDeps(store, async (url, init) => {
      if (isRefreshUrl(url)) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return refreshOk(refreshCalls);
      }
      seenTokens.push(bearer(init));
      return ok();
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => qboFetchWithRefresh("/v3/company/realm-1/salesreceipt", { method: "POST" }, deps)),
    );

    expect(refreshCalls).toBe(1);
    expect(results).toHaveLength(10);
    expect(new Set(seenTokens)).toEqual(new Set(["Bearer ACCESS_NEW_1"]));
  });

  it("does not refresh a token that is comfortably valid", async () => {
    const { store } = makeStore([row()]);
    let refreshCalls = 0;
    const deps = makeDeps(store, async (url) => {
      if (isRefreshUrl(url)) refreshCalls += 1;
      return ok();
    });
    await qboFetchWithRefresh("/x", {}, deps);
    expect(refreshCalls).toBe(0);
    expect(store.read).toHaveBeenCalled();
  });

  it("refreshes inside the 5 minute skew window", async () => {
    const { store } = makeStore([row({ expires_at: new Date(NOW + 4 * 60 * 1000) })]);
    let refreshCalls = 0;
    const deps = makeDeps(store, async (url) => {
      if (isRefreshUrl(url)) {
        refreshCalls += 1;
        return refreshOk();
      }
      return ok();
    });
    await qboFetchWithRefresh("/x", {}, deps);
    expect(refreshCalls).toBe(1);
  });

  it("persists the rotated refresh token and new expiry", async () => {
    const { store, rows } = makeStore([row({ expires_at: new Date(NOW - 1) })]);
    const deps = makeDeps(store, async (url) => (isRefreshUrl(url) ? refreshOk(7) : ok()));
    await qboFetchWithRefresh("/x", {}, deps);
    const saved = rows.get(true)!;
    expect(saved.access_token).toBe("ACCESS_NEW_7");
    expect(saved.refresh_token).toBe("REFRESH_NEW_7");
    expect(saved.expires_at!.getTime()).toBe(NOW + 3600 * 1000);
  });
});

describe("401 handling", () => {
  it("a 401 triggers a forced refresh and exactly ONE retry", async () => {
    const { store } = makeStore([row()]);
    let refreshCalls = 0;
    const apiCalls: string[] = [];
    const deps = makeDeps(store, async (url, init) => {
      if (isRefreshUrl(url)) {
        refreshCalls += 1;
        return refreshOk();
      }
      apiCalls.push(bearer(init));
      return apiCalls.length === 1 ? unauthorized() : ok();
    });

    await qboFetchWithRefresh("/x", {}, deps);

    expect(refreshCalls).toBe(1);
    expect(apiCalls).toEqual(["Bearer ACCESS_OLD", "Bearer ACCESS_NEW_1"]);
  });

  it("if another worker already rotated the token, skips the forced refresh and just retries", async () => {
    const { store, rows } = makeStore([row()]);
    let refreshCalls = 0;
    const apiCalls: string[] = [];
    const deps = makeDeps(store, async (url, init) => {
      if (isRefreshUrl(url)) {
        refreshCalls += 1;
        return refreshOk();
      }
      apiCalls.push(bearer(init));
      if (apiCalls.length === 1) {
        // Meanwhile a different worker refreshed and stored a new token.
        rows.set(true, { ...rows.get(true)!, access_token: "ACCESS_FROM_OTHER_WORKER" });
        return unauthorized();
      }
      return ok();
    });

    await qboFetchWithRefresh("/x", {}, deps);

    expect(refreshCalls).toBe(0);
    expect(apiCalls).toEqual(["Bearer ACCESS_OLD", "Bearer ACCESS_FROM_OTHER_WORKER"]);
  });

  it("a SECOND 401 throws a structured error, alerts, and never retries a third time", async () => {
    const { store } = makeStore([row()]);
    let apiCalls = 0;
    const deps = makeDeps(store, async (url) => {
      if (isRefreshUrl(url)) return refreshOk();
      apiCalls += 1;
      return unauthorized();
    });

    const err = await caught(qboFetchWithRefresh("/x", {}, deps));

    expect(err).toBeInstanceOf(QboAuthError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("QBO_AUTH_FAILED");
    expect(apiCalls).toBe(2);
    expect(deps.alerts).toHaveLength(1);
    expect(deps.alerts[0]).toMatchObject({ reason: "qbo_auth_failed", source: "qbo" });
    expect(JSON.stringify(deps.alerts[0])).not.toMatch(/ACCESS_|REFRESH_|csecret/);
  });

  it("a failing alert never masks the QboAuthError", async () => {
    const { store } = makeStore([row()]);
    const deps = makeDeps(
      store,
      async (url) => (isRefreshUrl(url) ? refreshOk() : unauthorized()),
      { alert: vi.fn(async () => Promise.reject(new Error("resend down"))) },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toBeInstanceOf(QboAuthError);
  });

  it("non-401 API errors surface with status and are not retried", async () => {
    const { store } = makeStore([row()]);
    let apiCalls = 0;
    const deps = makeDeps(store, async () => {
      apiCalls += 1;
      return new Response("nope", { status: 400, statusText: "Bad Request" });
    });
    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toThrow(/QBO Fetch Failed: 400/);
    expect(apiCalls).toBe(1);
  });
});

describe("persist failure", () => {
  it.each([
    ["UPDATE fails", { failUpdate: true }],
    ["COMMIT fails after the callback", { failCommit: true }],
  ])("%s: alerts WITHOUT token values and rethrows", async (_name, failure) => {
    const { store } = makeStore([row({ expires_at: new Date(NOW - 1) })], failure);
    const deps = makeDeps(store, async (url) => (isRefreshUrl(url) ? refreshOk(3) : ok()));

    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toThrow(/db write failed|commit failed/);

    expect(deps.alerts).toHaveLength(1);
    expect(deps.alerts[0]).toMatchObject({ reason: "qbo_token_persist_failed", source: "qbo" });
    const body = JSON.stringify(deps.alerts[0]);
    for (const secret of ["ACCESS_NEW_3", "REFRESH_NEW_3", "ACCESS_OLD", "REFRESH_OLD", "csecret", "cid"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("does NOT send a persist alert when Intuit never issued tokens", async () => {
    const { store } = makeStore([row({ expires_at: new Date(NOW - 1) })]);
    const deps = makeDeps(store, async () => new Response("invalid_grant", { status: 400 }));
    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toBeInstanceOf(QboRefreshError);
    expect(deps.alerts).toHaveLength(0);
  });
});

describe("timeouts and validation", () => {
  it("a refresh timeout is a typed, retryable error", async () => {
    const { store } = makeStore([row({ expires_at: new Date(NOW - 1) })]);
    const deps = makeDeps(store, async (url) => {
      if (isRefreshUrl(url)) throw new DOMException("The operation timed out.", "TimeoutError");
      return ok();
    });
    const err = await caught(qboFetchWithRefresh("/x", {}, deps));
    expect(err).toBeInstanceOf(QboRefreshTimeoutError);
    expect(err.code).toBe("QBO_REFRESH_TIMEOUT");
    expect(err).toBeInstanceOf(Error);
  });

  it("an API timeout is a typed error (not swallowed into null)", async () => {
    const { store } = makeStore([row()]);
    const deps = makeDeps(store, async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toBeInstanceOf(QboApiTimeoutError);
  });

  it("passes an AbortSignal to both the refresh call and the API call", async () => {
    const { store } = makeStore([row({ expires_at: new Date(NOW - 1) })]);
    const signals: Array<AbortSignal | null | undefined> = [];
    const deps = makeDeps(store, async (url, init) => {
      signals.push(init.signal);
      return isRefreshUrl(url) ? refreshOk() : ok();
    });
    await qboFetchWithRefresh("/x", {}, deps);
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it.each([
    ["missing access_token", { refresh_token: "r", expires_in: 3600 }],
    ["missing refresh_token", { access_token: "a", expires_in: 3600 }],
    ["missing expires_in", { access_token: "a", refresh_token: "r" }],
    ["non-numeric expires_in", { access_token: "a", refresh_token: "r", expires_in: "3600" }],
    ["zero expires_in", { access_token: "a", refresh_token: "r", expires_in: 0 }],
    ["empty access_token", { access_token: " ", refresh_token: "r", expires_in: 3600 }],
  ])("rejects a refresh response with %s and persists nothing", async (_name, body) => {
    const { store, rows } = makeStore([row({ expires_at: new Date(NOW - 1) })]);
    const deps = makeDeps(store, async (url) =>
      isRefreshUrl(url) ? new Response(JSON.stringify(body), { status: 200 }) : ok(),
    );
    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toBeInstanceOf(QboRefreshError);
    expect(rows.get(true)!.access_token).toBe("ACCESS_OLD");
    expect(rows.get(true)!.refresh_token).toBe("REFRESH_OLD");
  });

  it("fails clearly when client credentials are not configured", async () => {
    const { store } = makeStore([row({ expires_at: new Date(NOW - 1) })]);
    const deps = makeDeps(store, async () => ok(), {
      credentials: () => ({ clientId: "", clientSecret: "" }),
    });
    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toThrow(/QBO_CLIENT_ID/);
  });
});

describe("row selection", () => {
  it("throws a clear error when no token row exists", async () => {
    const { store } = makeStore([]);
    const deps = makeDeps(store, async () => ok());
    await expect(qboFetchWithRefresh("/x", {}, deps)).rejects.toThrow(/No QBO auth tokens found/);
  });

  it("sandbox falls back to the legacy id=true row, and locks as the row it refreshes (production)", async () => {
    const { store, lockEnvs } = makeStore([row({ id: true, expires_at: new Date(NOW - 1) })]);
    const deps = makeDeps(store, async (url) => (isRefreshUrl(url) ? refreshOk() : ok()), {
      env: "sandbox",
      targetId: false,
    });
    await qboFetchWithRefresh("/x", {}, deps);
    expect(lockEnvs).toEqual(["production"]);
  });

  it("sandbox with its own row locks as sandbox", async () => {
    const { store, lockEnvs } = makeStore([row({ id: false, expires_at: new Date(NOW - 1) })]);
    const deps = makeDeps(store, async (url) => (isRefreshUrl(url) ? refreshOk() : ok()), {
      env: "sandbox",
      targetId: false,
    });
    await qboFetchWithRefresh("/x", {}, deps);
    expect(lockEnvs).toEqual(["sandbox"]);
  });
});
