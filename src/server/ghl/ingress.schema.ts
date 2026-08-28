import { z } from "zod";

const ghlContactSchema = z.looseObject({
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  address_1: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

const ghlLineItemSchema = z.looseObject({
  sku: z.string().trim().min(1),
  quantity: z.number().positive(),
  price_per_unit: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
});

export const ghlOpportunityWonSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional(),
  pipeline_id: z.string().optional(),
  pipeline_stage_id: z.string().optional(),
  status: z.string().optional(),
  contact_id: z.string().optional(),
  monetary_value: z.union([z.string(), z.number()]).optional(),
  source: z.string().optional(),
  contact: ghlContactSchema.optional(),
  line_items: z.array(ghlLineItemSchema).optional(),
});

export type GhlOpportunityWon = z.infer<typeof ghlOpportunityWonSchema>;

export type GhlOpportunityParseResult =
  | { ok: true; data: GhlOpportunityWon; contactName: string; opportunityValue: number | null }
  | { ok: false; error: string };

function contactDisplayName(contact: GhlOpportunityWon["contact"], fallback?: string): string {
  const first = contact?.first_name?.trim() ?? "";
  const last = contact?.last_name?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (fallback?.trim()) return fallback.trim();
  if (contact?.company?.trim()) return contact.company.trim();
  if (contact?.email?.trim()) return contact.email.trim();
  return "Unknown contact";
}

function parseOpportunityValue(value: GhlOpportunityWon["monetary_value"]): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

export function parseGhlOpportunityWon(payload: unknown): GhlOpportunityParseResult {
  const parsed = ghlOpportunityWonSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  const data = parsed.data;
  if (!data.id.trim()) {
    return { ok: false, error: "Opportunity id is required." };
  }

  return {
    ok: true,
    data,
    contactName: contactDisplayName(data.contact, data.name),
    opportunityValue: parseOpportunityValue(data.monetary_value),
  };
}

/** @deprecated Alias for Katana mappers — same shape as opportunity won payload. */
export const ghlOpportunitySyncSchema = ghlOpportunityWonSchema;
export type GhlOpportunitySync = GhlOpportunityWon;
