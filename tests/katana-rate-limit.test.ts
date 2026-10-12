import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { RetryAfterError } from "inngest";
import { katanaFetch, KatanaApiError, katanaRateLimitStore } from "@/lib/katana";
import { runKatanaStep } from "@/inngest/katana-step";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  mockFetch.mockReset();
  process.env.KATANA_PERSONAL_ACCESS_TOKEN = "test-token";
  // Override console.error to avoid test noise
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.KATANA_PERSONAL_ACCESS_TOKEN;
  vi.restoreAllMocks();
});

test("katanaFetch default policy sleeps and retries on 429", async () => {
  mockFetch.mockResolvedValueOnce({
    status: 429,
    ok: false,
    headers: new Headers({ "X-Ratelimit-Reset": (Date.now() / 1000 + 0.1).toString() }),
    text: async () => JSON.stringify({ message: "Rate limit" }),
  });
  mockFetch.mockResolvedValueOnce({
    status: 200,
    ok: true,
    headers: new Headers(),
    text: async () => JSON.stringify({ data: "success" }),
  });

  const startTime = Date.now();
  const res = await katanaFetch("/test-path");
  expect(res.status).toBe(200);
  expect(res.data).toEqual({ data: "success" });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(Date.now() - startTime).toBeGreaterThanOrEqual(50);
});

test("katanaFetch defer policy throws immediately", async () => {
  mockFetch.mockResolvedValueOnce({
    status: 429,
    ok: false,
    headers: new Headers({ "X-Ratelimit-Reset": (Date.now() / 1000 + 10).toString() }),
    text: async () => JSON.stringify({ message: "Rate limit" }),
  });

  await expect(katanaRateLimitStore.run("defer", () => katanaFetch("/test-path"))).rejects.toThrowError(
    /Katana API rate limit exceeded\. Deferring to Inngest\./
  );
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test("runKatanaStep catches defer policy 429 and throws RetryAfterError", async () => {
  mockFetch.mockResolvedValueOnce({
    status: 429,
    ok: false,
    headers: new Headers({ "X-Ratelimit-Reset": (Date.now() / 1000 + 10).toString() }),
    text: async () => JSON.stringify({ message: "Rate limit" }),
  });

  const mockStep = {
    run: async (id: string, fn: () => Promise<any>) => fn(),
  };

  try {
    await runKatanaStep(mockStep, "test-step", () => katanaFetch("/test-path"));
    expect.fail("Should have thrown RetryAfterError");
  } catch (error) {
    expect(error).toBeInstanceOf(RetryAfterError);
    // @ts-ignore
    expect(error.message).toMatch(/Katana API rate limit exceeded\. Deferring to Inngest\./);
    
    // retryAfter is string | number. If it's a number it's ms or timestamp. 
    // Inngest constructor takes ms or a date string. WaitMs is passed in our impl.
    const retryAfter = (error as any).retryAfter;
    if (typeof retryAfter === 'number') {
        expect(retryAfter).toBeGreaterThanOrEqual(10);
    } else {
        expect(Number(retryAfter) || parseInt(retryAfter as string)).toBeGreaterThanOrEqual(10);
    }
  }
});
