import { inngest } from "./client";
import { runKatanaStep } from "./katana-step";
import { katanaFetch } from "@/lib/katana";
import { getLedgerPipelineMode } from "@/server/pipeline/ledger-mode";
import {
  createQboVendorBillFromKatanaPo,
  type CreateQboVendorBillInput,
} from "@/server/integrations/qbo/client";
import { IDEMPOTENCY_BY_EVENT_ID } from "@/server/sre/idempotency";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";

export const KATANA_PO_RECEIVED_EVENT = "katana/purchase_order.received";

export const syncKatanaPoReceived = inngest.createFunction(
  {
    id: "sync-katana-po-received",
    name: "Katana PO Received -> QBO A/P Vendor Bill",
    triggers: [{ event: KATANA_PO_RECEIVED_EVENT }],
    idempotency: IDEMPOTENCY_BY_EVENT_ID,
    concurrency: [
      { limit: 1, key: "event.data.purchaseOrderId" },
      KATANA_TENANT_CONCURRENCY,
    ],
  },
  async ({ event, step }) => {
    const purchaseOrderId = Number(event.data.purchaseOrderId);
    const action = String(event.data.action ?? "purchase_order.received");

    // Step 1: Hydrate the full Purchase Order & Supplier from Katana
    const poDetail = await runKatanaStep<CreateQboVendorBillInput>(
      step,
      "fetch-katana-po-details",
      async (): Promise<CreateQboVendorBillInput> => {
        const { data: poRaw } = await katanaFetch<Record<string, unknown>>(
          `/purchase_orders/${purchaseOrderId}`,
        );
        const po = (poRaw?.data as Record<string, unknown>) ?? poRaw ?? {};
        const orderNo = String(po.order_no ?? event.data.orderNo ?? `PO-${purchaseOrderId}`);
        const supplierId = Number(po.supplier_id ?? 0);

        let supplierName = "Katana Vendor";
        if (supplierId > 0) {
          try {
            const { data: supRaw } = await katanaFetch<Record<string, unknown>>(
              `/suppliers/${supplierId}`,
            );
            const sup = (supRaw?.data as Record<string, unknown>) ?? supRaw ?? {};
            if (typeof sup.name === "string" && sup.name.trim()) {
              supplierName = sup.name.trim();
            }
          } catch {
            // Fallback if /suppliers/:id is unavailable
          }
        }

        const rawRows = Array.isArray(po.purchase_order_rows)
          ? (po.purchase_order_rows as Record<string, unknown>[])
          : [];

        const lines = rawRows.map((row, idx) => {
          const qty = Number(row.received_quantity ?? row.quantity ?? 1);
          const unitPrice = Number(row.price_per_unit ?? 0);
          const pricePerUnitCents = Math.round(unitPrice * 100);
          const amountCents = Math.round(qty * unitPrice * 100);
          return {
            sku: String(row.variant_sku ?? row.sku ?? `LINE-${idx + 1}`),
            description: String(row.notes ?? row.variant_name ?? `PO ${orderNo} Line ${idx + 1}`),
            quantity: qty,
            pricePerUnitCents,
            amountCents,
          };
        });

        return {
          katanaPoId: purchaseOrderId,
          orderNo,
          supplierName,
          txnDate: new Date().toISOString().slice(0, 10),
          lines:
            lines.length > 0
              ? lines
              : [
                  {
                    sku: orderNo,
                    description: `Katana PO ${orderNo}`,
                    quantity: 1,
                    pricePerUnitCents: Math.round(Number(po.total ?? 0) * 100),
                    amountCents: Math.round(Number(po.total ?? 0) * 100),
                  },
                ],
        };
      },
    );

    // Step 2: Check Ledger Containment Gate (log vs live)
    const ledgerMode = getLedgerPipelineMode();
    if (ledgerMode !== "live") {
      return {
        ok: true,
        mode: "log",
        action,
        purchaseOrderId,
        orderNo: poDetail.orderNo,
        supplierName: poDetail.supplierName,
        lineCount: poDetail.lines.length,
        message:
          "LEDGER_PIPELINE_MODE=log — Dry run recorded; set LEDGER_PIPELINE_MODE=live to POST QBO Bill.",
      };
    }

    // Step 3: Post A/P Vendor Bill to QuickBooks Online
    const qboResult = await step.run("post-qbo-vendor-bill", async () => {
      return createQboVendorBillFromKatanaPo(poDetail);
    });

    return {
      ok: true,
      mode: "live",
      action,
      purchaseOrderId,
      orderNo: poDetail.orderNo,
      supplierName: poDetail.supplierName,
      qboBillId: qboResult.billId,
      qboVendorId: qboResult.vendorId,
      totalDollars: qboResult.totalDollars,
    };
  },
);
