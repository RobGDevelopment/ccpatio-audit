/**
 * Pure HMAC verification helper for CAD callback webhook.
 * HEX only with optional sha256= prefix, timingSafeEqual after length check.
 * Pure: zero I/O, zero env reads.
 */
import crypto from "node:crypto";

export function verifyCadCallbackSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return false;
  }
  if (!header || typeof header !== "string" || !header.trim()) {
    return false;
  }
  if (typeof rawBody !== "string") {
    return false;
  }

  const cleanHeader = header.trim().toLowerCase().replace(/^sha256=/, "");
  // Must be valid 64-char hex
  if (!/^[0-9a-f]{64}$/.test(cleanHeader)) {
    return false;
  }

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    const receivedBuf = Buffer.from(cleanHeader, "hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");

    if (receivedBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(receivedBuf, expectedBuf);
  } catch {
    return false;
  }
}
