import { NonRetriableError, RetryAfterError } from "inngest";
import { KatanaApiError, katanaRateLimitStore } from "@/lib/katana";

/**
 * Throttle infrastructure codes (src/server/sre/katana-throttle.ts). Retrying cannot fix a
 * missing table / missing POSTGRES_URL, so these fail the run immediately (-> `function.failed`
 * -> global DLQ row + one alert) instead of retrying for hours against a broken bucket.
 * Duplicated as literals on purpose: importing katana-throttle here would pull the DB client
 * into every Katana step.
 */
const KATANA_THROTTLE_FATAL_CODES = new Set(["RATE_LIMIT_TABLE_MISSING", "RATE_LIMIT_NO_DATABASE"]);

export async function runKatanaStep<T>(
  step: { run: (id: string, fn: () => Promise<T>) => Promise<T> },
  id: string,
  fn: () => Promise<T>
): Promise<T> {
  return step.run(id, async () => {
    try {
      return await katanaRateLimitStore.run("defer", fn);
    } catch (error) {
      if (error instanceof KatanaApiError && error.code && KATANA_THROTTLE_FATAL_CODES.has(error.code)) {
        throw new NonRetriableError(error.message, { cause: error });
      }
      if (error instanceof KatanaApiError && error.status === 429) {
        let waitMs = 65000;
        if (error.rateLimitReset) {
          waitMs = Math.max(0, error.rateLimitReset * 1000 - Date.now()) + 250;
        }
        throw new RetryAfterError(error.message, waitMs);
      }
      throw error;
    }
  });
}
