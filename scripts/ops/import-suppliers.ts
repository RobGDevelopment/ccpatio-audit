/**
 * Supply Chain Engine — import Katana suppliers (+ optional RM purchase pricing).
 *
 * Input: tmp/suppliers.csv
 *   Required: Supplier Name, Email, Phone, Currency
 *   Optional: RM SKU, Purchase Price  (links RM-* material to supplier + cost)
 *
 * Dry-run default. Live: --confirm
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-suppliers.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-suppliers.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { join } from "node:path";
import { findVariantBySku, katanaFetch } from "../../src/lib/katana";
import {
  REQUEST_DELAY_MS,
  col,
  delay,
  parseMoney,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const csvPath = join(process.cwd(), "tmp", "suppliers.csv");

type SupplierHit = { id: number; name: string; email?: string | null };

async function listSuppliers(): Promise<SupplierHit[]> {
  const all: SupplierHit[] = [];
  for (let page = 1; page <= 40; page += 1) {
    const { data } = await katanaFetch(`/suppliers?limit=100&page=${page}`);
    const rows = unwrapList<SupplierHit>(data);
    all.push(...rows);
    if (rows.length < 100) break;
    await delay(REQUEST_DELAY_MS);
  }
  return all;
}

function findExisting(
  catalog: SupplierHit[],
  name: string,
  email: string,
): SupplierHit | null {
  const n = name.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  if (e) {
    const byEmail = catalog.find(
      (s) => (s.email ?? "").trim().toLowerCase() === e,
    );
    if (byEmail) return byEmail;
  }
  return (
    catalog.find((s) => (s.name ?? "").trim().toLowerCase() === n) ?? null
  );
}

async function ensureSupplier(input: {
  name: string;
  email: string;
  phone: string;
  currency: string;
  catalog: SupplierHit[];
}): Promise<{ id: number; created: boolean }> {
  const existing = findExisting(input.catalog, input.name, input.email);
  if (existing) {
    return { id: existing.id, created: false };
  }
  if (!confirm) {
    console.log(
      `  would POST /suppliers name="${input.name}" email=${input.email || "—"} currency=${input.currency}`,
    );
    return { id: -1, created: true };
  }
  const { data } = await katanaFetch<SupplierHit>("/suppliers", {
    method: "POST",
    body: {
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
    },
  });
  const id = data?.id;
  if (id == null) throw new Error(`Supplier create returned no id for ${input.name}`);
  input.catalog.push({ id, name: input.name, email: input.email || null });
  return { id, created: true };
}

async function linkRmPricing(input: {
  supplierId: number;
  sku: string;
  purchasePrice: number | null;
}): Promise<string> {
  const variant = await findVariantBySku(input.sku);
  if (!variant) return `SKU not found in Katana: ${input.sku}`;
  if (variant.material_id == null) {
    return `${input.sku} is not a material (product_id=${variant.product_id}) — skip supplier link`;
  }

  if (!confirm) {
    return `would PATCH material ${variant.material_id} default_supplier_id=${input.supplierId}; variant ${variant.id} purchase_price=${input.purchasePrice ?? "unchanged"}`;
  }

  await katanaFetch(`/materials/${variant.material_id}`, {
    method: "PATCH",
    body: { default_supplier_id: input.supplierId },
  });
  await delay(REQUEST_DELAY_MS);

  if (input.purchasePrice != null) {
    await katanaFetch(`/variants/${variant.id}`, {
      method: "PATCH",
      body: { purchase_price: input.purchasePrice },
    });
    await delay(REQUEST_DELAY_MS);
  }

  return `linked material ${variant.material_id} + variant ${variant.id}`;
}

async function main(): Promise<void> {
  console.log("Import suppliers (Supply Chain Engine)");
  console.log(`  csv: ${csvPath}`);
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);

  const rows = readCsvRecords(csvPath);
  if (rows.length === 0) {
    throw new Error(`No data rows in ${csvPath}`);
  }

  const catalog = await listSuppliers();
  console.log(`  existing suppliers in Katana: ${catalog.length}`);

  let created = 0;
  let reused = 0;
  let priced = 0;
  let failed = 0;

  /** Cache supplier id by normalized name within this run. */
  const idByName = new Map<string, number>();

  for (const row of rows) {
    const name = col(row, "Supplier Name", "Name");
    const email = col(row, "Email");
    const phone = col(row, "Phone");
    const currency = (col(row, "Currency") || "USD").toUpperCase();
    const rmSku = col(row, "RM SKU", "SKU").toUpperCase();
    const purchasePrice = parseMoney(col(row, "Purchase Price", "Unit Cost"));

    if (!name) {
      console.warn("  skip row: missing Supplier Name");
      failed += 1;
      continue;
    }

    try {
      let supplierId = idByName.get(name.toLowerCase());
      if (supplierId == null) {
        const ensured = await ensureSupplier({
          name,
          email,
          phone,
          currency,
          catalog,
        });
        supplierId = ensured.id;
        if (ensured.created) created += 1;
        else reused += 1;
        // Dry-run uses id=-1; still memoize so duplicate CSV rows don't re-plan.
        idByName.set(name.toLowerCase(), supplierId);
        await delay(REQUEST_DELAY_MS);
      }

      if (rmSku.startsWith("RM-")) {
        if (supplierId < 0 && !confirm) {
          console.log(
            `  ${name} → ${rmSku}: would link material after supplier create (price=${purchasePrice ?? "—"})`,
          );
          priced += 1;
        } else if (supplierId > 0) {
          const detail = await linkRmPricing({
            supplierId,
            sku: rmSku,
            purchasePrice,
          });
          console.log(`  ${name} → ${rmSku}: ${detail}`);
          priced += 1;
          await delay(REQUEST_DELAY_MS);
        }
      } else if (rmSku && !rmSku.startsWith("RM-")) {
        console.warn(`  ${name}: ignore non-RM SKU "${rmSku}" for purchase pricing`);
      } else if (!rmSku) {
        console.log(`  ${name}: supplier only (no RM SKU column)`);
      }
    } catch (error: unknown) {
      failed += 1;
      console.error(
        `  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  suppliers created/planned: ${created}`);
  console.log(`  suppliers reused:          ${reused}`);
  console.log(`  RM price links:            ${priced}`);
  console.log(`  failed:                    ${failed}`);
  if (!confirm) {
    console.log("  Re-run with --confirm to POST live.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
