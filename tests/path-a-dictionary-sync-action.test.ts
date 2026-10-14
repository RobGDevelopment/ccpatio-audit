/**
 * Phase 11 remediation — QCA B2: `syncFinishedGoodToKatanaAction` was an exported Server Action with
 * no session check that wrapped an unfenced Katana writer. It now requires a session and reports a
 * fence refusal as a normal `{ ok: false }` result.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  session: null as { email: string; name: string } | null,
  sync: vi.fn(async (_sku: string) => ({ ok: true as const, message: "synced" })),
  syncBom: vi.fn(async (_sku: string) => ({ ok: true as const, message: "bom_synced" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn(async () => hoisted.session),
  resolvePimOperator: vi.fn(async () => ({ email: "x", label: "x" })),
  logPimAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/katana", () => ({
  syncFinishedGoodToKatana: (sku: string) => hoisted.sync(sku),
  syncBOMToKatana: (sku: string) => hoisted.syncBom(sku),
}));
vi.mock("@/server/path-a/katana-fence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/path-a/katana-fence")>();
  return {
    ...actual,
    assertKatanaWriteAllowed: vi.fn(async () => {}),
  };
});

import {
  syncBOMToKatanaAction,
  syncFinishedGoodToKatanaAction,
} from "@/app/admin/dictionary/actions";
import { PathAFenceError } from "@/server/path-a/katana-fence";

beforeEach(() => {
  hoisted.session = null;
  hoisted.sync.mockClear();
  hoisted.sync.mockResolvedValue({ ok: true, message: "synced" });
  hoisted.syncBom.mockClear();
  hoisted.syncBom.mockResolvedValue({ ok: true, message: "bom_synced" });
});

describe("syncFinishedGoodToKatanaAction (B2)", () => {
  it("requires a session: unauthenticated callers never reach the Katana writer", async () => {
    const res = await syncFinishedGoodToKatanaAction("JOB-A-SOFA");
    expect(res).toEqual({ ok: false, error: "not_authenticated" });
    expect(hoisted.sync).not.toHaveBeenCalled();
  });

  it("delegates to the (fenced) writer for an authenticated operator", async () => {
    hoisted.session = { email: "ops@ccpatio.com", name: "Ops" };
    const res = await syncFinishedGoodToKatanaAction("FIN-CHAIR-1");
    expect(res).toEqual({ ok: true, message: "synced" });
    expect(hoisted.sync).toHaveBeenCalledWith("FIN-CHAIR-1");
  });

  it("reports a fence refusal as { ok: false } instead of throwing", async () => {
    hoisted.session = { email: "ops@ccpatio.com", name: "Ops" };
    hoisted.sync.mockRejectedValueOnce(new PathAFenceError("blocked", "PATH_A_FENCE_BLOCKED"));
    const res = await syncFinishedGoodToKatanaAction("JOB-A-SOFA");
    expect(res).toEqual({ ok: false, error: "blocked" });
  });

  it("does not hide unrelated errors", async () => {
    hoisted.session = { email: "ops@ccpatio.com", name: "Ops" };
    hoisted.sync.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(syncFinishedGoodToKatanaAction("FIN-CHAIR-1")).rejects.toThrow("socket hang up");
  });
});

describe("syncBOMToKatanaAction (D4)", () => {
  it("requires a session: unauthenticated callers never reach the Katana writer", async () => {
    const res = await syncBOMToKatanaAction("JOB-A-SOFA");
    expect(res).toEqual({ ok: false, error: "not_authenticated" });
    expect(hoisted.syncBom).not.toHaveBeenCalled();
  });

  it("delegates to the (fenced) writer for an authenticated operator", async () => {
    hoisted.session = { email: "ops@ccpatio.com", name: "Ops" };
    const res = await syncBOMToKatanaAction("FIN-CHAIR-1");
    expect(res).toEqual({ ok: true, message: "bom_synced" });
    expect(hoisted.syncBom).toHaveBeenCalledWith("FIN-CHAIR-1");
  });

  it("reports a fence refusal as { ok: false } instead of throwing", async () => {
    hoisted.session = { email: "ops@ccpatio.com", name: "Ops" };
    hoisted.syncBom.mockRejectedValueOnce(new PathAFenceError("blocked", "PATH_A_FENCE_BLOCKED"));
    const res = await syncBOMToKatanaAction("JOB-A-SOFA");
    expect(res).toEqual({ ok: false, error: "blocked" });
  });

  it("does not hide unrelated errors", async () => {
    hoisted.session = { email: "ops@ccpatio.com", name: "Ops" };
    hoisted.syncBom.mockRejectedValueOnce(new Error("database unreachable"));
    await expect(syncBOMToKatanaAction("FIN-CHAIR-1")).rejects.toThrow("database unreachable");
  });
});
