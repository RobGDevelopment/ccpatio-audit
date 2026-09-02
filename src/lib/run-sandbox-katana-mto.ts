/**
 * Isolated sandbox runner for Phase 4 MTO + fabric override.
 * Do not import from src/inngest or webhook routes.
 */
import { eq } from "drizzle-orm";
import { KATANA_GENERIC_FABRIC_VARIANT_ID } from "@/lib/katana-bulk-materials";
import {
  applyMtoIngredientOverrides,
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  findVariantBySku,
  KatanaApiError,
  type KatanaSalesOrderPayload,
  type MtoIngredientOverrideResult,
} from "@/lib/katana";
import {
  SANDBOX_MTO_DEFAULT_FG_SKU,
  SANDBOX_MTO_SPECIFIC_FABRIC_SKU,
  SANDBOX_MTO_SPECIFIC_FABRIC_VARIANT_ID,
} from "@/lib/katana-mto-sandbox";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";

export type SandboxMtoTestInput = {
  sku?: string;
  quantity?: number;
  orderNo?: string;
};

export async function resolveSandboxFabricVariantId(): Promise<{
  variantId: number | null;
  sku: string;
  source: "hardcoded" | "sku_mappings" | "katana_variants" | "missing";
}> {
  if (SANDBOX_MTO_SPECIFIC_FABRIC_VARIANT_ID > 0) {
    return {
      variantId: SANDBOX_MTO_SPECIFIC_FABRIC_VARIANT_ID,
      sku: SANDBOX_MTO_SPECIFIC_FABRIC_SKU,
      source: "hardcoded",
    };
  }

  const needle = SANDBOX_MTO_SPECIFIC_FABRIC_SKU.trim().toUpperCase();
  const db = getDb();
  const [mapping] = await db
    .select({ variantId: sku_mappings.katana_variant_id })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, needle))
    .limit(1);

  if (mapping?.variantId != null && mapping.variantId > 0) {
    return {
      variantId: mapping.variantId,
      sku: needle,
      source: "sku_mappings",
    };
  }

  const variant = await findVariantBySku(needle);
  if (variant) {
    return {
      variantId: variant.id,
      sku: needle,
      source: "katana_variants",
    };
  }

  return { variantId: null, sku: needle, source: "missing" };
}

export async function runSandboxedKatanaMtoTest(input: SandboxMtoTestInput = {}) {
  const sku = (input.sku ?? SANDBOX_MTO_DEFAULT_FG_SKU).trim().toUpperCase();
  const quantity = Number(input.quantity ?? 1);
  if (!sku) {
    throw new KatanaApiError("Sandbox MTO requires a finished-good SKU.", {
      status: 422,
    });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new KatanaApiError(`Invalid sandbox quantity: ${input.quantity}`, {
      status: 422,
    });
  }

  const stamp = Date.now();
  const orderNo = (input.orderNo ?? `SANDBOX-MTO-${stamp}`).trim();
  const payload: KatanaSalesOrderPayload = {
    orderNo,
    customer: {
      name: "Sandbox MTO Tester",
      email: "sandbox-mto@ccpatio.com",
      firstName: "Sandbox",
      lastName: "MTO",
      company: "CC Patio Sandbox",
      phone: null,
      currency: "USD",
      referenceId: "sandbox-mto-customer",
    },
    salesOrderRows: [{ sku, quantity, pricePerUnit: 0 }],
    currency: "USD",
    additionalInfo:
      "SANDBOX MTO test — not a live WooCommerce or GHL order. Safe to void.",
    customerRef: `sandbox-mto-${stamp}`,
    ecommerceOrderType: "sandbox",
    ecommerceStoreName: "ccpatio-sandbox",
    ecommerceOrderId: `sandbox-mto-${stamp}`,
  };

  const salesOrder = await createKatanaSalesOrder(payload);
  const mtoOrders = await createMakeToOrderManufacturingOrders(
    salesOrder.salesOrderRowIds,
    { createSubassemblies: true },
  );

  const fabric = await resolveSandboxFabricVariantId();
  const overrides: MtoIngredientOverrideResult[] = [];
  for (const mo of mtoOrders) {
    if (fabric.variantId == null) {
      overrides.push({
        parentMoId: mo.manufacturingOrderId,
        genericVariantId: KATANA_GENERIC_FABRIC_VARIANT_ID,
        specificVariantId: 0,
        patched: [],
        skipped: true,
        warning:
          `Sandbox fabric ${fabric.sku} has no Katana variant id yet; ` +
          "SO/MTO created, override skipped",
        inspectedMoIds: [],
      });
      continue;
    }
    overrides.push(
      await applyMtoIngredientOverrides(mo.manufacturingOrderId, {
        genericVariantId: KATANA_GENERIC_FABRIC_VARIANT_ID,
        specificVariantId: fabric.variantId,
      }),
    );
  }

  return {
    isolated: true,
    liveIngressTouched: false,
    createSubassemblies: true,
    fabric: {
      sku: fabric.sku,
      variantId: fabric.variantId,
      source: fabric.source,
      genericVariantId: KATANA_GENERIC_FABRIC_VARIANT_ID,
    },
    salesOrder,
    mtoOrders,
    overrides,
  };
}
