import { getDb } from "@/server/db/client";
import { sku_mappings, ecommerce_listings, nomenclature_collections, nomenclature_categories } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";

export type SkuPreviewResult = {
  sku: string;
  isCollision: boolean;
  isSaved: boolean;
  existingProductName?: string;
  categoryLabel?: string;
  collectionLabel?: string;
};

const RESERVED_CODES = new Set(["FIN", "FAB", "MIS", "RM", "PWD", "3P"]);

function stripDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function formatSize(length: string, depth: string): string {
  if (length && depth) {
    return `${length}X${depth}`;
  }
  if (length) {
    return length;
  }
  if (depth) {
    return depth;
  }
  return "";
}

/**
 * Zero-trust label check: the submitted label must EXACTLY equal the dictionary
 * row's primary label or one of its aliases. Returns the validated submitted label.
 */
function validateSubmittedLabel(
  kind: "Collection" | "Category",
  row: { code: string; label: string; aliases: string[] | null },
  submitted: string | undefined | null,
): string {
  if (typeof submitted !== "string" || submitted.length === 0) {
    throw new Error(`${kind} label is required for code ${row.code}`);
  }
  const allowed = [row.label, ...(row.aliases ?? [])];
  if (!allowed.includes(submitted)) {
    throw new Error(`${kind} label "${submitted}" does not match code ${row.code}`);
  }
  return submitted;
}

export async function previewSku(
  name: string,
  collectionLabel: string, // operator-selected label (primary label OR alias) for collectionCode
  categoryCode: string,
  length: string,
  depth: string,
  existingGlobalSku?: string | null,
  origin: "manufactured" | "third_party" = "manufactured",
  token?: string,
  collectionCode?: string,
  categoryLabel?: string // operator-selected label (primary label OR alias) for categoryCode
): Promise<SkuPreviewResult> {
  if (existingGlobalSku) {
    return {
      sku: existingGlobalSku,
      isCollision: false,
      isSaved: true,
    };
  }

  if (!collectionCode) {
    throw new Error("Missing explicit collection code");
  }

  if (RESERVED_CODES.has(collectionCode.toUpperCase()) || RESERVED_CODES.has(categoryCode.toUpperCase())) {
    throw new Error("Cannot use reserved code");
  }

  const db = getDb();

  // Validate from DB
  const [dbCol] = await db.select().from(nomenclature_collections).where(and(eq(nomenclature_collections.code, collectionCode), eq(nomenclature_collections.is_active, true)));
  const [dbCat] = await db.select().from(nomenclature_categories).where(and(eq(nomenclature_categories.code, categoryCode), eq(nomenclature_categories.is_active, true)));

  if (!dbCol) throw new Error(`Collection code ${collectionCode} is invalid or inactive`);
  if (!dbCat) throw new Error(`Category code ${categoryCode} is invalid or inactive`);

  const validatedCollectionLabel = validateSubmittedLabel("Collection", dbCol, collectionLabel);
  const validatedCategoryLabel = validateSubmittedLabel("Category", dbCat, categoryLabel);

  let generatedSku = "";
  if (origin === "third_party") {
    const safeToken = (token || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!safeToken) throw new Error("Missing token for 3rd party product");
    generatedSku = `3P-${dbCol.code}-${dbCat.code}-${safeToken}`;
  } else {
    // manufactured
    let len = stripDigits(length);
    let dep = stripDigits(depth);
    if (!len || !dep) {
      // try to extract from name
      const tokens = name.match(/\b\d{2,3}\b/g) ?? [];
      if (!len && tokens[0]) len = tokens[0];
      if (!dep) {
        const second = tokens.find((t, index) => index > 0 && t !== len);
        if (second) dep = second;
      }
    }
    const size = formatSize(len, dep);
    if (size) {
      generatedSku = `FIN-${dbCol.code}-${dbCat.code}-${size}`;
    } else {
      generatedSku = `FIN-${dbCol.code}-${dbCat.code}`;
    }
  }

  // Check collision
  const [existingMapping] = await db
    .select({ global_sku: sku_mappings.global_sku, original_name: sku_mappings.original_name })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, generatedSku));

  if (existingMapping) {
    const [listing] = await db
      .select({ product_name: ecommerce_listings.product_name })
      .from(ecommerce_listings)
      .where(eq(ecommerce_listings.global_sku, generatedSku));
    
    return {
      sku: generatedSku,
      isCollision: true,
      isSaved: false,
      existingProductName: listing?.product_name ?? existingMapping.original_name,
      categoryLabel: validatedCategoryLabel,
      collectionLabel: validatedCollectionLabel,
    };
  }

  return {
    sku: generatedSku,
    isCollision: false,
    isSaved: false,
    categoryLabel: validatedCategoryLabel,
    collectionLabel: validatedCollectionLabel,
  };
}
