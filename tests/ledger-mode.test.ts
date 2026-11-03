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
  canPostToQbo,
  getLedgerMode,
  getLedgerPipelineMode,
} from "@/server/pipeline/ledger-mode";
import { runCloverPaymentSync } from "@/inngest/clover-sync";
import { canMutateKatanaOrders, getOrderPipelineMode } from "@/server/pipeline/mode";
import { coreEnvSchema } from "@/env";

const ORIGINAL = process.env.LEDGER_PIPELINE_MODE;
const ORIGINAL_ORDER = process.env.ORDER_PIPELINE_MODE;

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
  if (ORIGINAL_ORDER === undefined) delete process.env.ORDER_PIPELINE_MODE;
  else process.env.ORDER_PIPELINE_MODE = ORIGINAL_ORDER;
  vi.restoreAllMocks();
});

describe("getOrderPipelineMode (fail closed; Woo/GHL order gate)", () => {
  it("defaults to log when unset", () => {
    delete process.env.ORDER_PIPELINE_MODE;
    expect(getOrderPipelineMode()).toBe("log");
    expect(canMutateKatanaOrders()).toBe(false);
  });

  it.each([
    ["live", "live"],
    ["LIVE", "live"],
    [" LIVE ", "live"],
    [" live ", "live"],
    ["Live", "live"],
    ["\tLIVE\n", "live"],
    ["approve", "approve"],
    [" Approve ", "approve"],
    ["log", "log"],
    ["", "log"],
    ["   ", "log"],
    ["garbage", "log"],
    ["liv", "log"],
    ["live!", "log"],
    ["true", "log"],
    ["1", "log"],
    ["live live", "log"],
  ])("resolves %j -> %s and only live may mutate Katana", (raw, expected) => {
    process.env.ORDER_PIPELINE_MODE = raw;
    expect(getOrderPipelineMode()).toBe(expected);
    expect(canMutateKatanaOrders()).toBe(expected === "live");
  });
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

  it("refuses to POST in live mode when QBO_GATEWAY_CLEARING_ACCOUNT_ID is unset or non-numeric (QA-R6-05)", async () => {
    const prevClearing = process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID;
    const prevQbo = process.env.QBO_LEDGER_MODE;
    const prevClover = process.env.CLOVER_LEDGER_MODE;
    try {
      vi.doUnmock("@/server/integrations/qbo/client");
      vi.resetModules();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      process.env.QBO_LEDGER_MODE = "live";
      process.env.CLOVER_LEDGER_MODE = "live";
      delete process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID;
      const real = await vi.importActual<typeof import("@/server/integrations/qbo/client")>(
        "@/server/integrations/qbo/client",
      );
      await expect(real.pushToQBO({ Line: [] })).rejects.toThrow(real.QboConfigError);
      process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID = "abc";
      await expect(real.pushToQBO({ Line: [] })).rejects.toThrow(real.QboConfigError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (prevClearing === undefined) delete process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID;
      else process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID = prevClearing;
      if (prevQbo === undefined) delete process.env.QBO_LEDGER_MODE;
      else process.env.QBO_LEDGER_MODE = prevQbo;
      if (prevClover === undefined) delete process.env.CLOVER_LEDGER_MODE;
      else process.env.CLOVER_LEDGER_MODE = prevClover;
    }
  });
});

describe("per-lane ledger modes (QA-I-03)", () => {
  it("WOO_LEDGER_MODE never falls back to legacy LEDGER_PIPELINE_MODE=live", () => {
    expect(
      getLedgerMode("woo", {
        LEDGER_PIPELINE_MODE: "live",
      }),
    ).toBe("log");
    expect(
      getLedgerMode("woo", {
        LEDGER_PIPELINE_MODE: "live",
        WOO_LEDGER_MODE: "  LIVE  ",
      }),
    ).toBe("live");
  });

  it("QBO_LEDGER_MODE and CLOVER_LEDGER_MODE fall back to LEDGER_PIPELINE_MODE when unset or blank", () => {
    expect(getLedgerMode("qbo", { LEDGER_PIPELINE_MODE: "live" })).toBe("live");
    expect(getLedgerMode("qbo", { QBO_LEDGER_MODE: "   ", LEDGER_PIPELINE_MODE: "live" })).toBe(
      "live",
    );
    expect(getLedgerMode("clover", { LEDGER_PIPELINE_MODE: "live" })).toBe("live");
  });

  it("QBO_LEDGER_MODE acts as the master kill-switch over CLOVER_LEDGER_MODE", () => {
    expect(
      canPostToQbo("clover", {
        CLOVER_LEDGER_MODE: "live",
        QBO_LEDGER_MODE: "log",
      }),
    ).toBe(false);
    expect(
      canPostToQbo("clover", {
        CLOVER_LEDGER_MODE: "live",
        QBO_LEDGER_MODE: "live",
      }),
    ).toBe(true);
    expect(
      canPostToQbo("qbo", {
        QBO_LEDGER_MODE: "live",
      }),
    ).toBe(true);
    expect(
      canPostToQbo("qbo", {
        QBO_LEDGER_MODE: "log",
        LEDGER_PIPELINE_MODE: "live",
      }),
    ).toBe(false);
  });

  it.each(["garbage", "1", "true", "approve", "liv", "live!"])(
    "garbage lane value %j fails closed to log even when legacy is live",
    (raw) => {
      expect(
        getLedgerMode("qbo", {
          QBO_LEDGER_MODE: raw,
          LEDGER_PIPELINE_MODE: "live",
        }),
      ).toBe("log");
      expect(
        getLedgerMode("clover", {
          CLOVER_LEDGER_MODE: raw,
          LEDGER_PIPELINE_MODE: "live",
        }),
      ).toBe("log");
      expect(
        getLedgerMode("woo", {
          WOO_LEDGER_MODE: raw,
          LEDGER_PIPELINE_MODE: "live",
        }),
      ).toBe("log");
    },
  );
});
