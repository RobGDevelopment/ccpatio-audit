import { z } from "zod";

export const qboEnvironmentSchema = z.enum(["sandbox", "production"]).default("sandbox");
export type QboEnvironment = z.infer<typeof qboEnvironmentSchema>;

/**
 * Core environment variable schema for the CC Patio MDM Hub.
 * Validates Katana credentials, QBO configuration, Postgres URLs, and Supabase keys.
 */
export const coreEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  POSTGRES_URL: z.string().min(1, "POSTGRES_URL is required"),
  POSTGRES_URL_TX: z.string().optional(),

  // Katana MRP
  KATANA_API_KEY: z.string().optional(),
  KATANA_PERSONAL_ACCESS_TOKEN: z.string().optional(),
  KATANA_WEBHOOK_SECRET: z.string().optional(),
  KATANA_API_BASE: z.string().optional(),
  KATANA_E2E_MIRROR: z.string().optional(),
  CATALOG_PUBLISH_MODE: z.enum(["log", "live"]).default("log"),
  ORDER_PIPELINE_MODE: z.enum(["log", "live"]).default("log"),
  KATANA_USE_BOM_ROWS: z.string().optional(),

  // QuickBooks Online (QBO) — explicitly decoupled from NODE_ENV
  QBO_ENVIRONMENT: qboEnvironmentSchema,
  QBO_CLIENT_ID: z.string().optional(),
  QBO_CLIENT_SECRET: z.string().optional(),
  QBO_OAUTH_REDIRECT_URI: z.string().optional(),
  QBO_GATEWAY_CLEARING_ACCOUNT_ID: z.union([z.string(), z.number()]).optional(),
  QBO_API_URL: z.string().optional(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;

/**
 * Strict schema for runtime assertion of core external API integrations.
 */
export const strictCoreEnvSchema = coreEnvSchema
  .refine(
    (data) => Boolean(data.KATANA_API_KEY || data.KATANA_PERSONAL_ACCESS_TOKEN),
    {
      message: "At least one of KATANA_API_KEY or KATANA_PERSONAL_ACCESS_TOKEN must be set",
      path: ["KATANA_API_KEY"],
    },
  )
  .refine(
    (data) => Boolean(data.QBO_CLIENT_ID && data.QBO_CLIENT_SECRET),
    {
      message: "QBO_CLIENT_ID and QBO_CLIENT_SECRET are required for QBO integration",
      path: ["QBO_CLIENT_ID"],
    },
  );

export type StrictCoreEnv = z.infer<typeof strictCoreEnvSchema>;

/**
 * Returns the active QBO environment ("sandbox" | "production")
 * strictly from QBO_ENVIRONMENT, decoupled from NODE_ENV.
 */
export function getQboEnvironment(rawEnv?: Record<string, string | undefined>): QboEnvironment {
  const envMap = rawEnv ?? process.env;
  const envVal = envMap.QBO_ENVIRONMENT?.trim().toLowerCase();
  if (envVal === "production") return "production";
  return "sandbox";
}

/**
 * Returns the base URL for QuickBooks Online API calls.
 * Reads QBO_API_URL override if present; otherwise strictly maps QBO_ENVIRONMENT
 * to production vs sandbox URLs without reading NODE_ENV.
 */
export function getQboBaseUrl(rawEnv?: Record<string, string | undefined>): string {
  const envMap = rawEnv ?? process.env;
  if (envMap.QBO_API_URL?.trim()) {
    return envMap.QBO_API_URL.trim().replace(/\/$/, "");
  }
  return getQboEnvironment(envMap) === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/**
 * Validates environment variables using the core schema.
 */
export function validateEnv(rawEnv?: Record<string, string | undefined>): CoreEnv {
  return coreEnvSchema.parse(rawEnv ?? process.env);
}

/**
 * Validates environment variables with strict requirements on Katana and QBO keys.
 */
export function validateStrictEnv(rawEnv?: Record<string, string | undefined>): StrictCoreEnv {
  return strictCoreEnvSchema.parse(rawEnv ?? process.env);
}

let cachedEnv: CoreEnv | null = null;

export function getEnv(): CoreEnv {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
}

/**
 * Lazy Proxy for accessing validated environment properties.
 * Avoids crashing static builds when imported without full runtime env.
 */
export const env: CoreEnv = new Proxy({} as CoreEnv, {
  get(_target, prop: string | symbol) {
    if (typeof prop === "symbol") return undefined;
    const current = getEnv();
    return Reflect.get(current, prop);
  },
});
