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

  it("ignores events without a run id (cannot be made idempotent)", async () => {
    const deps = makeDeps();
    const out = await handleFunctionFailed({ function_id: "fn-a" }, deps);
    expect(out).toEqual({ status: "ignored", reason: "missing_run_id" });
    expect(deps.record).not.toHaveBeenCalled();
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
      { ...failure, error: { message: "refresh failed Bearer abc123SECRET" } },
      deps,
    );
    const alertInput = (deps.alert as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      reason: string;
      source: string;
      externalId: string;
    };
    expect(alertInput.reason).toBe("function_failed");
    expect(alertInput.source).toBe("system");
    expect(alertInput.externalId).toBe("run-123");
    expect(JSON.stringify(alertInput)).not.toContain("abc123SECRET");
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
