import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { getPimSession, type PimSession } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import { order_intake, sku_mappings } from "@/server/db/schema";
import type { ShowroomOrder, ShowroomSku } from "@/app/showroom/orders/TriageCard";

export type ShowroomPortalData = {
  session: PimSession;
  orders: ShowroomOrder[];
  finishedGoods: ShowroomSku[];
  fabrics: ShowroomSku[];
};

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

function notesFrom(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["notes", "note", "opportunity_notes", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function loadShowroomPortal(): Promise<ShowroomPortalData | null> {
  const session = await getPimSession();
  if (!session) return null;

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

  const finishedGoods: ShowroomSku[] = [];
  const fabrics: ShowroomSku[] = [];
  for (const row of skuRows) {
    const option = { sku: row.sku, name: row.name ?? "" };
    if (row.sku.startsWith("FIN-")) finishedGoods.push(option);
    if (row.sku.startsWith("FAB-")) fabrics.push(option);
  }

  const orders: ShowroomOrder[] = rows.map((row) => ({
    id: row.id,
    opportunityId: row.ghl_opportunity_id,
    status: row.status,
    version: row.version,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    stageName: row.stage_name,
    notes: notesFrom(row.raw_payload),
    lastError: row.last_error,
    urls: [...new Set(collectUrls(row.raw_payload))],
  }));

  return { session, orders, finishedGoods, fabrics };
}
