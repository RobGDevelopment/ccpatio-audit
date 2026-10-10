import { beforeEach, describe, expect, it, vi } from "vitest";
import { GHL_EMBED_PRINCIPAL_EMAIL } from "@/lib/pim-audit";

const db = vi.hoisted(() => ({
  rows: [] as { role: string }[],
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => db.rows,
        }),
      }),
    }),
  }),
}));

import {
  MissionControlUnauthorizedError,
  requireMissionControlRole,
} from "@/server/mission-control/require-role";

describe("requireMissionControlRole", () => {
  beforeEach(() => {
    db.rows = [];
  });

  it("allows SuperAdmin", async () => {
    db.rows = [{ role: "SuperAdmin" }];
    await expect(requireMissionControlRole("user-super", "ops@ccpatio.com")).resolves.toBe(
      "SuperAdmin",
    );
  });

  it("allows IT_Admin", async () => {
    db.rows = [{ role: "IT_Admin" }];
    await expect(requireMissionControlRole("user-it", "it@ccpatio.com")).resolves.toBe("IT_Admin");
  });

  it("refuses Ops_Manager", async () => {
    db.rows = [{ role: "Ops_Manager" }];
    await expect(requireMissionControlRole("user-ops", "ops@ccpatio.com")).rejects.toMatchObject({
      name: "MissionControlUnauthorizedError",
      code: "INSUFFICIENT_ROLE",
    });
  });

  it("refuses Designer", async () => {
    db.rows = [{ role: "Designer" }];
    await expect(requireMissionControlRole("user-design", "design@ccpatio.com")).rejects.toBeInstanceOf(
      MissionControlUnauthorizedError,
    );
  });

  it("refuses a missing user_roles row", async () => {
    db.rows = [];
    await expect(requireMissionControlRole("user-missing", "nobody@ccpatio.com")).rejects.toMatchObject(
      { code: "ROLE_NOT_FOUND" },
    );
  });

  it("refuses the embed principal even when a SuperAdmin row exists", async () => {
    db.rows = [{ role: "SuperAdmin" }];
    await expect(
      requireMissionControlRole("user-embed", GHL_EMBED_PRINCIPAL_EMAIL),
    ).rejects.toMatchObject({ code: "EMBED_PRINCIPAL" });
  });
});
