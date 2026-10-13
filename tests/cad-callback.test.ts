import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyCadCallbackSignature } from "@/server/cad/callback";

describe("CAD Callback Signature Verification", () => {
  const secret = "test-cad-secret-xyz-123";
  const body = JSON.stringify({ uploadId: "upl-123", status: "succeeded" });

  it("returns true for a valid HMAC hex signature", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCadCallbackSignature(body, sig, secret)).toBe(true);
  });

  it("returns true for a valid signature with sha256= prefix", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCadCallbackSignature(body, `sha256=${sig}`, secret)).toBe(true);
  });

  it("returns true for uppercase hex signature", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex").toUpperCase();
    expect(verifyCadCallbackSignature(body, sig, secret)).toBe(true);
  });

  it("returns false for tampered body", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const tamperedBody = JSON.stringify({ uploadId: "upl-123", status: "failed" });
    expect(verifyCadCallbackSignature(tamperedBody, sig, secret)).toBe(false);
  });

  it("returns false for invalid signature hex", () => {
    const badSig = "0".repeat(64);
    expect(verifyCadCallbackSignature(body, badSig, secret)).toBe(false);
  });

  it("returns false for non-hex or malformed header", () => {
    expect(verifyCadCallbackSignature(body, "not-a-hex-signature", secret)).toBe(false);
    expect(verifyCadCallbackSignature(body, "abc", secret)).toBe(false);
  });

  it("returns false when secret is empty, whitespace, or undefined", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCadCallbackSignature(body, sig, "")).toBe(false);
    expect(verifyCadCallbackSignature(body, sig, "   ")).toBe(false);
    expect(verifyCadCallbackSignature(body, sig, undefined as unknown as string)).toBe(false);
  });

  it("returns false when header is empty or undefined", () => {
    expect(verifyCadCallbackSignature(body, "", secret)).toBe(false);
    expect(verifyCadCallbackSignature(body, undefined, secret)).toBe(false);
  });

  it("returns false when body is not a string", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCadCallbackSignature(null as unknown as string, sig, secret)).toBe(false);
  });
});
