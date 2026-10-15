/**
 * Phase 9 Task 3 — global dead-letter queue.
 *
 * Every Inngest function that exhausts its retries emits `inngest/function.failed`.
 * This handler persists one `dlq_events` row per failed run (idempotent on run_id) and
 * then sends the Oh-Crap alert. Order is deliberate:
 *   1. DB row FIRST   (the durable record must exist before anything can fail)
 *   2. alert          (skipped if a previous attempt already set alert_sent)
 *   3. alert_sent=true
 * If the alert fails we THROW so Inngest retries; the unique run_id makes the retry safe.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { resolveDlqContext } from "@/inngest/dlq-context";
import { logError, logStructured } from "@/lib/log/structured";
import { getDb } from "@/server/db/client";
import { dlq_events } from "@/server/db/schema";
import { sendOhCrapAlert, type OhCrapAlertResult } from "@/server/alerts/oh-crap";

export const GLOBAL_DLQ_HANDLER_ID = "global-dlq-handler";

/** Keys whose values must never be persisted. */
export const DLQ_REDACT_KEY_PATTERN = /token|secret|authorization|password|api[_-]?key/i;
/** original_event larger than this is replaced by a summary. */
export const DLQ_MAX_EVENT_BYTES = 256 * 1024;
export const DLQ_MAX_STACK_CHARS = 8 * 1024;
export const DLQ_MAX_MESSAGE_CHARS = 4 * 1024;
export const DLQ_REDACTED = "[REDACTED]";

/** Recursively replace the value of any key matching the redaction pattern. */
export function redactSecrets(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = DLQ_REDACT_KEY_PATTERN.test(key) ? DLQ_REDACTED : redactSecrets(child, seen);
  }
  return out;
}

/** Redact, then enforce the size cap. Never throws on odd input. */
export function prepareOriginalEvent(value: unknown): unknown {
  const redacted = redactSecrets(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted) ?? "null";
  } catch (error) {
    // Persist a marker instead of dropping the failure, and leave a trail for the operator.
    logError("dlq-original-event-unserializable", error);
    return { truncated: true, bytes: 0, keys: [], reason: "unserializable" };
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= DLQ_MAX_EVENT_BYTES) return redacted;
  const keys =
    redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)
      ? Object.keys(redacted as Record<string, unknown>)
      : [];
  return { truncated: true, bytes, keys };
}

/** Strip bearer tokens / key=value secrets that leak into free-text error messages. */
export function scrubSecretText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${DLQ_REDACTED}`)
    .replace(
      /("?(?:access_token|refresh_token|client_secret|api[_-]?key|password|authorization)"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi,
      `$1"${DLQ_REDACTED}"`,
    );
}

export function truncateStack(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const scrubbed = scrubSecretText(stack);
  return scrubbed.length > DLQ_MAX_STACK_CHARS ? scrubbed.slice(0, DLQ_MAX_STACK_CHARS) : scrubbed;
}

export type DlqRecordInput = {
  runId: string;
  functionId: string;
  eventId?: string | null;
  eventName: string;
  errorName?: string | null;
  errorMessage: string;
  errorStack?: string | null;
  originalEvent: unknown;
};

type DlqDb = Pick<ReturnType<typeof getDb>, "insert" | "select" | "update">;

/** INSERT ... ON CONFLICT (run_id) DO NOTHING. Returns true when a row was inserted. */
export async function recordDlqEvent(
  input: DlqRecordInput,
  db: DlqDb = getDb(),
): Promise<boolean> {
  const inserted = await db
    .insert(dlq_events)
    .values({
      run_id: input.runId,
      function_id: input.functionId,
      event_id: input.eventId ?? null,
      event_name: input.eventName,
      error_name: input.errorName ?? null,
      error_message: scrubSecretText(input.errorMessage).slice(0, DLQ_MAX_MESSAGE_CHARS),
      error_stack: truncateStack(input.errorStack),
      original_event: prepareOriginalEvent(input.originalEvent),
    })
    .onConflictDoNothing({ target: dlq_events.run_id })
    .returning({ id: dlq_events.id });
  return inserted.length > 0;
}

/**
 * LOOP GUARD. Inngest reports `function_id` with the app prefix
 * (`ccpatio-middleware-global-dlq-handler`), so match both the bare and prefixed id.
 * Without this, the DLQ handler failing would re-trigger itself forever.
 */
export function isDlqHandlerFunction(functionId: string | undefined | null): boolean {
  if (!functionId) return false;
  return functionId === GLOBAL_DLQ_HANDLER_ID || functionId.endsWith(`-${GLOBAL_DLQ_HANDLER_ID}`);
}

export type FunctionFailedData = {
  function_id?: string;
  run_id?: string;
  error?: { name?: string; message?: string; stack?: string } | null;
  event?: { id?: string; name?: string; data?: unknown } | null;
};

export type DlqDeps = {
  record: (input: DlqRecordInput) => Promise<boolean>;
  isAlertSent: (runId: string) => Promise<boolean>;
  markAlertSent: (runId: string) => Promise<void>;
  alert: (input: Parameters<typeof sendOhCrapAlert>[0]) => Promise<OhCrapAlertResult>;
};

const defaultDeps: DlqDeps = {
  record: (input) => recordDlqEvent(input),
  isAlertSent: async (runId) => {
    const [row] = await getDb()
      .select({ alert_sent: dlq_events.alert_sent })
      .from(dlq_events)
      .where(eq(dlq_events.run_id, runId))
      .limit(1);
    return row?.alert_sent === true;
  },
  markAlertSent: async (runId) => {
    await getDb()
      .update(dlq_events)
      .set({ alert_sent: true, updated_at: new Date() })
      .where(eq(dlq_events.run_id, runId));
  },
  alert: (input) => sendOhCrapAlert(input),
};

export type DlqOutcome =
  | { status: "ignored"; reason: "self_loop" }
  | { status: "recorded"; inserted: boolean; alerted: boolean; synthetic?: true };

/** Prefix on `error_message` when the failure event had no `run_id`. */
export const DLQ_MALFORMED_PREFIX = "[malformed failure event: no run_id] ";

/** Alert reaches nobody: the handler cannot alert about itself (loop guard), so log loudly. */
export const DLQ_ALERT_UNDELIVERED_TAG = "dlq-alert-undelivered";

/**
 * Turns the alert transport's free-text failure into a stable code plus a digest, so the
 * loud log line says WHY nobody was told without ever carrying provider text.
 */
export function classifyAlertFailure(text: string): { alertFailure: string; ref: string } {
  const ref = createHash("sha256").update(text).digest("hex").slice(0, 12);
  if (/OH_CRAP_ADMIN_EMAIL/.test(text)) return { alertFailure: "ADMIN_EMAIL_NOT_CONFIGURED", ref };
  const resend = /Resend failed \((\d{3})\)/.exec(text);
  if (resend) return { alertFailure: `RESEND_HTTP_${resend[1]}`, ref };
  return { alertFailure: "ALERT_TRANSPORT_FAILED", ref };
}

/**
 * Deterministic stand-in for a missing `run_id`:
 * `norunid:<function_id|unknown>:<event.id | first 16 hex of sha256(redacted event JSON)>`.
 * Same input => same key, so redelivery stays idempotent on the unique `run_id` column.
 */
export function syntheticRunId(data: FunctionFailedData): string {
  const fn = data.function_id?.trim() || "unknown";
  const eventId = typeof data.event?.id === "string" ? data.event.id.trim() : "";
  if (eventId) return `norunid:${fn}:${eventId}`;
  let serialized: string;
  try {
    serialized = JSON.stringify(redactSecrets(data.event ?? null)) ?? "null";
  } catch (error) {
    logError("dlq-synthetic-id-unserializable", error, { functionId: fn });
    serialized = "unserializable";
  }
  const digest = createHash("sha256").update(serialized).digest("hex").slice(0, 16);
  return `norunid:${fn}:${digest}`;
}

/** The `attempt` / `maxAttempts` the Inngest handler context exposes (BaseContext). */
export type DlqAttemptContext = { attempt?: number; maxAttempts?: number };

function isFinalAttempt(ctx: DlqAttemptContext): boolean {
  if (typeof ctx.attempt !== "number") return false;
  const max = typeof ctx.maxAttempts === "number" ? ctx.maxAttempts : 1 + DLQ_HANDLER_RETRIES;
  return ctx.attempt >= max - 1;
}

/** `retries` of `globalDlqHandler` (so total attempts = retries + 1). */
export const DLQ_HANDLER_RETRIES = 4;

/**
 * Testable core of the global DLQ handler.
 *
 * NEVER DROPS a failure: the only ignored event is the DLQ handler's own failure (loop guard).
 * A missing `run_id` gets a synthetic deterministic key, a missing `function_id` records
 * `"unknown"`.
 */
export async function handleFunctionFailed(
  data: FunctionFailedData,
  deps: DlqDeps = defaultDeps,
  attemptCtx: DlqAttemptContext = {},
): Promise<DlqOutcome> {
  const functionId = data.function_id ?? "";
  if (isDlqHandlerFunction(functionId)) {
    return { status: "ignored", reason: "self_loop" };
  }

  const synthetic = !data.run_id;
  const runId = data.run_id || syntheticRunId(data);
  const baseMessage = data.error?.message?.trim() || "Unknown error (no message on failure event)";
  const errorMessage = synthetic ? `${DLQ_MALFORMED_PREFIX}${baseMessage}` : baseMessage;

  if (synthetic) {
    logStructured("error", "dlq-malformed-failure-event", {
      functionId: functionId || "unknown",
      eventId: data.event?.id ?? null,
      syntheticRunId: runId,
    });
  }

  // 1. DB row first (idempotent on run_id). If this throws, Inngest retries the handler.
  const inserted = await deps.record({
    runId,
    functionId: functionId || "unknown",
    eventId: data.event?.id ?? null,
    eventName: data.event?.name ?? "unknown",
    errorName: data.error?.name ?? null,
    errorMessage,
    errorStack: data.error?.stack ?? null,
    originalEvent: data.event ?? {},
  });
  const outcome = (alerted: boolean): DlqOutcome => ({
    status: "recorded",
    inserted,
    alerted,
    ...(synthetic ? { synthetic: true as const } : {}),
  });

  // Double delivery / retry after a successful alert must not alert twice.
  if (await deps.isAlertSent(runId)) {
    return outcome(false);
  }

  // 2. The ONE alert for this run. Per-function id + resolution link come from the resolver
  //    (it replaced the old per-function onFailure alerts, which doubled every alert).
  const context = resolveDlqContext(functionId, data.event);
  const result = await deps.alert({
    reason: "function_failed",
    source: context.source ?? "system",
    externalId: context.externalId ?? runId,
    ...(context.sku ? { sku: context.sku } : {}),
    ...(context.resolutionPath ? { resolutionPath: context.resolutionPath } : {}),
    message: `${functionId || "unknown function"} exhausted retries: ${scrubSecretText(errorMessage).slice(0, 500)} [run ${runId}]`,
  });
  if (!result.ok) {
    if (isFinalAttempt(attemptCtx)) {
      // Final attempt, alert still undeliverable (e.g. no OH_CRAP_ADMIN_EMAIL). This handler
      // cannot alert about itself (loop guard), so the row stays alert_sent=false and this
      // line is the loud signal. No UI / redrive endpoint (out of scope).
      logStructured("error", DLQ_ALERT_UNDELIVERED_TAG, {
        runId,
        functionId: functionId || "unknown",
        ...classifyAlertFailure(result.error),
      });
    }
    // ok:false => throw so Inngest retries (safe: row exists, run_id is unique).
    throw new Error(`DLQ alert failed for run ${runId}: ${result.error}`);
  }

  // 3. Mark delivered.
  await deps.markAlertSent(runId);
  return outcome(true);
}

export const globalDlqHandler = inngest.createFunction(
  {
    id: GLOBAL_DLQ_HANDLER_ID,
    name: "Global DLQ handler",
    retries: DLQ_HANDLER_RETRIES,
    triggers: [{ event: "inngest/function.failed" }],
  },
  async ({ event, attempt, maxAttempts }) =>
    handleFunctionFailed(event.data as FunctionFailedData, undefined, { attempt, maxAttempts }),
);
