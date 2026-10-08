# Phase 0: Repository Bootstrap Protocol

## Intent
Before the Universal Execution Loop can engage Track 2 (Lock-bound), the environment must be grounded. The AI must independently analyze the repository footprint and generate the foundational context files inside the `.cursor/` directory.

## Execution Directives
When instructed to run Bootstrap Discovery, the agent must:

1. **Analyze the Environment:**
   - Read `package.json` to identify the core framework (Next.js, Vite, Express, etc.), ORM, state management, UI libraries, and external integrations (Katana, Stripe, Clover, etc.).
   - Analyze the root directory structure to determine the routing paradigm (e.g., Next.js App Router vs Pages Router, or WordPress plugin structure).

2. **Generate `PROJECT_STATE.md`:**
   - Create or overwrite `.cursor/PROJECT_STATE.md`.
   - Output a strict, concise summary of the Environment, Core Stack (with major version numbers), and Integrations. 

3. **Generate `foreign-domain.deny`:**
   - Create or overwrite `.cursor/foreign-domain.deny`.
   - Seed it with the Human Director's provided banned terminology to prevent cross-contamination from previous projects.

4. **Zero Code Mutation:**
   - Do not modify any application code. Do not write a `phase.lock`. Do not attempt to fix any perceived errors in the codebase.