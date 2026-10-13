import { inngest } from "@/inngest/client";
import { fetchCloverOrder } from "@/server/integrations/clover/client";
import { pushToQBO } from "@/server/integrations/qbo/client";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getLedgerPipelineMode } from "@/server/pipeline/ledger-mode";

/**
 * Handler body, exported so the ledger containment gate can be unit tested
 * without an Inngest runtime.
 */
export async function runCloverPaymentSync({
  event,
  step,
}: {
  event: { data: unknown };
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
}) {
    const { merchantId, paymentId } = event.data as { merchantId: string, paymentId: string };

    // Step 1: Hydrate
    const cloverOrder = await step.run("fetch-clover-order", async () => {
      return await fetchCloverOrder(merchantId, paymentId);
    }) as Awaited<ReturnType<typeof fetchCloverOrder>>;

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
          // TODO(step-8): hardcoded placeholder CustomerRef; replaced by real customer resolution.
          value: "1" // Hardcoded placeholder for now
        }
      };
    });

    // LEDGER CONTAINMENT GATE (fail closed): only an explicit LEDGER_PIPELINE_MODE=live
    // may reach QuickBooks. Evaluated on every Inngest (re)invocation of this handler.
    const mode = getLedgerPipelineMode();
    if (mode !== "live") {
      console.log(
        JSON.stringify({
          tag: "ledger-containment",
          fn: "clover-payment-sync",
          mode,
          dryRun: true,
          paymentId,
          lineCount: translatedLineItems.length,
        }),
      );
      return { success: true as const, dryRun: true as const, mode, qboPayload };
    }

    // Step 4: Push
    // TODO(step-8): SalesReceipt endpoint is replaced by Journal Entry / Customer Deposit routing.
    const result = await step.run("push-to-qbo", async () => {
      return await pushToQBO(qboPayload);
    });

    return { success: true as const, dryRun: false as const, mode, qboResult: result };
}

export const syncCloverPayment = inngest.createFunction(
  {
    id: 'clover-payment-sync',
    triggers: [{ event: 'clover/payment.created' }]
  },
  async ({ event, step }) => runCloverPaymentSync({ event, step: step as never }),
);
