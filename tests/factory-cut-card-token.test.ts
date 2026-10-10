import { expect, test } from "vitest";
import { createCutCardToken, verifyCutCardToken } from "../src/server/factory-bom/cut-card-token";

test("Cut card token generates and verifies", () => {
  const payload = {
    jobId: "1234-abcd",
    globalSku: "JOB-TEST-1",
  };

  const token = createCutCardToken(payload);
  expect(token).toBeDefined();
  
  const verified = verifyCutCardToken(token);
  expect(verified).not.toBeNull();
  expect(verified?.jobId).toBe(payload.jobId);
  expect(verified?.globalSku).toBe(payload.globalSku);
});

test("Cut card token rejects invalid signature", () => {
  const token = createCutCardToken({ jobId: "1", globalSku: "SKU" });
  const [data] = token.split(".");
  const badToken = `${data}.badsignature123`;
  
  expect(verifyCutCardToken(badToken)).toBeNull();
});

test("Cut card token rejects invalid data", () => {
  const badToken = "not_even_base64.signature123";
  expect(verifyCutCardToken(badToken)).toBeNull();
});
