import { z } from "zod";

const contactSchema = z.looseObject({
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
});

export const ghlFactoryOpportunitySchema = z.looseObject({
  id: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => value.length > 0 && value !== "unknown", {
      message: "Opportunity id is required",
    }),
  name: z.string().optional(),
  pipeline_stage_id: z.string().trim().min(1).optional(),
  stage_name: z.string().trim().min(1).optional(),
  contact: contactSchema.optional(),
  notes: z.string().optional(),
});

export type GhlFactoryOpportunity = z.infer<typeof ghlFactoryOpportunitySchema>;

export type GhlFactoryParseError = { path: string; message: string };

export type GhlFactoryParseResult =
  | { ok: true; data: GhlFactoryOpportunity }
  | { ok: false; errors: GhlFactoryParseError[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/**
 * Flatten GHL OpportunityStageUpdate envelopes into the factory schema.
 * Requires an opportunity id and at least one stage name or stage id.
 */
export function normalizeGhlFactoryPayload(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data);
  const opportunity =
    asRecord(root.opportunity) ??
    asRecord(data?.opportunity) ??
    data ??
    root;
  const custom = asRecord(opportunity.customData) ?? asRecord(root.customData) ?? {};
  const contact =
    asRecord(opportunity.contact) ??
    asRecord(root.contact) ??
    asRecord(data?.contact);

  const id =
    stringField(opportunity, ["id", "opportunityId", "opportunity_id"]) ??
    stringField(root, ["opportunityId", "opportunity_id", "id"]) ??
    stringField(data ?? {}, ["opportunityId", "opportunity_id", "id"]);

  const stageName = stringField(
    { ...custom, ...opportunity, ...root },
    [
      "pipeline_stage_name",
      "pipelineStageName",
      "stage_name",
      "stageName",
      "pipleline_stage",
      "pipeline_stage",
    ],
  );
  const stageId = stringField(
    { ...opportunity, ...root, ...(data ?? {}) },
    ["pipeline_stage_id", "pipelineStageId", "stage_id", "stageId"],
  );

  return {
    ...opportunity,
    id,
    name: stringField(opportunity, ["name", "opportunity_name", "opportunityName"]) ??
      stringField(root, ["name"]),
    pipeline_stage_id: stageId,
    stage_name: stageName,
    contact: contact ?? undefined,
    notes:
      stringField(opportunity, ["notes", "note", "description"]) ??
      stringField(custom, ["notes", "note"]),
  };
}

export type GhlOpportunityRelease = {
  opportunityId: string;
  status: "lost" | "abandoned";
};

/**
 * Lost and Abandoned can arrive without a pipeline stage. Read the same
 * envelope as the factory parser and return null for open, won, or a missing id.
 */
export function readGhlOpportunityRelease(payload: unknown): GhlOpportunityRelease | null {
  const normalized = normalizeGhlFactoryPayload(payload);
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data);
  const opportunity =
    asRecord(root.opportunity) ?? asRecord(data?.opportunity) ?? data ?? root;
  const status = (
    stringField(opportunity, ["status", "opportunity_status", "opportunityStatus"]) ??
    stringField(root, ["status", "opportunity_status", "opportunityStatus"]) ??
    stringField(data ?? {}, ["status", "opportunity_status", "opportunityStatus"]) ??
    ""
  ).toLowerCase();
  if (status !== "lost" && status !== "abandoned") return null;
  const opportunityId = typeof normalized.id === "string" ? normalized.id.trim() : "";
  if (!opportunityId || opportunityId === "unknown") return null;
  return { opportunityId, status };
}

export function parseGhlFactoryOpportunity(payload: unknown): GhlFactoryParseResult {
  const normalized = normalizeGhlFactoryPayload(payload);
  const hasStage =
    (typeof normalized.stage_name === "string" && normalized.stage_name.length > 0) ||
    (typeof normalized.pipeline_stage_id === "string" &&
      normalized.pipeline_stage_id.length > 0);
  if (!hasStage) {
    return {
      ok: false,
      errors: [
        {
          path: "stage",
          message: "Opportunity stage name or pipeline_stage_id is required",
        },
      ],
    };
  }

  const parsed = ghlFactoryOpportunitySchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    };
  }
  return { ok: true, data: parsed.data };
}

export function factoryContactName(data: GhlFactoryOpportunity): string | null {
  const contact = data.contact;
  const first = contact?.first_name?.trim() || contact?.firstName?.trim() || "";
  const last = contact?.last_name?.trim() || contact?.lastName?.trim() || "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (contact?.company?.trim()) return contact.company.trim();
  if (data.name?.trim()) return data.name.trim();
  return null;
}

export function factoryContactEmail(data: GhlFactoryOpportunity): string | null {
  const email = data.contact?.email?.trim();
  return email ? email : null;
}
