import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { katanaFetch } from "@/lib/katana";
import { getDb } from "@/server/db/client";
import { logistics_profiles, sku_mappings } from "@/server/db/schema";

const SKU_MAX = 128;

export type HealResult = {
  healed: boolean;
  logistics: boolean;
  dictionary: boolean;
  conflict: boolean;
};

export type VariantUpdateRead =
  | { kind: "ignore" }
  | { kind: "invalid"; message: string }
  | { kind: "update"; variantId: number; sku: string | null };

function signaturesMatch(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Katana signs the raw body with the webhook token. Header: `x-sha2-signature`. */
export function verifyKatanaWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
): boolean {
  const token = secret?.trim();
  if (!token || !header?.trim()) return false;
  const givenHex = header.trim().toLowerCase().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]+$/.test(givenHex) || givenHex.length % 2 !== 0) return false;
  const expected = createHmac("sha256", token).update(rawBody, "utf8").digest();
  const given = Buffer.from(givenHex, "hex");
  return signaturesMatch(given, expected);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInt(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(text(value));
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

export function normalizeKatanaSku(raw: string): string | null {
  const sku = raw.trim().toUpperCase();
  if (!sku || sku.length > SKU_MAX) return null;
  if (/[\u0000-\u001f]/.test(sku)) return null;
  return sku;
}

/**
 * Katana's documented event is `{ action, object: { id, href } }`.
 * A SKU on `object` or `data` is used when present. Otherwise the route
 * loads the live variant.
 */
export function readVariantUpdate(payload: unknown): VariantUpdateRead {
  const root = asRecord(payload);
  if (!root) return { kind: "invalid", message: "Body must be a JSON object" };
  const action = text(root.action) || text(root.event);
  if (action !== "variant.updated") return { kind: "ignore" };

  const object = asRecord(root.object);
  const data = asRecord(root.data);
  const variantId =
    positiveInt(object?.id) ??
    positiveInt(object?.variant_id) ??
    positiveInt(data?.id) ??
    positiveInt(data?.variant_id);
  if (!variantId) {
    return { kind: "invalid", message: "variant.updated is missing a variant id" };
  }

  const skuRaw = text(object?.sku) || text(data?.sku) || text(object?.variant_sku);
  if (!skuRaw) return { kind: "update", variantId, sku: null };
  const sku = normalizeKatanaSku(skuRaw);
  if (!sku) {
    return { kind: "invalid", message: "variant.updated SKU is empty or too long" };
  }
  return { kind: "update", variantId, sku };
}

function skuFromVariantPayload(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  return normalizeKatanaSku(text(data?.sku));
}

export async function loadKatanaVariantSku(variantId: number): Promise<string | null> {
  const { data } = await katanaFetch<unknown>(`/variants/${variantId}`);
  return skuFromVariantPayload(data);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      if ((current as { code?: string }).code === "23505") return true;
    }
    if (typeof current !== "object" || current === null || !("cause" in current)) break;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Rename the local SKU for one immutable Katana variant.
 * Packaged dimensions, weight, NMFC class, and lead time are not written.
 */
export async function healKatanaVariantSku(
  variantId: number,
  nextSku: string,
): Promise<HealResult> {
  const sku = normalizeKatanaSku(nextSku);
  if (!sku) {
    return { healed: false, logistics: false, dictionary: false, conflict: false };
  }

  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ sku: logistics_profiles.variant_sku })
        .from(logistics_profiles)
        .where(eq(logistics_profiles.katana_variant_id, variantId))
        .limit(1);
      const mappings = await tx
        .select({ sku: sku_mappings.global_sku })
        .from(sku_mappings)
        .where(eq(sku_mappings.katana_variant_id, variantId));

      let logistics = false;
      let dictionary = false;
      if (profile && profile.sku !== sku) {
        await tx
          .update(logistics_profiles)
          .set({ variant_sku: sku, updated_at: new Date() })
          .where(eq(logistics_profiles.katana_variant_id, variantId));
        logistics = true;
      }
      if (mappings.length === 1 && mappings[0]?.sku !== sku) {
        await tx
          .update(sku_mappings)
          .set({
            global_sku: sku,
            updated_by: "katana-variant-webhook",
            updated_at: new Date(),
          })
          .where(eq(sku_mappings.katana_variant_id, variantId));
        dictionary = true;
      }

      return {
        healed: logistics || dictionary,
        logistics,
        dictionary,
        conflict: false,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { healed: false, logistics: false, dictionary: false, conflict: true };
    }
    throw error;
  }
}
