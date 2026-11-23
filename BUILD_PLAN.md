# BUILD_PLAN — `autonomous-katana-baton-pass`

**Base:** `6347693`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true

## Intent

Ship five hands-off autonomy & fail-safe layers so Mia/Kian can operate the
catalog without Vercel/Supabase: throttled Katana→Hub self-heal, daily dead-man's
switch, Woo Make furniture price floor, and a GHL System Health / held-order /
baton-pass runbook drawer. Preserve Phase 1 `107` listings, `173`-col CSV,
`product_bom=3300`, `logistics_profiles=2781`, Showroom `<500ms` / `0 MET-*`.

## Workstreams

1. **Katana catalog reconcile** — Inngest cron `0 */2 * * *` +
   `ops/katana.reconcile.requested`; warm `katana_showroom_snapshot`; update
   stock / `katana_variant_id` / factory cost / soft-delete only; never touch
   commerce fields; auto-heal deleted+recreated variant IDs; prefix-agnostic
   ingest with `sync_to_woo=false` / `is_web_visible=false` / `sow_phase=2`.
2. **Keepalive monitor** — daily `0 11 * * *` UTC; QBO token freshness via
   `getMutexDb()`; Katana health + sync age `>6h`; held Woo count;
   exception-only Resend to `OPS_ALERT_EMAILS`.
3. **Woo price floor** — block Make furniture `FIN-*` (ex pillows/covers/
   accessories) when `regular_price < 250` or `<= 0`.
4. **System Health drawer** — Healthy/Attention pill on
   `/embed/admin/master-catalog`; lamps + self-heal + held-order replay +
   non-technical baton-pass FAQ.
5. **QA** — unit + vitest + `qa:lifecycle` + QCA CERTIFIED + commit/push +
   live Vercel/Inngest/Actions proof.

## Target test

```bash
npx vitest run tests/autonomous-katana-baton-pass.test.ts
```
