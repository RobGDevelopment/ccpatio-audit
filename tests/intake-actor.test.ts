import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveIntakeActor } from "@/server/factory-bom/intake/actor";
import { GHL_EMBED_PRINCIPAL_EMAIL } from "@/lib/pim-audit";

vi.mock("@/lib/pim-audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pim-audit")>();
  return {
    ...actual,
    getPimSession: vi.fn(),
  };
});

import { getPimSession } from "@/lib/pim-audit";

describe("Intake Actor Resolution (resolveIntakeActor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails with NOT_SIGNED_IN when no session exists", async () => {
    vi.mocked(getPimSession).mockResolvedValueOnce(null);

    const result = await resolveIntakeActor({ reportedEmail: "sales@example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_SIGNED_IN");
      expect(result.message).toBe("Please reopen this page from GoHighLevel.");
    }
  });

  it("resolves a real operator session, ignoring reported email and marking verified: true", async () => {
    vi.mocked(getPimSession).mockResolvedValueOnce({
      email: "real-operator@ccpatio.com",
      name: "Real Operator",
      ghl_role: "operator",
    });

    const result = await resolveIntakeActor({ reportedEmail: "someone-else@example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.email).toBe("real-operator@ccpatio.com");
      expect(result.actor.source).toBe("operator");
      expect(result.actor.verified).toBe(true);
    }
  });

  it("resolves an embed principal with a valid reported email as embed-reported (verified: false)", async () => {
    vi.mocked(getPimSession).mockResolvedValueOnce({
      email: GHL_EMBED_PRINCIPAL_EMAIL,
      name: "GHL Embed",
    });

    const result = await resolveIntakeActor({ reportedEmail: "rep.smith@ccpatio.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.email).toBe("rep.smith@ccpatio.com");
      expect(result.actor.source).toBe("embed-reported");
      expect(result.actor.verified).toBe(false);
    }
  });

  it("resolves an embed principal without a valid reported email as embed-unattributed", async () => {
    vi.mocked(getPimSession).mockResolvedValueOnce({
      email: GHL_EMBED_PRINCIPAL_EMAIL,
      name: "GHL Embed",
    });

    const result = await resolveIntakeActor({ reportedEmail: "invalid-email-address" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.email).toBe(GHL_EMBED_PRINCIPAL_EMAIL);
      expect(result.actor.source).toBe("embed-unattributed");
      expect(result.actor.verified).toBe(false);
    }
  });

  it("reported email never grants override authority", async () => {
    vi.mocked(getPimSession).mockResolvedValueOnce({
      email: GHL_EMBED_PRINCIPAL_EMAIL,
      name: "GHL Embed",
    });

    const result = await resolveIntakeActor({ reportedEmail: "admin@ccpatio.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Must still be verified: false
      expect(result.actor.verified).toBe(false);
      expect(result.actor.source).toBe("embed-reported");
    }
  });
});
