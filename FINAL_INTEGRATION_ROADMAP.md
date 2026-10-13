\# Cursor Instructions Blueprint: CC Patio MDM Hub Execution Roadmap



\*\*Context for Cursor (AI Agent):\*\* 

You are acting as a Senior Enterprise Architect, Integration Engineer, and Lead Site Reliability Engineer (SRE). I am providing you with the ultimate, unified Master Execution Roadmap for the CC Patio Master Data Management (MDM) Hub. This document supersedes all legacy architecture plans, explicitly overrides previous `CLAUDE.md` and `MDM\_MASTER\_BLUEPRINT.md` bans on Path B/WooCommerce ingress, and dictates our live-state integration path. 



\---



\## 1. Architectural Source of Truth



\*\*Core Tech Stack (V8 Middleware Architecture):\*\*

\*   \*\*Framework:\*\* Next.js (App Router, API Routes, Server Actions)

\*   \*\*Data \& Auth Layer:\*\* Supabase (PostgreSQL, Edge Storage, Row Level Security, Supabase Vault for API secrets)

\*   \*\*ORM:\*\* Drizzle ORM (Type-safe schema definitions and migrations)

\*   \*\*Event Bus \& Orchestration:\*\* Inngest (Webhook ingress, durable execution, distributed sagas, retries, concurrency, and idempotency)

\*   \*\*CAD Processing:\*\* Headless Python/Blender container (Automated `.skp` parsing for BOM extraction)



\*\*The MDM Mission ("Ultimate PIM God Mode"):\*\*

The MDM orchestrates two distinct operational lifecycles entirely through Inngest event-driven sagas:



\### Path A (Showroom/Custom)

1\.  \*\*Intake:\*\* GHL `ghl/opportunity.won` webhook writes to `order\_intake`.

2\.  \*\*Drafting:\*\* In-house team drafts custom designs in SketchUp. The `.skp` file is uploaded via the MDM UI.

3\.  \*\*BOM Extraction:\*\* The upload triggers an async Inngest saga that dispatches the CAD file to the Python/Blender pipeline. The microservice returns a raw JSON BOM via webhook callback.

4\.  \*\*Production Routing:\*\* The MDM sanitizes the BOM, hydrates it against the `finished\_goods\_catalog`, and pushes a dynamic Sales Order (SO) and Manufacturing Order (MO) payload to \*\*Katana ERP\*\*.

5\.  \*\*Payment:\*\* Customer pays the deposit/invoice via \*\*Clover POS\*\*. Clover fires `clover/payment.created`.

6\.  \*\*Ledger:\*\* Inngest maps the Clover payload to the Katana Order and fires a read-only Journal Entry/Customer Deposit saga to \*\*QuickBooks Online (QBO)\*\*.



\### Path B (E-Commerce)

1\.  \*\*CPQ Intake:\*\* VividWorks 3D CPQ payload attached to the \*\*WooCommerce\*\* cart.

2\.  \*\*Order Creation:\*\* WooCommerce fires a webhook to the `/api/webhooks/woocommerce` endpoint.

3\.  \*\*MDM Translation:\*\* Inngest unpacks the Woo payload and structures the BOM against the Supabase `finished\_goods\_catalog`.

4\.  \*\*Production Routing:\*\* Inngest pushes a standardized Sales Order (and dependent MOs) to Katana ERP.

5\.  \*\*Ledger:\*\* Financial data is routed by Inngest as a read-only ledger entry to QBO.



\---



\## 2. SRE \& Infrastructure Hardening (Zero-Corner Policy)



\*\*Cursor Directive:\*\* This system must survive real-world distributed serverless environments. Ensure the following resilience and security measures are physically implemented.



\### Security \& Auth

\- \[ ] \*\*GHL Iframe Auth:\*\* Maintain the `frame-ancestors` allowlist in `src/proxy.ts` to support white-label GHL domains.

\- \[ ] \*\*Raw Body Webhook Verification:\*\* Route handlers must execute `req.text()` once, verify the signature, and \*then\* run `JSON.parse`. Clover has no HMAC and must use `timingSafeEqual` against its static token.



\### Resilience \& State

\- \[ ] \*\*Katana API Limits:\*\* Throttle Katana calls to ≤1 request/second using `concurrency: { scope: "env", key: '"katana-tenant"' }` and a shared token bucket.

\- \[ ] \*\*Deterministic Idempotency:\*\* Utilize function-level idempotency combined with an Inngest event ID, Katana `order\_no` lookup, and QBO `requestid` to prevent duplicates.

\- \[ ] \*\*Global Dead Letter Queue (DLQ):\*\* Define a `dlq\_events` table (with RLS enabled) and implement a global `inngest/function.failed` handler that reuses `sendOhCrapAlert`.



\### Data \& Financial Precision

\- \[ ] \*\*The Penny Problem:\*\* Process all money in integer cents. Define a specific rounding-clearing account to inject variances and guarantee QBO Debits == Credits.

\- \[ ] \*\*Document Types:\*\* Strictly define the QBO document type (Journal Entry or Customer Deposit) to align with Deferred Revenue accounting, explicitly replacing the immediate-recognition Sales Receipt logic.



\### Deployment \& Postgres Constraints

\- \[ ] \*\*Connection Exhaustion:\*\* Resolve Supavisor session mode (5432) limitations to prevent "max clients" crashes under webhook bursts caused by default pool sizing and `withAdvisoryLocks`.

\- \[ ] \*\*Async CAD Handoff:\*\* Ensure the CAD converter executes asynchronously with a callback route, utilizing `step.waitForEvent` and explicit `maxDuration` limits to avoid Vercel timeouts.



\---



\## 3. 🚨 CRITICAL DEPLOYMENT BLOCKERS 🚨



1\. \*\*QBO Token Race Condition (Mutex Lock):\*\* Implement namespaced two-key advisory locks for QBO token refreshes. Include a fetch timeout, a 401 retry path, and a persist-failure alert.

2\. \*\*Saga Drift \& Compensation Handlers:\*\* Implement the enum `SAGA\_FAILED\_REQUIRES\_MANUAL\_INTERVENTION`. Rollback rules strictly mandate: retry the ledger leg, \*never\* delete a paid order, and delete MOs \*before\* SOs strictly pre-payment.



\---



\## 4. The Final Integration Punch List (Execution Sequence)



1\. \*\*Governance Amendment:\*\* Formally amend `CLAUDE.md` and `docs/MDM\_MASTER\_BLUEPRINT.md` (overriding the Phase 0 410 rule). Authorize Woo ingress, Clover to QBO, QBO mutex, the DLQ, and CAD to Katana.

2\. \*\*Migration \& DB Hardening:\*\* Fix the migration journal (add `0016\_rls\_lockdown.sql`), enforce RLS on `qbo\_auth\_tokens` and `incoming\_webhooks`, and finalize the DB connection-mode decision.

    - **Migration journal repair (mandatory).** `src/server/db/migrations/meta/_journal.json` skips `0016_rls_lockdown.sql`: the file is on disk but Drizzle never registers it, so a fresh database silently never gets its policies. The journal MUST register `0016_rls_lockdown.sql` between `0015_perfect_fallen_one` and `0017_factory_bom_draft`. Its `when` timestamp MUST sort between those two neighbours, so `drizzle-kit migrate` on the live database (which already has later migrations) does not re-run it. No `drizzle-kit push`.
    - **RLS is mandatory** on `qbo_auth_tokens` and `incoming_webhooks`, with all privileges revoked from `anon` and `authenticated`. Delivered as an additive migration only.
    - **DB connection mode for the QBO mutex.** `pg_advisory_xact_lock` is transaction-scoped. It is safe only inside one explicit transaction on a connection that is either the Supavisor **transaction pooler (port 6543)** or a **direct session connection**. The QBO mutex MUST use that dedicated connection, never the shared default pool. Session-level advisory locks (`pg_advisory_lock`, as used by `withAdvisoryLocks`) do **not** work through the transaction pooler: the backend is reassigned between statements, so the lock is lost. They require a direct connection.
    - **Warning: do not run webhook or mutex traffic on Supavisor session mode (port 5432).** Session mode pins one backend per client connection for its whole lifetime. The default `postgres.js` pool (10 connections) multiplied by concurrent serverless instances exhausts the pooler with "max clients reached" under a webhook burst. The transaction pooler needs `prepare: false`. The mutex connection is `max: 1`.

3\. \*\*Environment \& Secrets:\*\* Introduce decoupled environment variables. Establish per-environment QBO token rows and decouple QBO env from `NODE\_ENV`.

4\. \*\*Schema Additions:\*\* Run additive migrations only (e.g., `dlq\_events`, saga enums). \*\*Strictly NO Drop \& Sync\*\* (Katana is live, downstreams are active).

5\. \*\*SRE Shared Primitives:\*\* Build the mutex fix, DLQ, token bucket, and idempotency helpers.

6\. \*\*Path B Link:\*\* Activate `/api/webhooks/woocommerce`.

7\. \*\*Path A CAD:\*\* Implement the CAD callback route, `waitForEvent`, and Next.js `maxDuration`.

8\. \*\*Financials:\*\* Wire the integer-cent QBO routing.

9\. \*\*Cutover:\*\* Execute live-flag flip checklist, run a $1 test per path, and define rollback criteria.

