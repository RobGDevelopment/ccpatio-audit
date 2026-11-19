# BUILD_PLAN — phase1-handoff-p0-remediation

**Phase ID:** `phase1-handoff-p0-remediation`  
**Intent:** Flip every pre-handoff Gate 1–7 to PASS/GO via surgical P0/P1 fixes (aluminum Regular price, unsigned Woo ping, APF parser, Steel scrub + ACF prices + dims, strict 107/107 Katana-bind, real Hub FAB/PWD contract).

## Allowed files

See `.cursor/phase.lock` `allowed_files`.

## Acceptance

1. Live CSV / Handoff / overlay emit `aluminum_msrp` Regular price (`FIN-BRV-CLB-CHA-34X34` = 2530).
2. Unsigned `POST webhook_id=999` → 200 `{ok:true,ping:true}`; unsigned JSON → 401.
3. Human APF keys/values resolve to Hub `FAB-*` / `PWD-*`.
4. Zero `Steel Frame` on storefront CSV; ACF prices corrected; 107/107 L×W×H.
5. Strict `requireKatanaIds: true` → **107 / 107 PASS**.
6. Handoff + partner portal show real 24 fabrics + 6 powders.
7. `npm run qa:lifecycle` exit 0 + QCA `CERTIFIED`.
