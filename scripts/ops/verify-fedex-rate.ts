/**
 * FedEx Freight LIVE rate verification. Operator-run, never part of CI.
 *
 *   npm run ops:verify-fedex-rate
 *   (same thing: npx tsx scripts/ops/verify-fedex-rate.ts)
 *
 * What it does, with NO mocks and NO fallback table:
 *   1. Loads .env.local (it wins over anything already in the shell).
 *   2. Signs in with a real OAuth 2.0 client-credentials call to the FedEx Freight auth host.
 *   3. Sends one real Rate Freight request for a dummy 500 lb pallet, Scottsdale AZ to Los Angeles CA.
 *   4. Runs the response through the SAME parser the Order Desk uses (src/lib/freight/fedex-freight.ts)
 *      and prints the parsed result as JSON on stdout.
 *
 * It only RATES. It never creates a shipment, a pickup or a label, and it writes nothing to the database.
 *
 * Settings read from .env.local (names only; values are never printed):
 *   FEDEX_FREIGHT_ACCOUNT_NUMBER   required, 1 to 9 letters or digits
 *   FEDEX_FREIGHT_API_BASE         required, https. This is the FREIGHT gateway, not the parcel host
 *                                  (apis-sandbox.fedex.com is the parcel API and does not serve Freight)
 *   FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET   required (alias: FEDEX_FREIGHT_CLIENT_*). The old FEDEX_SANDBOX_CLIENT_*
 *                                  pair is honored only when the environment resolves to sandbox.
 *   FEDEX_FREIGHT_ENV              optional, "production" | "sandbox". When unset it follows FEDEX_FREIGHT_API_BASE:
 *                                  https://apis.fedex.com is production (auth.fedexfreight.com/am/oauth2/access_token), anything else sandbox
 *                                  (auth-qa.fedexfreight.com). A value that contradicts the API host is refused.
 *   FEDEX_FREIGHT_AUTH_URL         optional explicit auth URL
 *   FEDEX_FREIGHT_SERVICE_TYPE     optional, default FEDEX_FREIGHT_ECONOMY
 *
 * If the live response does not parse, the output includes `responseShape`: the response's keys and value
 * TYPES (never values), so the parser can be corrected from the real schema without leaking anything.
 *
 * stdout carries exactly one JSON document. Progress lines go to stderr. Exit code 0 means a real rate was
 * returned and parsed; 1 means it was not.
 */
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true, quiet: true });

import {
  FEDEX_FREIGHT_RATE_PATH,
  FedExFreightError,
  fedexFreightConfigGaps,
  getFedExFreightRates,
  readFedExFreightConfig,
  resetFedExTokenCache,
  resolveFedExFreightEnvironment,
  type FedExFreightConfig,
  type FedExRateInput,
} from "../../src/lib/freight/fedex-freight";

/** 48 x 40 x 40 in at 500 lb is about 11.3 lb per cubic foot, which is NMFC class 85. */
const DUMMY_SHIPMENT: FedExRateInput = {
  originZip: "85260", // Scottsdale, AZ
  destZip: "90005", // Los Angeles, CA
  items: [{ weightLb: 500, lengthIn: 48, widthIn: 40, heightIn: 40, freightClass: "85" }],
};

type OAuthObservation = {
  httpStatus: number;
  tokenType: string | null;
  scope: string | null;
  expiresInSeconds: number | null;
};

type Observations = {
  oauth: OAuthObservation | null;
  rate: { httpStatus: number; responseShape: unknown } | null;
};

function progress(message: string): void {
  console.error(`[verify-fedex-rate] ${message}`);
}

function host(url: string): string {
  return new URL(url).host;
}

function mask(value: string, keep: number): string {
  return value.length <= keep ? "***" : `${value.slice(0, keep)}***`;
}

/** Keys and value types only. Never a value, so the shape is safe to paste anywhere. */
export function shapeOf(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return depth >= 8
      ? "array"
      : { "[]": `${value.length} item(s)`, item: value.length > 0 ? shapeOf(value[0], depth + 1) : null };
  }
  if (typeof value === "object") {
    if (depth >= 8) return "object";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, shapeOf(inner, depth + 1)]),
    );
  }
  return typeof value;
}

function describeFailure(error: unknown): Record<string, unknown> {
  if (error instanceof FedExFreightError) {
    return {
      code: error.code,
      httpStatus: error.status,
      providerCodes: error.providerCodes,
    };
  }
  return { code: "UNEXPECTED", errorName: error instanceof Error ? error.name : typeof error };
}

/** A pass-through fetch that records metadata about the two real FedEx responses. It changes nothing. */
function observingFetch(config: FedExFreightConfig, observations: Observations): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === config.authUrl) {
      let tokenType: string | null = null;
      let scope: string | null = null;
      let expiresIn: number | null = null;
      try {
        const body = (await response.clone().json()) as Record<string, unknown>;
        tokenType = typeof body.token_type === "string" ? body.token_type : null;
        scope = typeof body.scope === "string" ? body.scope : null;
        expiresIn = Number.isFinite(Number(body.expires_in)) ? Number(body.expires_in) : null;
      } catch (error) {
        progress(`OAuth response body was not JSON (${error instanceof Error ? error.name : typeof error}).`);
      }
      observations.oauth = { httpStatus: response.status, tokenType, scope, expiresInSeconds: expiresIn };
      progress(
        `OAuth: HTTP ${response.status} from ${host(config.authUrl)} ` +
          `token_type=${tokenType ?? "n/a"} expires_in=${expiresIn ?? "n/a"} access_token=***MASKED***`,
      );
    } else if (url.endsWith(FEDEX_FREIGHT_RATE_PATH)) {
      let responseShape: unknown;
      try {
        responseShape = shapeOf(await response.clone().json());
      } catch (error) {
        responseShape = { unreadable: error instanceof Error ? error.name : typeof error };
      }
      observations.rate = { httpStatus: response.status, responseShape };
      progress(`Rate Freight: HTTP ${response.status} from ${host(config.apiBase)}`);
    }
    return response;
  };
}

async function main(): Promise<number> {
  const gaps = fedexFreightConfigGaps(process.env);
  if (gaps.length > 0) {
    const hint =
      gaps.includes("FEDEX_FREIGHT_API_BASE") && process.env.FEDEX_API_BASE?.trim()
        ? " FEDEX_API_BASE is set, but it is the parcel host and is not read by the Freight client."
        : "";
    const renameHint =
      gaps.includes("FEDEX_CLIENT_ID") &&
      process.env.FEDEX_SANDBOX_CLIENT_ID?.trim() &&
      resolveFedExFreightEnvironment(process.env) === "production"
        ? " FEDEX_SANDBOX_CLIENT_ID/_SECRET are only read in sandbox mode: rename them to FEDEX_CLIENT_ID/FEDEX_CLIENT_SECRET."
        : "";
    console.log(JSON.stringify({ ok: false, stage: "config", missing: gaps }, null, 2));
    progress(`Not run. Add these to .env.local: ${gaps.join(", ")}.${hint}${renameHint}`);
    return 1;
  }

  let config: FedExFreightConfig;
  try {
    config = readFedExFreightConfig(process.env);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, stage: "config", ...describeFailure(error) }, null, 2));
    progress("Settings are present but invalid. See the code above (static messages only; no values printed).");
    return 1;
  }

  // The environment comes from the same resolver the Order Desk uses (FEDEX_FREIGHT_ENV, else the API host).
  const production = config.environment === "production";
  progress(
    `${production ? "PRODUCTION" : "sandbox"} | auth ${host(config.authUrl)} | api ${host(config.apiBase)} | ` +
      `account ${mask(config.accountNumber, 2)} | client ${mask(config.clientId, 4)} | service ${config.serviceType}`,
  );
  progress(
    `Rating ${DUMMY_SHIPMENT.items[0]!.weightLb} lb pallet ${DUMMY_SHIPMENT.originZip} (AZ) to ${DUMMY_SHIPMENT.destZip} (CA), class ${DUMMY_SHIPMENT.items[0]!.freightClass}.`,
  );

  const observations: Observations = { oauth: null, rate: null };
  resetFedExTokenCache();

  const summary = {
    environment: production ? "production" : "sandbox",
    authHost: host(config.authUrl),
    apiHost: host(config.apiBase),
    serviceType: config.serviceType,
    shipment: DUMMY_SHIPMENT,
  };

  try {
    const rates = await getFedExFreightRates(DUMMY_SHIPMENT, {
      fetch: observingFetch(config, observations),
      env: process.env,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...summary,
          oauth: observations.oauth,
          rateHttpStatus: observations.rate?.httpStatus ?? null,
          rateCount: rates.length,
          cheapest: rates[0],
          rates,
          responseShape: observations.rate?.responseShape ?? null,
        },
        null,
        2,
      ),
    );
    progress(`PASS: ${rates.length} rate(s) parsed. Cheapest ${rates[0]!.serviceType} $${rates[0]!.totalUsd.toFixed(2)}.`);
    return 0;
  } catch (error) {
    const failedAt = observations.oauth && observations.oauth.httpStatus >= 400 ? "oauth" : observations.rate ? "rate" : "oauth";
    console.log(
      JSON.stringify(
        {
          ok: false,
          ...summary,
          stage: failedAt,
          ...describeFailure(error),
          oauth: observations.oauth,
          rateHttpStatus: observations.rate?.httpStatus ?? null,
          responseShape: observations.rate?.responseShape ?? null,
        },
        null,
        2,
      ),
    );
    progress("FAIL: see the JSON on stdout. If code is BAD_RESPONSE, paste responseShape so the parser can be corrected.");
    return 1;
  }
}

// exitCode (not process.exit) lets undici close its sockets; process.exit trips a libuv assert on Windows.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.log(JSON.stringify({ ok: false, stage: "crash", ...describeFailure(error) }, null, 2));
    process.exitCode = 1;
  });
