# Phase 12: Human-Centric Intake Embed

Status: LOCKED (`.cursor/phase.lock`, `phase-12`). Authority: `PHASE_12_EXECUTION_BLUEPRINT.md` and Operator Directives (2026-10-14).

## 1. Binding Operator Decisions (OD1 - OD10)

| # | Decision | Destination |
|---|----------|-------------|
| OD1 | **Collisions:** If a catalog piece collides on collection + product type + dimensions, append a variation discriminator (`-V2`, `-V3`, …). Offer **"Update existing 3D model"** versus **"This is different"**. | Task 7, Task 10 |
| OD2 | **Preview (hybrid toggle):** Default is a lightweight metadata card. For `.glb` only, show a sleek toggle that lazy-loads a WebGL viewer built on React Three Fiber. For `.blend` and `.skp` (and `.dae`), hide the toggle entirely and show metadata only. | Task 5, Task 10 |
| OD3 | **Finishes (Frame, Powdercoat, Fabric) are REQUIRED at intake for Client Projects.** A "TBD / Pending" option exists only as a workaround for rare incomplete handoffs (requires mandatory note). | Task 7, Task 10, Task 11 |
| OD4 | **PDF packet lane is active:** Wizard explicitly accepts and securely stores the `.pdf` factory order alongside the 3D model. | Task 8, Task 10 |
| OD5 | **Attribution:** Uses `ghlUserEmail` URL parameter for audit trail (unsigned label, never authorization). | Task 4, Task 7 |
| OD6 | **Phase 12 Scope:** P0 (hotfixes D1/D2/D3) and P1 (wizard, PDF capture, 3D toggle, embed endpoints) ship under one blueprint. | Execution |
| OD7 | **GHL Data:** Opportunity search exposes `name`, `monetaryValue`, and `contactName`. | Task 6 |
| OD8 | **Design System:** Strict adherence to "Soft UI with floating cards and animated gold beams" (`GoldBeam`). | Task 10, Appendix C |
| OD9 | **Jargon Purge:** Completely strip legacy developer terms ("Airlock", "Mint", "Slug", "Quarantine", etc.) from all embed UI. | Task 4, Task 11, Appendix B |
| OD10 | **Endpoint Scope:** Next.js Server Actions and Route Handlers strictly scoped to `/embed` for auth. Do not swallow errors. | Task 9 |

## 2. Hard Guardrails

- **Zero Migrations:** Schema is additive-only; no new tables or columns in this phase.
- **Zero Integration Calls:** No Katana, Woo, Clover, or QBO calls in intake. GHL is read-only.
- **Fail Closed & Strict Typing:** No `any`, `@ts-ignore`, or raw error leaks. `toIntakeFailure` wraps all errors.
- **Idempotency:** Client-generated `intakeKey` per wizard session.
- **Autofill Suppression:** `autocomplete="off"` and opaque input names/ids to prevent Chrome address autofill collisions.

## 3. Execution Tracking

- [x] Task 0: Preconditions, lock packet, baseline
- [x] Task 1: P0-A (D1) Intake call wrong argument fix
- [x] Task 2: P0-B (D2) Freshly created piece invisible to wizard fix
- [x] Task 3: P0-C (D3) Custom job without a project fix
- [x] Task 4: Foundations (copy catalog, strict schemas, toIntakeFailure, actor, GoldBeam)
- [x] Task 5: Pure libraries (naming, glb-summary, files classification)
- [x] Task 6: GHL search/fetch, taxonomy, finishes read paths
- [x] Task 7: createIntake (transactional, idempotent, client & catalog)
- [x] Task 8: Secure PDF packet capture & CAD wrappers
- [x] Task 9: Embed-scoped Route Handlers & Server Actions
- [x] Task 10: Wizard UI (3 screens, 3D toggle via R3F, PDF slot, Soft UI)
- [x] Task 11: Existing steps cleanup, lazy loading, purge legacy entry
- [x] Task 12: Static guards, embed copy guard, tests & bundle budget
- [x] Task 13: Docs, env, dependencies
- [x] Task 14: Final verification & handback report
