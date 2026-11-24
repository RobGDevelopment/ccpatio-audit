import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveQboConnectionStatus,
} from "@/server/mission-control/qbo-connection";
import { canInitiateQboOAuth } from "@/server/integrations/qbo/oauth";

describe("deriveQboConnectionStatus", () => {
  const now = new Date("2026-11-24T16:00:00.000Z");

  it("maps refresh/expiry into Connected / Expired / Disconnected", () => {
    expect(
      deriveQboConnectionStatus({ hasRefreshToken: false, expiresAt: null, now }),
    ).toBe("Disconnected");
    expect(
      deriveQboConnectionStatus({
        hasRefreshToken: true,
        expiresAt: new Date("2026-11-24T15:00:00.000Z"),
        now,
      }),
    ).toBe("Expired");
    expect(
      deriveQboConnectionStatus({
        hasRefreshToken: true,
        expiresAt: new Date("2026-11-24T17:00:00.000Z"),
        now,
      }),
    ).toBe("Connected");
    expect(
      deriveQboConnectionStatus({ hasRefreshToken: true, expiresAt: null, now }),
    ).toBe("Connected");
  });
});

describe("canInitiateQboOAuth", () => {
  it("allows SuperAdmin and IT_Admin only", () => {
    expect(canInitiateQboOAuth("SuperAdmin")).toBe(true);
    expect(canInitiateQboOAuth("IT_Admin")).toBe(true);
    expect(canInitiateQboOAuth("Ops_Manager")).toBe(false);
    expect(canInitiateQboOAuth(null)).toBe(false);
  });
});

describe("readQboConnectionPanel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reads the active env token row and returns panel fields", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        realmId: "913034761234567",
        expiresAt: new Date("2026-11-24T17:00:00.000Z"),
        refreshToken: "rt_live",
      },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    vi.doMock("@/server/db/client", () => ({ getDb: () => ({ select }) }));
    vi.doMock("@/server/integrations/qbo/client", () => ({
      getQboEnvironment: () => "production",
      getQboTokenId: () => true,
    }));

    const { readQboConnectionPanel } = await import(
      "@/server/mission-control/qbo-connection"
    );
    const panel = await readQboConnectionPanel(
      new Date("2026-11-24T16:00:00.000Z"),
    );

    expect(where).toHaveBeenCalled();
    expect(panel).toMatchObject({
      environment: "production",
      status: "Connected",
      realmId: "913034761234567",
      expiresAt: "2026-11-24T17:00:00.000Z",
      hasRefreshToken: true,
      reconnectPath: "/api/auth/qbo/connect",
    });
  });
});
