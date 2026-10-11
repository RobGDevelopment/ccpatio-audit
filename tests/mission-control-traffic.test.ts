import { describe, expect, it } from "vitest";
import type { SpokePingResult } from "@/server/mdm/token-health";
import { deriveTrafficMatrix, type SyncCountRow } from "@/server/mission-control/sync-matrix";

function ping(
  spoke: SpokePingResult["spoke"],
  ok: boolean,
  authFailed: boolean,
): SpokePingResult {
  return {
    spoke,
    ok,
    status: ok ? 200 : authFailed ? 401 : 503,
    authFailed,
    detail: "Bearer secret must not surface",
  };
}

const healthy: SpokePingResult[] = [
  ping("WordPressCore", true, false),
  ping("Katana", true, false),
  ping("WooCommerce", true, false),
  ping("Clover", true, false),
];

function lamp(spoke: SpokePingResult["spoke"], rows: SyncCountRow[], pings = healthy) {
  return deriveTrafficMatrix(pings, rows).find((entry) => entry.spoke === spoke);
}

describe("traffic matrix lamps", () => {
  it("forces red when a failed count is present", () => {
    const katana = lamp("Katana", [
      { channel: "katana", status: "failed", count: 2 },
      { channel: "katana", status: "success", count: 5 },
    ]);
    expect(katana?.lamp).toBe("red");
    expect(katana?.detail).toBe("success 5, pending 0, failed 2");
  });

  it("is amber when pending rows exist and the token is healthy", () => {
    const woo = lamp("WooCommerce", [
      { channel: "woocommerce", status: "pending", count: 1 },
      { channel: "woocommerce", status: "success", count: 3 },
    ]);
    expect(woo?.lamp).toBe("amber");
    expect(woo?.detail).toBe("success 3, pending 1, failed 0");
  });

  it("is green when every counted row is success and the token is healthy", () => {
    const clover = lamp("Clover", [{ channel: "clover", status: "success", count: 4 }]);
    expect(clover?.lamp).toBe("green");
    expect(clover?.detail).toBe("success 4, pending 0, failed 0");
  });

  it("ignores an unknown channel", () => {
    const matrix = deriveTrafficMatrix(healthy, [
      { channel: "custom", status: "failed", count: 9 },
      { channel: "katana", status: "success", count: 1 },
    ]);
    expect(matrix.map((entry) => entry.label)).toEqual([
      "WordPress",
      "Katana",
      "WooCommerce",
      "Clover",
    ]);
    expect(matrix.find((entry) => entry.spoke === "Katana")?.lamp).toBe("green");
    expect(matrix.find((entry) => entry.spoke === "WordPressCore")?.lamp).toBe("green");
  });

  it("is red when the token ping reports authFailed", () => {
    const katana = lamp(
      "Katana",
      [{ channel: "katana", status: "success", count: 4 }],
      [
        ping("WordPressCore", true, false),
        ping("Katana", false, true),
        ping("WooCommerce", true, false),
        ping("Clover", true, false),
      ],
    );
    expect(katana?.lamp).toBe("red");
    expect(katana?.detail).not.toMatch(/Bearer|secret/i);
  });

  it("is amber when the token ping is down and the failure is not auth", () => {
    const woo = lamp(
      "WooCommerce",
      [{ channel: "woocommerce", status: "success", count: 2 }],
      [
        ping("WordPressCore", true, false),
        ping("Katana", true, false),
        ping("WooCommerce", false, false),
        ping("Clover", true, false),
      ],
    );
    expect(woo?.lamp).toBe("amber");
    expect(woo?.detail).toBe("success 2, pending 0, failed 0");
  });
});
