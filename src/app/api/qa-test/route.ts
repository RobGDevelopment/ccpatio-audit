import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { sku_mappings as skuMappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Production hard-block for the local QA lifecycle endpoint.
 * Vercel production must never expose DB write/read helpers or process.exit.
 * Local `npm run qa:lifecycle` sets ALLOW_LOCAL_QA_TEST=true on its child server.
 */
export function isQaTestProductionBlocked(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "production" && env.ALLOW_LOCAL_QA_TEST !== "true";
}

function productionNotFound(): NextResponse {
  return new NextResponse("Not Found", { status: 404 });
}

/** Never call process.exit on Vercel or when the local QA override is off. */
export function mayExitProcessForQa(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.VERCEL === "1") return false;
  if (env.ALLOW_LOCAL_QA_TEST !== "true") return false;
  return true;
}

export async function POST(request: Request) {
  if (isQaTestProductionBlocked()) return productionNotFound();

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
  if (isQaTestProductionBlocked()) return productionNotFound();

  const url = new URL(request.url);
  const sku = url.searchParams.get("sku");
  const db = getDb();

  if (sku) {
    const row = await db.query.sku_mappings.findFirst({
      where: eq(skuMappings.global_sku, sku),
    });
    return NextResponse.json({ ok: true, data: row });
  }
  return NextResponse.json({ ok: false }, { status: 400 });
}

export async function PUT() {
  if (isQaTestProductionBlocked()) return productionNotFound();
  return NextResponse.json({ ok: false, error: "method not used" }, { status: 405 });
}

export async function PATCH() {
  if (isQaTestProductionBlocked()) return productionNotFound();
  return NextResponse.json({ ok: false, error: "method not used" }, { status: 405 });
}

export async function DELETE() {
  if (isQaTestProductionBlocked()) return productionNotFound();

  // Graceful shutdown for local QA gauntlet only — never on Vercel.
  if (mayExitProcessForQa()) {
    setTimeout(() => process.exit(0), 500);
    return NextResponse.json({ ok: true, message: "Shutting down server..." });
  }
  return NextResponse.json(
    { ok: false, error: "process exit disabled outside local QA" },
    { status: 403 },
  );
}
