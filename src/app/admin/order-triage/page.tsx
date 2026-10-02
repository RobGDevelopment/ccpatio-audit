import Link from "next/link";
import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { inventory_holds, order_intake, sku_mappings } from "@/server/db/schema";
import { getPimSession } from "@/lib/pim-audit";
import {
  OrderTriageClient,
  type TriageHold,
  type TriageOrderDetail,
  type TriageSkuOption,
} from "./OrderTriageClient";

export const dynamic = "force-dynamic";

function collectUrls(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, found);
  }
  return found;
}

export default async function OrderTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getPimSession();
  const params = await searchParams;
  const db = getDb();

  const rows = await db
    .select()
    .from(order_intake)
    .where(inArray(order_intake.status, ["received", "approved", "failed"]))
    .orderBy(desc(order_intake.created_at));

  const skuRows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(
      and(
        eq(sku_mappings.is_active, true),
        or(like(sku_mappings.global_sku, "FIN-%"), like(sku_mappings.global_sku, "FAB-%")),
      ),
    )
    .orderBy(sku_mappings.global_sku);

  const finishedGoods: TriageSkuOption[] = [];
  const fabrics: TriageSkuOption[] = [];
  for (const row of skuRows) {
    const option = { sku: row.sku, name: row.name ?? "" };
    if (row.sku.startsWith("FIN-")) finishedGoods.push(option);
    if (row.sku.startsWith("FAB-")) fabrics.push(option);
  }

  const holdRows = await db
    .select({
      id: inventory_holds.id,
      sku: inventory_holds.sku,
      qty: inventory_holds.qty,
      salesperson: inventory_holds.ghl_user_name,
      opportunityId: inventory_holds.ghl_opportunity_id,
      opportunityName: inventory_holds.ghl_opportunity_name,
      note: inventory_holds.note,
      expiresAt: inventory_holds.expires_at,
      status: inventory_holds.status,
      orderNo: inventory_holds.order_no,
    })
    .from(inventory_holds)
    .where(inArray(inventory_holds.status, ["active", "releasing", "converting"]))
    .orderBy(asc(inventory_holds.expires_at));

  const holds: TriageHold[] = holdRows.map((row) => ({
    id: row.id,
    sku: row.sku,
    qty: row.qty,
    salesperson: row.salesperson,
    opportunityId: row.opportunityId,
    opportunityName: row.opportunityName,
    note: row.note,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    orderNo: row.orderNo,
  }));

  const selectedId = params.id?.trim() || rows[0]?.id || null;
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const detail: TriageOrderDetail | null = selected
    ? {
        id: selected.id,
        opportunityId: selected.ghl_opportunity_id,
        status: selected.status,
        version: selected.version,
        contactName: selected.contact_name,
        contactEmail: selected.contact_email,
        stageName: selected.stage_name,
        createdAt: selected.created_at.toISOString(),
        lastError: selected.last_error,
        rawPayload: selected.raw_payload,
        attachmentUrls: [...new Set(collectUrls(selected.raw_payload))],
        mappedLines: selected.mapped_lines ?? [],
      }
    : null;

  return (
    <main className="pim-carbon-shell min-h-screen text-zinc-50">
      <div className="w-full px-2 py-4 sm:px-3">
        <header className="pim-glass mb-4 rounded-lg px-4 py-5 sm:px-5">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
            CC Patio · Factory orders
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            Order triage
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Map each GHL Produce Factory Order to a FIN-* finished good and a
            FAB-* fabric, then Approve &amp; Push. Katana is called only when
            GHL_FACTORY_ORDERS=live.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <Link href="/" className="text-emerald-400/90 transition hover:text-emerald-300">
              ← Back to Launchpad
            </Link>
            {session ? (
              <span className="text-zinc-500">
                Signed in as{" "}
                <span className="font-mono text-emerald-300/90">{session.email}</span>
              </span>
            ) : null}
          </p>
        </header>

        {rows.length > 1 ? (
          <ul className="mb-4 flex flex-wrap gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/order-triage?id=${row.id}`}
                  className={`rounded border px-2 py-1 text-xs ${
                    row.id === selectedId
                      ? "border-emerald-500 text-emerald-300"
                      : "border-zinc-800 text-zinc-400"
                  }`}
                >
                  {row.contact_name ?? row.ghl_opportunity_id} · {row.status}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <OrderTriageClient
          key={detail?.id ?? "empty"}
          detail={detail}
          finishedGoods={finishedGoods}
          fabrics={fabrics}
          holds={holds}
        />
      </div>
    </main>
  );
}
