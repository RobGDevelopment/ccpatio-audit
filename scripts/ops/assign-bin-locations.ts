/**
 * Bin-location workaround: item-level "Bin Location" text on Katana materials.
 *
 * Item custom fields on this tenant are Legacy Collections, not
 * /custom_field_definitions (that POST is tier-blocked).
 *
 * Live shape (verified):
 * - GET /custom_fields_collections returns
 *   { id, name, custom_fields: [{ id, name, collection_id }] }.
 * - A variant custom_fields map keyed by the collection field id is 422
 *   (additionalProperties). The accepted variant body is
 *   { custom_fields: [{ field_name, field_value }] }.
 * - That array 422s with "No custom fields collection assigned to item"
 *   until the material has custom_field_collection_id set to the Inventory
 *   collection. Assign that first, then PATCH the variant.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/assign-bin-locations.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/assign-bin-locations.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import {
  KatanaApiError,
  createIntervalPacer,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { unwrapList } from "./lib/csv";
import { paginateKatana } from "./lib/katana-paginate";

loadEnvConfig(process.cwd());

const COLLECTION_NAME = "Inventory";
const FIELD_LABEL = "Bin Location";

const ASSIGNMENTS = [
  { category: "Metal", bin: "Metal Rack 1" },
  { category: "Fabric", bin: "Fabric Shelf A" },
] as const;

type Assignment = (typeof ASSIGNMENTS)[number];

type CollectionField = {
  id?: number | string | null;
  name?: string | null;
  collection_id?: number | string | null;
};

type Collection = {
  id?: number | string | null;
  name?: string | null;
  deleted_at?: string | null;
  custom_fields?: CollectionField[] | null;
};

type ResolvedField = {
  collectionId: number;
  fieldId: number;
  fieldName: string;
};

type LegacyField = {
  field_name: string;
  field_value: string;
};

type MaterialVariant = {
  id?: number;
  sku?: string | null;
  type?: string | null;
  deleted_at?: string | null;
  custom_fields?: unknown;
};

type MaterialRow = {
  id?: number;
  name?: string | null;
  category_name?: string | null;
  type?: string | null;
  deleted_at?: string | null;
  archived_at?: string | null;
  custom_field_collection_id?: number | string | null;
  variants?: MaterialVariant[] | null;
};

type PlannedUpdate = {
  category: Assignment["category"];
  bin: string;
  materialId: number;
  variantId: number;
  sku: string;
  archived: boolean;
  payload: { custom_fields: LegacyField[] };
  action: "would_update" | "unchanged";
};

type PlannedCollection = {
  category: Assignment["category"];
  materialId: number;
  currentCollectionId: number | null;
  action: "assign" | "already_assigned";
};

const dryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm");

function assignmentFor(categoryName: string | null | undefined): Assignment | null {
  const category = (categoryName ?? "").trim().toLowerCase();
  return ASSIGNMENTS.find((row) => row.category.toLowerCase() === category) ?? null;
}

function isDeleted(value: string | null | undefined): boolean {
  return value != null && String(value).trim() !== "";
}

function positiveId(value: number | string | null | undefined, label: string): number {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`${label} is missing an id.`);
  }
  return id;
}

function readLegacyFields(value: unknown): LegacyField[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const fields: LegacyField[] = [];
    for (const item of value) {
      if (item == null || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const fieldName = String(record.field_name ?? record.name ?? "").trim();
      if (!fieldName) continue;
      const raw = record.field_value ?? record.value;
      fields.push({
        field_name: fieldName,
        field_value: raw == null ? "" : String(raw),
      });
    }
    return fields;
  }
  if (typeof value === "object" && Object.keys(value as object).length > 0) {
    throw new Error(
      "Variant stores custom_fields as an object map. Refusing to replace it with the Inventory collection array.",
    );
  }
  return [];
}

function sameFields(left: LegacyField[], right: LegacyField[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Map(left.map((field) => [field.field_name.toLowerCase(), field.field_value]));
  return right.every((field) => values.get(field.field_name.toLowerCase()) === field.field_value);
}

function collectionIdOf(material: MaterialRow): number | null {
  const raw = material.custom_field_collection_id;
  if (raw == null || String(raw).trim() === "") return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function resolveInventoryField(): Promise<ResolvedField> {
  const { data } = await katanaFetch("/custom_fields_collections");
  const rows = unwrapList<Collection>(data);
  const collection =
    rows.find(
      (row) =>
        !isDeleted(row.deleted_at) &&
        String(row.name ?? "").trim().toLowerCase() === COLLECTION_NAME.toLowerCase(),
    ) ?? null;
  if (!collection) {
    throw new Error(
      `GET /custom_fields_collections has no collection named "${COLLECTION_NAME}". No variant updates were sent.`,
    );
  }

  const collectionId = positiveId(collection.id, `Collection "${COLLECTION_NAME}"`);
  const fields = Array.isArray(collection.custom_fields) ? collection.custom_fields : [];
  const field =
    fields.find(
      (row) => String(row.name ?? "").trim().toLowerCase() === FIELD_LABEL.toLowerCase(),
    ) ?? null;
  if (!field) {
    const names = fields.map((row) => String(row.name ?? "").trim()).filter(Boolean);
    throw new Error(
      `Collection "${COLLECTION_NAME}" (${collectionId}) has no field named "${FIELD_LABEL}". Fields: ${names.join(", ") || "(none)"}. No variant updates were sent.`,
    );
  }

  const fieldId = positiveId(field.id, `Field "${FIELD_LABEL}"`);
  const fieldName = String(field.name ?? FIELD_LABEL).trim();
  console.log(
    `  collection "${COLLECTION_NAME}" id=${collectionId}  field "${fieldName}" id=${fieldId}`,
  );
  return { collectionId, fieldId, fieldName };
}

function planVariant(
  material: MaterialRow,
  variant: MaterialVariant,
  assignment: Assignment,
  field: ResolvedField,
): PlannedUpdate {
  const variantId = Number(variant.id);
  const materialId = Number(material.id);
  if (!Number.isFinite(variantId) || variantId <= 0) {
    throw new Error(`Material ${materialId} has a variant without an id.`);
  }
  const current = readLegacyFields(variant.custom_fields);
  const others = current.filter(
    (row) => row.field_name.toLowerCase() !== field.fieldName.toLowerCase(),
  );
  const customFields = [
    ...others,
    { field_name: field.fieldName, field_value: assignment.bin },
  ];
  return {
    category: assignment.category,
    bin: assignment.bin,
    materialId,
    variantId,
    sku: String(variant.sku ?? "").trim(),
    archived: isDeleted(material.archived_at),
    payload: { custom_fields: customFields },
    action: sameFields(current, customFields) ? "unchanged" : "would_update",
  };
}

function printPlan(plan: PlannedUpdate, fieldId: number): void {
  const verb = plan.action === "unchanged" ? "unchanged" : "PATCH";
  console.log(
    `  ${verb} /variants/${plan.variantId}  sku=${plan.sku || "(blank)"}  category=${plan.category}  material=${plan.materialId}  field=${fieldId}${plan.archived ? "  archived" : ""}`,
  );
  console.log(`    ${JSON.stringify(plan.payload)}`);
}

function formatKatanaFailure(error: unknown): string {
  return error instanceof KatanaApiError
    ? `HTTP ${error.status} ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
}

async function main(): Promise<void> {
  if (dryRun === confirm) {
    throw new Error("Pass exactly one of --dry-run or --confirm.");
  }

  console.log("Katana bin location custom fields");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  collection: GET /custom_fields_collections "${COLLECTION_NAME}"`);
  console.log(`  field: "${FIELD_LABEL}"`);
  console.log("  verb: PATCH /materials/{id} then PATCH /variants/{id}");
  for (const row of ASSIGNMENTS) {
    console.log(`  ${row.category} → ${row.bin}`);
  }
  console.log("");

  setKatanaRequestPacer(createIntervalPacer(1300));

  console.log("→ Legacy collection");
  const field = await resolveInventoryField();

  console.log("→ Fetching /materials");
  const materials = await paginateKatana(
    "/materials?include_deleted=false",
    "materials",
  );

  const plans: PlannedUpdate[] = [];
  const collections: PlannedCollection[] = [];
  const seenMaterials = new Set<number>();

  for (const raw of materials) {
    const material = raw as MaterialRow;
    if (isDeleted(material.deleted_at)) continue;
    if (String(material.type ?? "material") !== "material") continue;
    const assignment = assignmentFor(material.category_name);
    if (!assignment) continue;

    const materialId = Number(material.id);
    if (!Number.isFinite(materialId) || materialId <= 0) {
      throw new Error("A Metal/Fabric material is missing an id.");
    }
    const currentCollectionId = collectionIdOf(material);
    if (currentCollectionId != null && currentCollectionId !== field.collectionId) {
      throw new Error(
        `Material ${materialId} is assigned to custom field collection ${currentCollectionId}, not "${COLLECTION_NAME}" (${field.collectionId}). Refusing to replace it. No variant updates were sent.`,
      );
    }
    if (!seenMaterials.has(materialId)) {
      seenMaterials.add(materialId);
      collections.push({
        category: assignment.category,
        materialId,
        currentCollectionId,
        action: currentCollectionId === field.collectionId ? "already_assigned" : "assign",
      });
    }

    const variants = Array.isArray(material.variants) ? material.variants : [];
    for (const variant of variants) {
      if (isDeleted(variant.deleted_at)) continue;
      if (variant.type != null && variant.type !== "material") continue;
      plans.push(planVariant(material, variant, assignment, field));
    }
  }

  plans.sort((a, b) =>
    a.category === b.category
      ? a.sku.localeCompare(b.sku) || a.variantId - b.variantId
      : a.category.localeCompare(b.category),
  );
  collections.sort((a, b) => a.materialId - b.materialId);

  console.log("");
  console.log("→ Collection assignment");
  for (const row of collections) {
    const verb = row.action === "already_assigned" ? "already assigned" : "PATCH";
    console.log(
      `  ${verb} /materials/${row.materialId}  category=${row.category}  custom_field_collection_id=${field.collectionId}`,
    );
  }

  console.log("");
  console.log(`→ Variant payloads (field id=${field.fieldId})`);
  for (const plan of plans) printPlan(plan, field.fieldId);

  const counts = ASSIGNMENTS.map((row) => {
    const variantRows = plans.filter((plan) => plan.category === row.category);
    const materialRows = collections.filter((plan) => plan.category === row.category);
    return {
      category: row.category,
      bin: row.bin,
      total: variantRows.length,
      pending: variantRows.filter((plan) => plan.action === "would_update").length,
      unchanged: variantRows.filter((plan) => plan.action === "unchanged").length,
      assign: materialRows.filter((plan) => plan.action === "assign").length,
      assigned: materialRows.filter((plan) => plan.action === "already_assigned").length,
    };
  });

  console.log("");
  console.log("========================================");
  console.log(
    confirm ? "  BIN LOCATION ASSIGNMENT (LIVE)" : "  BIN LOCATION ASSIGNMENT (DRY-RUN)",
  );
  console.log("========================================");
  for (const row of counts) {
    console.log(
      `  ${row.category}: ${row.total} variants → "${row.bin}"  pending=${row.pending} unchanged=${row.unchanged}  collections assign=${row.assign} already=${row.assigned}`,
    );
  }

  const missing = counts.filter((row) => row.total === 0).map((row) => row.category);
  if (missing.length > 0) {
    throw new Error(
      `No material variants found for category: ${missing.join(", ")}.`,
    );
  }

  if (!confirm) {
    console.log("  writes: 0");
    console.log("========================================");
    return;
  }

  let collectionsAssigned = 0;
  for (const row of collections) {
    if (row.action === "already_assigned") continue;
    try {
      await katanaFetch(`/materials/${row.materialId}`, {
        method: "PATCH",
        body: { custom_field_collection_id: field.collectionId },
      });
    } catch (error) {
      throw new Error(
        `PATCH /materials/${row.materialId} custom_field_collection_id=${field.collectionId} failed after ${collectionsAssigned} collection assignments: ${formatKatanaFailure(error)}`,
      );
    }
    collectionsAssigned += 1;
    console.log(
      `  assigned /materials/${row.materialId} collection=${field.collectionId} (${COLLECTION_NAME})`,
    );
  }

  let updated = 0;
  let skipped = 0;
  for (const plan of plans) {
    if (plan.action === "unchanged") {
      skipped += 1;
      continue;
    }
    try {
      await katanaFetch(`/variants/${plan.variantId}`, {
        method: "PATCH",
        body: plan.payload,
      });
    } catch (error) {
      throw new Error(
        `PATCH /variants/${plan.variantId} sku=${plan.sku || "(blank)"} field=${field.fieldId} failed after ${updated} updates: ${formatKatanaFailure(error)}`,
      );
    }
    updated += 1;
    console.log(
      `  updated /variants/${plan.variantId} sku=${plan.sku || "(blank)"} field=${field.fieldId} ${FIELD_LABEL}=${plan.bin}`,
    );
  }

  console.log("----------------------------------------");
  console.log(`  collections assigned: ${collectionsAssigned}`);
  console.log(`  updated: ${updated}`);
  console.log(`  unchanged: ${skipped}`);
  console.log("  failed: 0");
  console.log("========================================");
  console.log("BIN LOCATION ASSIGNMENT COMPLETE");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
