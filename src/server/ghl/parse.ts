import { asGhlRecord } from "./private-api";

export function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function records(body: unknown, key: string): Record<string, unknown>[] {
  const root = asGhlRecord(body);
  const data = asGhlRecord(root?.data);
  const lists = [root?.[key], data?.[key], root?.data];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    return list
      .map((item) => asGhlRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null);
  }
  return [];
}

export function personName(record: Record<string, unknown> | null): string {
  if (!record) return "";
  const direct =
    text(record.name) ||
    text(record.contactName) ||
    text(record.contact_name) ||
    `${text(record.firstName) || text(record.first_name)} ${text(record.lastName) || text(record.last_name)}`.trim();
  return direct;
}
