import { RetryAfterError } from "inngest";
import { KatanaApiError, katanaRateLimitStore } from "@/lib/katana";

export async function runKatanaStep<T>(
  step: { run: (id: string, fn: () => Promise<T>) => Promise<T> },
  id: string,
  fn: () => Promise<T>
): Promise<T> {
  return step.run(id, async () => {
    try {
      return await katanaRateLimitStore.run("defer", fn);
    } catch (error) {
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
