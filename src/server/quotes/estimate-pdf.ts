import { jsPDF } from "jspdf";
import { isDiscountType, lineExtended, quoteGrandTotal } from "@/lib/quote-financials";
import type { OrderDeskQuote } from "@/server/quotes/view";

export const QUOTE_PDF_FOOTER =
  "Order & Payment Policies: Deposit: 50% deposit required to place an order. Deposit becomes non-refundable once the factory order is approved or 2 weeks after payment. Balance: Remaining balance (non-refundable) is due 4 weeks before delivery. Shipping & Delivery: Delivery fees are billed separately. Delays beyond 2 weeks incur a 3% monthly storage fee.";

function money(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function buildEstimatePdf(quote: OrderDeskQuote): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  let y = 56;

  const ensure = (needed: number) => {
    if (y + needed <= pageHeight - 120) return;
    doc.addPage();
    y = 56;
  };

  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.text("CC Patio", margin, y);
  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.text("Showroom Estimate", margin, y + 18);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleDateString("en-US"), pageWidth - margin, y, { align: "right" });
  y += 42;

  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.text("Customer", margin, y);
  doc.setFont("times", "normal");
  y += 16;
  const customerLines = [quote.customerName?.trim() || "—", quote.customerEmail?.trim() || ""].filter(
    Boolean,
  );
  for (const line of customerLines) {
    doc.text(line, margin, y);
    y += 14;
  }
  y += 8;

  const columnWidth = contentWidth / 2 - 8;
  const addressY = y;
  doc.setFont("times", "bold");
  doc.text("Bill To", margin, y);
  doc.text("Ship To", margin + contentWidth / 2, y);
  doc.setFont("times", "normal");
  const bill = doc.splitTextToSize(quote.billToAddress?.trim() || "—", columnWidth);
  const ship = doc.splitTextToSize(quote.shipToAddress?.trim() || "—", columnWidth);
  doc.text(bill, margin, y + 16);
  doc.text(ship, margin + contentWidth / 2, y + 16);
  y = addressY + 16 + Math.max(bill.length, ship.length) * 12 + 18;

  ensure(40);
  doc.setFont("times", "bold");
  doc.text("Description", margin, y);
  doc.text("Qty", margin + 300, y);
  doc.text("Price", margin + 360, y);
  doc.text("Amount", pageWidth - margin, y, { align: "right" });
  y += 8;
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;
  doc.setFont("times", "normal");

  if (quote.lines.length === 0) {
    doc.text("No line items.", margin, y);
    y += 18;
  }

  for (const line of quote.lines) {
    const description = doc.splitTextToSize(line.description, 280);
    const extended = lineExtended(line.unitPrice, line.qty);
    const rowHeight = Math.max(description.length, 1) * 13 + 6;
    ensure(rowHeight);
    doc.text(description, margin, y);
    doc.text(String(Number(line.qty) || line.qty), margin + 300, y);
    doc.text(line.unitPrice != null ? money(Number(line.unitPrice)) : "—", margin + 360, y);
    doc.text(extended != null ? money(extended) : "—", pageWidth - margin, y, { align: "right" });
    y += rowHeight;
  }

  const subtotal = quote.lines.reduce(
    (sum, line) => sum + (lineExtended(line.unitPrice, line.qty) ?? 0),
    0,
  );
  const shipping = quote.freightTotal != null ? Number(quote.freightTotal) : 0;
  const summary = quoteGrandTotal({
    subtotal,
    discountAmount: Number(quote.discountAmount),
    discountType: isDiscountType(quote.discountType) ? quote.discountType : "FLAT",
    tax: Number(quote.taxAmount),
    shipping: Number.isFinite(shipping) ? shipping : 0,
  });

  y += 8;
  ensure(90);
  doc.line(margin + 280, y, pageWidth - margin, y);
  y += 16;
  const row = (label: string, amount: number) => {
    doc.text(label, margin + 300, y);
    doc.text(money(amount), pageWidth - margin, y, { align: "right" });
    y += 16;
  };
  row("Subtotal", subtotal);
  row(
    quote.discountType === "PERCENTAGE" ? `Discount (${Number(quote.discountAmount)}%)` : "Discount",
    summary.discount,
  );
  row("Tax", summary.tax);
  row("Shipping", summary.shipping);
  doc.setFont("times", "bold");
  row("Total", summary.total);
  doc.setFont("times", "normal");

  const footerLines = doc.splitTextToSize(QUOTE_PDF_FOOTER, contentWidth);
  const footerHeight = footerLines.length * 11 + 8;
  let footerY = pageHeight - margin - footerHeight;
  if (y + 12 > footerY) {
    doc.addPage();
    footerY = pageHeight - margin - footerHeight;
  }
  doc.setFontSize(8);
  doc.text(footerLines, margin, footerY);

  return new Uint8Array(doc.output("arraybuffer"));
}
