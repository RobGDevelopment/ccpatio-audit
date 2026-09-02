import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { skuMappings } from "@/db/schema";
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
    
    // Test write: insert or update mapping
    const existing = await db.query.skuMappings.findFirst({
      where: eq(skuMappings.globalSku, fakeSku),
    });

    if (!existing) {
      await db.insert(skuMappings).values({
        globalSku: fakeSku,
        originalName: `QA Test ${uuid}`,
        category: "Test",
        itemType: "finished_good",
        syncToWoo: false,
      });
    }

    return NextResponse.json({ ok: true, uuid, sku: fakeSku });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
