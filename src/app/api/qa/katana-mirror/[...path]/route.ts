import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CapturedKatanaRequest = {
  method: string;
  path: string;
  body: unknown;
  at: string;
};

const captures: CapturedKatanaRequest[] = [];

function variantRecord(sku: string, id: number, itemType: string | null) {
  const isMaterial = itemType === "raw_material";
  return {
    id,
    sku,
    type: isMaterial ? "material" : "product",
    product_id: isMaterial ? null : id,
    material_id: isMaterial ? id : null,
    purchase_price: null,
    sales_price: null,
  };
}

function fakeId(sku: string): number {
  let hash = 0;
  for (const char of sku) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 800000 + (hash % 100000);
}

function mirrorEnabled(): boolean {
  return (
    process.env.KATANA_E2E_MIRROR === "true" ||
    process.env.NODE_ENV !== "production"
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  if (!mirrorEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { path = [] } = await context.params;
  if (path[0] === "captures" && path.length === 1) {
    return NextResponse.json({ ok: true, captures });
  }

  // Return last captured recipe POST for a product_sku / variant lookup
  if (path.includes("recipes")) {
    const url = new URL(request.url);
    const sku = url.searchParams.get("sku")?.trim().toUpperCase();
    const matching = captures
      .filter((c) => c.method === "POST" && String(c.path).includes("recipes"))
      .reverse();
    if (!sku) {
      return NextResponse.json({
        ok: true,
        data: matching.map((c) => c.body),
      });
    }
    const bodies = matching
      .map((c) => c.body)
      .filter((body): body is Record<string, unknown> => !!body && typeof body === "object");
    const rows: unknown[] = [];
    for (const body of bodies) {
      const list = Array.isArray(body.rows) ? body.rows : [];
      for (const row of list) {
        const r = row as Record<string, unknown>;
        const parentSku = String(r._parent_sku ?? r.product_sku ?? "").toUpperCase();
        if (parentSku === sku || !parentSku) {
          rows.push(row);
        }
      }
      // Also match when sync posts variant ids only — include all rows from
      // captures that were tagged in our diagnostic via product_sku field.
      if (list.some((row) => {
        const r = row as Record<string, unknown>;
        return String(r.product_sku ?? "").toUpperCase() === sku;
      })) {
        return NextResponse.json({
          keep_current_rows: false,
          product_sku: sku,
          rows: list.filter((row) => {
            const r = row as Record<string, unknown>;
            const ps = String(r.product_sku ?? "").toUpperCase();
            return !ps || ps === sku;
          }),
          captured_at: matching[0]?.at ?? null,
        });
      }
    }
    return NextResponse.json({
      keep_current_rows: false,
      product_sku: sku,
      rows,
      captured_at: matching[0]?.at ?? null,
    });
  }

  const url = new URL(request.url);
  if (path.includes("variants")) {
    const sku = url.searchParams.get("sku")?.trim();
    if (!sku) return NextResponse.json({ data: [] });
    const db = getDb();
    const [row] = await db
      .select({
        sku: sku_mappings.global_sku,
        type: sku_mappings.item_type,
        variantId: sku_mappings.katana_variant_id,
      })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);
    const id = row?.variantId && row.variantId > 0 ? row.variantId : fakeId(sku);
    return NextResponse.json({
      data: [variantRecord(sku, id, row?.type ?? null)],
    });
  }

  return NextResponse.json({ data: [] });
}

async function captureMutation(
  method: string,
  request: Request,
  path: string[],
): Promise<NextResponse> {
  const joined = `/${path.join("/")}`;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  captures.push({
    method,
    path: joined,
    body,
    at: new Date().toISOString(),
  });

  if (path.includes("recipes") || joined.endsWith("recipes")) {
    return NextResponse.json({ ok: true, captured: true }, { status: 201 });
  }

  if (path.includes("products")) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const sku = String(record.sku ?? path[path.length - 1] ?? "UNKNOWN");
    const id = fakeId(sku);
    return NextResponse.json(
      {
        id,
        variants: [variantRecord(sku, id, "finished_good")],
      },
      { status: method === "POST" ? 201 : 200 },
    );
  }

  if (path.includes("materials")) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const sku = String(record.sku ?? path[path.length - 1] ?? "UNKNOWN");
    const id = fakeId(sku);
    return NextResponse.json(
      { id, variants: [variantRecord(sku, id, "raw_material")] },
      { status: method === "POST" ? 201 : 200 },
    );
  }

  if (path.includes("variants")) {
    const id = Number(path[path.length - 1]) || fakeId("variant");
    return NextResponse.json({ id, ok: true }, { status: 200 });
  }

  return NextResponse.json(
    { ok: true, captured: true },
    { status: method === "POST" ? 201 : 200 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  if (!mirrorEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { path = [] } = await context.params;
  return captureMutation("POST", request, path);
}

/** Katana upsert path PATCHes existing materials/products/variants. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  if (!mirrorEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { path = [] } = await context.params;
  return captureMutation("PATCH", request, path);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  if (!mirrorEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { path = [] } = await context.params;
  return captureMutation("PUT", request, path);
}

export async function DELETE() {
  if (!mirrorEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  captures.length = 0;
  return NextResponse.json({ ok: true });
}
