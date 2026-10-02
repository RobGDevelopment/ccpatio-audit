import { ghlPost } from "@/server/ghl/private-api";

export type HoldWarningNotice =
  | { ok: true; channel: "task" | "note" }
  | { ok: false; error: string };

export function holdExpirationWarning(sku: string): string {
  return `URGENT: Your inventory hold on ${sku} expires in 48 hours. Please extend or release it.`;
}

/**
 * Task on the opportunity contact, assigned to the rep. If Tasks are
 * unavailable, fall back to a contact note attributed to the same user.
 */
export async function notifyHoldExpiring(input: {
  contactId: string;
  ghlUserId: string;
  sku: string;
  dueAt: Date;
}): Promise<HoldWarningNotice> {
  const contactId = input.contactId.trim();
  const ghlUserId = input.ghlUserId.trim();
  const sku = input.sku.trim();
  if (!contactId || !ghlUserId || !sku) {
    return { ok: false, error: "Hold warning is missing a contact, rep, or SKU." };
  }

  const message = holdExpirationWarning(sku);
  const task = await ghlPost(`/contacts/${encodeURIComponent(contactId)}/tasks`, {
    title: message,
    body: message,
    dueDate: input.dueAt.toISOString(),
    completed: false,
    assignedTo: ghlUserId,
  });
  if (task.ok) return { ok: true, channel: "task" };

  const note = await ghlPost(`/contacts/${encodeURIComponent(contactId)}/notes`, {
    body: message,
    userId: ghlUserId,
  });
  if (note.ok) return { ok: true, channel: "note" };

  return {
    ok: false,
    error: `Task failed (${task.error}). Note failed (${note.error}).`,
  };
}
