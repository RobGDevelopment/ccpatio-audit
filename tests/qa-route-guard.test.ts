/**
 * P0-1: /api/qa-test must hard-404 in production unless ALLOW_LOCAL_QA_TEST=true.
 */
import { describe, expect, it } from "vitest";
import {
  isQaTestProductionBlocked,
  mayExitProcessForQa,
} from "@/app/api/qa-test/route";

describe("qa-test production hard-block", () => {
  it("blocks when NODE_ENV=production and ALLOW_LOCAL_QA_TEST is unset", () => {
    expect(
      isQaTestProductionBlocked({
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("blocks when NODE_ENV=production and ALLOW_LOCAL_QA_TEST is not exactly true", () => {
    expect(
      isQaTestProductionBlocked({
        NODE_ENV: "production",
        ALLOW_LOCAL_QA_TEST: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isQaTestProductionBlocked({
        NODE_ENV: "production",
        ALLOW_LOCAL_QA_TEST: "false",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("allows local lifecycle when ALLOW_LOCAL_QA_TEST=true even under production NODE_ENV", () => {
    expect(
      isQaTestProductionBlocked({
        NODE_ENV: "production",
        ALLOW_LOCAL_QA_TEST: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("never blocks under development NODE_ENV", () => {
    expect(
      isQaTestProductionBlocked({
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("never allows process.exit on Vercel", () => {
    expect(
      mayExitProcessForQa({
        VERCEL: "1",
        ALLOW_LOCAL_QA_TEST: "true",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("allows process.exit only for local QA override", () => {
    expect(
      mayExitProcessForQa({
        ALLOW_LOCAL_QA_TEST: "true",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      mayExitProcessForQa({
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
