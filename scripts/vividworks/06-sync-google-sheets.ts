/**
 * Push Phase 1 + Phase 2 handoff SKUs to the ops Google Sheet tab `Katana SKU`.
 *
 * Always writes a paste-ready CSV first. Google Sheets is best-effort: missing
 * credentials or API errors fall back to the local file instead of failing the run.
 *
 * Usage:
 *   npx tsx scripts/vividworks/06-sync-google-sheets.ts
 *   npx tsx scripts/vividworks/06-sync-google-sheets.ts --csv-only
 *
 * Env:
 *   GOOGLE_SHEET_ID                  Spreadsheet ID (or full Sheets URL)
 *   GOOGLE_SHEET_TAB                 Optional. Default: "Katana SKU"
 *   GOOGLE_APPLICATION_CREDENTIALS   Path to service-account JSON
 *   GOOGLE_SERVICE_ACCOUNT_JSON      Inline JSON (alternative to the file)
 *   GOOGLE_CLIENT_EMAIL              Split-var alternative
 *   GOOGLE_PRIVATE_KEY               Split-var alternative (use \n for newlines)
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

loadEnvConfig(process.cwd());

const HANDOFF_DIR = path.resolve(process.cwd(), "docs/Vividworks/Handoff");
const PHASE1_CSV = path.join(HANDOFF_DIR, "vividworks_phase1_products.csv");
const PHASE2_CSV = path.join(HANDOFF_DIR, "vividworks_phase2_products.csv");
const OUT_CSV = path.join(HANDOFF_DIR, "google_tab3_import.csv");
const DEFAULT_TAB = "Katana SKU";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const CSV_ONLY = process.argv.includes("--csv-only");

const TAB_HEADERS = [
  "Collection",
  "Original Name",
  "Canonical FIN- SKU",
  "Length",
  "Depth",
  "Height",
  "Base MSRP",
  "Base Weight",
] as const;

type TabRow = {
  collection: string;
  originalName: string;
  canonicalSku: string;
  length: string;
  depth: string;
  height: string;
  baseMsrp: string;
  baseWeight: string;
};

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function quoteSheetRange(tab: string, a1: string): string {
  const escaped = tab.replace(/'/g, "''");
  return `'${escaped}'!${a1}`;
}

function parseSheetId(raw: string): string {
  const trimmed = raw.trim();
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return fromUrl?.[1] ?? trimmed;
}

function readPhaseCsv(filePath: string): TabRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. Run npx tsx scripts/vividworks/04-generate-complete-sow-datapack.ts first.`,
    );
  }
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return rows
    .map((row) => ({
      collection: cellText(row["Collection"]),
      originalName: cellText(row["SOW Product Name"]),
      canonicalSku: cellText(row["Canonical SKU"]).toUpperCase(),
      length: cellText(row["Length"]),
      depth: cellText(row["Depth"]),
      height: cellText(row["Height"]),
      baseMsrp: cellText(row["MSRP"]),
      baseWeight: cellText(row["Base Weight"]),
    }))
    .filter((row) => row.canonicalSku || row.originalName);
}

function toCells(row: TabRow): string[] {
  return [
    row.collection,
    row.originalName,
    row.canonicalSku,
    row.length,
    row.depth,
    row.height,
    row.baseMsrp,
    row.baseWeight,
  ];
}

function writeFallbackCsv(rows: TabRow[]): void {
  fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  const lines = [
    TAB_HEADERS.map(csvEscape).join(","),
    ...rows.map((row) => toCells(row).map(csvEscape).join(",")),
  ];
  fs.writeFileSync(OUT_CSV, `${lines.join("\r\n")}\r\n`, "utf8");
}

function headersMatch(existing: string[]): boolean {
  if (existing.length < TAB_HEADERS.length) return false;
  return TAB_HEADERS.every(
    (header, index) =>
      cellText(existing[index]).toLowerCase() === header.toLowerCase(),
  );
}

function loadServiceAccountCredentials(): {
  client_email: string;
  private_key: string;
} | null {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    const parsed = JSON.parse(inline) as {
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.",
      );
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  }

  const email = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  if (email && privateKey) {
    return {
      client_email: email,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFile) {
    const resolved = path.isAbsolute(keyFile)
      ? keyFile
      : path.resolve(process.cwd(), keyFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${resolved}`);
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        `Service account JSON at ${resolved} is missing client_email or private_key.`,
      );
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

async function pushToGoogleSheet(rows: TabRow[]): Promise<void> {
  const sheetIdRaw = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetIdRaw) {
    throw new Error(
      "GOOGLE_SHEET_ID is not set. Add it to .env.local (spreadsheet ID or full URL).",
    );
  }
  const spreadsheetId = parseSheetId(sheetIdRaw);
  const tab = (process.env.GOOGLE_SHEET_TAB?.trim() || DEFAULT_TAB).trim();
  const credentials = loadServiceAccountCredentials();
  if (!credentials) {
    throw new Error(
      "No Google credentials. Set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.",
    );
  }

  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [SHEETS_SCOPE],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTab = meta.data.sheets?.find(
    (sheet) => sheet.properties?.title === tab,
  );
  if (!existingTab) {
    const sheetCount = meta.data.sheets?.length ?? 0;
    console.log(`[sheets] creating tab "${tab}"`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tab,
                ...(sheetCount >= 2 ? { index: 2 } : {}),
              },
            },
          },
        ],
      },
    });
  }

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: quoteSheetRange(tab, "1:1"),
  });
  const existingHeaders = (headerRes.data.values?.[0] ?? []).map(cellText);
  const keepHeaders =
    existingHeaders.some(Boolean) && headersMatch(existingHeaders);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: quoteSheetRange(tab, "A2:Z"),
  });

  const dataValues = rows.map(toCells);
  if (keepHeaders) {
    console.log(`[sheets] preserving row 1 headers on "${tab}"`);
    if (dataValues.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: quoteSheetRange(tab, "A2"),
        valueInputOption: "USER_ENTERED",
        requestBody: { values: dataValues },
      });
    }
  } else {
    if (existingHeaders.some(Boolean)) {
      console.warn(
        `[sheets] row 1 headers did not match expected columns; rewriting row 1.`,
        { existing: existingHeaders, expected: [...TAB_HEADERS] },
      );
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: quoteSheetRange(tab, "A1"),
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[...TAB_HEADERS], ...dataValues] },
    });
  }

  console.log(`[sheets] wrote ${rows.length} rows to "${tab}" in ${spreadsheetId}`);
}

async function main(): Promise<void> {
  const phase1 = readPhaseCsv(PHASE1_CSV);
  const phase2 = readPhaseCsv(PHASE2_CSV);
  const combined = [...phase1, ...phase2];

  writeFallbackCsv(combined);
  console.log("[sheets] wrote fallback CSV", {
    path: OUT_CSV,
    phase1: phase1.length,
    phase2: phase2.length,
    combined: combined.length,
  });

  if (CSV_ONLY) {
    console.log("[sheets] --csv-only set; skipped Google Sheets API.");
    return;
  }

  try {
    await pushToGoogleSheet(combined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("[sheets] Google API skipped / failed. Fallback CSV is ready.");
    console.log(`[sheets] reason: ${message}`);
    console.log(
      `[sheets] Import manually: copy ${OUT_CSV} into the "Katana SKU" tab (headers on row 1).`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("[sheets] fatal", error);
  process.exit(1);
});
