import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { sku_mappings as skuMappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const body = JSON.parse(raw);
    const uuid = body.uuid;

    if (!uuid) {
      return NextResponse.json({ error: "missing uuid" }, { status: 400 });
    }

    const fakeSku = `QA-TEST-${uuid.substring(0, 8).toUpperCase()}`;
    const db = getDb();
    
    const existing = await db.query.sku_mappings.findFirst({
      where: eq(skuMappings.global_sku, fakeSku),
    });

    if (!existing) {
      await db.insert(skuMappings).values({
        global_sku: fakeSku,
        original_name: `QA Test ${uuid}`,
        category: "Test",
        item_type: "finished_good",
        sync_to_woo: false,
      });
    }

    revalidatePath("/admin/dictionary");

    return NextResponse.json({ ok: true, uuid, sku: fakeSku });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sku = url.searchParams.get("sku");
  const db = getDb();
  
  if (sku) {
    const row = await db.query.sku_mappings.findFirst({
      where: eq(skuMappings.global_sku, sku)
    });
    return NextResponse.json({ ok: true, data: row });
  }
  return NextResponse.json({ ok: false }, { status: 400 });
}

export async function DELETE() {
  // Graceful shutdown for local QA gauntlet
  setTimeout(() => process.exit(0), 500);
  return NextResponse.json({ ok: true, message: "Shutting down server..." });
}
