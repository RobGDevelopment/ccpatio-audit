import { getDb } from "@/server/db/client";
import { qbo_auth_tokens } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getLedgerPipelineMode } from "@/server/pipeline/ledger-mode";
import { qboRequestId } from "@/server/sre/idempotency";
import { createDefaultQboFetchDeps, qboFetchWithRefresh } from "./token-refresh";

export type QboEnvironment = "sandbox" | "production";

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
 * Executes a fetch against the Intuit Quickbooks Online API.
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
      // Derive Base URL strictly from QBO_ENVIRONMENT, decoupled from NODE_ENV
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

export async function pushToQBO(salesReceiptPayload: any) {
  // Defense in depth (Phase 9 Task 0): even if a caller forgets the gate, the ledger
  // POST itself refuses to run unless LEDGER_PIPELINE_MODE is explicitly "live".
  const ledgerMode = getLedgerPipelineMode();
  if (ledgerMode !== "live") {
    throw new Error(
      `LEDGER_PIPELINE_MODE=${ledgerMode}: refusing to POST to QuickBooks (fail-closed ledger containment).`,
    );
  }

  // Map strictly to the clearing account configuration
  salesReceiptPayload.DepositToAccountRef = {
    value: process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID,
  };

  const realmId = await getActiveRealmId();
  const endpoint = `/v3/company/${realmId}/salesreceipt`;

  console.log(`[QBO] Pushing sales receipt to ${endpoint}`);

  return await qboFetch(endpoint, {
    method: "POST",
    body: JSON.stringify(salesReceiptPayload),
  });
}

export interface KatanaPoBillLineInput {
  sku: string;
  description: string;
  quantity: number;
  pricePerUnitCents: number;
  amountCents: number;
}

export interface CreateQboVendorBillInput {
  katanaPoId: number;
  orderNo: string;
  supplierName: string;
  txnDate: string;
  lines: KatanaPoBillLineInput[];
}

/**
 * Resolves a QBO Vendor.Id by DisplayName (e.g., "Cosentino" or "Glen Raven / Sunbrella"),
 * creating the Vendor in QBO if it does not exist yet.
 */
export async function resolveOrCreateQboVendor(
  realmId: string,
  supplierName: string,
): Promise<string> {
  const cleanName = supplierName.trim().slice(0, 100) || "Katana Supplier";
  const escaped = cleanName.replace(/'/g, "\\'");
  const query = `SELECT Id, DisplayName FROM Vendor WHERE DisplayName = '${escaped}' MAXRESULTS 1`;
  const lookup = (await qboFetch(
    `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`,
    { method: "GET" },
  )) as { QueryResponse?: { Vendor?: Array<{ Id?: string }> } };

  const existingId = lookup?.QueryResponse?.Vendor?.[0]?.Id;
  if (existingId) return existingId;

  const reqId = qboRequestId(`qbo:vendor:${cleanName.toLowerCase()}`, "create");
  const created = (await qboFetch(
    `/v3/company/${realmId}/vendor?requestid=${reqId}&minorversion=75`,
    {
      method: "POST",
      body: JSON.stringify({ DisplayName: cleanName }),
    },
  )) as { Vendor?: { Id?: string } };

  const newId = created?.Vendor?.Id;
  if (!newId) {
    throw new Error(`Failed to resolve or create QBO Vendor for "${cleanName}"`);
  }
  return newId;
}

/**
 * Creates an Accounts Payable (A/P) Vendor Bill in QBO when a Katana PO is marked Received.
 */
export async function createQboVendorBillFromKatanaPo(
  input: CreateQboVendorBillInput,
): Promise<{ billId: string; vendorId: string; totalDollars: string }> {
  const ledgerMode = getLedgerPipelineMode();
  if (ledgerMode !== "live") {
    throw new Error(
      `LEDGER_PIPELINE_MODE=${ledgerMode}: refusing to POST Bill to QuickBooks (fail-closed ledger containment).`,
    );
  }

  const accountId = process.env.QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID?.trim() || "81";
  const realmId = await getActiveRealmId();
  const vendorId = await resolveOrCreateQboVendor(realmId, input.supplierName);

  const qboLines = input.lines.map((line, idx) => ({
    Id: String(idx + 1),
    Amount: Number((line.amountCents / 100).toFixed(2)),
    Description: `${line.sku ? `[${line.sku}] ` : ""}${line.description} (Qty: ${line.quantity} @ $${(line.pricePerUnitCents / 100).toFixed(2)})`,
    DetailType: "AccountBasedExpenseLineDetail",
    AccountBasedExpenseLineDetail: {
      AccountRef: { value: accountId },
      BillableStatus: "NotBillable",
    },
  }));

  const totalCents = input.lines.reduce((acc, l) => acc + l.amountCents, 0);
  const reqId = qboRequestId(`katana:po:${input.katanaPoId}`, "ap-bill");

  const billPayload = {
    VendorRef: { value: vendorId, name: input.supplierName },
    DocNumber: input.orderNo.slice(0, 21),
    TxnDate: input.txnDate,
    PrivateNote: `Automated from Katana MRP PO ${input.orderNo} (Katana ID #${input.katanaPoId})`,
    Line: qboLines,
  };

  const response = (await qboFetch(
    `/v3/company/${realmId}/bill?requestid=${reqId}&minorversion=75`,
    {
      method: "POST",
      body: JSON.stringify(billPayload),
    },
  )) as { Bill?: { Id?: string } };

  return {
    billId: String(response?.Bill?.Id ?? "unknown"),
    vendorId,
    totalDollars: (totalCents / 100).toFixed(2),
  };
}
