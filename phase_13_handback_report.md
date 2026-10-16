# Phase 13 Handback: Commercial Quoting, Live Logistics, Mission Control

Status: build complete, `npm run qa:lifecycle` exit 0. QCA has NOT been run. Waiting for the Operator.

## Mandate 1: Institutional Quote Package (Order Desk)

- One jsPDF document per quote: estimate pages first, then one specification page per distinct product.
- Footer on every page: "CC Patio . Quote ID . Page i of N". Document properties and a bookmark outline are set.
- Hero images are loaded server side, auto-rotated, flattened to white and re-encoded as JPEG (sharp, mozjpeg).
  The size tier shrinks as the product count grows so the file stays emailable:
  up to 4 products 1600px q82, up to 10 products 1200px q78, more than that 900px q72.
- A product with no photo, no price, or a hero under 1200px on its long edge still gets a page and is listed in a
  readiness report. The quote is never blocked by bad data.
- Order Desk: "Download Quote Package" (primary), "Estimate only" (secondary), and a readiness list.
- Files: `src/server/quotes/{package-pdf,package-specs,estimate-pdf}.ts`, `src/server/actions/generatePdf.ts`,
  `src/app/embed/order-desk/OrderDeskPortal.tsx`.
- Limits: the "3D tear sheet" is a 2D hero image. There is no server-side GLB rasterisation. There is no email send.

## Mandate 2: Live FedEx Freight

- The mocked regional table and the Priority1 mock are removed. Nothing fabricates a rate. A missing config returns
  null (FedEx) or a typed error (Priority1), and the carrier is logged as skipped.
- OAuth against the Freight QA host is verified live: HTTP 200, 3599 s token (`npm run ops:verify-fedex-sandbox`).
- The rate call is built and unit tested but NOT verified against FedEx. It needs two values we do not have:
  `FEDEX_FREIGHT_API_BASE` and `FEDEX_FREIGHT_ACCOUNT_NUMBER`. The response parser is defensive and based on assumed
  field names, so the first live response must be checked.
- The request excludes delivery accessorials (residential, liftgate, appointment). The service label says so. A FedEx
  price can therefore undercut Priority1 once enabled.
- Files: `src/lib/freight/fedex-freight.ts`, `src/server/freight/{fedex-carrier,fulfillment,priority1}.ts`,
  `src/server/actions/freight.ts`, `scripts/qa/verify-fedex-sandbox.ts`, `.env.example`.

## Mandate 3: Mission Control

- Dark theme purged. Light canvas, white floating cards with a diffuse shadow, `GoldBeam` on the header and on every
  card while it loads or works. Reduced motion hides the beam.
- Traffic lights: Core (QuickBooks, GoHighLevel, Katana, Inngest DLQ) and Channels (WordPress, WooCommerce, Clover).
  Each lamp has a colour, a word and a detail line. All probes are read only:
  QuickBooks from the database only (token present, idle days against the 100 day lapse, failed sagas),
  GoHighLevel from one GET, DLQ from counts. A failed probe is an amber lamp with a reference, not a broken page.
- Catalog Hygiene Radar flags missing MSRP (absent, zero or unparseable), blank dimensions (unless marked N/A) and no
  3D asset (no `asset_3d_url` and no non-failed GLB/GLTF CAD upload). Worst products first, capped at 100.
- Quick Access modal patches MSRP and dimensions (with N/A toggles) in one transaction: lock, diff, write only what
  differs, one `pim_audit_log` row per changed field. A repeated patch writes nothing. The 3D row links to logistics.
- QuickBooks is never written by the radar or the patch (GAAP isolation).

## Mandate 4: Money Path Error Purge

- `src/lib/log/structured.ts`: one JSON line with tag, level, ts, errorName, errorCode and a 12 character reference.
  `message` and `stack` are never logged or returned.
- No bare catch remains in the Clover, Katana and GHL webhook routes, QBO token refresh, or the DLQ handler. Status
  contract: 400 bad JSON, 401 bad signature, 500 internal (provider retries), 502 Katana lookup failure.
- Mission Control actions no longer return `error.message`.

## Verification

- `npm run qa:lifecycle`: exit 0. Build, DB proof of life, 25 unit files (256 tests), webhooks, 10 Playwright tests.
- New tests: `phase13-error-purge`, `phase13-fedex-freight`, `phase13-quote-package`,
  `phase13-mission-control-health`, `phase13-hygiene-radar`. All are in `qa:phase0-unit`.
- Gaps: no Playwright spec covers `/mission-control`, the Order Desk package button, or the Quick Access modal.
  `applyHygienePatch` is tested against a mocked transaction, not a live Postgres. The Phase 2 runner does not
  exercise it.

## Out of scope, noticed

- `logPimAudit` swallows errors. `src/server/ghl/private-api.ts` has a bare catch.
