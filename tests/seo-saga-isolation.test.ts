import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { inngestFunctions, unregisteredSeoFunctions } from "@/inngest/functions";
import { suggestProductSeo } from "@/inngest/seo-suggest";

const functionsSource = readFileSync(
  path.join(process.cwd(), "src/inngest/functions.ts"),
  "utf8",
);

test("suggest-product-seo is not registered on the catalog saga", () => {
  expect(suggestProductSeo.id()).toBe("suggest-product-seo");
  expect(inngestFunctions.map((fn) => fn.id())).not.toContain("suggest-product-seo");
  expect(unregisteredSeoFunctions.map((fn) => fn.id())).toEqual(["suggest-product-seo"]);
  expect(inngestFunctions).not.toContain(suggestProductSeo);
});

test("suggestProductSeo throttles the OpenAI assistant to 50 runs per minute", () => {
  expect(suggestProductSeo.opts.throttle).toEqual({ limit: 50, period: "1m" });
});

test("publish saga source does not import or call the SEO assistant", () => {
  expect(functionsSource).not.toContain("seo-assistant");
  expect(functionsSource).not.toContain("requestSeoSuggestion");
  const publishStart = functionsSource.indexOf("export const publishApprovedProduct");
  const publishEnd = functionsSource.indexOf("export const systemHealthPing");
  const publishSource = functionsSource.slice(publishStart, publishEnd);
  expect(publishSource).not.toContain("suggestProductSeo");
  expect(publishSource).not.toContain("catalog/seo.suggest");
});
