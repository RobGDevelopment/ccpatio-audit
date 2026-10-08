# LOOP_BUILD_PLAN.md | Universal Execution Loop

**Status:** L0 ratified. L1 is `[x] DONE`. L2 is `[x] DONE`. L3 is `[ ] IN PROGRESS`. L4 is `[x] DONE`. L5 is `[x] DONE`. L6 is `[x] DONE`.
**Chain of command:** Gemini writes packets. The executor edits only `allowed_files` / `create_files`. `node .cursor/skills/qca/scripts/qca.mjs` is the only authority that may emit `CERTIFIED`. A model transcript is not a verdict.
**Product plan:** Root `BUILD_PLAN.md` stays the Phase 5 product plan. This file is the protocol tracker.

One fresh chat executes one phase. The chat reads this file before editing.

## Roadmap

- [x] **L0 — Ratification.** DONE. The loop in the architecture report is the operating contract: packet-sized work, blast tolerance 0, QCA exit code is the verdict, Antigravity stays off Track 2 until the shell scope wrapper fails closed, skills live in-repo.
- [x] **L1 — Hardening the Auditor.** DONE. Strip self-certification from `qca.mjs`, `.cursor/hooks/stop-qca.mjs`, and `.cursor/skills/qca/SKILL.md`.
- [x] **L2 — Schemas & AAR Emitter.** DONE.
- [ ] **L3 — Phase-Lock Writer & Shell Scope.** IN PROGRESS.
- [x] **L4 — Rules & State Grounding.** DONE.
- [x] **L5 — Executor & Architect Skills.** DONE.
- [x] **L6 — Certify the Loop.** DONE.

## L0 — Ratification

**Done when:** the Human Director accepted the loop. That acceptance is this phase.

Binding decisions for later phases:

1. `CERTIFIED` is illegal without `.cursor/phase.lock`, and illegal for a phase id of `manual`.
2. Blast tolerance is 0. Expected blast radius is read from the lock, never from `.cursor/aar.json`.
3. Untracked files (`git ls-files --others --exclude-standard`) count with `git diff`.
4. An empty `allowed_files` list is legal only on a certify phase (`mode: "certify"`). Edit phases reject it.
5. `typecheck`, `lint`, and `target_test` fail closed when the script or the lock field is missing. There is no `--if-present` pass and no default `target_test`.
6. The stop hook always returns `audit_exit` 0 or 2 and tells the agent to transcribe the QCA JSON verbatim.
7. Executor context is one packet. Repair stays on the same phase id. Advancing the phase requires `CERTIFIED` plus human acceptance.
8. Antigravity does not run Track 2 until L3's shell wrapper fails closed in a recorded dry run.
9. Schemas, hooks, and skills stay in this repository. Research notes may live in an archive. Edit-time skills are not loaded from a database.
10. Root `BUILD_PLAN.md` remains the product plan.

## L1 — Hardening the Auditor

**Status:** [x] DONE. The Human Director accepted the L1 auditor.

**Intent:** `qca.mjs` rejects a missing lock, rejects an empty allow-list on edit phases, reads blast from the lock, counts untracked files, uses tolerance 0, and fails closed when scripts or `target_test` are missing. `stop-qca.mjs` puts `audit_exit` on every payload. The QCA skill forbids renaming exit 2 or narrating a failure as success.

**Allowed files:**

- `.cursor/skills/qca/scripts/qca.mjs`
- `.cursor/hooks/stop-qca.mjs`
- `.cursor/skills/qca/SKILL.md`
- `.cursor/protocol/LOOP_BUILD_PLAN.md` (this tracker)

**Target test:** fixture runs of `qca.mjs` outside the product suite (missing lock, empty edit allow-list, stale AAR ignored, tolerance 0, untracked counted, missing script, certify with an empty diff). Do not add an in-repo test file in L1.

**Expected blast radius:** 4 (the three auditor files plus this tracker).

**Done when:** the Human Director accepts the L1 diff and this box is changed to `[x] DONE`.

### L1 auditor contract

- Missing or unreadable `.cursor/phase.lock` → `verdict: DEFECT_REJECTED`, `phase: "ABSENT"`, exit 2. No `manual` phase id.
- `mode` other than `"certify"` is an edit phase. Edit phase plus `allowed_files: []` → reject.
- `mode: "certify"` may use an empty allow-list. Blast tolerance still applies.
- `expected_blast_radius` (or `blast_radius`) comes from the lock only. Missing value → blast `FAIL`, not `SKIP`.
- Actual blast is the set-union of `git diff <base_ref> --name-only` and `git ls-files --others --exclude-standard`.
- Fail when `actual !== expected`. Tolerance field in the report is 0.
- `package.json` must define `typecheck` and `lint`. Commands are `npm run typecheck` and `npm run lint` with no `--if-present`.
- `target_test` must be a non-empty string on the lock. An `npm run <name>` command whose `<name>` is absent from `package.json` scripts fails closed and is not executed.
- Stop-hook stdout is JSON with `audit_exit` (0 or 2) and `followup_message` containing the instruction to transcribe the QCA JSON verbatim.
- The hook process may still exit 0 for the Cursor hook protocol. `audit_exit` is the audit result. Exit 2 from `qca.mjs` maps to `audit_exit: 2`.

## L2 — Schemas & AAR Emitter

**Status:** [x] DONE.

**Intent:** Add JSON Schemas for the phase packet, the AAR, the QCA verdict, and browser evidence. Add `node .cursor/skills/aar/scripts/emit.mjs` and call it at the start of QCA. The emitter overwrites file lists and command results from git. QCA ignores `notes`. A disagreement between the AAR blast number and the lock is a violation. The lock wins.

**Allowed files:** `.cursor/protocol/*.schema.json`, `.cursor/skills/aar/**`, `.cursor/skills/qca/scripts/qca.mjs`.

**Target test:** schema validation of a golden `CERTIFIED` document and a golden `DEFECT_REJECTED` document; emitter output matches `git status` in a fixture.

**Expected blast radius:** 6–8.

**Done when:** schemas exist, the emitter is deterministic, and QCA refuses an AAR that contradicts the lock.

## L3 — Phase-Lock Writer & Shell Scope

**Status:** [ ] IN PROGRESS.

**Intent:** `phase-lock` validates a packet and writes `.cursor/phase.lock`. Refuse a dirty base unless the packet says otherwise. Refuse allow-lists over 8 without an explicit override. `scope-exec` rejects shell writes outside the allow-list. Extend `pre-tool-scope.mjs` so Track 1 with no `@` paths denies writes. Document that Antigravity stays off Track 2 until a dry run of the wrapper fails closed.

**Allowed files:** `.cursor/skills/phase-lock/**`, `.cursor/skills/scope-exec/**`, `.cursor/hooks/pre-tool-scope.mjs`, `.cursor/protocol/TRACKS.md`.

**Target test:** fixture prompts — no lock and no paths denies; a one-file lock denies a second path; a shell redirect to an outside path denies.

**Expected blast radius:** 6–8.

**Gate:** do not point Antigravity at this repo until `.cursor/protocol/AG_MIRROR.md` records that dry run.

## L4 — Rules & State Grounding

**Status:** [x] DONE.

**Intent:** Update `triad-kernel.mdc` so it matches this loop. Add glob rules for mobile isolation, gateway money, and `usePathname` / `Suspense`. Create the `touch-targets` skill that `mobile-touch.mdc` already names. Add `state-ground` so a `PROJECT_STATE.md` version mismatch with `package.json` exits 2.

**Allowed files:** `.cursor/rules/*.mdc`, `.cursor/skills/touch-targets/SKILL.md`, `.cursor/skills/state-ground/**`, `scripts/generate-project-state.mjs` only if the comparison needs a machine-readable version block.

**Target test:** the domain hook still blocks a fixture noun; state-ground exits 2 when a fixture `PROJECT_STATE.md` disagrees with a fixture `package.json`.

**Expected blast radius:** 8. Split the generator change into its own packet if the file list would exceed 8.

## L5 — Executor & Architect Skills

**Status:** [x] DONE.

**Intent:** Add `executor-track1`, `executor-track2`, `architect-debrief`, and the protocol texts `EXECUTOR_PROMPT.md`, `ARCHITECT_RETURN.md`, `UNIVERSAL_LOOP.md`, and `PORTING.md`. Executor prompts stay on the lock and the tagged files. Architect return input is QCA JSON plus diff stat.

**Allowed files:** those skill and protocol paths only.

**Target test:** a checklist script that every skill path named in `UNIVERSAL_LOOP.md` exists on disk.

**Expected blast radius:** under 8. Split catalog prose from skills if the list grows.

## L6 — Certify the Loop

**Status:** [x] DONE.

**Intent:** Empty diff. Run the fixture tests from L1–L5 plus `npm run test:unit`.

**Allowed files:** none. `mode: "certify"`.

**Target test:** `npm run test:unit` together with the protocol fixtures.

**Expected blast radius:** 0.

**Done when:** an accept log exists for L1–L5 and this certify packet's QCA JSON is `CERTIFIED` with `audit_exit: 0`.
