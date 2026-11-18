# CCP-PH1 Phase C Closeout Packet

**Document ID:** `CCP-PH1-PHASE-C-CLOSEOUT`  
**Phase lock:** `pre-closeout-p0-hardening` (supersedes `ccp-ph1-closeout` for P0 remediation)  
**Scope:** PrimeView Phase 1 (102 SOW items → 107 purchasable Woo SKUs with Corner L/R facing) + CCP-PH1 operational handoff  
**Status:** Binding closeout & Phase 2 gate notice (P0 audit gaps closed)  
**Related artifacts:** `tmp/CCP_PH1_PHASE_C_CLOSEOUT.md`, `tmp/PRIMEVIEW_PHASE1_HANDOFF_SPEC.md`, `tmp/primeview-phase1-102-import.csv`, `tmp/primeview-fabric-swatches/`

---

## 0. Executive Verdict

CCP-PH1 Phase C closes the factory + ecommerce operating loop for **Phase 1 only**:

| Lane | Status at closeout |
| --- | --- |
| Hub catalog authority (Phase 1 Make + Resale) | Live in Hub / Katana variant IDs present |
| Woo Path B ingress (`/api/webhooks/woocommerce`) | Shipped; gated by `ORDER_PIPELINE_MODE` |
| Boolean ACF add-ons + Ready-Make powder swaps | Hardened in Hub resolver |
| GHL → Katana factory pipe | Operator SOP below; modes stay `log` until cutover |
| QBO ledger | Operator SOP below; modes stay `log` until cutover |
| Phase 2 SOW (`vividworks_phase2_products.csv`, 162 rows) | **Owned by CC Patio** — gated, not started under CCP-PH1 |
| Interactive 3D (`_w3d_*`), Path A SketchUp CAD (`/embed/factory-bom`), Oct 29–30 Katana CSV repairs | **Out of CCP-PH1 scope** |

---

## SOP 1 — GoHighLevel Intake to Katana Factory Pipe

**Audience:** Showroom / sales ops + factory planner  
**Systems:** GoHighLevel → Hub (`/api/webhooks/ghl`, `order_intake`) → Inngest → Katana SO/MO

### Standardized pipeline stages (operator view)

1. **Lead / Estimate** — opportunity lives in GHL; no Hub factory write.
2. **Won / Produce Factory Order** — GHL Won-deal (or configured “Produce Factory Order”) webhook posts to Hub.
3. **Intake triage** — Hub writes `order_intake`; operators review FIN/FAB routing at **`/admin/order-triage`** (Mission Control order triage). At cutover set `GHL_FACTORY_ORDERS=live` only after triage owners are staffed.
4. **Catalog FIN path** — approved finished-good SKUs resolve against Hub `sku_mappings` + `product_bom`.
5. **Katana push** — when `GHL_FACTORY_ORDERS=live`, Hub creates the Katana **Sales Order** and linked **Manufacturing Order(s)**. While `log`, the saga dry-runs and records intent only.
6. **Floor execution** — factory completes MOs in Katana (see SOP 3). Reverse status may sync back to GHL only when `KATANA_REVERSE_SYNC_MODE=live`.

### Operator triage at `/admin/order-triage`

1. Open `/admin/order-triage` after a Produce Factory Order webhook lands (`order_intake.status = received`).
2. Confirm every line SKU exists in Hub, finishes are web_sellable, and Make rows have BOMs.
3. Approve → Hub emits `order.approved` → `push-approved-factory-order` (Katana writes only when `GHL_FACTORY_ORDERS=live`).
4. Reject / hold → leave intake parked; do not invent SKUs on the floor sheet.
5. Cutover rule: keep `GHL_FACTORY_ORDERS=log` until the first five live triage approvals are dual-checked; then flip `live` in Vercel and re-run one supervised order.

### Won-deal webhook trigger (checklist)

- [ ] GHL workflow fires on Won with the Hub webhook URL + shared secret.
- [ ] Payload includes opportunity id, contact, line SKUs/qty, and deposit flags as configured.
- [ ] Hub returns 2xx; duplicate deliveries are idempotent (same opportunity key).
- [ ] Confirm `GHL_FACTORY_ORDERS` before expecting Katana writes (`log` = no Katana mutation; cutover = `live`).
- [ ] Operators know `/admin/order-triage` is the only approval path (legacy Won auto-push stays unregistered).

### Automated Katana SO / MO creation

- **Make SKUs:** SO row + MO tree (`createSubassemblies: true`); finish placeholders bound per Hub recipe.
- **Resale / third-party SKUs:** SO row only (`third_party_sources` present → MO skipped).
- **Custom CAD (Path A):** Not part of CCP-PH1 go-live. Dual-approval airlock + deposit rules remain in `docs/AIRLOCK_DUAL_APPROVAL.md` and are outside this Phase 1 packet.

---

## SOP 2 — WooCommerce & NMI Checkout, Deposits, and Quarantine Replay

**Audience:** Ecommerce ops + PrimeView WP + Hub on-call  
**Systems:** WooCommerce + NMI → `/api/webhooks/woocommerce` → Inngest Woo saga → Katana / quarantine

### Phase 1 catalog (102 SOW → 107 purchasable)

- Import CSV: `tmp/primeview-phase1-102-import.csv` (169 columns; 47 parents, 100 variations, 7 simples).
- Handoff: `tmp/PRIMEVIEW_PHASE1_HANDOFF_SPEC.md` (Yardi / `ccpatiodev2.primeview.com`).
- Corner Sofa (`27674`) + Corner Chaise (`27687`) ship Attribute 2 **Select Facing** with `-LS` / `-RS` variation SKUs.
- Every purchasable `simple` / `variation` SKU must match Hub canonical or a registered `sku_aliases` row.
- Fabric swatches: live Supabase HTTP-200 URLs (+ optional `tmp/primeview-fabric-swatches/`).

### Checkout meta contract (bulletproofed)

| Meta | Accepts |
| --- | --- |
| `fabric` / `fabric_sku` | `FAB-*` |
| `powder_coat` | `PWD-*` on **all** powder-eligible Make items (including Ready Makes that hardcode `PWD-BLACK`) |
| `frame` / `frame_material` | `MET-STEEL` / `MET-ALUM` |
| `facing` / `select_facing` | informational only (SKU already carries `-LS`/`-RS`) |
| ACF checkboxes (16 keys incl. `ironwood`, `casters`, `arms`, `fly_table_*`, …) | `"1"` / `"yes"` / `"true"` **or** explicit `FIN-*` SKU |
| `custom_welded_fly_table` | quarantines with `custom_quote_addon_requires_sales` |

Defaults include: `ironwood` → `FIN-ESY-MIS-ADDIRONWOOD`; `umbrella_cover` → `FIN-ESY-MIS-WEATHERPROOFCO`; `casters`/`wheels` → `FIN-ESY-CHS`; `fly_tables`/`fly_table` → `FIN-OCN-TAB-34X12`; `arms` → `FIN-ESY-MIS-ARMS`; see full table in the handoff spec.

### `ORDER_PIPELINE_MODE` cutover

| Mode | Behavior |
| --- | --- |
| `log` (launch gate) | Resolve + dry-run saga; **zero** Katana writes |
| `live` | Create Katana SO; Make lines also create MOs + finish binds |

Cutover rule: flip `live` only after signed multi-path smoke returns 202 with zero quarantine and Katana SO/MO spot-check on a staging order.

### NMI payment / deposit capture

- [ ] NMI keys in WP + Hub vault; test-mode charge succeeds.
- [ ] Deposit % matches commercial terms; remainder captured on ship.
- [ ] Paid order fires `order.updated` with `date_paid` set.
- [ ] Webhook secret matches `WOOCOMMERCE_WEBHOOK_SECRET`.

### Quarantine review & replay

1. Open `/admin/quarantine`.
2. Inspect SKU / finish / add-on issues (missing Hub row, non-web_sellable finish, unmapped ACF key, empty Make recipe, etc.).
3. Fix Hub data (alias, finish `web_sellable`, add-on default, BOM) — **do not** edit paid Woo totals to “force” a pass.
4. Replay the delivery from quarantine UI / redrive path provided by Mission Control.
5. Confirm saga completes; Make → SO+MO; Resale / SO-only add-ons → SO only.

---

## SOP 3 — Katana Floor Operations (Make vs. Resale)

**Audience:** Factory foreman + line leads

### Make (multi-level MO)

Typical Phase 1 Make tree:

1. Parent MO for `FIN-*` finished good.
2. Sub-assembly MOs for `FRM-*` / `ASM-*-FRAME` and `CSS-*` / `ASM-*-CUSH` (and related).
3. Finish binds: fabric (`RM-FAB-GENERIC` → `FAB-*`), powder (`RM-PWD-GENERIC` **or** hardcoded `PWD-*` → selected `PWD-*`), dekton when present (`RM-DKT-GENERIC-SLAB` → `DKT-*`).

Floor rule: complete child MOs before parent; do not delete paid SO rows. Ledger failures retry — they do not roll back a paid order.

### Resale / third-party (SO only)

SKUs with `third_party_sources` (Phase 1 set includes Kindle / Tenjam / umbrella resale, plus SO-only ACF add-ons such as ironwood / weatherproof cover):

- Appear on the Katana **Sales Order**.
- **No** Manufacturing Order is created.
- Fulfill from vendor PO / stock; mark SO row fulfilled when goods ship.

---

## SOP 4 — QuickBooks Online & Deposit Reconciliation

**Audience:** Bookkeepers / controller  
**Systems:** Clover / Woo / NMI payment events → Inngest ledger sagas → QBO (gated by `QBO_LEDGER_MODE` / related ledger flags)

### Manual deposit reconciliation at `awaiting_ledger_step_8`

Woo live ledger currently parks paid orders at saga marker **`awaiting_ledger_step_8`** (no automatic QBO Customer Deposit / Sales Receipt post). Until Step 8 ships:

1. Filter Hub / Mission Control for Woo sagas with `current_step = awaiting_ledger_step_8` (or equivalent status badge).
2. Open the Woo/NMI payment + Hub order number; create the QBO deposit/invoice linkage **manually**.
3. Record the QBO doc number back on the Hub saga notes / bookkeeper sheet.
4. Do **not** redrive the saga hoping QBO will post — Step 8 is still a stub.

### Daily / per-order checklist

1. Confirm Hub saga shows payment captured (deposit or full).
2. If parked at `awaiting_ledger_step_8`, complete the manual QBO deposit steps above.
3. In QBO, verify Customer Deposit / Invoice linkage for the order number.
4. Match deposit amount to NMI/Clover settlement; note remainder-on-ship terms.
5. When goods ship and COGS posts from Katana completion, verify job cost / COGS lines land on the correct QBO account mapping.
6. If ledger mode is `log`, treat Hub dry-run records as the audit trail until `live` cutover — do not double-enter manually without controller approval.
7. Never delete a paid Katana SO to “fix” accounting; escalate Oh-Crap / DLQ events instead.

---

## Formal Scope Boundary & Ownership Transfer Notice

**Effective on QCA certification of `ccp-ph1-closeout`.**

CC Patio assumes ongoing ownership of:

1. **Katana BOM / inventory accuracy** for all Phase 1 Make recipes (including Ready-Make powder rows and restored NEEDS_BOM trees).
2. **Phase 2 SOW catalog & BOM completion** sourced from `data_migration/Primeview/E-Commerce - Website Product Info - vividworks_phase2_products.csv` (**162 rows**). Phase 2 CSV generation, Hub enablement, and Katana recipe work are **not** CCP-PH1 deliverables.

Explicitly **outside CCP-PH1** (do not open under this phase lock):

- Interactive 3D / VividWorks renders and all `Meta: _w3d_*` fields (forced blank in Phase 1 CSV).
- Path A 3D SketchUp CAD intake at `/embed/factory-bom` and airlock dual-approval CAD release.
- Non-launch Oct 29–30 Katana CSV recipe repair campaigns.

Any work in those domains requires a **new session / new phase lock**.

---

## Legacy 2-User Factory Google Sheet — Decommissioning Checklist

**Goal:** Floor staff use Katana + Hub Mission Control only.

1. **Freeze edits** — announce cutover date; set sheet to view-only for all editors except the cutover owner.
2. **Export final CSV archive** — download every tab to `tmp/archive/factory-sheet-final-YYYY-MM-DD/` (gitignored) and copy to the company archive drive.
3. **Spot-check parity** — for 5 open jobs, confirm Katana SO/MO + Hub intake match the sheet rows.
4. **Revoke write permissions** — remove edit access for floor/sales; leave a single archived viewer group if required for audit.
5. **Redirect floor staff** — post Katana Make board URL + Hub Mission Control / quarantine links at each station; update GHL bookmarks.
6. **Disable automations** — turn off Apps Script / Zapier that still write to the sheet.
7. **30-day watch** — any sheet reopen request requires Ops Manager approval and a Hub defect ticket.
8. **Close** — mark the sheet filename with `DEPRECATED-CCP-PH1` and move to Archive.

---

## 5. Vercel Production Env / Webhook Cutover Checklist

Flip these **only** after Yardi import + joint test orders on `ccpatiodev2.primeview.com` pass:

| Env / webhook | Pre-cutover | Cutover value | Owner check |
| --- | --- | --- | --- |
| `ORDER_PIPELINE_MODE` | `log` | `live` (staged) | Woo smoke 202 + Katana SO/MO spot-check |
| `GHL_FACTORY_ORDERS` | unset/`log` | `live` | `/admin/order-triage` staffed; 5 supervised approvals |
| `QBO_LEDGER_MODE` / ledger flags | `log` | stay `log` until Step 8 | Bookkeepers use SOP 4 manual `awaiting_ledger_step_8` |
| `WOOCOMMERCE_WEBHOOK_SECRET` | set in Vercel | matches WP webhook secret | Signature failure → Oh-Crap |
| WP webhook URL | staging | `https://<prod-vercel>/api/webhooks/woocommerce` | Topics: `order.created`, `order.updated` |
| `ALLOW_LOCAL_QA_TEST` | **unset in Vercel** | must remain unset | `/api/qa-test` hard-404 in production |
| Fabric swatch URLs | Supabase public | HTTP 200 on all 24 FAB-* | Handoff §1 |

Also confirm: NMI live keys, deposit %, and that `/api/qa-test` returns **404** on the production host.

---

## Phase 2 Gate (binding)

Phase 2 may begin only when:

- [ ] Phase 1 Woo import + NMI smoke signed off by PrimeView/Yardi + CC Patio.
- [ ] `ORDER_PIPELINE_MODE` cutover decision recorded (remain `log` or staged `live`).
- [ ] Google Sheet decommission steps 1–5 complete.
- [ ] CC Patio assigns Phase 2 BOM owner for the 162-row SOW file.
- [ ] New phase lock issued (not `pre-closeout-p0-hardening` / legacy `ccp-ph1-closeout`).

---

*End of CCP-PH1 Phase C closeout packet.*
