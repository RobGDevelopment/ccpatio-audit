/**
 * Read-only Katana scrape for schema discovery.
 * Does not invent IDs or write sku_mappings.
 *
 * Usage (from middleware/): npx tsx scripts/scrape-katana.ts
 * Requires KATANA_API_KEY in middleware/.env.local
 */
import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

const KATANA_API_BASE = "https://api.katanamrp.com/v1";
const OUT_FILE = path.resolve(process.cwd(), "..", "docs", "_katana_raw_scrape.json");

type ScrapeResult = {
  endpoint: string;
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
};

async function fetchKatana(pathname: string, apiKey: string): Promise<ScrapeResult> {
  const endpoint = `${KATANA_API_BASE}${pathname}`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  let body: unknown;
  const text = await response.text();
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = { parse_error: true, raw: text.slice(0, 4000) };
  }

  return {
    endpoint,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.KATANA_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing KATANA_API_KEY in .env.local (cwd: middleware/).");
    process.exitCode = 1;
    return;
  }

  const variants = await fetchKatana("/variants?limit=50", apiKey);
  const materials = await fetchKatana("/materials?limit=50", apiKey);

  const payload = {
    meta: {
      timestamp: new Date().toISOString(),
      note: "Raw scrape for Katana_Data_Schema.md. Do not treat as a SKU mapping.",
    },
    variants,
    materials,
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`variants: ${variants.status} ${variants.statusText}`);
  console.log(`materials: ${materials.status} ${materials.statusText}`);
  if (!variants.ok || !materials.ok) {
    console.error("One or more Katana GETs failed. Inspect the dump; do not invent schema.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
