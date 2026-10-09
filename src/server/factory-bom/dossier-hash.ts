import { createHash } from "crypto";
import type { AirlockDossier } from "./airlock.schema";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`)
    .join(",")}}`;
}

export function computeDossierHash(dossier: AirlockDossier, shopDrawingSha256: string | null): string {
  const payload = {
    rootSku: dossier.rootSku,
    shopDrawingSha256,
    nodes: dossier.nodes.slice().sort((a, b) => a.sku.localeCompare(b.sku)).map(node => ({
      sku: node.sku,
      lines: node.lines.slice().sort((a, b) => a.childSku.localeCompare(b.childSku)).map(line => {
        const qty = Number(line.quantity);
        const scrap = Number(line.scrapFactor);
        const effectiveQty = (qty * (Number.isFinite(scrap) && scrap > 0 ? scrap : 1)).toFixed(4);
        return {
          childSku: line.childSku,
          effectiveQty,
          notes: line.notes || "",
        };
      }),
      operations: node.operations.slice().sort((a, b) => a.sequence - b.sequence).map(op => ({
        sequence: op.sequence,
        resourceName: op.workCenter,
        setupSec: (op.setupTimeMins || 0) * 60,
        runSec: (op.runTimeMins || 0) * 60,
      })),
    })),
  };

  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
