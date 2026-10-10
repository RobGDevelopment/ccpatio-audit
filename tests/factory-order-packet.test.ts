import { expect, test, vi, beforeEach } from "vitest";
import { parseFactoryOrderLine } from "../src/server/factory-bom/parse-factory-order-packet";
import { matchFactoryOrderLine } from "../src/server/factory-bom/match-factory-order-line";

// Mock DB client
vi.mock("../src/server/db/client", () => {
  return {
    getDb: () => ({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { globalSku: "TEST-SKU", originalName: "OCEAN SINGLE CHAISE LOUNGE", length: "36", depth: "79" }
      ]),
      query: {
        product_bom: {
          findFirst: vi.fn().mockResolvedValue({ id: 1 })
        },
        channel_sync: {
          findFirst: vi.fn().mockResolvedValue({ status: "success", channel: "katana" })
        },
        pim_audit_log: {
          findFirst: vi.fn().mockResolvedValue({ id: 1 })
        },
        product_bom_draft: {
          findMany: vi.fn().mockResolvedValue([])
        },
        cad_uploads: {
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    })
  };
});

test("Parses basic dimensions", () => {
  const line = parseFactoryOrderLine("OCEAN SINGLE CHAISE LOUNGE 36 X 79");
  expect(line.family).toBe("OCEAN SINGLE CHAISE LOUNGE");
  expect(line.widthInches).toBe("36");
  expect(line.depthInches).toBe("79");
});

test("Parses with A- instead of X", () => {
  const line = parseFactoryOrderLine("OCEAN SINGLE CHAISE LOUNGE 36 A- 79");
  expect(line.family).toBe("OCEAN SINGLE CHAISE LOUNGE");
  expect(line.widthInches).toBe("36");
  expect(line.depthInches).toBe("79");
});

test("Parses configuration parenthesis", () => {
  const line = parseFactoryOrderLine("BROOKLYN OVERSIZED CHAISE 84 A- 42 (CORNER ON RIGHT SIDE)");
  expect(line.family).toBe("BROOKLYN OVERSIZED CHAISE");
  expect(line.widthInches).toBe("84");
  expect(line.depthInches).toBe("42");
  expect(line.configuration).toBe("CORNER ON RIGHT SIDE");
});

test("Exact match resolves to published SKU", async () => {
  const match = await matchFactoryOrderLine("OCEAN SINGLE CHAISE LOUNGE 36 A- 79");
  expect(match.isCustom).toBe(false);
  expect(match.snapToGlobalSku).toBe("TEST-SKU");
});

test("Parenthesis makes it custom", async () => {
  const match = await matchFactoryOrderLine("BROOKLYN OVERSIZED CHAISE 84 A- 42 (CORNER ON RIGHT SIDE)");
  expect(match.isCustom).toBe(true);
  expect(match.snapToGlobalSku).toBeNull();
});

test("Parses exact fixture with × symbol", () => {
  const line = parseFactoryOrderLine("OCEAN SINGLE CHAISE LOUNGE 36 × 79");
  expect(line.family).toBe("OCEAN SINGLE CHAISE LOUNGE");
  expect(line.widthInches).toBe("36");
  expect(line.depthInches).toBe("79");
});

test("Parses quantity and inch marks", () => {
  const line = parseFactoryOrderLine('2 OCEAN SINGLE CHAISE LOUNGE 36" × 79"');
  expect(line.family).toBe("OCEAN SINGLE CHAISE LOUNGE");
  expect(line.widthInches).toBe("36");
  expect(line.depthInches).toBe("79");
  expect(line.quantity).toBe(2);
});
