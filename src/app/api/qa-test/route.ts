import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { sku_mappings as skuMappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";

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
    
    // Test write: insert or update mapping
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

    return NextResponse.json({ ok: true, uuid, sku: fakeSku });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
