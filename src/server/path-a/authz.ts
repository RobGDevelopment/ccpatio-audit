/**
 * Phase 11 Path A Management Override Authorization (M4).
 * Pure: no env, no headers, no cookies, no email or domain literals.
 * Fails closed unless session has a verified ghl_role in PATH_A_OVERRIDE_ROLES.
 */
import { isEmbedPrincipal, type PimSession } from "../../lib/pim-audit";

export const PATH_A_OVERRIDE_ROLES = ["admin"] as const;

export function hasOverrideAuthority(session: PimSession | null | undefined): boolean {
  if (!session) {
    return false;
  }
  if (isEmbedPrincipal(session)) {
    return false;
  }
  if (typeof session.ghl_role !== "string") {
    return false;
  }
  const role = session.ghl_role.trim().toLowerCase();
  if (!role) {
    return false;
  }
  return (PATH_A_OVERRIDE_ROLES as readonly string[]).includes(role);
}
