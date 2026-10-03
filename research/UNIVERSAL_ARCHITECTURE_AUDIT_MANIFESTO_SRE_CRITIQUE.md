# Universal Audit Manifesto — SRE Critique & Hardening Plan

**Prepared for:** CC Patio architecture program / reusable AI audit tooling  
**Date:** 18 September 2026  
**Subject:** Critique of the drafted `UNIVERSAL_ARCHITECTURE_AUDIT_MANIFESTO` (stack-agnostic master prompt)  
**Basis:** SRE review + lessons from the www.ccpatio.com black-box telemetry campaign  

---

## Brief critique of the current draft

### Strengths

- Correct persona (no assumptions; empirical bias).
- Sensible phase order: discover → white-box → black-box → endurance → report.
- Explicit safety valve (sequential sleep) — critical after OPcache-class incidents.
- Report skeleton is boardroom-shaped (verdict, timeline, gates, certificate).
- Stack-agnostic discovery via lockfiles / compose / CI is the right entry point.
- Gate phrase *“Do not begin until the user provides the target URL”* is a good hallucination brake.

### Weaknesses (why an LLM will still hallucinate)

1. **No hard stop between phases.** An agent can skip to Phase 5 and invent tables.
2. **No artifact contract.** Nothing requires writing JSON / screenshots / header dumps before prose.
3. **“Write or provide to the user”** is fatal ambiguity — agents will dump scripts and declare victory without running them.
4. **Verified vs Claimed missing.** Agency/verbal infra claims (e.g. “load balancer,” “API-integrated caches”) will be treated as fact.
5. **CERTIFIED / CRITICALLY UNSTABLE binary is too coarse** and invites rubber-stamping; needs graded states with numeric gates.
6. **Phase 1 does not force a System Under Test (SUT) identity card** (prod URL, edge vendor, origin identity, auth boundaries).
7. **No anti-patterns list** for forbidden language (“looks fine,” “should be,” “typically,” “best practice suggests”).
8. **Soft-404 / HIT-vs-MISS / CF DYNAMIC lessons from CC Patio are under-specified** as mandatory checks, not optional ideas.
9. **Security is almost absent** (headers, TLS, CORS, secrets in repo, auth bypass surfaces).
10. **Serverless / connection-pool / third-party cascade failure modes are unnamed**, so agents won’t look for them.

### North-star rule to add (steal from CC Patio success)

*No report section may cite a number that does not appear in a saved artifact file produced in this run.*

---

## 1. Architectural blind spots to add

Add a mandatory **Failure Vector Catalog** the agent must score `Observed | Not Observed | Not Testable` for each:

### Edge / DNS / TLS

- DNS chain length, CNAME flattening, multi-CDN hops
- TLS mode (Flexible vs Full Strict), cert mismatch, OCSP/stapling delays
- HTTP/2 vs HTTP/3, 0-RTT risks
- Apex vs www split (canonical / cookie / analytics fragmentation)
- WAF bot challenges amplifying optimizer/uptime retries
- Edge HTML cache vs proxy-only (`DYNAMIC`) — **explicitly required after CC Patio**

### Origin compute

- Worker/process pool exhaustion (LSAPI, php-fpm, Node cluster, gunicorn)
- Opcode / JIT / compile caches (PHP OPcache, Node cold start)
- Event-loop blocking (sync I/O in Node)
- CPU steal / noisy neighbor (shared hosting)
- Health-check URLs that boot the full app (Hide Login soft-404 class)

### Data plane

- DB connection pool exhaustion (especially **serverless** + Prisma/pgbouncer misconfig)
- Autoload / N+1 / missing pagination
- Lock contention / long transactions
- Redis as single point of failure; thundering herd on cache stampede
- Object storage vs local disk under multi-instance claims

### Caching conflicts

- Dual HTML owners (CDN + app optimizer) — require **single owner declaration**
- Cookie/session cache poisoning (ecommerce, auth)
- Purge storms → cold-start cliffs
- Stale-while-revalidate masking origin death

### Integration / cascade

- Sync third-party calls on request path (timeouts → worker hold → 502/522)
- Retry amplification (client + edge + job queue)
- Webhook fan-in to one hot instance behind LB
- Email/SMS/provider rate limits blocking “health”

### Security / abuse (stability-adjacent)

- Missing `Cache-Control` on authenticated responses
- Missing security headers (`CSP`, `HSTS`, `X-Frame-Options`) where relevant
- Verbose 500s / stack traces in prod
- Secrets in `.env.example` or committed `.env`
- Admin/login surfaces burning full boots under scan traffic

### Release / config

- Staging ≠ prod topology
- Auto-updates on fragile stacks
- Feature flags defaulting expensive paths on

---

## 2. AI execution constraints (anti-hallucination)

Rewrite the manifesto as a **state machine**, not a suggestion list.

### Mandatory control block (new preamble)

```text
EXECUTION LAW (NON-NEGOTIABLE)
1. You may NOT write Production_Readiness_Certification_Report.md until Phases 1–4
   have produced artifacts on disk under audit_artifacts/<UTC_DATE>/.
2. Every numeric claim in the report MUST cite an artifact path + field
   (e.g. endurance.json attempts[2].ttfb_ms).
3. If a measurement cannot be obtained, write NOT_TESTABLE + blocker — never invent.
4. Verbal/agency claims are CLAIMED until proven by config file, header, or dashboard export.
5. Forbidden phrases in findings: "looks fine", "should be", "typically", "appears healthy",
   "best practice", "likely fine under normal load" — replace with measured values.
6. Do not CERTIFY if any P0 gate is open or any endurance cliff >= threshold occurred.
7. Prefer running probes yourself; if network/credentials block you, output exact commands
   and WAIT — do not fabricate results.
```

### Phase gates (require explicit CHECKPOINT messages)

| After | Required artifact before next phase |
|-------|-------------------------------------|
| Phase 1 | `01_sut_profile.md` — stack, hosting, edge, critical routes, claimed vs verified |
| Phase 2 | `02_whitebox_findings.json` — file:line citations for each issue |
| Phase 3 | `03_blackbox_probe.json` + raw header dumps |
| Phase 4 | `04_endurance.json` with per-attempt TTFB table |
| Phase 5 | Report only if 01–04 exist and pass schema validation |

### Force code reading

- Phase 2 items must include **path + line range** or be marked `NOT_FOUND_IN_REPO`.
- Ban “frameworks often…” explanations unless tied to this repo’s files.

### Force script execution

- Change “write or provide” → **“Implement under `audit_tools/`, execute, save stdout+JSON; if execution fails, stop and report blocker.”**
- Require exit codes and timestamps in artifact metadata.
- Embed a **minimum probe matrix** (must all appear in JSON):
  - Warm homepage / health
  - Cache-bust same route
  - Heaviest dynamic route (from Phase 1)
  - Auth or session-ish route if exists
  - Intentional 404
  - One dependency health if exposed (`/health`, `/wp-json/`, etc.)

### Graded certification (replace binary)

- `CERTIFIED` — all P0 closed; endurance: no attempt ≥ 3s (or stack-specific SLA); no 5xx/522 in window
- `CONDITIONAL` — browse OK, transactional/uncached paths fail gates
- `WITHHELD` — any P0 open or endurance cliff
- `CRITICALLY UNSTABLE` — measured multi-second stall and/or live 5xx/522 under sequential probes

CC Patio would have been **CRITICALLY UNSTABLE** (20.5s MISS) even with HIT ~145ms — the manifesto must encode that pattern as an automatic grade.

### Chain-of-thought shape (force in manifesto)

Require the agent to emit, before the report:

```text
## Working Notes (discard from final PDF if needed)
- SUT identity: ...
- Artifacts written: [paths]
- HIT TTFB / MISS TTFB / cliff: [numbers from JSON]
- Open P0s: ...
- Grade rationale: ...
```

Then: “Final report may only restate Working Notes backed by artifacts.”

---

## 3. Modern SRE integrations for Phase 3 & 4

### Phase 3 additions (black-box)

- **`/cdn-cgi/trace` or vendor trace** when Cloudflare-like edge suspected
- **TLS/probe:** `curl -vI` capture of protocol, cert SAN, HTTP version
- **Security header scorecard** (presence/absence only — no false “secure” claims)
- **Cache-Control / Vary / Set-Cookie** audit on HTML and API
- **Compression & content-type** sanity (HTML declared as HTML; absurd soft-404 sizes)
- **Redirect chain count** (apex↔www, http→https) — cap hops
- **Synthetic RUM-lite:** document TTFB vs total time vs body bytes (CC Patio: TTFB OK, 3.3MB body still lethal)
- **Third-party fan-out observation** via HTML: count distinct 3P domains in first document (accessiBe, GTM, chat) — stability/privacy adjacent
- **API latency separately from HTML** (REST/GraphQL/health) — origin canary
- **Optional:** single WebPageTest / CrUX if URL public — labeled `EXTERNAL_LAB`, not origin proof

### Phase 4 additions (endurance)

Keep sequential safety; add modes:

1. **Repeat-MISS** (current) — primary cliff detector
2. **Repeat-HIT** (same URL, no bust) — confirms edge masking
3. **Burst-of-one-heavy-after-idle** — first request after 60s idle (cold worker / serverless)
4. **404 endurance** (5 sequential unknown paths) — soft-404 tax drift
5. **Authenticated/cookie pass** (if user supplies session) — session bypass cost
6. **Idempotent write-canary only if user explicitly authorizes** (default OFF)

### Drift analytics to require in script output

- min / max / avg / p95 TTFB
- `cliff_count` where attempt ≥ `max(3x median, 3000ms)`
- `masking_ratio = HIT_ttfb / MISS_median`
- Automatic grade hint field in JSON: `suggested_verdict`

### Optional Phase 4.5 (credentials-gated — do not invent)

If user grants access later: Cloudflare 5xx analytics, APM (Datadog/New Relic), DB `pg_stat_activity` / slow log, OPcache/runtime metrics. Manifesto must say: **credentials unlock Phase 4.5; absence ≠ pass.**

---

## 4. Specific prompt-engineering tweaks to integrate

1. **Rename objective** to “Produce certification *only* from artifacts; default posture is WITHHELD.”
2. **Add SUT intake schema** the user must fill (URL, env, auth, do-not-hit list).
3. **Add Verified | Claimed | Unknown** column to every infra statement.
4. **Pin numeric SLAs** (editable defaults): MISS TTFB p95 < 1.5s; no attempt ≥ 3s; soft-404 body < 100KB; HIT may be fast without earning CERTIFIED.
5. **Require Mermaid sequence to mark each hop Observed vs Assumed.**
6. **Report template:** forbid empty tables; omit section if `NOT_TESTABLE` with reason.
7. **Print/PDF twin:** optional HTML report matching consulting layout (as in `docs/Vividworks/Primeview/CC_Patio_External_Telemetry_Report.html`).
8. **Remove citation placeholders** like `[cite: 2, 3]` — they confuse agents.
9. **Add “CC Patio regression checklist”** as an appendix example of HIT-masking + MISS cliff → CRITICALLY UNSTABLE.
10. **Tooling paths:** standardize `audit_tools/` + `audit_artifacts/<date>/` so drops into any repo are identical.

---

## 5. Recommended manifesto structure (target outline)

```text
0. Execution Law + Forbidden Language + Intake Schema
1. Phase 1 — SUT Profile (artifact 01)
2. Phase 2 — White-Box with file:line (artifact 02)
3. Phase 3 — Black-Box matrix (artifact 03)  [expanded checks]
4. Phase 4 — Endurance modes (artifact 04)  [MISS/HIT/idle/404]
5. Phase 4.5 — Credentials-gated (optional)
6. Phase 5 — Report + graded certificate (only if 01–04 exist)
Appendix A — Failure Vector Catalog
Appendix B — Default SLAs
Appendix C — Script contracts (JSON schemas)
```

---

## 6. Follow-on implementation (not yet executed)

Full rewrite of the executable manifesto into `research/UNIVERSAL_ARCHITECTURE_AUDIT_MANIFESTO.md`, incorporating Execution Law, graded certification, expanded Phase 3–4, failure vector catalog, and JSON artifact contracts. Optionally add thin `audit_tools/` stub scripts modeled on `research/telemetry_archive_20260918/` probes.

---

## Related CC Patio artifacts

- `research/CC_Patio_External_Telemetry_Report.md`
- `docs/Vividworks/Primeview/CC_Patio_External_Telemetry_Report.html`
- `research/telemetry_archive_20260918/`
- `research/MASTER_CCPATIO_ARCHITECTURE_SME.md`
