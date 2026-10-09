import { getDb } from "@/server/db/client";
import { factory_release_gate } from "@/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resets the factory release gate to 'quarantined' for a given root SKU.
 * This clears out release fields (dossier_hash, released_by, released_at)
 * and safely ensures a released row does not survive a draft edit.
 */
export async function resetReleaseGate(
  rootSku: string,
  blockingCodes?: string[]
) {
  const db = getDb();

  const setPayload = {
    status: "quarantined" as const,
    dossier_hash: null,
    released_by: null,
    released_at: null,
    updated_at: new Date(),
    ...(blockingCodes !== undefined ? { blocking_codes: blockingCodes } : {}),
  };

  await db.insert(factory_release_gate)
    .values({
      root_sku: rootSku,
      status: "quarantined",
      blocking_codes: blockingCodes ?? [],
      checklist: {},
    })
    .onConflictDoUpdate({
      target: factory_release_gate.root_sku,
      set: setPayload,
    });
}
