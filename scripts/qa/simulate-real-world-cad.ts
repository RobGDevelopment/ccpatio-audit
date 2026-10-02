/**
 * Live-fire CAD → SketchUp webhook simulator.
 *
 * Reads the real Waterfall Dining Table files under
 * docs/BOM_Examples/SketchupFiles (CSV + DAE — do not mock) and POSTs a
 * Zod-valid, HMAC-signed payload to POST /api/webhooks/sketchup.
 *
 * Usage (repo root, Next.js already listening on :3000):
 *   npx dotenv -e .env.local -- tsx scripts/qa/simulate-real-world-cad.ts
 *
 * Optional:
 *   --base-url http://localhost:3000
 *   --replay-id <uuid>   reuse export_id (webhook returns 200 on replay)
 */
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { STANDARD_TRACKS } from "../../src/lib/factory-routing/resources";
import {
  formatKatanaIngredientNote,
  instantiateWaterfallDiningTable,
  parseDaeWeldmentFromXml,
  WATERFALL_DINING_TABLE_FIN,
  type InstantiatedPlan,
} from "../../src/lib/sketchup-cutlist";
import {
  parseSketchupIngest,
  type SketchupIngestPayload,
} from "../../src/server/sketchup/ingest.schema";

loadEnvConfig(process.cwd());

const CAD_DIR = path.resolve(
  process.cwd(),
  "docs/BOM_Examples/SketchupFiles",
);
const TARGET_SKU = WATERFALL_DINING_TABLE_FIN;
const DEFAULT_BASE = "http://localhost:3000";

type CsvRow = { definitionName: string; quantity: number };

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1]?.trim() || null;
}

function resolveExisting(candidates: string[]): string | null {
  for (const name of candidates) {
    const full = path.join(CAD_DIR, name);
    if (fs.existsSync(full)) return full;
  }
  const entries = fs.existsSync(CAD_DIR) ? fs.readdirSync(CAD_DIR) : [];
  const wanted = candidates.map((c) => c.toLowerCase());
  const hit = entries.find((e) => wanted.includes(e.toLowerCase()));
  return hit ? path.join(CAD_DIR, hit) : null;
}

function parseCsv(filePath: string): CsvRow[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const match = line.match(/^"([^"]*)","([^"]*)"$/) ?? line.match(/^([^,]*),(.*)$/);
    if (!match) continue;
    const definitionName = match[1]!.trim();
    const quantity = Number(match[2]!.replace(/"/g, "").trim());
    if (!definitionName) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    rows.push({ definitionName, quantity });
  }
  return rows;
}

function skuItemType(
  sku: string,
): "raw_material" | "sub_assembly" | "finished_good" | "service" {
  if (sku.startsWith("FIN-")) return "finished_good";
  if (sku.startsWith("SA-")) return "sub_assembly";
  if (sku.startsWith("SVC-")) return "service";
  return "raw_material";
}

function aluminumOps() {
  return STANDARD_TRACKS.aluminum_frame.map((step) => ({
    work_center: step.resource,
    sequence: step.sequence,
    setup_mins: step.setupTimeMins,
    run_mins: step.runTimeMins,
  }));
}

function lineNotes(line: InstantiatedPlan["lines"][number]): string | undefined {
  const fromCuts = formatKatanaIngredientNote(line.cutList ?? []);
  const raw = (fromCuts || line.notes || "").trim();
  if (!raw) return undefined;
  return raw.slice(0, 2000);
}

function planToIngest(input: {
  plan: InstantiatedPlan;
  csvRows: CsvRow[];
  exportId: string;
  designerEmail: string;
  overall: {
    lengthIn: number | null;
    depthIn: number | null;
    heightIn: number | null;
  };
}): SketchupIngestPayload {
  const { plan } = input;
  const byParent = new Map<string, InstantiatedPlan["lines"]>();
  for (const line of plan.lines) {
    const bucket = byParent.get(line.parentSku) ?? [];
    bucket.push(line);
    byParent.set(line.parentSku, bucket);
  }

  const nest = (parentSku: string): NonNullable<SketchupIngestPayload["product"]["subassemblies"]> => {
    const kids = byParent.get(parentSku) ?? [];
    return kids.map((line) => {
      const sku = line.childSku;
      const itemType = skuItemType(sku);
      const isBase = sku === plan.seatSku || sku === plan.baseSku;
      const cutNotes = lineNotes(line);
      const notes =
        isBase && input.csvRows.length > 0
          ? [cutNotes, `CSV cut names: ${input.csvRows.map((r) => `${r.definitionName}×${r.quantity}`).join("; ")}`]
              .filter(Boolean)
              .join(" — ")
              .slice(0, 2000)
          : cutNotes;
      return {
        sku_or_name: sku,
        item_type: itemType,
        qty: Number((line.quantity * line.scrapFactor).toFixed(4)),
        uom: line.unitOfMeasure,
        notes: notes || undefined,
        operations: isBase ? aluminumOps() : [],
        children: nest(sku),
      };
    });
  };

  return {
    export_id: input.exportId,
    exported_at: new Date(),
    designer_email: input.designerEmail,
    product: {
      name: "Waterfall Dining Table 72x28",
      collection: "Waterfall",
      category: "Dining Tables",
      proposed_sku: plan.finSku,
      dimensions: {
        length: input.overall.lengthIn ?? 72,
        depth: input.overall.depthIn ?? 28,
        height: input.overall.heightIn ?? undefined,
      },
      operations: [
        {
          work_center: "Quality Control",
          sequence: 10,
          setup_mins: 0,
          run_mins: 8,
        },
        {
          work_center: "Assembly & Packaging",
          sequence: 20,
          setup_mins: 5,
          run_mins: 15,
        },
      ],
      subassemblies: nest(plan.finSku),
    },
  };
}

function signBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

function printRunbook(input: {
  baseUrl: string;
  sku: string;
  exportId: string;
}): void {
  console.log(`
============================================================
LIVE FIRE RUNBOOK — ${input.sku}
============================================================
0. Secrets in .env.local
   SKETCHUP_WEBHOOK_SECRET, POSTGRES_URL, KATANA_PERSONAL_ACCESS_TOKEN
   (or KATANA_API_KEY), CATALOG_PUBLISH_MODE=live for a real Katana write.
   KATANA_USE_BOM_ROWS=true (default) posts /bom_rows with /recipes fallback.

1. Boot Next.js (terminal A)
   npm run dev:pim

2. Boot Inngest local dev (terminal B)
   npx inngest-cli@latest dev -u http://localhost:3000/api/inngest

3. Fire this simulator (terminal C) — already ran if you see this footer.
   npx dotenv -e .env.local -- tsx scripts/qa/simulate-real-world-cad.ts

4. Open quarantine
   ${input.baseUrl}/admin/quarantine
   Find ${input.sku} / export ${input.exportId}
   Enrich (leave Woo/Clover off unless MSRP is set) → Approve.
   Approve must NOT call Katana itself; it emits Inngest product.approved.

5. Watch Inngest
   Local UI (typically http://localhost:8288) → function publish-approved-product
   Steps: load-hub-state → validate-catalog-graph → publish-katana (and Woo/Clover).

6. Verify in live Katana (search SKU ${input.sku})
   • Product FIN-WFT-DIN-TAB-72X28 exists (sellable FG).
   • Sub-assembly SA-WFT-DIN-TAB-72X28-BASE exists (producible).
   • Recipe / BOM rows: FG → BASE (+ Dekton placeholder if present);
     BASE → RM tube / powder lines. Prefer BOM rows; recipes tab if fallback.
   • Ingredient notes on metal RMs are chop-saw cut cards
     (e.g. "N pcs @ L in · 45°/45° mitre" or square) — never JSON.
   • Operations on BASE: aluminum frame track (Material Handling → Pack).
   • Operations on FG: Quality Control + Assembly & Packaging.
============================================================
`);
}

export type SimulateCadResult = {
  exportId: string;
  finSku: string;
  stickCount: number;
  httpStatus: number;
  body: string;
  payload: SketchupIngestPayload;
};

export async function simulateRealWorldCad(options?: {
  replayId?: string;
  baseUrl?: string;
  printRunbook?: boolean;
  skipHttp?: boolean;
}): Promise<SimulateCadResult> {
  const csvPath = resolveExisting([
    "FIN-WFT-DIN-TAB-72X28.csv",
    "FIN-WFT-DIN-TAB-72x28.csv",
  ]);
  const daePath = resolveExisting([
    "FIN-WFT-DIN-TAB-72X28.dae",
    "FIN-WFT-DIN-TAB-72x28.dae",
  ]);

  if (!daePath) {
    throw new Error(
      `Missing DAE for ${TARGET_SKU} under ${CAD_DIR}. CSV/DAE must be read from disk — no mocks.`,
    );
  }

  const csvRows = csvPath ? parseCsv(csvPath) : [];
  const daeXml = fs.readFileSync(daePath);
  const parsedDae = parseDaeWeldmentFromXml(daeXml, path.basename(daePath));
  const plan = instantiateWaterfallDiningTable(parsedDae.walker, {
    finSku: TARGET_SKU,
  });

  console.log("[live-fire] CAD sources");
  console.log(`  csv: ${csvPath ?? "(not found)"} rows=${csvRows.length}`);
  console.log(
    `  dae: ${daePath} sticks=${parsedDae.walker.sticks.length} rollup=${parsedDae.rollup.length}`,
  );
  console.log(
    `  plan: FG=${plan.finSku} BASE=${plan.baseSku ?? plan.seatSku} lines=${plan.lines.length}`,
  );

  const secret = process.env.SKETCHUP_WEBHOOK_SECRET?.trim();
  const exportId = options?.replayId || argValue("--replay-id") || randomUUID();
  const designerEmail =
    process.env.E2E_GODMODE_EMAIL?.trim() || "godmode@ccpatio.com";
  const payload = planToIngest({
    plan,
    csvRows,
    exportId,
    designerEmail,
    overall: parsedDae.walker.overall,
  });

  const validated = parseSketchupIngest(payload);
  if (!validated.ok) {
    throw new Error(
      `Local Zod failed: ${validated.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
    );
  }

  const skipHttp = options?.skipHttp === true || !secret;
  if (skipHttp) {
    console.log(
      `[live-fire] skipping webhook POST (${secret ? "skipHttp=true" : "SKETCHUP_WEBHOOK_SECRET unset"}) export_id=${exportId}`,
    );
    if (options?.printRunbook !== false && !options?.skipHttp) {
      printRunbook({
        baseUrl: (options?.baseUrl || DEFAULT_BASE).replace(/\/$/, ""),
        sku: TARGET_SKU,
        exportId,
      });
    }
    return {
      exportId,
      finSku: TARGET_SKU,
      stickCount: parsedDae.walker.sticks.length,
      httpStatus: 0,
      body: "skipped_webhook",
      payload: validated.data,
    };
  }

  const rawBody = JSON.stringify(validated.data);
  const signature = signBody(rawBody, secret);
  const baseUrl = (
    options?.baseUrl ||
    argValue("--base-url") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    DEFAULT_BASE
  ).replace(/\/$/, "");
  const url = `${baseUrl}/api/webhooks/sketchup`;

  console.log(`[live-fire] POST ${url}`);
  console.log(`  export_id=${exportId}`);
  console.log(`  subassemblies=${validated.data.product.subassemblies?.length ?? 0}`);

  let httpStatus = 0;
  let text = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CCPatio-Signature": signature,
      },
      body: rawBody,
    });
    httpStatus = res.status;
    text = await res.text();
  } catch (error: unknown) {
    httpStatus = 0;
    text = error instanceof Error ? error.message : String(error);
  }

  console.log(`[live-fire] HTTP ${httpStatus || "ERR"}`);
  console.log(text || "(empty body)");

  if (options?.printRunbook !== false) {
    printRunbook({ baseUrl, sku: TARGET_SKU, exportId });
  }

  return {
    exportId,
    finSku: TARGET_SKU,
    stickCount: parsedDae.walker.sticks.length,
    httpStatus,
    body: text,
    payload: validated.data,
  };
}

async function main(): Promise<void> {
  const result = await simulateRealWorldCad();
  if (result.httpStatus !== 202 && result.httpStatus !== 200) {
    process.exitCode = 1;
  }
}

const isDirectCli =
  process.argv[1]?.includes("simulate-real-world-cad") === true;

if (isDirectCli) {
  main().catch((error: unknown) => {
    console.error("[live-fire] failed", error);
    process.exitCode = 1;
  });
}
