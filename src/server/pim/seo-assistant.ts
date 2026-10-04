import { z } from "zod";
import { SEO_LIMITS, SLUG_RE } from "@/lib/seo-limits";

export { SEO_LIMITS, SLUG_RE };

export const seoSuggestionSchema = z.object({
  seoTitle: z.string().trim().min(1).max(SEO_LIMITS.title),
  metaDescription: z.string().trim().min(1).max(SEO_LIMITS.description),
  slug: z.string().trim().min(1).max(SEO_LIMITS.slug).regex(SLUG_RE),
});
export type SeoSuggestion = z.infer<typeof seoSuggestionSchema>;

/**
 * The ONLY data the model sees. No cost, wholesale, vendor SKU, MSRP, CAD, or secrets.
 */
export type SeoPromptInput = {
  productName: string;
  collectionLabel: string;
  categoryLabel: string;
  origin: "manufactured" | "third_party";
  lengthIn: string | null;
  depthIn: string | null;
  heightIn: string | null;
  /** Marketing copy already stripped to plain text. */
  marketingCopy: string;
};

export const SEO_NOT_CONFIGURED = "SEO assistant is not configured.";
export const SEO_UNUSABLE = "The assistant returned an unusable suggestion. Try again.";

/**
 * Dimensions the operator flagged N/A (finished_goods_catalog.na_fields) are omitted
 * entirely: the model must never be told a dimension that doesn't apply to the product.
 */
export function dimensionsForPrompt(input: {
  length: string | null;
  depth: string | null;
  height: string | null;
  naFields: readonly string[] | null | undefined;
}): { lengthIn: string | null; depthIn: string | null; heightIn: string | null } {
  const na = new Set((input.naFields ?? []).map((f) => String(f).trim().toLowerCase()));
  const pick = (key: "length" | "depth" | "height", v: string | null) =>
    na.has(key) || !(v ?? "").trim() ? null : (v as string).trim();
  return {
    lengthIn: pick("length", input.length),
    depthIn: pick("depth", input.depth),
    heightIn: pick("height", input.height),
  };
}

type SeoEnv = { model: string; apiKey: string; baseUrl: string };

function readEnv(): SeoEnv | null {
  const model = process.env.SEO_ASSISTANT_MODEL?.trim();
  const apiKey = process.env.SEO_ASSISTANT_API_KEY?.trim();
  if (!model || !apiKey) return null;
  const baseUrl = (process.env.SEO_ASSISTANT_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  return { model, apiKey, baseUrl };
}

export function seoAssistantConfigured(): boolean {
  return readEnv() !== null;
}

const SYSTEM_PROMPT = [
  "You write search metadata for a luxury outdoor-furniture e-commerce catalog.",
  "Tone: specific, calm, editorial, confident. No hype, no exclamation marks, no keyword stuffing.",
  "Hard rules:",
  "- Never claim or imply a finish, color, fabric, price, discount, lead time, warranty, or availability. Those are order-time or commercial facts.",
  "- Only use facts present in the product data you are given. Do not invent materials or features.",
  `- seoTitle: at most ${SEO_LIMITS.title} characters. Name the collection and the product.`,
  `- metaDescription: at most ${SEO_LIMITS.description} characters. One or two refined sentences that read naturally.`,
  `- slug: at most ${SEO_LIMITS.slug} characters, lowercase words separated by single hyphens (a-z, 0-9 only). Readable words, never an internal SKU.`,
  "Respond with ONLY a JSON object with exactly these keys: seoTitle, metaDescription, slug.",
].join("\n");

function dim(label: string, v: string | null): string | null {
  const n = (v ?? "").trim();
  return n ? `${label}: ${n} in` : null;
}

export function buildSeoUserPrompt(input: SeoPromptInput): string {
  const dims = [dim("Length", input.lengthIn), dim("Depth", input.depthIn), dim("Height", input.heightIn)]
    .filter(Boolean)
    .join("; ");
  return [
    `Product name: ${input.productName}`,
    `Collection: ${input.collectionLabel}`,
    `Category: ${input.categoryLabel}`,
    `Origin: ${input.origin === "manufactured" ? "made by CC Patio" : "third-party"}`,
    dims ? `Display dimensions: ${dims}` : null,
    `Marketing copy:\n${input.marketingCopy}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Single adapter to the LLM (OpenAI-compatible chat completions; set
 * SEO_ASSISTANT_BASE_URL to point at another compatible provider).
 * Output is validated with Zod; anything else is discarded, never truncated.
 */
export async function requestSeoSuggestion(
  input: SeoPromptInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SeoSuggestion> {
  const env = readEnv();
  if (!env) throw new Error(SEO_NOT_CONFIGURED);

  let res: Response;
  try {
    res = await fetchImpl(`${env.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.apiKey}`,
      },
      body: JSON.stringify({
        model: env.model,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildSeoUserPrompt(input) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("The SEO assistant could not be reached. Try again.");
  }
  if (!res.ok) {
    // Never echo the provider body: it may contain request details.
    throw new Error(`The SEO assistant request failed (${res.status}). Try again.`);
  }

  let content: unknown;
  try {
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    content = json.choices?.[0]?.message?.content;
  } catch {
    throw new Error(SEO_UNUSABLE);
  }
  if (typeof content !== "string") throw new Error(SEO_UNUSABLE);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(SEO_UNUSABLE);
  }
  const result = seoSuggestionSchema.safeParse(parsed);
  if (!result.success) throw new Error(SEO_UNUSABLE);
  return result.data;
}
