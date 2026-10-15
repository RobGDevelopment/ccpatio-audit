/**
 * Zero-trust structured logging.
 *
 * Every server-side failure is written as ONE line of JSON. The line carries the error
 * class name, an optional machine code, and `ref`, a short digest of the error message.
 * It never carries `err.message` or `err.stack`, because provider error text can echo
 * tokens, SQL parameters, or customer data. `ref` lets an operator correlate a webhook
 * response with a log line without the text itself ever reaching the log.
 */
import { createHash } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

export type ErrorFingerprint = {
  /** Error class name, or the typeof for a non-Error throw. */
  errorName: string;
  /** Stable machine code (`error.code`) when it looks like a code, never free text. */
  errorCode: string | null;
  /** First 12 hex chars of sha256(name + ":" + message). Correlation only. */
  ref: string;
};

const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,48}$/;
/** Field names that must never be written, even if a caller passes them by mistake. */
const FORBIDDEN_KEYS = new Set(["message", "stack", "errmessage", "errstack"]);

export function fingerprintError(error: unknown): ErrorFingerprint {
  let name: string = typeof error;
  let message = "";
  let code: string | null = null;

  if (error instanceof Error) {
    name = error.name || "Error";
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }

  if (error !== null && typeof error === "object" && "code" in error) {
    const raw = (error as { code?: unknown }).code;
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
    if (CODE_PATTERN.test(text)) code = text;
  }

  const ref = createHash("sha256").update(`${name}:${message}`).digest("hex").slice(0, 12);
  return { errorName: name, errorCode: code, ref };
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/** One JSON line. `tag` first so grep and the DLQ tooling can key on it. */
export function logStructured(
  level: LogLevel,
  tag: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    tag,
    level,
    ts: new Date().toISOString(),
    ...sanitizeFields(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Log a caught error and return its `ref` so the caller can hand it back in an HTTP
 * body. Always uses level `error`.
 */
export function logError(
  tag: string,
  error: unknown,
  fields: Record<string, unknown> = {},
): string {
  const fingerprint = fingerprintError(error);
  logStructured("error", tag, {
    ...fields,
    errorName: fingerprint.errorName,
    errorCode: fingerprint.errorCode,
    ref: fingerprint.ref,
  });
  return fingerprint.ref;
}
