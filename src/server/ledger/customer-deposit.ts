/**
 * Phase 14: the pure Clover payment -> QuickBooks Online ledger translator.
 *
 * PURE. No I/O, no database, no env reads, no clock, no import from the QBO client. Every
 * money amount here is an INTEGER NUMBER OF CENTS until the single, tested boundary
 * (`toQboAmount`) turns it into the two-decimal JSON number QuickBooks wants.
 *
 * GAAP rules (operator-ratified):
 *  - The showroom never touches QBO. QBO is written only on a CAPITAL EVENT: a Clover payment
 *    successfully attached to an APPROVED quote. Anything else is `ignore` (never reaches QBO)
 *    or `triage` (a person must act).
 *  - The document is always a JournalEntry: DEBIT the clearing account, CREDIT the
 *    "Customer Deposits" liability account (customer entity on the credit line).
 *  - The sync strictly records CASH RECEIVED. No tax line, no revenue recognition (Phase 15),
 *    no rounding plug: a single amount cannot be off by a cent against itself.
 *  - The GHL quote id (`GHL-<opportunityId>`) is injected into the JournalEntry notes. The
 *    Clover order id is stored in Postgres (pos_receipts.clover_order_id) and echoed in the note.
 *
 * The QBO customer is found-or-created by the GHL contact email BEFORE this runs; the resolved
 * QBO customer id is an input. That lookup is I/O and lives in the worker, not here.
 */
import { qboRequestId } from "@/server/sre/idempotency";

export const LEDGER_DOC_TYPE = "JournalEntry" as const;
/** QBO Accounting API entity path segment for a JournalEntry. */
export const LEDGER_JOURNAL_ENTRY_ENDPOINT = "journalentry" as const;
/** Books close on Phoenix time, so a 6pm register close never lands on tomorrow's date. */
export const LEDGER_ACCOUNTING_TIME_ZONE = "America/Phoenix" as const;
/** Leg name for the deterministic Intuit `requestid`. One capital event = one JournalEntry. */
export const LEDGER_DEPOSIT_LEG = "customer_deposit_je" as const;

/** Names of the two account settings. Only NAMES ever appear in `detail`; never values. */
export const LEDGER_ACCOUNT_ENV = {
  clearing: "QBO_GATEWAY_CLEARING_ACCOUNT_ID",
  customerDeposits: "QBO_CUSTOMER_DEPOSIT_ACCOUNT_ID",
} as const;

export const QUOTE_REF_PATTERN = /^GHL-[A-Za-z0-9_-]{1,59}$/;
/** Clover ids are short alphanumerics. Anything else is a bug upstream, not data to sanitize. */
const CLOVER_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/** QuickBooks entity and account ids are numeric strings. */
const QBO_ID_PATTERN = /^\d{1,20}$/;

/** Mirrors the CHECK on ledger_triage.reason in migration 0056_ledger_triage.sql. */
export const LEDGER_TRIAGE_REASONS = [
  "quote_ref_invalid",
  "quote_not_approved",
  "invalid_amount",
  "unsupported_currency",
  "customer_email_missing",
  "customer_unresolved",
  "accounts_unconfigured",
  "qbo_rejected",
] as const;
export type LedgerTriageReason = (typeof LEDGER_TRIAGE_REASONS)[number];

/** Recorded on pos_receipts.last_error with status `ignored`. Never reaches QBO. */
export const LEDGER_IGNORE_REASONS = ["not_a_sale", "no_quote_attached"] as const;
export type LedgerIgnoreReason = (typeof LEDGER_IGNORE_REASONS)[number];

// ---------------------------------------------------------------------------
// Integer cents <-> QBO amount
// ---------------------------------------------------------------------------

function assertCents(cents: number, label: string): void {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer number of cents.`);
  }
}

/**
 * Integer cents -> the QBO JSON amount (two decimals). Built from integer division and
 * remainder, never `cents / 100`, so no float ever carries a running total.
 *   toQboAmount(5)      -> 0.05
 *   toQboAmount(129900) -> 1299
 *   toQboAmount(2999)   -> 29.99
 */
export function toQboAmount(cents: number): number {
  assertCents(cents, "cents");
  // `cents - remainder` is an exact multiple of 100, so this division is exact: no rounding
  // can ever move a whole-dollar amount, even near Number.MAX_SAFE_INTEGER.
  const remainder = cents % 100;
  const dollars = (cents - remainder) / 100;
  const text = `${dollars}.${String(remainder).padStart(2, "0")}`;
  const amount = Number(text);
  // A JSON number holds two decimals exactly only below roughly 3.5e13 dollars. Beyond that
  // the nearest double is a DIFFERENT cent value. Refuse rather than silently book the wrong cent.
  if (amount.toFixed(2) !== text) {
    throw new RangeError("cents is too large to represent exactly as a QBO amount.");
  }
  return amount;
}

/** The inverse, used to re-verify a built payload. Refuses anything with more than two decimals. */
export function qboAmountToCents(amount: number): number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new RangeError("amount must be a finite, non-negative number.");
  }
  const fixed = amount.toFixed(2);
  if (Number(fixed) !== amount) {
    throw new RangeError("amount has more than two decimal places.");
  }
  const cents = Number(fixed.replace(".", ""));
  assertCents(cents, "amount");
  return cents;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Lower-cased, trimmed email or null. The find-or-create key for the QBO customer. */
export function normalizeCustomerEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Clover webhook object ids look like `P:ABC123`. The REST path and our tables want `ABC123`. */
export function stripCloverPaymentPrefix(raw: string): string {
  return raw.startsWith("P:") ? raw.slice(2) : raw;
}

/** `YYYY-MM-DD` of an instant on the Phoenix calendar. */
export function accountingDate(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new RangeError("createdAtMs must be a finite epoch time.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LEDGER_ACCOUNTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** Reads the two account ids from an env-like record the CALLER passes. This module never reads process.env. */
export function ledgerAccountsFromEnv(env: Record<string, string | undefined>): {
  clearingAccountId: string | null;
  customerDepositsAccountId: string | null;
} {
  const get = (name: string): string | null => env[name]?.trim() || null;
  return {
    clearingAccountId: get(LEDGER_ACCOUNT_ENV.clearing),
    customerDepositsAccountId: get(LEDGER_ACCOUNT_ENV.customerDeposits),
  };
}

// ---------------------------------------------------------------------------
// The JournalEntry
// ---------------------------------------------------------------------------

export type JournalEntryLine = {
  Description: string;
  Amount: number;
  DetailType: "JournalEntryLineDetail";
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string };
    Entity?: { Type: "Customer"; EntityRef: { value: string } };
  };
};

export type CustomerDepositJournalEntry = {
  TxnDate: string;
  PrivateNote: string;
  /** Always [debit clearing, credit Customer Deposits]. */
  Line: [JournalEntryLine, JournalEntryLine];
};

/**
 * Re-derives the cents from the payload's own two-decimal amounts and proves debits equal
 * credits. Throws on any imbalance, so an unbalanced entry can never be returned or posted.
 */
export function assertJournalEntryBalanced(entry: CustomerDepositJournalEntry): {
  debitCents: number;
  creditCents: number;
} {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of entry.Line) {
    const cents = qboAmountToCents(line.Amount);
    if (line.JournalEntryLineDetail.PostingType === "Debit") debitCents += cents;
    else creditCents += cents;
  }
  if (debitCents <= 0 || debitCents !== creditCents) {
    throw new Error(`JournalEntry is not balanced (debit ${debitCents} cents, credit ${creditCents} cents).`);
  }
  return { debitCents, creditCents };
}

export type CapitalEventInput = {
  payment: {
    /** With or without the webhook `P:` prefix. */
    id: string;
    merchantId: string;
    /** Clover reports integer cents. Anything else is rejected as `invalid_amount`. */
    amountCents: number;
    currency: string;
    /** Clover payment `result`. Only `SUCCESS` is a sale. */
    result: string;
    refunded?: boolean;
    /** Clover payment timestamp (epoch ms). Decides the accounting date in Phoenix time. */
    createdAtMs: number;
  };
  /** Stored on pos_receipts.clover_order_id and echoed in the note. */
  cloverOrderId: string | null;
  /** The quote this payment was attached to. `null` means a showroom ticket. */
  quote: { ref: string | null; approved: boolean } | null;
  customer: {
    /** GHL contact email (the find-or-create key). */
    email: string | null;
    /** Result of the find-or-create. */
    qboCustomerId: string | null;
  };
  accounts: {
    clearingAccountId: string | null | undefined;
    customerDepositsAccountId: string | null | undefined;
  };
};

export type CapitalEventDecision =
  | {
      outcome: "post";
      docType: typeof LEDGER_DOC_TYPE;
      endpoint: typeof LEDGER_JOURNAL_ENTRY_ENDPOINT;
      /** Deterministic Intuit `requestid` (<= 50 chars). Reuse it on every retry. */
      requestId: string;
      /** Bare Clover payment id (no `P:`). */
      paymentId: string;
      quoteRef: string;
      customerEmail: string;
      txnDate: string;
      amountCents: number;
      debitCents: number;
      creditCents: number;
      body: CustomerDepositJournalEntry;
    }
  | { outcome: "ignore"; reason: LedgerIgnoreReason }
  | { outcome: "triage"; reason: LedgerTriageReason; detail: string | null };

function triage(reason: LedgerTriageReason, detail: string | null = null): CapitalEventDecision {
  return { outcome: "triage", reason, detail };
}

/**
 * Decides what a Clover payment means for the books and, for a capital event, builds the
 * balanced JournalEntry. Order of judgement (first match wins):
 *   1. not a successful sale / refund      -> ignore  not_a_sale
 *   2. no quote attached (showroom ticket) -> ignore  no_quote_attached   (QBO untouched)
 *   3. quote key malformed                 -> triage  quote_ref_invalid
 *   4. quote not approved                  -> triage  quote_not_approved
 *   5. amount not a positive integer       -> triage  invalid_amount
 *   6. currency is not USD                 -> triage  unsupported_currency
 *   7. no usable GHL contact email         -> triage  customer_email_missing
 *   8. QBO customer not resolved           -> triage  customer_unresolved
 *   9. account ids unset / not distinct    -> triage  accounts_unconfigured
 *  10. otherwise                           -> post    JournalEntry
 *
 * Malformed Clover ids or a non-finite timestamp THROW: they are upstream bugs, and inventing
 * a key would collapse distinct payments onto one idempotency key.
 */
export function buildCustomerDepositEntry(input: CapitalEventInput): CapitalEventDecision {
  const { payment, quote, customer, accounts } = input;

  // Identity first: a malformed id is a bug, not a business outcome.
  const paymentId = stripCloverPaymentPrefix(String(payment.id ?? "").trim());
  if (!CLOVER_ID_PATTERN.test(paymentId)) {
    throw new TypeError("Clover payment id is missing or malformed.");
  }
  const merchantId = String(payment.merchantId ?? "").trim();
  if (!CLOVER_ID_PATTERN.test(merchantId)) {
    throw new TypeError("Clover merchant id is missing or malformed.");
  }
  const cloverOrderId = input.cloverOrderId === null ? null : String(input.cloverOrderId).trim();
  if (cloverOrderId !== null && !CLOVER_ID_PATTERN.test(cloverOrderId)) {
    throw new TypeError("Clover order id is malformed.");
  }

  // 1. Only a successful, non-refunded payment is a sale.
  if (payment.result !== "SUCCESS" || payment.refunded === true) {
    return { outcome: "ignore", reason: "not_a_sale" };
  }

  // 2. The showroom never touches QBO.
  const quoteRef = quote?.ref?.trim() ?? "";
  if (!quote || quoteRef === "") {
    return { outcome: "ignore", reason: "no_quote_attached" };
  }

  // 3-4. The quote must be a real GHL key and approved.
  if (!QUOTE_REF_PATTERN.test(quoteRef)) return triage("quote_ref_invalid");
  if (quote.approved !== true) return triage("quote_not_approved");

  // 5-6. Cash received: a positive integer number of USD cents.
  const amountCents = payment.amountCents;
  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return triage("invalid_amount");
  }
  if (String(payment.currency ?? "").trim().toUpperCase() !== "USD") {
    return triage("unsupported_currency");
  }

  // 7-8. The QBO customer comes from the GHL contact email.
  const email = normalizeCustomerEmail(customer.email);
  if (email === null) return triage("customer_email_missing");
  const qboCustomerId = customer.qboCustomerId?.trim() ?? "";
  if (!QBO_ID_PATTERN.test(qboCustomerId)) return triage("customer_unresolved");

  // 9. Both accounts must be set, numeric, and different (a self-balancing entry books nothing).
  const clearing = accounts.clearingAccountId?.trim() ?? "";
  const deposits = accounts.customerDepositsAccountId?.trim() ?? "";
  const unset: string[] = [];
  if (!QBO_ID_PATTERN.test(clearing)) unset.push(LEDGER_ACCOUNT_ENV.clearing);
  if (!QBO_ID_PATTERN.test(deposits)) unset.push(LEDGER_ACCOUNT_ENV.customerDeposits);
  if (unset.length > 0) return triage("accounts_unconfigured", `unset or invalid: ${unset.join(", ")}`);
  if (clearing === deposits) {
    return triage(
      "accounts_unconfigured",
      `${LEDGER_ACCOUNT_ENV.clearing} and ${LEDGER_ACCOUNT_ENV.customerDeposits} must be different accounts`,
    );
  }

  // 10. Build the balanced JournalEntry.
  const txnDate = accountingDate(payment.createdAtMs);
  const amount = toQboAmount(amountCents);
  const description = `Customer deposit ${quoteRef}`;
  const body: CustomerDepositJournalEntry = {
    TxnDate: txnDate,
    PrivateNote:
      `Customer deposit | Quote ${quoteRef} | Clover payment ${paymentId} | ` +
      `Clover order ${cloverOrderId ?? "n/a"} | Merchant ${merchantId}`,
    Line: [
      {
        Description: description,
        Amount: amount,
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: clearing } },
      },
      {
        Description: description,
        Amount: amount,
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: deposits },
          Entity: { Type: "Customer", EntityRef: { value: qboCustomerId } },
        },
      },
    ],
  };

  // Independent proof from the payload itself: debits == credits == the Clover cents.
  const { debitCents, creditCents } = assertJournalEntryBalanced(body);
  if (debitCents !== amountCents) {
    throw new Error("JournalEntry total does not equal the Clover payment amount.");
  }

  return {
    outcome: "post",
    docType: LEDGER_DOC_TYPE,
    endpoint: LEDGER_JOURNAL_ENTRY_ENDPOINT,
    requestId: qboRequestId(`${merchantId}:${paymentId}`, LEDGER_DEPOSIT_LEG),
    paymentId,
    quoteRef,
    customerEmail: email,
    txnDate,
    amountCents,
    debitCents,
    creditCents,
    body,
  };
}
