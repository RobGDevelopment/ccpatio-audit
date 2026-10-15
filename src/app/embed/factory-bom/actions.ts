"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import type { CadUploadRow } from "@/app/admin/factory-bom/actions";
import { resolveIntakeActor } from "@/server/factory-bom/intake/actor";
import {
  IntakeClientInputSchema,
  IntakeCatalogInputSchema,
  UploadPlanRequestSchema,
  UpdateFinishesInputSchema,
  type ActionResult,
  type IntakeClientInput,
  type IntakeCatalogInput,
} from "@/lib/intake/types";
import { createIntake, type CreateIntakeResult } from "@/server/factory-bom/intake/create-intake";
import {
  requestPacketUpload,
  confirmPacketUpload,
  getPacketDownloadLink,
  type RequestPacketUploadResult,
  type ConfirmPacketUploadResult,
  type GetPacketDownloadLinkResult,
} from "@/server/factory-bom/intake/packet";
import {
  requestCadUploadWrapper,
  confirmCadUploadWrapper,
  getLatestCadUploadWrapper,
  type RequestCadWrapperResult,
  type ConfirmCadWrapperResult,
} from "@/server/factory-bom/intake/cad-wrapper";
import { validateFinishSelection } from "@/server/factory-bom/intake/finishes";
import { loadProjectStatus } from "@/server/factory-bom/intake/project-status";
import { IntakeDomainError, toIntakeFailure } from "@/server/factory-bom/intake/errors";
import { logPimAudit, GHL_EMBED_PRINCIPAL_EMAIL } from "@/lib/pim-audit";

const IntakeCreateUnionSchema = z.union([
  IntakeClientInputSchema,
  IntakeCatalogInputSchema,
]);

export async function createIntakeAction(
  input: unknown
): Promise<ActionResult<CreateIntakeResult>> {
  const actorRes = await resolveIntakeActor({
    reportedEmail: (input as { reportedUserEmail?: string })?.reportedUserEmail,
  });
  if (!actorRes.ok) {
    return toIntakeFailure(new IntakeDomainError("NOT_SIGNED_IN"), "createIntakeAction");
  }

  const parsed = IntakeCreateUnionSchema.safeParse(input);
  if (!parsed.success) {
    return toIntakeFailure(new IntakeDomainError("VALIDATION"), "createIntakeAction", {
      actorEmail: actorRes.actor.email,
    });
  }

  try {
    const result = await createIntake(parsed.data);
    return { ok: true, data: result };
  } catch (err: unknown) {
    return toIntakeFailure(err, "createIntakeAction", {
      actorEmail: actorRes.actor.email,
    });
  }
}

export async function requestIntakeUploadsAction(
  input: unknown
): Promise<
  ActionResult<{
    cad: RequestCadWrapperResult;
    packet?: RequestPacketUploadResult;
  }>
> {
  const actorRes = await resolveIntakeActor({
    reportedEmail: (input as { reportedUserEmail?: string })?.reportedUserEmail,
  });
  if (!actorRes.ok) {
    return toIntakeFailure(new IntakeDomainError("NOT_SIGNED_IN"), "requestIntakeUploadsAction");
  }

  const parsed = UploadPlanRequestSchema.safeParse(input);
  if (!parsed.success) {
    return toIntakeFailure(new IntakeDomainError("VALIDATION"), "requestIntakeUploadsAction", {
      actorEmail: actorRes.actor.email,
    });
  }

  try {
    const cadResult = await requestCadUploadWrapper({
      sku: parsed.data.sku,
      filename: parsed.data.cad.filename,
      byteSize: parsed.data.cad.byteSize,
      sha256: parsed.data.cad.sha256,
      reportedUserEmail: parsed.data.reportedUserEmail,
    });

    let packetResult: RequestPacketUploadResult | undefined;
    if (parsed.data.packet) {
      packetResult = await requestPacketUpload({
        intakeKey: parsed.data.intakeKey,
        sku: parsed.data.sku,
        filename: parsed.data.packet.filename,
        byteSize: parsed.data.packet.byteSize,
        reportedUserEmail: parsed.data.reportedUserEmail,
      });
    }

    return {
      ok: true,
      data: {
        cad: cadResult,
        packet: packetResult,
      },
    };
  } catch (err: unknown) {
    return toIntakeFailure(err, "requestIntakeUploadsAction", {
      actorEmail: actorRes.actor.email,
    });
  }
}

const ConfirmCadInputSchema = z.object({
  uploadId: z.string().min(1),
  reportedUserEmail: z.string().email().optional(),
}).strict();

export async function confirmCadUploadAction(
  input: unknown
): Promise<ActionResult<ConfirmCadWrapperResult>> {
  const actorRes = await resolveIntakeActor({
    reportedEmail: (input as { reportedUserEmail?: string })?.reportedUserEmail,
  });
  if (!actorRes.ok) {
    return toIntakeFailure(new IntakeDomainError("NOT_SIGNED_IN"), "confirmCadUploadAction");
  }

  const parsed = ConfirmCadInputSchema.safeParse(input);
  if (!parsed.success) {
    return toIntakeFailure(new IntakeDomainError("VALIDATION"), "confirmCadUploadAction", {
      actorEmail: actorRes.actor.email,
    });
  }

  try {
    const res = await confirmCadUploadWrapper(parsed.data);
    return { ok: true, data: res };
  } catch (err: unknown) {
    return toIntakeFailure(err, "confirmCadUploadAction", {
      actorEmail: actorRes.actor.email,
    });
  }
}

const ConfirmPacketInputSchema = z.object({
  sku: z.string().min(1),
  storagePath: z.string().min(1),
  originalFilename: z.string().min(1),
  reportedUserEmail: z.string().email().optional(),
}).strict();

export async function confirmPacketUploadAction(
  input: unknown
): Promise<ActionResult<ConfirmPacketUploadResult>> {
  const actorRes = await resolveIntakeActor({
    reportedEmail: (input as { reportedUserEmail?: string })?.reportedUserEmail,
  });
  if (!actorRes.ok) {
    return toIntakeFailure(new IntakeDomainError("NOT_SIGNED_IN"), "confirmPacketUploadAction");
  }

  const parsed = ConfirmPacketInputSchema.safeParse(input);
  if (!parsed.success) {
    return toIntakeFailure(new IntakeDomainError("VALIDATION"), "confirmPacketUploadAction", {
      actorEmail: actorRes.actor.email,
    });
  }

  try {
    const res = await confirmPacketUpload(parsed.data);
    return { ok: true, data: res };
  } catch (err: unknown) {
    return toIntakeFailure(err, "confirmPacketUploadAction", {
      actorEmail: actorRes.actor.email,
    });
  }
}

const DownloadLinkInputSchema = z.object({
  sku: z.string().min(1),
  reportedUserEmail: z.string().email().optional(),
}).strict();

export async function getPacketDownloadLinkAction(
  input: unknown
): Promise<ActionResult<GetPacketDownloadLinkResult>> {
  const actorRes = await resolveIntakeActor({
    reportedEmail: (input as { reportedUserEmail?: string })?.reportedUserEmail,
  });
  if (!actorRes.ok) {
    return toIntakeFailure(new IntakeDomainError("NOT_SIGNED_IN"), "getPacketDownloadLinkAction");
  }

  const parsed = DownloadLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    return toIntakeFailure(new IntakeDomainError("VALIDATION"), "getPacketDownloadLinkAction", {
      actorEmail: actorRes.actor.email,
    });
  }

  try {
    const res = await getPacketDownloadLink(parsed.data);
    return { ok: true, data: res };
  } catch (err: unknown) {
    return toIntakeFailure(err, "getPacketDownloadLinkAction", {
      actorEmail: actorRes.actor.email,
    });
  }
}

export async function updateFinishesAction(
  input: unknown
): Promise<ActionResult<{ updated: boolean; finishesPending: boolean }>> {
  const actorRes = await resolveIntakeActor({
    reportedEmail: (input as { reportedUserEmail?: string })?.reportedUserEmail,
  });
  if (!actorRes.ok) {
    return toIntakeFailure(new IntakeDomainError("NOT_SIGNED_IN"), "updateFinishesAction");
  }

  const parsed = UpdateFinishesInputSchema.safeParse(input);
  if (!parsed.success) {
    return toIntakeFailure(new IntakeDomainError("VALIDATION"), "updateFinishesAction", {
      actorEmail: actorRes.actor.email,
    });
  }

  const finishesRes = await validateFinishSelection(parsed.data.finishes);
  if (!finishesRes.ok) {
    return toIntakeFailure(
      new IntakeDomainError("FINISHES_REQUIRED", undefined, {
        fieldErrors: finishesRes.fieldErrors,
      }),
      "updateFinishesAction",
      { actorEmail: actorRes.actor.email }
    );
  }

  const db = getDb();
  const sku = parsed.data.sku.trim().toUpperCase();

  try {
    const [mapping] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);

    if (!mapping) {
      return toIntakeFailure(
        new IntakeDomainError("VALIDATION", "Piece not found"),
        "updateFinishesAction",
        { actorEmail: actorRes.actor.email }
      );
    }

    const rawAttrs = mapping.attributes as Record<string, unknown> | null;
    const jobId =
      (rawAttrs?.job_id as string) || (rawAttrs?.intake as { jobId?: string })?.jobId;

    if (jobId) {
      const status = await loadProjectStatus(jobId);
      if (status.locked) {
        return toIntakeFailure(
          new IntakeDomainError("PROJECT_LOCKED"),
          "updateFinishesAction",
          { actorEmail: actorRes.actor.email }
        );
      }
    }

    const finishesPending =
      parsed.data.finishes.frame.kind === "tbd" ||
      parsed.data.finishes.powder.kind === "tbd" ||
      parsed.data.finishes.fabric.kind === "tbd";

    const currentAttrs = (mapping.attributes as Record<string, unknown>) || {};
    const currentIntake = (currentAttrs.intake as Record<string, unknown>) || {};

    const updatedAttrs = {
      ...currentAttrs,
      finishes: parsed.data.finishes,
      intake: {
        ...currentIntake,
        finishesPending,
        finishesUpdatedAt: new Date().toISOString(),
      },
    };

    const isEmbed = actorRes.actor.source !== "operator";
    const effectiveEmail = isEmbed ? GHL_EMBED_PRINCIPAL_EMAIL : actorRes.actor.email;
    const operatorName = isEmbed ? "Unverified Embed User" : null;

    await db
      .update(sku_mappings)
      .set({
        attributes: updatedAttrs,
        updated_by: effectiveEmail,
      })
      .where(eq(sku_mappings.global_sku, sku));

    await logPimAudit({
      operatorEmail: effectiveEmail,
      operatorName,
      globalSku: sku,
      action: "intake.finishes_updated",
      newValue: JSON.stringify({
        finishesPending,
        reportedEmail: isEmbed ? actorRes.actor.email : undefined,
        verified: !isEmbed,
      }),
    }).catch((err: unknown) => {
      console.error(JSON.stringify({
        tag: "pim-audit-error",
        where: "updateFinishesAction:logPimAudit",
        errorName: err instanceof Error ? err.name : "UnknownError",
      }));
    });

    return {
      ok: true,
      data: {
        updated: true,
        finishesPending,
      },
    };
  } catch (err: unknown) {
    return toIntakeFailure(err, "updateFinishesAction", {
      actorEmail: actorRes.actor.email,
    });
  }
}

const GetProgressInputSchema = z.object({
  sku: z.string().min(1),
  reportedUserEmail: z.string().email().optional(),
}).strict();

export async function getIntakeProgressAction(
  input: unknown
): Promise<
  ActionResult<{
    cadUpload: CadUploadRow | null;
    hasPacket: boolean;
    packetFilename?: string;
  }>
> {
  const actorRes = await resolveIntakeActor({
    reportedEmail: (input as { reportedUserEmail?: string })?.reportedUserEmail,
  });
  if (!actorRes.ok) {
    return toIntakeFailure(new IntakeDomainError("NOT_SIGNED_IN"), "getIntakeProgressAction");
  }

  const parsed = GetProgressInputSchema.safeParse(input);
  if (!parsed.success) {
    return toIntakeFailure(new IntakeDomainError("VALIDATION"), "getIntakeProgressAction", {
      actorEmail: actorRes.actor.email,
    });
  }

  const sku = parsed.data.sku.trim().toUpperCase();

  try {
    const cadUpload = await getLatestCadUploadWrapper(sku);

    const db = getDb();
    const [mapping] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);

    if (!mapping) {
      throw new IntakeDomainError("VALIDATION", "Piece not found");
    }

    const rawAttrs = mapping.attributes as Record<string, unknown> | null;
    const packet = (rawAttrs?.intake as { packet?: { filename?: string; path?: string } })?.packet;

    return {
      ok: true,
      data: {
        cadUpload,
        hasPacket: Boolean(packet?.path),
        packetFilename: packet?.filename,
      },
    };
  } catch (err: unknown) {
    return toIntakeFailure(err, "getIntakeProgressAction", {
      actorEmail: actorRes.actor.email,
    });
  }
}
