import { jsPDF } from "jspdf";
import { getDb } from "@/server/db/client";
import { and, eq } from "drizzle-orm";
import {
  sku_mappings,
  finished_goods_catalog,
  ecommerce_listings,
  product_assets,
} from "@/server/db/schema";
import { storyHtmlToPlainText } from "./html-sanitize";
import { getPimSession, isEmbedPrincipal } from "@/lib/pim-audit";
import sharp from "sharp";

export async function generateTearSheetPdf(
  globalSku: string,
  listingId?: string,
): Promise<{ pdf: string | null; omitted: { sku: string; reason: string }[] }> {
  const session = await getPimSession();
  if (!session || isEmbedPrincipal(session) || !/@ccpatio\.com$/i.test(session.email)) {
    throw new Error("Unauthorized");
  }

  const db = getDb();
  
  const listingWhere = listingId
    ? and(eq(ecommerce_listings.id, listingId), eq(ecommerce_listings.global_sku, globalSku))
    : eq(ecommerce_listings.global_sku, globalSku);
  const [[map], [cat], [list], assets] = await Promise.all([
    db.select().from(sku_mappings).where(eq(sku_mappings.global_sku, globalSku)),
    db.select().from(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, globalSku)),
    db.select().from(ecommerce_listings).where(listingWhere).limit(1),
    db.select().from(product_assets).where(eq(product_assets.global_sku, globalSku)),
  ]);

  if (!map || !cat || !list) {
    return { pdf: null, omitted: [{ sku: globalSku, reason: "Product data incomplete" }] };
  }

  if (!list.marketing_description) {
    return { pdf: null, omitted: [{ sku: globalSku, reason: "Missing Marketing Copy" }] };
  }

  const primaryImage = assets.find(a => a.kind === "primary_image" && a.is_current);
  if (!primaryImage) {
    return { pdf: null, omitted: [{ sku: globalSku, reason: "Missing Hero Image" }] };
  }

  let base64 = "";
  let ext = "JPEG";
  let imgWidth = 0;
  let imgHeight = 0;
  try {
    const { getVaultStorage } = await import("@/lib/supabase-storage");
    const storage = getVaultStorage();
    const res = await storage.download("product-images", primaryImage.storage_path);
    if ('bytes' in res && res.bytes) {
      const source = Buffer.from(res.bytes);
      const meta = await sharp(source).metadata();
      const width = meta.width || 0;
      const height = meta.height || 0;
      if (Math.max(width, height) < 1200) {
        return { pdf: null, omitted: [{ sku: globalSku, reason: "Hero image does not meet 1200px minimum" }] };
      }
      const jpeg = await sharp(source)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      const placed = await sharp(jpeg).metadata();
      imgWidth = placed.width || width;
      imgHeight = placed.height || height;
      base64 = jpeg.toString("base64");
      ext = "JPEG";
    } else {
      return { pdf: null, omitted: [{ sku: globalSku, reason: "Missing Hero Image data" }] };
    }
  } catch (err) {
    return { pdf: null, omitted: [{ sku: globalSku, reason: "Failed to process Hero Image" }] };
  }

  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageWidth - margin * 2;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 12, "F");
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text("CC PATIO", margin, 8);
  if (list.collection_label) {
    doc.text(list.collection_label.toUpperCase(), pageWidth - margin, 8, { align: "right" });
  }

  let y = 18;
  if (base64 && imgWidth && imgHeight) {
    const maxH = 108;
    let renderWidth = contentW;
    let renderHeight = renderWidth * (imgHeight / imgWidth);
    if (renderHeight > maxH) {
      renderHeight = maxH;
      renderWidth = renderHeight * (imgWidth / imgHeight);
    }
    const x = margin + (contentW - renderWidth) / 2;
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, contentW, renderHeight, "F");
    doc.addImage(base64, ext, x, y, renderWidth, renderHeight);
    y += renderHeight + 8;
  }

  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42);
  const nameLines = doc.splitTextToSize(list.product_name || globalSku, contentW) as string[];
  doc.text(nameLines, margin, y);
  y += nameLines.length * 8 + 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(globalSku, margin, y);
  y += 7;

  const money = (raw: string | null) => {
    if (!raw) return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return raw;
    return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  };
  const prices: string[] = [];
  if (map.product_origin === "third_party") {
    const retail = money(list.steel_msrp);
    if (retail) prices.push(retail);
  } else {
    const steel = money(list.steel_msrp);
    const aluminum = money(list.aluminum_msrp);
    if (steel) prices.push(`Steel  ${steel}`);
    if (aluminum) prices.push(`Aluminum  ${aluminum}`);
  }
  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(prices.join("     ") || "Price on request", margin, y);
  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  const na = new Set(cat.na_fields || []);
  const inches = (value: string) => {
    const trimmed = value.trim();
    return trimmed.endsWith('"') ? trimmed : `${trimmed}"`;
  };
  const dims = [
    cat.length && !na.has("length") ? `Length  ${inches(cat.length)}` : null,
    cat.depth && !na.has("depth") ? `Depth  ${inches(cat.depth)}` : null,
    cat.height && !na.has("height") ? `Height  ${inches(cat.height)}` : null,
    cat.arm_height && !na.has("arm_height") ? `Arm  ${inches(cat.arm_height)}` : null,
    cat.sit_height && !na.has("sit_height") ? `Seat  ${inches(cat.sit_height)}` : null,
  ].filter((part): part is string => Boolean(part));

  if (dims.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("DIMENSIONS", margin, y);
    y += 5;
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    const dimLines = doc.splitTextToSize(dims.join("      "), contentW) as string[];
    doc.text(dimLines, margin, y);
    y += dimLines.length * 5 + 4;
  }

  const footerText = cat.warranty_term_months
    ? `Finish and fabric shown are representative. Specification is confirmed at order. Warranty: ${cat.warranty_term_months} months.`
    : "Finish and fabric shown are representative. Specification is confirmed at order.";
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  const footerLines = doc.splitTextToSize(footerText, contentW) as string[];
  const footerTop = pageHeight - 8 - footerLines.length * 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("ABOUT THIS PIECE", margin, y);
  y += 5;
  doc.setFont("times", "normal");
  doc.setFontSize(11);
  doc.setTextColor(51, 65, 85);
  const copy = storyHtmlToPlainText(list.marketing_description);
  const copyLines = doc.splitTextToSize(copy, contentW) as string[];
  const lineH = 5;
  const room = Math.max(1, Math.floor((footerTop - 4 - y) / lineH));
  const visible = copyLines.slice(0, room);
  if (copyLines.length > room && visible.length > 0) {
    const last = visible[visible.length - 1];
    visible[visible.length - 1] = last.length > 3 ? `${last.slice(0, last.length - 1).trimEnd()}…` : "…";
  }
  doc.text(visible, margin, y);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(footerLines, margin, footerTop);

  return { pdf: doc.output("datauristring"), omitted: [] };
}
