/**
 * Katana Metadata Bootstrap — foundational categories, stock zones, custom fields, tax rates.
 *
 * Dry-run default. Live writes require --confirm.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/bootstrap-katana-metadata.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/bootstrap-katana-metadata.ts --confirm
 *
 * API constraints (documented Katana public API, verified live):
 * - Item categories have no CRUD endpoint; they are free-text `category_name`
 *   values. Missing categories are seeded via a tiny archived placeholder material.
 * - Warehouse `/locations` is GET-only (POST → 404). Stock zones are created as
 *   `/bin_locations` under the primary warehouse (requires Warehouse app add-on).
 * - Custom field `entity_type` supports SalesOrder | SalesOrderRow | ProductionOperation
 *   only — there is no ManufacturingOrder entity type. MO-adjacent QC uses
 *   ProductionOperation when the add-on/feature flag allows; otherwise SalesOrder.
 */
import { loadEnvConfig } from "@next/env";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const SOURCE = "ccpatio-mdm-bootstrap";

const TARGET_CATEGORIES = [
  "Finished Goods",
  "Sub-Assemblies",
  "RM - Metal",
  "RM - Powder",
  "RM - Dekton",
  "RM - Hardware",
] as const;

const TARGET_ZONES = [
  "Raw Materials",
  "WIP",
  "Finished Goods",
  "Quarantine",
] as const;

const TARGET_TAX_RATES: ReadonlyArray<{ name: string; rate: number }> = [
  { name: "Phoenix Sales Tax", rate: 8.6 },
  { name: "Wholesale B2B", rate: 0 },
];

type FieldSpec = {
  label: string;
  field_type: "shortText" | "number" | "url";
  entity_type: "SalesOrder" | "ProductionOperation";
  description: string;
};

/** SO fields + ProductionOperation QC (closest public API to MO custom fields). */
const TARGET_CUSTOM_FIELDS: readonly FieldSpec[] = [
  {
    label: "GHL Opportunity ID",
    field_type: "shortText",
    entity_type: "SalesOrder",
    description: "GoHighLevel opportunity / deal id for order traceability.",
  },
  {
    label: "CAD Revision Number",
    field_type: "shortText",
    entity_type: "SalesOrder",
    description: "Approved CAD / drawing revision stamped on the sales order.",
  },
  {
    label: "QC Inspector",
    field_type: "shortText",
    entity_type: "SalesOrder",
    description: "QC inspector name (SO-level copy for fulfillment handoff).",
  },
  {
    label: "QC Inspector",
    field_type: "shortText",
    entity_type: "ProductionOperation",
    description:
      "QC inspector on production operations (MO shop-floor adjacent).",
  },
];

type OutcomeStatus =
  | "exists"
  | "created"
  | "would_create"
  | "unsupported"
  | "blocked"
  | "failed";

type Outcome = {
  section: string;
  name: string;
  status: OutcomeStatus;
  detail: string;
};

type Named = { id?: number | string; name?: string | null };
type LocationHit = Named & {
  is_primary?: boolean | null;
  sales_allowed?: boolean | null;
  manufacturing_allowed?: boolean | null;
  purchase_allowed?: boolean | null;
};
type TaxHit = { id: number; name?: string | null; rate?: number | null };
type BinHit = {
  id: number;
  bin_name?: string | null;
  location_id?: number | null;
};
type CustomFieldHit = {
  id: string;
  label?: string | null;
  entity_type?: string | null;
  field_type?: string | null;
  source?: string | null;
};
type ItemHit = { category_name?: string | null; is_archived?: boolean | null };

const outcomes: Outcome[] = [];

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function push(
  section: string,
  name: string,
  status: OutcomeStatus,
  detail: string,
): void {
  outcomes.push({ section, name, status, detail });
  const tag =
    status === "exists"
      ? "EXISTS"
      : status === "created"
        ? "CREATED"
        : status === "would_create"
          ? "WOULD CREATE"
          : status === "unsupported"
            ? "UNSUPPORTED"
            : status === "blocked"
              ? "BLOCKED"
              : "FAILED";
  console.log(`  [${tag}] ${section}: ${name} — ${detail}`);
}

async function paginateAll<T>(
  pathBase: string,
  pageSize = 100,
  maxPages = 80,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${pageSize}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    if (rows.length < pageSize) break;
    await delay(REQUEST_DELAY_MS);
  }
  return all;
}

async function collectCategoryNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const path of ["/products", "/materials"] as const) {
    const items = await paginateAll<ItemHit>(`${path}?include_deleted=false`);
    for (const item of items) {
      const c = (item.category_name ?? "").trim();
      if (c) names.add(c);
    }
  }
  return names;
}

function skuForCategory(category: string): string {
  const slug = category
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `ZZ-CAT-SEED-${slug}`;
}

async function ensureCategory(
  category: string,
  existing: Set<string>,
): Promise<void> {
  const hit = [...existing].find((c) => norm(c) === norm(category));
  if (hit) {
    push(
      "category",
      category,
      "exists",
      hit === category ? "already present" : `present as "${hit}"`,
    );
    return;
  }

  const sku = skuForCategory(category);
  if (!confirm) {
    push(
      "category",
      category,
      "would_create",
      `would seed via archived material sku=${sku}`,
    );
    return;
  }

  try {
    // Minimal material payload — sales/purchase price fields can 422 on create.
    const { data } = await katanaFetch<Record<string, unknown>>("/materials", {
      method: "POST",
      body: {
        name: `[MDM Category Seed] ${category}`,
        uom: "pcs",
        category_name: category,
        is_sellable: false,
        variants: [{ sku }],
      },
    });
    await delay(REQUEST_DELAY_MS);

    const materialId =
      (data as { id?: number })?.id ??
      (data as { data?: { id?: number } })?.data?.id;
    if (materialId != null) {
      try {
        await katanaFetch(`/materials/${materialId}`, {
          method: "PATCH",
          body: { is_archived: true },
        });
        await delay(REQUEST_DELAY_MS);
      } catch (archiveErr) {
        console.warn(
          `  warn: could not archive category seed material ${materialId}:`,
          archiveErr instanceof Error ? archiveErr.message : archiveErr,
        );
      }
    }

    existing.add(category);
    push(
      "category",
      category,
      "created",
      `seeded via material id=${materialId ?? "?"} sku=${sku} (archived)`,
    );
  } catch (e) {
    const detail =
      e instanceof KatanaApiError
        ? `${e.message}${e.details ? ` details=${JSON.stringify(e.details)}` : ""}`
        : e instanceof Error
          ? e.message
          : String(e);
    push("category", category, "failed", detail);
  }
}

async function resolvePrimaryLocation(
  locations: LocationHit[],
): Promise<LocationHit | null> {
  if (locations.length === 0) return null;
  return (
    locations.find((l) => l.is_primary === true) ??
    locations.find((l) => /manufactur|primary|main|factory/i.test(l.name ?? "")) ??
    locations[0] ??
    null
  );
}

async function listBinLocations(locationId: number): Promise<{
  bins: BinHit[];
  blocked: boolean;
  error?: string;
}> {
  try {
    const bins = await paginateAll<BinHit>(
      `/bin_locations?location_id=${locationId}`,
    );
    return { bins, blocked: false };
  } catch (e) {
    if (e instanceof KatanaApiError && (e.status === 403 || e.status === 404)) {
      return {
        bins: [],
        blocked: true,
        error: e.message,
      };
    }
    throw e;
  }
}

async function ensureStockZone(
  zoneName: string,
  primary: LocationHit,
  bins: BinHit[],
  binApiBlocked: boolean,
  binApiError?: string,
): Promise<void> {
  // Exact warehouse name match (unlikely for zone names, but check)
  // handled by caller for warehouse inventory — here we only do bins.

  if (binApiBlocked) {
    push(
      "location",
      zoneName,
      "blocked",
      `bin_locations API unavailable (${binApiError ?? "403/404"}). Enable Settings → Warehouse app, then re-run. Primary warehouse: ${primary.name} (id=${primary.id})`,
    );
    return;
  }

  const existing = bins.find((b) => norm(b.bin_name) === norm(zoneName));
  if (existing) {
    push(
      "location",
      zoneName,
      "exists",
      `bin id=${existing.id} under ${primary.name}`,
    );
    return;
  }

  if (!confirm) {
    push(
      "location",
      zoneName,
      "would_create",
      `would POST /bin_locations bin_name="${zoneName}" location_id=${primary.id}`,
    );
    return;
  }

  try {
    const { data } = await katanaFetch<BinHit>("/bin_locations", {
      method: "POST",
      body: {
        bin_name: zoneName,
        location_id: primary.id,
      },
    });
    await delay(REQUEST_DELAY_MS);
    const id = data?.id ?? (data as { data?: BinHit })?.data?.id;
    bins.push({
      id: Number(id ?? 0),
      bin_name: zoneName,
      location_id: primary.id as number,
    });
    push(
      "location",
      zoneName,
      "created",
      `bin id=${id ?? "?"} under ${primary.name} (id=${primary.id})`,
    );
  } catch (e) {
    if (e instanceof KatanaApiError && e.status === 403) {
      push(
        "location",
        zoneName,
        "blocked",
        "POST /bin_locations → 403. Activate Settings → Warehouse app, then re-run.",
      );
      return;
    }
    push(
      "location",
      zoneName,
      "failed",
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function ensureTaxRate(
  target: { name: string; rate: number },
  existing: TaxHit[],
): Promise<void> {
  const byName = existing.find((t) => norm(t.name) === norm(target.name));
  if (byName) {
    push(
      "tax_rate",
      target.name,
      "exists",
      `id=${byName.id} rate=${byName.rate ?? "null"}`,
    );
    return;
  }

  const sameRate = existing.filter(
    (t) => t.rate != null && Number(t.rate) === target.rate,
  );
  const aliasNote =
    sameRate.length > 0
      ? ` (note: rate ${target.rate}% already exists as ${sameRate
          .map((t) => `"${t.name}"#${t.id}`)
          .join(", ")})`
      : "";

  if (!confirm) {
    push(
      "tax_rate",
      target.name,
      "would_create",
      `would POST /tax_rates name="${target.name}" rate=${target.rate}${aliasNote}`,
    );
    return;
  }

  try {
    const { data } = await katanaFetch<TaxHit>("/tax_rates", {
      method: "POST",
      body: { name: target.name, rate: target.rate },
    });
    await delay(REQUEST_DELAY_MS);
    const id = data?.id;
    existing.push({ id: Number(id), name: target.name, rate: target.rate });
    push(
      "tax_rate",
      target.name,
      "created",
      `id=${id ?? "?"} rate=${target.rate}${aliasNote}`,
    );
  } catch (e) {
    push(
      "tax_rate",
      target.name,
      "failed",
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function ensureCustomField(
  spec: FieldSpec,
  existing: CustomFieldHit[],
): Promise<void> {
  const hit = existing.find(
    (f) =>
      norm(f.label) === norm(spec.label) &&
      norm(f.entity_type) === norm(spec.entity_type),
  );
  if (hit) {
    push(
      "custom_field",
      `${spec.label} (${spec.entity_type})`,
      "exists",
      `id=${hit.id}`,
    );
    return;
  }

  if (!confirm) {
    push(
      "custom_field",
      `${spec.label} (${spec.entity_type})`,
      "would_create",
      `would POST /custom_field_definitions field_type=${spec.field_type}`,
    );
    return;
  }

  try {
    const { data } = await katanaFetch<CustomFieldHit>(
      "/custom_field_definitions",
      {
        method: "POST",
        body: {
          label: spec.label,
          field_type: spec.field_type,
          entity_type: spec.entity_type,
          source: SOURCE,
          description: spec.description,
        },
      },
    );
    await delay(REQUEST_DELAY_MS);
    const id = data?.id ?? "?";
    existing.push({
      id: String(id),
      label: spec.label,
      entity_type: spec.entity_type,
      field_type: spec.field_type,
      source: SOURCE,
    });
    push(
      "custom_field",
      `${spec.label} (${spec.entity_type})`,
      "created",
      `id=${id}`,
    );
  } catch (e) {
    if (
      e instanceof KatanaApiError &&
      (e.status === 403 || e.status === 422) &&
      spec.entity_type === "ProductionOperation"
    ) {
      push(
        "custom_field",
        `${spec.label} (${spec.entity_type})`,
        "blocked",
        `ProductionOperation fields require Advanced Manufacturing / feature flag. ${e.message}`,
      );
      return;
    }
    push(
      "custom_field",
      `${spec.label} (${spec.entity_type})`,
      "failed",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function printSummary(): void {
  const count = (status: OutcomeStatus) =>
    outcomes.filter((o) => o.status === status).length;

  console.log("");
  console.log("========================================");
  console.log("  KATANA METADATA BOOTSTRAP SUMMARY");
  console.log("========================================");
  console.log(`  Mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  Exists:       ${count("exists")}`);
  console.log(`  Created:      ${count("created")}`);
  console.log(`  Would create: ${count("would_create")}`);
  console.log(`  Blocked:      ${count("blocked")}`);
  console.log(`  Unsupported:  ${count("unsupported")}`);
  console.log(`  Failed:       ${count("failed")}`);
  console.log("----------------------------------------");

  for (const section of [
    "category",
    "location",
    "custom_field",
    "tax_rate",
  ] as const) {
    const rows = outcomes.filter((o) => o.section === section);
    if (rows.length === 0) continue;
    console.log(`  ${section.toUpperCase()}`);
    for (const r of rows) {
      console.log(`    · [${r.status}] ${r.name}`);
    }
  }

  console.log("========================================");
  console.log("  NOTES");
  console.log(
    "  · Categories: no public CRUD — seeded as archived placeholder materials.",
  );
  console.log(
    "  · Warehouse POST /locations is not available (404). Zones use bin_locations.",
  );
  console.log(
    "  · Custom fields: SalesOrder + ProductionOperation only (no ManufacturingOrder type).",
  );
  console.log(
    "  · Tax: existing AZ 8.6% / Out of State 0% may already cover Phoenix / B2B rates.",
  );
  console.log("========================================");
}

async function main(): Promise<void> {
  console.log("Katana Metadata Bootstrap");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN (pass --confirm to write)"}`);
  console.log("");

  // --- Categories ---
  console.log("→ Categories");
  const categoryNames = await collectCategoryNames();
  console.log(`  discovered ${categoryNames.size} existing category_name values`);
  for (const cat of TARGET_CATEGORIES) {
    await ensureCategory(cat, categoryNames);
  }

  // --- Locations / stock zones ---
  console.log("");
  console.log("→ Inventory locations / stock zones");
  const locations = await paginateAll<LocationHit>("/locations");
  console.log(
    `  warehouses: ${locations.map((l) => `${l.name}#${l.id}${l.is_primary ? "*" : ""}`).join(", ") || "(none)"}`,
  );
  push(
    "location",
    "POST /locations",
    "unsupported",
    "Katana public API has no create-location endpoint (POST → 404). Warehouses must be created in Settings → Locations if needed.",
  );

  const primary = await resolvePrimaryLocation(locations);
  if (!primary?.id) {
    push(
      "location",
      "(primary warehouse)",
      "failed",
      "No warehouse found — create one in Katana UI first.",
    );
  } else {
    const binResult = await listBinLocations(Number(primary.id));
    if (binResult.blocked) {
      console.log(
        `  bin_locations blocked under ${primary.name}: ${binResult.error}`,
      );
    } else {
      console.log(
        `  existing bins under ${primary.name}: ${
          binResult.bins.map((b) => b.bin_name).join(", ") || "(none)"
        }`,
      );
    }
    for (const zone of TARGET_ZONES) {
      await ensureStockZone(
        zone,
        primary,
        binResult.bins,
        binResult.blocked,
        binResult.error,
      );
    }
  }

  // --- Custom fields ---
  console.log("");
  console.log("→ Custom fields (SO / ProductionOperation)");
  const fields = await paginateAll<CustomFieldHit>("/custom_field_definitions");
  console.log(`  existing definitions: ${fields.length}`);
  for (const spec of TARGET_CUSTOM_FIELDS) {
    await ensureCustomField(spec, fields);
  }

  // --- Tax rates ---
  console.log("");
  console.log("→ Tax rates");
  const taxes = await paginateAll<TaxHit>("/tax_rates");
  console.log(
    `  existing: ${
      taxes.map((t) => `${t.name}=${t.rate ?? "null"}#${t.id}`).join(", ") ||
      "(none)"
    }`,
  );
  for (const tax of TARGET_TAX_RATES) {
    await ensureTaxRate(tax, taxes);
  }

  printSummary();

  if (outcomes.some((o) => o.status === "failed")) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
