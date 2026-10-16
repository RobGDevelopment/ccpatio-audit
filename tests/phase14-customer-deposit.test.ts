/**
 * Phase 14: the QBO ledger kickoff.
 *
 *  1. toQboAmount / buildCustomerDepositEntry: the pure integer-cent translator.
 *  2. Static guards: purity, and the hand-written migrations agree with schema.ts and the module.
 *  3. LIVE (RUN_DB_TESTS=1): the migrations run against REAL Postgres through Drizzle inside ONE
 *     transaction that ALWAYS rolls back. Nothing is committed, nothing is left behind, and no
 *     database mock appears anywhere. If the tables already exist the suite tests them in place,
 *     still inside the rolled-back transaction.
 *
 *   npm run qa:phase14-ledger-live
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import {
  LEDGER_ACCOUNT_ENV,
  LEDGER_IGNORE_REASONS,
  LEDGER_TRIAGE_REASONS,
  accountingDate,
  assertJournalEntryBalanced,
  buildCustomerDepositEntry,
  ledgerAccountsFromEnv,
  normalizeCustomerEmail,
  qboAmountToCents,
  stripCloverPaymentPrefix,
  toQboAmount,
  type CapitalEventInput,
  type CapitalEventDecision,
} from "@/server/ledger/customer-deposit";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOON_UTC_OCT_15_2026 = Date.UTC(2026, 9, 15, 19, 0, 0); // 12:00 in Phoenix

function input(overrides: Partial<CapitalEventInput> = {}): CapitalEventInput {
  return {
    payment: {
      id: "P:ABC123XYZ",
      merchantId: "MERCH0001",
      amountCents: 129_900,
      currency: "USD",
      result: "SUCCESS",
      refunded: false,
      createdAtMs: NOON_UTC_OCT_15_2026,
    },
    cloverOrderId: "ORD9988",
    quote: { ref: "GHL-opp_8f3kQ2", approved: true },
    customer: { email: "  Buyer@Example.COM ", qboCustomerId: "58" },
    accounts: { clearingAccountId: "41", customerDepositsAccountId: "77" },
    ...overrides,
  };
}

function post(decision: CapitalEventDecision) {
  if (decision.outcome !== "post") {
    throw new Error(`expected post, got ${JSON.stringify(decision)}`);
  }
  return decision;
}

/** Tiny deterministic generator so the property loop is reproducible. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

// ---------------------------------------------------------------------------
// 1. toQboAmount
// ---------------------------------------------------------------------------

describe("toQboAmount (integer cents -> QBO amount)", () => {
  it("renders exact two-decimal amounts", () => {
    expect(toQboAmount(0)).toBe(0);
    expect(toQboAmount(1)).toBe(0.01);
    expect(toQboAmount(5)).toBe(0.05);
    expect(toQboAmount(99)).toBe(0.99);
    expect(toQboAmount(100)).toBe(1);
    expect(toQboAmount(101)).toBe(1.01);
    expect(toQboAmount(2999)).toBe(29.99);
    expect(toQboAmount(129_900)).toBe(1299);
    expect(toQboAmount(1_000_000_01)).toBe(1_000_000.01);
  });

  it("refuses anything that is not a non-negative safe integer", () => {
    for (const bad of [-1, 0.5, 1.0000001, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => toQboAmount(bad), String(bad)).toThrow(RangeError);
    }
    expect(() => toQboAmount("100" as unknown as number)).toThrow(RangeError);
    expect(() => toQboAmount(null as unknown as number)).toThrow(RangeError);
  });

  it("round-trips: every cent 0..250000 survives toQboAmount -> qboAmountToCents", () => {
    for (let cents = 0; cents <= 250_000; cents += 1) {
      const amount = toQboAmount(cents);
      if (qboAmountToCents(amount) !== cents) {
        throw new Error(`round trip broke at ${cents} cents (amount ${amount})`);
      }
    }
  });

  it("round-trips 20,000 seeded large values and never carries a float error", () => {
    const next = lcg(14);
    for (let i = 0; i < 20_000; i += 1) {
      const cents = next() * 32 + (next() % 32); // up to ~1.4e11 cents
      const amount = toQboAmount(cents);
      expect(qboAmountToCents(amount)).toBe(cents);
      expect(Number(amount.toFixed(2).replace(".", ""))).toBe(cents);
    }
  });

  it("qboAmountToCents refuses sub-cent amounts", () => {
    expect(() => qboAmountToCents(0.001)).toThrow(RangeError);
    expect(() => qboAmountToCents(10.005)).toThrow(RangeError);
    expect(() => qboAmountToCents(-1)).toThrow(RangeError);
    expect(qboAmountToCents(0.07)).toBe(7);
    expect(qboAmountToCents(1.1)).toBe(110);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

describe("small pure helpers", () => {
  it("normalizes the GHL email (the QBO customer find-or-create key)", () => {
    expect(normalizeCustomerEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
    for (const bad of ["", "   ", "no-at-sign", "a@b", "a b@c.com", null, undefined]) {
      expect(normalizeCustomerEmail(bad as string | null), String(bad)).toBeNull();
    }
    expect(normalizeCustomerEmail(`${"a".repeat(250)}@b.co`)).toBeNull();
  });

  it("strips the Clover webhook P: prefix once", () => {
    expect(stripCloverPaymentPrefix("P:ABC")).toBe("ABC");
    expect(stripCloverPaymentPrefix("ABC")).toBe("ABC");
  });

  it("dates the entry on the Phoenix calendar (UTC-7, no DST)", () => {
    expect(accountingDate(Date.UTC(2026, 9, 16, 6, 59, 0))).toBe("2026-10-15"); // 23:59 Phoenix
    expect(accountingDate(Date.UTC(2026, 9, 16, 7, 0, 0))).toBe("2026-10-16"); // 00:00 Phoenix
    expect(accountingDate(Date.UTC(2026, 0, 1, 3, 0, 0))).toBe("2025-12-31");
    expect(() => accountingDate(Number.NaN)).toThrow(RangeError);
  });

  it("reads the two account ids from a caller-supplied env and reports only NAMES", () => {
    expect(
      ledgerAccountsFromEnv({
        [LEDGER_ACCOUNT_ENV.clearing]: " 41 ",
        [LEDGER_ACCOUNT_ENV.customerDeposits]: "",
      }),
    ).toEqual({ clearingAccountId: "41", customerDepositsAccountId: null });
  });
});

// ---------------------------------------------------------------------------
// 2. buildCustomerDepositEntry
// ---------------------------------------------------------------------------

describe("buildCustomerDepositEntry: a capital event posts a balanced JournalEntry", () => {
  it("debits the clearing account and credits Customer Deposits, for exactly the cash received", () => {
    const decision = post(buildCustomerDepositEntry(input()));

    expect(decision).toMatchObject({
      docType: "JournalEntry",
      endpoint: "journalentry",
      paymentId: "ABC123XYZ",
      quoteRef: "GHL-opp_8f3kQ2",
      customerEmail: "buyer@example.com",
      txnDate: "2026-10-15",
      amountCents: 129_900,
      debitCents: 129_900,
      creditCents: 129_900,
    });

    expect(decision.body.Line).toEqual([
      {
        Description: "Customer deposit GHL-opp_8f3kQ2",
        Amount: 1299,
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "41" } },
      },
      {
        Description: "Customer deposit GHL-opp_8f3kQ2",
        Amount: 1299,
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: "77" },
          Entity: { Type: "Customer", EntityRef: { value: "58" } },
        },
      },
    ]);
  });

  it("puts the GHL quote id in the notes and echoes the Clover order id", () => {
    const { body } = post(buildCustomerDepositEntry(input()));
    expect(body.PrivateNote).toContain("Quote GHL-opp_8f3kQ2");
    expect(body.PrivateNote).toContain("Clover order ORD9988");
    expect(body.PrivateNote).toContain("Clover payment ABC123XYZ");
    expect(body.PrivateNote).not.toContain("P:");
    expect(body.PrivateNote.length).toBeLessThan(4000);
    expect(post(buildCustomerDepositEntry(input({ cloverOrderId: null }))).body.PrivateNote).toContain(
      "Clover order n/a",
    );
  });

  it("records cash only: two lines, no tax, no revenue, no rounding plug", () => {
    const { body } = post(buildCustomerDepositEntry(input({ payment: { ...input().payment, amountCents: 3_333 } })));
    expect(body.Line).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/tax|revenue|sales|rounding|income/i);
    expect(Object.keys(body).sort()).toEqual(["Line", "PrivateNote", "TxnDate"]);
  });

  it("derives a stable, short, per-payment Intuit requestid and ignores the P: prefix", () => {
    const a = post(buildCustomerDepositEntry(input()));
    const b = post(buildCustomerDepositEntry(input({ payment: { ...input().payment, id: "ABC123XYZ" } })));
    const c = post(buildCustomerDepositEntry(input({ payment: { ...input().payment, id: "P:OTHER99" } })));
    const d = post(buildCustomerDepositEntry(input({ payment: { ...input().payment, merchantId: "MERCH0002" } })));
    expect(a.requestId).toBe(b.requestId);
    expect(a.requestId).not.toBe(c.requestId);
    expect(a.requestId).not.toBe(d.requestId);
    expect(a.requestId).toMatch(/^[0-9a-f]{1,50}$/);
    expect(a.requestId.length).toBeLessThanOrEqual(50);
  });

  it("is deterministic and never mutates its input", () => {
    const original = input();
    const snapshot = JSON.stringify(original);
    const first = JSON.stringify(buildCustomerDepositEntry(original));
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(JSON.stringify(buildCustomerDepositEntry(original))).toBe(first);
  });

  it("balances debits and credits to the Clover cent for 5,000 seeded payments", () => {
    const next = lcg(2026);
    const edge = [1, 2, 99, 100, 101, 999, 1_000, 2_999, 49_999, 50_000, 129_900, 9_999_999];
    for (let i = 0; i < 5_000; i += 1) {
      const cents = i < edge.length ? edge[i]! : (next() % 5_000_000) + 1;
      const decision = post(
        buildCustomerDepositEntry(input({ payment: { ...input().payment, amountCents: cents } })),
      );
      expect(decision.debitCents).toBe(cents);
      expect(decision.creditCents).toBe(cents);
      expect(assertJournalEntryBalanced(decision.body)).toEqual({ debitCents: cents, creditCents: cents });
    }
  });

  it("assertJournalEntryBalanced throws on an unbalanced or zero entry", () => {
    const good = post(buildCustomerDepositEntry(input())).body;
    const skewed = structuredClone(good);
    skewed.Line[1].Amount = 1298.99;
    expect(() => assertJournalEntryBalanced(skewed)).toThrow(/not balanced/);
    const zero = structuredClone(good);
    zero.Line[0].Amount = 0;
    zero.Line[1].Amount = 0;
    expect(() => assertJournalEntryBalanced(zero)).toThrow(/not balanced/);
  });
});

describe("buildCustomerDepositEntry: only a capital event reaches QBO", () => {
  const cases: Array<[string, Partial<CapitalEventInput>, CapitalEventDecision]> = [
    [
      "a declined payment",
      { payment: { ...input().payment, result: "FAIL" } },
      { outcome: "ignore", reason: "not_a_sale" },
    ],
    [
      "a refunded payment",
      { payment: { ...input().payment, refunded: true } },
      { outcome: "ignore", reason: "not_a_sale" },
    ],
    ["a showroom ticket (no quote)", { quote: null }, { outcome: "ignore", reason: "no_quote_attached" }],
    [
      "a payment whose quote key is blank",
      { quote: { ref: "   ", approved: true } },
      { outcome: "ignore", reason: "no_quote_attached" },
    ],
    [
      "a malformed quote key",
      { quote: { ref: "QUOTE-12", approved: true } },
      { outcome: "triage", reason: "quote_ref_invalid", detail: null },
    ],
    [
      "a quote key with an injection attempt",
      { quote: { ref: "GHL-1; DROP TABLE x", approved: true } },
      { outcome: "triage", reason: "quote_ref_invalid", detail: null },
    ],
    [
      "a quote that is not approved yet",
      { quote: { ref: "GHL-abc", approved: false } },
      { outcome: "triage", reason: "quote_not_approved", detail: null },
    ],
    [
      "a fractional cent amount",
      { payment: { ...input().payment, amountCents: 1299.5 } },
      { outcome: "triage", reason: "invalid_amount", detail: null },
    ],
    [
      "a zero amount",
      { payment: { ...input().payment, amountCents: 0 } },
      { outcome: "triage", reason: "invalid_amount", detail: null },
    ],
    [
      "a negative amount",
      { payment: { ...input().payment, amountCents: -500 } },
      { outcome: "triage", reason: "invalid_amount", detail: null },
    ],
    [
      "a dollars-as-float amount",
      { payment: { ...input().payment, amountCents: Number.NaN } },
      { outcome: "triage", reason: "invalid_amount", detail: null },
    ],
    [
      "a non-USD payment",
      { payment: { ...input().payment, currency: "CAD" } },
      { outcome: "triage", reason: "unsupported_currency", detail: null },
    ],
    [
      "a contact with no email",
      { customer: { email: null, qboCustomerId: "58" } },
      { outcome: "triage", reason: "customer_email_missing", detail: null },
    ],
    [
      "a contact with a junk email",
      { customer: { email: "not an email", qboCustomerId: "58" } },
      { outcome: "triage", reason: "customer_email_missing", detail: null },
    ],
    [
      "a QBO customer that was never resolved",
      { customer: { email: "a@b.co", qboCustomerId: null } },
      { outcome: "triage", reason: "customer_unresolved", detail: null },
    ],
    [
      "a non-numeric QBO customer id",
      { customer: { email: "a@b.co", qboCustomerId: "58; x" } },
      { outcome: "triage", reason: "customer_unresolved", detail: null },
    ],
    [
      "an unset clearing account",
      { accounts: { clearingAccountId: undefined, customerDepositsAccountId: "77" } },
      { outcome: "triage", reason: "accounts_unconfigured", detail: "unset or invalid: QBO_GATEWAY_CLEARING_ACCOUNT_ID" },
    ],
    [
      "both accounts unset (names only in the detail)",
      { accounts: { clearingAccountId: "", customerDepositsAccountId: null } },
      {
        outcome: "triage",
        reason: "accounts_unconfigured",
        detail: "unset or invalid: QBO_GATEWAY_CLEARING_ACCOUNT_ID, QBO_CUSTOMER_DEPOSIT_ACCOUNT_ID",
      },
    ],
    [
      "the same account on both sides",
      { accounts: { clearingAccountId: "41", customerDepositsAccountId: "41" } },
      {
        outcome: "triage",
        reason: "accounts_unconfigured",
        detail: "QBO_GATEWAY_CLEARING_ACCOUNT_ID and QBO_CUSTOMER_DEPOSIT_ACCOUNT_ID must be different accounts",
      },
    ],
  ];

  it.each(cases)("%s", (_label, overrides, expected) => {
    expect(buildCustomerDepositEntry(input(overrides))).toEqual(expected);
  });

  it("judges in a fixed order: a refund beats a missing quote, an unapproved quote beats a bad amount", () => {
    expect(
      buildCustomerDepositEntry(input({ quote: null, payment: { ...input().payment, refunded: true } })),
    ).toEqual({ outcome: "ignore", reason: "not_a_sale" });
    expect(
      buildCustomerDepositEntry(
        input({ quote: { ref: "GHL-x", approved: false }, payment: { ...input().payment, amountCents: -1 } }),
      ),
    ).toMatchObject({ reason: "quote_not_approved" });
  });

  it("an ignore or triage outcome never carries an entry body", () => {
    for (const [, overrides] of cases) {
      const decision = buildCustomerDepositEntry(input(overrides));
      expect(decision.outcome).not.toBe("post");
      expect(decision).not.toHaveProperty("body");
      expect(decision).not.toHaveProperty("requestId");
    }
  });

  it("throws on a malformed Clover id rather than inventing a key", () => {
    for (const id of ["", "   ", "P:", "has space", "a/b", "x".repeat(65)]) {
      expect(() => buildCustomerDepositEntry(input({ payment: { ...input().payment, id } })), id).toThrow(TypeError);
    }
    expect(() => buildCustomerDepositEntry(input({ payment: { ...input().payment, merchantId: "" } }))).toThrow(
      TypeError,
    );
    expect(() => buildCustomerDepositEntry(input({ cloverOrderId: "bad id!" }))).toThrow(TypeError);
    expect(() =>
      buildCustomerDepositEntry(input({ payment: { ...input().payment, createdAtMs: Number.NaN } })),
    ).toThrow(RangeError);
  });

  it("every reason the module can return is a legal ledger_triage reason", () => {
    const seen = new Set<string>();
    for (const [, overrides] of cases) {
      const decision = buildCustomerDepositEntry(input(overrides));
      if (decision.outcome === "triage") seen.add(decision.reason);
      if (decision.outcome === "ignore") expect(LEDGER_IGNORE_REASONS).toContain(decision.reason);
    }
    for (const reason of seen) expect(LEDGER_TRIAGE_REASONS).toContain(reason);
  });
});

// ---------------------------------------------------------------------------
// 3. Static guards
// ---------------------------------------------------------------------------

describe("static guards", () => {
  const moduleSource = read("src/server/ledger/customer-deposit.ts");

  it("the translator is pure: no I/O, no env, no clock, no QBO client, no database", () => {
    const code = moduleSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/Date\.now\(|new Date\(\)/);
    expect(code).not.toMatch(/\bfetch\(|XMLHttpRequest|node:fs|node:net|node:http/);
    expect(code).not.toMatch(/Math\.random|randomUUID/);
    expect(code).not.toMatch(/\bconsole\./);
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["@/server/sre/idempotency"]);
  });

  it("never divides cents by 100 to build an amount", () => {
    const code = moduleSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bcents\s*\/\s*100\b/);
    expect(code).not.toMatch(/Math\.(trunc|floor|round)\(\s*cents/);
  });

  it("refuses an amount a JSON number cannot hold to the cent instead of booking a wrong cent", () => {
    const safeTop = Number.MAX_SAFE_INTEGER - (Number.MAX_SAFE_INTEGER % 100) - 1; // ...99, near the limit
    expect(Number.isSafeInteger(safeTop)).toBe(true);
    // 90071992547408.99 would come back from a double as .98. It must throw, never round.
    expect(() => toQboAmount(safeTop)).toThrow(/too large to represent exactly/);
    // Anything a real deposit could be ($100 billion) is exact.
    const huge = 10_000_000_000_000 + 99; // $100,000,000,000.99
    expect(qboAmountToCents(toQboAmount(huge))).toBe(huge);
  });

  it("the Woo ledger leg still does not import the QBO client or this module", () => {
    const wooLeg = read("src/server/woocommerce/ledger-leg.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    const imports = [...wooLeg.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/integrations\/qbo/);
      expect(specifier).not.toMatch(/server\/ledger/);
    }
  });
});

describe("migrations, schema.ts and the module agree", () => {
  const posSql = read("src/server/db/migrations/0056_pos_receipts.sql");
  const triageSql = read("src/server/db/migrations/0056_ledger_triage.sql");
  const schema = read("src/server/db/schema.ts");
  const journal = JSON.parse(read("src/server/db/migrations/meta/_journal.json")) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  const codeOf = (text: string) => text.replace(/^\s*--.*$/gm, "");

  it("are additive only: no DROP, TRUNCATE, DELETE, UPDATE or ALTER of an existing object", () => {
    for (const text of [posSql, triageSql]) {
      const code = codeOf(text);
      expect(code).not.toMatch(/\bDROP\b/i);
      expect(code).not.toMatch(/\bTRUNCATE\b/i);
      expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(code).not.toMatch(/\bUPDATE\s+"?\w+"?\s+SET\b/i);
      const alters = [...code.matchAll(/ALTER TABLE\s+"(\w+)"/gi)].map((match) => match[1]);
      for (const table of alters) expect(["pos_receipts", "ledger_triage"]).toContain(table);
    }
  });

  it("enable RLS with no policy and no FORCE, and REVOKE from the Supabase roles behind a guard", () => {
    for (const [table, text] of [
      ["pos_receipts", posSql],
      ["ledger_triage", triageSql],
    ] as const) {
      const code = codeOf(text);
      expect(code).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(code).toContain(`REVOKE ALL ON TABLE "${table}" FROM anon, authenticated`);
      expect(code).toMatch(/EXCEPTION\s+WHEN undefined_object THEN NULL/);
      expect(code).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
      expect(code).not.toMatch(/CREATE POLICY/i);
      expect(schema).toContain(`"${table}"`);
    }
    expect(schema).toMatch(/pos_receipts[\s\S]*?\)\.enableRLS\(\)/);
    expect(schema).toMatch(/ledger_triage[\s\S]*?\)\.enableRLS\(\)/);
  });

  it("key the receipt on (merchant, payment), store clover_order_id and quote_ref, and fix the doc type", () => {
    expect(posSql).toContain('UNIQUE INDEX "pos_receipts_merchant_payment_uidx"');
    expect(posSql).toContain('"clover_order_id" text');
    expect(posSql).toContain('"quote_ref" text');
    expect(posSql).toContain(`"qbo_doc_type" text DEFAULT 'JournalEntry' NOT NULL`);
    expect(posSql).toContain(`"pos_receipts"."qbo_doc_type" = 'JournalEntry'`);
    expect(posSql).toContain("'^GHL-[A-Za-z0-9_-]+$'");
    expect(posSql).toContain("not like 'P:%'");
    expect(codeOf(posSql)).not.toMatch(/tax/i);
  });

  it("never lets a paid receipt be deleted through triage, and allows one open row per reason", () => {
    expect(triageSql).toContain("ON DELETE restrict");
    expect(triageSql).toContain('UNIQUE INDEX "ledger_triage_open_reason_uidx"');
    expect(triageSql).toContain(`WHERE "ledger_triage"."status" = 'open'`);
  });

  it("list exactly the module's triage reasons in SQL and in schema.ts", () => {
    const list = LEDGER_TRIAGE_REASONS.map((reason) => `'${reason}'`).join(", ");
    expect(triageSql).toContain(`in (${list})`);
    expect(schema).toContain(`in (${list})`);
  });

  it("are registered in the journal in dependency order, with a consistent snapshot chain", () => {
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0056_pos_receipts")).toBeGreaterThan(tags.indexOf("0055_path_a_stateless_release"));
    expect(tags.indexOf("0056_ledger_triage")).toBe(tags.indexOf("0056_pos_receipts") + 1);
    const pos = journal.entries.find((entry) => entry.tag === "0056_pos_receipts")!;
    const triageEntry = journal.entries.find((entry) => entry.tag === "0056_ledger_triage")!;
    const prev = JSON.parse(read("src/server/db/migrations/meta/0055_snapshot.json")) as { id: string };
    const snapPos = JSON.parse(
      read(`src/server/db/migrations/meta/${String(pos.idx).padStart(4, "0")}_snapshot.json`),
    ) as { id: string; prevId: string; tables: Record<string, unknown> };
    const snapTriage = JSON.parse(
      read(`src/server/db/migrations/meta/${String(triageEntry.idx).padStart(4, "0")}_snapshot.json`),
    ) as { id: string; prevId: string; tables: Record<string, unknown> };
    expect(snapPos.prevId).toBe(prev.id);
    expect(snapTriage.prevId).toBe(snapPos.id);
    expect(snapPos.tables).toHaveProperty(["public.pos_receipts"]);
    expect(snapPos.tables).not.toHaveProperty(["public.ledger_triage"]);
    expect(snapTriage.tables).toHaveProperty(["public.pos_receipts"]);
    expect(snapTriage.tables).toHaveProperty(["public.ledger_triage"]);
  });
});

// ---------------------------------------------------------------------------
// 4. LIVE: real Postgres through Drizzle, one transaction, ALWAYS rolled back
// ---------------------------------------------------------------------------

const LIVE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.POSTGRES_URL?.trim());

class Rollback extends Error {
  constructor() {
    super("rollback-sentinel");
  }
}

function constraintOf(error: unknown): string {
  const record = error as { constraint_name?: string; cause?: { constraint_name?: string; message?: string } };
  return record?.cause?.constraint_name ?? record?.constraint_name ?? "";
}

function statementsOf(file: string): string[] {
  return read(file)
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.replace(/^\s*--.*$/gm, "").trim().length > 0);
}

describe.skipIf(!LIVE)("LIVE Postgres: the migrations and their constraints (rolled back, nothing persists)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("applies both migrations and enforces every rule, then rolls everything back", async () => {
    const host = (() => {
      try {
        const url = new URL(process.env.POSTGRES_URL!);
        return `${decodeURIComponent(url.username)}@${url.host}`;
      } catch {
        return "unparseable";
      }
    })();
    console.log(`[phase14-live] transaction (always rolled back) on ${host}`);

    const checks: string[] = [];
    const db = getDb();

    await expect(
      db.transaction(async (tx) => {
        const exists = async (table: string) => {
          const rows = (await tx.execute(sql`select to_regclass(${`public.${table}`}) as t`)) as unknown as Array<{
            t: string | null;
          }>;
          return rows[0]?.t != null;
        };

        const preExisting = await exists("pos_receipts");
        if (!preExisting) {
          for (const file of [
            "src/server/db/migrations/0056_pos_receipts.sql",
            "src/server/db/migrations/0056_ledger_triage.sql",
          ]) {
            for (const statement of statementsOf(file)) await tx.execute(sql.raw(statement));
          }
        }
        expect(await exists("pos_receipts")).toBe(true);
        expect(await exists("ledger_triage")).toBe(true);
        checks.push(preExisting ? "tables already existed (tested in place)" : "both migrations applied");

        // RLS on, no policies.
        const rls = (await tx.execute(
          sql`select relname, relrowsecurity, relforcerowsecurity from pg_class
              where relname in ('pos_receipts', 'ledger_triage') and relnamespace = 'public'::regnamespace
              order by relname`,
        )) as unknown as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;
        expect(rls).toHaveLength(2);
        for (const row of rls) {
          expect(row.relrowsecurity, row.relname).toBe(true);
          expect(row.relforcerowsecurity, row.relname).toBe(false);
        }
        const policies = (await tx.execute(
          sql`select count(*)::int as n from pg_policies where tablename in ('pos_receipts', 'ledger_triage')`,
        )) as unknown as Array<{ n: number }>;
        expect(policies[0]!.n).toBe(0);
        checks.push("RLS enabled, no FORCE, no policies");

        // The Supabase data-API roles hold no privileges (only checked when those roles exist).
        const roles = (await tx.execute(
          sql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`,
        )) as unknown as Array<{ rolname: string }>;
        for (const { rolname } of roles) {
          for (const table of ["pos_receipts", "ledger_triage"]) {
            const priv = (await tx.execute(
              sql`select has_table_privilege(${rolname}, ${`public.${table}`}, 'SELECT, INSERT, UPDATE, DELETE') as p`,
            )) as unknown as Array<{ p: boolean }>;
            expect(priv[0]!.p, `${rolname} on ${table}`).toBe(false);
          }
        }
        checks.push(`REVOKE verified for roles: ${roles.map((r) => r.rolname).join(", ") || "(none present)"}`);

        const run = `QA${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const insertReceipt = (tx2: typeof tx, over: Record<string, string> = {}) => {
          const v = {
            merchant: `M${run}`,
            payment: `PAY${run}`,
            status: "pending",
            ...over,
          };
          return tx2.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, status, qbo_request_id)
                values (${v.merchant}, ${v.payment}, ${v.status}, ${`req-${v.payment}`.slice(0, 50)})
                returning id`,
          );
        };
        const expectViolation = async (label: string, constraint: string, work: (sp: typeof tx) => Promise<unknown>) => {
          let caught: unknown = null;
          try {
            await tx.transaction(async (sp) => {
              await work(sp as unknown as typeof tx);
            });
          } catch (error) {
            caught = error;
          }
          expect(caught, `${label}: expected a violation`).not.toBeNull();
          expect(constraintOf(caught), label).toBe(constraint);
          checks.push(`rejected: ${label} (${constraint})`);
        };

        // A valid pending receipt, and a valid posted one.
        const [receipt] = (await insertReceipt(tx)) as unknown as Array<{ id: string }>;
        expect(receipt!.id).toMatch(/^[0-9a-f-]{36}$/);
        await tx.execute(
          sql`insert into pos_receipts (merchant_id, clover_payment_id, clover_order_id, quote_ref, customer_email,
                qbo_customer_id, status, amount_cents, qbo_request_id, qbo_journal_entry_id, posted_at)
              values (${`M${run}`}, ${`POSTED${run}`}, 'ORD1', 'GHL-opp_1', 'buyer@example.com', '58', 'posted', 129900,
                ${`req-posted-${run}`.slice(0, 50)}, ${`JE${run}`}, now())`,
        );
        checks.push("accepted: a valid pending receipt and a valid posted receipt");

        await expectViolation("duplicate (merchant, payment)", "pos_receipts_merchant_payment_uidx", (sp) =>
          insertReceipt(sp),
        );
        await expectViolation("P: prefixed payment id", "pos_receipts_payment_id_bare", (sp) =>
          insertReceipt(sp, { payment: `P:${run}` }),
        );
        await expectViolation("unknown status", "pos_receipts_status_check", (sp) =>
          insertReceipt(sp, { payment: `S${run}`, status: "paid" }),
        );
        await expectViolation("zero amount", "pos_receipts_amount_positive", (sp) =>
          sp.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, amount_cents, qbo_request_id)
                values (${`M${run}`}, ${`Z${run}`}, 0, 'req-z')`,
          ),
        );
        await expectViolation("non-USD currency", "pos_receipts_currency_usd", (sp) =>
          sp.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, currency, qbo_request_id)
                values (${`M${run}`}, ${`C${run}`}, 'CAD', 'req-c')`,
          ),
        );
        await expectViolation("a document type other than JournalEntry", "pos_receipts_doc_type_check", (sp) =>
          sp.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, qbo_doc_type, qbo_request_id)
                values (${`M${run}`}, ${`D${run}`}, 'SalesReceipt', 'req-d')`,
          ),
        );
        await expectViolation("malformed quote key", "pos_receipts_quote_ref_format", (sp) =>
          sp.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, quote_ref, qbo_request_id)
                values (${`M${run}`}, ${`Q${run}`}, 'QUOTE-9', 'req-q')`,
          ),
        );
        await expectViolation("upper-case customer email", "pos_receipts_email_lowercase", (sp) =>
          sp.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, customer_email, qbo_request_id)
                values (${`M${run}`}, ${`E${run}`}, 'Buyer@Example.com', 'req-e')`,
          ),
        );
        await expectViolation("posted without a JournalEntry id", "pos_receipts_posted_complete", (sp) =>
          sp.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, quote_ref, qbo_customer_id, status,
                  amount_cents, qbo_request_id, posted_at)
                values (${`M${run}`}, ${`J${run}`}, 'GHL-x', '58', 'posted', 100, 'req-j', now())`,
          ),
        );
        await expectViolation("two receipts sharing one JournalEntry", "pos_receipts_journal_entry_uidx", (sp) =>
          sp.execute(
            sql`insert into pos_receipts (merchant_id, clover_payment_id, quote_ref, qbo_customer_id, status,
                  amount_cents, qbo_request_id, qbo_journal_entry_id, posted_at)
                values (${`M${run}`}, ${`K${run}`}, 'GHL-x', '58', 'posted', 100, 'req-k', ${`JE${run}`}, now())`,
          ),
        );

        // ledger_triage
        const insertTriage = (sp: typeof tx, over: { reason?: string; status?: string; resolved?: boolean } = {}) =>
          sp.execute(
            sql`insert into ledger_triage (pos_receipt_id, merchant_id, clover_payment_id, quote_ref, reason, status, resolved_at)
                values (${receipt!.id}, ${`M${run}`}, ${`PAY${run}`}, 'GHL-opp_1', ${over.reason ?? "quote_not_approved"},
                  ${over.status ?? "open"}, ${over.resolved ? sql`now()` : sql`null`})`,
          );
        await insertTriage(tx);
        checks.push("accepted: a valid open triage row");
        await expectViolation("a second OPEN row for the same reason", "ledger_triage_open_reason_uidx", (sp) =>
          insertTriage(sp),
        );
        await insertTriage(tx, { reason: "customer_unresolved" });
        await insertTriage(tx, { status: "resolved", resolved: true });
        checks.push("accepted: another reason, and a resolved row for an already-seen reason");
        await expectViolation("unknown triage reason", "ledger_triage_reason_check", (sp) =>
          insertTriage(sp, { reason: "other" }),
        );
        await expectViolation("unknown triage status", "ledger_triage_status_check", (sp) =>
          insertTriage(sp, { status: "closed", resolved: true }),
        );
        await expectViolation("resolved without a resolved_at stamp", "ledger_triage_resolved_stamped", (sp) =>
          insertTriage(sp, { reason: "invalid_amount", status: "resolved" }),
        );
        await expectViolation("triage row for a receipt that does not exist", "ledger_triage_pos_receipt_id_pos_receipts_id_fk", (sp) =>
          sp.execute(
            sql`insert into ledger_triage (pos_receipt_id, merchant_id, clover_payment_id, reason)
                values (gen_random_uuid(), 'M', 'P', 'invalid_amount')`,
          ),
        );
        await expectViolation(
          "deleting a receipt that has triage rows (a paid order is never deleted)",
          "ledger_triage_pos_receipt_id_pos_receipts_id_fk",
          (sp) => sp.execute(sql`delete from pos_receipts where id = ${receipt!.id}`),
        );

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    // After the rollback nothing this run created may remain (when the tables did not exist before).
    console.log(`[phase14-live] ${checks.length} checks passed:\n  - ${checks.join("\n  - ")}`);
    expect(checks.length).toBeGreaterThanOrEqual(22);
  }, 120_000);
});
