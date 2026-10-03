import { createHmac, randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { logistics_profiles, sku_mappings } from "@/server/db/schema";
import {
  healKatanaVariantSku,
  readVariantUpdate,
  verifyKatanaWebhookSignature,
} from "@/server/katana/variant-webhook";

const variants: number[] = [];

afterEach(async () => {
  const db = getDb();
  for (const variantId of variants) {
    await db.delete(sku_mappings).where(eq(sku_mappings.katana_variant_id, variantId));
    await db.delete(logistics_profiles).where(eq(logistics_profiles.katana_variant_id, variantId));
  }
  variants.length = 0;
  await closeDb();
});

describe("Katana webhook signature", () => {
  it("accepts the hexadecimal HMAC of the raw body", () => {
    const body = JSON.stringify({ action: "variant.updated", object: { id: 7, sku: "FIN-A" } });
    const signature = createHmac("sha256", "token").update(body, "utf8").digest("hex");
    expect(verifyKatanaWebhookSignature(body, signature, "token")).toBe(true);
    expect(verifyKatanaWebhookSignature(`${body} `, signature, "token")).toBe(false);
    expect(verifyKatanaWebhookSignature(body, signature, "")).toBe(false);
    expect(verifyKatanaWebhookSignature(body, null, "token")).toBe(false);
  });

  it("reads a variant.updated id and sku and ignores sales orders", () => {
    expect(
      readVariantUpdate({
        action: "variant.updated",
        object: { id: 42, sku: "fin-new" },
      }),
    ).toEqual({ kind: "update", variantId: 42, sku: "FIN-NEW" });
    expect(readVariantUpdate({ action: "sales_order.updated", object: { id: 1 } })).toEqual({
      kind: "ignore",
    });
    expect(readVariantUpdate({ action: "variant.updated", object: {} }).kind).toBe("invalid");
  });
});

describe("Katana SKU auto-heal", () => {
  it("renames the profile and dictionary row and keeps measurements", async () => {
    const db = getDb();
    const variantId = randomInt(1_900_000_000, 2_000_000_000);
    variants.push(variantId);
    const oldSku = `QA-HEAL-${randomUUID().slice(0, 8).toUpperCase()}`;
    const newSku = `QA-HEAL-${randomUUID().slice(0, 8).toUpperCase()}`;
    await db.insert(logistics_profiles).values({
      katana_variant_id: variantId,
      variant_sku: oldSku,
      weight_lb: "18.2500",
      length_in: "40.0000",
      ltl_class: "150",
      lead_time_days: 6,
    });
    await db.insert(sku_mappings).values({
      global_sku: oldSku,
      category: "QA",
      item_type: "finished_good",
      original_name: "QA heal",
      katana_variant_id: variantId,
    });

    const result = await healKatanaVariantSku(variantId, newSku.toLowerCase());
    expect(result).toMatchObject({ healed: true, logistics: true, dictionary: true, conflict: false });

    const [profile] = await db
      .select()
      .from(logistics_profiles)
      .where(eq(logistics_profiles.katana_variant_id, variantId))
      .limit(1);
    expect(profile?.variant_sku).toBe(newSku);
    expect(profile?.weight_lb).toBe("18.2500");
    expect(profile?.length_in).toBe("40.0000");
    expect(profile?.ltl_class).toBe("150");
    expect(profile?.lead_time_days).toBe(6);

    const [mapping] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.katana_variant_id, variantId))
      .limit(1);
    expect(mapping?.sku).toBe(newSku);

    const again = await healKatanaVariantSku(variantId, newSku);
    expect(again.healed).toBe(false);
  });
});
