import { describe, expect, it } from "vitest";
import {
  isCcpatioEmail,
  signPimSession,
  verifyPimSessionToken,
} from "@/lib/pim-session";

describe("pim-session", () => {
  it("accepts @ccpatio.com addresses and specific gmail", () => {
    expect(isCcpatioEmail("jane@ccpatio.com")).toBe(true);
    expect(isCcpatioEmail("Jane@CCPatio.com")).toBe(true);
    expect(isCcpatioEmail("rjg.cal@gmail.com")).toBe(true);
    expect(isCcpatioEmail("jane@gmail.com")).toBe(false);
    expect(isCcpatioEmail("jane@notccpatio.com")).toBe(false);
  });

  it("round-trips signed session tokens", async () => {
    process.env.PIM_SESSION_SECRET = "test-secret-for-vitest";
    const token = await signPimSession("ops@ccpatio.com", "Ops User");
    const session = await verifyPimSessionToken(token);
    expect(session?.email).toBe("ops@ccpatio.com");
    expect(session?.name).toBe("Ops User");
  });
});
