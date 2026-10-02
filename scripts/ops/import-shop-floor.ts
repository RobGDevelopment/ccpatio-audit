/**
 * Shop Floor Engine — staff CSV → Katana operators (if possible) + resources.
 *
 * Input: tmp/staff.csv
 *   Columns: First Name, Last Name, Email, Role/Resource
 *
 * Katana public API exposes GET /operators but **no POST /operators**.
 * Operator invites / Shop Floor login accounts must be created in the Katana UI
 * (Settings → Team / Shop Floor). This script:
 *   1. Prints a clear UI warning for each staff row.
 *   2. Maps Role/Resource onto locked Hub workstations (KATANA_RESOURCES).
 *   3. Attempts GET/POST /resources; if the endpoint is unavailable, lists the
 *      physical cells that must exist under Settings → Resources.
 *
 * Dry-run default. Live: --confirm
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-shop-floor.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-shop-floor.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { join } from "node:path";
import {
  KATANA_RESOURCES,
  isKatanaResource,
  normalizeKatanaResource,
} from "../../src/lib/factory-routing/resources";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import {
  REQUEST_DELAY_MS,
  col,
  delay,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const csvPath = join(process.cwd(), "tmp", "staff.csv");

type ResourceHit = {
  id: number;
  name?: string | null;
  default_hourly_cost?: number | null;
};

async function probeOperatorsApi(): Promise<"get-only" | "writable" | "missing"> {
  try {
    await katanaFetch("/operators?limit=1&page=1");
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && (error.status === 404 || error.status === 405)) {
      return "missing";
    }
    // 401/other still means endpoint exists as GET
  }

  if (!confirm) return "get-only";

  try {
    await katanaFetch("/operators", {
      method: "POST",
      body: {
        operator_name: "__ccpatio_probe_do_not_keep__",
        email: "ops-probe@invalid.local",
      },
    });
    return "writable";
  } catch (error: unknown) {
    if (error instanceof KatanaApiError) {
      if (error.status === 404 || error.status === 405) return "get-only";
      // 422 means endpoint accepts POST but rejected probe payload → writable
      if (error.status === 422) return "writable";
    }
    return "get-only";
  }
}

async function listResources(): Promise<{
  ok: boolean;
  rows: ResourceHit[];
  error?: string;
}> {
  try {
    const all: ResourceHit[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { data } = await katanaFetch(`/resources?limit=100&page=${page}`);
      const rows = unwrapList<ResourceHit>(data);
      all.push(...rows);
      if (rows.length < 100) break;
      await delay(REQUEST_DELAY_MS);
    }
    return { ok: true, rows: all };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, rows: [], error: message };
  }
}

async function ensureResource(name: string, existing: ResourceHit[]): Promise<string> {
  const hit = existing.find(
    (r) => (r.name ?? "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (hit) return `exists id=${hit.id}`;

  if (!confirm) {
    return `would POST /resources name="${name}"`;
  }

  try {
    const { data } = await katanaFetch<ResourceHit>("/resources", {
      method: "POST",
      body: { name },
    });
    if (data?.id) {
      existing.push(data);
      return `created id=${data.id}`;
    }
    return "created (no id in response)";
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && (error.status === 404 || error.status === 405)) {
      throw new Error("RESOURCES_API_UNAVAILABLE");
    }
    throw error;
  }
}

async function main(): Promise<void> {
  console.log("Import shop floor (Shop Floor Engine)");
  console.log(`  csv: ${csvPath}`);
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);

  const records = readCsvRecords(csvPath);
  if (records.length === 0) {
    throw new Error(`No data rows in ${csvPath}`);
  }

  console.log("\n--- Operator / staff accounts ---");
  const opMode = await probeOperatorsApi();
  await delay(REQUEST_DELAY_MS);

  if (opMode !== "writable") {
    console.warn(
      "  WARNING: Katana public API does not support creating Shop Floor operators",
    );
    console.warn(
      "  (GET /operators exists; POST /operators is not available for invites).",
    );
    console.warn(
      "  Invite each person in Katana UI → Settings → Team / Shop Floor App,",
    );
    console.warn(
      "  then assign them to a workstation Resource. Rows below are reminders only:",
    );
  } else {
    console.log("  POST /operators appears writable — attempting creates.");
  }

  const neededResources = new Set<string>();
  let staffReminders = 0;

  for (const row of records) {
    const first = col(row, "First Name", "First");
    const last = col(row, "Last Name", "Last");
    const email = col(row, "Email");
    const roleRaw = col(row, "Role/Resource", "Role", "Resource");
    const display = [first, last].filter(Boolean).join(" ") || email || "(unnamed)";

    const normalized = normalizeKatanaResource(roleRaw);
    if (normalized && isKatanaResource(normalized)) {
      neededResources.add(normalized);
    } else if (normalized) {
      console.warn(
        `  ${display}: Role/Resource "${roleRaw}" is not a locked Hub workstation.`,
      );
      console.warn(
        `    Map it to one of: ${KATANA_RESOURCES.slice(0, 5).join(", ")}, …`,
      );
      // Still attempt create under normalized name so Architect can decide.
      neededResources.add(normalized);
    }

    staffReminders += 1;
    if (opMode === "writable" && confirm) {
      try {
        await katanaFetch("/operators", {
          method: "POST",
          body: {
            operator_name: display,
            ...(email ? { email } : {}),
          },
        });
        console.log(`  created operator ${display}`);
      } catch (error: unknown) {
        console.warn(
          `  operator ${display}: ${error instanceof Error ? error.message : String(error)} — use UI invite`,
        );
      }
      await delay(REQUEST_DELAY_MS);
    } else {
      console.log(
        `  UI invite required: ${display} <${email || "no-email"}> → Resource "${normalized || roleRaw || "—"}"`,
      );
    }
  }

  console.log("\n--- Physical Resources (workstations) ---");
  const listed = await listResources();
  await delay(REQUEST_DELAY_MS);

  let resourcesApiOk = listed.ok;
  const existing = listed.rows;
  if (!listed.ok) {
    console.warn(
      `  GET /resources unavailable (${listed.error}).`,
    );
    console.warn(
      "  Create these cells in Katana UI → Settings → Resources (hourly rates too):",
    );
    for (const name of [...neededResources].sort()) {
      console.warn(`    - ${name}`);
    }
    resourcesApiOk = false;
  } else {
    console.log(`  existing resources: ${existing.length}`);
    let created = 0;
    let reused = 0;
    for (const name of [...neededResources].sort()) {
      try {
        const detail = await ensureResource(name, existing);
        if (detail.startsWith("exists")) reused += 1;
        else created += 1;
        console.log(`  ${name}: ${detail}`);
        await delay(REQUEST_DELAY_MS);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message === "RESOURCES_API_UNAVAILABLE"
        ) {
          resourcesApiOk = false;
          console.warn(
            "  POST /resources not supported — finish workstation setup in Katana UI Settings → Resources:",
          );
          for (const n of [...neededResources].sort()) {
            console.warn(`    - ${n}`);
          }
          break;
        }
        console.error(
          `  FAIL resource ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (resourcesApiOk) {
      console.log(`  resources created/planned: ${created}; already present: ${reused}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  staff rows:              ${staffReminders}`);
  console.log(`  operator API:            ${opMode}`);
  console.log(`  unique resources needed: ${neededResources.size}`);
  console.log(
    `  resources API:           ${resourcesApiOk ? "available" : "UI fallback"}`,
  );
  if (!confirm) {
    console.log("  Re-run with --confirm to attempt live resource POSTs.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
