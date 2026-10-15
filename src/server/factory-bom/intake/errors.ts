import { ERROR_MESSAGES, type IntakeErrorCode } from "@/lib/intake/copy";
import type { ActionResult, IntakeFailureResult } from "@/lib/intake/types";
import { PathAFenceError } from "@/server/path-a/katana-fence";

export class IntakeDomainError extends Error {
  public readonly code: IntakeErrorCode;
  public readonly fieldErrors?: Record<string, string>;
  public readonly details?: unknown;

  constructor(
    code: IntakeErrorCode,
    message?: string,
    options?: { fieldErrors?: Record<string, string>; details?: unknown }
  ) {
    super(message || ERROR_MESSAGES[code]);
    this.name = "IntakeDomainError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.details = options?.details;
  }
}

export function redact(text: string): string {
  if (!text || typeof text !== "string") return "";

  let result = text
    // Postgres URLs
    .replace(/postgres:\/\/[^@\s]+@[^\s]+/gi, "postgres://[REDACTED]")
    // Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    // Signed URLs and tokens
    .replace(/([?&]token=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/[^\s]+(?:\/sign\/|\/signed\/)[^\s]+)/gi, "[SIGNED_URL_REDACTED]")
    // JWT strings
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[JWT_REDACTED]");

  // Secret environment variables
  const secrets = [
    process.env.GHL_EMBED_SECRET,
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.POSTGRES_URL,
  ].filter((s): s is string => Boolean(s && s.length > 5));

  for (const secret of secrets) {
    result = result.split(secret).join("[REDACTED]");
  }

  return result;
}

export function generateIntakeRef(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
}

export function toIntakeFailure(
  error: unknown,
  where: string,
  extra?: { actorEmail?: string; details?: unknown }
): IntakeFailureResult {
  const ref = generateIntakeRef();

  let code: IntakeErrorCode = "INTERNAL";
  let fieldErrors: Record<string, string> | undefined;
  let details = extra?.details;
  let customMessage: string | undefined;

  if (error instanceof IntakeDomainError) {
    code = error.code;
    fieldErrors = error.fieldErrors;
    if (error.details) details = error.details;
    if (error.message) customMessage = error.message;
  } else if (error instanceof PathAFenceError) {
    code = "PROJECT_LOCKED";
  } else if (error && typeof error === "object" && "code" in error) {
    const errCode = String((error as { code: unknown }).code);
    if (errCode in ERROR_MESSAGES) {
      code = errCode as IntakeErrorCode;
    } else if (errCode === "23505") {
      code = "CONFLICT_RETRY";
    }
  }

  const message = customMessage || ERROR_MESSAGES[code] || "Something went wrong on our side.";

  const rawMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : "UnknownError";

  // Structured server log line with redaction
  const logLine = JSON.stringify({
    tag: "embed-intake-error",
    ref,
    code,
    where,
    actorEmail: extra?.actorEmail,
    errorName,
    message: redact(rawMessage),
  });

  console.error(logLine);

  return {
    ok: false,
    code,
    message,
    ref,
    fieldErrors,
    retryAfterSeconds: code === "UPSTREAM_BUSY" ? 5 : undefined,
    details,
  };
}
