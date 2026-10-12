import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import {
  requestSeoSuggestion,
  type SeoPromptInput,
} from "@/server/pim/seo-assistant";

function optionalDimension(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSeoPrompt(data: unknown): SeoPromptInput {
  if (!data || typeof data !== "object") {
    throw new NonRetriableError("catalog/seo.suggest payload is missing");
  }
  const record = data as Record<string, unknown>;
  const productName = typeof record.productName === "string" ? record.productName.trim() : "";
  const collectionLabel = typeof record.collectionLabel === "string" ? record.collectionLabel.trim() : "";
  const categoryLabel = typeof record.categoryLabel === "string" ? record.categoryLabel.trim() : "";
  const marketingCopy = typeof record.marketingCopy === "string" ? record.marketingCopy.trim() : "";
  const origin =
    record.origin === "third_party" || record.origin === "manufactured" ? record.origin : null;
  if (!productName || !collectionLabel || !categoryLabel || !origin || !marketingCopy) {
    throw new NonRetriableError("catalog/seo.suggest payload is incomplete");
  }
  return {
    productName,
    collectionLabel,
    categoryLabel,
    origin,
    lengthIn: optionalDimension(record.lengthIn),
    depthIn: optionalDimension(record.depthIn),
    heightIn: optionalDimension(record.heightIn),
    marketingCopy,
  };
}

/**
 * Isolated from `publishApprovedProduct`. Not registered on `/api/inngest`.
 * Throttled so the OpenAI SEO assistant cannot ride the catalog publish saga.
 */
export const suggestProductSeo = inngest.createFunction(
  {
    id: "suggest-product-seo",
    name: "Suggest Product SEO",
    triggers: [{ event: "catalog/seo.suggest" }],
    throttle: { limit: 50, period: "1m" },
  },
  async ({ event, step }) => {
    const input = readSeoPrompt(event.data);
    return step.run("request-seo-suggestion", () => requestSeoSuggestion(input));
  },
);
