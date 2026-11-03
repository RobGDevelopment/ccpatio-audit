import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { canPostToQbo } from "@/server/pipeline/ledger-mode";
import { QBO_REQUEST_ID_MAX_LENGTH } from "@/server/sre/idempotency";
import {
  QboApiError,
  createDefaultQboFetchDeps,
  qboFetchWithRefresh,
} from "./token-refresh";

export type QboEnvironment = "sandbox" | "production";

export class QboConfigError extends Error {
  readonly code = "QBO_CONFIG_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "QboConfigError";
  }
}

/**
 * Returns the active QBO environment strictly from QBO_ENVIRONMENT,
 * completely decoupled from NODE_ENV.
 */
export function getQboEnvironment(): QboEnvironment {
  const envVal = process.env.QBO_ENVIRONMENT?.trim().toLowerCase();
  return envVal === "production" ? "production" : "sandbox";
}

/**
 * Maps QBO_ENVIRONMENT to the correct Intuit API base URL.
 * Never checks NODE_ENV.
 */
export function getQboBaseUrl(): string {
  if (process.env.QBO_API_URL?.trim()) {
    return process.env.QBO_API_URL.trim().replace(/\/$/, "");
  }
  return getQboEnvironment() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/**
 * Maps the QBO environment to the corresponding row ID in qbo_auth_tokens.
 * production -> true
 * sandbox -> false
 */
export function getQboTokenId(env: QboEnvironment = getQboEnvironment()): boolean {
  return env === "production";
}

/**
 * Executes a fetch against the Intuit QuickBooks Online API.
 * Token refresh is serialized per environment with a Postgres advisory lock and is
 * double-checked, see ./token-refresh.ts (Phase 9 Task 4).
 */
async function qboFetch(endpoint: string, options: RequestInit = {}) {
  const qboEnv = getQboEnvironment();
  return qboFetchWithRefresh(
    endpoint,
    options,
    createDefaultQboFetchDeps({
      env: qboEnv,
      targetId: getQboTokenId(qboEnv),
      baseUrl: getQboBaseUrl(),
    }),
  );
}

async function getActiveRealmId(): Promise<string> {
  const db = getDb();
  const qboEnv = getQboEnvironment();
  const targetId = getQboTokenId(qboEnv);

  let [tokenRow] = await db
    .select({ realm_id: qbo_auth_tokens.realm_id })
    .from(qbo_auth_tokens)
    .where(eq(qbo_auth_tokens.id, targetId));

  if (!tokenRow?.realm_id && !targetId) {
    const [legacyRow] = await db
      .select({ realm_id: qbo_auth_tokens.realm_id })
      .from(qbo_auth_tokens)
      .where(eq(qbo_auth_tokens.id, true));
    tokenRow = legacyRow;
  }

  if (!tokenRow?.realm_id) {
    throw new Error(`Missing QBO Realm ID for environment "${qboEnv}" in database`);
  }

  return tokenRow.realm_id;
}

export async function pushToQBO(salesReceiptPayload: Record<string, unknown>) {
  // Defense in depth (§I.3): requires both master QBO_LEDGER_MODE and CLOVER_LEDGER_MODE to be live.
  if (!canPostToQbo("clover")) {
    throw new Error(
      "Clover/QBO ledger mode is log: refusing to POST to QuickBooks (fail-closed ledger containment).",
    );
  }

  const clearingAccountId = process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID?.trim() ?? "";
  if (!/^\d+$/.test(clearingAccountId)) {
    throw new QboConfigError(
      "QBO_GATEWAY_CLEARING_ACCOUNT_ID must be configured to a numeric QuickBooks Account Id.",
    );
  }

  salesReceiptPayload.DepositToAccountRef = {
    value: clearingAccountId,
  };

  const realmId = await getActiveRealmId();
  const endpoint = `/v3/company/${realmId}/salesreceipt`;

  return await qboFetch(endpoint, {
    method: "POST",
    body: JSON.stringify(salesReceiptPayload),
  });
}

export interface KatanaPoBillLineInput {
  sku: string;
  description: string;
  billedQtyDelta: number;
  pricePerUnitCents: number;
  amountCents: number;
}

export interface CreateQboVendorBillInput {
  katanaPoId: number;
  orderNo: string;
  qboVendorId: string;
  requestId: string;
  docNumber: string;
  txnDate: string;
  lines: readonly KatanaPoBillLineInput[];
}

export type QboVendorRecord = {
  id: string;
  displayName: string | null;
  active: boolean;
  currency: string | null;
};

export type QboBillSummary = {
  id: string;
  docNumber: string | null;
  vendorId: string | null;
  totalCents: number;
};

export type QboVendorCreditSummary = {
  id: string;
  vendorId: string | null;
  totalCents: number;
};

/**
 * Validates a Katana-supplied QBO Vendor Id via `GET /vendor/{id}` (§VII S-2.5).
 * Never searches by name and never creates vendors.
 */
export async function fetchQboVendorById(
  qboVendorId: string,
): Promise<QboVendorRecord | null> {
  const id = qboVendorId.trim();
  if (!/^[1-9]\d{0,11}$/.test(id)) {
    throw new QboConfigError(`Invalid QBO Vendor Id format: "${qboVendorId}"`);
  }
  const realmId = await getActiveRealmId();
  try {
    const res = (await qboFetch(
      `/v3/company/${realmId}/vendor/${encodeURIComponent(id)}?minorversion=75`,
      { method: "GET" },
    )) as {
      Vendor?: {
        Id?: string;
        DisplayName?: string;
        Active?: boolean;
        CurrencyRef?: { value?: string };
      };
    };
    const vendor = res?.Vendor;
    if (!vendor?.Id) return null;
    return {
      id: String(vendor.Id),
      displayName: typeof vendor.DisplayName === "string" ? vendor.DisplayName : null,
      active: vendor.Active !== false,
      currency:
        typeof vendor.CurrencyRef?.value === "string" ? vendor.CurrencyRef.value : null,
    };
  } catch (error) {
    if (
      error instanceof QboApiError &&
      (error.status === 404 ||
        (error.status === 400 && /(?:\b610\b|Object Not Found)/i.test(error.message)))
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Queries QBO for an existing Bill matching `DocNumber` before POSTing (§VI R-7.2).
 */
export async function findQboBillsByDocNumber(docNumber: string): Promise<QboBillSummary[]> {
  const clean = docNumber.trim();
  if (!clean) return [];
  const realmId = await getActiveRealmId();
  const escaped = clean.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = `SELECT Id, DocNumber, TotalAmt, VendorRef FROM Bill WHERE DocNumber = '${escaped}' MAXRESULTS 5`;
  const res = (await qboFetch(
    `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`,
    { method: "GET" },
  )) as {
    QueryResponse?: {
      Bill?: Array<{
        Id?: string;
        DocNumber?: string;
        TotalAmt?: number | string;
        VendorRef?: { value?: string };
      }>;
    };
  };

  const rows = Array.isArray(res?.QueryResponse?.Bill) ? res.QueryResponse.Bill : [];
  return rows
    .filter((b) => typeof b.Id === "string" && b.Id.trim().length > 0)
    .map((b) => ({
      id: String(b.Id),
      docNumber: typeof b.DocNumber === "string" ? b.DocNumber : null,
      vendorId: typeof b.VendorRef?.value === "string" ? b.VendorRef.value : null,
      totalCents: Math.round(Number(b.TotalAmt ?? 0) * 100),
    }));
}

export async function fetchQboBillById(billId: string): Promise<QboBillSummary | null> {
  const id = billId.trim();
  if (!id) return null;
  const realmId = await getActiveRealmId();
  try {
    const res = (await qboFetch(
      `/v3/company/${realmId}/bill/${encodeURIComponent(id)}?minorversion=75`,
      { method: "GET" },
    )) as {
      Bill?: {
        Id?: string;
        DocNumber?: string;
        TotalAmt?: number | string;
        VendorRef?: { value?: string };
      };
    };
    const bill = res?.Bill;
    if (!bill?.Id) return null;
    return {
      id: String(bill.Id),
      docNumber: typeof bill.DocNumber === "string" ? bill.DocNumber : null,
      vendorId: typeof bill.VendorRef?.value === "string" ? bill.VendorRef.value : null,
      totalCents: Math.round(Number(bill.TotalAmt ?? 0) * 100),
    };
  } catch (error) {
    if (
      error instanceof QboApiError &&
      (error.status === 404 ||
        (error.status === 400 && /(?:\b610\b|Object Not Found)/i.test(error.message)))
    ) {
      return null;
    }
    throw error;
  }
}

export async function fetchQboVendorCreditById(
  creditId: string,
): Promise<QboVendorCreditSummary | null> {
  const id = creditId.trim();
  if (!id) return null;
  const realmId = await getActiveRealmId();
  try {
    const res = (await qboFetch(
      `/v3/company/${realmId}/vendorcredit/${encodeURIComponent(id)}?minorversion=75`,
      { method: "GET" },
    )) as {
      VendorCredit?: {
        Id?: string;
        TotalAmt?: number | string;
        VendorRef?: { value?: string };
      };
    };
    const credit = res?.VendorCredit;
    if (!credit?.Id) return null;
    return {
      id: String(credit.Id),
      vendorId: typeof credit.VendorRef?.value === "string" ? credit.VendorRef.value : null,
      totalCents: Math.round(Number(credit.TotalAmt ?? 0) * 100),
    };
  } catch (error) {
    if (
      error instanceof QboApiError &&
      (error.status === 404 ||
        (error.status === 400 && /(?:\b610\b|Object Not Found)/i.test(error.message)))
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Creates an Accounts Payable (A/P) Vendor Bill in QBO for a Katana PO receipt delta (§15.2a, §VI R-6, §VII S-2).
 */
export async function createQboVendorBillFromKatanaPo(
  input: CreateQboVendorBillInput,
): Promise<{ billId: string; vendorId: string; totalDollars: string }> {
  if (!canPostToQbo("qbo")) {
    throw new Error(
      "QBO_LEDGER_MODE=log: refusing to POST Bill to QuickBooks (fail-closed ledger containment).",
    );
  }

  const accountId = process.env.QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID?.trim() ?? "";
  if (!/^\d+$/.test(accountId)) {
    throw new QboConfigError(
      "QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID must be configured to a numeric QuickBooks Account Id.",
    );
  }

  const vendorId = input.qboVendorId.trim();
  if (!/^[1-9]\d{0,11}$/.test(vendorId)) {
    throw new QboConfigError("qboVendorId must be a positive numeric QuickBooks Vendor Id.");
  }

  const requestId = input.requestId.trim();
  if (!requestId || requestId.length > QBO_REQUEST_ID_MAX_LENGTH) {
    throw new QboConfigError(
      `requestId must be 1..${QBO_REQUEST_ID_MAX_LENGTH} characters.`,
    );
  }

  const docNumber = input.docNumber.trim();
  if (!docNumber || docNumber.length > 21) {
    throw new QboConfigError("docNumber must be 1..21 characters.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.txnDate)) {
    throw new QboConfigError("txnDate must be a YYYY-MM-DD calendar date.");
  }

  const realmId = await getActiveRealmId();

  const qboLines = input.lines.map((line, idx) => ({
    Id: String(idx + 1),
    Amount: Number((line.amountCents / 100).toFixed(2)),
    Description: `${line.sku ? `[${line.sku}] ` : ""}${line.description} (Qty: ${line.billedQtyDelta} @ $${(line.pricePerUnitCents / 100).toFixed(2)})`,
    DetailType: "AccountBasedExpenseLineDetail",
    AccountBasedExpenseLineDetail: {
      AccountRef: { value: accountId },
      BillableStatus: "NotBillable",
    },
  }));

  const totalCents = input.lines.reduce((acc, l) => acc + l.amountCents, 0);

  const billPayload = {
    VendorRef: { value: vendorId },
    DocNumber: docNumber,
    TxnDate: input.txnDate,
    PrivateNote: `Automated from Katana MRP PO ${input.orderNo} (Katana ID #${input.katanaPoId})`,
    Line: qboLines,
  };

  const response = (await qboFetch(
    `/v3/company/${realmId}/bill?requestid=${encodeURIComponent(requestId)}&minorversion=75`,
    {
      method: "POST",
      body: JSON.stringify(billPayload),
    },
  )) as { Bill?: { Id?: string } };

  const createdBillId = response?.Bill?.Id?.trim();
  if (!createdBillId) {
    throw new Error("QBO Bill create returned no Id");
  }

  return {
    billId: createdBillId,
    vendorId,
    totalDollars: (totalCents / 100).toFixed(2),
  };
}
