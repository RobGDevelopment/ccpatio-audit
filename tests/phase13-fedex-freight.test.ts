import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEDEX_FREIGHT_PRODUCTION_AUTH_URL,
  FEDEX_FREIGHT_RATE_PATH,
  FEDEX_FREIGHT_SANDBOX_AUTH_URL,
  FedExFreightError,
  FedExFreightNotConfiguredError,
  buildFedExRateRequest,
  fedexFreightConfigGaps,
  getFedExFreightQuote,
  getFedExFreightRates,
  parseFedExRateResponse,
  readFedExFreightConfig,
  resetFedExTokenCache,
  resolveFedExFreightEnvironment,
  toFedExFreightClass,
  tokenRequestBody,
} from "@/lib/freight/fedex-freight";
import { fedexCarrierQuoteId, rateFedExCarrier } from "@/server/freight/fedex-carrier";
import { FreightRatingError, getPriority1Quote } from "@/server/freight/priority1";

const ENV = {
  FEDEX_FREIGHT_CLIENT_ID: "client-id-123",
  FEDEX_FREIGHT_CLIENT_SECRET: "client-secret-xyz",
  FEDEX_FREIGHT_API_BASE: "https://rates.example.test",
  FEDEX_FREIGHT_ACCOUNT_NUMBER: "123456789",
};

const INPUT = {
  originZip: "85260",
  destZip: "90005",
  items: [{ weightLb: 562.25, lengthIn: 47.2, widthIn: 40, heightIn: 38.5, freightClass: "175" }],
};

const RATE_OK = {
  output: {
    rateReplyDetails: [
      {
        serviceType: "FEDEX_FREIGHT_PRIORITY",
        serviceName: "FedEx Freight Priority",
        ratedShipmentDetails: [{ totalNetCharge: 912.4 }],
        commit: { transitDays: { minimumTransitTime: "THREE_DAYS" } },
      },
      {
        serviceType: "FEDEX_FREIGHT_ECONOMY",
        serviceName: "FedEx Freight Economy",
        ratedShipmentDetails: [{ shipmentRateDetail: { totalNetCharge: { amount: "742.10" } } }],
        commit: { transitDays: { minimumTransitTime: "FIVE_DAYS" } },
      },
    ],
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init: RequestInit };

/** Router fake: auth host answers a token, the rate path answers `rate()`. */
function fakeFedEx(rate: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  let rateCalls = 0;
  let authCalls = 0;
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call = { url, init: init ?? {} };
    calls.push(call);
    if (url === FEDEX_FREIGHT_SANDBOX_AUTH_URL) {
      authCalls += 1;
      return json({ access_token: `tok-${authCalls}`, token_type: "Bearer", expires_in: 3600 });
    }
    rateCalls += 1;
    return rate(call, rateCalls);
  });
  return { fetch: impl as unknown as typeof fetch, calls, auth: () => authCalls, rates: () => rateCalls };
}

beforeEach(() => {
  resetFedExTokenCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("FedEx Freight configuration", () => {
  it("lists the NAMES of missing settings and never values", () => {
    expect(fedexFreightConfigGaps({})).toEqual([
      "FEDEX_CLIENT_ID",
      "FEDEX_CLIENT_SECRET",
      "FEDEX_FREIGHT_API_BASE",
      "FEDEX_FREIGHT_ACCOUNT_NUMBER",
    ]);
    expect(fedexFreightConfigGaps(ENV)).toEqual([]);
  });

  it("reads FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET, with FEDEX_FREIGHT_CLIENT_* as an alias", () => {
    const base = {
      FEDEX_FREIGHT_API_BASE: ENV.FEDEX_FREIGHT_API_BASE,
      FEDEX_FREIGHT_ACCOUNT_NUMBER: ENV.FEDEX_FREIGHT_ACCOUNT_NUMBER,
    };
    expect(
      readFedExFreightConfig({ ...base, FEDEX_CLIENT_ID: "new-id", FEDEX_CLIENT_SECRET: "new-secret" }),
    ).toMatchObject({ clientId: "new-id", clientSecret: "new-secret" });
    expect(
      readFedExFreightConfig({
        ...base,
        FEDEX_CLIENT_ID: "new-id",
        FEDEX_CLIENT_SECRET: "new-secret",
        FEDEX_FREIGHT_CLIENT_ID: "alias-id",
        FEDEX_FREIGHT_CLIENT_SECRET: "alias-secret",
      }),
    ).toMatchObject({ clientId: "new-id", clientSecret: "new-secret" });
    expect(readFedExFreightConfig({ ...base, ...ENV })).toMatchObject({
      clientId: "client-id-123",
      clientSecret: "client-secret-xyz",
    });
  });

  it("reads the legacy FEDEX_SANDBOX_CLIENT_* pair in sandbox mode only", () => {
    const legacy = {
      FEDEX_SANDBOX_CLIENT_ID: "sb-id",
      FEDEX_SANDBOX_CLIENT_SECRET: "sb-secret",
      FEDEX_FREIGHT_ACCOUNT_NUMBER: ENV.FEDEX_FREIGHT_ACCOUNT_NUMBER,
    };
    const sandbox = { ...legacy, FEDEX_FREIGHT_API_BASE: "https://rates.example.test" };
    expect(readFedExFreightConfig(sandbox)).toMatchObject({ clientId: "sb-id", clientSecret: "sb-secret" });

    // Sandbox-named keys must never be sent to the production OAuth host.
    const production = { ...legacy, FEDEX_FREIGHT_API_BASE: "https://apis.fedex.com" };
    expect(fedexFreightConfigGaps(production)).toEqual(["FEDEX_CLIENT_ID", "FEDEX_CLIENT_SECRET"]);
    expect(() => readFedExFreightConfig(production)).toThrow(FedExFreightNotConfiguredError);
  });

  it("defaults to the QA OAuth host and switches to production on request", () => {
    expect(readFedExFreightConfig(ENV).authUrl).toBe(FEDEX_FREIGHT_SANDBOX_AUTH_URL);
    expect(readFedExFreightConfig({ ...ENV, FEDEX_FREIGHT_ENV: "production" }).authUrl).toBe(
      FEDEX_FREIGHT_PRODUCTION_AUTH_URL,
    );
  });

  it("routes FEDEX_FREIGHT_API_BASE=https://apis.fedex.com to the production OAuth host", () => {
    const prod = { ...ENV, FEDEX_FREIGHT_API_BASE: "https://apis.fedex.com" };
    expect(readFedExFreightConfig(prod)).toMatchObject({
      environment: "production",
      authUrl: FEDEX_FREIGHT_PRODUCTION_AUTH_URL,
      apiBase: "https://apis.fedex.com",
    });
    expect(resolveFedExFreightEnvironment({ ...prod, FEDEX_FREIGHT_API_BASE: "https://apis.fedex.com/" })).toBe(
      "production",
    );
    // The parcel sandbox host stays on the QA auth server.
    expect(
      readFedExFreightConfig({ ...ENV, FEDEX_FREIGHT_API_BASE: "https://apis-sandbox.fedex.com" }),
    ).toMatchObject({ environment: "sandbox", authUrl: FEDEX_FREIGHT_SANDBOX_AUTH_URL });
    // An explicit override still wins for the auth URL.
    expect(
      readFedExFreightConfig({ ...prod, FEDEX_FREIGHT_AUTH_URL: "https://auth.override.test/token" }).authUrl,
    ).toBe("https://auth.override.test/token");
  });

  it("refuses a FEDEX_FREIGHT_ENV that contradicts the API host", () => {
    expect(() =>
      readFedExFreightConfig({
        ...ENV,
        FEDEX_FREIGHT_API_BASE: "https://apis.fedex.com",
        FEDEX_FREIGHT_ENV: "sandbox",
      }),
    ).toThrow(/contradicts/);
    expect(() =>
      readFedExFreightConfig({
        ...ENV,
        FEDEX_FREIGHT_API_BASE: "https://apis-sandbox.fedex.com",
        FEDEX_FREIGHT_ENV: "production",
      }),
    ).toThrow(/contradicts/);
  });

  it("signs in at the production auth host and never touches QA when the API base is apis.fedex.com", async () => {
    const calls: string[] = [];
    let authBody = "";
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === FEDEX_FREIGHT_PRODUCTION_AUTH_URL) authBody = String(init?.body);
      if (url === FEDEX_FREIGHT_PRODUCTION_AUTH_URL) {
        return json({ access_token: "prod-token", token_type: "Bearer", expires_in: 3600 });
      }
      return json(RATE_OK);
    }) as unknown as typeof fetch;

    const rates = await getFedExFreightRates(INPUT, {
      env: { ...ENV, FEDEX_FREIGHT_API_BASE: "https://apis.fedex.com" },
      fetch: fetchSpy,
    });

    expect(rates.length).toBeGreaterThan(0);
    // Freight-portal keys: Freight production OAuth host, never the Unified apis.fedex.com/oauth/token.
    expect(FEDEX_FREIGHT_PRODUCTION_AUTH_URL).toBe("https://auth.fedexfreight.com/am/oauth2/access_token");
    expect(calls[0]).toBe("https://auth.fedexfreight.com/am/oauth2/access_token");
    expect(calls[1]).toBe(`https://apis.fedex.com${FEDEX_FREIGHT_RATE_PATH}`);
    expect(calls.some((url) => url.includes("/oauth/token"))).toBe(false);
    // The Freight gateway requires scope=fxf-api on the PRODUCTION token request too.
    expect(Object.fromEntries(new URLSearchParams(authBody))).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id-123",
      client_secret: "client-secret-xyz",
      scope: "fxf-api",
    });
  });

  it("sends scope=fxf-api on every Freight token request", () => {
    const creds = { clientId: "id", clientSecret: "secret" };
    expect(Object.fromEntries(new URLSearchParams(tokenRequestBody(creds)))).toEqual({
      grant_type: "client_credentials",
      client_id: "id",
      client_secret: "secret",
      scope: "fxf-api",
    });
  });

  it("reports the OAuth error token (never the description) when sign-in is refused", async () => {
    const fetchSpy = vi.fn(async () =>
      json({ error: "invalid_client", error_description: "secret detail that must not leak" }, 401),
    ) as unknown as typeof fetch;
    const error = await getFedExFreightRates(INPUT, { env: ENV, fetch: fetchSpy }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FedExFreightError);
    expect(error).toMatchObject({ code: "AUTH_FAILED", status: 401, providerCodes: ["invalid_client"] });
    expect(String((error as Error).message)).not.toContain("secret detail");
  });

  it("refuses non-https hosts and an over-long account number", () => {
    expect(() => readFedExFreightConfig({ ...ENV, FEDEX_FREIGHT_API_BASE: "http://insecure.test" })).toThrow(
      /https/,
    );
    expect(() => readFedExFreightConfig({ ...ENV, FEDEX_FREIGHT_ACCOUNT_NUMBER: "1234567890" })).toThrow(
      /ACCOUNT_NUMBER/,
    );
  });

  it("throws a typed not-configured error and makes no network call", async () => {
    const fake = fakeFedEx(() => json({}));
    const promise = getFedExFreightRates(INPUT, { env: {}, fetch: fake.fetch });
    await expect(promise).rejects.toBeInstanceOf(FedExFreightNotConfiguredError);
    await expect(promise).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fake.fetch).not.toHaveBeenCalled();
  });
});

describe("FedEx request mapping", () => {
  it("maps NMFC classes to the FedEx enum", () => {
    expect(toFedExFreightClass("50")).toBe("CLASS_050");
    expect(toFedExFreightClass("77.5")).toBe("CLASS_077_5");
    expect(toFedExFreightClass("92.5")).toBe("CLASS_092_5");
    expect(toFedExFreightClass("175")).toBe("CLASS_175");
    expect(() => toFedExFreightClass("42")).toThrow(FedExFreightError);
  });

  it("builds the documented body and rounds billable dimensions up", () => {
    const body = buildFedExRateRequest(INPUT, {
      accountNumber: "123456789",
      serviceType: "FEDEX_FREIGHT_ECONOMY",
    }) as {
      accountNumber: { value: string };
      freightRequestedShipment: Record<string, unknown>;
    };
    expect(body.accountNumber).toEqual({ value: "123456789" });
    expect(body.freightRequestedShipment).toMatchObject({
      serviceType: "FEDEX_FREIGHT_ECONOMY",
      packagingType: "PALLET",
      totalWeight: { value: 562.3, units: "LB" },
      origin: { address: { postalCode: "85260", countryCode: "US" } },
      destination: { address: { postalCode: "90005", countryCode: "US" } },
      requestedPackageLineItems: [
        {
          weight: { value: 562.3, units: "LB" },
          dimensions: { length: 48, width: 40, height: 39, units: "IN" },
          freightClass: "CLASS_175",
        },
      ],
    });
  });

  it("rejects bad ZIPs, zero weight and empty carts instead of sending them", () => {
    const cfg = { accountNumber: "1", serviceType: "FEDEX_FREIGHT_ECONOMY" };
    expect(() => buildFedExRateRequest({ ...INPUT, destZip: "9000" }, cfg)).toThrow(/Destination ZIP/);
    expect(() =>
      buildFedExRateRequest({ ...INPUT, items: [{ ...INPUT.items[0]!, weightLb: 0 }] }, cfg),
    ).toThrow(/weight/);
    expect(() => buildFedExRateRequest({ ...INPUT, items: [] }, cfg)).toThrow(/at least one item/);
  });
});

describe("FedEx OAuth + Rate Freight (mocked transport)", () => {
  it("signs in with the Freight form body, rates with the three required headers, and picks the cheapest", async () => {
    const fake = fakeFedEx(() => json(RATE_OK));
    const quote = await getFedExFreightQuote(INPUT, { env: ENV, fetch: fake.fetch });

    const [auth, rate] = fake.calls;
    expect(auth!.url).toBe(FEDEX_FREIGHT_SANDBOX_AUTH_URL);
    const form = new URLSearchParams(String(auth!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id-123",
      client_secret: "client-secret-xyz",
      scope: "fxf-api",
    });

    expect(rate!.url).toBe(`https://rates.example.test${FEDEX_FREIGHT_RATE_PATH}`);
    const headers = rate!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-1");
    expect(headers["x-client-id"]).toBe("client-id-123");
    expect(headers["x-locale"]).toBe("en_US");

    expect(quote).toEqual({
      carrier: "FedEx Freight",
      rate: 742.1,
      days: 5,
      serviceType: "FEDEX_FREIGHT_ECONOMY",
    });
  });

  it("caches the token across calls and shares one sign-in between concurrent callers", async () => {
    const fake = fakeFedEx(() => json(RATE_OK));
    await Promise.all([
      getFedExFreightRates(INPUT, { env: ENV, fetch: fake.fetch }),
      getFedExFreightRates(INPUT, { env: ENV, fetch: fake.fetch }),
      getFedExFreightRates(INPUT, { env: ENV, fetch: fake.fetch }),
    ]);
    await getFedExFreightRates(INPUT, { env: ENV, fetch: fake.fetch });
    expect(fake.auth()).toBe(1);
    expect(fake.rates()).toBe(4);
  });

  it("signs in again once the token is inside the expiry skew", async () => {
    const fake = fakeFedEx(() => json(RATE_OK));
    let now = 1_000_000;
    const deps = { env: ENV, fetch: fake.fetch, now: () => now };
    await getFedExFreightRates(INPUT, deps);
    now += 3_600_000 - 30_000; // 30 s left, inside the 60 s skew
    await getFedExFreightRates(INPUT, deps);
    expect(fake.auth()).toBe(2);
  });

  it("re-authenticates exactly once on a 401 and then succeeds", async () => {
    const fake = fakeFedEx((_call, n) => (n === 1 ? json({ errors: [] }, 401) : json(RATE_OK)));
    const rates = await getFedExFreightRates(INPUT, { env: ENV, fetch: fake.fetch });
    expect(rates).toHaveLength(2);
    expect(fake.auth()).toBe(2);
    expect(fake.rates()).toBe(2);
  });

  it("gives up with AUTH_FAILED when a fresh token is also refused", async () => {
    const fake = fakeFedEx(() => json({ errors: [] }, 401));
    await expect(getFedExFreightRates(INPUT, { env: ENV, fetch: fake.fetch })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      status: 401,
    });
    expect(fake.rates()).toBe(2);
  });

  it("surfaces a refused rate call with status and provider CODES only, never provider text", async () => {
    const fake = fakeFedEx(() =>
      json(
        {
          errors: [
            { code: "RATE.ACCOUNT.INVALID", message: "Account 123456789 is not authorised, secret=abc" },
            { code: "has spaces so it is dropped", message: "ignored" },
          ],
        },
        400,
      ),
    );
    const error = await getFedExFreightRates(INPUT, { env: ENV, fetch: fake.fetch }).catch((e) => e);
    expect(error).toBeInstanceOf(FedExFreightError);
    expect(error).toMatchObject({
      code: "RATE_FAILED",
      status: 400,
      providerCodes: ["RATE.ACCOUNT.INVALID"],
    });
    expect(error.message).not.toContain("secret=abc");
    expect(error.message).not.toContain("123456789");
  });

  it("maps an OAuth refusal and a network failure to typed errors", async () => {
    const refused = vi.fn(async () => json({ error: "invalid_client" }, 401)) as unknown as typeof fetch;
    await expect(getFedExFreightRates(INPUT, { env: ENV, fetch: refused })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      status: 401,
    });
    resetFedExTokenCache();
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1");
    }) as unknown as typeof fetch;
    const error = await getFedExFreightRates(INPUT, { env: ENV, fetch: down }).catch((e) => e);
    expect(error).toMatchObject({ code: "AUTH_FAILED" });
    expect(error.message).not.toContain("10.0.0.1");
  });
});

describe("FedEx response parsing never invents a price", () => {
  it("reads totals from the supported shapes and sorts cheapest first", () => {
    const rates = parseFedExRateResponse(RATE_OK);
    expect(rates.map((r) => [r.serviceType, r.totalUsd, r.transitDays])).toEqual([
      ["FEDEX_FREIGHT_ECONOMY", 742.1, 5],
      ["FEDEX_FREIGHT_PRIORITY", 912.4, 3],
    ]);
  });

  it("takes the lowest rated detail per service and skips non-USD", () => {
    const rates = parseFedExRateResponse({
      output: {
        rateReplyDetails: [
          {
            serviceType: "A",
            ratedShipmentDetails: [
              { totalNetCharge: 500, currency: "CAD" },
              { totalNetCharge: 650 },
              { totalNetCharge: 610 },
            ],
          },
        ],
      },
    });
    expect(rates).toEqual([{ serviceType: "A", serviceName: null, totalUsd: 610, transitDays: null }]);
  });

  it.each([
    ["null body", null],
    ["no output", {}],
    ["empty replies", { output: { rateReplyDetails: [] } }],
    ["no amount", { output: { rateReplyDetails: [{ serviceType: "A", ratedShipmentDetails: [{}] }] } }],
    ["zero amount", { output: { rateReplyDetails: [{ ratedShipmentDetails: [{ totalNetCharge: 0 }] }] } }],
    ["negative amount", { output: { rateReplyDetails: [{ ratedShipmentDetails: [{ totalNetCharge: -5 }] }] } }],
    ["text amount", { output: { rateReplyDetails: [{ ratedShipmentDetails: [{ totalNetCharge: "call us" }] }] } }],
  ])("throws BAD_RESPONSE for %s", (_label, body) => {
    expect(() => parseFedExRateResponse(body)).toThrowError(FedExFreightError);
    try {
      parseFedExRateResponse(body);
    } catch (error) {
      expect(error).toMatchObject({ code: "BAD_RESPONSE" });
    }
  });
});

describe("FedEx carrier on the fulfillment plan", () => {
  const skid = {
    items: [
      {
        freightClass: "150",
        weight: 400,
        length: 48,
        width: 40,
        height: 40,
        packagingType: "Pallet" as const,
        isStackable: false,
      },
    ],
  };

  it("is omitted (null) and logged, never faked, when FedEx is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeFedEx(() => json(RATE_OK));
    await expect(rateFedExCarrier(skid, "90005", 10, { env: {}, fetch: fake.fetch })).resolves.toBeNull();
    expect(fake.fetch).not.toHaveBeenCalled();
    const line = JSON.parse(String(warn.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line).toMatchObject({ tag: "fedex-freight-skipped", reason: "not_configured" });
    expect(line.missing).toContain("FEDEX_FREIGHT_API_BASE");
  });

  it("returns the live total with the handling markup and a stable id", async () => {
    const fake = fakeFedEx(() => json(RATE_OK));
    const first = await rateFedExCarrier(skid, "90005", 10, { env: ENV, fetch: fake.fetch });
    const second = await rateFedExCarrier(skid, "90005", 10, { env: ENV, fetch: fake.fetch });
    expect(first).toMatchObject({
      carrierName: "FedEx Freight",
      carrierCode: "FEDEX_FREIGHT",
      brokerTotalUsd: 742.1,
      customerTotalUsd: 816.31,
      transitDays: 5,
    });
    expect(first!.id).toBeLessThan(0);
    expect(second!.id).toBe(first!.id);
    expect(first!.id).toBe(fedexCarrierQuoteId("FEDEX_FREIGHT_ECONOMY", 742.1));
    expect(first!.serviceLevel).toContain("excludes delivery accessorials");

    const sent = JSON.parse(String(fake.calls[1]!.init.body)) as {
      freightRequestedShipment: { origin: { address: { postalCode: string } } };
    };
    expect(sent.freightRequestedShipment.origin.address.postalCode).toBe("85260");
  });

  it("propagates a real FedEx failure so the planner can log it", async () => {
    const fake = fakeFedEx(() => json({ errors: [{ code: "X.Y" }] }, 503));
    await expect(rateFedExCarrier(skid, "90005", 0, { env: ENV, fetch: fake.fetch })).rejects.toMatchObject({
      code: "RATE_FAILED",
      status: 503,
    });
  });
});

describe("Priority1 fails closed without a key", () => {
  it("throws FreightRatingError instead of returning a shadow quote", async () => {
    vi.stubEnv("PRIORITY1_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PRIORITY1_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const skid = {
      items: [
        {
          freightClass: "150",
          weight: 400,
          length: 48,
          width: 40,
          height: 40,
          packagingType: "Pallet" as const,
          isStackable: false,
        },
      ],
    };
    await expect(getPriority1Quote(skid, "85260", "90005", [])).rejects.toBeInstanceOf(FreightRatingError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("no mocked freight table survives in src", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("has no FALLBACK_FREIGHT_MATRIX, shadow rater or MOCK MODE banner", () => {
    const root = path.resolve(__dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      if (/FALLBACK_FREIGHT_MATRIX|shadowPriority1RateQuote|\[MOCK MODE\]|matchShadowLane/.test(text)) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
