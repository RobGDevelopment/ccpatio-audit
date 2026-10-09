import { jsPDF } from "jspdf";
import { type AirlockCutLine } from "./airlock.schema";

export type ShopDrawingInput = {
  rootSku: string;
  originalName: string;
  cadExt: "dae" | "glb";
  cadSha256: string;
  cutList: AirlockCutLine[];
  geometrySnapshot: {
    components: Array<{
      name: string;
      role?: string;
      material?: string;
      profile?: string;
      lengthIn?: number;
    }>;
  };
};

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function renderShopDrawingPdf(input: ShopDrawingInput): Uint8Array {
  // Deterministic creation (no timestamps, etc.)
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "in",
    format: "letter",
    putOnlyUsedFonts: true,
  });

  // Set initial properties to ensure determinism
  doc.setCreationDate(new Date(0));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Shop Drawing: ${input.rootSku}`, 0.5, 0.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(`Name: ${input.originalName}`, 0.5, 0.75);
  doc.text(`CAD Source: ${input.cadExt.toUpperCase()}`, 0.5, 0.95);
  doc.text(`SHA256: ${input.cadSha256}`, 0.5, 1.15);

  let y = 1.6;

  // Render Cut Schedule. Sort by code point so the same cuts always land in the same order.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Cut Schedule", 0.5, y);
  y += 0.25;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const cuts = [...input.cutList].sort((a, b) => {
    const part = cmp(a.drawingPartNumber ?? "", b.drawingPartNumber ?? "");
    if (part !== 0) return part;
    const role = cmp(a.role, b.role);
    if (role !== 0) return role;
    const profile = cmp(a.profile, b.profile);
    if (profile !== 0) return profile;
    const source = cmp(a.sourceName, b.sourceName);
    if (source !== 0) return source;
    return a.lengthIn - b.lengthIn || a.qtyEa - b.qtyEa;
  });

  if (cuts.length === 0) {
    doc.text("No cuts found.", 0.5, y);
    y += 0.2;
  } else {
    doc.text("Part", 0.4, y);
    doc.text("Role", 1.45, y);
    doc.text("Profile", 2.05, y);
    doc.text("Len", 3.15, y);
    doc.text("A", 3.7, y);
    doc.text("B", 4.05, y);
    doc.text("Qty", 4.4, y);
    doc.text("Conv", 4.85, y);
    doc.text("Source", 5.7, y);
    y += 0.18;

    for (const cut of cuts) {
      if (y > 10) {
        doc.addPage();
        y = 0.5;
      }
      doc.text(cut.drawingPartNumber ?? "", 0.4, y);
      doc.text(cut.role, 1.45, y);
      doc.text(cut.profile, 2.05, y);
      doc.text(cut.lengthIn.toFixed(2), 3.15, y);
      doc.text(String(cut.endA), 3.7, y);
      doc.text(String(cut.endB), 4.05, y);
      doc.text(String(cut.qtyEa), 4.4, y);
      doc.text(cut.lengthConvention, 4.85, y);
      doc.text(cut.sourceName, 5.7, y);
      y += 0.18;
    }
  }

  y += 0.3;
  if (y > 10) {
    doc.addPage();
    y = 0.5;
  }

  // Render Orthographic Stick Callouts
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Orthographic Stick Callouts", 0.5, y);
  y += 0.25;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  if (!input.geometrySnapshot?.components || input.geometrySnapshot.components.length === 0) {
    doc.text("No components found in geometry snapshot.", 0.5, y);
    y += 0.2;
  } else {
    // Header
    doc.text("Name", 0.5, y);
    doc.text("Length (in)", 3.0, y);
    y += 0.2;

    const components = [...input.geometrySnapshot.components].sort((a, b) => {
      const name = cmp(a.name, b.name);
      if (name !== 0) return name;
      return (a.lengthIn ?? 0) - (b.lengthIn ?? 0);
    });

    for (const comp of components) {
      if (y > 10) {
        doc.addPage();
        y = 0.5;
      }
      doc.text(comp.name, 0.5, y);
      doc.text(typeof comp.lengthIn === "number" ? comp.lengthIn.toFixed(2) : "N/A", 3.0, y);
      y += 0.2;
    }
  }

  // Output as Uint8Array
  let outStr = doc.output();
  // jsPDF generates a random document ID. We need to normalize it to guarantee exact byte match.
  outStr = outStr.replace(/\/ID \[ <[0-9a-fA-F]{32}> <[0-9a-fA-F]{32}> \]/g, "/ID [ <00000000000000000000000000000000> <00000000000000000000000000000000> ]");

  // Since we only used standard ASCII fonts in this pure renderer, we can safely convert the string to Uint8Array.
  // We use charCodeAt to preserve raw bytes (jsPDF output string is effectively a byte string).
  const result = new Uint8Array(outStr.length);
  for (let i = 0; i < outStr.length; i++) {
    result[i] = outStr.charCodeAt(i) & 0xff;
  }
  return result;
}
