# V8 Middleware Architecture Rules

> **Status:** PRE-CODE · BLUEPRINT CONSENSUS · AWAITING EXECUTIVE BOARD SIGN-OFF  
> **Version:** V8-Freeze · Shared AI Memory  
> **Audience:** Cursor · Gemini · AntiGravity · Lead Systems Architect  
> **Scope:** Rules for all future code generation in `/middleware` only — **no Sprint 0/1 execution until board approval**

---

## 0. Purpose

This document is the **definitive rulebook** for the CCPATIO V8 middleware build. It consolidates:

| Source | Path |
| --- | --- |
| AntiGravity Sprint 0/1 plan | `docs/Blueprint/Sprint_0_1implementation_plan.md` |
| Cursor implementation directive | `docs/AG_Implementation_Directive.md` |
| Agent ingestion (machine-readable) | `docs/AntiGravity_SOP_Ingestion.json` |
| Human SOP matrix | `docs/CCPatio_SOP_Master_Matrix.md` |
| Enterprise master build plan | `docs/Blueprint/CCPATIO MASTER BUILD PLAN.md` |
| E2E lifecycle topology (frozen) | `topology/` dashboard + `sequences.ts` |

When documents conflict, resolve in this order: **this file → Master Build Plan → AntiGravity ingestion JSON → topology dashboard**.

---

## 1. Locked Tech Stack

These decisions are **consensus-approved** (Cursor + Gemini + AntiGravity alignment). Do not substitute without explicit architect review.

| Layer | Choice | Rationale |
| --- | --- | --- |
| **Runtime** | Next.js App Router (14+) | Route handlers for webhook ingress; aligns with V8 ingress API |
| **Language** | TypeScript `strict` | Shared types with topology ingestion keys |
| **Repository location** | **`/middleware`** sub-directory | Isolated from `/topology` visualization dashboard — separate `package.json`, deploy target, and CI job |
| **Database** | PostgreSQL (Neon / Vercel Postgres) | Authoritative state + outbox |
| **ORM / query layer** | **Drizzle ORM + `pg` driver** | Explicit transaction boundaries; raw SQL escape hatches for `SELECT … FOR UPDATE SKIP LOCKED` — **not Prisma** |
| **Cache / dedupe** | Upstash Redis | Network-layer dedupe; **fail-open** to Postgres when unavailable |
| **Durable execution** | Inngest | Outbox drain, CCR lease orchestration, retries |
| **Validation** | Zod (+ `@t3-oss/env-nextjs` or equivalent for env) | GHL webhook schemas, env safety |
| **Testing** | **Vitest** | Fast TypeScript-native unit + integration tests; exception workflows as fixtures |
| **CI** | GitHub Actions | lint · typecheck · test · migration dry-run per `/middleware` |

### Explicitly excluded (Sprint 0–1)

- Prisma or other ORMs that hide transaction / locking semantics  
- Co-locating middleware inside `/topology`  
- Jest (use Vitest)  
- Writing to Katana/QBO/Clover in production before sandbox gates (Sprint 0)

---

## 2. Repository Structure

All application code lives under **`/middleware`**. The `/topology` folder remains the **read-only visualization reference** — never import middleware from topology or vice versa at runtime.

```text
ccpatio-audit/
├── topology/                    ← FROZEN — cinematic dashboard (existing)
├── docs/
│   ├── Blueprint/               ← Shared AI memory (this folder)
│   ├── AntiGravity_SOP_Ingestion.json
│   ├── CCPatio_SOP_Master_Matrix.md
│   └── AG_Implementation_Directive.md
└── middleware/                  ← NEW — all Sprint 0+ code here
    ├── app/
    │   ├── api/
    │   │   ├── webhooks/
    │   │   │   └── ghl/
    │   │   │       └── route.ts       ← Gate 1 ingress (primary)
    │   │   └── health/
    │   │       └── route.ts
    │   ├── layout.tsx
    │   └── page.tsx                   ← minimal or absent; API-first service
    ├── src/
    │   ├── server/
    │   │   ├── db/
    │   │   │   ├── schema/            ← Drizzle schema definitions
    │   │   │   ├── migrations/        ← Drizzle SQL migrations
    │   │   │   ├── client.ts          ← pg pool + Drizzle instance
    │   │   │   ├── outbox.ts          ← outbox writes / drain queries
    │   │   │   └── effect-claims.ts   ← CCR lease acquire / release / sweep
    │   │   ├── redis/
    │   │   │   └── dedupe.ts
    │   │   ├── inngest/
    │   │   │   ├── client.ts
    │   │   │   └── functions/
    │   │   │       ├── drain-outbox.ts
    │   │   │       ├── produce-fo.ts
    │   │   │       └── mirror-ghl-mfg.ts
    │   │   ├── ghl/
    │   │   │   ├── verify-signature.ts
    │   │   │   └── types.ts
    │   │   └── katana/
    │   │       └── client.ts
    │   └── lib/
    │       ├── env.ts
    │       └── idempotency.ts
    ├── tests/
    │   ├── integration/               ← Vitest — exception workflow replays
    │   └── fixtures/                  ← payloads from AntiGravity_SOP_Ingestion.json
    ├── drizzle.config.ts
    ├── vitest.config.ts
    ├── package.json
    └── tsconfig.json
```

**Rule:** No `app/` or middleware source files at the monorepo root. Regenerate ingestion JSON from `topology/` when SOP changes; middleware **reads** `docs/` at build/test time only via fixtures — no runtime coupling to React Flow.

---

## 3. Zero-Data-Loss Invariants (Non-Negotiable)

These rules override any sequence diagram or sprint note that implies otherwise.

### 3.1 Postgres outbox is authoritative

1. Every accepted GHL webhook **must** produce a durable row in `outbox_events` before returning `202 Accepted` to the caller.  
2. **Redis dedupe is best-effort optimization**, not the source of truth.  
3. On Redis failure/timeout: **fail-open** — still insert outbox row (see `redis-failopen-exception` workflow).  
4. On Redis duplicate hit: **verify** against `outbox_events.idempotency_key` before returning `200 Already Processed`. A Redis key without a matching outbox row is a **consistency bug** — re-process via outbox.

### 3.2 Correct ingress order (canonical)

```text
1. Verify HMAC
2. Parse + validate (Zod)
3. Derive idempotency_key
4. BEGIN transaction
5.   INSERT outbox_events ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
6.   IF row inserted → optional Redis SET NX (non-blocking / try-catch)
7. COMMIT
8. IF new row → inngest.send (or mark enqueued) + return 202
9. IF conflict → return 200 { already_processed: true }
```

AntiGravity’s diagram showing Redis **before** Postgres insert is **superseded** by this rule.

### 3.3 HTTP response contract

| Condition | Status | Body |
| --- | --- | --- |
| New event persisted | `202` | `{ accepted: true, outbox_id }` |
| Duplicate idempotency_key | `200` | `{ already_processed: true }` |
| Invalid signature / schema | `401` / `400` | `{ error }` — **no outbox write** |
| DB unavailable | `503` | `{ error }` — GHL will retry |

Never return `202` without a committed outbox row.

### 3.4 Payment gate (business rule)

`payment-gateway` must clear **before** processing `sales-az::az-approval` / `sales-ca::ca-approval` MO creation. Middleware **rejects or defers** Gate 1 MO side effects if deposit is not confirmed — align with frozen topology payment sequence.

### 3.5 Downstream mutations flag

`DOWNSTREAM_MUTATIONS` env flag stays **OFF** through Sprint 0–1 sandbox. Katana/GHL writebacks run against mocks or sandbox until Master Build Plan soak gates pass.

---

## 4. Database Schema Rules

Drizzle schema + SQL migrations must implement the following. Column names are stable API for all AI agents.

### 4.1 `outbox_events`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID PK | `gen_random_uuid()` |
| `idempotency_key` | TEXT UNIQUE NOT NULL | `{opportunity_id}:{stage_id}:{event_hash}` |
| `source` | TEXT NOT NULL | e.g. `ghl-webhook` |
| `event_type` | TEXT NOT NULL | maps to `digital_trigger` from ingestion JSON |
| `payload` | JSONB NOT NULL | raw validated webhook body |
| `status` | TEXT NOT NULL | see lifecycle below |
| `attempts` | INT NOT NULL DEFAULT 0 | increment on handler failure |
| `last_error` | TEXT | last handler error |
| `locked_at` | TIMESTAMPTZ | set when worker claims row |
| `locked_by` | TEXT | worker / Inngest run ID |
| `created_at` | TIMESTAMPTZ NOT NULL | default `now()` |
| `processed_at` | TIMESTAMPTZ | set on terminal success |

**Status lifecycle:**

```text
pending → enqueued → processing → done
                              ↘ dead (max attempts exceeded)
```

- `pending`: inserted by ingress; not yet dispatched to Inngest  
- `enqueued`: `inngest.send` succeeded  
- `processing`: worker holds lock (`locked_at`, `locked_by`)  
- `done`: side effects complete  
- `dead`: manual review / DLQ

**Drain query (mandatory pattern):**

```sql
SELECT * FROM outbox_events
WHERE status IN ('pending', 'enqueued')
  AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Implement via Drizzle `sql` fragment or `.execute()` — do not rely on ORM abstractions that omit `SKIP LOCKED`.

**Sweeper:** 60s cron (Inngest) rescues stuck `processing` rows and re-drives `enqueued` failures — per Master Build Plan.

### 4.2 `effect_claims` (CCR)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID PK | |
| `claim_key` | TEXT NOT NULL | e.g. `{opportunity_id}:mo_create` |
| `worker_id` | TEXT NOT NULL | Inngest run ID |
| `lease_expires_at` | TIMESTAMPTZ NOT NULL | sweeper releases expired |
| `status` | TEXT NOT NULL | `active` \| `completed` \| `violated` |
| `metadata` | JSONB | katana_mo_id, violation reason |
| `created_at` | TIMESTAMPTZ NOT NULL | |

**Critical fix vs AntiGravity draft DDL:**

AntiGravity proposed `UNIQUE (claim_key)` on the whole table. That **blocks** future claims after completion. Use instead:

```sql
CREATE UNIQUE INDEX effect_claims_active_claim_key_idx
  ON effect_claims (claim_key)
  WHERE status = 'active';
```

**Acquire lease (mandatory pattern):**

```sql
-- Within transaction:
-- 1. Remove expired active leases (status → violated) OR sweep in separate job
-- 2. INSERT INTO effect_claims (...) ON CONFLICT DO NOTHING
--    WHERE NOT EXISTS (active claim for claim_key)
-- OR: SELECT ... FOR UPDATE SKIP LOCKED on competing workers
```

On lease denied (`ccr-race-exception`): log violation, **do not** create second Katana MO, yield gracefully.

**Separate claim keys per effect** (Master Build Plan):

- `{opportunity_id}:mo_create` — Gate 1 Produce FO  
- `{opportunity_id}:invoice_create` — post-Delivered QBO (Sprint 3+)  

Never reuse one claim key for MO + invoice.

---

## 5. Redis Deduplication Rules

| Key | Pattern | TTL |
| --- | --- | --- |
| Webhook | `dedupe:ghl:{idempotency_key}` | 24–72h |
| Payload hash | store SHA-256 of normalized body in metadata | — |

- Use `SET key NX EX ttl` — **after** outbox commit, inside try/catch  
- Redis down → log warn, continue (outbox already committed)  
- Duplicate Redis hit → confirm outbox row exists before short-circuit  

---

## 6. Inngest / Worker Rules

1. **Primary drain:** Inngest function triggered on outbox insert (event name TBD in Sprint 1)  
2. **Idempotent handlers:** all side effects keyed by `idempotency_key` + Katana `Idempotency-Key` header  
3. **CCR before Katana:** acquire `mo_create` lease → call Katana → persist `katana_mo_id` in claim metadata → release lease `completed`  
4. **Mirror pulse v1:** on MO success, sync GHL Manufacturing → `mfg-pipe::mfg-new` (Sprint 1); purchasing/production pulses in later sprints per ingestion JSON  
5. **No pg-listen** unless Inngest unavailable — Inngest is default  

---

## 7. Testing Requirements (Vitest)

All exception workflows in `AntiGravity_SOP_Ingestion.json` must have **named integration tests** before Sprint 1 sign-off:

| Test file (under `middleware/tests/integration/`) | Ingestion `workflow_id` | Pass criteria |
| --- | --- | --- |
| `ccr-race.test.ts` | `ccr-race-exception` | Dual POST → exactly **one** MO; one `violated` lease |
| `redis-failopen.test.ts` | `redis-failopen-exception` | Redis mock throws → outbox row still created |
| `ncr-gate-a.test.ts` | `ncr-exception` | Rework without duplicate MO |
| `gate-b-fail.test.ts` | `gate-b-fail-exception` | Recoat preserves MO state |
| `gate-c-fail.test.ts` | `gate-c-fail-exception` | +2d penalty metadata; mirror consistent |
| `qbo-mutex.test.ts` | `qbo-mutex-exception` | OAuth retry with backoff (Sprint 3+ stub OK in S1) |
| `clover-miss.test.ts` | `clover-miss-exception` | CRM Delivered not blocked (Sprint 4+ stub OK in S1) |

**Sprint 1 minimum:** `ccr-race` + `redis-failopen` + happy-path Gate 1 approval → outbox → mock Katana.

Fixtures: load step definitions from `docs/AntiGravity_SOP_Ingestion.json` — do not hand-copy stage IDs.

Run: `cd middleware && npm test`

---

## 8. Sprint Boundaries (Planning Only — Not Executed)

### Sprint 0 — Foundation

- Scaffold `/middleware` Next.js App Router project  
- Drizzle schema + migrations for `outbox_events`, `effect_claims` (with corrected indexes)  
- Upstash Redis wrapper  
- Env validation, structured logging, `/api/health`  
- CI pipeline  
- **No external API mutations**

### Sprint 1 — Gate 1 pipeline

- `app/api/webhooks/ghl/route.ts` per §3.2  
- Inngest drain + `produce-fo` + `mirror-ghl-mfg` (sandbox/mock)  
- CCR lease module with partial unique index  
- Vitest: `ccr-race`, `redis-failopen`, happy path  

### Deferred (Sprint 2+ — document only)

- `saga_freeze` / MO persistence tables (Master Build Plan)  
- Katana Delivered → QBO invoice (`invoice_create` CCR)  
- Clover fuzzy matcher + DLQ  
- All 7 exception handlers in production (not just tests)  
- GHL mirror pulses: `mfg-purchasing`, `mfg-production`  

---

## 9. Technical Assessment Summary (Cursor Consensus)

### Stack agreement: **YES**

| Recommendation | Verdict |
| --- | --- |
| Drizzle + `pg` | **Agree** — required for explicit transactions and `FOR UPDATE SKIP LOCKED` |
| Isolated `/middleware` | **Agree** — prevents dashboard coupling and independent deploy |
| Vitest | **Agree** — matches TS stack; fast exception replay tests |

### Risks & blind spots in AntiGravity plan (addressed above)

| Issue | Severity | Resolution |
| --- | --- | --- |
| Redis before Postgres in sequence diagram | **High** | §3.2 — outbox first, Redis fail-open after commit |
| `UNIQUE(claim_key)` on `effect_claims` | **High** | Partial unique index `WHERE status = 'active'` (§4.2) |
| Missing `locked_at` / `locked_by` on outbox | **Medium** | Added in §4.1 for SKIP LOCKED drain |
| Outbox status `enqueued` omitted | **Medium** | Full lifecycle in §4.1 |
| Payment gate not enforced in S1 plan | **Medium** | §3.4 business rule |
| Saga / MO persistence tables absent | **Low (S1)** | Deferred Sprint 2+; metadata JSONB OK for S1 |
| Root-level `app/` file tree | **Medium** | Relocated to `/middleware` (§2) |
| GHL stage UUIDs not confirmed | **Ops** | Sprint 0 task — re-validate from Master Build Plan |

### Bottlenecks to watch

- **Inngest concurrency** vs CCR — ensure lease check is in Postgres, not Inngest-only  
- **Katana rate limits** — backoff in handler; increment `outbox_events.attempts`  
- **GHL webhook retry storm** — idempotency_key + outbox UNIQUE handles replays  

---

## 10. AI Agent Directives

### All agents (Cursor · Gemini · AntiGravity)

Before generating **any** code in `/middleware`:

1. Read this file in full  
2. Read `docs/AntiGravity_SOP_Ingestion.json` — play `retail-az-e2e-happy-path` step_index 1→N  
3. Do **not** invent shop-floor stages absent from ingestion JSON  
4. Do **not** execute Sprint 0/1 until executive board signs `docs/CCPatio_SOP_Master_Matrix.md`  
5. Regenerate ingestion when topology changes: `cd topology && npm run generate:ag-ingestion`

### AntiGravity

- Revise sequence diagram to match §3.2 (Postgres before Redis)  
- Adopt Drizzle migrations instead of raw `schema.sql` as primary artifact  
- Place all paths under `/middleware/`

### Gemini

- Drizzle + SKIP LOCKED recommendation **accepted**  
- Continue reviewing CCR edge cases against `ccr-race-exception` steps  

### Cursor

- Own blueprint consolidation and topology → ingestion regeneration  
- No middleware code until board sign-off  

---

## 11. Executive Sign-Off Gate

| Gate | Artifact | Approved |
| --- | --- | --- |
| Physical SOP | `docs/CCPatio_SOP_Master_Matrix.md` | ☐ |
| AI blueprint | This document | ☐ |
| AG sprint plan | `docs/Blueprint/Sprint_0_1implementation_plan.md` | ☐ |
| V8 architecture freeze | `docs/Blueprint/CCPATIO MASTER BUILD PLAN.md` | ☑ (frozen) |

**Code generation unlock:** All three checkboxes above + explicit "begin Sprint 0" instruction from Lead Systems Architect.

---

*CCPATIO Enterprise Infrastructure & Lifecycle · V8 Middleware · Shared AI Memory*
