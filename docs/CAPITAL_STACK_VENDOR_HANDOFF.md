# CC Patio — Capital Stack Vendor Handoff

**Document ID:** `CAPITAL_STACK_VENDOR_HANDOFF`  
**Path:** `docs/CAPITAL_STACK_VENDOR_HANDOFF.md`  
**PDF:** `docs/CAPITAL_STACK_VENDOR_HANDOFF.pdf`  
**Status:** ACTIVE — Vendor contract + internal integration map  
**Effective:** 2026-09-10  
**Owner:** Enterprise Systems Architect  
**Audience:** VividWorks, PrimeView, client IT, successor architects  
**Binding SoT:** [`docs/MDM_MASTER_BLUEPRINT.md`](./MDM_MASTER_BLUEPRINT.md)

---

## 0. Authority and boundary

This document is the **vendor-facing companion** to the MDM Master Blueprint. It does **not** replace that file. When this packet and the blueprint disagree on what the Next.js hub may implement, **the blueprint wins**.

| In scope for vendors (VividWorks / PrimeView) | Out of scope for the CC Patio MDM hub |
|---|---|
| 3D configurator + WooCommerce storefront | Building vendor middleware |
| Mapping Woo lines to the Katana Sales Order schema in this file | Woo / GHL **order** webhooks |
| Resolving `FIN-*` → Katana `variant_id` | Creating live sales orders or manufacturing orders |
| Passing fabric grade, fabric, and powder as **attributes** | Cartesian SKU explosion (`FIN × grade × PWD × FAB`) |

**Vendor sentence (send as-is):**

> Your WooCommerce pipeline must map to this exact Katana schema. The line `sku` is the Master SKU (`FIN-…`). Fabric grade, fabric, and frame finish are sales-order row attributes, not SKU suffixes. You resolve `variant_id` from that `FIN-*`. You do not POST orders into the CC Patio MDM hub.

Daily operations (orders, inventory, COGS, invoicing) stay on **native vendor connectors**. The hub never sees a live sales order.

---

## 1. Master SKU dictionary

The Master SKU that fires a Katana BOM is the **base frame**, not a cartesian of every fabric and powder. Grade and finish are configuration slots on the sales-order line. That is already how the hub, the VividWorks datapack, and Katana’s API work.

Exploding `FIN × grade × PWD × FAB` would mint on the order of **2.8 million** variants (~200 frames × 6 grades × 6 powders × 396 fabrics) and would not match any recipe published from the hub.

### 1.1 Grammar (what Katana matches)

```
FIN-{COL}-{CAT}-{L}X{D}[-{AXIS}]
```

| Segment | Meaning | Rules |
|---|---|---|
| `FIN` | Finished-good class | Always. Sub-assemblies are `SA-*`. Materials are `FAB-*` / `PWD-*` / `RM-*` / `STN-*`. |
| `{COL}` | Collection | 3-letter code from §1.2 |
| `{CAT}` | Product type | Modular tokens, most-specific first (`SWV-CHA`, not `CHA`) |
| `{L}X{D}` | Length × depth, inches, no `"` | Integers only. Diameter products use a single size (`FIN-BRV-DYB-84`) |
| `{AXIS}` | Optional geometry flag | `LS` / `RS` handedness, `DKT` Dekton top, `NOARM` |

**Worked example**

Bravada sofa, 72″ × 34″ → `FIN-BRV-SOF-72X34`

That string is:

- the VividWorks 3D model key
- the WooCommerce / Clover line `sku`
- the Katana `variants[].sku` that already has (or will have, after MDM Approve) the manufacturing recipe

**Engine:** `src/lib/sku-engine.ts`  
**Phase 1/2 lists:** `docs/Vividworks/Handoff/` and `Phase1_and_2_SKUs.csv`

### 1.2 Collection codes

| Code | Collection |
|---|---|
| `BRV` | Bravada |
| `BRK` | Brooklyn |
| `OCN` | Ocean |
| `MLN` | Milan / Marina |
| `WFT` | Waterfall |
| `CAB` | Cabana |
| `TJM` | Tenjam |
| `TAY` | Taylor |
| `ESY` | Easy / Flexy |
| `DAI` | Daisy |
| `FLY` | Fly |
| `CUS` | Custom |

### 1.3 Category codes (program these; most-specific first)

| Code | Product |
|---|---|
| `SWV-CHA` / `CLB-CHA` / `DIN-CHA` | Swivel / club / dining chair |
| `SOF` / `LOV-SOF` / `MIN-LOV` / `ARM-SOF` / `COR-SOF` | Sofa family |
| `SGL-CHS` / `DOU-CHS` / `COR-CHS` / `TRA-SGL-CHS` / `TRA-DOU-CHS` | Chaise family |
| `COF-TAB` / `SID-TAB` / `DIN-TAB` / `BAR-TAB` / `CNT-TAB` / `FIR-TAB` | Tables |
| `DYB` | Daybed |
| `OTT` | Ottoman |
| `BST` / `SWV-BST` / `FLY-BST` | Barstools |
| `DIN-BCH` / `BCH` | Benches |
| `UMB` | Umbrella |
| `SWG` | Swing |

### 1.4 How fabric grade and frame finish are accounted for

They are **slots**, not characters glued onto `FIN-*`. The VividWorks pack already states: do not cartesian-expand Base × FAB × PWD × STN (`docs/Vividworks/Handoff/vividworks_configuration_rules.json`).

| Slot | Vendor value | Woo / Clover meta key | What the factory does |
|---|---|---|---|
| Base frame (BOM trigger) | `FIN-BRV-SOF-72X34` | line `sku` | Selects FRAME + CUSH recipe |
| Fabric grade | `A`–`F` (PIM locked list) | `fabric_grade` | Price family; allowed `FAB-*` set |
| Upholstery | `FAB-ACT-ASH` | `cushion_fabric` | MTO swap of `RM-FAB-GENERIC` on the cushion |
| Frame finish | `PWD-BLACK` | `powder_coat` | MTO swap of powder on the frame |
| Dekton (when the product has a top) | `STN-DKT-*` | `dekton` | Optional tabletop ingredient |
| Pillow | `FAB-*` | `pillow` (same FAB namespace) | Optional |

**Configured Identity** (engine-internal uniqueness / quote hash — **not** a Katana variant SKU):

```
{FIN}.G{A-F}.{PWD-*}.{FAB-*}
FIN-BRV-SOF-72X34.GA.PWD-BLACK.FAB-ACT-ASH
```

If PrimeView writes that long string into Woo `sku`, Katana’s native connector will not find a variant and the BOM will not fire.

### 1.5 Sellable powder finishes

| SKU | Name |
|---|---|
| `PWD-BLACK` | Black powder |
| `PWD-BONE` | Bone powder |
| `PWD-FANUC-GRAY` | Fanuc gray |
| `PWD-LITE-BEIGE` | Lite beige |
| `PWD-OIL-RUB-BRONZE` | Oil-rub bronze |
| `PWD-WILD-RICE` | Wild rice |

Do **not** expose primer (`PWD-GRAY-ZINC-EPOXY-PRIMER`), masking plugs, or hang wire as configurator finishes.

### 1.6 Namespaces vendors must not invent

| Prefix | Role |
|---|---|
| `FIN-*` | Sellable finished good (Master SKU) |
| `SA-*-FRAME` / `SA-*-CUSH` | Sub-assemblies the hub publishes |
| `FAB-*` | Fabric colorway (~396) |
| `PWD-*` | Powder |
| `STN-*` | Dekton / stone |
| `BRA-*` / `OCE-*` / `BRO-*` | **Legacy Katana only.** Zero overlap with the hub today. Do not target these. |

---

## 2. Katana Sales Order API — vendor target

**Endpoint:** `POST https://api.katanamrp.com/v1/sales_orders`  
**Auth:** `Authorization: Bearer <Katana API token>`  
**Content-Type:** `application/json`  
**Idempotency:** `Idempotency-Key: woo-{woocommerce_order_id}`  
**Official contract:** [Create a sales order](https://developer.katanamrp.com/reference/create-sales-order)

OpenAPI `additionalProperties` is **false**. Extra keys → HTTP 422.

Katana does **not** accept a SKU string on this POST. Required per row: `quantity` + `variant_id`. Required on the order: `customer_id` + `sales_order_rows` (minimum 1).

Creating a sales order does **not** by itself create manufacturing orders.

### 2.1 Vendor resolve sequence (vendors own this)

| Step | Method | Purpose |
|---|---|---|
| 1 | `GET /v1/customers?email=` | Reuse customer; else `POST /v1/customers` |
| 2 | `GET /v1/variants?sku=FIN-…` | Integer `variant_id` for the Master SKU. Fail closed if missing — MDM has not published that frame yet. |
| 3 | `GET /v1/tax_rates`, `GET /v1/locations` | Stable IDs for AZ / CA. Do not invent. |
| 4 | `POST /v1/sales_orders` | Payload in §2.2 |
| 5 | `POST /v1/manufacturing_order_make_to_order` | Only if the SOW includes factory start: `{ "sales_order_row_id": <id from step 4>, "create_subassemblies": true }`, then swap `cushion_fabric` / `powder_coat` on the child MO recipe rows |

### 2.2 Exact JSON vendors must emit

`customer_id`, `variant_id`, `tax_rate_id`, and `location_id` in this sample are **shape**, not live IDs. Vendors must look them up. `status` is only `NOT_SHIPPED` (default, real order) or `PENDING` (quote).

```json
{
  "order_no": "WOO-18422",
  "customer_id": 4812,
  "status": "NOT_SHIPPED",
  "currency": "USD",
  "location_id": 1,
  "order_created_date": "2026-09-10T18:04:00.000Z",
  "delivery_date": "2026-10-22T00:00:00.000Z",
  "customer_ref": "woo:18422",
  "ecommerce_order_type": "woocommerce",
  "ecommerce_store_name": "ccpatio.com",
  "ecommerce_order_id": "18422",
  "additional_info": "Showroom consult 2026-09-08. Ship white-glove.",
  "addresses": [
    {
      "entity_type": "billing",
      "first_name": "Elena",
      "last_name": "Voss",
      "company": "Voss Residences",
      "phone": "+1-480-555-0142",
      "line_1": "8820 E Camelback Rd",
      "line_2": null,
      "city": "Scottsdale",
      "state": "AZ",
      "zip": "85251",
      "country": "US"
    },
    {
      "entity_type": "shipping",
      "first_name": "Elena",
      "last_name": "Voss",
      "company": "Voss Residences",
      "phone": "+1-480-555-0142",
      "line_1": "8820 E Camelback Rd",
      "line_2": null,
      "city": "Scottsdale",
      "state": "AZ",
      "zip": "85251",
      "country": "US"
    }
  ],
  "sales_order_rows": [
    {
      "quantity": 1,
      "variant_id": 90211,
      "price_per_unit": 3840,
      "tax_rate_id": 1,
      "attributes": [
        { "key": "global_sku", "value": "FIN-BRV-SOF-72X34" },
        { "key": "fabric_grade", "value": "A" },
        { "key": "cushion_fabric", "value": "FAB-ACT-ASH" },
        { "key": "powder_coat", "value": "PWD-BLACK" },
        { "key": "config_key", "value": "FIN-BRV-SOF-72X34.GA.PWD-BLACK.FAB-ACT-ASH" }
      ]
    }
  ]
}
```

Allowed address `entity_type`: `billing` | `shipping`. Optional order fields: `tracking_number`, `tracking_number_url`, `custom_fields` (UUID keys from Katana custom-field definitions).

### 2.3 Native Woo connector alternative

If PrimeView uses Katana’s **native WooCommerce connector** instead of a custom POST, the same identity rules apply:

- Woo line SKU = `FIN-*`
- `cushion_fabric` / `powder_coat` / `fabric_grade` must survive as line attributes

The native connector is allowed by the MDM blueprint. A custom POST is also allowed **as their middleware**, not as a feature of this repository.

---

## 3. Hard rules for the vendor packet

| # | Rule |
|---|---|
| 1 | Woo / Clover line `sku` **must** equal the Master SKU (`FIN-…`). Do not suffix grade, powder, or fabric onto that string if you expect Katana SKU match. |
| 2 | Do not mint `BRA-*`, `OCE-*`, `BRO-*` legacy factory codes. Live Katana still has those; the hub publishes `FIN-*` as new variants and will not overwrite unmatched legacy rows. |
| 3 | Do not POST sales orders to this Next.js app. No Woo / GHL order webhooks are in scope. Vendors hit Katana directly (or Katana’s native Woo connector). |
| 4 | `variant_id` is required. A SKU string is not accepted on `POST /sales_orders`. Resolve via `GET /variants?sku=`. |
| 5 | Required line attributes: `global_sku`, `fabric_grade`, `cushion_fabric`, `powder_coat`. Optional: `dekton`, `pillow`, `config_key`. |
| 6 | `Idempotency-Key` = `woo-{order_id}` or `clover-{payment_id}`. Replay must not create a second sales order. |

---

## 4. Internal capital stack (CC Patio lanes)

This Next.js application is **PIM + BOM translation + catalog fan-out**. It does not create sales orders, manufacturing orders, invoices, or CRM stages.

```
SketchUp ──HMAC──► MDM Hub ──Inngest──► Katana products / recipes / ops
                         ├────────────► Woo catalog (not orders)
                         └────────────► Clover items (not tenders)

VividWorks ──► WooCommerce ──vendor / native──► Katana sales orders
Clover POS  ──same FIN SKU + same SO schema──► Katana sales orders
Katana ──native QBO connector──► QuickBooks Online (invoice + COGS)
Katana ──status webhook / Zapier──► GoHighLevel (stage only)
```

| Lane | Owner | Mechanism | Data |
|---|---|---|---|
| SketchUp → Katana | CC Patio (MDM hub) | HMAC webhook → quarantine → Approve → Inngest | `FIN` / `SA` / `RM`, recipes, operations — never sales orders |
| Katana ↔ QBO | CC Patio IT (config) | Katana native QuickBooks Online connector | Invoices, COGS, inventory valuation, item sync |
| Katana → GHL | CC Patio (light automation) | Katana webhook / Zapier on SO status | Opportunity stage only; email is the join key |
| Clover → Katana | CC Patio + POS integrator | Same `FIN` SKU; same SO schema as Woo | Showroom orders into manufacturing |
| Woo → Katana | PrimeView / VividWorks | Native Woo connector **or** this POST body | Out of MDM scope |

### 4.1 Katana ↔ QuickBooks Online

- Enable Katana’s official QBO integration. Configure accounts, tax, and item mapping in Katana / QBO — not in this repo.
- Sellable `FIN-*` map to QBO inventory or non-inventory items. `SA-*` / `RM-*` / `FAB-*` / `PWD-*` map as ingredients or non-sellable parts so COGS explodes from the Katana recipe, not from a Woo line.
- Invoice and COGS post when Katana invoices the SO / completes production, depending on connector policy (invoice-on-ship vs invoice-on-create). Pick one policy and keep Clover and Woo on it.
- Do **not** rebuild the cancelled V8 invoice mutex, dual-QBO workers, or Clover deposit matcher.

See [`docs/IT_RUNBOOK.md`](./IT_RUNBOOK.md) §5 — connector issues are not MDM bugs.

### 4.2 Katana → GoHighLevel

- GHL is staff CRM only. **Do not** create Katana sales orders from opportunity won. That path is retired.
- Join key: customer email, plus `customer_ref` (`woo:18422` or `clover:{payment_id}`).
- Outbound only: SO created → In Production; MO done → Ready to Ship; SO shipped → Delivered. Use a Katana webhook or Zapier / Make. The MDM hub does not write GHL stages.

### 4.3 Clover POS → Katana

- On Approve, the hub can publish the same `FIN-*` as a Clover item. Showroom must sell that SKU, with the same three attributes (`fabric_grade`, `cushion_fabric`, `powder_coat`).
- Money stays on Clover (and Clover ↔ QBO if you use it). Manufacturing ingress is a Katana SO using the JSON in §2.2 (`ecommerce_order_type: "clover"`, `Idempotency-Key: clover-{payment_id}`).
- Katana has no first-class Clover app comparable to Woo. You need a thin POS → Katana mapper (Clover app, iPaaS, or the same PrimeView worker). That mapper is **not** this hub.

### 4.4 SketchUp → Katana

This is the only CAD path, and it is already the hub product:

1. SketchUp posts a signed payload to `POST /api/webhooks/sketchup`.
2. Zod fail → HTTP 400, no insert. Pass → `product_intake` quarantined.
3. Operator sets MSRP / SEO at `/admin/quarantine` and Approves.
4. Inngest `product.approved` fans out **catalog** to Katana (materials → sub-assemblies → finished good → recipe → operations), optionally Woo and Clover.
5. Floor cut-lists ride structured `cut_list` onto Katana recipe notes — not a sales order.

Nested BOM in the hub is `FIN-*` → `SA-*-FRAME` + `SA-*-CUSH` → tube / `RM-FAB-GENERIC` / powder. Colorways are swapped at MTO time, which is why the Master SKU must stay the frame.

---

## 5. Architect follow-up (before storefront go-live)

Publish every Phase 1/2 `FIN-*` (and its FRAME / CUSH recipes) into Katana via Approve so `GET /variants?sku=FIN-…` returns an id. Until that exists, vendors will 422 on `variant_id` and the factory will see nothing.

Existing generated handoff files (regenerate with `scripts/vividworks/04-generate-complete-sow-datapack.ts`):

- `docs/Vividworks/Handoff/vividworks_phase1_products.csv`
- `docs/Vividworks/Handoff/vividworks_phase2_products.csv`
- `docs/Vividworks/Handoff/vividworks_material_options.csv`
- `docs/Vividworks/Handoff/vividworks_configuration_rules.json`

---

## 6. Sources

- `docs/MDM_MASTER_BLUEPRINT.md` (effective 2026-09-02)
- `docs/IT_RUNBOOK.md` §5 (native connectors)
- Katana OpenAPI: Create a sales order (`additionalProperties: false`)
- `src/lib/sku-engine.ts` (canonical `FIN-{COL}-{CAT}-{SIZE}` engine)
- `docs/Vividworks/Handoff/vividworks_configuration_rules.json` (relational pack; 2026-09-09)
- PIM fabric grade select: `A`–`F` (`src/app/admin/shared/smart-field-config.ts`)
- Powder list: `docs/Vividworks/Handoff/vividworks_material_options.csv`
- Woo line meta keys: `src/server/woocommerce/ingress.schema.ts`

---

**End of Capital Stack Vendor Handoff**
