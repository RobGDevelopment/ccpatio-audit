/**
 * Upload local fabric swatches to Supabase Storage and attach the public
 * URL to the matching FAB-* dictionary row.
 *
 *   npm run migrate:upload-fabrics
 *   npm run migrate:upload-fabrics -- --dir=docs/Vividworks/Handoff/web-fabrics
 *
 * Prompts for a relative directory when --dir is omitted.
 * Does not POST to Woo, Katana, or Clover.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { like } from "drizzle-orm";
import { matchFabricSku } from "../lib/sunbrella-web-fabrics";
import { upsertCatalogImageUrl } from "../../src/lib/catalog-image";
import { uploadMaterialImage } from "../../src/lib/supabase-storage";
import { closeDb, getDb } from "../../src/server/db/client";
import { sku_mappings } from "../../src/server/db/schema";

const DEFAULT_DIR = "docs/Vividworks/Handoff/web-fabrics";
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function argDir(): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith("--dir="));
  if (inline) return inline.slice("--dir=".length).trim();
  const index = process.argv.indexOf("--dir");
  if (index >= 0) return process.argv[index + 1]?.trim();
  return undefined;
}

async function resolveDir(): Promise<string> {
  const fromArg = argDir();
  if (fromArg) return fromArg;
  if (!input.isTTY) {
    throw new Error(
      `Pass --dir. Example: npm run migrate:upload-fabrics -- --dir=${DEFAULT_DIR}`,
    );
  }
  const rl = createInterface({ input, output });
  try {
    const answer = (
      await rl.question(`Relative path to fabric images [${DEFAULT_DIR}]: `)
    ).trim();
    return answer || DEFAULT_DIR;
  } finally {
    rl.close();
  }
}

/** `05-CANVAS-WHITE.jpg` → `CANVAS WHITE`. */
export function displayNameFromFile(fileName: string): string {
  const base = path.basename(fileName).replace(/\.[^.]+$/, "");
  return base
    .replace(/^\d+-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** `CANVAS WHITE` → `FAB-CAN-WHI`. Kept only when that SKU exists. */
export function guessFabricSku(displayName: string): string {
  const tokens = displayName.match(/[A-Z0-9]+/g) ?? [];
  const parts = tokens.map((token) => (/^\d+$/.test(token) ? token : token.slice(0, 3)));
  if (parts.length === 0) return "FAB-UNK";
  return `FAB-${parts.join("-")}`;
}

type DictRow = { sku: string; name: string };

function resolveSku(
  displayName: string,
  dictionary: DictRow[],
  bySku: Set<string>,
): { sku: string; reason: string } | { conflict: string } | null {
  const guessed = guessFabricSku(displayName);
  const guessHit = bySku.has(guessed) ? guessed : null;
  const named = matchFabricSku(displayName, dictionary);
  if (named && guessHit && named.sku !== guessHit) {
    return { conflict: `guess ${guessHit} disagrees with name match ${named.sku}` };
  }
  if (named && guessHit) return { sku: named.sku, reason: "name-and-guess" };
  if (named) return { sku: named.sku, reason: "name" };
  if (guessHit) return { sku: guessHit, reason: "guess" };
  return null;
}

async function main(): Promise<void> {
  const relative = await resolveDir();
  const directory = path.resolve(process.cwd(), relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(
    (entry) => entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase()),
  );

  const db = getDb();
  const mappings = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(like(sku_mappings.global_sku, "FAB-%"));
  const dictionary: DictRow[] = mappings.map((row) => ({
    sku: row.sku.trim().toUpperCase(),
    name: row.name,
  }));
  const bySku = new Set(dictionary.map((row) => row.sku));

  const counts = {
    files: files.length,
    uploaded: 0,
    conflicts: 0,
    unmatched: 0,
    missingSku: 0,
  };

  for (const file of files) {
    const displayName = displayNameFromFile(file.name);
    const resolved = resolveSku(displayName, dictionary, bySku);
    if (!resolved) {
      counts.unmatched += 1;
      console.log(`[unmatched] ${file.name} (${displayName})`);
      continue;
    }
    if ("conflict" in resolved) {
      counts.conflicts += 1;
      console.log(`[conflict] ${file.name}: ${resolved.conflict}`);
      continue;
    }

    const ext = path.extname(file.name).replace(/^\./, "").toLowerCase();
    const buffer = await readFile(path.join(directory, file.name));
    const imageUrl = await uploadMaterialImage({
      globalSku: resolved.sku,
      buffer,
      contentType: CONTENT_TYPE[ext] ?? "application/octet-stream",
      ext,
    });
    const write = await upsertCatalogImageUrl({
      globalSku: resolved.sku,
      imageUrl,
      updatedBy: "migrate:upload-fabrics",
    });
    if (write === "missing-sku") {
      counts.missingSku += 1;
      console.log(`[missing-sku] ${file.name} -> ${resolved.sku}`);
      continue;
    }
    counts.uploaded += 1;
    console.log(`[uploaded] ${file.name} -> ${resolved.sku} (${resolved.reason})`);
  }

  console.log(JSON.stringify({ directory: relative, ...counts }));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
