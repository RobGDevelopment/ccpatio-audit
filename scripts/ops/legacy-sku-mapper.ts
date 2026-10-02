/**
 * Legacy SKU reconciliation — DRY-RUN ONLY.
 *
 * Compares protected Katana factory SKUs (BRA-*, OCE-*, BRO-*, DBT-*, OCN-*)
 * against Hub Global E2E SKUs (FIN-*, SA-*, RM-*) and proposes a mapping CSV.
 *
 * Does NOT write to Katana or Postgres. Architect reviews
 * tmp/legacy-sku-mapping-proposal.csv before any alias backfill.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/ops/legacy-sku-mapper.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/legacy-sku-mapper.ts --local
 *
 * --local  Use docs/katana_live_state/{products,variants}.json (no live API).
 * Env: KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY) when not --local;
 *      POSTGRES_URL for Hub sku_mappings / sku_aliases / finished_goods_catalog.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, like, or } from "drizzle-orm";
import {
  COLLECTIONS,
  directionOfStem,
  normalizeVariantSku,
  stripVariantSuffix,
  type CollectionConfig,
  type CollectionKey,
  type KatanaProductLike,
} from "../../src/lib/collection-catalog";
import {
  FG_BY_MODEL_CODE,
  matchFinishedGoodSku,
  normalizeProductName,
  type FinishedGoodCandidate,
} from "../../src/lib/collection-fg-match";
import { generateFinishedGoodSku } from "../../src/lib/sku-engine";
import { katanaFetch } from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  finished_goods_catalog,
  sku_aliases,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const useLocal = process.argv.includes("--local");
const REQUEST_DELAY_MS = 1100;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LEGACY_PREFIXES = ["BRA-", "OCE-", "OCN-", "BRO-", "DBT-"] as const;

const PREFIX_TO_COLLECTION: Record<
  string,
  CollectionKey | "daybed" | "daisy"
> = {
  BRA: "bravada",
  OCE: "ocean",
  OCN: "ocean",
  BRO: "brooklyn",
  /** Live Katana DBT-* rows are Daisy Base Tables (not daybeds). */
  DBT: "daisy",
};

type MatchStatus = "Exact Duplicate" | "Needs Migration";

type ProposalRow = {
  legacySku: string;
  itemName: string;
  matchStatus: MatchStatus;
  proposedCanonicalHubSku: string;
  katanaVariantId: number;
  matchReason: string;
  modelStem: string;
  collection: string;
};

type KatanaVariant = {
  id: number;
  sku: string | null;
  product_id: number | null;
  deleted_at?: string | null;
  type?: string | null;
};

type HubRow = {
  globalSku: string;
  originalName: string;
  itemType: string;
  length: string | null;
  depth: string | null;
};

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isLegacySku(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return LEGACY_PREFIXES.some((p) => s.startsWith(p));
}

function collectionForSku(
  sku: string,
  itemName?: string,
): {
  key: CollectionKey | "daybed" | "daisy";
  config: CollectionConfig | null;
  label: string;
} {
  const prefix = sku.trim().toUpperCase().split("-")[0] ?? "";
  const key = PREFIX_TO_COLLECTION[prefix] ?? "bravada";
  const name = (itemName ?? "").toUpperCase();

  if (key === "daisy" || /\bDAISY\b/.test(name)) {
    return { key: "daisy", config: null, label: "Daisy" };
  }
  if (key === "daybed") {
    return { key, config: COLLECTIONS.bravada, label: "Bravada" };
  }
  const config = COLLECTIONS[key as CollectionKey];
  return { key, config, label: config.label };
}

function dimsFromSku(sku: string): { length: string; depth: string } {
  const upper = sku.toUpperCase();
  const pair = upper.match(/(\d{2,3})X(\d{2,3})/);
  if (pair) return { length: pair[1]!, depth: pair[2]! };
  const single = upper.match(/(?:^|-)(\d{2,3})(?:-|$)/);
  if (single) return { length: single[1]!, depth: "" };
  return { length: "", depth: "" };
}

function proposeCanonicalSku(input: {
  legacySku: string;
  itemName: string;
  collectionLabel: string;
}): string {
  const stem = stripVariantSuffix(input.legacySku);
  const mapped = FG_BY_MODEL_CODE[stem];
  if (mapped) return mapped;

  const direction = directionOfStem(stem);
  const dims = dimsFromSku(stem);
  const base = generateFinishedGoodSku(
    input.itemName || stem,
    input.collectionLabel,
    dims.length,
    dims.depth,
  );
  if (direction && !base.endsWith(`-${direction}`)) {
    return `${base}-${direction}`;
  }
  return base;
}

async function paginateKatana<T>(pathBase: string, label: string): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 250;
  for (let page = 1; page <= 80; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${pageSize}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    console.log(`  ${label} page ${page}: ${rows.length}`);
    if (rows.length < pageSize) break;
    await delay(REQUEST_DELAY_MS);
  }
  return all;
}

function loadLocalJson<T>(filename: string): T[] {
  const path = join(process.cwd(), "docs", "katana_live_state", filename);
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return unwrapList<T>(raw);
}

async function loadKatanaCatalog(): Promise<{
  products: KatanaProductLike[];
  variants: KatanaVariant[];
  source: string;
}> {
  if (useLocal) {
    console.log("Loading Katana catalog from docs/katana_live_state (--local)");
    return {
      products: loadLocalJson<KatanaProductLike>("products.json"),
      variants: loadLocalJson<KatanaVariant>("variants.json"),
      source: "local:docs/katana_live_state",
    };
  }

  try {
    console.log("Fetching live Katana /products + /variants …");
    const products = await paginateKatana<KatanaProductLike>(
      "/products",
      "products",
    );
    await delay(REQUEST_DELAY_MS);
    const variants = await paginateKatana<KatanaVariant>("/variants", "variants");
    return { products, variants, source: "live:api.katanamrp.com" };
  } catch (error: unknown) {
    console.warn(
      `Live Katana fetch failed (${error instanceof Error ? error.message : String(error)}); falling back to local pull.`,
    );
    return {
      products: loadLocalJson<KatanaProductLike>("products.json"),
      variants: loadLocalJson<KatanaVariant>("variants.json"),
      source: "local:docs/katana_live_state (fallback)",
    };
  }
}

async function loadHubCatalog(): Promise<{
  candidates: FinishedGoodCandidate[];
  bySku: Map<string, HubRow>;
  byNormalizedName: Map<string, HubRow[]>;
  aliases: Map<string, string>;
}> {
  const db = getDb();

  const rows = await db
    .select({
      globalSku: sku_mappings.global_sku,
      originalName: sku_mappings.original_name,
      itemType: sku_mappings.item_type,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(
      or(
        like(sku_mappings.global_sku, "FIN-%"),
        like(sku_mappings.global_sku, "SA-%"),
        like(sku_mappings.global_sku, "RM-%"),
      ),
    );

  const aliasRows = await db
    .select({
      aliasSku: sku_aliases.alias_sku,
      canonicalSku: sku_aliases.canonical_sku,
    })
    .from(sku_aliases);

  const bySku = new Map<string, HubRow>();
  const byNormalizedName = new Map<string, HubRow[]>();
  const candidates: FinishedGoodCandidate[] = [];

  for (const row of rows) {
    const hub: HubRow = {
      globalSku: row.globalSku,
      originalName: row.originalName,
      itemType: row.itemType,
      length: row.length,
      depth: row.depth,
    };
    bySku.set(hub.globalSku.toUpperCase(), hub);
    if (hub.globalSku.startsWith("FIN-")) {
      candidates.push({
        globalSku: hub.globalSku,
        originalName: hub.originalName,
      });
    }
    const key = normalizeProductName(hub.originalName);
    const list = byNormalizedName.get(key) ?? [];
    list.push(hub);
    byNormalizedName.set(key, list);
  }

  const aliases = new Map<string, string>();
  for (const a of aliasRows) {
    aliases.set(
      a.aliasSku.trim().toUpperCase(),
      a.canonicalSku.trim().toUpperCase(),
    );
  }

  console.log(
    `Hub loaded: ${bySku.size} FIN/SA/RM rows, ${candidates.length} FIN candidates, ${aliases.size} aliases`,
  );

  return { candidates, bySku, byNormalizedName, aliases };
}

function resolveMatch(input: {
  legacySku: string;
  itemName: string;
  candidates: FinishedGoodCandidate[];
  bySku: Map<string, HubRow>;
  byNormalizedName: Map<string, HubRow[]>;
  aliases: Map<string, string>;
}): { status: MatchStatus; canonical: string; reason: string } {
  const sku = normalizeVariantSku(input.legacySku);
  const stem = stripVariantSuffix(sku);
  const { config, label } = collectionForSku(sku, input.itemName);

  // 1) Existing sku_aliases (legacy or prior FIN rename)
  const aliasHit =
    input.aliases.get(sku) ??
    input.aliases.get(stem) ??
    input.aliases.get(input.legacySku.trim().toUpperCase());
  if (aliasHit && input.bySku.has(aliasHit)) {
    return {
      status: "Exact Duplicate",
      canonical: aliasHit,
      reason: "sku_aliases",
    };
  }

  // 2) Exact hub SKU collision (unlikely for BRA-* but cheap)
  if (input.bySku.has(sku)) {
    return {
      status: "Exact Duplicate",
      canonical: sku,
      reason: "exact-sku",
    };
  }

  // 3) Model-code dictionary
  const modelHit = FG_BY_MODEL_CODE[stem];
  if (modelHit && input.bySku.has(modelHit)) {
    return {
      status: "Exact Duplicate",
      canonical: modelHit,
      reason: "model-code",
    };
  }
  if (modelHit) {
    return {
      status: "Needs Migration",
      canonical: modelHit,
      reason: "model-code-proposed",
    };
  }

  // 4) Collection FG matcher (name + cat + dims)
  if (config) {
    const direction = directionOfStem(stem);
    const fg = matchFinishedGoodSku(
      input.itemName,
      config,
      input.candidates,
      direction,
    );
    if (fg) {
      return {
        status: "Exact Duplicate",
        canonical: fg.globalSku,
        reason: `fg-match:${fg.reason}`,
      };
    }
  }

  // 5) Normalized name against hub
  const nameKey = normalizeProductName(input.itemName);
  const nameHits = input.byNormalizedName.get(nameKey) ?? [];
  const finHits = nameHits.filter((h) => h.globalSku.startsWith("FIN-"));
  if (finHits.length === 1) {
    return {
      status: "Exact Duplicate",
      canonical: finHits[0]!.globalSku,
      reason: "exact-name",
    };
  }

  // 6) Propose new canonical Hub SKU (strict nomenclature: FIN-BRV-… not FIN-BRA-…)
  const proposed = proposeCanonicalSku({
    legacySku: sku,
    itemName: input.itemName,
    collectionLabel: label,
  });
  if (input.bySku.has(proposed.toUpperCase())) {
    return {
      status: "Exact Duplicate",
      canonical: proposed.toUpperCase(),
      reason: "proposed-exists",
    };
  }

  return {
    status: "Needs Migration",
    canonical: proposed,
    reason: "generated-proposal",
  };
}

async function main(): Promise<void> {
  console.log("Legacy SKU mapper — DRY RUN (no Katana/Postgres mutations)");

  const { products, variants, source } = await loadKatanaCatalog();
  console.log(
    `Katana source=${source}: ${products.length} products, ${variants.length} variants`,
  );

  const productNameById = new Map<number, string>();
  const nameByVariantId = new Map<number, string>();
  for (const p of products) {
    productNameById.set(p.id, p.name);
    for (const v of p.variants ?? []) {
      if (v.id != null) nameByVariantId.set(v.id, p.name);
    }
  }

  const hub = await loadHubCatalog();

  const proposals: ProposalRow[] = [];
  let duplicates = 0;
  let migrations = 0;

  for (const variant of variants) {
    if (variant.deleted_at) continue;
    const sku = (variant.sku ?? "").trim();
    if (!sku || !isLegacySku(sku)) continue;

    const itemName =
      nameByVariantId.get(variant.id) ??
      (variant.product_id != null
        ? productNameById.get(variant.product_id)
        : undefined) ??
      sku;

    const { status, canonical, reason } = resolveMatch({
      legacySku: sku,
      itemName,
      candidates: hub.candidates,
      bySku: hub.bySku,
      byNormalizedName: hub.byNormalizedName,
      aliases: hub.aliases,
    });

    if (status === "Exact Duplicate") duplicates += 1;
    else migrations += 1;

    const { label } = collectionForSku(sku, itemName);
    proposals.push({
      legacySku: sku,
      itemName,
      matchStatus: status,
      proposedCanonicalHubSku: canonical,
      katanaVariantId: variant.id,
      matchReason: reason,
      modelStem: stripVariantSuffix(sku),
      collection: label,
    });
  }

  proposals.sort((a, b) => a.legacySku.localeCompare(b.legacySku));

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "legacy-sku-mapping-proposal.csv");

  const headers = [
    "Legacy SKU",
    "Item Name",
    "Match Status",
    "Proposed Canonical Hub SKU",
    "Katana Variant ID",
    "Match Reason",
    "Model Stem",
    "Collection",
  ];

  const lines = [
    headers.join(","),
    ...proposals.map((r) =>
      [
        r.legacySku,
        r.itemName,
        r.matchStatus,
        r.proposedCanonicalHubSku,
        String(r.katanaVariantId),
        r.matchReason,
        r.modelStem,
        r.collection,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log("\n=== Summary (dry-run) ===");
  console.log(`  Legacy variants analyzed: ${proposals.length}`);
  console.log(`  Exact Duplicate (alias/archive candidates): ${duplicates}`);
  console.log(`  Needs Migration (proposed FIN-* mint): ${migrations}`);
  console.log(`  CSV → ${outPath}`);
  console.log(
    "\nArchitect: review the CSV. Next phase (separate authorization) will",
  );
  console.log(
    "populate sku_aliases from approved Exact Duplicate rows and mint Hub",
  );
  console.log(
    "rows for Needs Migration — without rewriting protected Katana BOMs.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
  });
