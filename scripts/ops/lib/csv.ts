/**
 * Shared CSV helpers for scripts/ops ingestion toolsuite.
 * Supports quoted fields; first row is headers (case-sensitive as written).
 */
import { readFileSync } from "node:fs";

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function readCsvRecords(path: string): Record<string, string>[] {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]!] = (cols[i] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

export function col(
  row: Record<string, string>,
  ...aliases: string[]
): string {
  for (const key of aliases) {
    if (row[key] != null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  // Case-insensitive fallback
  const lower = new Map(
    Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const key of aliases) {
    const hit = lower.get(key.toLowerCase());
    if (hit != null && hit.trim() !== "") return hit.trim();
  }
  return "";
}

export function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

export const REQUEST_DELAY_MS = 1100;
export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseQty(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
