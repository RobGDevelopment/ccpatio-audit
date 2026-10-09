import { createHash } from "crypto";
import type { AirlockDossier } from "./airlock.schema";

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

  const jsonString = JSON.stringify(payload);
  return createHash("sha256").update(jsonString).digest("hex");
}
