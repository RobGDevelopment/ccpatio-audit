import { GHL_EMBED_PRINCIPAL_EMAIL } from "@/lib/pim-audit";

/**
 * Freight and mile overrides require a real operator role.
 * The embed principal is never that role, even when the iframe is open.
 */
export function commercialOverrideAllowed(input: {
  email: string | null;
  role: string | null;
}): boolean {
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!email || email === GHL_EMBED_PRINCIPAL_EMAIL) return false;
  return input.role === "Ops_Manager" || input.role === "SuperAdmin";
}
