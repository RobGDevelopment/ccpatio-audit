import { describe, expect, it } from "vitest";
import { hasOverrideAuthority, PATH_A_OVERRIDE_ROLES } from "@/server/path-a/authz";
import { GHL_EMBED_PRINCIPAL_EMAIL, type PimSession } from "@/lib/pim-audit";

describe("Path A Authz (hasOverrideAuthority)", () => {
  it("rejects null or undefined session", () => {
    expect(hasOverrideAuthority(null)).toBe(false);
    expect(hasOverrideAuthority(undefined)).toBe(false);
  });

  it("rejects embed principal regardless of role", () => {
    const embedSession: PimSession = {
      email: GHL_EMBED_PRINCIPAL_EMAIL,
      name: "GHL Embed",
      ghl_role: "admin",
    };
    expect(hasOverrideAuthority(embedSession)).toBe(false);
  });

  it("rejects sessions with missing or empty ghl_role", () => {
    const s1: PimSession = { email: "user@ccpatio.com", name: "User" };
    expect(hasOverrideAuthority(s1)).toBe(false);

    const s2: PimSession = { email: "user@ccpatio.com", name: "User", ghl_role: "" };
    expect(hasOverrideAuthority(s2)).toBe(false);

    const s3: PimSession = { email: "user@ccpatio.com", name: "User", ghl_role: "   " };
    expect(hasOverrideAuthority(s3)).toBe(false);
  });

  it("rejects non-string ghl_role types (fail closed)", () => {
    const s1 = { email: "user@ccpatio.com", name: "User", ghl_role: 123 } as unknown as PimSession;
    expect(hasOverrideAuthority(s1)).toBe(false);

    const s2 = { email: "user@ccpatio.com", name: "User", ghl_role: true } as unknown as PimSession;
    expect(hasOverrideAuthority(s2)).toBe(false);

    const s3 = { email: "user@ccpatio.com", name: "User", ghl_role: ["admin"] } as unknown as PimSession;
    expect(hasOverrideAuthority(s3)).toBe(false);

    const s4 = { email: "user@ccpatio.com", name: "User", ghl_role: { role: "admin" } } as unknown as PimSession;
    expect(hasOverrideAuthority(s4)).toBe(false);
  });

  it("rejects unknown roles including administrator, manager, etc.", () => {
    const make = (role: string): PimSession => ({ email: "user@ccpatio.com", name: "User", ghl_role: role });
    expect(hasOverrideAuthority(make("administrator"))).toBe(false);
    expect(hasOverrideAuthority(make("manager"))).toBe(false);
    expect(hasOverrideAuthority(make("superadmin"))).toBe(false);
    expect(hasOverrideAuthority(make("owner"))).toBe(false);
    expect(hasOverrideAuthority(make("operator"))).toBe(false);
  });

  it("accepts valid 'admin' role with whitespace trimming and case insensitivity", () => {
    const make = (role: string): PimSession => ({ email: "admin@ccpatio.com", name: "Admin", ghl_role: role });
    expect(hasOverrideAuthority(make("admin"))).toBe(true);
    expect(hasOverrideAuthority(make("ADMIN"))).toBe(true);
    expect(hasOverrideAuthority(make("  admin  "))).toBe(true);
    expect(hasOverrideAuthority(make("Admin"))).toBe(true);
  });

  it("asserts PATH_A_OVERRIDE_ROLES contains exactly 'admin'", () => {
    expect(PATH_A_OVERRIDE_ROLES).toEqual(["admin"]);
  });
});
