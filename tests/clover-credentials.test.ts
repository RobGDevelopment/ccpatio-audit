import { describe, expect, it } from "vitest";
import {
  resolveCloverApiBase,
  resolveCloverBearerToken,
} from "@/server/integrations/clover/credentials";

describe("A7 Clover token env-name fallback", () => {
  it("prefers CLOVER_MERCHANT_TOKEN then falls back to CLOVER_API_TOKEN", () => {
    expect(
      resolveCloverBearerToken({
        CLOVER_MERCHANT_TOKEN: " merchant ",
        CLOVER_API_TOKEN: "api",
      }),
    ).toBe("merchant");
    expect(resolveCloverBearerToken({ CLOVER_API_TOKEN: " api-only " })).toBe("api-only");
    expect(resolveCloverBearerToken({ CLOVER_MERCHANT_TOKEN: "  " })).toBeUndefined();
    expect(resolveCloverBearerToken({})).toBeUndefined();
  });

  it("resolves API base from CLOVER_API_BASE then CLOVER_API_URL", () => {
    expect(
      resolveCloverApiBase({
        CLOVER_API_BASE: "https://apisandbox.dev.clover.com/",
        CLOVER_API_URL: "https://api.clover.com",
      }),
    ).toBe("https://apisandbox.dev.clover.com");
    expect(resolveCloverApiBase({ CLOVER_API_URL: "https://api.clover.com/" })).toBe(
      "https://api.clover.com",
    );
    expect(resolveCloverApiBase({})).toBe("https://api.clover.com");
  });
});
