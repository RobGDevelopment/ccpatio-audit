import { asGhlRecord } from "@/server/ghl/private-api";

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function zip5(raw: string): string {
  const match = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match?.[1] ?? "";
}

/** Five-digit ZIP from a GoHighLevel contact or opportunity record. */
export function postalZip(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const direct = [
    record.postalCode,
    record.postal_code,
    record.zipCode,
    record.zip_code,
    record.zip,
  ];
  for (const value of direct) {
    const zip = zip5(text(value));
    if (zip) return zip;
  }
  const address = asGhlRecord(record.address);
  if (!address) return null;
  const nested =
    zip5(text(address.postalCode)) ||
    zip5(text(address.postal_code)) ||
    zip5(text(address.zip)) ||
    zip5(text(address.zipCode));
  return nested || null;
}
