/**
 * Shared open-DLQ predicate — stackHealth `openDlqCount` and the open list
 * endpoint must use the exact same filter (1:1 badge ↔ rows).
 */
import { eq } from "drizzle-orm";
import { dlq_events } from "@/server/db/schema";

export const DLQ_STATUS_OPEN = "open" as const;
export const DLQ_STATUS_RESOLVED = "resolved" as const;

/** Drizzle predicate for currently open DLQ rows. */
export function openDlqStatusPredicate() {
  return eq(dlq_events.status, DLQ_STATUS_OPEN);
}
