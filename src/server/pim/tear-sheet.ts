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
      const meta = await sharp(Buffer.from(res.bytes)).metadata();
      const width = meta.width || 0;
      const height = meta.height || 0;
      if (Math.max(width, height) < 1200) {
        return { pdf: null, omitted: [{ sku: globalSku, reason: "Hero image does not meet 1200px minimum" }] };
      }
      imgWidth = width;
      imgHeight = height;
      base64 = Buffer.from(res.bytes).toString('base64');
      ext = primaryImage.content_type.split('/').pop()?.toUpperCase() || 'JPEG';
      if (ext === 'WEBP') ext = 'WEBP';
    } else {
      return { pdf: null, omitted: [{ sku: globalSku, reason: "Missing Hero Image data" }] };
    }
  } catch (err) {
    return { pdf: null, omitted: [{ sku: globalSku, reason: "Failed to process Hero Image" }] };
  }

  const doc = new jsPDF({ unit: "mm", format: "letter" });
  
  // Title
  doc.setFontSize(22);
  doc.text(list.product_name || globalSku, 20, 20);
  
  // SKU & Collection
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text(`${globalSku}  •  ${list.collection_label || "No Collection"}`, 20, 30);
  
  // Dimensions
  let y = 45;
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text("Dimensions", 20, y);
  
  doc.setFontSize(11);
  doc.setTextColor(80);
  y += 8;
  const na = new Set(cat.na_fields || []);
  const dims = [
    cat.length && !na.has("length") ? `L: ${cat.length}` : null,
    cat.depth && !na.has("depth") ? `D: ${cat.depth}` : null,
    cat.height && !na.has("height") ? `H: ${cat.height}` : null,
    cat.arm_height && !na.has("arm_height") ? `AH: ${cat.arm_height}` : null,
    cat.sit_height && !na.has("sit_height") ? `SH: ${cat.sit_height}` : null,
  ].filter(Boolean).join("  |  ");
  
  doc.text(dims || "Dimensions not specified", 20, y);

  // MSRP
  y += 15;
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text("Pricing", 20, y);
  
  doc.setFontSize(11);
  doc.setTextColor(80);
  y += 8;
  let msrpText = "";
  if (map.product_origin === "third_party") {
    msrpText = `Retail: $${list.steel_msrp || "TBD"}`;
  } else {
    const prices = [];
    if (list.steel_msrp) prices.push(`Steel: $${list.steel_msrp}`);
    if (list.aluminum_msrp) prices.push(`Aluminum: $${list.aluminum_msrp}`);
    msrpText = prices.join("  |  ") || "MSRP: TBD";
  }
  doc.text(msrpText, 20, y);

  // Copy
  y += 15;
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text("Description", 20, y);
  
  doc.setFontSize(11);
  doc.setTextColor(60);
  y += 8;
  const copy = storyHtmlToPlainText(list.marketing_description);
  const splitTitle = doc.splitTextToSize(copy, 170);
  doc.text(splitTitle, 20, y);
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const footerY = pageHeight - 12;
  doc.setFontSize(9);
  doc.setTextColor(150);
  let footerText = "Finish and fabric shown are representative. Specification is confirmed at order.";
  if (cat.warranty_term_months) {
    footerText += ` Warranty: ${cat.warranty_term_months} months.`;
  }
  const footerLines = doc.splitTextToSize(footerText, pageWidth - margin * 2) as string[];
  doc.text(footerLines, margin, footerY - (footerLines.length - 1) * 4);

  if (base64 && imgWidth && imgHeight) {
    const startY = y + splitTitle.length * 6 + 8;
    const maxW = pageWidth - margin * 2;
    const maxH = Math.max(20, footerY - footerLines.length * 4 - 6 - startY);
    let renderWidth = maxW;
    let renderHeight = renderWidth * (imgHeight / imgWidth);
    if (renderHeight > maxH) {
      renderHeight = maxH;
      renderWidth = renderHeight * (imgWidth / imgHeight);
    }
    const x = margin + (maxW - renderWidth) / 2;
    doc.addImage(base64, ext, x, startY, renderWidth, renderHeight);
  }

  return { pdf: doc.output('datauristring'), omitted: [] };
}
