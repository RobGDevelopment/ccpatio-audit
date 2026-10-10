import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { user_roles } from "@/server/db/schema";

/** Synthetic GHL iframe principal. Same address as `GHL_EMBED_PRINCIPAL_EMAIL`. */
const EMBED_PRINCIPAL_EMAIL = "ghl-embed@ccpatio.com";

export type MissionControlRole = "SuperAdmin" | "IT_Admin";

export type MissionControlUnauthorizedCode =
  | "NO_SESSION"
  | "EMBED_PRINCIPAL"
  | "ROLE_NOT_FOUND"
  | "INSUFFICIENT_ROLE";

export class MissionControlUnauthorizedError extends Error {
  readonly code: MissionControlUnauthorizedCode;

  constructor(code: MissionControlUnauthorizedCode, message: string) {
    super(message);
    this.name = "MissionControlUnauthorizedError";
    this.code = code;
  }
}

export function isEmbedPrincipalEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === EMBED_PRINCIPAL_EMAIL;
}

/**
 * Single role decision for Mission Control.
 * SuperAdmin and IT_Admin pass. Every other role, a missing row, and the embed principal throw.
 * There is no embed-key parameter.
 */
export function assertMissionControlGrant(input: {
  email?: string | null;
  role: string | null | undefined;
}): MissionControlRole {
  if (isEmbedPrincipalEmail(input.email)) {
    throw new MissionControlUnauthorizedError(
      "EMBED_PRINCIPAL",
      "Unauthorized: embed principal.",
    );
  }
  if (input.role === "SuperAdmin" || input.role === "IT_Admin") {
    return input.role;
  }
  throw new MissionControlUnauthorizedError(
    input.role ? "INSUFFICIENT_ROLE" : "ROLE_NOT_FOUND",
    input.role
      ? "Unauthorized: Insufficient permissions."
      : "Unauthorized: Role not found.",
  );
}

/**
 * Reads `user_roles` through Drizzle on POSTGRES_URL.
 * Input is the auth user id. Email is used only to refuse the embed principal.
 */
export async function requireMissionControlRole(
  userId: string,
  email?: string | null,
): Promise<MissionControlRole> {
  if (isEmbedPrincipalEmail(email)) {
    throw new MissionControlUnauthorizedError(
      "EMBED_PRINCIPAL",
      "Unauthorized: embed principal.",
    );
  }

  const db = getDb();
  const [row] = await db
    .select({ role: user_roles.role })
    .from(user_roles)
    .where(eq(user_roles.id, userId))
    .limit(1);

  return assertMissionControlGrant({ email, role: row?.role });
}
