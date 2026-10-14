/**
 * Phase 11 remediation — Katana write fences (QCA B2, B3; M1 mandate "zero ghost demand").
 *
 * Every exported Katana writer that can reach a custom (`JOB-*`) SKU must consult the Path A fence
 * BEFORE its first network call. The fence module is mocked here so each test pins ONE thing: the
 * writer asks the fence, and when the fence refuses, `fetch` is never called and the refusal is not
 * swallowed into an `{ ok: false }` result (which Function 2 / callers would otherwise treat as data).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fence = vi.hoisted(() => ({
  assertKatanaWriteAllowed: vi.fn(async (_sku: string) => undefined),
  assertKatanaWriteAllowedForSkus: vi.fn(async (_skus: readonly string[]) => undefined),
  assertKatanaWriteAllowedForSalesOrderRows: vi.fn(async (_ids: readonly number[]) => undefined),
}));

vi.mock("@/server/path-a/katana-fence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/path-a/katana-fence")>();
  return { ...actual, ...fence };
});

vi.mock("@/server/db/client", () => ({
  getDb: () => {
    throw new Error("DB reached: the fence must stop the write before any DB/Katana access");
  },
}));

import {
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  syncFinishedGoodToKatana,
} from "@/lib/katana";
import { PathAFenceError } from "@/server/path-a/katana-fence";

const fetchMock = vi.fn();
const SAVED_ENV = { ...process.env };

beforeEach(() => {
  fence.assertKatanaWriteAllowed.mockReset().mockResolvedValue(undefined);
  fence.assertKatanaWriteAllowedForSkus.mockReset().mockResolvedValue(undefined);
  fence.assertKatanaWriteAllowedForSalesOrderRows.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.KATANA_PERSONAL_ACCESS_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...SAVED_ENV };
});

const blocked = () =>
  new PathAFenceError("blocked: pre-release custom SKU", "PATH_A_FENCE_BLOCKED");

describe("B2: syncFinishedGoodToKatana is fenced at entry", () => {
  it("consults the fence for the normalized SKU before touching the DB or Katana", async () => {
    fence.assertKatanaWriteAllowed.mockRejectedValueOnce(blocked());

    await expect(syncFinishedGoodToKatana(" job-a-sofa ")).rejects.toBeInstanceOf(PathAFenceError);

    expect(fence.assertKatanaWriteAllowed).toHaveBeenCalledWith("JOB-A-SOFA");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not convert a fence refusal into { ok: false } data", async () => {
    fence.assertKatanaWriteAllowed.mockRejectedValueOnce(blocked());
    const outcome = await syncFinishedGoodToKatana("JOB-X").then(
      (v) => ({ resolved: v }),
      (e) => ({ rejected: e }),
    );
    expect(outcome).toHaveProperty("rejected");
  });

  it("an empty SKU still short-circuits without asking the fence about ''", async () => {
    const res = await syncFinishedGoodToKatana("   ");
    expect(res).toEqual({ ok: false, error: "SKU is required" });
    expect(fence.assertKatanaWriteAllowed).not.toHaveBeenCalledWith("");
  });
});

describe("B3: createKatanaSalesOrder is fenced by every row SKU", () => {
  const payload = {
    orderNo: "PA-opp-1",
    customer: { name: "Alice" },
    source: "ghl" as const,
    salesOrderRows: [
      { sku: "JOB-A-SOFA", quantity: 1, pricePerUnit: 0, variantId: 101 },
      { sku: "FIN-CHAIR-1", quantity: 2, pricePerUnit: 10, variantId: 102 },
    ],
  };

  it("asks the fence about all row SKUs and, when refused, makes ZERO Katana calls", async () => {
    fence.assertKatanaWriteAllowedForSkus.mockRejectedValueOnce(blocked());

    await expect(createKatanaSalesOrder(payload)).rejects.toBeInstanceOf(PathAFenceError);

    expect(fence.assertKatanaWriteAllowedForSkus).toHaveBeenCalledTimes(1);
    expect(fence.assertKatanaWriteAllowedForSkus.mock.calls[0][0]).toEqual([
      "JOB-A-SOFA",
      "FIN-CHAIR-1",
    ]);
    // resolveKatanaCustomerId would POST /customers: nothing may reach the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still validates input first (empty rows is a 422, not a fence question)", async () => {
    await expect(
      createKatanaSalesOrder({ ...payload, salesOrderRows: [] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fence.assertKatanaWriteAllowedForSkus).not.toHaveBeenCalled();
  });
});

describe("B3: createMakeToOrderManufacturingOrders is fenced by the row's SKU", () => {
  it("asks the fence about the sales-order rows and, when refused, makes ZERO Katana calls", async () => {
    fence.assertKatanaWriteAllowedForSalesOrderRows.mockRejectedValueOnce(blocked());

    await expect(
      createMakeToOrderManufacturingOrders([9001, 9002], { createSubassemblies: false }),
    ).rejects.toBeInstanceOf(PathAFenceError);

    expect(fence.assertKatanaWriteAllowedForSalesOrderRows).toHaveBeenCalledWith([9001, 9002]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid row id before the fence or the network", async () => {
    await expect(createMakeToOrderManufacturingOrders([0])).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
