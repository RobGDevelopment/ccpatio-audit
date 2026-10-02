# VENDOR_HANDOFF_AUDIT_PROPOSAL.md

**Document ID:** `VENDOR_HANDOFF_AUDIT_PROPOSAL`  
**Status:** PROPOSAL — awaiting Mia / Kian / Architect approval (no code changes authorized)  
**Date:** 2026-09-11  
**Owner:** Enterprise Systems Architect (audit)  
**Sole workbook under review:** `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx`  
**Canonical generator:** `npm run ecom:harden-spark` → `scripts/harden-spark-handoff-mq.ts`  
**Binding SoT:** `docs/MDM_MASTER_BLUEPRINT.md` + `docs/CAPITAL_STACK_VENDOR_HANDOFF.md`

---

## Executive verdict

The Spark handoff is already strong on **locked Q&A dropdowns**, **XLOOKUP-driven retail math**, and **Master SKU = FIN-* only** (Capital Stack). The largest remaining gaps are not “more Excel columns” — they are:

1. **Blank merchandising / logistics fields on Tab 01** that we already have (or can derive) from Website Products, phase CSVs, config rules, and `_research_merged.json`.
2. **Checkout / post-purchase / configurator UX decisions** that PrimeView and VividWorks will ask for and that are not yet encoded as `System_Variable_Key` rows.
3. **Residual COGS / factory-consumable leakage** after Tab 02’s Dictionary Cost nuke — especially `99 - DICTIONARY!CostFromId` and factory-only `PWD-*` rows from the material CSV.

This proposal lists opportunities only. **Do not implement until items are explicitly approved.**

---

## Sources consulted (read-only)

| Source | Path |
|---|---|
| Harden / Q&A catalog | `scripts/harden-spark-handoff-mq.ts` (38 `QA_QUESTIONS`) |
| Tab 02 enrich | `scripts/enrich-handoff-fabrics-finishes.ts` |
| Research apply | `scripts/apply-handoff-research.ts` |
| Material dictionary CSV | `docs/Vividworks/Handoff/vividworks_material_options.csv` |
| Phase 1 / 2 product CSVs | `docs/Vividworks/Handoff/vividworks_phase{1,2}_products.csv` |
| Slot / config rules | `docs/Vividworks/Handoff/vividworks_configuration_rules.json` |
| Research merge | `docs/Vividworks/Handoff/_research_merged.json` |
| Research blank schema | `docs/Vividworks/Handoff/RESEARCH_PROMPT_FILL_HANDOFF_BLANKS.md` |
| Hex library | `scripts/lib/material-hex-preview.ts` |
| Capital Stack | `docs/CAPITAL_STACK_VENDOR_HANDOFF.md` |
| VW SOW | `docs/Vividworks/APPENDIX 2 CCPatio SOW 11-September-2026.docx` |
| PrimeView proposal | `docs/Vividworks/Primeview/Sep 1, 2026 _ E-Commerce Website Proposal I CC Patio.docx` |
| Live Spark blank census | measured 2026-09-11 against current Spark `.xlsx` |

### Live blank census (current Spark)

| Tab | Rows | Highest-impact blanks |
|---|---|---|
| **01** Phase products | 265 | Drawing 265; Collection 215; Marketing Description 216; Details 219; Shipping Flat Rate 264; Weight 110; Freight Class 110; Lead Time 110; Packaged Dimensions 103; Add-Ons 236; Website Memo 151 |
| **02** Fabrics & finishes | 112 | VW Texture / Asset Key 112; Swatch 112; Thickness 42 (fabrics/powders N/A); Cosentino Price Group 42 (non-Dekton); Hex 70 (Dekton mostly); Notes 35 |
| **04** Katana map | 11 | Fully populated attribute→Woo text (no live `variant_id`s — intentional) |
| **05** Slot matrix | 265 | Add-Ons 236 (mirrors Tab 01); other slots formula-driven |
| **06** Dekton grades | 6 | Structurally filled; B–F dollar upcharges depend on Tab 03 / Q&A wiring |
| **99 DICTIONARY** | helper | **`CostFromId` still present** (COGS leak surface) |

---

# 1. Data Pre-Population Maximization

Goal: force Mia/Kian decisions into Q&A, not into typing 265 product rows. Everything below is “can be filled from existing dictionaries / research / inference” — not “ask vendors to invent.”

## 1.1 Tab 01 — Phase 1 & 2 Products

| Column | Current state | Pre-population opportunity | Source(s) | Confidence / caveat |
|---|---|---|---|---|
| **Drawing** | 265/265 blank (text); images often missing | Re-attach Website Products / handoff images by Master SKU; fall back to catalog stills | `scripts/lib/website-products-handoff.ts`, `docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx` → Copy of Website Products | High for matched SKUs; unmatched SOW rows stay blank |
| **Collection** | ~215 blank | Derive from Master SKU grammar `FIN-{COL}-…` via collection code map (BRV→Bravada, BRK→Brooklyn, OCN→Ocean, …) | `docs/CAPITAL_STACK_VENDOR_HANDOFF.md` §1.2; SKU engine | **Very high** — pure parse |
| **Web Base Price ($)** | Mostly filled | Fill remaining from phase CSVs `MSRP` / Website Products `msrp`; never invent | `vividworks_phase1_products.csv`, `vividworks_phase2_products.csv`, Website Products | High where matched; research sample only covers a cluster of historical `noPrice` SKUs |
| **MSRP Aluminum ($)** | Formula / partial | Keep XLOOKUP(`MSRP_MARKUP_MULT`); seed Web Base first | Q&A Q01 + Tab 01 E | Already automated once E is filled |
| **Dimensions (LxWxH)** | ~11 blank | Parse from Product Name (`34" x 34" x 31"`) and/or phase CSV / google_tab3_import | Name regex; `google_tab3_import.csv`; phase CSVs | High for name-encoded dims |
| **Weight (lbs)** | ~110 blank | Website Products weight; phase CSV; research `unit_weight_lbs`; optional NMFC estimate **flagged** | Website Products; `_research_merged.json` products | Medium — do not invent without label |
| **Marketing Description** | ~216 blank | (a) Copy Website Products description; (b) template from Collection + Category + dims + slot flags (“Aluminum {collection} {type}, {LxWxH}, configurable fabric/powder…”) | Website Products; SKU parse; slot flags | High for (a); Medium for (b) templates — human polish still needed |
| **Details** | ~219 blank | Website Products details; append ops care blurbs selectively (Sunbrella / Dekton / powder) | Website Products; `ops_defaults.care_blurb_*` | High / Medium |
| **Shipping Flat Rate** | ~264 blank | Drive from Q&A logistics keys via formula (local / regional / LTL seating / LTL table) using product class (seating vs table/stone) | Q05, Q06, Q16, Q17 + product-type heuristic from SKU | High once Q&A locked; needs “product freight class” helper column or rule |
| **Freight Class** | ~110 blank | Default seating **175**, tables/stone **85** from `ops_defaults` | `_research_merged.json` → `ops_defaults.default_freight_class_*` | High as **defaults**; Mia confirm NMFC |
| **Lead Time** | ~110 blank | Default **6–8 weeks** from `ops_defaults.standard_lead_time`; rush copy references Q07 | Research ops_defaults; Q18 | High |
| **Packaged Dimensions** | ~103 blank | Website Products packaged fields; where missing, leave blank (do not invent carton size) | Website Products | High when present only |
| **Fabric / Frame / Dekton / Pillow Color** | 68–71 blank | Cross-fill from `vividworks_configuration_rules.json` `slots.*.enabled` → Y/N/N/A; phase CSV `Allowed Option Categories` | Config rules JSON; phase CSVs | **Very high** for enablement flags |
| **Add-Ons** | ~236 blank | Encode allow-list text from config rules + Tab 03 upgrade types (Ironwood, Casters, Sidearm, Pillows, Fly) per SKU family | Config rules; Tab 03; Capital Stack attributes | Medium–High |
| **Website Memo** | ~151 blank | Preserve Website Products memo; do **not** auto-generate internal factory chatter | Website Products | High (copy-only) |
| **Phase** | Filled | Already set | Phase CSVs / SOW lists | Done |

### Tab 01 — recommended automation package (approval checklist)

- [ ] **A1.** Collection-from-SKU parser for all 265 rows  
- [ ] **A2.** Slot flags from `vividworks_configuration_rules.json`  
- [ ] **A3.** Freight Class + Lead Time defaults from `ops_defaults` (blank-only)  
- [ ] **A4.** Shipping Flat Rate as **formula** to Q&A flats (not hard-coded dollars on every row)  
- [ ] **A5.** Marketing Description / Details backfill from Website Products match (blank-only)  
- [ ] **A6.** Drawing image re-anchor by Master SKU  
- [ ] **A7.** Dimension parse from name for the ~11 blanks  
- [ ] **A8.** Care/warranty appendix blocks from `ops_defaults` into Details or a new non-vendor “Content Blocks” note — **only if approved for vendor eyes**

---

## 1.2 Tab 02 — Web Fabrics & Finishes

| Column | Current state | Pre-population opportunity | Source(s) |
|---|---|---|---|
| **Brand / Series** | Generally filled | Finish remaining from `fabric_grades[].sunbrella_collection_or_family`, Dekton `series`, powder series defaults | `_research_merged.json` |
| **Finish / Texture** | Mostly filled | Dekton `finish_texture`; powders already N/A / research | Research dekton/powder |
| **Thickness (mm)** | 42 blank (expected for fabric/powder) | Auto-fill Dekton from SKU/name (`1.2`→12, `2.0`→20) — **already in enrich**; re-run for any STN gaps; leave fabric/powder blank or `N/A` | `inferDektonThicknessMm` in enrich |
| **Application** | Mostly filled | Defaults exist (Cushion / Frame / Tabletop); refine Dekton Tabletop vs Sidearm from name/`application` | Research + heuristics |
| **Pricing Grade (A–F)** | Filled on current Spark | Keep research grades; flag `needs_cc_patio_confirm: true` rows in Notes | Research fabric/dekton/powder |
| **Cosentino Price Group (0–5)** | 42 blank on non-Dekton (OK); Dekton should be filled | Push `dekton_grades[].cosentino_price_group` for all STN-* | Research |
| **Retail Upcharge ($)** | Formula | Already XLOOKUP to Tab 03 by grade — **do not hard-code** | Harden `tab02RetailUpchargeFormula` |
| **E-Comm Approved** | Yes default | Optionally set **No** for factory consumables if they ever appear | Allow-list filter (see §3) |
| **VW Texture / Asset Key** | 112 blank | **Leave blank for VividWorks** OR mirror Internal ID when Tab 07 capability = 1:1 (formula), same pattern as Tab 07 | Tab 07 / Q&A VW capability |
| **Katana Attribute Key** | Filled by category | Already automated | Enrich `katanaKeyForCategory` |
| **Hex / Preview** | 42 filled (fabrics+powders); ~70 blank (mostly Dekton) | Done for research hex map; Dekton stays blank unless Cosentino publishes swatch hex | `material-hex-preview.ts` |
| **Outdoor Rated** | Filled Y | Already defaulted; keep | Enrich / research |
| **Notes** | 35 blank | Append research `content_notes` / grade rationale (blank-only); strip anything mentioning wholesale cost | Research; apply-handoff-research |
| **Swatch** | 112 blank (images) | Re-bind from `docs/Vividworks/Handoff/web-fabrics/` + prior workbook media by Internal ID | web-fabrics manifest; enrich image restore |

### Tab 02 — approval checklist

- [ ] **B1.** Cosentino group + thickness completeness for all Dekton rows from research  
- [ ] **B2.** Notes backfill (content / rationale) without cost language  
- [ ] **B3.** Swatch image restore by `FAB-*` / `PWD-*` / `STN-*`  
- [ ] **B4.** VW Texture Key formula = Internal ID when 1:1 mapping mode (optional; coordinates with Tab 07)  
- [ ] **B5.** Explicit `N/A` for Thickness on Fabric/Powder to close “blank” noise

---

## 1.3 Tab 04 — Katana Data Map

| Column | Current state | Opportunity |
|---|---|---|
| **Sales Order Attribute** / **Mapped WooCommerce Value** | 11 instructional rows filled | **Do not invent Katana `variant_id`s.** Optional additions (text-only schema rows): `dekton`, `pillow`, `ironwood`, `casters`, `sidearm_mode`, `ship_method` — matching Capital Stack attribute vocabulary so PrimeView maps Woo options → SO attributes consistently |
| — | — | Add a one-line **anti-concatenation** warning row: “Line `sku` = FIN-* only; never append FAB/PWD/STN” — counters VW SOW wording risk |

Approval:

- [ ] **C1.** Extend Tab 04 attribute dictionary to full Capital Stack attribute set (no IDs)  
- [ ] **C2.** Explicit “no cartesian / no concatenated Master SKU” vendor callout row

---

## 1.4 Tab 05 — Product Slot Matrix

| Column | Current state | Opportunity |
|---|---|---|
| Product Name / Master SKU / Phase | Filled / formula | Keep as mirror of Tab 01 |
| Fabric / Frame / Dekton / Pillow | Formula → Tab 01 | Ensure Tab 01 flags are correct first (config rules) — Tab 05 follows |
| **Add-Ons** | ~236 blank | Same as Tab 01 Add-Ons pre-population; or formula to Tab 01 Add-Ons column |

Approval:

- [ ] **D1.** Add-Ons formula mirror of Tab 01 (single edit surface)  
- [ ] **D2.** Optional validation column: `ConfigRulesMatch` (OK / DRIFT) vs JSON — **internal QA only; hide before vendor send** if used

---

## 1.5 Tab 06 — Dekton Grade Matrix

| Column | Current state | Opportunity |
|---|---|---|
| Dekton Grade A–F | Present | Keep |
| Cosentino Group Hint | Present | Align wording to research group bands |
| **Default Upcharge ($)** | A=0; others may be static | **XLOOKUP / link to Tab 03 Dekton Grade rows** (same pattern as Tab 02 retail) so Mia changes Q22 / Tab 03 once |
| Typical Thickness / Application / Notes | Present | Enrich from research frequency (12/20 mm tops; 4 mm Slim sidearms) |

Approval:

- [ ] **E1.** Wire Tab 06 Default Upcharge to Tab 03 / Q&A (live, not pasted dollars)  
- [ ] **E2.** Refresh typical thickness/application copy from research

---

## 1.6 Cross-cutting pre-population (not Tab-specific but reduces entry)

| Opportunity | Detail |
|---|---|
| **Run blank-only research apply** | `ecom:apply-research` against a **complete** product price JSON (current merge undersamples historical `noPrice` cluster) |
| **SEO title / meta** | Not on workbook today. If PrimeView needs them, add optional Tab 01 columns *or* a Content tab generated as `"{Name} \| {Collection} Outdoor Furniture \| CC Patio"` — only if approved |
| **Sellable powder allow-list** | Only 6 web powders; CSV contains primer / plugs / hang wire — exclude from Tab 02 forever |
| **SOLVE LINEN** | Research proposes `FAB-SOL-LIN` — mint in dictionary then Tab 02 |

---

# 2. Q&A / Business Logic Gap Analysis

## 2.1 What we already cover (do not duplicate)

38 keys today, including: MSRP markup, Brooklyn parity, fire include cluster (Q03A–C), waterfall miter, local/regional/LTL flats, expedite %, sidearm architecture + offer/price cluster (Q08–Q09D), Tenjam depth, FIM MAP, fabric F, pillow mode, VW 3P lock cluster (Q15A–C), lead time, Ironwood/casters/pillow $, Dekton/fabric scale factors, duplicate SKU policy, hide merged sidearms, powder premium, warranty years, slot fail mode, payment auth/capture, tax strategy, ship item-vs-cart, cancellation window.

## 2.2 Critical gaps PrimeView / VividWorks will ask for

Proposed **new** Q&A rows. Complex topics use **Yes/No Boolean clusters** (macro-free). Every row includes `Other (specify in Other_Value)` via existing `withOtherOption` pattern.

### Financials / checkout

| ID | System_Variable_Key | Question (Decision Topic) | Dropdown options (labels) | Notes |
|---|---|---|---|---|
| Q33 | `DEPOSIT_REQUIREMENT_MODE` | Customer payment timing at checkout for MTO goods | `100% Upfront Capture` / `50% Deposit + 50% Before Ship` / `Authorize Full / Capture on Ship` / Other | Distinct from Q29 auth-vs-capture; this is **commercial deposit policy** |
| Q33A | `DEPOSIT_PERCENT_UPFRONT` | If split deposit, upfront percent | `50` / `30` / `25` / Other → Active Numeric | Only meaningful when Q33 ≠ 100% |
| Q34 | `RETURN_WINDOW_DAYS` | Standard return / refund request window (calendar days from delivery) | `0 — Final Sale MTO` / `7` / `14` / `30` / Other | Outdoor custom goods often final sale |
| Q34A | `RETURN_ACCEPTS_CUSTOM_CONFIG` | Allow returns on configured (non-stock) FIN lines? | `Yes` / `No` | Boolean |
| Q34B | `RETURN_RESTOCKING_FEE_PCT` | Restocking fee if returns allowed | `0` / `15` / `25` / `50` / Other | |
| Q35 | `REFUND_METHOD` | Refund path | `Original Tender Only` / `Store Credit` / `Original or Credit` / Other | |
| Q36 | `PRICE_DISPLAY_TAX_MODE` | Storefront price tax display | `Tax Exclusive (add at checkout)` / `Tax Inclusive` / Other | Complements Q30 taxation engine choice |

### Inventory / fabric UX (PrimeView + VW)

| ID | System_Variable_Key | Question | Dropdown options | Notes |
|---|---|---|---|---|
| Q37A | `FABRIC_OOS_BEHAVIOR` | When a fabric swatch is unavailable | `Hide Swatch` / `Show + Backorder` / `Show + Disable Add to Cart` / Other | |
| Q37B | `POWDER_OOS_BEHAVIOR` | When a powder is unavailable | same as Q37A | Boolean-cluster sibling |
| Q37C | `DEKTON_OOS_BEHAVIOR` | When a Dekton color is unavailable | same as Q37A | |
| Q38 | `BACKORDER_MAX_ADD_WEEKS` | Max additional weeks promised on backorder messaging | `0 (no backorder)` / `2` / `4` / `6` / `8` / Other | Surfaces beside Q18 |
| Q39 | `LOW_STOCK_THRESHOLD_UNITS` | Soft “Low stock” badge threshold (if PrimeView tracks stock) | `Do Not Show Badges` / `1` / `2` / `5` / Other | MTO may be `Do Not Show` |

### Logistics

| ID | System_Variable_Key | Question | Dropdown options | Notes |
|---|---|---|---|---|
| Q40A | `ALLOW_INTERNATIONAL_SHIPPING` | Ship outside United States? | `Yes` / `No` | Boolean |
| Q40B | `ALLOW_SHIP_TO_CANADA` | If international, allow Canada? | `Yes` / `No` | Only if Q40A=Yes |
| Q40C | `ALLOW_SHIP_TO_AK_HI` | Allow Alaska / Hawaii? | `Yes` / `No` | Often surcharge or exclude |
| Q41 | `LTL_SIGNATURE_REQUIRED` | Adult signature required on LTL / white-glove delivery? | `Yes — Always` / `Yes — Over $X` / `No` / Other | |
| Q41A | `LTL_SIGNATURE_THRESHOLD_USD` | If over-$ threshold, dollar gate | `1000` / `2500` / `5000` / Other | |
| Q42 | `WHITE_GLOVE_INCLUDES_ASSEMBLY` | Local white-glove includes assembly / placement? | `Threshold Only` / `Placement No Assembly` / `Full Assembly` / `No` / Other | Ties to Q05 |
| Q43 | `FREIGHT_CLAIMS_WINDOW_DAYS` | Visible freight damage claim window in UX copy | `2` / `5` / `7` / `14` / Other | |
| Q44 | `CURBSIDE_VS_THRESHOLD_DEFAULT` | Default delivery service tier offered at checkout | `Curbside LTL` / `Threshold` / `White Glove Local Only` / `Customer Pickup` / Other | |

### VividWorks UI / UX

| ID | System_Variable_Key | Question | Dropdown options | Notes |
|---|---|---|---|---|
| Q45 | `VW_DEFAULT_CAMERA_PRESET` | Default 3D camera on product load | `3/4 Front Hero` / `Eye-Level Front` / `High Orbit` / `Top-Down` / Other | |
| Q45A | `VW_ENABLE_CAMERA_TOP` | Offer top-down camera control | `Yes` / `No` | Boolean cluster |
| Q45B | `VW_ENABLE_CAMERA_DETAIL` | Offer cushion/stitch detail camera | `Yes` / `No` | |
| Q45C | `VW_ENABLE_AR_MODE` | Enable AR / view in room if VW supports | `Yes` / `No` | |
| Q46 | `VW_SWATCH_CHANGE_RESETS_CAMERA` | Reset camera when fabric/powder changes? | `Yes` / `No` | |
| Q47 | `VW_PRICE_LIVE_UPDATE_MODE` | Where live price updates appear | `Woo Only` / `VW Overlay + Woo` / `VW Overlay Only` / Other | Architecture boundary |
| Q48 | `VW_ADD_TO_CART_PAYLOAD_MODE` | Cart bridge payload shape | `FIN + Attributes` / `FIN Only (attrs via session)` / Other | **Must align Capital Stack** (prefer FIN + attributes) |
| Q49A | `VW_SHOW_LEAD_TIME_IN_VIEWER` | Show lead-time chip inside VW UI | `Yes` / `No` | |
| Q49B | `VW_SHOW_FREIGHT_ESTIMATE_IN_VIEWER` | Show freight estimate inside VW UI | `Yes` / `No` | Usually No — keep in Woo |

### Merchandising / catalog policy

| ID | System_Variable_Key | Question | Dropdown options | Notes |
|---|---|---|---|---|
| Q50 | `GUEST_CHECKOUT_ALLOWED` | Allow guest checkout | `Yes` / `No` | |
| Q51 | `ACCOUNT_REQUIRED_FOR_MTO` | Force account creation for MTO | `Yes` / `No` | |
| Q52 | `SHOW_MSRP_STRIKETHROUGH` | Show MSRP aluminum as strikethrough vs web price | `Yes` / `No` | Affects margin optics publicly (not COGS) |
| Q53 | `COM_FABRIC_PROGRAM` | Customer’s Own Material program | `Not Offered` / `Quote Only` / `Grade F Path` / Other | Ties to Q12 |
| Q54 | `TRADE_LOGIN_PRICING` | Separate trade/dealer pricing portal | `Not in Phase 1` / `Phase 1 Net Pricing` / Other | Scope control for PrimeView |
| Q55 | `ADA_ALT_TEXT_REQUIRED` | Require alt text on all swatches/product images before launch | `Yes` / `No` | Compliance |

### Manufacturing / promise messaging

| ID | System_Variable_Key | Question | Dropdown options | Notes |
|---|---|---|---|---|
| Q56 | `SHIP_COMPLETE_ONLY` | Hold shipment until all lines ready? | `Yes — Ship Complete` / `No — Partial OK` / Other | |
| Q57 | `PRODUCTION_CALENDAR_BLACKOUT` | Honor factory blackout dates on PDP lead-time copy? | `Yes` / `No` | |
| Q58 | `CANCEL_AFTER_CUT_ALLOWED` | Allow cancel after CNC/cut started (inside Q32 window)? | `Yes — With Fee` / `No` / Other | Extends Q32 |

## 2.3 Proposed Boolean clusters (summary)

| Cluster | Keys | Purpose |
|---|---|---|
| Deposit | Q33 + Q33A | Upfront vs split — avoids free-text payment policy |
| Returns | Q34 + Q34A + Q34B | Final-sale vs windowed returns |
| OOS | Q37A/B/C | Per-slot backorder UX |
| International | Q40A/B/C | Geo allow flags |
| Signature | Q41 + Q41A | LTL signature policy |
| VW cameras | Q45 + Q45A/B/C | Viewer UX without macros |
| VW chrome | Q49A/B | What not to put in the 3D chrome |

## 2.4 Contractual / architecture note (not a dropdown, but must be decided)

VW SOW language that implies **concatenated Master SKUs** conflicts with Capital Stack / MDM (**FIN-* + attributes**). Recommend a **management-signed** Q&A or checklist row:

| ID | System_Variable_Key | Question | Options |
|---|---|---|---|
| Q59 | `MASTER_SKU_COMPOSITION_POLICY` | Confirm Master SKU composition for Katana match | `FIN Base Only + Line Attributes (REQUIRED)` / Other |

Default must be FIN-base-only. “Other” forces Other_Value explanation (should be rejected in review).

---

# 3. Security & Vendor Boundary Check

Tab 02 Dictionary Cost removal was necessary but **not sufficient**.

## 3.1 Confirmed leak surfaces (strip or hide before vendor send)

| Severity | Asset | What leaks | Recommendation |
|---|---|---|---|
| **CRITICAL** | `99 - DICTIONARY` column **`CostFromId`** | Wholesale COGS from `vividworks_material_options.csv` (`Cost Per Unit`) written by enrich (`lists.getCell("K…")`) | **Delete column K entirely** from vendor workbook (or never populate). Dropdowns must not depend on cost. |
| **CRITICAL** | Source CSV if ever attached / shared | Powder costs e.g. PWD-BLACK `6.39`, primer `9.45`, hang wire `16.65`, etc. | Never ship CSV to vendors; keep internal-only |
| **HIGH** | Factory consumable `PWD-*` rows if present on Tab 02 | `PWD-GRAY-ZINC-EPOXY-PRIMER`, `PWD-HIGH-TEMP-SILICONE-TAPERED-MASKING-PLUGS`, `PWD-METAL-WIRE-FOR-HANGING-FRAMES` | **Allow-list only** the 6 sellable powders (Capital Stack / research prompt). Exclude primer/plugs/wire from Tab 02 / Tab 07 |
| **MEDIUM** | Q01 option labels | Wording **“15% Wholesale Markup (1.15x)”** teaches vendors our MSRP policy framing | Relabel to **“MSRP Multiplier 1.15x (baseline)”** — keep numeric value, drop “Wholesale” |
| **MEDIUM** | Tab 01 **Website Memo** / Tab 02 **Notes** | May contain internal merchandising or cost rationale from research paste | Sanitize: strip `$` cost phrases, “COGS”, “wholesale”, factory routing verbs before send |
| **MEDIUM** | Research `open_questions` / internal ops if any Tab 09 still ships | Strategy debates, CNC cost adequacy (e.g. waterfall miter covering “internal CNC bridge-saw… costs”) | Keep open questions **out of vendor file**; Q&A replaces them |
| **LOW–MED** | Tab 04 Katana attribute map | Exposes ERP attribute names (needed) | Keep schema; **never** paste live variant IDs or supplier SKUs |
| **LOW** | Brand names (Sunbrella, Cosentino, FIM, Tenjam) | Public brands | OK to keep |
| **LOW** | Retail prices / upcharges | Necessary for Woo/VW | OK — this is sell-side, not COGS |

## 3.2 Do **not** treat as leaks (vendor-necessary)

- Web Base Price, MSRP Aluminum (retail-facing)
- Tab 03 retail upcharges
- Q&A dollar keys for add-ons / freight flats
- FIN-* Master SKUs and FAB/PWD/STN material IDs
- Slot matrix enablement
- Hex / swatches / marketing copy

## 3.3 Process controls (approval checklist)

- [ ] **S1.** Nuke `CostFromId` from `99 - DICTIONARY` in enrich + harden sanitize (parity with Tab 02)  
- [ ] **S2.** Powder allow-list gate in Tab 02 / Tab 07 builders  
- [ ] **S3.** Relabel Q01 “Wholesale Markup” → neutral MSRP multiplier language  
- [ ] **S4.** Pre-flight scanner script (report-only): flag cells matching `/cost|cogs|wholesale|primer|masking plug|hang wire|supplier|routing/i` on vendor sheets  
- [ ] **S5.** Confirm vendor ZIP contains **only** the Spark `.xlsx` (no `_research_merged.json`, no material CSV, no factory XLSX)  
- [ ] **S6.** Hide or remove any internal checklist rows that mention COGS remediation history if too revealing (optional)

## 3.4 Residual architecture risk (non-column)

Capital Stack already states vendors must not POST orders into the MDM hub and must resolve `variant_id` from FIN-*. Ensure the workbook **Executive Summary / Tab 04** repeats that boundary so PrimeView does not build a hub webhook “because the sheet was silent.”

---

# 4. Suggested approval batches

To keep implementation scoped, approve in waves:

| Wave | Scope | Outcome |
|---|---|---|
| **Wave 1 — Security** | S1–S5, powder allow-list, Q01 relabel | Vendor-safe file (COGS-complete) |
| **Wave 2 — Blank kill** | A1–A4, A7, B1/B5, D1, E1 | Dramatic reduction in Mia/Kian typing on Tabs 01/02/05/06 |
| **Wave 3 — Content** | A5–A6, B2–B3, Website Products backfill | Marketing/images completeness |
| **Wave 4 — Q&A gaps** | Q33–Q59 (prioritize deposit, returns, OOS, international, signature, VW camera, Master SKU policy) | PrimeView/VW cannot claim “undocumented decisions” |

---

# 5. Out of scope for this proposal

- Implementing any of the above in `ecom:harden-spark` / enrich / apply scripts  
- Regenerating the Spark workbook  
- Changing Katana / Woo production data  
- Resolving VW SOW legal wording (flagged only)

---

**Stop.** Awaiting explicit approval of checklist items (IDs above) before any code or workbook mutation.
