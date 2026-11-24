import { beforeEach, describe, expect, it, vi } from "vitest";

describe("readQboSnapshot active QBO_ENVIRONMENT row", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("filters qbo_auth_tokens by getQboTokenId (production => id=true)", async () => {
    const limit = vi.fn().mockResolvedValue([
      { hasRefresh: true, expiresAt: new Date("2026-10-01T00:00:00.000Z") },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    // second select for failed sagas
    select
      .mockReturnValueOnce({ from })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ n: 0 }]),
        }),
      });

    vi.doMock("@/server/db/client", () => ({ getDb: () => ({ select }) }));
    const getQboTokenId = vi.fn().mockReturnValue(true);
    vi.doMock("@/server/integrations/qbo/client", () => ({ getQboTokenId }));

    const { readQboSnapshot } = await import("@/server/mission-control/health-probes");
    const snap = await readQboSnapshot();

    expect(getQboTokenId).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(snap).toMatchObject({
      hasTokenRow: true,
      hasRefreshToken: true,
      failedSagas: 0,
    });
  });

  it("reports disconnected when the active env row is missing (ignores sibling rows)", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi
      .fn()
      .mockReturnValueOnce({ from })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ n: 0 }]),
        }),
      });

    vi.doMock("@/server/db/client", () => ({ getDb: () => ({ select }) }));
    vi.doMock("@/server/integrations/qbo/client", () => ({
      getQboTokenId: () => true,
    }));

    const { readQboSnapshot } = await import("@/server/mission-control/health-probes");
    const snap = await readQboSnapshot();
    expect(snap.hasTokenRow).toBe(false);
    expect(snap.hasRefreshToken).toBe(false);
  });
});
