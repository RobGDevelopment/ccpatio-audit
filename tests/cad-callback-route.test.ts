import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";

const hoisted = vi.hoisted(() => ({
  inngestSends: [] as any[],
  throwInngest: false,
  auditRows: [] as any[],
  uploadStatus: "awaiting_convert" as string | null,
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn(async (payload: any) => {
      if (hoisted.throwInngest) {
        throw new Error("Inngest transport down");
      }
      hoisted.inngestSends.push(payload);
      return { ids: ["msg-1"] };
    }),
  },
}));

vi.mock("@/server/webhooks/incoming-log", () => ({
  insertIncomingWebhookOnce: vi.fn(async (input: any) => {
    hoisted.auditRows.push(input);
    return "inserted";
  }),
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (!hoisted.uploadStatus) return [];
            return [{ id: "upl-test-1", status: hoisted.uploadStatus }];
          },
        }),
      }),
    }),
  }),
}));

import { POST } from "@/app/api/webhooks/cad-callback/route";

const SECRET = "cad-test-secret-456";

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function makeRequest(body: string, sigHeader?: string | null): NextRequest {
  const headers = new Headers();
  if (sigHeader !== null && sigHeader !== undefined) {
    headers.set("x-ccpatio-signature", sigHeader);
  }
  return new NextRequest("http://localhost:3000/api/webhooks/cad-callback", {
    method: "POST",
    headers,
    body,
  });
}

describe("CAD Callback Route", () => {
  beforeEach(() => {
    hoisted.inngestSends = [];
    hoisted.throwInngest = false;
    hoisted.auditRows = [];
    hoisted.uploadStatus = "awaiting_convert";
    process.env.CAD_CALLBACK_SECRET = SECRET;
  });

  it("returns 503 if CAD_CALLBACK_SECRET is unset", async () => {
    delete process.env.CAD_CALLBACK_SECRET;
    const body = JSON.stringify({ uploadId: "upl-test-1", status: "succeeded" });
    const req = makeRequest(body, sign(body));
    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("webhook_not_configured");
  });

  it("returns 401 if x-ccpatio-signature is missing or invalid", async () => {
    const body = JSON.stringify({ uploadId: "upl-test-1", status: "succeeded" });
    
    // Missing signature
    const req1 = makeRequest(body, null);
    const res1 = await POST(req1);
    expect(res1.status).toBe(401);

    // Invalid signature
    const req2 = makeRequest(body, "0".repeat(64));
    const res2 = await POST(req2);
    expect(res2.status).toBe(401);
  });

  it("returns 400 for malformed JSON body", async () => {
    const raw = "{ not valid json";
    const req = makeRequest(raw, sign(raw));
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors[0].message).toBe("Body must be valid JSON");
  });

  it("returns 400 if schema validation fails", async () => {
    const body = JSON.stringify({ uploadId: "upl-test-1", status: "unknown_status" });
    const req = makeRequest(body, sign(body));
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors).toBeDefined();
  });

  it("returns 200 with ignored reason when upload is not found", async () => {
    hoisted.uploadStatus = null; // upload not found
    const body = JSON.stringify({
      uploadId: "upl-test-1",
      status: "succeeded",
      resultSha256: "0".repeat(64),
    });
    const req = makeRequest(body, sign(body));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("upload_not_found");
    expect(hoisted.inngestSends).toHaveLength(0);
  });

  it("returns 200 with ignored reason when upload is already terminal", async () => {
    hoisted.uploadStatus = "failed";
    const body = JSON.stringify({
      uploadId: "upl-test-1",
      status: "succeeded",
      resultSha256: "0".repeat(64),
    });
    const req = makeRequest(body, sign(body));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("already_terminal");
    expect(hoisted.inngestSends).toHaveLength(0);
  });

  it("returns 202 and sends Inngest event on valid callback", async () => {
    const payload = {
      uploadId: "upl-test-1",
      status: "succeeded",
      resultSha256: "a".repeat(64),
    };
    const body = JSON.stringify(payload);
    const req = makeRequest(body, sign(body));
    const res = await POST(req);
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.accepted).toBe(true);

    expect(hoisted.auditRows).toHaveLength(1);
    expect(hoisted.auditRows[0].idempotencyKey).toBe("cad-callback:upl-test-1:succeeded");

    expect(hoisted.inngestSends).toHaveLength(1);
    expect(hoisted.inngestSends[0].name).toBe("cad/convert.completed");
    expect(hoisted.inngestSends[0].data.uploadId).toBe("upl-test-1");
  });

  it("returns 500 if Inngest send throws so converter retries", async () => {
    hoisted.throwInngest = true;
    const body = JSON.stringify({
      uploadId: "upl-test-1",
      status: "failed",
      errorCode: "INTERNAL_ERROR",
      errorMessage: "Blender crash",
    });
    const req = makeRequest(body, sign(body));
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("inngest_send_failed");
  });
});
