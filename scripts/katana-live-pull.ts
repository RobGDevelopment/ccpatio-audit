/**
 * Full paginated Katana live-state export.
 *
 * Usage: npx tsx scripts/katana-live-pull.ts
 * Env: KATANA_PERSONAL_ACCESS_TOKEN or KATANA_API_KEY in .env.local
 *
 * Writes JSON to docs/katana_live_state/
 */
import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

const KATANA_API_BASE = "https://api.katanamrp.com/v1";
const PAGE_SIZE = 250;
const OUT_DIR = path.resolve(process.cwd(), "docs", "katana_live_state");
const MAX_RATE_LIMIT_RETRIES = 5;

type PaginationMeta = {
  total_records?: number;
  total_pages?: number;
  offset?: number;
  page?: number;
  first_page?: boolean;
  last_page?: boolean;
};

type EndpointResult = {
  endpoint: string;
  ok: boolean;
  status: number;
  statusText: string;
  pagination: PaginationMeta | null;
  recordCount: number;
  pagesFetched: number;
  error?: string;
  data: unknown[];
};

function resolveKatanaToken(): string {
  const token =
    process.env.KATANA_PERSONAL_ACCESS_TOKEN?.trim() ??
    process.env.KATANA_API_KEY?.trim();
  if (!token) {
    throw new Error(
      "Missing KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY) in .env.local",
    );
  }
  return token;
}

function parsePagination(headers: Headers): PaginationMeta | null {
  const raw = headers.get("X-Pagination");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PaginationMeta;
  } catch {
    return null;
  }
}

function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!record || typeof record !== "object") return [];
  const candidate = record.data ?? record.results ?? record.items;
  return Array.isArray(candidate) ? candidate : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(
  token: string,
  pathname: string,
  page: number,
  retryCount = 0,
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
  headers: Headers;
}> {
  const url = `${KATANA_API_BASE}${pathname}?limit=${PAGE_SIZE}&page=${page}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (response.status === 429 && retryCount < MAX_RATE_LIMIT_RETRIES) {
    const reset = response.headers.get("X-Ratelimit-Reset");
    const resetMs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) + 250 : 1500 * (retryCount + 1);
    await sleep(resetMs);
    return fetchPage(token, pathname, page, retryCount + 1);
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = { parse_error: true, raw: text.slice(0, 4000) };
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
    headers: response.headers,
  };
}

async function fetchAllPages(
  token: string,
  pathname: string,
): Promise<EndpointResult> {
  const allRows: unknown[] = [];
  let page = 1;
  let lastPagination: PaginationMeta | null = null;
  let lastStatus = 0;
  let lastStatusText = "";
  let ok = true;
  let error: string | undefined;

  while (true) {
    const result = await fetchPage(token, pathname, page);
    lastStatus = result.status;
    lastStatusText = result.statusText;
    lastPagination = parsePagination(result.headers);

    if (!result.ok) {
      ok = false;
      const record = result.body as Record<string, unknown>;
      error =
        typeof record?.message === "string"
          ? record.message
          : `HTTP ${result.status} ${result.statusText}`;
      break;
    }

    const rows = extractRows(result.body);
    allRows.push(...rows);

    const isLast =
      lastPagination?.last_page === true ||
      rows.length === 0 ||
      (lastPagination?.total_pages != null && page >= lastPagination.total_pages);

    if (isLast) break;
    page += 1;
    await sleep(120);
  }

  return {
    endpoint: pathname,
    ok,
    status: lastStatus,
    statusText: lastStatusText,
    pagination: lastPagination,
    recordCount: allRows.length,
    pagesFetched: page,
    error,
    data: allRows,
  };
}

const ENDPOINTS = [
  "/products",
  "/variants",
  "/materials",
  "/recipes",
  "/product_operation_rows",
  "/operations",
] as const;

async function main(): Promise<void> {
  const token = resolveKatanaToken();
  await mkdir(OUT_DIR, { recursive: true });

  const pulledAt = new Date().toISOString();
  const summary: Record<string, EndpointResult> = {};

  for (const endpoint of ENDPOINTS) {
    console.log(`[katana-live-pull] GET ${endpoint} …`);
    const result = await fetchAllPages(token, endpoint);
    summary[endpoint] = result;

    const fileName = endpoint.replace(/^\//, "").replace(/\//g, "_") + ".json";
    await writeFile(
      path.join(OUT_DIR, fileName),
      JSON.stringify(
        {
          meta: {
            pulledAt,
            endpoint,
            status: result.status,
            ok: result.ok,
            pagesFetched: result.pagesFetched,
            recordCount: result.recordCount,
            pagination: result.pagination,
            error: result.error ?? null,
          },
          data: result.data,
        },
        null,
        2,
      ),
      "utf8",
    );

    const statusLabel = result.ok ? "OK" : "FAIL";
    console.log(
      `  ${statusLabel} ${result.recordCount} records (${result.pagesFetched} page(s)) status=${result.status}`,
    );
    if (result.error) console.log(`  error: ${result.error}`);
  }

  await writeFile(
    path.join(OUT_DIR, "_pull_summary.json"),
    JSON.stringify({ pulledAt, endpoints: summary }, null, 2),
    "utf8",
  );

  console.log(`\nWrote ${OUT_DIR}`);
  const failures = Object.values(summary).filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error(`${failures.length} endpoint(s) failed — see _pull_summary.json`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
