import { expect, test, beforeEach, afterEach } from "vitest";
import { isGhlWonOpportunity } from "@/lib/katana";

beforeEach(() => {
  process.env.GHL_WON_STAGE_IDS = "stage-123, stage-456";
});

afterEach(() => {
  delete process.env.GHL_WON_STAGE_IDS;
});

test("isGhlWonOpportunity matches exact string status", () => {
  expect(isGhlWonOpportunity("won")).toBe(true);
  expect(isGhlWonOpportunity("closed won")).toBe(true);
  expect(isGhlWonOpportunity("closed_won")).toBe(true);
  expect(isGhlWonOpportunity("Won ")).toBe(true);
  expect(isGhlWonOpportunity(" CLOSED WON ")).toBe(true);
});

test("isGhlWonOpportunity rejects loose strings that include won", () => {
  expect(isGhlWonOpportunity("Lost to competitor who won")).toBe(false);
  expect(isGhlWonOpportunity("wondering")).toBe(false);
  expect(isGhlWonOpportunity("abandoned - but they won something else")).toBe(false);
});

test("isGhlWonOpportunity uses pipelineStageId from env", () => {
  expect(isGhlWonOpportunity("open", "stage-123")).toBe(true);
  expect(isGhlWonOpportunity("open", "stage-456")).toBe(true);
  expect(isGhlWonOpportunity("open", "stage-789")).toBe(false);
});

test("isGhlWonOpportunity requires both to fail before returning false", () => {
  expect(isGhlWonOpportunity("open", "random")).toBe(false);
  expect(isGhlWonOpportunity("open", null)).toBe(false);
  expect(isGhlWonOpportunity(undefined, undefined)).toBe(false);
});
