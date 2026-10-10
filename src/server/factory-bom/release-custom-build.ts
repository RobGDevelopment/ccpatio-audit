import { getDb } from "@/server/db/client";
import { custom_build_jobs, katana_mo_records, order_intake, sku_mappings, factory_release_gate } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createCutCardToken } from "./cut-card-token";
import { katanaFetch } from "@/lib/katana";
import { CC_MANUFACTURING_LOCATION_ID } from "@/server/ghl/hold-order";
import { canPushGhlFactoryOrders } from "@/server/pipeline/ghl-factory-mode";
import { inngest } from "@/inngest/client";
import crypto from "crypto";

export async function releaseCustomJobAction(globalSku: string) {
  await inngest.send({
    name: "factory.custom_job.released",
    data: { globalSku },
  });
}

export async function executeReleaseCustomBuild(globalSku: string) {
  const db = getDb();

  const skuMeta = await db.query.sku_mappings.findFirst({
    where: eq(sku_mappings.global_sku, globalSku),
  });

  if (!skuMeta) throw new Error(`SKU ${globalSku} not found`);

  const attrs = skuMeta.attributes as Record<string, any> | null;
  const jobId = attrs?.job_id;

  if (!attrs?.custom_build || !jobId) {
    throw new Error(`SKU ${globalSku} is not a custom build or missing job_id`);
  }

  const variantId = skuMeta.katana_variant_id;
  if (!variantId) {
    throw new Error(`SKU ${globalSku} has no Katana variant ID`);
  }

  const job = await db.query.custom_build_jobs.findFirst({
    where: eq(custom_build_jobs.id, jobId),
  });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const gate = await db.query.factory_release_gate.findFirst({
    where: eq(factory_release_gate.root_sku, globalSku),
  });

  const dossierHash = gate?.dossier_hash || crypto.randomBytes(16).toString("hex");
  const externalRef = `custom:${globalSku}:${dossierHash}`;

  const token = createCutCardToken({ jobId: job.id, globalSku });
  const cutCardUrl = `https://app.ccpatio.com/factory/cut-cards/${token}`;

  const dryRun = !canPushGhlFactoryOrders();

  const orderIntake = job.ghl_opportunity_id ? await db.query.order_intake.findFirst({
    where: eq(order_intake.ghl_opportunity_id, job.ghl_opportunity_id),
  }) : null;

  if (dryRun) {
    return { receipt: true, externalRef, cutCardUrl, dryRun: true };
  }

  // Check idempotency
  const existingRecord = await db.query.katana_mo_records.findFirst({
    where: eq(katana_mo_records.external_ref, externalRef),
  });
  if (existingRecord) {
    return { receipt: true, externalRef, existingId: existingRecord.katana_mo_id, dryRun: false };
  }

  let finalMoId: number;

  if (orderIntake && Array.isArray(orderIntake.katana_mo_ids) && orderIntake.katana_mo_ids.length > 0) {
    const moId = orderIntake.katana_mo_ids[0];
    await katanaFetch(`/manufacturing_orders/${moId}`, {
      method: "PATCH",
      body: {
        additional_info: `custom_build=1\nCut card: ${cutCardUrl}`,
      },
    });
    finalMoId = moId;
  } else {
    const { data } = await katanaFetch<Record<string, unknown>>("/manufacturing_orders", {
      method: "POST",
      body: {
        variant_id: variantId,
        quantity: 1,
        location_id: CC_MANUFACTURING_LOCATION_ID,
        additional_info: `custom_build=1\nCut card: ${cutCardUrl}`,
        created_at: new Date().toISOString(),
      },
    });
    finalMoId = Number(data.id);
  }

  await db.insert(katana_mo_records).values({
    external_ref: externalRef,
    katana_mo_id: String(finalMoId),
    status: "released",
  });

  return { receipt: true, externalRef, moId: finalMoId, dryRun: false };
}
