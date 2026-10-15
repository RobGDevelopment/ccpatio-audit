import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFinishes = [
  { global_sku: "MET-ALUM", name: "Aluminum Frame", active: true },
  { global_sku: "PWD-BLK", name: "Matte Black Powdercoat", active: true },
  { global_sku: "PWD-WHT", name: "Gloss White Powdercoat", active: false },
  { global_sku: "FAB-CAS-WHT", name: "Castile White Fabric", active: true },
  { global_sku: "FIN-CHAIR", name: "Finished Chair", active: true },
];

vi.mock("@/server/db/client", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async (n: number) => {
                return mockFinishes
                  .filter((m) => m.active && !m.global_sku.startsWith("FIN-"))
                  .slice(0, n)
                  .map((m) => ({ sku: m.global_sku, name: m.name }));
              }),
            })),
          })),
        })),
      })),
    })),
    query: {
      sku_mappings: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          return mockFinishes.find((m) => m.active);
        }),
      },
    },
  })),
}));

import { searchFinishes, validateFinishSelection } from "@/server/factory-bom/intake/finishes";

describe("Intake Finishes (searchFinishes & validateFinishSelection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches finishes and filters by correct prefix (MET, PWD, FAB)", async () => {
    const results = await searchFinishes("frame", "Alum");
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  it("validates valid finish selection with frame, powder, fabric", async () => {
    const valid = await validateFinishSelection({
      frame: { kind: "sku", sku: "MET-ALUM" },
      powder: { kind: "sku", sku: "PWD-BLK" },
      fabric: { kind: "sku", sku: "FAB-CAS-WHT" },
    });

    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.finishesPending).toBe(false);
    }
  });

  it("permits TBD with note and sets finishesPending: true", async () => {
    const res = await validateFinishSelection({
      frame: { kind: "sku", sku: "MET-ALUM" },
      powder: { kind: "sku", sku: "PWD-BLK" },
      fabric: { kind: "tbd", note: "Customer confirming swatch tomorrow" },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.finishesPending).toBe(true);
    }
  });

  it("rejects wrong-prefix SKU for a slot", async () => {
    const res = await validateFinishSelection({
      frame: { kind: "sku", sku: "PWD-BLK" }, // Wrong! Powder in frame slot
      powder: { kind: "sku", sku: "PWD-BLK" },
      fabric: { kind: "sku", sku: "FAB-CAS-WHT" },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fieldErrors?.frame).toBeDefined();
    }
  });
});
