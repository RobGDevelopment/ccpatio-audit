import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KatanaApiError,
  bindMtoPlaceholderStrict,
  listKatanaManufacturingOrderNodesForSalesOrder,
  mapWooOrderToKatanaSalesOrder,
  pickRootMoNodeForRow,
} from "@/lib/katana";
import { matchSalesOrderRowsToLines, type KatanaSoRow } from "@/server/woocommerce/katana-deps";
import { resolveWooOrder } from "@/server/woocommerce/sku-resolver";
import { BASE_SKU, FAB_SKU, PWD_SKU, VARIANT, makeHub, wooLine, wooOrder } from "./helpers/woo-fakes";

/** A tiny in-memory Katana: manufacturing orders, recipe rows, and the three endpoints used. */
type Mo = { id: number; order_no: string; sales_order_id: number; sales_order_row_id: number };
type Recipe = { id: number; manufacturing_order_id: number; variant_id: number; related_manufacturing_order_id?: number };

const sim = {
  mos: [] as Mo[],
  recipes: [] as Recipe[],
  patches: [] as Array<{ id: number; variant_id: number }>,
  failPatch: false,
  failRecipeList: false,
  requests: [] as string[],
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: unknown, init?: { method?: string; body?: string }): Promise<Response> {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^\/v1/, "");
  const method = init?.method ?? "GET";
  sim.requests.push(`${method} ${path}${url.search}`);
  const q = url.searchParams;

  let m = path.match(/^\/manufacturing_orders\/(\d+)$/);
  if (m && method === "GET") {
    const mo = sim.mos.find((x) => x.id === Number(m![1]));
    return mo ? respond(mo) : respond({ error: "not found" }, 404);
  }
  if (path === "/manufacturing_orders" && method === "GET") {
    const all = sim.mos.filter((x) => x.sales_order_id === Number(q.get("sales_order_id")));
    const limit = Number(q.get("limit") ?? 50);
    const page = Number(q.get("page") ?? 1);
    return respond({ data: all.slice((page - 1) * limit, page * limit) });
  }
  if (path === "/manufacturing_order_recipe_rows" && method === "GET") {
    if (sim.failRecipeList) return respond({ error: "boom" }, 500);
    const rows = sim.recipes.filter((r) => r.manufacturing_order_id === Number(q.get("manufacturing_order_id")));
    return respond({ data: rows });
  }
  m = path.match(/^\/manufacturing_order_recipe_rows\/(\d+)$/);
  if (m && method === "PATCH") {
    if (sim.failPatch) return respond({ error: "boom" }, 500);
    const row = sim.recipes.find((r) => r.id === Number(m![1]))!;
    const body = JSON.parse(init!.body!) as { variant_id: number };
    row.variant_id = body.variant_id;
    sim.patches.push({ id: row.id, variant_id: body.variant_id });
    return respond(row);
  }
  return respond({ error: `unhandled ${method} ${path}` }, 404);
}

const GEN_FAB = VARIANT.genericFab;
const GEN_PWD = VARIANT.genericPwd;

/** Parent MO 10 (row 5) with CUSH child 11 (fabric generic) and FRAME child 12 (powder generic). */
function seedTree(opts: { linkChildren: boolean }) {
  sim.mos = [
    { id: 10, order_no: "WOO-1042-MO", sales_order_id: 77, sales_order_row_id: 5 },
    { id: 11, order_no: "WOO-1042-MO / 1", sales_order_id: 77, sales_order_row_id: 5 },
    { id: 12, order_no: "WOO-1042-MO / 2", sales_order_id: 77, sales_order_row_id: 5 },
  ];
  sim.recipes = [
    { id: 1, manufacturing_order_id: 10, variant_id: 777, ...(opts.linkChildren ? { related_manufacturing_order_id: 11 } : {}) },
    { id: 2, manufacturing_order_id: 10, variant_id: 778, ...(opts.linkChildren ? { related_manufacturing_order_id: 12 } : {}) },
    { id: 3, manufacturing_order_id: 11, variant_id: GEN_FAB },
    { id: 4, manufacturing_order_id: 11, variant_id: 555 },
    { id: 5, manufacturing_order_id: 12, variant_id: GEN_PWD },
  ];
}

beforeEach(() => {
  sim.patches = [];
  sim.requests = [];
  sim.failPatch = false;
  sim.failRecipeList = false;
  vi.stubEnv("KATANA_PERSONAL_ACCESS_TOKEN", "test-token");
  // Pin the host so an ambient E2E-mirror / KATANA_API_BASE in the shell cannot change the path.
  vi.stubEnv("KATANA_API_BASE", "http://katana.test/v1");
  vi.stubEnv("KATANA_E2E_MIRROR", "false");
  vi.stubGlobal("fetch", fakeFetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("bindMtoPlaceholderStrict", () => {
  it("swaps the generic placeholder on the nested child MO linked from the parent's recipe row", async () => {
    seedTree({ linkChildren: true });
    const result = await bindMtoPlaceholderStrict(10, {
      genericVariantId: GEN_FAB,
      specificVariantId: VARIANT.fab,
      label: `fabric ${FAB_SKU}`,
    });
    expect(result.alreadyBound).toBe(false);
    expect(result.patched).toEqual([
      { recipeRowId: 3, manufacturingOrderId: 11, fromVariantId: GEN_FAB, toVariantId: VARIANT.fab },
    ]);
    expect(sim.patches).toEqual([{ id: 3, variant_id: VARIANT.fab }]);
    // The other generic (powder) is untouched by the fabric bind.
    expect(sim.recipes.find((r) => r.id === 5)!.variant_id).toBe(GEN_PWD);
  });

  it("finds children by order_no when Katana does not link them on recipe rows", async () => {
    seedTree({ linkChildren: false });
    const result = await bindMtoPlaceholderStrict(10, {
      genericVariantId: GEN_PWD,
      specificVariantId: VARIANT.pwd,
      label: `powder_coat ${PWD_SKU}`,
    });
    expect(result.patched.map((p) => p.recipeRowId)).toEqual([5]);
    expect(sim.requests.some((r) => r.startsWith("GET /manufacturing_orders?sales_order_id=77"))).toBe(true);
  });

  it("is idempotent: a second bind finds the specific variant, patches nothing and succeeds", async () => {
    seedTree({ linkChildren: true });
    const args = { genericVariantId: GEN_FAB, specificVariantId: VARIANT.fab, label: "fabric" };
    await bindMtoPlaceholderStrict(10, args);
    sim.patches = [];
    const again = await bindMtoPlaceholderStrict(10, args);
    expect(again.alreadyBound).toBe(true);
    expect(again.patched).toEqual([]);
    expect(sim.patches).toEqual([]);
  });

  it("binds fabric then powder independently on one tree", async () => {
    seedTree({ linkChildren: true });
    await bindMtoPlaceholderStrict(10, { genericVariantId: GEN_FAB, specificVariantId: VARIANT.fab, label: "fabric" });
    await bindMtoPlaceholderStrict(10, { genericVariantId: GEN_PWD, specificVariantId: VARIANT.pwd, label: "powder" });
    expect(sim.recipes.filter((r) => [3, 5].includes(r.id)).map((r) => r.variant_id)).toEqual([VARIANT.fab, VARIANT.pwd]);
  });

  it("THROWS (never swallows) when a PATCH fails", async () => {
    seedTree({ linkChildren: true });
    sim.failPatch = true;
    await expect(
      bindMtoPlaceholderStrict(10, { genericVariantId: GEN_FAB, specificVariantId: VARIANT.fab, label: "fabric" }),
    ).rejects.toBeInstanceOf(KatanaApiError);
  });

  it("THROWS when the recipe rows cannot be listed", async () => {
    seedTree({ linkChildren: true });
    sim.failRecipeList = true;
    await expect(
      bindMtoPlaceholderStrict(10, { genericVariantId: GEN_FAB, specificVariantId: VARIANT.fab, label: "fabric" }),
    ).rejects.toBeInstanceOf(KatanaApiError);
  });

  it("THROWS a 422 when the tree has neither the placeholder nor the specific variant", async () => {
    seedTree({ linkChildren: true });
    const error = await bindMtoPlaceholderStrict(10, {
      genericVariantId: 4242,
      specificVariantId: VARIANT.fab,
      label: "fabric FAB-X",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(KatanaApiError);
    expect((error as KatanaApiError).status).toBe(422);
    expect((error as Error).message).toContain("neither placeholder variant 4242");
  });

  it("THROWS when the parent MO cannot be loaded", async () => {
    seedTree({ linkChildren: true });
    await expect(
      bindMtoPlaceholderStrict(999, { genericVariantId: GEN_FAB, specificVariantId: VARIANT.fab, label: "fabric" }),
    ).rejects.toBeInstanceOf(KatanaApiError);
  });

  it.each([
    [0, 1, 2],
    [10, 0, 2],
    [10, 1, 0],
    [10, 5, 5],
  ])("rejects invalid ids parent=%i generic=%i specific=%i before any request", async (parent, generic, specific) => {
    await expect(
      bindMtoPlaceholderStrict(parent, { genericVariantId: generic, specificVariantId: specific, label: "x" }),
    ).rejects.toBeInstanceOf(KatanaApiError);
    expect(sim.requests).toEqual([]);
  });
});

describe("MO listing and root selection", () => {
  it("pages the sales-order MO listing until exhausted", async () => {
    sim.mos = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1,
      order_no: `WOO-1 / ${i}`,
      sales_order_id: 77,
      sales_order_row_id: 5,
    }));
    const nodes = await listKatanaManufacturingOrderNodesForSalesOrder(77);
    expect(nodes).toHaveLength(120);
    expect(sim.requests.filter((r) => r.includes("page=")).length).toBe(3);
  });

  it("pickRootMoNodeForRow prefers the parent over create_subassemblies children that share the row id", () => {
    const nodes = [
      { id: 12, order_no: "MO-9 / 2", sales_order_id: 77, sales_order_row_id: 5 },
      { id: 10, order_no: "MO-9", sales_order_id: 77, sales_order_row_id: 5 },
      { id: 11, order_no: "MO-9 / 1", sales_order_id: 77, sales_order_row_id: 5 },
      { id: 30, order_no: "MO-10", sales_order_id: 77, sales_order_row_id: 6 },
    ];
    expect(pickRootMoNodeForRow(nodes, 5)).toBe(10);
    expect(pickRootMoNodeForRow(nodes, 6)).toBe(30);
    expect(pickRootMoNodeForRow(nodes, 7)).toBeNull();
  });

  it("pickRootMoNodeForRow falls back to the lowest id when order numbers do not disambiguate", () => {
    const nodes = [
      { id: 22, order_no: null, sales_order_id: 1, sales_order_row_id: 5 },
      { id: 21, order_no: null, sales_order_id: 1, sales_order_row_id: 5 },
    ];
    expect(pickRootMoNodeForRow(nodes, 5)).toBe(21);
  });
});

describe("matchSalesOrderRowsToLines", () => {
  async function lines(count = 2) {
    const order = wooOrder({
      line_items: Array.from({ length: count }, (_, i) => wooLine({ id: 100 + i })),
    });
    const res = await resolveWooOrder(order, makeHub(), { requireKatanaIds: true });
    if (!res.ok) throw new Error("fixture invalid");
    return res.lines;
  }

  it("pairs exactly by woo_line_key regardless of row order", async () => {
    const l = await lines();
    const rows: KatanaSoRow[] = [
      { id: 902, sku: BASE_SKU, lineKey: "101" },
      { id: 901, sku: BASE_SKU, lineKey: "100" },
    ];
    expect(matchSalesOrderRowsToLines(rows, l).map((p) => p.rowId)).toEqual([901, 902]);
  });

  it("falls back to position when no row has a key, but only if every SKU matches", async () => {
    const l = await lines();
    const ok: KatanaSoRow[] = [
      { id: 1, sku: BASE_SKU, lineKey: null },
      { id: 2, sku: BASE_SKU, lineKey: null },
    ];
    expect(matchSalesOrderRowsToLines(ok, l).map((p) => p.rowId)).toEqual([1, 2]);
    const wrong: KatanaSoRow[] = [
      { id: 1, sku: BASE_SKU, lineKey: null },
      { id: 2, sku: "FIN-OTHER", lineKey: null },
    ];
    expect(() => matchSalesOrderRowsToLines(wrong, l)).toThrow(/does not match Woo line 2/);
  });

  it("throws on a row-count mismatch, a duplicate key and a missing key", async () => {
    const l = await lines();
    expect(() => matchSalesOrderRowsToLines([{ id: 1, sku: BASE_SKU, lineKey: "100" }], l)).toThrow(/1 rows for 2/);
    expect(() =>
      matchSalesOrderRowsToLines(
        [
          { id: 1, sku: BASE_SKU, lineKey: "100" },
          { id: 2, sku: BASE_SKU, lineKey: "100" },
        ],
        l,
      ),
    ).toThrow(/two rows/);
    expect(() =>
      matchSalesOrderRowsToLines(
        [
          { id: 1, sku: BASE_SKU, lineKey: "100" },
          { id: 2, sku: BASE_SKU, lineKey: "999" },
        ],
        l,
      ),
    ).toThrow(/No Katana sales order row carries/);
  });
});

describe("mapWooOrderToKatanaSalesOrder (Phase B1 payload)", () => {
  async function payload(overrides: Record<string, unknown> = {}) {
    const order = wooOrder(overrides);
    const res = await resolveWooOrder(order, makeHub(), { requireKatanaIds: true });
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    return mapWooOrderToKatanaSalesOrder(order, res.lines);
  }

  it("order_no is strictly WOO-<id>, ignoring the Woo display number", async () => {
    expect((await payload({ number: "A-7" })).orderNo).toBe("WOO-1042");
    expect((await payload({ number: "" })).orderNo).toBe("WOO-1042");
  });

  it("every row is priced at 0 (the ledger is QBO's)", async () => {
    const p = await payload({ line_items: [wooLine({ id: 1, price: 450 }), wooLine({ id: 2, total: "900.00", quantity: 2 })] });
    expect(p.salesOrderRows.map((r) => r.pricePerUnit)).toEqual([0, 0]);
  });

  it("sends customer name + email and ONLY the shipping address; no phone, no billing address, no order_key", async () => {
    const p = await payload();
    expect(p.customer).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(p.customer.phone).toBeUndefined();
    expect(p.customer.company).toBeUndefined();
    expect(p.addresses).toHaveLength(1);
    expect(p.addresses![0]).toMatchObject({ entityType: "shipping", line1: "1 Main St", city: "Austin", zip: "78701" });
    expect(p.addresses![0]!.phone).toBeNull();
    expect(p.customerRef).toBe("woo:1042");
    expect(JSON.stringify(p)).not.toContain("wc_order_secret_key");
    expect(JSON.stringify(p)).not.toContain("555-0100");
  });

  it("falls back to the billing block (typed shipping) when Woo sent no shipping content", async () => {
    const p = await payload({
      shipping: {},
      billing: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", address_1: "5 Oak", city: "Dallas", country: "US" },
    });
    expect(p.addresses).toHaveLength(1);
    expect(p.addresses![0]).toMatchObject({ entityType: "shipping", line1: "5 Oak" });
  });

  it("rows carry woo_line_key and the finishes; additional_info keeps the provenance marker", async () => {
    const p = await payload();
    expect(p.salesOrderRows[0]).toMatchObject({ sku: BASE_SKU, quantity: 2 });
    expect(p.salesOrderRows[0]!.attributes).toEqual([
      { key: "woo_line_key", value: "1" },
      { key: "finish_fabric", value: FAB_SKU },
      { key: "finish_powder_coat", value: PWD_SKU },
      { key: "finish_frame", value: "MET-ALUM" },
    ]);
    expect(p.additionalInfo).toContain("source=woocommerce | woo_order=1042");
    expect(p.additionalInfo).toContain("frame=MET-ALUM [attribute only]");
    expect(p.ecommerceOrderId).toBe("1042");
  });
});
