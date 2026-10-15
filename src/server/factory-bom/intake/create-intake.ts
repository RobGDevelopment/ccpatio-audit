import crypto from "node:crypto";
import { eq, like, sql, and } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_jobs,
  sku_mappings,
  custom_build_job_items,
} from "@/server/db/schema";
import { logPimAudit, GHL_EMBED_PRINCIPAL_EMAIL } from "@/lib/pim-audit";
import { previewSku } from "@/server/master-catalog/sku-preview";
import { createNewProductCore } from "@/server/master-catalog/create-product-core";
import { createItemStore } from "@/server/path-a/item-store";
import type { ReleaseDb } from "@/server/path-a/release-store";
import {
  deriveClientCode,
  deriveItemCode,
  buildClientSku,
  nextVariantIndex,
  roundInchesForCode,
} from "@/lib/intake/naming";
import {
  IntakeClientInputSchema,
  IntakeCatalogInputSchema,
  type IntakeClientInput,
  type IntakeCatalogInput,
} from "@/lib/intake/types";
import { CAD_MAX_BYTES, ALLOWED_GEOMETRY_EXTS } from "@/lib/intake/files";
import { resolveIntakeActor } from "./actor";
import { fetchIntakeOpportunity } from "@/server/ghl/fetch-intake-opportunity";
import { loadProjectStatus } from "./project-status";
import { validateFinishSelection } from "./finishes";
import { IntakeDomainError } from "./errors";

export type CreateIntakeResult = {
  sku: string;
  jobId?: string;
  itemId?: string;
  replayed: boolean;
};

type ReplaceMeta = {
  isReplaceModel?: true;
  previousFinishes?: unknown;
  previousQuantity?: number | null;
};
type TxResult = CreateIntakeResult & ReplaceMeta;

function fingerprint(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function getFileExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.[0-9a-z]+$/);
  return match ? match[0] : "";
}

/**
 * Creates an intake record transactionally and idempotently.
 */
export async function createIntake(
  input: IntakeClientInput | IntakeCatalogInput,
  options?: {
    db?: ReleaseDb;
    getGhl?: typeof fetchIntakeOpportunity;
  }
): Promise<CreateIntakeResult> {
  const db = options?.db ?? getDb();

  // 1. Resolve Actor
  const actorRes = await resolveIntakeActor({
    reportedEmail: input.reportedUserEmail,
  });
  if (!actorRes.ok) {
    throw new IntakeDomainError("NOT_SIGNED_IN");
  }
  const actor = actorRes.actor;
  const isEmbed = actor.source !== "operator";
  const effectiveEmail = isEmbed ? GHL_EMBED_PRINCIPAL_EMAIL : actor.email;
  const operatorName = isEmbed ? "Unverified Embed User" : null;

  if (input.mode === "client_project") {
    // 2. Validate input schema
    const parsed = IntakeClientInputSchema.parse(input);

    // Validate CAD file descriptor
    const cadExt = getFileExtension(parsed.files.cad.filename);
    if (!(ALLOWED_GEOMETRY_EXTS as readonly string[]).includes(cadExt) || cadExt === ".skp") {
      throw new IntakeDomainError("FILE_REQUIRED");
    }
    if (parsed.files.cad.byteSize > CAD_MAX_BYTES) {
      throw new IntakeDomainError("FILE_TOO_LARGE");
    }

    // 3. Fetch GHL opportunity (fails closed, writes nothing)
    const opp = await fetchIntakeOpportunity(parsed.opportunityId);

    // 4. Load Project Status (fails if locked or missing packet)
    const status = await loadProjectStatus(parsed.opportunityId);
    if (status.locked) {
      throw new IntakeDomainError("PROJECT_LOCKED");
    }
    if (!status.packet && !parsed.files.packet) {
      throw new IntakeDomainError("FILE_REQUIRED");
    }

    // 5. Validate Finishes
    const finishesRes = await validateFinishSelection(parsed.finishes);
    if (!finishesRes.ok) {
      throw new IntakeDomainError("FINISHES_REQUIRED", undefined, {
        fieldErrors: finishesRes.fieldErrors,
      });
    }

    const payloadFp = fingerprint({
      mode: "client_project",
      oppId: parsed.opportunityId,
      name: parsed.pieceName,
      qty: parsed.quantity,
      finishes: parsed.finishes,
    });

    // 6. Transaction
    const result: TxResult = await db.transaction(async (tx): Promise<TxResult> => {
      // Replay check
      const existingCandidates = await tx.query.sku_mappings.findMany({
        where: like(sku_mappings.global_sku, "JOB-%"),
      });

      const replayedRow = existingCandidates.find((r) => {
        const intakeMeta = (r.attributes as Record<string, unknown> | null)?.intake as { key?: string; fingerprint?: string } | undefined;
        return intakeMeta && intakeMeta.key === parsed.intakeKey;
      });

      if (replayedRow) {
        const rawAttrs = replayedRow.attributes as Record<string, unknown> | null;
        const intakeMeta = rawAttrs?.intake as { fingerprint?: string } | undefined;
        const storedFp = intakeMeta?.fingerprint;
        if (storedFp === payloadFp) {
          return {
            sku: replayedRow.global_sku,
            jobId: (rawAttrs?.job_id as string | undefined) ?? undefined,
            replayed: true,
          };
        } else {
          throw new IntakeDomainError("VALIDATION", "intakeKey was already used with a different payload");
        }
      }

      // Upsert Job Header (ON CONFLICT DO NOTHING)
      const clientSlug = status.clientCode || deriveClientCode(opp.contactName, opp.name);

      let jobId: string;
      const existingJob = await tx.query.custom_build_jobs.findFirst({
        where: eq(custom_build_jobs.ghl_opportunity_id, parsed.opportunityId),
      });

      if (existingJob) {
        jobId = existingJob.id;
      } else {
        const [insertedJob] = await tx
          .insert(custom_build_jobs)
          .values({
            client_slug: clientSlug,
            display_name: opp.name,
            ghl_opportunity_id: parsed.opportunityId,
            created_by: effectiveEmail,
          })
          .returning();
        jobId = insertedJob.id;
      }

      // Derive Item Code and Base SKU
      const itemCode = deriveItemCode(parsed.pieceName);
      const baseSku = buildClientSku(clientSlug, itemCode);

      // Check for duplicate piece under this job
      const jobItems = await tx.query.custom_build_job_items.findMany({
        where: eq(custom_build_job_items.job_id, jobId),
      });

      const existingItemSkus: string[] = jobItems.map((i: { global_sku: string }) => i.global_sku);
      const hasDuplicate = existingItemSkus.some(
        (s) => s === baseSku || s.startsWith(`${baseSku}-V`) || s.match(new RegExp(`^${baseSku}-\\d{2}$`))
      );

      if (hasDuplicate && !parsed.duplicateDecision) {
        const nextIdx = nextVariantIndex(existingItemSkus, baseSku);
        throw new IntakeDomainError("DUPLICATE_PIECE", undefined, {
          details: {
            existing: { sku: baseSku, pieceName: parsed.pieceName },
            suggestedVariantSku: buildClientSku(clientSlug, itemCode, nextIdx),
          },
        });
      }

      if (hasDuplicate && parsed.duplicateDecision === "replace_model") {
        // Target baseSku if present in jobItems, else find latest variant matching baseSku
        let targetSku: string | null = null;
        if (existingItemSkus.includes(baseSku)) {
          targetSku = baseSku;
        } else {
          let latestIdx = -1;
          let latestSku: string | null = null;
          for (const s of existingItemSkus) {
            const vMatch = s.match(new RegExp(`^${baseSku}-V(\\d+)$`));
            if (vMatch) {
              const idx = parseInt(vMatch[1]!, 10);
              if (idx > latestIdx) {
                latestIdx = idx;
                latestSku = s;
              }
              continue;
            }
            const legacyMatch = s.match(new RegExp(`^${baseSku}-(\\d{2})$`));
            if (legacyMatch) {
              const idx = parseInt(legacyMatch[1]!, 10);
              if (idx > latestIdx) {
                latestIdx = idx;
                latestSku = s;
              }
            }
          }
          if (latestSku) {
            targetSku = latestSku;
          }
        }

        if (!targetSku) {
          throw new IntakeDomainError("VALIDATION", "No existing piece or variant found to replace");
        }

        const existingMapping = await tx.query.sku_mappings.findFirst({
          where: eq(sku_mappings.global_sku, targetSku),
        });
        const existingAttrs = (existingMapping?.attributes as Record<string, unknown> | null) || {};
        const existingIntake = (existingAttrs.intake as Record<string, unknown> | null) || {};

        const updatedAttrs = {
          ...existingAttrs,
          custom_build: true,
          job_id: jobId,
          finishes: parsed.finishes,
          intake: {
            ...existingIntake,
            key: parsed.intakeKey,
            fingerprint: payloadFp,
            actor: {
              email: effectiveEmail,
              source: actor.source,
              verified: actor.verified,
            },
            finishesPending: finishesRes.finishesPending,
            updatedAt: new Date().toISOString(),
          },
        };

        if (existingMapping) {
          await tx
            .update(sku_mappings)
            .set({
              attributes: updatedAttrs,
              original_name: parsed.pieceName,
              updated_by: effectiveEmail,
            })
            .where(eq(sku_mappings.global_sku, targetSku));
        } else {
          await tx
            .insert(sku_mappings)
            .values({
              global_sku: targetSku,
              product_origin: null,
              category: "Custom",
              item_type: "finished_good",
              original_name: parsed.pieceName,
              source_file: "factory-bom-intake",
              sync_to_woo: false,
              sync_to_clover: false,
              updated_by: effectiveEmail,
              attributes: updatedAttrs,
            })
            .onConflictDoNothing();
        }

        const previousJobItem = await tx.query.custom_build_job_items.findFirst({
          where: and(
            eq(custom_build_job_items.job_id, jobId),
            eq(custom_build_job_items.global_sku, targetSku)
          ),
        });
        const previousQuantity = previousJobItem?.quantity ?? null;
        const previousFinishes = existingAttrs.finishes ?? null;

        const itemStore = createItemStore(() => tx);
        const item = await itemStore.ensureItem({
          jobId,
          globalSku: targetSku,
          quantity: parsed.quantity,
        });

        await tx
          .update(custom_build_job_items)
          .set({
            quantity: parsed.quantity,
            updated_at: new Date(),
          })
          .where(eq(custom_build_job_items.id, item.id));

        return {
          sku: targetSku,
          jobId,
          itemId: item.id,
          replayed: false,
          isReplaceModel: true,
          previousFinishes,
          previousQuantity,
        };
      }

      let targetSku = baseSku;
      if (hasDuplicate && parsed.duplicateDecision === "add_another") {
        const nextIdx = nextVariantIndex(existingItemSkus, baseSku);
        targetSku = buildClientSku(clientSlug, itemCode, nextIdx);
      }

      // Insert SKU Mapping
      let skuInserted = false;
      let attempts = 0;
      let currentSku = targetSku;

      while (!skuInserted && attempts < 5) {
        attempts += 1;
        const [insertedMapping] = await tx
          .insert(sku_mappings)
          .values({
            global_sku: currentSku,
            product_origin: null,
            category: "Custom",
            item_type: "finished_good",
            original_name: parsed.pieceName,
            source_file: "factory-bom-intake",
            sync_to_woo: false,
            sync_to_clover: false,
            updated_by: effectiveEmail,
            attributes: {
              custom_build: true,
              job_id: jobId,
              finishes: parsed.finishes,
              intake: {
                key: parsed.intakeKey,
                fingerprint: payloadFp,
                actor: {
                  email: effectiveEmail,
                  source: actor.source,
                  verified: actor.verified,
                },
                finishesPending: finishesRes.finishesPending,
                createdAt: new Date().toISOString(),
              },
            },
          })
          .onConflictDoNothing()
          .returning();

        if (insertedMapping) {
          currentSku = insertedMapping.global_sku;
          skuInserted = true;
        } else {
          // Check if it was already inserted by a concurrent replay with same intakeKey
          const found = await tx.query.sku_mappings.findFirst({
            where: eq(sku_mappings.global_sku, currentSku),
          });
          const foundAttrs = found?.attributes as Record<string, unknown> | null;
          const foundIntake = foundAttrs?.intake as { key?: string } | undefined;
          if (found && foundIntake?.key === parsed.intakeKey) {
            return {
              sku: found.global_sku,
              jobId,
              replayed: true,
            };
          }
          // Concurrent twin won with another key -> bump variant
          const nextIdx = attempts + 1;
          currentSku = buildClientSku(clientSlug, itemCode, nextIdx);
        }
      }

      if (!skuInserted) {
        throw new IntakeDomainError("CONFLICT_RETRY");
      }

      // Ensure custom_build_job_items row
      const itemStore = createItemStore(() => tx);
      const item = await itemStore.ensureItem({
        jobId,
        globalSku: currentSku,
        quantity: parsed.quantity,
      });

      return {
        sku: currentSku,
        jobId,
        itemId: item.id,
        replayed: false,
      };
    });

    // 7. Audit log after commit (only on fresh non-replayed operations)
    const { isReplaceModel, previousFinishes, previousQuantity, ...publicResult } = result;
    if (!publicResult.replayed) {
      await logPimAudit({
        operatorEmail: effectiveEmail,
        operatorName,
        globalSku: publicResult.sku,
        action: isReplaceModel ? "intake.replace_model" : "intake.create",
        newValue: JSON.stringify({
          jobId: publicResult.jobId,
          reportedEmail: isEmbed ? actor.email : undefined,
          verified: actor.verified,
          via: isEmbed ? "ghl-embed" : "operator",
          ...(isReplaceModel
            ? {
                previousFinishes,
                previousQuantity,
                newFinishes: parsed.finishes,
                newQuantity: parsed.quantity,
              }
            : {}),
        }),
      }).catch((err: unknown) => {
        console.error(JSON.stringify({
          tag: "pim-audit-error",
          where: "createIntake:client:logPimAudit",
          errorName: err instanceof Error ? err.name : "UnknownError",
        }));
      });
    }

    return publicResult;
  } else {
    // Standard Catalog Path
    const parsed = IntakeCatalogInputSchema.parse(input);

    const payloadFp = fingerprint({
      mode: "catalog",
      name: parsed.productName,
      col: parsed.collectionCode,
      cat: parsed.categoryCode,
      len: parsed.length,
      dep: parsed.depth,
    });

    // Replay check before collision preview
    const existingCandidates = await db.query.sku_mappings.findMany({
      where: like(sku_mappings.global_sku, "FIN-%"),
    });

    const replayedRow = existingCandidates.find((r) => {
      const intakeMeta = (r.attributes as Record<string, unknown> | null)?.intake as { key?: string; fingerprint?: string } | undefined;
      return intakeMeta && intakeMeta.key === parsed.intakeKey;
    });

    if (replayedRow) {
      const storedFp = ((replayedRow.attributes as Record<string, unknown> | null)?.intake as { fingerprint?: string } | undefined)?.fingerprint;
      if (storedFp === payloadFp) {
        return {
          sku: replayedRow.global_sku,
          replayed: true,
        };
      } else {
        throw new IntakeDomainError("VALIDATION", "intakeKey was already used with a different payload");
      }
    }

    const lengthRounded = roundInchesForCode(parsed.length);
    const depthRounded = roundInchesForCode(parsed.depth);

    // Dictionary preview and collision check
    const preview = await previewSku(
      parsed.productName,
      parsed.collectionLabel,
      parsed.categoryCode,
      String(lengthRounded),
      String(depthRounded),
      null,
      "manufactured",
      undefined,
      parsed.collectionCode,
      parsed.categoryLabel
    );

    let finalSku = preview.sku;

    if (preview.isCollision) {
      if (!parsed.collisionDecision) {
        throw new IntakeDomainError("DUPLICATE_PRODUCT", undefined, {
          details: {
            existing: { sku: preview.sku, productName: preview.existingProductName },
            suggestedVariantSku: `${preview.sku}-V2`,
          },
        });
      }

      if (parsed.collisionDecision === "update_model") {
        // Allowed only for catalog SKU: continue with normal upload against existing SKU
        await logPimAudit({
          operatorEmail: effectiveEmail,
          operatorName,
          globalSku: preview.sku,
          action: "intake.update_model",
          newValue: JSON.stringify({
            reportedEmail: isEmbed ? actor.email : undefined,
            verified: actor.verified,
            via: isEmbed ? "ghl-embed" : "operator",
          }),
        }).catch((err: unknown) => {
          console.error(JSON.stringify({
            tag: "pim-audit-error",
            where: "createIntake:catalog:update_model:logPimAudit",
            errorName: err instanceof Error ? err.name : "UnknownError",
          }));
        });

        return {
          sku: preview.sku,
          replayed: false,
        };
      }

      if (parsed.collisionDecision === "different") {
        // Find existing variants
        const existing = await db.query.sku_mappings.findMany({
          where: like(sku_mappings.global_sku, `${preview.sku}%`),
        });
        const existingSkus = existing.map((r: { global_sku: string }) => r.global_sku);
        const nextIdx = nextVariantIndex(existingSkus, preview.sku);
        finalSku = `${preview.sku}-V${nextIdx}`;
      }
    }

    const result = await db.transaction(async (tx) => {

      await createNewProductCore(
        tx,
        {
          sku: finalSku,
          productName: parsed.productName,
          origin: "manufactured",
          categoryLabel: preview.categoryLabel,
          collectionLabel: preview.collectionLabel,
          length: String(parsed.length),
          depth: String(parsed.depth),
          sourceFile: "factory-bom-intake",
          syncToWoo: false,
          syncToClover: false,
          attributes: {
            custom_build: false,
            intake: {
              key: parsed.intakeKey,
              fingerprint: payloadFp,
              actor: {
                email: effectiveEmail,
                source: actor.source,
                verified: actor.verified,
              },
              variantOf: finalSku !== preview.sku ? preview.sku : undefined,
              createdAt: new Date().toISOString(),
            },
          },
        },
        effectiveEmail
      );

      return {
        sku: finalSku,
        replayed: false,
      };
    });

    if (!result.replayed) {
      await logPimAudit({
        operatorEmail: effectiveEmail,
        operatorName,
        globalSku: result.sku,
        action: "intake.create",
        newValue: JSON.stringify({
          reportedEmail: isEmbed ? actor.email : undefined,
          verified: actor.verified,
          via: isEmbed ? "ghl-embed" : "operator",
        }),
      }).catch((err: unknown) => {
        console.error(JSON.stringify({
          tag: "pim-audit-error",
          where: "createIntake:catalog:logPimAudit",
          errorName: err instanceof Error ? err.name : "UnknownError",
        }));
      });
    }

    return result;
  }
}
