import { describe, expect, it, vi } from "vitest";
import {
  DLQ_MAX_EVENT_BYTES,
  DLQ_MAX_STACK_CHARS,
  DLQ_REDACTED,
  GLOBAL_DLQ_HANDLER_ID,
  handleFunctionFailed,
  isDlqHandlerFunction,
  prepareOriginalEvent,
  recordDlqEvent,
  redactSecrets,
  scrubSecretText,
  truncateStack,
  DLQ_ALERT_UNDELIVERED_TAG,
  DLQ_MALFORMED_PREFIX,
  syntheticRunId,
  type DlqDeps,
  type FunctionFailedData,
} from "@/inngest/dlq";
import { globalDlqHandler } from "@/inngest/dlq";
import { inngestFunctions } from "@/inngest/functions";

describe("redactSecrets", () => {
  it("strips secret-looking keys recursively, including inside arrays", () => {
    const input = {
      name: "ok",
      access_token: "AAA",
      nested: {
        Authorization: "Bearer BBB",
        deep: [{ client_secret: "CCC", keep: 1 }, { password: "DDD" }],
        apiKey: "EEE",
        api_key: "FFF",
        "api-key": "GGG",
      },
      refreshToken: "HHH",
    };
    const out = redactSecrets(input) as Record<string, unknown>;
    const text = JSON.stringify(out);
    for (const leaked of ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain(DLQ_REDACTED);
    expect(out.name).toBe("ok");
    expect((out.nested as any).deep[0].keep).toBe(1);
  });

  it("does not mutate the input and survives circular references", () => {
    const input: Record<string, unknown> = { secret: "x", a: { b: 1 } };
    input.self = input;
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(input.secret).toBe("x");
    expect(out.secret).toBe(DLQ_REDACTED);
    expect(out.self).toBe("[Circular]");
  });

  it("passes primitives and null through", () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(5)).toBe(5);
    expect(redactSecrets("s")).toBe("s");
  });
});

describe("size cap and truncation", () => {
  it("keeps small events, redacted", () => {
    const out = prepareOriginalEvent({ id: 1, token: "zzz" }) as Record<string, unknown>;
    expect(out).toEqual({ id: 1, token: DLQ_REDACTED });
  });

  it("replaces an event over ~256KB with { truncated, bytes, keys }", () => {
    const big = { id: "evt", data: "x".repeat(DLQ_MAX_EVENT_BYTES + 10), password: "p" };
    const out = prepareOriginalEvent(big) as { truncated: boolean; bytes: number; keys: string[] };
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBeGreaterThan(DLQ_MAX_EVENT_BYTES);
    expect(out.keys.sort()).toEqual(["data", "id", "password"]);
    expect(JSON.stringify(out)).not.toContain("xxxx");
  });

  it("counts bytes, not characters", () => {
    const multibyte = { data: "€".repeat(Math.ceil(DLQ_MAX_EVENT_BYTES / 3) + 100) };
    expect((prepareOriginalEvent(multibyte) as { truncated?: boolean }).truncated).toBe(true);
  });

  it("truncates error_stack to 8KB", () => {
    const stack = "at line\n".repeat(5000);
    expect(truncateStack(stack)!.length).toBe(DLQ_MAX_STACK_CHARS);
    expect(truncateStack("short")).toBe("short");
    expect(truncateStack(null)).toBeNull();
    expect(truncateStack("")).toBeNull();
  });

  it("scrubs bearer tokens and key=value secrets from error text", () => {
    const text = scrubSecretText(
      'Failed: Bearer abc.DEF-123 and {"access_token":"SECRETVALUE","x":1} client_secret=zzz',
    );
    expect(text).not.toContain("abc.DEF-123");
    expect(text).not.toContain("SECRETVALUE");
    expect(text).not.toContain("zzz");
  });
});

describe("loop guard", () => {
  it("recognizes the bare and app-prefixed handler id", () => {
    expect(isDlqHandlerFunction(GLOBAL_DLQ_HANDLER_ID)).toBe(true);
    expect(isDlqHandlerFunction(`ccpatio-middleware-${GLOBAL_DLQ_HANDLER_ID}`)).toBe(true);
    expect(isDlqHandlerFunction("ccpatio-middleware-publish-approved-product")).toBe(false);
    expect(isDlqHandlerFunction("")).toBe(false);
    expect(isDlqHandlerFunction(undefined)).toBe(false);
  });

  it("ignores failures of the DLQ handler itself without touching DB or alerts", async () => {
    const deps = makeDeps();
    const out = await handleFunctionFailed(
      { function_id: `ccpatio-middleware-${GLOBAL_DLQ_HANDLER_ID}`, run_id: "run-1", error: { message: "boom" } },
      deps,
    );
    expect(out).toEqual({ status: "ignored", reason: "self_loop" });
    expect(deps.record).not.toHaveBeenCalled();
    expect(deps.alert).not.toHaveBeenCalled();
  });

  it("only the self-loop is ever ignored: a failure event with no run_id is RECORDED, never dropped (D5)", async () => {
    const deps = makeDeps();
    const out = await handleFunctionFailed({ function_id: "fn-a" }, deps);
    expect(out).toEqual({ status: "recorded", inserted: true, alerted: true, synthetic: true });
    expect(deps.record).toHaveBeenCalledTimes(1);
    expect(deps.alert).toHaveBeenCalledTimes(1);
  });
});

describe("D5: failure events without a run_id", () => {
  const noRun = (over: Partial<FunctionFailedData> = {}): FunctionFailedData => ({
    function_id: "ccpatio-middleware-fn-a",
    error: { message: "kaboom" },
    event: { id: "evt-77", name: "x/y", data: { a: 1 } },
    ...over,
  });

  it("synthesizes a stable `norunid:<fn>:<event.id>` key, prefixes the message, and alerts", async () => {
    const deps = makeDeps();
    await handleFunctionFailed(noRun(), deps);
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "norunid:ccpatio-middleware-fn-a:evt-77",
        errorMessage: `${DLQ_MALFORMED_PREFIX}kaboom`,
      }),
    );
    expect(DLQ_MALFORMED_PREFIX).toBe("[malformed failure event: no run_id] ");
    expect(deps.alert).toHaveBeenCalledTimes(1);
  });

  it("falls back to the first 16 hex of sha256 of the redacted event when there is no event.id", () => {
    const key = syntheticRunId({ function_id: "fn-b", event: { name: "x", data: { token: "A", n: 1 } } });
    expect(key).toMatch(/^norunid:fn-b:[0-9a-f]{16}$/);
    // Redaction happens BEFORE hashing, so a rotated secret does not fork the key...
    expect(key).toBe(
      syntheticRunId({ function_id: "fn-b", event: { name: "x", data: { token: "B", n: 1 } } }),
    );
    // ...but real content differences do.
    expect(key).not.toBe(
      syntheticRunId({ function_id: "fn-b", event: { name: "x", data: { token: "A", n: 2 } } }),
    );
  });

  it("the same malformed event delivered twice yields ONE row and ONE alert", async () => {
    const rows = new Set<string>();
    const alertedRuns = new Set<string>();
    const alert = vi.fn(async () => ({ ok: true as const, emailed: true, resolutionUrl: "u" }));
    const deps = makeDeps({
      record: vi.fn(async (input: { runId: string }) => {
        const fresh = !rows.has(input.runId);
        rows.add(input.runId);
        return fresh;
      }),
      isAlertSent: vi.fn(async (runId: string) => alertedRuns.has(runId)),
      markAlertSent: vi.fn(async (runId: string) => {
        alertedRuns.add(runId);
      }),
      alert,
    });
    const first = await handleFunctionFailed(noRun(), deps);
    const second = await handleFunctionFailed(noRun(), deps);
    expect(first).toMatchObject({ inserted: true, alerted: true, synthetic: true });
    expect(second).toMatchObject({ inserted: false, alerted: false, synthetic: true });
    expect(rows.size).toBe(1);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("a missing function_id records \"unknown\" instead of being ignored", async () => {
    const deps = makeDeps();
    const out = await handleFunctionFailed({ run_id: "r-1", error: { message: "m" } }, deps);
    expect(out).toEqual({ status: "recorded", inserted: true, alerted: true });
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r-1", functionId: "unknown" }),
    );
    // Neither run_id nor function_id: still recorded.
    const bare = makeDeps();
    await handleFunctionFailed({}, bare);
    expect(bare.record).toHaveBeenCalledWith(
      expect.objectContaining({ functionId: "unknown", runId: expect.stringMatching(/^norunid:unknown:[0-9a-f]{16}$/) }),
    );
  });

  it("writes one structured console.error line for the malformed event", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleFunctionFailed(noRun(), makeDeps());
      const lines = spy.mock.calls.map((c) => String(c[0]));
      const structured = lines.filter((l) => l.includes("dlq-malformed-failure-event"));
      expect(structured).toHaveLength(1);
      expect(JSON.parse(structured[0]!)).toMatchObject({
        tag: "dlq-malformed-failure-event",
        syntheticRunId: "norunid:ccpatio-middleware-fn-a:evt-77",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("if even the synthetic row cannot be persisted, it THROWS so Inngest retries", async () => {
    const deps = makeDeps({
      record: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(handleFunctionFailed(noRun(), deps)).rejects.toThrow(/db down/);
    expect(deps.alert).not.toHaveBeenCalled();
  });
});

describe("D5: alert undeliverable (no OH_CRAP_ADMIN_EMAIL)", () => {
  const failing = () => ({ ok: false as const, error: "OH_CRAP_ADMIN_EMAIL is not set" });
  const sample: FunctionFailedData = { function_id: "fn", run_id: "run-u", error: { message: "m" } };

  it("throws every attempt (so Inngest retries) and emits ONE loud JSON line only on the final attempt", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const deps = makeDeps({ alert: vi.fn(async () => failing()) });
        await expect(
          handleFunctionFailed(sample, deps, { attempt, maxAttempts: 5 }),
        ).rejects.toThrow(/DLQ alert failed for run run-u/);
        expect(deps.markAlertSent).not.toHaveBeenCalled(); // row stays alert_sent=false
      }
      const loud = spy.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes(DLQ_ALERT_UNDELIVERED_TAG));
      expect(loud).toHaveLength(1);
      expect(JSON.parse(loud[0]!)).toMatchObject({ tag: "dlq-alert-undelivered", runId: "run-u" });
    } finally {
      spy.mockRestore();
    }
  });

  it("stays quiet when no attempt context is supplied (non-final or unknown)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = makeDeps({ alert: vi.fn(async () => failing()) });
      await expect(handleFunctionFailed(sample, deps)).rejects.toThrow();
      expect(
        spy.mock.calls.map((c) => String(c[0])).some((l) => l.includes(DLQ_ALERT_UNDELIVERED_TAG)),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

function makeDeps(overrides: Partial<DlqDeps> = {}) {
  const calls: string[] = [];
  const deps = {
    calls,
    record: vi.fn(async () => {
      calls.push("record");
      return true;
    }),
    isAlertSent: vi.fn(async () => {
      calls.push("isAlertSent");
      return false;
    }),
    markAlertSent: vi.fn(async () => {
      calls.push("markAlertSent");
    }),
    alert: vi.fn(async () => {
      calls.push("alert");
      return { ok: true as const, emailed: true, resolutionUrl: "http://x" };
    }),
    ...overrides,
  };
  return deps;
}

const failure: FunctionFailedData = {
  function_id: "ccpatio-middleware-publish-approved-product",
  run_id: "run-123",
  error: { name: "Error", message: "kaboom", stack: "Error: kaboom\n  at x" },
  event: { id: "evt-1", name: "product.approved", data: { globalSku: "ABC", token: "t0p" } },
};

describe("handleFunctionFailed ordering", () => {
  it("writes the DB row FIRST, then alerts, then marks alert_sent", async () => {
    const deps = makeDeps();
    const out = await handleFunctionFailed(failure, deps);
    expect(out).toEqual({ status: "recorded", inserted: true, alerted: true });
    expect(deps.calls).toEqual(["record", "isAlertSent", "alert", "markAlertSent"]);
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-123",
        functionId: "ccpatio-middleware-publish-approved-product",
        eventId: "evt-1",
        eventName: "product.approved",
        errorMessage: "kaboom",
      }),
    );
  });

  it("alert ok:false THROWS (so Inngest retries) and does not mark alert_sent", async () => {
    const deps = makeDeps({
      alert: vi.fn(async () => {
        deps_calls.push("alert");
        return { ok: false as const, error: "Resend failed (500)" };
      }),
    });
    const deps_calls = deps.calls;
    await expect(handleFunctionFailed(failure, deps)).rejects.toThrow(/DLQ alert failed for run run-123/);
    expect(deps.record).toHaveBeenCalledTimes(1);
    expect(deps.markAlertSent).not.toHaveBeenCalled();
    // Row was written before the failing alert.
    expect(deps.calls.indexOf("record")).toBeLessThan(deps.calls.indexOf("alert"));
  });

  it("a retry after a failed alert is safe: record again is a no-op insert and the alert is re-sent", async () => {
    const record = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const alert = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "down" })
      .mockResolvedValueOnce({ ok: true, emailed: true, resolutionUrl: "u" });
    const deps = makeDeps({ record, alert });
    await expect(handleFunctionFailed(failure, deps)).rejects.toThrow();
    const out = await handleFunctionFailed(failure, deps);
    expect(out).toEqual({ status: "recorded", inserted: false, alerted: true });
    expect(deps.markAlertSent).toHaveBeenCalledTimes(1);
  });

  it("double delivery after alert_sent=true does NOT alert again", async () => {
    const deps = makeDeps({ isAlertSent: vi.fn(async () => true), record: vi.fn(async () => false) });
    const out = await handleFunctionFailed(failure, deps);
    expect(out).toEqual({ status: "recorded", inserted: false, alerted: false });
    expect(deps.alert).not.toHaveBeenCalled();
    expect(deps.markAlertSent).not.toHaveBeenCalled();
  });

  it("alert payload uses function_failed/system and carries no token values", async () => {
    const deps = makeDeps();
    await handleFunctionFailed(
      { ...failure, function_id: "ccpatio-middleware-some-other-fn", error: { message: "refresh failed Bearer abc123SECRET" } },
      deps,
    );
    const alertInput = (deps.alert as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      reason: string;
      source: string;
      externalId: string;
    };
    expect(alertInput.reason).toBe("function_failed");
    expect(alertInput.source).toBe("system");
    expect(alertInput.externalId).toBe("run-123"); // unknown function: generic alert keyed by run id
    expect(JSON.stringify(alertInput)).not.toContain("abc123SECRET");
  });

  it("D4: a known function's alert carries the resolver context (id + resolution link), exactly once", async () => {
    const deps = makeDeps();
    await handleFunctionFailed(failure, deps); // publish-approved-product, globalSku ABC
    expect(deps.alert).toHaveBeenCalledTimes(1);
    expect(deps.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "function_failed",
        source: "system",
        externalId: "ABC",
        sku: "ABC",
        resolutionPath: "/admin/quarantine?sku=ABC",
      }),
    );
    const sent = JSON.stringify((deps.alert as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(sent).not.toContain("t0p"); // event token never reaches the alert
  });

  it("tolerates a failure event with no message", async () => {
    const deps = makeDeps();
    await handleFunctionFailed({ function_id: "fn", run_id: "r", error: null, event: null }, deps);
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: expect.stringMatching(/Unknown error/), eventName: "unknown" }),
    );
  });
});

describe("recordDlqEvent", () => {
  function fakeDb(returned: Array<{ id: string }>) {
    const captured: { values?: Record<string, unknown>; conflictTarget?: unknown } = {};
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          captured.values = v;
          return {
            onConflictDoNothing: (arg: { target: unknown }) => {
              captured.conflictTarget = arg.target;
              return { returning: async () => returned };
            },
          };
        },
      }),
    } as never;
    return { db, captured };
  }

  const input = {
    runId: "run-9",
    functionId: "fn",
    eventName: "x/y",
    errorMessage: "bad Bearer tok123",
    errorStack: "s".repeat(DLQ_MAX_STACK_CHARS + 500),
    originalEvent: { data: { client_secret: "SECRETVAL" } },
  };

  it("returns true when a row was inserted and false on conflict", async () => {
    expect(await recordDlqEvent(input, fakeDb([{ id: "1" }]).db)).toBe(true);
    expect(await recordDlqEvent(input, fakeDb([]).db)).toBe(false);
  });

  it("inserts redacted/capped data and conflicts on run_id", async () => {
    const { db, captured } = fakeDb([{ id: "1" }]);
    await recordDlqEvent(input, db);
    expect(captured.conflictTarget).toBeDefined();
    expect(JSON.stringify(captured.values)).not.toContain("SECRETVAL");
    expect(JSON.stringify(captured.values)).not.toContain("tok123");
    expect((captured.values!.error_stack as string).length).toBe(DLQ_MAX_STACK_CHARS);
  });
});

describe("registration", () => {
  it("globalDlqHandler is registered and keeps the agreed id", () => {
    expect(inngestFunctions).toContain(globalDlqHandler);
    expect(globalDlqHandler.id()).toContain(GLOBAL_DLQ_HANDLER_ID);
  });
});
