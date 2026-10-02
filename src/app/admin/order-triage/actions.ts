"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { inngest } from "@/inngest/client";
import { getPimSession } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import {
  order_intake,
  sku_mappings,
  type OrderIntakeMappedLine,
} from "@/server/db/schema";
import { ORDER_APPROVED_EVENT } from "@/server/ghl/push-factory-order";
import { canPushGhlFactoryOrders } from "@/server/pipeline/ghl-factory-mode";

export type TriageResult =
  | { ok: true; pushed: boolean; message: string }
  | { ok: false; error: string };

const OPEN_STATUSES = ["received", "approved", "failed"] as const;

async function requireStaff(): Promise<{ email: string } | { error: string }> {
  const session = await getPimSession();
  if (!session?.email.toLowerCase().endsWith("@ccpatio.com")) {
    return { error: "Sign in with a @ccpatio.com account." };
  }
  return { email: session.email };
}

async function activeSku(sku: string, prefix: "FIN-" | "FAB-"): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(
      and(eq(sku_mappings.global_sku, sku), eq(sku_mappings.is_active, true)),
    )
    .limit(1);
  return Boolean(row?.sku.startsWith(prefix));
}

function parseLines(raw: OrderIntakeMappedLine[]): { ok: true; lines: OrderIntakeMappedLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Add at least one finished good." };
  }
  const lines: OrderIntakeMappedLine[] = [];
  for (const line of raw) {
    const finSku = line.finSku.trim().toUpperCase();
    const fabricSku = line.fabricSku.trim().toUpperCase();
    const quantity = Number(line.quantity);
    if (!finSku.startsWith("FIN-") || !fabricSku.startsWith("FAB-")) {
      return { ok: false, error: "Each line needs a FIN-* finished good and a FAB-* fabric." };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `${finSku} quantity must be greater than zero.` };
    }
    lines.push({ finSku, fabricSku, quantity });
  }
  return { ok: true, lines };
}

export async function approveAndPushOrder(input: {
  id: string;
  version: number;
  lines: OrderIntakeMappedLine[];
}): Promise<TriageResult> {
  const session = await requireStaff();
  if ("error" in session) return { ok: false, error: session.error };

  const parsed = parseLines(input.lines);
  if (!parsed.ok) return parsed;

  for (const line of parsed.lines) {
    if (!(await activeSku(line.finSku, "FIN-"))) {
      return { ok: false, error: `${line.finSku} is not an active finished good.` };
    }
    if (!(await activeSku(line.fabricSku, "FAB-"))) {
      return { ok: false, error: `${line.fabricSku} is not an active fabric.` };
    }
  }

  const db = getDb();
  const [updated] = await db
    .update(order_intake)
    .set({
      mapped_lines: parsed.lines,
      status: "approved",
      last_error: null,
      version: input.version + 1,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(order_intake.id, input.id),
        eq(order_intake.version, input.version),
        inArray(order_intake.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: order_intake.id, version: order_intake.version });

  if (!updated) {
    return { ok: false, error: "This order changed or is no longer open. Reload and try again." };
  }

  revalidatePath("/admin/order-triage");

  if (!canPushGhlFactoryOrders()) {
    return {
      ok: true,
      pushed: false,
      message: "Mapping saved. Katana push stays off while GHL_FACTORY_ORDERS=log.",
    };
  }

  if (!process.env.INNGEST_EVENT_KEY?.trim()) {
    return {
      ok: true,
      pushed: false,
      message: "Mapping saved. INNGEST_EVENT_KEY is not set, so the Katana push was not queued.",
    };
  }

  await inngest.send({
    name: ORDER_APPROVED_EVENT,
    data: { orderIntakeId: updated.id, version: updated.version },
    id: `order-approved-${updated.id}-v${updated.version}`,
  });

  return {
    ok: true,
    pushed: true,
    message: "Approved and queued for Katana.",
  };
}

export async function rejectOrder(input: {
  id: string;
  version: number;
}): Promise<TriageResult> {
  const session = await requireStaff();
  if ("error" in session) return { ok: false, error: session.error };

  const db = getDb();
  const [updated] = await db
    .update(order_intake)
    .set({
      status: "rejected",
      version: input.version + 1,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(order_intake.id, input.id),
        eq(order_intake.version, input.version),
        inArray(order_intake.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: order_intake.id });

  if (!updated) {
    return { ok: false, error: "This order changed or is no longer open. Reload and try again." };
  }

  revalidatePath("/admin/order-triage");
  return { ok: true, pushed: false, message: "Order rejected. Katana was not called." };
}
