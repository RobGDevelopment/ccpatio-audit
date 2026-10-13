import { describe, expect, it } from "vitest";
import {
  coreEnvSchema,
  strictCoreEnvSchema,
  getQboEnvironment,
  getQboBaseUrl,
  validateEnv,
  validateStrictEnv,
} from "@/env";
import {
  getQboEnvironment as clientGetQboEnvironment,
  getQboBaseUrl as clientGetQboBaseUrl,
  getQboTokenId,
} from "@/server/integrations/qbo/client";

describe("src/env.ts - Environment & Secrets Hardening (Step 3)", () => {
  const baseValid = {
    POSTGRES_URL: "postgresql://postgres:postgres@aws-0-us-west-2.pooler.supabase.com:6543/postgres",
  };

  it("validates valid core environment and applies default values", () => {
    const result = validateEnv(baseValid);
    expect(result.POSTGRES_URL).toBe(baseValid.POSTGRES_URL);
    expect(result.NODE_ENV).toBe("development");
    expect(result.QBO_ENVIRONMENT).toBe("sandbox");
    expect(result.CATALOG_PUBLISH_MODE).toBe("log");
    expect(result.ORDER_PIPELINE_MODE).toBe("log");
  });

  it("rejects when required POSTGRES_URL is missing", () => {
    expect(() => validateEnv({})).toThrow(/POSTGRES_URL/);
    expect(() => validateEnv({ POSTGRES_URL: "" })).toThrow(/POSTGRES_URL/);
  });

  describe("QBO Environment Decoupling from NODE_ENV", () => {
    it("reads QBO_ENVIRONMENT=sandbox even when NODE_ENV=production", () => {
      const rawEnv = {
        ...baseValid,
        NODE_ENV: "production",
        QBO_ENVIRONMENT: "sandbox",
      };
      expect(getQboEnvironment(rawEnv)).toBe("sandbox");
      expect(getQboBaseUrl(rawEnv)).toBe("https://sandbox-quickbooks.api.intuit.com");
    });

    it("reads QBO_ENVIRONMENT=production even when NODE_ENV=development", () => {
      const rawEnv = {
        ...baseValid,
        NODE_ENV: "development",
        QBO_ENVIRONMENT: "production",
      };
      expect(getQboEnvironment(rawEnv)).toBe("production");
      expect(getQboBaseUrl(rawEnv)).toBe("https://quickbooks.api.intuit.com");
    });

    it("defaults to sandbox when QBO_ENVIRONMENT is unset or blank", () => {
      expect(getQboEnvironment({})).toBe("sandbox");
      expect(getQboEnvironment({ QBO_ENVIRONMENT: "" })).toBe("sandbox");
      expect(getQboBaseUrl({})).toBe("https://sandbox-quickbooks.api.intuit.com");
    });

    it("honors QBO_API_URL explicit override when provided", () => {
      const customUrl = "https://custom-qbo-proxy.internal";
      expect(getQboBaseUrl({ QBO_API_URL: customUrl })).toBe(customUrl);
    });

    it("qbo/client.ts matches env.ts decoupling logic", () => {
      process.env.QBO_ENVIRONMENT = "sandbox";
      expect(clientGetQboEnvironment()).toBe("sandbox");
      expect(clientGetQboBaseUrl()).toBe("https://sandbox-quickbooks.api.intuit.com");
      expect(getQboTokenId("sandbox")).toBe(false);

      process.env.QBO_ENVIRONMENT = "production";
      expect(clientGetQboEnvironment()).toBe("production");
      expect(clientGetQboBaseUrl()).toBe("https://quickbooks.api.intuit.com");
      expect(getQboTokenId("production")).toBe(true);

      delete process.env.QBO_ENVIRONMENT;
    });
  });

  describe("Per-Environment Token Row Mapping", () => {
    it("maps production to true and sandbox to false", () => {
      expect(getQboTokenId("production")).toBe(true);
      expect(getQboTokenId("sandbox")).toBe(false);
    });
  });

  describe("Strict Validation (runtime assertion)", () => {
    it("requires at least one Katana key", () => {
      expect(() =>
        validateStrictEnv({
          ...baseValid,
          QBO_CLIENT_ID: "client_id",
          QBO_CLIENT_SECRET: "client_sec",
        }),
      ).toThrow(/KATANA_API_KEY/);

      const withKatana = validateStrictEnv({
        ...baseValid,
        KATANA_API_KEY: "katana-key-123",
        QBO_CLIENT_ID: "client_id",
        QBO_CLIENT_SECRET: "client_sec",
      });
      expect(withKatana.KATANA_API_KEY).toBe("katana-key-123");

      const withPat = validateStrictEnv({
        ...baseValid,
        KATANA_PERSONAL_ACCESS_TOKEN: "pat-token-456",
        QBO_CLIENT_ID: "client_id",
        QBO_CLIENT_SECRET: "client_sec",
      });
      expect(withPat.KATANA_PERSONAL_ACCESS_TOKEN).toBe("pat-token-456");
    });

    it("requires QBO_CLIENT_ID and QBO_CLIENT_SECRET", () => {
      expect(() =>
        validateStrictEnv({
          ...baseValid,
          KATANA_API_KEY: "katana-key",
        }),
      ).toThrow(/QBO_CLIENT_ID/);
    });
  });
});
