/**
 * Paginated Katana GET with 502/503/504/429 retries.
 *
 * Unfiltered GET /product_operation_rows 504s on this tenant. Ops are loaded
 * per product_variant_id. A cache file is written ONLY after every requested
 * variant has been fetched — partial checkpoints must not be treated as SSOT.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KatanaApiError, katanaFetch } from "../../../src/lib/katana";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./csv";

export const DEFAULT_PAGE_SIZE = 250;
export const OPS_PAGE_SIZE = 25;
export const MAX_PAGES = 200;
const MAX_ATTEMPTS = 8;
const TRANSIENT = new Set([429, 502, 503, 504]);

export const OPS_CACHE_PATH = join(
  process.cwd(),
  "tmp",
  "katana-product-operation-rows-cache.json",
);
const OPS_CHECKPOINT_PATH = join(
  process.cwd(),
  "tmp",
  "katana-ops-per-variant-checkpoint.json",
);

type OpsCacheFile = {
  pulledAt: string;
  complete: true;
  variantIds: number[];
  rowCount: number;
  rows: Record<string, unknown>[];
};

type CheckpointFile = {
  pulledAt: string;
  byVariant: Record<string, Record<string, unknown>[]>;
};

function backoffMs(attempt: number): number {
  return Math.min(60_000, 3000 * 2 ** (attempt - 1));
}

async function fetchPage(
  url: string,
  label: string,
  page: number,
  maxAttempts = MAX_ATTEMPTS,
): Promise<Record<string, unknown>[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data } = await katanaFetch(url);
      return unwrapList<Record<string, unknown>>(data);
    } catch (err) {
      lastErr = err;
      const status = err instanceof KatanaApiError ? err.status : 0;
      if (TRANSIENT.has(status) && attempt < maxAttempts) {
        const waitMs = backoffMs(attempt);
        console.warn(
          `  ${label} page ${page} HTTP ${status}, retry ${attempt}/${maxAttempts} in ${waitMs}ms`,
        );
        await delay(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`${label} page ${page} failed`);
}

export async function paginateKatana(
  path: string,
  label: string,
  options?: {
    pageSize?: number;
    maxPages?: number;
    delayMs?: number;
    quiet?: boolean;
    maxAttempts?: number;
  },
): Promise<Record<string, unknown>[]> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const delayMs = options?.delayMs ?? REQUEST_DELAY_MS;
  const all: Record<string, unknown>[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}limit=${pageSize}&page=${page}`;
    const rows = await fetchPage(url, label, page, options?.maxAttempts);
    all.push(...rows);
    if (!options?.quiet) {
      console.log(`  ${label} page ${page}: ${rows.length}`);
    }
    if (rows.length < pageSize) return all;
    await delay(delayMs);
  }

  throw new Error(
    `Pagination hit ${maxPages} full pages for ${path} (${all.length} rows). Aborting so a partial list cannot be treated as complete.`,
  );
}

function readCompleteOpsCache(
  requestedIds: readonly number[],
  maxAgeMs: number,
): Record<string, unknown>[] | null {
  try {
    const raw = readFileSync(OPS_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OpsCacheFile>;
    if (parsed.complete !== true) return null;
    const pulled = Date.parse(String(parsed.pulledAt ?? ""));
    if (!Number.isFinite(pulled) || Date.now() - pulled > maxAgeMs) return null;
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    const cachedIds = new Set((parsed.variantIds ?? []).map(Number));
    const missing = requestedIds.filter((id) => !cachedIds.has(id));
    if (missing.length > 0) {
      console.warn(
        `  ops cache missing ${missing.length} variant ids — refetching`,
      );
      return null;
    }
    console.log(
      `  using complete ops cache (${parsed.rowCount} rows, pulled ${parsed.pulledAt})`,
    );
    return parsed.rows;
  } catch {
    return null;
  }
}

function writeCompleteOpsCache(
  variantIds: readonly number[],
  rows: readonly Record<string, unknown>[],
): void {
  mkdirSync(dirname(OPS_CACHE_PATH), { recursive: true });
  const payload: OpsCacheFile = {
    pulledAt: new Date().toISOString(),
    complete: true,
    variantIds: [...variantIds],
    rowCount: rows.length,
    rows: [...rows],
  };
  writeFileSync(OPS_CACHE_PATH, JSON.stringify(payload), "utf8");
  console.log(`  wrote complete ops cache: ${OPS_CACHE_PATH} (${rows.length} rows)`);
}

function readCheckpoint(): CheckpointFile {
  try {
    const parsed = JSON.parse(
      readFileSync(OPS_CHECKPOINT_PATH, "utf8"),
    ) as CheckpointFile;
    if (!parsed?.byVariant || typeof parsed.byVariant !== "object") {
      return { pulledAt: new Date().toISOString(), byVariant: {} };
    }
    return parsed;
  } catch {
    return { pulledAt: new Date().toISOString(), byVariant: {} };
  }
}

function writeCheckpoint(checkpoint: CheckpointFile): void {
  mkdirSync(dirname(OPS_CHECKPOINT_PATH), { recursive: true });
  writeFileSync(OPS_CHECKPOINT_PATH, JSON.stringify(checkpoint), "utf8");
}

/**
 * Load product_operation_rows for the given variant ids (per-variant GET).
 * Does not use the unfiltered list endpoint — it 504s on this tenant.
 */
export async function loadProductOperationRows(input: {
  variantIds: readonly number[];
  useCache?: boolean;
  cacheMaxAgeMs?: number;
}): Promise<Record<string, unknown>[]> {
  const uniqueIds = [...new Set(input.variantIds.filter((id) => id > 0))];
  if (uniqueIds.length === 0) {
    throw new Error("loadProductOperationRows: no variant ids");
  }

  if (input.useCache !== false) {
    const cached = readCompleteOpsCache(
      uniqueIds,
      input.cacheMaxAgeMs ?? 6 * 60 * 60 * 1000,
    );
    if (cached) return cached;
  }

  const checkpoint = readCheckpoint();
  const doneIds = new Set(
    Object.keys(checkpoint.byVariant).map((k) => Number(k)),
  );
  const pending = uniqueIds.filter((id) => !doneIds.has(id));
  console.log(
    `  per-variant ops fetch: ${uniqueIds.length} variants (${pending.length} pending, ${doneIds.size} checkpointed)`,
  );

  for (let i = 0; i < pending.length; i += 1) {
    const id = pending[i]!;
    const rows = await paginateKatana(
      `/product_operation_rows?product_variant_id=${id}`,
      `ops variant ${id}`,
      { pageSize: 100, maxPages: 20, quiet: true, maxAttempts: 6 },
    );
    checkpoint.byVariant[String(id)] = rows;
    await delay(REQUEST_DELAY_MS);
    const finished = i + 1;
    if (finished % 25 === 0 || finished === pending.length) {
      const loadedRows = Object.values(checkpoint.byVariant).reduce(
        (n, r) => n + r.length,
        0,
      );
      console.log(
        `  per-variant progress ${finished}/${pending.length} (checkpoint rows ${loadedRows})`,
      );
    }
    if (finished % 50 === 0 || finished === pending.length) {
      writeCheckpoint(checkpoint);
    }
  }

  const all: Record<string, unknown>[] = [];
  for (const id of uniqueIds) {
    const rows = checkpoint.byVariant[String(id)];
    if (!rows) {
      throw new Error(
        `FATAL: variant ${id} missing from ops checkpoint after fetch`,
      );
    }
    all.push(...rows);
  }

  if (all.length === 0) {
    throw new Error(
      "FATAL: per-variant ops fetch returned 0 rows across all variants. Refusing missing-ops export.",
    );
  }

  writeCompleteOpsCache(uniqueIds, all);
  try {
    unlinkSync(OPS_CHECKPOINT_PATH);
  } catch {
    // ignore
  }
  return all;
}
