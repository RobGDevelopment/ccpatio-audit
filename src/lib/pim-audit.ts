import { desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { pim_audit_log, pim_operators } from "@/server/db/schema";
import type { PimSession } from "@/lib/pim-session";
import { cookies } from "next/headers";
import {
  PIM_SESSION_COOKIE,
  verifyPimSessionToken,
} from "@/lib/pim-session";

export async function getPimSession(): Promise<PimSession | null> {
  try {
    const jar = await cookies();
    const token = jar.get(PIM_SESSION_COOKIE)?.value;
    return verifyPimSessionToken(token);
  } catch {
    // Outside Next.js request scope (vitest, scripts)
    return null;
  }
}

export async function resolvePimOperator(clientLabel?: string): Promise<{
  email: string;
  label: string;
}> {
  const session = await getPimSession();
  if (session) {
    return { email: session.email, label: session.email };
  }
  const fallback = clientLabel?.trim() || "anonymous";
  return { email: fallback, label: fallback };
}

export async function logPimAudit(input: {
  operatorEmail: string;
  operatorName?: string | null;
  globalSku?: string | null;
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(pim_audit_log).values({
      operator_email: input.operatorEmail,
      operator_name: input.operatorName ?? null,
      global_sku: input.globalSku ?? null,
      action: input.action,
      field: input.field ?? null,
      old_value: truncate(input.oldValue),
      new_value: truncate(input.newValue),
    });
    await db
      .update(pim_operators)
      .set({ last_seen_at: new Date() })
      .where(eq(pim_operators.email, input.operatorEmail));
  } catch {
    // audit is best-effort — never block saves
  }
}

function truncate(value: string | null | undefined, max = 500): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export type AuditLogRow = {
  id: string;
  operatorEmail: string;
  operatorName: string | null;
  globalSku: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

export async function fetchRecentAuditLog(limit = 200): Promise<AuditLogRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pim_audit_log)
    .orderBy(desc(pim_audit_log.created_at))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    operatorEmail: r.operator_email,
    operatorName: r.operator_name,
    globalSku: r.global_sku,
    action: r.action,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    createdAt: r.created_at.toISOString(),
  }));
}
