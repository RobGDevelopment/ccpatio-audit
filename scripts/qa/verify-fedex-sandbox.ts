/**
 * FedEx Freight sandbox check.
 *
 *   npm run ops:verify-fedex-sandbox
 *
 * Step 1 signs in at the Freight OAuth host (auth-qa.fedexfreight.com by default) and
 * reports the token metadata with the token masked. Step 2 runs one real Rate Freight call
 * when FEDEX_FREIGHT_API_BASE and FEDEX_FREIGHT_ACCOUNT_NUMBER are set; otherwise it says
 * exactly which settings are missing. Secrets and provider error text are never printed.
 *
 * The standard FedEx parcel host (apis-sandbox.fedex.com /oauth/token) does NOT accept
 * Freight credentials; the previous version of this script posted there and got a 401.
 */
import {
  FedExFreightError,
  fedexFreightClientCredentials,
  fedexFreightConfigGaps,
  getFedExFreightRates,
  readFedExFreightConfig,
  resolveFedExFreightAuthUrl,
  tokenRequestBody,
} from "../../src/lib/freight/fedex-freight";

function describe(error: unknown): string {
  if (error instanceof FedExFreightError) {
    const codes = error.providerCodes.length > 0 ? ` providerCodes=${error.providerCodes.join(",")}` : "";
    return `${error.code} status=${error.status ?? "n/a"}${codes}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

async function main(): Promise<number> {
  const env = process.env;
  const { clientId, clientSecret } = fedexFreightClientCredentials(env);
  if (!clientId || !clientSecret) {
    console.error("Missing FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET.");
    return 1;
  }

  // Same resolver as the app: FEDEX_FREIGHT_ENV, else the API host (apis.fedex.com is production).
  const authUrl = resolveFedExFreightAuthUrl(env);

  const response = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequestBody({ clientId, clientSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error(`[FAIL] OAuth refused: HTTP ${response.status} at ${new URL(authUrl).host}`);
    return 1;
  }
  const body = (await response.json()) as Record<string, unknown>;
  console.log(
    `[OK] OAuth: HTTP ${response.status} at ${new URL(authUrl).host} ` +
      `token_type=${String(body.token_type)} scope=${String(body.scope)} ` +
      `expires_in=${String(body.expires_in)} access_token=***MASKED***`,
  );

  const gaps = fedexFreightConfigGaps(env);
  if (gaps.length > 0) {
    console.log(`[SKIP] Rate call not attempted. Missing: ${gaps.join(", ")}`);
    return 0;
  }

  try {
    readFedExFreightConfig(env);
    const rates = await getFedExFreightRates({
      originZip: "85260",
      destZip: "90005",
      items: [{ weightLb: 500, lengthIn: 48, widthIn: 40, heightIn: 40, freightClass: "150" }],
    });
    for (const rate of rates) {
      console.log(
        `[OK] Rate: ${rate.serviceType} $${rate.totalUsd.toFixed(2)} transitDays=${rate.transitDays ?? "n/a"}`,
      );
    }
    return 0;
  } catch (error) {
    console.error(`[FAIL] Rate call: ${describe(error)}`);
    return 1;
  }
}

// exitCode (not process.exit) lets undici close its sockets; process.exit trips a libuv assert on Windows.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[FAIL] verify-fedex-sandbox crashed: ${describe(error)}`);
    process.exitCode = 1;
  });
