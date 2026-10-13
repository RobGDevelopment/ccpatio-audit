import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 8 — document conformance for the governance override.
 *
 * This proves the amended governance docs and FINAL_INTEGRATION_ROADMAP.md
 * agree with each other and with the repo's real file layout. It does NOT prove
 * any runtime hardening. Each later roadmap step ships its own behavioral tests.
 */

const root = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

const ROADMAP = "FINAL_INTEGRATION_ROADMAP.md";

/** The roadmap was pasted with markdown escapes (`dlq\_events`, `\*\*`). Strip them before matching. */
function roadmapText(): string {
  return read(ROADMAP).replace(/\\([_*#&.\[\]])/g, "$1");
}

describe("SRE Hardening Check", () => {
  describe("governance override", () => {
    const claude = () => read("CLAUDE.md");
    const blueprint = () => read("docs/MDM_MASTER_BLUEPRINT.md");

    it("CLAUDE.md declares the roadmap supreme and binding", () => {
      const text = claude();
      expect(text).toContain(ROADMAP);
      expect(text).not.toContain("FINAL_INTEGRATION_ROADMAP_2.md");
      expect(text).toMatch(/supreme/i);
      expect(text).toMatch(/binding/i);
    });

    it("CLAUDE.md overrides the Phase 0 410 rule", () => {
      expect(claude()).toMatch(/Phase 0 "410 rule"/);
    });

    it("CLAUDE.md authorizes all five capabilities", () => {
      const text = claude();
      expect(text).toMatch(/WooCommerce order ingress/i);
      expect(text).toMatch(/Clover to QuickBooks Online/i);
      expect(text).toMatch(/QBO token mutex/i);
      expect(text).toMatch(/dead-letter queue/i);
      expect(text).toMatch(/CAD-to-Katana/i);
    });

    it("CLAUDE.md keeps the hard guardrails", () => {
      const text = claude();
      expect(text).toMatch(/no sandbox/i);
      expect(text).toMatch(/additive only/i);
      expect(text).toMatch(/Never delete a paid order/i);
    });

    it("blueprint carries a section 0.5 override naming the roadmap", () => {
      const text = blueprint();
      expect(text).toContain("### 0.5 Governance override");
      expect(text).toContain(ROADMAP);
      expect(text).not.toContain("FINAL_INTEGRATION_ROADMAP_2.md");
      expect(text).toMatch(/supreme, binding source of truth/i);
      expect(text).toMatch(/AMENDED 2026-10-12/);
    });

    it("blueprint formally overrides the Phase 0 410 rule", () => {
      expect(blueprint()).toMatch(/Phase 0 "410 rule" is formally overridden/);
    });

    it("blueprint marks every conflicting legacy ban as overridden", () => {
      const text = blueprint();
      const mentions = text.match(/§0\.5/g) ?? [];
      expect(mentions.length).toBeGreaterThanOrEqual(8);
    });

    it("blueprint still forbids a DLQ UI and the V8 outbox machinery", () => {
      const text = blueprint();
      expect(text).toMatch(/No DLQ UI/);
      expect(text).toMatch(/Redis CCR/);
      expect(text).toMatch(/effect_claims/);
    });

    it("V8 order functions stay unregistered", () => {
      const source = read("src/inngest/functions.ts");
      const match = source.match(/export const inngestFunctions = \[([\s\S]*?)\];/);
      expect(match, "inngestFunctions array not found").not.toBeNull();
      expect(match![1]).not.toContain("processWooCommerceOrder");
      expect(match![1]).not.toContain("syncGhlOpportunity");
    });
  });

  describe("roadmap integrity", () => {
    it("exists and the retired v2 file does not", () => {
      expect(fs.existsSync(path.join(root, ROADMAP))).toBe(true);
      expect(fs.existsSync(path.join(root, "FINAL_INTEGRATION_ROADMAP_2.md"))).toBe(false);
    });

    it("declares itself the superseding plan over CLAUDE.md and the blueprint", () => {
      const text = roadmapText();
      expect(text).toMatch(/supersedes all legacy architecture plans/i);
      expect(text).toMatch(/overrides previous `CLAUDE\.md` and `MDM_MASTER_BLUEPRINT\.md`/);
    });

    it("every concrete src/ or docs/ path it cites exists on disk", () => {
      const cited = new Set<string>();
      for (const m of roadmapText().matchAll(/`((?:src|docs)\/[A-Za-z0-9_.\/\[\]-]+)`/g)) {
        cited.add(m[1]!);
      }
      expect(cited.size).toBeGreaterThanOrEqual(1);
      const missing = [...cited].filter((p) => !fs.existsSync(path.join(root, p)));
      expect(missing, `cited paths that do not exist: ${missing.join(", ")}`).toEqual([]);
    });
  });

  describe("step 2: migration journal and RLS lockdown", () => {
    const migrationsDir = "src/server/db/migrations";
    const journal = () =>
      JSON.parse(read(`${migrationsDir}/meta/_journal.json`)) as {
        entries: Array<{ idx: number; when: number; tag: string }>;
      };

    it("registers 0016_rls_lockdown between 0015 and 0017", () => {
      const tags = journal().entries.map((e) => e.tag);
      const at = tags.indexOf("0016_rls_lockdown");
      expect(at, "0016_rls_lockdown is not in _journal.json").toBeGreaterThan(0);
      expect(tags[at - 1]).toBe("0015_perfect_fallen_one");
      expect(tags[at + 1]).toBe("0017_factory_bom_draft");
    });

    it("journal `when` is strictly increasing so migrate never skips or re-runs an entry", () => {
      const entries = journal().entries;
      for (let i = 1; i < entries.length; i += 1) {
        expect(
          entries[i]!.when,
          `${entries[i]!.tag} must sort after ${entries[i - 1]!.tag}`,
        ).toBeGreaterThan(entries[i - 1]!.when);
      }
    });

    it("journal idx is contiguous", () => {
      journal().entries.forEach((e, i) => expect(e.idx, e.tag).toBe(i));
    });

    it("every migration .sql file is registered and every entry has a file", () => {
      const files = fs
        .readdirSync(path.join(root, migrationsDir))
        .filter((f) => f.endsWith(".sql"))
        .map((f) => f.replace(/\.sql$/, ""))
        .sort();
      const tags = journal()
        .entries.map((e) => e.tag)
        .sort();
      expect(files.filter((f) => !tags.includes(f)), "files missing from journal").toEqual([]);
      expect(tags.filter((t) => !files.includes(t)), "journal entries without a file").toEqual([]);
    });

    describe("RLS migration for qbo_auth_tokens and incoming_webhooks", () => {
      const tag = "0053_rls_qbo_tokens_incoming_webhooks";
      const sqlText = () => read(`${migrationsDir}/${tag}.sql`);
      // Strip SQL line comments so prose cannot satisfy or trip a check.
      const code = () => sqlText().replace(/--.*$/gm, "");

      it("is registered in the journal, immediately before the Phase 9 SRE migration", () => {
        const tags = journal().entries.map((e) => e.tag);
        const at = tags.indexOf(tag);
        expect(at, `${tag} is not in _journal.json`).toBeGreaterThan(0);
        // Phase 9 appended 0054 after it; this migration must not move.
        expect(tags[at + 1]).toBe("0054_sre_dlq_saga_buckets");
      });

      it("enables RLS on both tables and revokes anon and authenticated", () => {
        const sql = code();
        for (const table of ["qbo_auth_tokens", "incoming_webhooks"]) {
          expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
          expect(sql).toContain(`REVOKE ALL ON TABLE "${table}" FROM anon, authenticated;`);
        }
      });

      it("is additive only and does not force RLS on the owner role", () => {
        const sql = code();
        expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
        expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
      });
    });

    it("the QBO mutex runs on the dedicated connection, not the shared pool", () => {
      // Phase 9 Task 4: the lock moved into token-refresh.ts. Plain token reads use the
      // shared pool (getDb) so the single mutex connection is never starved by reads.
      const source = read("src/server/integrations/qbo/token-refresh.ts");
      const lockFn = source.slice(source.indexOf("export async function withQboRefreshLock"));
      expect(lockFn.slice(0, 600)).toContain("getMutexDb()");
      expect(source).toContain("pg_advisory_xact_lock");
      expect(source).not.toMatch(/pg_advisory_lock\b/);
      const clientSource = read("src/server/integrations/qbo/client.ts");
      expect(clientSource).not.toContain("getMutexDb");
      const client = read("src/server/db/client.ts");
      expect(client).toMatch(/max: 1/);
      expect(client).toMatch(/prepare: false/);
    });
  });

  describe("roadmap carries the SRE requirements", () => {
    const has = (needle: string | RegExp) => {
      const text = roadmapText();
      return typeof needle === "string" ? text.includes(needle) : needle.test(text);
    };

    it("Katana rate limit: 1 request per second, shared token bucket, env-scoped concurrency", () => {
      expect(has(/≤1 request\/second/)).toBe(true);
      expect(has(/shared token bucket/i)).toBe(true);
      expect(has(`key: '"katana-tenant"'`)).toBe(true);
      expect(has('scope: "env"')).toBe(true);
    });

    it("database safety: Katana is live, additive migrations only, journal repair for 0016", () => {
      expect(has(/Katana is live/)).toBe(true);
      expect(has(/additive migrations only/i)).toBe(true);
      expect(has(/Strictly NO Drop & Sync/)).toBe(true);
      expect(has("0016_rls_lockdown.sql")).toBe(true);
    });

    it("security: RLS on tokens and webhooks, raw-body verification, Clover timingSafeEqual", () => {
      expect(has("qbo_auth_tokens")).toBe(true);
      expect(has("incoming_webhooks")).toBe(true);
      expect(has("req.text()")).toBe(true);
      expect(has("timingSafeEqual")).toBe(true);
    });

    it("compensation rule: retry the ledger leg, never delete a paid order, MOs before SOs pre-payment", () => {
      expect(has(/retry the ledger leg/i)).toBe(true);
      expect(has(/never\* delete a paid order/i)).toBe(true);
      expect(has(/delete MOs \*before\* SOs strictly pre-payment/i)).toBe(true);
      expect(has("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION")).toBe(true);
    });

    it("DLQ, CAD callback, and Vault are specified", () => {
      expect(has("dlq_events")).toBe(true);
      expect(has("inngest/function.failed")).toBe(true);
      expect(has("sendOhCrapAlert")).toBe(true);
      expect(has("waitForEvent")).toBe(true);
      expect(has("maxDuration")).toBe(true);
      expect(has("Supabase Vault")).toBe(true);
    });

    it("DB connection mode: xact locks need 6543 or direct, session locks do not, 5432 exhausts", () => {
      expect(has("pg_advisory_xact_lock")).toBe(true);
      expect(has(/transaction pooler \(port 6543\)/)).toBe(true);
      expect(has(/direct session connection/)).toBe(true);
      expect(has(/Session-level advisory locks[\s\S]{0,200}do \*\*not\*\* work/)).toBe(true);
      expect(has(/Supavisor session mode \(port 5432\)/)).toBe(true);
      expect(has(/max clients reached/)).toBe(true);
      expect(has("prepare: false")).toBe(true);
    });

    it("migration journal repair is mandated for 0016_rls_lockdown.sql", () => {
      expect(has("src/server/db/migrations/meta/_journal.json")).toBe(true);
      expect(has(/journal MUST register `0016_rls_lockdown\.sql`/)).toBe(true);
      expect(has(/`when` timestamp MUST sort between/)).toBe(true);
      expect(has(/No `drizzle-kit push`/)).toBe(true);
    });

    it("punch list runs steps 1 through 9 with schema before SRE primitives", () => {
      const text = roadmapText();
      for (let step = 1; step <= 9; step += 1) {
        expect(text, `step ${step} missing`).toMatch(new RegExp(`^${step}\\. \\*\\*`, "m"));
      }
      const schemaAt = text.search(/^4\. \*\*Schema Additions/m);
      const primitivesAt = text.search(/^5\. \*\*SRE Shared Primitives/m);
      const woo = text.search(/^6\. \*\*Path B Link:\*\* Activate `\/api\/webhooks\/woocommerce`/m);
      expect(schemaAt).toBeGreaterThan(0);
      expect(primitivesAt).toBeGreaterThan(schemaAt);
      expect(woo).toBeGreaterThan(primitivesAt);
    });
  });
});
