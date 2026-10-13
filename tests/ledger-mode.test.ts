import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushToQBO = vi.fn();
const fetchCloverOrder = vi.fn();

vi.mock("@/server/integrations/qbo/client", () => ({
  pushToQBO: (...args: unknown[]) => pushToQBO(...args),
}));
vi.mock("@/server/integrations/clover/client", () => ({
  fetchCloverOrder: (...args: unknown[]) => fetchCloverOrder(...args),
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ qbo_item_id: "QBO-1" }],
        }),
      }),
    }),
  }),
}));
vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_opts: unknown, handler: unknown) => ({ handler }) },
}));

import {
  canMutateLedger,
  getLedgerPipelineMode,
} from "@/server/pipeline/ledger-mode";
import { runCloverPaymentSync } from "@/inngest/clover-sync";
import { coreEnvSchema } from "@/env";

const ORIGINAL = process.env.LEDGER_PIPELINE_MODE;

function fakeStep() {
  return { run: async <T,>(_id: string, fn: () => Promise<T>) => fn() };
}

const event = { data: { merchantId: "M1", paymentId: "P:123" } };

beforeEach(() => {
  pushToQBO.mockReset();
  fetchCloverOrder.mockReset();
  fetchCloverOrder.mockResolvedValue({
    lineItems: { elements: [{ id: "ITEM1", name: "Cushion", price: 12500, unitQty: 2 }] },
  });
  pushToQBO.mockResolvedValue({ SalesReceipt: { Id: "99" } });
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LEDGER_PIPELINE_MODE;
  else process.env.LEDGER_PIPELINE_MODE = ORIGINAL;
  vi.restoreAllMocks();
});

describe("getLedgerPipelineMode (fail closed)", () => {
  it("defaults to log when unset", () => {
    delete process.env.LEDGER_PIPELINE_MODE;
    expect(getLedgerPipelineMode()).toBe("log");
  });

  it.each([
    ["live", "live"],
    ["LIVE", "live"],
    [" live ", "live"],
    ["Live", "live"],
    ["\tLIVE\n", "live"],
    ["log", "log"],
    ["LOG", "log"],
    ["", "log"],
    ["   ", "log"],
    ["garbage", "log"],
    ["approve", "log"],
    ["liv", "log"],
    ["live!", "log"],
    ["true", "log"],
    ["1", "log"],
    ["lve", "log"],
    ["live live", "log"],
  ])("resolves %j -> %s", (raw, expected) => {
    process.env.LEDGER_PIPELINE_MODE = raw;
    expect(getLedgerPipelineMode()).toBe(expected);
    expect(canMutateLedger()).toBe(expected === "live");
  });
});

describe("env schema", () => {
  it("defaults LEDGER_PIPELINE_MODE to log", () => {
    const parsed = coreEnvSchema.parse({ POSTGRES_URL: "postgres://x" });
    expect(parsed.LEDGER_PIPELINE_MODE).toBe("log");
  });
});

describe("clover-sync containment", () => {
  it("log mode (unset) never calls pushToQBO and returns a dry-run result", async () => {
    delete process.env.LEDGER_PIPELINE_MODE;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await runCloverPaymentSync({ event, step: fakeStep() });

    expect(pushToQBO).toHaveBeenCalledTimes(0);
    expect(result).toMatchObject({ success: true, dryRun: true, mode: "log" });
    expect(result).toHaveProperty("qboPayload");
    expect(
      (result as { qboPayload: { Line: unknown[] } }).qboPayload.Line,
    ).toHaveLength(1);
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("P:123");
    expect(logged).toContain("ledger-containment");
  });

  it.each(["log", "garbage", "", "approve", "liv"])(
    "mode %j never calls pushToQBO",
    async (raw) => {
      process.env.LEDGER_PIPELINE_MODE = raw;
      vi.spyOn(console, "log").mockImplementation(() => {});
      const result = await runCloverPaymentSync({ event, step: fakeStep() });
      expect(pushToQBO).toHaveBeenCalledTimes(0);
      expect(result).toMatchObject({ dryRun: true, mode: "log" });
    },
  );

  it.each(["live", " LIVE ", "Live"])("mode %j calls pushToQBO exactly once", async (raw) => {
    process.env.LEDGER_PIPELINE_MODE = raw;
    const result = await runCloverPaymentSync({ event, step: fakeStep() });
    expect(pushToQBO).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, dryRun: false, mode: "live" });
  });
});

describe("pushToQBO defense in depth", () => {
  it("refuses to POST in log mode even when called directly", async () => {
    vi.doUnmock("@/server/integrations/qbo/client");
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    delete process.env.LEDGER_PIPELINE_MODE;
    const real = await vi.importActual<typeof import("@/server/integrations/qbo/client")>(
      "@/server/integrations/qbo/client",
    );
    await expect(real.pushToQBO({ Line: [] })).rejects.toThrow(/fail-closed ledger containment/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
