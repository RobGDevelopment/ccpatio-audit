/**
 * POST /api/webhooks/katana
 *
 * Verifies Katana's `x-sha2-signature` (HMAC-SHA256 of the raw body, key
 * `KATANA_WEBHOOK_SECRET`). `variant.updated` renames the local SKU for that
 * immutable variant id on `logistics_profiles` and, when one dictionary row
 * matches, `sku_mappings`. `stock_adjustment.deleted` and `sales_order.deleted`
 * release a matching HOLD- ledger row. Other events are acknowledged
 * and not written.
 *
 * Status contract with Katana: 400 for a body that can never succeed, 401 for a bad
 * signature, 502 when Katana itself could not answer our lookup, 500 for any other
 * fault. Katana retries 5xx. Response bodies carry a `ref`, never provider or driver text.
 */
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logError, logStructured } from "@/lib/log/structured";
import { logPimAudit } from "@/lib/pim-audit";
import {
  healKatanaVariantSku,
  loadKatanaVariantSku,
  readHoldDeletion,
  readVariantUpdate,
  verifyKatanaWebhookSignature,
} from "@/server/katana/variant-webhook";
import { releaseDeletedHoldDocument } from "@/server/stock/release-hold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const secret = process.env.KATANA_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const signature = req.headers.get("x-sha2-signature");
  if (!verifyKatanaWebhookSignature(rawBody, signature, secret)) {
    logStructured("warn", "katana-webhook-invalid-signature", { status: 401 });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    const ref = logError("katana-webhook-invalid-json", error, { status: 400 });
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be valid JSON", ref },
      { status: 400 },
    );
  }

  const deletion = readHoldDeletion(payload);
  if (deletion.kind === "invalid") {
    return NextResponse.json(
      { error: "invalid_event", message: deletion.message },
      { status: 400 },
    );
  }
  if (deletion.kind === "deleted") {
    const outcome = await releaseDeletedHoldDocument({
      documentKind: deletion.documentKind,
      number: deletion.number,
      documentId: deletion.documentId,
    });
    if (outcome === "failed") {
      logStructured("error", "katana-webhook-hold-release-failed", {
        documentKind: deletion.documentKind,
        status: 500,
      });
      return NextResponse.json(
        { error: "release_failed", message: "Could not release the showroom hold." },
        { status: 500 },
      );
    }
    if (outcome === "released") {
      revalidatePath("/showroom");
      revalidatePath("/embed/showroom");
    }
    return NextResponse.json({ ok: true, released: outcome === "released" });
  }

  const update = readVariantUpdate(payload);
  if (update.kind === "ignore") {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (update.kind === "invalid") {
    return NextResponse.json({ error: "invalid_event", message: update.message }, { status: 400 });
  }

  let sku = update.sku;
  if (!sku) {
    try {
      sku = await loadKatanaVariantSku(update.variantId);
    } catch (error) {
      const ref = logError("katana-webhook-variant-lookup-failed", error, {
        variantId: update.variantId,
        status: 502,
      });
      return NextResponse.json(
        { error: "variant_lookup_failed", message: "Katana variant lookup failed.", ref },
        { status: 502 },
      );
    }
  }
  if (!sku) {
    return NextResponse.json({ ok: true, healed: false, reason: "missing_sku" });
  }

  const result = await healKatanaVariantSku(update.variantId, sku);
  if (result.conflict) {
    logStructured("error", "katana-webhook-sku-conflict", {
      variantId: update.variantId,
      sku,
    });
    return NextResponse.json({ ok: true, healed: false, reason: "sku_conflict" });
  }
  if (result.healed) {
    logStructured("info", "katana-webhook-sku-healed", { variantId: update.variantId, sku });
    await logPimAudit({
      operatorEmail: "katana-webhook@ccpatio.com",
      operatorName: "Katana webhook",
      globalSku: sku,
      action: "auto_heal_sku",
      field: "sku",
      newValue: sku,
    });
    revalidatePath("/admin/logistics");
    revalidatePath("/admin/dictionary");
  }

  return NextResponse.json({ ok: true, healed: result.healed });
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    const ref = logError("katana-webhook-failed", error, { status: 500 });
    return NextResponse.json({ error: "internal_error", ref }, { status: 500 });
  }
}
