import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissionControlUnauthorizedError } from "@/server/mission-control/require-role";

const auth = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());

vi.mock("@/app/mission-control/actions", () => ({
  requireMissionControlAuth: () => auth(),
}));

vi.mock("@/server/alerts/oh-crap", () => ({
  sendOhCrapAlert: (...args: unknown[]) => send(...args),
}));

import { raiseEscalationAction } from "@/app/mission-control/escalation-action";

describe("raiseEscalationAction", () => {
  beforeEach(() => {
    auth.mockReset();
    send.mockReset();
    auth.mockResolvedValue({ id: "user-1", email: "ops@ccpatio.com", role: "SuperAdmin" });
    send.mockResolvedValue({ ok: true, emailed: true, resolutionUrl: "http://localhost:3000/mission-control" });
  });

  it("refuses an empty message", async () => {
    const result = await raiseEscalationAction("   ");
    expect(result).toEqual({ ok: false, error: "A message is required." });
    expect(send).not.toHaveBeenCalled();
  });

  it("calls sendOhCrapAlert once for a valid message", async () => {
    const result = await raiseEscalationAction("  Katana hold did not release.  ");
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      reason: "unknown",
      source: "system",
      externalId: "mission-control",
      message: "Katana hold did not release.",
      resolutionPath: "/mission-control",
    });
  });

  it("rejects Ops_Manager before send", async () => {
    auth.mockRejectedValue(
      new MissionControlUnauthorizedError(
        "INSUFFICIENT_ROLE",
        "Unauthorized: Insufficient permissions.",
      ),
    );
    const result = await raiseEscalationAction("Need a person.");
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(send).not.toHaveBeenCalled();
  });
});
