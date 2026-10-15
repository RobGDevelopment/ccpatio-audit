import { z } from "zod";
import {
  getPimSession,
  isEmbedPrincipal,
  GHL_EMBED_PRINCIPAL_EMAIL,
} from "@/lib/pim-audit";
import { ERROR_MESSAGES } from "@/lib/intake/copy";
import { generateIntakeRef } from "./errors";

const EmailSchema = z.string().email().max(254);

export type IntakeActorSource = "operator" | "embed-reported" | "embed-unattributed";

export type IntakeActor = {
  email: string;
  source: IntakeActorSource;
  verified: boolean;
};

export type ResolveActorResult =
  | { ok: true; actor: IntakeActor }
  | { ok: false; code: "NOT_SIGNED_IN"; message: string; ref: string };

/**
 * Resolves the authenticated actor for the intake embed.
 *
 * NOTE: ghlUserEmail is an unsigned URL merge field. It is a label for the
 * audit trail only, NEVER an authorization input. It never grants override or
 * elevated privileges.
 */
export async function resolveIntakeActor(options?: {
  reportedEmail?: string | null;
}): Promise<ResolveActorResult> {
  const session = await getPimSession();
  if (!session) {
    const ref = generateIntakeRef();
    return {
      ok: false,
      code: "NOT_SIGNED_IN",
      message: ERROR_MESSAGES.NOT_SIGNED_IN,
      ref,
    };
  }

  // 1. Real operator session outranks reported email and is verified
  if (!isEmbedPrincipal(session)) {
    return {
      ok: true,
      actor: {
        email: session.email,
        source: "operator",
        verified: true,
      },
    };
  }

  // 2. Synthetic embed principal with reported email from URL
  if (options?.reportedEmail) {
    const parsed = EmailSchema.safeParse(options.reportedEmail.trim().toLowerCase());
    if (parsed.success) {
      return {
        ok: true,
        actor: {
          email: parsed.data,
          source: "embed-reported",
          verified: false,
        },
      };
    }
  }

  // 3. Fallback unattributed embed principal
  return {
    ok: true,
    actor: {
      email: GHL_EMBED_PRINCIPAL_EMAIL,
      source: "embed-unattributed",
      verified: false,
    },
  };
}
