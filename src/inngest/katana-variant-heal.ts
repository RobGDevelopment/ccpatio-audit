import { NonRetriableError } from "inngest";
import { revalidatePath } from "next/cache";
import { inngest } from "./client";
import { runKatanaStep } from "./katana-step";
import { logStructured } from "@/lib/log/structured";
import { logPimAudit } from "@/lib/pim-audit";
import {
  healKatanaVariantSku,
  loadKatanaVariantSku,
  type HealResult,
} from "@/server/katana/variant-webhook";
import { KATANA_VARIANT_HEAL_EVENT, positiveInt } from "@/server/katana/webhook-events";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";

/**
 * `variant.updated` without a SKU in the body. The webhook route makes zero Katana calls,
 * so the live variant is read here, inside the tenant-throttled step.
 */
export const healKatanaVariantSkuFn = inngest.createFunction(
  {
    id: "heal-katana-variant-sku",
    name: "Katana variant.updated -> heal local SKU",
    triggers: [{ event: KATANA_VARIANT_HEAL_EVENT }],
    concurrency: [{ limit: 1, key: "event.data.variantId" }, KATANA_TENANT_CONCURRENCY],
    retries: 3,
  },
  async ({ event, step }) => {
    const variantId = positiveInt(event.data.variantId);
    if (!variantId) {
      throw new NonRetriableError(`${KATANA_VARIANT_HEAL_EVENT} requires a positive variantId`);
    }

    const sku = await runKatanaStep<string | null>(step, "fetch-katana-variant", () =>
      loadKatanaVariantSku(variantId),
    );
    if (!sku) return { ok: true, variantId, healed: false, reason: "missing_sku" };

    const result = await step.run("heal-sku", async (): Promise<HealResult> => {
      const healed = await healKatanaVariantSku(variantId, sku);
      if (healed.conflict) {
        logStructured("error", "katana-variant-heal-sku-conflict", { variantId, sku });
        return healed;
      }
      if (healed.healed) {
        logStructured("info", "katana-variant-heal-sku-healed", { variantId, sku });
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
      return healed;
    });

    if (result.conflict) return { ok: true, variantId, healed: false, reason: "sku_conflict" };
    return { ok: true, variantId, healed: result.healed };
  },
);
