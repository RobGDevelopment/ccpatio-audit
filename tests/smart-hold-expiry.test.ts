import { describe, expect, it } from "vitest";
import {
  formatHoldExpiry,
  holdExpiresAtFromDays,
  holdWarningWindow,
  SHOWROOM_HOLD_TTL_DAYS,
  showroomHoldExpiresAt,
} from "@/lib/inventory-holds";

describe("smart hold clock", () => {
  const now = new Date("2026-10-02T15:00:00.000Z");

  it("sets a new hold 14 days out", () => {
    expect(showroomHoldExpiresAt(now).toISOString()).toBe("2026-10-16T15:00:00.000Z");
    expect(SHOWROOM_HOLD_TTL_DAYS).toBe(14);
  });

  it("extends from now, not from the old expiry", () => {
    expect(holdExpiresAtFromDays(14, now).toISOString()).toBe("2026-10-16T15:00:00.000Z");
  });

  it("warns only inside the 24 to 48 hour window", () => {
    const window = holdWarningWindow(now);
    expect(window.from.toISOString()).toBe("2026-10-03T15:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-10-04T15:00:00.000Z");
  });

  it("labels the countdown in days until the warning window", () => {
    expect(formatHoldExpiry("2026-10-05T15:00:00.000Z", now)).toBe("Expires in 3 days");
    expect(formatHoldExpiry("2026-10-03T21:00:00.000Z", now)).toBe("Expires in 30 hours");
    expect(formatHoldExpiry("2026-10-02T15:00:00.000Z", now)).toBe("Expired");
  });
});
