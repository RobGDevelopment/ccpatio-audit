/**
 * Katana catalog-recipe publisher (POST /recipes), session-free.
 *
 * Extracted from the "use server" factory-bom actions module (Phase 11 remediation, QCA M6): a
 * session-free Katana writer that takes an `actor` must not be a publicly invocable Server Action.
 * The operator session is resolved by the Server Action wrapper; cache revalidation also stays
 * there (this module is request-context free).
 *
 * Mutations are gated by CATALOG_PUBLISH_MODE (or KATANA_E2E_MIRROR / legacy ORDER_PIPELINE_MODE=live).
 * Path A modules must NEVER import this file (static guard 4b).
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { channel_sync } from "@/server/db/schema";
import { syncBOMToKatana } from "@/lib/katana";
import { logPimAudit } from "@/lib/pim-audit";
import { canMutateKatanaCatalog, getCatalogPublishMode } from "@/server/pipeline/catalog-mode";
import { upsertChannelSync } from "@/server/mdm/channel-sync";
import type { AirlockDossier } from "@/server/factory-bom/airlock.schema";

export type PublishRecipeToKatanaResult =
  | {
      ok: true;
      dryRun?: boolean;
      dossierHash?: string;
      message?: string;
      idempotent?: boolean;
    }
  | { ok: false; error: string; blockingCodes?: string[]; message?: string };

export type PublishSkuMeta = { katanaVariantId?: number | null };

export async function publishRecipeToKatanaCore(
  sku: string,
  actor: { email: string },
  dossierHash: string,
  dossier: AirlockDossier,
  skuMap: Map<string, PublishSkuMeta>,
): Promise<PublishRecipeToKatanaResult> {
  const db = getDb();

  if (!dossier.identity.katanaVariantId) {
    return { ok: false, error: "KATANA_VARIANT_UNRESOLVED", blockingCodes: ["KATANA_VARIANT_UNRESOLVED"] };
  }
  for (const node of dossier.nodes) {
    for (const line of node.lines) {
      const childMeta = skuMap.get(line.childSku);
      if (!childMeta?.katanaVariantId) {
        return {
          ok: false,
          error: `KATANA_VARIANT_UNRESOLVED: ${line.childSku}`,
          blockingCodes: ["KATANA_VARIANT_UNRESOLVED"],
        };
      }
    }
  }

  const catalogMode = getCatalogPublishMode();
  const dryRun = !canMutateKatanaCatalog(catalogMode);

  const [existingSync] = await db
    .select()
    .from(channel_sync)
    .where(and(eq(channel_sync.global_sku, sku), eq(channel_sync.channel, "katana")))
    .limit(1);

  if (existingSync?.status === "success" && existingSync.payload_hash === dossierHash) {
    return {
      ok: true,
      idempotent: true,
      dossierHash,
      message: "Catalog recipes posted to Katana (Synced: idempotent skip)",
    };
  }

  const result = await syncBOMToKatana(sku, {
    fromAirlock: true,
    idempotencyKey: `factory-bom:${sku}:${dossierHash}`,
  });
  if (!result.ok) return { ok: false, error: result.error };

  if (dryRun || result.dryRun) {
    return {
      ok: true,
      dryRun: true,
      dossierHash,
      message: `${result.message} Nothing was sent to Katana.`,
    };
  }

  await upsertChannelSync({
    globalSku: sku,
    channel: "katana",
    status: result.dryRun ? "pending" : "success",
    externalId: result.productVariantId != null ? String(result.productVariantId) : null,
    lastError: null,
    payloadHash: dossierHash,
  });

  await logPimAudit({
    operatorEmail: actor.email,
    globalSku: sku,
    action: "factory_bom_katana_recipes",
    newValue: result.message ?? "Katana recipe sync",
  });
  return {
    ok: true,
    message: result.message ?? "Catalog recipes posted to Katana",
  };
}
