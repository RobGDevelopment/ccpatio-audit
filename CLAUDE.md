@AGENTS.md

## Binding source of truth (amended 2026-10-12, phase `phase-8-infrastructure-hardening`)

1. **`FINAL_INTEGRATION_ROADMAP.md` is the supreme, binding source of truth for the remainder of this build.** Where it disagrees with `docs/MDM_MASTER_BLUEPRINT.md` or with any legacy Phase 0 ban, the roadmap wins. See blueprint §0.5. It formally overrides the Phase 0 "410 rule" (Woo order webhooks answering `410`) and every other legacy architecture ban that conflicts with it. The `410` is lifted by roadmap step 6 (Path B Link), not before, and the route ships in `log` mode.
2. `docs/MDM_MASTER_BLUEPRINT.md` stays binding for everything the roadmap does not address: catalog, PIM, Factory BOM, the GHL factory lane (§2.4), and the commercial document lane (§2.5).
3. **Authorized by the roadmap** (each Inngest-native, gated by a `log`/`live` mode flag, additive schema only):
   - Path B WooCommerce order ingress at `/api/webhooks/woocommerce`
   - Clover to QuickBooks Online sagas
   - the QBO token mutex
   - the global dead-letter queue (a `dlq_events` table plus an Inngest `inngest/function.failed` handler and Oh-Crap alert)
   - the CAD-to-Katana pipeline
4. **Still forbidden:** the V8 custom outbox, Redis CCR leases, `effect_claims`, Trigger.dev, a DLQ UI or `/api/admin/redrive`, JSONB BOM trees, visual field mappers, and auto-Approve of catalog products from CAD.
5. **Hard guardrails:** Katana is a single live tenant with no sandbox. Schema changes are additive only. Never run `drizzle-kit push`, drop tables, or wipe hub data against the live database. Never delete a paid order. A ledger failure is retried, not rolled back.
