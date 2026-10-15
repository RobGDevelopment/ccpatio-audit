/**
 * POST /api/webhooks/ghl
 *
 * Lost and Abandoned release showroom holds and do not insert intake.
 * Produce Factory Order inserts order_intake. Zod failure is 400 and does not insert.
 * Any other stage is 200 ignored. A repeated opportunity id is 200 duplicate.
 * Katana factory writes happen later, from /admin/order-triage, and only when
 * GHL_FACTORY_ORDERS=live.
 *
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md §2.4 and docs/SOFT_HOLD_ARCHITECTURE.md §10.
 */
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { logError, logStructured } from "@/lib/log/structured";
import { getDb } from "@/server/db/client";
import { order_intake } from "@/server/db/schema";
import {
  factoryContactEmail,
  factoryContactName,
  parseGhlFactoryOpportunity,
  readGhlOpportunityRelease,
} from "@/server/ghl/factory-order.schema";
import { isProduceFactoryOrderStage } from "@/server/ghl/factory-stage";
import { verifyGhlWebhookRequest } from "@/server/ghl/ingress";
import { voidOpenQuotesForOpportunity } from "@/server/quotes/draft";
import { releaseHold } from "@/server/stock/release-hold";
import { logIncomingWebhook } from "@/server/webhooks/incoming-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  const rawBody = await req.text();
  if (!verifyGhlWebhookRequest(rawBody, req.headers, secret)) {
    logStructured("warn", "ghl-webhook-invalid-signature", { status: 401 });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (error) {
    const ref = logError("ghl-webhook-invalid-json", error, { status: 400 });
    return NextResponse.json(
      { errors: [{ path: "(root)", message: "Body must be valid JSON" }], ref },
      { status: 400 },
    );
  }

  const release = readGhlOpportunityRelease(parsedJson);
  if (release) {
    const result = await releaseHold(release.opportunityId, release.status);
    const quotes = await voidOpenQuotesForOpportunity(
      release.opportunityId,
      release.status,
    );
    if (quotes.voided > 0 || quotes.flagged > 0) {
      revalidatePath("/embed/order-desk");
    }
    await logIncomingWebhook({
      source: "ghl",
      eventName: release.status === "lost" ? "opportunity.lost" : "opportunity.abandoned",
      idempotencyKey: `ghl-${release.status}:${release.opportunityId}`,
      payload: parsedJson,
      status: "processed",
      errorMessage:
        result.failed > 0
          ? `${result.failed} hold(s) left releasing after a Katana refusal`
          : undefined,
    });
    return NextResponse.json(
      {
        accepted: true,
        released: result.released,
        alreadyTerminal: result.alreadyTerminal,
        failed: result.failed,
        quotesVoided: quotes.voided,
        quotesFlagged: quotes.flagged,
        opportunity_id: release.opportunityId,
        status: release.status,
      },
      { status: 200 },
    );
  }

  const parsed = parseGhlFactoryOpportunity(parsedJson);
  if (!parsed.ok) {
    logStructured("warn", "ghl-webhook-invalid-payload", {
      status: 400,
      issueCount: parsed.errors.length,
    });
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }

  const stageName = parsed.data.stage_name ?? null;
  const stageId = parsed.data.pipeline_stage_id ?? null;
  if (!isProduceFactoryOrderStage({ stageName, pipelineStageId: stageId })) {
    await logIncomingWebhook({
      source: "ghl",
      eventName: "opportunity.stage",
      idempotencyKey: `ghl-factory-ignore:${parsed.data.id}:${stageId ?? stageName}`,
      payload: parsedJson,
      status: "processed",
      errorMessage: "ignored: stage is not Produce Factory Order",
    });
    return NextResponse.json(
      { ignored: true, reason: "stage", opportunity_id: parsed.data.id },
      { status: 200 },
    );
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: order_intake.id, status: order_intake.status })
    .from(order_intake)
    .where(eq(order_intake.ghl_opportunity_id, parsed.data.id))
    .limit(1);

  if (existing) {
    return NextResponse.json(
      {
        accepted: true,
        duplicate: true,
        id: existing.id,
        status: existing.status,
        opportunity_id: parsed.data.id,
      },
      { status: 200 },
    );
  }

  try {
    const [created] = await db
      .insert(order_intake)
      .values({
        ghl_opportunity_id: parsed.data.id,
        status: "received",
        raw_payload: parsedJson,
        contact_name: factoryContactName(parsed.data),
        contact_email: factoryContactEmail(parsed.data),
        stage_name: stageName ?? stageId,
      })
      .returning({ id: order_intake.id });

    await logIncomingWebhook({
      source: "ghl",
      eventName: "opportunity.produce_factory_order",
      idempotencyKey: `ghl-factory:${parsed.data.id}`,
      payload: parsedJson,
      status: "received",
    });

    return NextResponse.json(
      {
        accepted: true,
        id: created?.id,
        opportunity_id: parsed.data.id,
        status: "received",
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { accepted: true, duplicate: true, opportunity_id: parsed.data.id },
        { status: 200 },
      );
    }
    throw error;
  }
}

/**
 * Status contract with GoHighLevel: 400 for a body that can never succeed, 401 for a bad
 * signature, 500 for every other fault so GHL retries. A retry is safe because the intake
 * insert is unique on the opportunity id and holds release idempotently.
 */
export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    const ref = logError("ghl-webhook-failed", error, { status: 500 });
    return NextResponse.json({ error: "internal_error", ref }, { status: 500 });
  }
}
