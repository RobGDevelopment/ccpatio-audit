import { inngest } from "@/inngest/client";
import { fetchCloverOrder } from "@/server/integrations/clover/client";
import { pushToQBO } from "@/server/integrations/qbo/client";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const syncCloverPayment = inngest.createFunction(
  { 
    id: 'clover-payment-sync',
    triggers: [{ event: 'clover/payment.created' }]
  },
  async ({ event, step }) => {
    const { merchantId, paymentId } = event.data as { merchantId: string, paymentId: string };

    // Step 1: Hydrate
    const cloverOrder = await step.run("fetch-clover-order", async () => {
      return await fetchCloverOrder(merchantId, paymentId);
    });

    // Step 2: Translate
    const translatedLineItems = await step.run("translate-line-items", async () => {
      const lineItems = cloverOrder.lineItems?.elements || [];
      const translated: Array<{ qboItemId: string, name: string, price: number, qty: number }> = [];
      const db = getDb();

      for (const item of lineItems) {
        // Query Drizzle's sku_mappings table
        const [mapping] = await db
          .select({ qbo_item_id: sku_mappings.qbo_item_id })
          .from(sku_mappings)
          .where(eq(sku_mappings.clover_item_id, item.id))
          .limit(1);

        if (!mapping || !mapping.qbo_item_id) {
          throw new Error(`Translation Failed: Clover Item ${item.id} is not mapped to a QBO Item. Halted for DLQ.`);
        }

        translated.push({
          qboItemId: mapping.qbo_item_id,
          name: item.name,
          price: item.price,
          qty: item.unitQty || 1,
        });
      }
      return translated;
    });

    // Step 3: Format
    const qboPayload = await step.run("format-qbo-payload", async () => {
      return {
        Line: translatedLineItems.map(item => ({
          DetailType: "SalesItemLineDetail",
          Amount: item.price / 100, // Convert cents to standard decimals
          SalesItemLineDetail: {
            ItemRef: {
              value: item.qboItemId
            },
            Qty: item.qty,
            UnitPrice: item.price / 100
          }
        })),
        CustomerRef: {
          value: "1" // Hardcoded placeholder for now
        }
      };
    });

    // Step 4: Push
    const result = await step.run("push-to-qbo", async () => {
      return await pushToQBO(qboPayload);
    });

    return { success: true, qboResult: result };
  }
);
