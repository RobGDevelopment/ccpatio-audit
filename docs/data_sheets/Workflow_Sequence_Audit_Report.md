# Workflow Sequence Audit Report

> Auto-generated from `sequences.ts`, `dwellCalendar.ts`, `granularGraph.ts`, and `stories.ts`.
> Generated: 2026-08-22T13:47:53.707Z

## Summary

| Metric | Count |
|--------|------:|
| Happy-path journeys | 3 |
| Exception playlists | 7 |
| Audit playlists (full + board) | 20 |

---

## Retail · Scottsdale AZ (Full Map)

- **Playlist ID:** `retail-az-full`
- **Journey key:** `retail`
- **Mode:** full
- **Total steps:** 51

### Step 1 · `traffic-meta`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `traffic-meta` |
| **Parent node ID** | `traffic-meta` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 1800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Demand enters the brand |
| **Active UI glow target** | `traffic-meta` |

**Story (customer):** Sees an ad or design post and starts a conversation.

**Story (system):** UTM / click IDs land in session; GHL can attribute the lead.


### Step 2 · `chan-webchat`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `traffic-meta` |
| **Target (this step)** | `chan-webchat` |
| **Parent node ID** | `chan-webchat` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ig-chat) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Live conversation on ccpatio.com |
| **Active UI glow target** | `chan-webchat` |

**Story (customer):** Asks about sizing, fabrics, or showroom visits.

**Story (system):** Web chat routes into the GHL Unified Inbox.

**Beam endpoints:**
  - `e-ig-chat`: `traffic-meta` → `chan-webchat`

### Step 3 · `ghl-hub`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `chan-webchat` |
| **Target (this step)** | `ghl-hub` |
| **Parent node ID** | `ghl-hub` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-chat-hub) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | GHL Unified Inbox (the router) |
| **Active UI glow target** | `ghl-hub` |

**Story (customer):** Doesn’t see this — internal brain of intake.

**Story (system):** Tags (retail_az, commercial, warranty) and spawns the card.

**Beam endpoints:**
  - `e-chat-hub`: `chan-webchat` → `ghl-hub`

### Step 4 · `leads-pipe · lead-new`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ghl-hub` |
| **Target (this step)** | `leads-pipe__lead-new` |
| **Parent node ID** | `leads-pipe` |
| **Sub-button / stage ID** | `lead-new` |
| **Connection type** | Direct Beam (e-hub-leads) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | New / uncontacted lead |
| **Active UI glow target** | `leads-pipe__lead-new` |

**Story (customer):** Waiting for a human reply after the first touch.

**Story (system):** Leads pipeline card; SLA clock starts.

**Beam endpoints:**
  - `e-hub-leads`: `ghl-hub` → `leads-pipe__lead-new`

### Step 5 · `leads-pipe · lead-website`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `leads-pipe__lead-new` |
| **Target (this step)** | `leads-pipe__lead-website` |
| **Parent node ID** | `leads-pipe` |
| **Sub-button / stage ID** | `lead-website` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Website Order Form (CRM gate) |
| **Active UI glow target** | `leads-pipe__lead-website` |

**Story (customer):** Submits project details online.

**Story (system):** Lead qualifies → Scottsdale or Solana Beach Sales opportunity.


### Step 6 · `sales-az · az-onsite`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `leads-pipe__lead-website` |
| **Target (this step)** | `sales-az__az-onsite` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-onsite` |
| **Connection type** | Direct Beam (e-leads-az) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +4d · Lead ingestion → On-site scheduled |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | On-site scheduled |
| **Active UI glow target** | `sales-az__az-onsite` |

**Story (customer):** Expects a field visit or measurement appointment.

**Story (system):** CRM stage only — no middleware mutations.

**Beam endpoints:**
  - `e-leads-az`: `leads-pipe__lead-website` → `sales-az__az-onsite`

### Step 7 · `sales-az · az-sketchup-needed`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-onsite` |
| **Target (this step)** | `sales-az__az-sketchup-needed` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-sketchup-needed` |
| **Connection type** | External Webhook (e-az-survey → field-survey) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | Design bridge — SketchUp needed |
| **Active UI glow target** | `sales-az__az-sketchup-needed` |

**Story (customer):** Waiting on a 3D concept that matches their space.

**Story (system):** Human BOM + dimensions; CAD/CAM packets prepared later.


### Step 8 · `sketchup`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-sketchup-needed` |
| **Target (this step)** | `sketchup` |
| **Parent node ID** | `sketchup` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-survey-sketchup) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | SketchUp 3D modeling |
| **Active UI glow target** | `sketchup` |

**Story (customer):** Waiting for a visual they can approve.

**Story (system):** Human modeling; tube cut schedules follow.

**Beam endpoints:**
  - `e-survey-sketchup`: `sales-az__az-sketchup-needed` → `sketchup`

### Step 9 · `cut-lists`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sketchup` |
| **Target (this step)** | `cut-lists` |
| **Parent node ID** | `cut-lists` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-sketchup-cutlists) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | Tube cut schedules & miter angles |
| **Active UI glow target** | `cut-lists` |

**Story (customer):** Invisible — chop saw traveler is being prepared.

**Story (system):** Manual chop saw schedules — no CNC laser nesting.

**Beam endpoints:**
  - `e-sketchup-cutlists`: `sketchup` → `cut-lists`

### Step 10 · `bom-packet`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `cut-lists` |
| **Target (this step)** | `bom-packet` |
| **Parent node ID** | `bom-packet` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-cutlists-bom) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | +2d · CAD/CAM cut files & BOM |
| **Cumulative calendar** | Day 6 / 56d E2E |
| **Story card title** | BOM assembly packet |
| **Active UI glow target** | `bom-packet` |

**Story (customer):** Spec is becoming real SKUs and finishes.

**Story (system):** Shop drawings + frozen SKU list for Produce FO.

**Beam endpoints:**
  - `e-cutlists-bom`: `cut-lists` → `bom-packet`

### Step 11 · `sales-az · az-sketchup-done`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `bom-packet` |
| **Target (this step)** | `sales-az__az-sketchup-done` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-sketchup-done` |
| **Connection type** | Direct Beam (e-bom-az) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 6 / 56d E2E |
| **Story card title** | SketchUp complete — design locked for proposal |
| **Active UI glow target** | `sales-az__az-sketchup-done` |

**Story (customer):** Sees a 3D that they can react to.

**Story (system):** Packet returns to Sales; SKUs not frozen until finalize.

**Beam endpoints:**
  - `e-bom-az`: `bom-packet` → `sales-az__az-sketchup-done`

### Step 12 · `sales-az · az-proposal`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-sketchup-done` |
| **Target (this step)** | `sales-az__az-proposal` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-proposal` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +7d · SketchUp 3D modeling & proposal |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Proposal given |
| **Active UI glow target** | `sales-az__az-proposal` |

**Story (customer):** Reviews pricing, fabrics, and lead time.

**Story (system):** CRM document / e-sign; still no factory webhook.


### Step 13 · `sales-az · az-finalize`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-proposal` |
| **Target (this step)** | `sales-az__az-finalize` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-finalize` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Finalize finishes |
| **Active UI glow target** | `sales-az__az-finalize` |

**Story (customer):** Picks powder, fabric, and configuration details.

**Story (system):** SKU freeze in the packet that Produce FO will send.


### Step 14 · `sales-az · az-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-finalize` |
| **Target (this step)** | `sales-az__az-produce` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-produce` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3000 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Produce Factory Order (Gate 1 prep) |
| **Active UI glow target** | `sales-az__az-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move creates the FO record — webhook fires after Client Approval.


### Step 15 · `qbo-deposit-link`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-produce` |
| **Target (this step)** | `qbo-deposit-link` |
| **Parent node ID** | `qbo-deposit-link` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-az-produce-deposit-qbo) · Parallel Fan-Out → clover-showroom |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | QBO payment link — 50% deposit |
| **Active UI glow target** | `qbo-deposit-link` |

**Story (customer):** Receives emailed invoice link to pay deposit.

**Story (system):** QuickBooks Online payment link clears into Omnichannel Payment Gateway.

**Beam endpoints:**
  - `e-az-produce-deposit-qbo`: `sales-az__az-produce` → `qbo-deposit-link`

### Step 16 · `payment-gateway`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo-deposit-link` |
| **Target (this step)** | `payment-gateway` |
| **Parent node ID** | `payment-gateway` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-deposit-qbo-gateway, e-deposit-clover-gateway) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Omnichannel payment gateway |
| **Active UI glow target** | `payment-gateway` |

**Story (customer):** Deposit is confirmed — order can release to factory.

**Story (system):** Either QBO link or Clover swipe must clear before 07.S Client Approval.

**Beam endpoints:**
  - `e-deposit-qbo-gateway`: `qbo-deposit-link` → `payment-gateway`
  - `e-deposit-clover-gateway`: `qbo-deposit-link` → `payment-gateway`

### Step 17 · `sales-az · az-approval`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `payment-gateway` |
| **Target (this step)** | `sales-az__az-approval` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-approval` |
| **Connection type** | Direct Beam (e-gateway-approval-az) · External Webhook (e-az-produce, e-produce-az-ingress → produce-az, ingress) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Client Approval — sign-off & deposit clearance |
| **Active UI glow target** | `sales-az__az-approval` |

**Story (customer):** Final sign-off before factory webhook releases.

**Story (system):** Deposit cleared + e-sign complete → Produce + Won webhook → Ingress outbox → Katana MO.

**Beam endpoints:**
  - `e-gateway-approval-az`: `payment-gateway` → `sales-az__az-approval`

### Step 18 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-approval` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Parallel Fan-Out → redis, postgres · External Webhook (e-ingress-redis, e-ingress-pg → redis, postgres) |
| **Dwell (UI animation)** | 2000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Middleware ingress (zero data loss) |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible — reliability layer.

**Story (system):** HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases.


### Step 19 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-pg-inngest) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Inngest CCR (lease + sweeper) |
| **Active UI glow target** | `inngest` |

**Story (customer):** Invisible.

**Story (system):** Fan-out to Katana + GHL Manufacturing mirror under a claim lease.

**Beam endpoints:**
  - `e-pg-inngest`: `ingress` → `inngest`

### Step 20 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inngest` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → mfg-pipe |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.

**Beam endpoints:**
  - `e-inngest-katana`: `inngest` → `katana`
  - `e-inngest-mfg`: `inngest` → `katana`

### Step 21 · `mfg-pipe · mfg-new`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `mfg-pipe__mfg-new` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-new` |
| **Connection type** | Direct Beam (e-katana-mfg-new) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | — |
| **Active UI glow target** | `mfg-pipe__mfg-new` |

_No story card mapped._

**Beam endpoints:**
  - `e-katana-mfg-new`: `katana` → `mfg-pipe__mfg-new`

### Step 22 · `inventory-alloc`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-new` |
| **Target (this step)** | `inventory-alloc` |
| **Parent node ID** | `inventory-alloc` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-katana-alloc) · Parallel Fan-Out → outsourced-accessories, procurement-wait |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Inventory allocation check |
| **Active UI glow target** | `inventory-alloc` |

**Story (customer):** Invisible — materials are being reserved.

**Story (system):** Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement.

**Beam endpoints:**
  - `e-katana-alloc`: `mfg-pipe__mfg-new` → `inventory-alloc`

### Step 23 · `outsourced-accessories`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inventory-alloc` |
| **Target (this step)** | `outsourced-accessories` |
| **Parent node ID** | `outsourced-accessories` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-alloc-outsourced) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Outsourced accessories hold |
| **Active UI glow target** | `outsourced-accessories` |

**Story (customer):** Umbrellas and pool chairs wait for in-house frames.

**Story (system):** Bypasses fabrication pods — merges at Component Assembly / Marriage.

**Beam endpoints:**
  - `e-alloc-outsourced`: `inventory-alloc` → `outsourced-accessories`

### Step 24 · `procurement-wait`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `outsourced-accessories` |
| **Target (this step)** | `procurement-wait` |
| **Parent node ID** | `procurement-wait` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-alloc-procure) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | +10d · Purchasing wait / extrusion procurement |
| **Cumulative calendar** | Day 26 / 56d E2E |
| **Story card title** | Procurement wait loop |
| **Active UI glow target** | `procurement-wait` |

**Story (customer):** Lead time buffer while extrusion stock is ordered.

**Story (system):** 10-day SLA buffer · GHL Manufacturing → Purchasing / Receiving sync.

**Beam endpoints:**
  - `e-alloc-procure`: `outsourced-accessories` → `procurement-wait`

### Step 25 · `mfg-pipe · mfg-purchasing`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `procurement-wait` |
| **Target (this step)** | `mfg-pipe__mfg-purchasing` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-purchasing` |
| **Connection type** | Direct Beam (e-procure-mfg-sync) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 26 / 56d E2E |
| **Story card title** | — |
| **Active UI glow target** | `mfg-pipe__mfg-purchasing` |

_No story card mapped._

**Beam endpoints:**
  - `e-procure-mfg-sync`: `procurement-wait` → `mfg-pipe__mfg-purchasing`

### Step 26 · `work-centers · wc-tube-stock`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-purchasing` |
| **Target (this step)** | `work-centers__wc-tube-stock` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-tube-stock` |
| **Connection type** | Direct Beam (e-procure-stock) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 26 / 56d E2E |
| **Story card title** | Tube metal stock & staging |
| **Active UI glow target** | `work-centers__wc-tube-stock` |

**Story (customer):** Marine-grade aluminum extrusion is being kitted.

**Story (system):** Raw extrusion inventory pulled from tube stock racks.

**Beam endpoints:**
  - `e-procure-stock`: `mfg-pipe__mfg-purchasing` → `work-centers__wc-tube-stock`

### Step 27 · `work-centers · wc-chop-saw`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-tube-stock` |
| **Target (this step)** | `work-centers__wc-chop-saw` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-chop-saw` |
| **Connection type** | Direct Beam (e-alloc-chop) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +3d · Chop saw cut & miter station |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Chop saw cut & miter station |
| **Active UI glow target** | `work-centers__wc-chop-saw` |

**Story (customer):** Extrusions are cut to length — no CNC laser or mandrel bending.

**Story (system):** Precision chop saws: straight cuts, angles, miters, deburring.

**Beam endpoints:**
  - `e-alloc-chop`: `work-centers__wc-tube-stock` → `work-centers__wc-chop-saw`

### Step 28 · `work-centers · wc-cart-parts`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-chop-saw` |
| **Target (this step)** | `work-centers__wc-cart-parts` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-cart-parts` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Rolling cart parts staging |
| **Active UI glow target** | `work-centers__wc-cart-parts` |

**Story (customer):** Cut tube profiles are kitted onto mobile carts.

**Story (system):** Cart-based WIP between cut station and fabrication pods.


### Step 29 · `work-centers · wc-tack`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-cart-parts` |
| **Target (this step)** | `work-centers__wc-tack` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-tack` |
| **Connection type** | External Webhook (e-pod-mfg-production → mfg-pipe) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | 4A · Tack welder station |
| **Active UI glow target** | `work-centers__wc-tack` |

**Story (customer):** Frame is jig-clamped and tacked.

**Story (system):** First of three pod stations — tack before full weld-out.


### Step 30 · `mfg-pipe · mfg-production`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-tack` |
| **Target (this step)** | `mfg-pipe__mfg-production` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-production` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Production in progress (mirror pulse) |
| **Active UI glow target** | `mfg-pipe__mfg-production` |

**Story (customer):** Invisible — CRM shows active factory work.

**Story (system):** Katana → GHL Manufacturing sync when frame enters Fabrication Pod.


### Step 31 · `work-centers · wc-weld-out`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-production` |
| **Target (this step)** | `work-centers__wc-weld-out` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-weld-out` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | 4B · Weld out station |
| **Active UI glow target** | `work-centers__wc-weld-out` |

**Story (customer):** Structural bead welding completes the frame.

**Story (system):** Full structural welds; Gate A inspects dimension + weld quality next.


### Step 32 · `work-centers · wc-grinder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-weld-out` |
| **Target (this step)** | `work-centers__wc-grinder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-grinder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | 4C · Grinder station |
| **Active UI glow target** | `work-centers__wc-grinder` |

**Story (customer):** Weld seams are smoothed and prepped.

**Story (system):** Weld seam smoothing before sub-frame marriage.


### Step 33 · `work-centers · wc-marriage`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-grinder` |
| **Target (this step)** | `work-centers__wc-marriage` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-marriage` |
| **Connection type** | Direct Beam (e-outsourced-marriage) · Parallel Fan-Out → outsourced-accessories |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Component assembly & marriage |
| **Active UI glow target** | `work-centers__wc-marriage` |

**Story (customer):** Modular sub-frames join into finished builds.

**Story (system):** Marriage of pod outputs before Gate A weld/dim check.

**Beam endpoints:**
  - `e-outsourced-marriage`: `work-centers__wc-grinder` → `work-centers__wc-marriage`

### Step 34 · `qc-gates · qc-a`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-marriage` |
| **Target (this step)** | `qc-gates__qc-a` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-a` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | +5d · Fabrication pod weld-out (Gate A) |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Gate A — weld / dimension |
| **Active UI glow target** | `qc-gates__qc-a` |

**Story (customer):** Quality is being proven before coating.

**Story (system):** Fail → NCR freeze + remake at weld. Pass → blast/powder.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 35 · `work-centers · wc-cart-blast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-a` |
| **Target (this step)** | `work-centers__wc-cart-blast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-cart-blast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Rolling cart staging to sandblast |
| **Active UI glow target** | `work-centers__wc-cart-blast` |

**Story (customer):** Completed build rolled to surface prep.

**Story (system):** Cart WIP between marriage and sandblast bay.


### Step 36 · `work-centers · wc-sandblast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-cart-blast` |
| **Target (this step)** | `work-centers__wc-sandblast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-sandblast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Surface prep & sandblaster |
| **Active UI glow target** | `work-centers__wc-sandblast` |

**Story (customer):** Frame is media-blasted for coating adhesion.

**Story (system):** Prep quality drives Gate B adhesion later.


### Step 37 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-sandblast` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Powder coat & curing oven |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Frame finish is being applied and cured.

**Story (system):** Shop floor station; QC Gate B follows adhesion/DFT checks.


### Step 38 · `qc-gates · qc-b`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `qc-gates__qc-b` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-b` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | +5d · Sandblast & powder coat (Gate B) |
| **Cumulative calendar** | Day 39 / 56d E2E |
| **Story card title** | Gate B — DFT / adhesion |
| **Active UI glow target** | `qc-gates__qc-b` |

**Story (customer):** Finish quality is locked.

**Story (system):** Coating thickness + adhesion; fail returns to finishing.


### Step 39 · `work-centers · wc-upholstery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-b` |
| **Target (this step)** | `work-centers__wc-upholstery` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-upholstery` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +4d · Custom upholstery & cushion sewing |
| **Cumulative calendar** | Day 43 / 56d E2E |
| **Story card title** | Custom upholstery & cushion sewing |
| **Active UI glow target** | `work-centers__wc-upholstery` |

**Story (customer):** Cushions and covers are being made to spec.

**Story (system):** Parallel to metal once frames pass Gate B.


### Step 40 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-upholstery` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 43 / 56d E2E |
| **Story card title** | Final assembly, glides & hardware |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Pieces become the finished suite.

**Story (system):** Traveler complete before Gate C photo log.


### Step 41 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +3d · Final assembly & pre-pack (Gate C) |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | Gate C — pre-pack photo log |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Quality locked before shipping.

**Story (system):** 360° photos can attach to GHL; NCR freezes remakes if fail.


### Step 42 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | Ready for Delivery (mirror) |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Product is waiting on a scheduled route.

**Story (system):** GHL Manufacturing mirrors Katana — not the system of record.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 43 · `dispatch-routes · dispatch-box`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-ready` |
| **Target (this step)** | `dispatch-routes__dispatch-box` |
| **Parent node ID** | `dispatch-routes` |
| **Sub-button / stage ID** | `dispatch-box` |
| **Connection type** | Direct Beam (e-mfg-dispatch-box) · Parallel Fan-Out → dispatch-routes |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | CCPatio box truck (< 500 mi) |
| **Active UI glow target** | `dispatch-routes__dispatch-box` |

**Story (customer):** Local white-glove delivery scheduled.

**Story (system):** In-house box truck route · Samsara / Onfleet.

**Beam endpoints:**
  - `e-mfg-dispatch-box`: `mfg-pipe__mfg-ready` → `dispatch-routes__dispatch-box`

### Step 44 · `dispatch-routes · dispatch-3pl`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `dispatch-routes__dispatch-box` |
| **Target (this step)** | `dispatch-routes__dispatch-3pl` |
| **Parent node ID** | `dispatch-routes` |
| **Sub-button / stage ID** | `dispatch-3pl` |
| **Connection type** | Direct Beam (e-mfg-dispatch-box-3pl) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | 3PL freight dispatch (> 500 mi) |
| **Active UI glow target** | `dispatch-routes__dispatch-3pl` |

**Story (customer):** National freight carrier scheduled.

**Story (system):** Third-party freight · same delivery + invoice path.

**Beam endpoints:**
  - `e-mfg-dispatch-box-3pl`: `dispatch-routes__dispatch-box` → `dispatch-routes__dispatch-3pl`

### Step 45 · `dispatch-routes · dispatch-willcall`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `dispatch-routes__dispatch-3pl` |
| **Target (this step)** | `dispatch-routes__dispatch-willcall` |
| **Parent node ID** | `dispatch-routes` |
| **Sub-button / stage ID** | `dispatch-willcall` |
| **Connection type** | Direct Beam (e-mfg-dispatch-box-willcall) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | Customer will-call / pickup |
| **Active UI glow target** | `dispatch-routes__dispatch-willcall` |

**Story (customer):** Picks up finished goods at factory.

**Story (system):** Will-call route · still flows through QBO invoice + ledger reconciled.

**Beam endpoints:**
  - `e-mfg-dispatch-box-willcall`: `dispatch-routes__dispatch-3pl` → `dispatch-routes__dispatch-willcall`

### Step 46 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `dispatch-routes__dispatch-willcall` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-dispatch-box-delivery, e-dispatch-3pl-delivery, e-dispatch-willcall-delivery) · External Webhook (e-delivery-qbo → qbo) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 51 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).

**Beam endpoints:**
  - `e-dispatch-box-delivery`: `dispatch-routes__dispatch-box` → `delivery`
  - `e-dispatch-3pl-delivery`: `dispatch-routes__dispatch-3pl` → `delivery`
  - `e-dispatch-willcall-delivery`: `dispatch-routes__dispatch-willcall` → `delivery`

### Step 47 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 51 / 56d E2E |
| **Story card title** | Financial clearance — QBO invoice |
| **Active UI glow target** | `qbo` |

**Story (customer):** Receives formal invoice / remaining balance path.

**Story (system):** OAuth mutex; inv_${opportunity_id}; never blocked by Clover miss.


### Step 48 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 51 / 56d E2E |
| **Story card title** | Clover POS fuzzy match |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit already paid at POS or link.

**Story (system):** Match by amount/window/location; unmatched → DLQ, invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `qbo` → `clover`

### Step 49 · `reconciled`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `reconciled` |
| **Parent node ID** | `reconciled` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-clover-ok) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +2d · QBO/Clover financial reconciliation |
| **Cumulative calendar** | Day 53 / 56d E2E |
| **Story card title** | Ledger reconciled |
| **Active UI glow target** | `reconciled` |

**Story (customer):** Books match cash — 56-day E2E SLA complete.

**Story (system):** Happy-path close after Clover match (or manual recon).

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `reconciled`

### Step 50 · `sales-az · az-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `reconciled` |
| **Target (this step)** | `sales-az__az-delivered` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-delivered` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 53 / 56d E2E |
| **Story card title** | Sales → 08. Delivered |
| **Active UI glow target** | `sales-az__az-delivered` |

**Story (customer):** Order is complete in the CRM they were sold from.

**Story (system):** Stage move after Delivered + QBO path; Clover miss does not block this.


### Step 51 · `postcare`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-delivered` |
| **Target (this step)** | `postcare` |
| **Parent node ID** | `postcare` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ok-postcare) |
| **Dwell (UI animation)** | 3000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 53 / 56d E2E |
| **Story card title** | Post-care & warranty registry |
| **Active UI glow target** | `postcare` |

**Story (customer):** SMS passport, NPS, care guide, seasonal follow-ups.

**Story (system):** GHL sequences; warranty linked to serial number.

**Beam endpoints:**
  - `e-ok-postcare`: `sales-az__az-delivered` → `postcare`

---

## Retail · Scottsdale AZ (Board Brief)

- **Playlist ID:** `retail-az-board`
- **Journey key:** `retail`
- **Mode:** board
- **Total steps:** 13

### Step 1 · `traffic-meta`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `traffic-meta` |
| **Parent node ID** | `traffic-meta` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Demand enters the brand |
| **Active UI glow target** | `traffic-meta` |

**Story (customer):** Sees an ad or design post and starts a conversation.

**Story (system):** UTM / click IDs land in session; GHL can attribute the lead.


### Step 2 · `ghl-hub`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `traffic-meta` |
| **Target (this step)** | `ghl-hub` |
| **Parent node ID** | `ghl-hub` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ig-chat, e-chat-hub) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | GHL Unified Inbox (the router) |
| **Active UI glow target** | `ghl-hub` |

**Story (customer):** Doesn’t see this — internal brain of intake.

**Story (system):** Tags (retail_az, commercial, warranty) and spawns the card.

**Beam endpoints:**
  - `e-ig-chat`: `traffic-meta` → `ghl-hub`
  - `e-chat-hub`: `traffic-meta` → `ghl-hub`

### Step 3 · `leads-pipe · lead-website`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ghl-hub` |
| **Target (this step)** | `leads-pipe__lead-website` |
| **Parent node ID** | `leads-pipe` |
| **Sub-button / stage ID** | `lead-website` |
| **Connection type** | Direct Beam (e-hub-leads) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Website Order Form (CRM gate) |
| **Active UI glow target** | `leads-pipe__lead-website` |

**Story (customer):** Submits project details online.

**Story (system):** Lead qualifies → Scottsdale or Solana Beach Sales opportunity.

**Beam endpoints:**
  - `e-hub-leads`: `ghl-hub` → `leads-pipe__lead-new`

### Step 4 · `sales-az · az-sketchup-needed`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `leads-pipe__lead-website` |
| **Target (this step)** | `sales-az__az-sketchup-needed` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-sketchup-needed` |
| **Connection type** | Direct Beam (e-leads-az) · External Webhook (e-az-survey, e-survey-sketchup → field-survey, sketchup) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Design bridge — SketchUp needed |
| **Active UI glow target** | `sales-az__az-sketchup-needed` |

**Story (customer):** Waiting on a 3D concept that matches their space.

**Story (system):** Human BOM + dimensions; CAD/CAM packets prepared later.

**Beam endpoints:**
  - `e-leads-az`: `leads-pipe__lead-website` → `sales-az__az-onsite`

### Step 5 · `sales-az · az-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-sketchup-needed` |
| **Target (this step)** | `sales-az__az-produce` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-produce` |
| **Connection type** | Direct Beam (e-bom-az) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Produce Factory Order (Gate 1 prep) |
| **Active UI glow target** | `sales-az__az-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move creates the FO record — webhook fires after Client Approval.

**Beam endpoints:**
  - `e-bom-az`: `sales-az__az-sketchup-needed` → `sales-az__az-sketchup-done`

### Step 6 · `payment-gateway`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-produce` |
| **Target (this step)** | `payment-gateway` |
| **Parent node ID** | `payment-gateway` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-deposit-qbo-gateway) · Parallel Fan-Out → qbo-deposit-link, clover-showroom |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Omnichannel payment gateway |
| **Active UI glow target** | `payment-gateway` |

**Story (customer):** Deposit is confirmed — order can release to factory.

**Story (system):** Either QBO link or Clover swipe must clear before 07.S Client Approval.

**Beam endpoints:**
  - `e-deposit-qbo-gateway`: `sales-az__az-produce` → `payment-gateway`

### Step 7 · `sales-az · az-approval`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `payment-gateway` |
| **Target (this step)** | `sales-az__az-approval` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-approval` |
| **Connection type** | Direct Beam (e-gateway-approval-az) · External Webhook (e-az-produce, e-produce-az-ingress → produce-az, ingress) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Client Approval — sign-off & deposit clearance |
| **Active UI glow target** | `sales-az__az-approval` |

**Story (customer):** Final sign-off before factory webhook releases.

**Story (system):** Deposit cleared + e-sign complete → Produce + Won webhook → Ingress outbox → Katana MO.

**Beam endpoints:**
  - `e-gateway-approval-az`: `payment-gateway` → `sales-az__az-approval`

### Step 8 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-approval` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-redis, e-ingress-pg, e-pg-inngest, e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → work-centers, mfg-pipe |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.

**Beam endpoints:**
  - `e-ingress-redis`: `sales-az__az-approval` → `katana`
  - `e-ingress-pg`: `sales-az__az-approval` → `katana`
  - `e-pg-inngest`: `sales-az__az-approval` → `katana`
  - `e-inngest-katana`: `sales-az__az-approval` → `katana`
  - `e-inngest-mfg`: `sales-az__az-approval` → `katana`

### Step 9 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Final assembly, glides & hardware |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Pieces become the finished suite.

**Story (system):** Traveler complete before Gate C photo log.


### Step 10 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-wc-qc, e-qc-mfg, e-mfg-dispatch-box, e-dispatch-box-delivery) · External Webhook (e-delivery-qbo → qbo) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 8 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`
  - `e-mfg-dispatch-box`: `mfg-pipe__mfg-ready` → `dispatch-routes__dispatch-box`
  - `e-dispatch-box-delivery`: `dispatch-routes__dispatch-box` → `delivery`

### Step 11 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 8 / 56d E2E |
| **Story card title** | Clover POS fuzzy match |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit already paid at POS or link.

**Story (system):** Match by amount/window/location; unmatched → DLQ, invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `delivery` → `clover`

### Step 12 · `reconciled`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `reconciled` |
| **Parent node ID** | `reconciled` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-clover-ok) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +2d · QBO/Clover financial reconciliation |
| **Cumulative calendar** | Day 10 / 56d E2E |
| **Story card title** | Ledger reconciled |
| **Active UI glow target** | `reconciled` |

**Story (customer):** Books match cash — 56-day E2E SLA complete.

**Story (system):** Happy-path close after Clover match (or manual recon).

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `reconciled`

### Step 13 · `postcare`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `reconciled` |
| **Target (this step)** | `postcare` |
| **Parent node ID** | `postcare` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ok-postcare) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 10 / 56d E2E |
| **Story card title** | Post-care & warranty registry |
| **Active UI glow target** | `postcare` |

**Story (customer):** SMS passport, NPS, care guide, seasonal follow-ups.

**Story (system):** GHL sequences; warranty linked to serial number.

**Beam endpoints:**
  - `e-ok-postcare`: `reconciled` → `postcare`

---

## Retail / B2B · Solana Beach CA (Full Map — Trade spine)

- **Playlist ID:** `retail-ca-full`
- **Journey key:** `trade`
- **Mode:** full
- **Total steps:** 50

### Step 1 · `chan-phone`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `chan-phone` |
| **Parent node ID** | `chan-phone` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 1800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Inbound call (Trade / Commercial) |
| **Active UI glow target** | `chan-phone` |

**Story (customer):** Designer or developer calls to open an account or project.

**Story (system):** Twilio/GHL call route → Unified Inbox → Trade pipeline.


### Step 2 · `ghl-hub`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `chan-phone` |
| **Target (this step)** | `ghl-hub` |
| **Parent node ID** | `ghl-hub` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-phone-hub) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | GHL Unified Inbox (the router) |
| **Active UI glow target** | `ghl-hub` |

**Story (customer):** Doesn’t see this — internal brain of intake.

**Story (system):** Tags (retail_az, commercial, warranty) and spawns the card.

**Beam endpoints:**
  - `e-phone-hub`: `chan-phone` → `ghl-hub`

### Step 3 · `trade-pipe · trade-app`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ghl-hub` |
| **Target (this step)** | `trade-pipe__trade-app` |
| **Parent node ID** | `trade-pipe` |
| **Sub-button / stage ID** | `trade-app` |
| **Connection type** | Direct Beam (e-hub-trade) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Trade application submitted |
| **Active UI glow target** | `trade-pipe__trade-app` |

**Story (customer):** Designer/developer requests wholesale or project pricing.

**Story (system):** Application card; credit/terms review is human.

**Beam endpoints:**
  - `e-hub-trade`: `ghl-hub` → `trade-pipe__trade-app`

### Step 4 · `trade-pipe · trade-approved`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `trade-pipe__trade-app` |
| **Target (this step)** | `trade-pipe__trade-approved` |
| **Parent node ID** | `trade-pipe` |
| **Sub-button / stage ID** | `trade-approved` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Trade account approved |
| **Active UI glow target** | `trade-pipe__trade-approved` |

**Story (customer):** Can now specify CCPatio on commercial projects.

**Story (system):** Commercial tag + Solana Beach Sales swimlane.


### Step 5 · `sales-ca · ca-onsite`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `trade-pipe__trade-approved` |
| **Target (this step)** | `sales-ca__ca-onsite` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-onsite` |
| **Connection type** | Direct Beam (e-trade-ca) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +4d · Lead ingestion → On-site scheduled |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | On-site scheduled (Solana Beach) |
| **Active UI glow target** | `sales-ca__ca-onsite` |

**Story (customer):** Site walk or showroom appointment for a commercial project.

**Story (system):** CRM stage only.

**Beam endpoints:**
  - `e-trade-ca`: `trade-pipe__trade-approved` → `sales-ca__ca-onsite`

### Step 6 · `sales-ca · ca-sketchup-needed`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-onsite` |
| **Target (this step)** | `sales-ca__ca-sketchup-needed` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-sketchup-needed` |
| **Connection type** | External Webhook (e-ca-survey → field-survey) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | Design bridge — SketchUp needed (CA) |
| **Active UI glow target** | `sales-ca__ca-sketchup-needed` |

**Story (customer):** Waiting on drawings that match the job site.

**Story (system):** Same CAD/CAM path as retail; commercial SKUs.


### Step 7 · `sketchup`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-sketchup-needed` |
| **Target (this step)** | `sketchup` |
| **Parent node ID** | `sketchup` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-survey-sketchup) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | SketchUp 3D modeling |
| **Active UI glow target** | `sketchup` |

**Story (customer):** Waiting for a visual they can approve.

**Story (system):** Human modeling; tube cut schedules follow.

**Beam endpoints:**
  - `e-survey-sketchup`: `sales-ca__ca-sketchup-needed` → `sketchup`

### Step 8 · `cut-lists`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sketchup` |
| **Target (this step)** | `cut-lists` |
| **Parent node ID** | `cut-lists` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-sketchup-cutlists) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 4 / 56d E2E |
| **Story card title** | Tube cut schedules & miter angles |
| **Active UI glow target** | `cut-lists` |

**Story (customer):** Invisible — chop saw traveler is being prepared.

**Story (system):** Manual chop saw schedules — no CNC laser nesting.

**Beam endpoints:**
  - `e-sketchup-cutlists`: `sketchup` → `cut-lists`

### Step 9 · `bom-packet`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `cut-lists` |
| **Target (this step)** | `bom-packet` |
| **Parent node ID** | `bom-packet` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-cutlists-bom) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | +2d · CAD/CAM cut files & BOM |
| **Cumulative calendar** | Day 6 / 56d E2E |
| **Story card title** | BOM assembly packet |
| **Active UI glow target** | `bom-packet` |

**Story (customer):** Spec is becoming real SKUs and finishes.

**Story (system):** Shop drawings + frozen SKU list for Produce FO.

**Beam endpoints:**
  - `e-cutlists-bom`: `cut-lists` → `bom-packet`

### Step 10 · `sales-ca · ca-sketchup-done`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `bom-packet` |
| **Target (this step)** | `sales-ca__ca-sketchup-done` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-sketchup-done` |
| **Connection type** | Direct Beam (e-bom-ca) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 6 / 56d E2E |
| **Story card title** | SketchUp complete (CA) |
| **Active UI glow target** | `sales-ca__ca-sketchup-done` |

**Story (customer):** Reviews the 3D / shop intent.

**Story (system):** Packet returns to Solana Beach Sales.

**Beam endpoints:**
  - `e-bom-ca`: `bom-packet` → `sales-ca__ca-sketchup-done`

### Step 11 · `sales-ca · ca-proposal`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-sketchup-done` |
| **Target (this step)** | `sales-ca__ca-proposal` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-proposal` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +7d · SketchUp 3D modeling & proposal |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Proposal given (CA) |
| **Active UI glow target** | `sales-ca__ca-proposal` |

**Story (customer):** Trade/commercial pricing and lead time on the table.

**Story (system):** CRM docs; no factory webhook yet.


### Step 12 · `sales-ca · ca-finalize`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-proposal` |
| **Target (this step)** | `sales-ca__ca-finalize` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-finalize` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Finalize finishes (CA) |
| **Active UI glow target** | `sales-ca__ca-finalize` |

**Story (customer):** Locks spec for the purchase order.

**Story (system):** SKU freeze for Produce FO payload.


### Step 13 · `sales-ca · ca-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-finalize` |
| **Target (this step)** | `sales-ca__ca-produce` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-produce` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3000 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Produce Factory Order (Solana Beach) |
| **Active UI glow target** | `sales-ca__ca-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move — webhook fires after Client Approval.


### Step 14 · `qbo-deposit-link`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-produce` |
| **Target (this step)** | `qbo-deposit-link` |
| **Parent node ID** | `qbo-deposit-link` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ca-produce-deposit-qbo) · Parallel Fan-Out → clover-showroom |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | QBO payment link — 50% deposit |
| **Active UI glow target** | `qbo-deposit-link` |

**Story (customer):** Receives emailed invoice link to pay deposit.

**Story (system):** QuickBooks Online payment link clears into Omnichannel Payment Gateway.

**Beam endpoints:**
  - `e-ca-produce-deposit-qbo`: `sales-ca__ca-produce` → `qbo-deposit-link`

### Step 15 · `payment-gateway`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo-deposit-link` |
| **Target (this step)** | `payment-gateway` |
| **Parent node ID** | `payment-gateway` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-deposit-qbo-gateway, e-deposit-clover-gateway) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Omnichannel payment gateway |
| **Active UI glow target** | `payment-gateway` |

**Story (customer):** Deposit is confirmed — order can release to factory.

**Story (system):** Either QBO link or Clover swipe must clear before 07.S Client Approval.

**Beam endpoints:**
  - `e-deposit-qbo-gateway`: `qbo-deposit-link` → `payment-gateway`
  - `e-deposit-clover-gateway`: `qbo-deposit-link` → `payment-gateway`

### Step 16 · `sales-ca · ca-approval`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `payment-gateway` |
| **Target (this step)** | `sales-ca__ca-approval` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-approval` |
| **Connection type** | Direct Beam (e-gateway-approval-ca) · External Webhook (e-ca-produce, e-produce-ca-ingress → produce-ca, ingress) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Client Approval — sign-off & deposit clearance (CA) |
| **Active UI glow target** | `sales-ca__ca-approval` |

**Story (customer):** Final sign-off before factory webhook releases.

**Story (system):** Deposit cleared + e-sign → Produce + Won webhook → Ingress → Katana MO.

**Beam endpoints:**
  - `e-gateway-approval-ca`: `payment-gateway` → `sales-ca__ca-approval`

### Step 17 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-approval` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Parallel Fan-Out → redis, postgres · External Webhook (e-ingress-redis, e-ingress-pg → redis, postgres) |
| **Dwell (UI animation)** | 2000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Middleware ingress (zero data loss) |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible — reliability layer.

**Story (system):** HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases.


### Step 18 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-pg-inngest) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Inngest CCR (lease + sweeper) |
| **Active UI glow target** | `inngest` |

**Story (customer):** Invisible.

**Story (system):** Fan-out to Katana + GHL Manufacturing mirror under a claim lease.

**Beam endpoints:**
  - `e-pg-inngest`: `ingress` → `inngest`

### Step 19 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inngest` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → mfg-pipe |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.

**Beam endpoints:**
  - `e-inngest-katana`: `inngest` → `katana`
  - `e-inngest-mfg`: `inngest` → `katana`

### Step 20 · `mfg-pipe · mfg-new`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `mfg-pipe__mfg-new` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-new` |
| **Connection type** | Direct Beam (e-katana-mfg-new) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | — |
| **Active UI glow target** | `mfg-pipe__mfg-new` |

_No story card mapped._

**Beam endpoints:**
  - `e-katana-mfg-new`: `katana` → `mfg-pipe__mfg-new`

### Step 21 · `inventory-alloc`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-new` |
| **Target (this step)** | `inventory-alloc` |
| **Parent node ID** | `inventory-alloc` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-katana-alloc) · Parallel Fan-Out → outsourced-accessories, procurement-wait |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Inventory allocation check |
| **Active UI glow target** | `inventory-alloc` |

**Story (customer):** Invisible — materials are being reserved.

**Story (system):** Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement.

**Beam endpoints:**
  - `e-katana-alloc`: `mfg-pipe__mfg-new` → `inventory-alloc`

### Step 22 · `outsourced-accessories`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inventory-alloc` |
| **Target (this step)** | `outsourced-accessories` |
| **Parent node ID** | `outsourced-accessories` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-alloc-outsourced) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 16 / 56d E2E |
| **Story card title** | Outsourced accessories hold |
| **Active UI glow target** | `outsourced-accessories` |

**Story (customer):** Umbrellas and pool chairs wait for in-house frames.

**Story (system):** Bypasses fabrication pods — merges at Component Assembly / Marriage.

**Beam endpoints:**
  - `e-alloc-outsourced`: `inventory-alloc` → `outsourced-accessories`

### Step 23 · `procurement-wait`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `outsourced-accessories` |
| **Target (this step)** | `procurement-wait` |
| **Parent node ID** | `procurement-wait` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-alloc-procure) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | +10d · Purchasing wait / extrusion procurement |
| **Cumulative calendar** | Day 26 / 56d E2E |
| **Story card title** | Procurement wait loop |
| **Active UI glow target** | `procurement-wait` |

**Story (customer):** Lead time buffer while extrusion stock is ordered.

**Story (system):** 10-day SLA buffer · GHL Manufacturing → Purchasing / Receiving sync.

**Beam endpoints:**
  - `e-alloc-procure`: `outsourced-accessories` → `procurement-wait`

### Step 24 · `mfg-pipe · mfg-purchasing`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `procurement-wait` |
| **Target (this step)** | `mfg-pipe__mfg-purchasing` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-purchasing` |
| **Connection type** | Direct Beam (e-procure-mfg-sync) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 26 / 56d E2E |
| **Story card title** | — |
| **Active UI glow target** | `mfg-pipe__mfg-purchasing` |

_No story card mapped._

**Beam endpoints:**
  - `e-procure-mfg-sync`: `procurement-wait` → `mfg-pipe__mfg-purchasing`

### Step 25 · `work-centers · wc-tube-stock`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-purchasing` |
| **Target (this step)** | `work-centers__wc-tube-stock` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-tube-stock` |
| **Connection type** | Direct Beam (e-procure-stock) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 26 / 56d E2E |
| **Story card title** | Tube metal stock & staging |
| **Active UI glow target** | `work-centers__wc-tube-stock` |

**Story (customer):** Marine-grade aluminum extrusion is being kitted.

**Story (system):** Raw extrusion inventory pulled from tube stock racks.

**Beam endpoints:**
  - `e-procure-stock`: `mfg-pipe__mfg-purchasing` → `work-centers__wc-tube-stock`

### Step 26 · `work-centers · wc-chop-saw`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-tube-stock` |
| **Target (this step)** | `work-centers__wc-chop-saw` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-chop-saw` |
| **Connection type** | Direct Beam (e-alloc-chop) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +3d · Chop saw cut & miter station |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Chop saw cut & miter station |
| **Active UI glow target** | `work-centers__wc-chop-saw` |

**Story (customer):** Extrusions are cut to length — no CNC laser or mandrel bending.

**Story (system):** Precision chop saws: straight cuts, angles, miters, deburring.

**Beam endpoints:**
  - `e-alloc-chop`: `work-centers__wc-tube-stock` → `work-centers__wc-chop-saw`

### Step 27 · `work-centers · wc-cart-parts`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-chop-saw` |
| **Target (this step)** | `work-centers__wc-cart-parts` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-cart-parts` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Rolling cart parts staging |
| **Active UI glow target** | `work-centers__wc-cart-parts` |

**Story (customer):** Cut tube profiles are kitted onto mobile carts.

**Story (system):** Cart-based WIP between cut station and fabrication pods.


### Step 28 · `work-centers · wc-tack`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-cart-parts` |
| **Target (this step)** | `work-centers__wc-tack` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-tack` |
| **Connection type** | External Webhook (e-pod-mfg-production → mfg-pipe) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | 4A · Tack welder station |
| **Active UI glow target** | `work-centers__wc-tack` |

**Story (customer):** Frame is jig-clamped and tacked.

**Story (system):** First of three pod stations — tack before full weld-out.


### Step 29 · `mfg-pipe · mfg-production`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-tack` |
| **Target (this step)** | `mfg-pipe__mfg-production` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-production` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Production in progress (mirror pulse) |
| **Active UI glow target** | `mfg-pipe__mfg-production` |

**Story (customer):** Invisible — CRM shows active factory work.

**Story (system):** Katana → GHL Manufacturing sync when frame enters Fabrication Pod.


### Step 30 · `work-centers · wc-weld-out`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-production` |
| **Target (this step)** | `work-centers__wc-weld-out` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-weld-out` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | 4B · Weld out station |
| **Active UI glow target** | `work-centers__wc-weld-out` |

**Story (customer):** Structural bead welding completes the frame.

**Story (system):** Full structural welds; Gate A inspects dimension + weld quality next.


### Step 31 · `work-centers · wc-grinder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-weld-out` |
| **Target (this step)** | `work-centers__wc-grinder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-grinder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | 4C · Grinder station |
| **Active UI glow target** | `work-centers__wc-grinder` |

**Story (customer):** Weld seams are smoothed and prepped.

**Story (system):** Weld seam smoothing before sub-frame marriage.


### Step 32 · `work-centers · wc-marriage`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-grinder` |
| **Target (this step)** | `work-centers__wc-marriage` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-marriage` |
| **Connection type** | Direct Beam (e-outsourced-marriage) · Parallel Fan-Out → outsourced-accessories |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 29 / 56d E2E |
| **Story card title** | Component assembly & marriage |
| **Active UI glow target** | `work-centers__wc-marriage` |

**Story (customer):** Modular sub-frames join into finished builds.

**Story (system):** Marriage of pod outputs before Gate A weld/dim check.

**Beam endpoints:**
  - `e-outsourced-marriage`: `work-centers__wc-grinder` → `work-centers__wc-marriage`

### Step 33 · `qc-gates · qc-a`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-marriage` |
| **Target (this step)** | `qc-gates__qc-a` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-a` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | +5d · Fabrication pod weld-out (Gate A) |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Gate A — weld / dimension |
| **Active UI glow target** | `qc-gates__qc-a` |

**Story (customer):** Quality is being proven before coating.

**Story (system):** Fail → NCR freeze + remake at weld. Pass → blast/powder.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 34 · `work-centers · wc-cart-blast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-a` |
| **Target (this step)** | `work-centers__wc-cart-blast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-cart-blast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Rolling cart staging to sandblast |
| **Active UI glow target** | `work-centers__wc-cart-blast` |

**Story (customer):** Completed build rolled to surface prep.

**Story (system):** Cart WIP between marriage and sandblast bay.


### Step 35 · `work-centers · wc-sandblast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-cart-blast` |
| **Target (this step)** | `work-centers__wc-sandblast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-sandblast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Surface prep & sandblaster |
| **Active UI glow target** | `work-centers__wc-sandblast` |

**Story (customer):** Frame is media-blasted for coating adhesion.

**Story (system):** Prep quality drives Gate B adhesion later.


### Step 36 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-sandblast` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 34 / 56d E2E |
| **Story card title** | Powder coat & curing oven |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Frame finish is being applied and cured.

**Story (system):** Shop floor station; QC Gate B follows adhesion/DFT checks.


### Step 37 · `qc-gates · qc-b`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `qc-gates__qc-b` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-b` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | +5d · Sandblast & powder coat (Gate B) |
| **Cumulative calendar** | Day 39 / 56d E2E |
| **Story card title** | Gate B — DFT / adhesion |
| **Active UI glow target** | `qc-gates__qc-b` |

**Story (customer):** Finish quality is locked.

**Story (system):** Coating thickness + adhesion; fail returns to finishing.


### Step 38 · `work-centers · wc-upholstery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-b` |
| **Target (this step)** | `work-centers__wc-upholstery` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-upholstery` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +4d · Custom upholstery & cushion sewing |
| **Cumulative calendar** | Day 43 / 56d E2E |
| **Story card title** | Custom upholstery & cushion sewing |
| **Active UI glow target** | `work-centers__wc-upholstery` |

**Story (customer):** Cushions and covers are being made to spec.

**Story (system):** Parallel to metal once frames pass Gate B.


### Step 39 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-upholstery` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 43 / 56d E2E |
| **Story card title** | Final assembly, glides & hardware |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Pieces become the finished suite.

**Story (system):** Traveler complete before Gate C photo log.


### Step 40 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +3d · Final assembly & pre-pack (Gate C) |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | Gate C — pre-pack photo log |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Quality locked before shipping.

**Story (system):** 360° photos can attach to GHL; NCR freezes remakes if fail.


### Step 41 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | Ready for Delivery (mirror) |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Product is waiting on a scheduled route.

**Story (system):** GHL Manufacturing mirrors Katana — not the system of record.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 42 · `dispatch-routes · dispatch-box`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-ready` |
| **Target (this step)** | `dispatch-routes__dispatch-box` |
| **Parent node ID** | `dispatch-routes` |
| **Sub-button / stage ID** | `dispatch-box` |
| **Connection type** | Direct Beam (e-mfg-dispatch-box) · Parallel Fan-Out → dispatch-routes |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | CCPatio box truck (< 500 mi) |
| **Active UI glow target** | `dispatch-routes__dispatch-box` |

**Story (customer):** Local white-glove delivery scheduled.

**Story (system):** In-house box truck route · Samsara / Onfleet.

**Beam endpoints:**
  - `e-mfg-dispatch-box`: `mfg-pipe__mfg-ready` → `dispatch-routes__dispatch-box`

### Step 43 · `dispatch-routes · dispatch-3pl`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `dispatch-routes__dispatch-box` |
| **Target (this step)** | `dispatch-routes__dispatch-3pl` |
| **Parent node ID** | `dispatch-routes` |
| **Sub-button / stage ID** | `dispatch-3pl` |
| **Connection type** | Direct Beam (e-mfg-dispatch-box-3pl) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | 3PL freight dispatch (> 500 mi) |
| **Active UI glow target** | `dispatch-routes__dispatch-3pl` |

**Story (customer):** National freight carrier scheduled.

**Story (system):** Third-party freight · same delivery + invoice path.

**Beam endpoints:**
  - `e-mfg-dispatch-box-3pl`: `dispatch-routes__dispatch-box` → `dispatch-routes__dispatch-3pl`

### Step 44 · `dispatch-routes · dispatch-willcall`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `dispatch-routes__dispatch-3pl` |
| **Target (this step)** | `dispatch-routes__dispatch-willcall` |
| **Parent node ID** | `dispatch-routes` |
| **Sub-button / stage ID** | `dispatch-willcall` |
| **Connection type** | Direct Beam (e-mfg-dispatch-box-willcall) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 46 / 56d E2E |
| **Story card title** | Customer will-call / pickup |
| **Active UI glow target** | `dispatch-routes__dispatch-willcall` |

**Story (customer):** Picks up finished goods at factory.

**Story (system):** Will-call route · still flows through QBO invoice + ledger reconciled.

**Beam endpoints:**
  - `e-mfg-dispatch-box-willcall`: `dispatch-routes__dispatch-3pl` → `dispatch-routes__dispatch-willcall`

### Step 45 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `dispatch-routes__dispatch-willcall` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-dispatch-box-delivery, e-dispatch-3pl-delivery, e-dispatch-willcall-delivery) · External Webhook (e-delivery-qbo → qbo) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 51 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).

**Beam endpoints:**
  - `e-dispatch-box-delivery`: `dispatch-routes__dispatch-box` → `delivery`
  - `e-dispatch-3pl-delivery`: `dispatch-routes__dispatch-3pl` → `delivery`
  - `e-dispatch-willcall-delivery`: `dispatch-routes__dispatch-willcall` → `delivery`

### Step 46 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 51 / 56d E2E |
| **Story card title** | Financial clearance — QBO invoice |
| **Active UI glow target** | `qbo` |

**Story (customer):** Receives formal invoice / remaining balance path.

**Story (system):** OAuth mutex; inv_${opportunity_id}; never blocked by Clover miss.


### Step 47 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 51 / 56d E2E |
| **Story card title** | Clover POS fuzzy match |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit already paid at POS or link.

**Story (system):** Match by amount/window/location; unmatched → DLQ, invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `qbo` → `clover`

### Step 48 · `reconciled`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `reconciled` |
| **Parent node ID** | `reconciled` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-clover-ok) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +2d · QBO/Clover financial reconciliation |
| **Cumulative calendar** | Day 53 / 56d E2E |
| **Story card title** | Ledger reconciled |
| **Active UI glow target** | `reconciled` |

**Story (customer):** Books match cash — 56-day E2E SLA complete.

**Story (system):** Happy-path close after Clover match (or manual recon).

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `reconciled`

### Step 49 · `sales-ca · ca-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `reconciled` |
| **Target (this step)** | `sales-ca__ca-delivered` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-delivered` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 53 / 56d E2E |
| **Story card title** | Sales CA → Delivered |
| **Active UI glow target** | `sales-ca__ca-delivered` |

**Story (customer):** Project is closed in the selling pipeline.

**Story (system):** Stage move after Katana Delivered + QBO.


### Step 50 · `postcare`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-delivered` |
| **Target (this step)** | `postcare` |
| **Parent node ID** | `postcare` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ok-postcare) |
| **Dwell (UI animation)** | 3000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 53 / 56d E2E |
| **Story card title** | Post-care & warranty registry |
| **Active UI glow target** | `postcare` |

**Story (customer):** SMS passport, NPS, care guide, seasonal follow-ups.

**Story (system):** GHL sequences; warranty linked to serial number.

**Beam endpoints:**
  - `e-ok-postcare`: `sales-ca__ca-delivered` → `postcare`

---

## B2B Trade · Solana Beach CA (Board Brief)

- **Playlist ID:** `retail-ca-board`
- **Journey key:** `trade`
- **Mode:** board
- **Total steps:** 12

### Step 1 · `chan-phone`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `chan-phone` |
| **Parent node ID** | `chan-phone` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Inbound call (Trade / Commercial) |
| **Active UI glow target** | `chan-phone` |

**Story (customer):** Designer or developer calls to open an account or project.

**Story (system):** Twilio/GHL call route → Unified Inbox → Trade pipeline.


### Step 2 · `ghl-hub`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `chan-phone` |
| **Target (this step)** | `ghl-hub` |
| **Parent node ID** | `ghl-hub` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-phone-hub) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | GHL Unified Inbox (the router) |
| **Active UI glow target** | `ghl-hub` |

**Story (customer):** Doesn’t see this — internal brain of intake.

**Story (system):** Tags (retail_az, commercial, warranty) and spawns the card.

**Beam endpoints:**
  - `e-phone-hub`: `chan-phone` → `ghl-hub`

### Step 3 · `trade-pipe · trade-approved`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ghl-hub` |
| **Target (this step)** | `trade-pipe__trade-approved` |
| **Parent node ID** | `trade-pipe` |
| **Sub-button / stage ID** | `trade-approved` |
| **Connection type** | Direct Beam (e-hub-trade) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Trade account approved |
| **Active UI glow target** | `trade-pipe__trade-approved` |

**Story (customer):** Can now specify CCPatio on commercial projects.

**Story (system):** Commercial tag + Solana Beach Sales swimlane.

**Beam endpoints:**
  - `e-hub-trade`: `ghl-hub` → `trade-pipe__trade-app`

### Step 4 · `sales-ca · ca-sketchup-needed`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `trade-pipe__trade-approved` |
| **Target (this step)** | `sales-ca__ca-sketchup-needed` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-sketchup-needed` |
| **Connection type** | Direct Beam (e-trade-ca) · External Webhook (e-ca-survey, e-survey-sketchup → field-survey, sketchup) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Design bridge — SketchUp needed (CA) |
| **Active UI glow target** | `sales-ca__ca-sketchup-needed` |

**Story (customer):** Waiting on drawings that match the job site.

**Story (system):** Same CAD/CAM path as retail; commercial SKUs.

**Beam endpoints:**
  - `e-trade-ca`: `trade-pipe__trade-approved` → `sales-ca__ca-onsite`

### Step 5 · `sales-ca · ca-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-sketchup-needed` |
| **Target (this step)** | `sales-ca__ca-produce` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-produce` |
| **Connection type** | Direct Beam (e-bom-ca) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Produce Factory Order (Solana Beach) |
| **Active UI glow target** | `sales-ca__ca-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move — webhook fires after Client Approval.

**Beam endpoints:**
  - `e-bom-ca`: `sales-ca__ca-sketchup-needed` → `sales-ca__ca-sketchup-done`

### Step 6 · `payment-gateway`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-produce` |
| **Target (this step)** | `payment-gateway` |
| **Parent node ID** | `payment-gateway` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-deposit-qbo-gateway) · Parallel Fan-Out → clover-showroom |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Omnichannel payment gateway |
| **Active UI glow target** | `payment-gateway` |

**Story (customer):** Deposit is confirmed — order can release to factory.

**Story (system):** Either QBO link or Clover swipe must clear before 07.S Client Approval.

**Beam endpoints:**
  - `e-deposit-qbo-gateway`: `sales-ca__ca-produce` → `payment-gateway`

### Step 7 · `sales-ca · ca-approval`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `payment-gateway` |
| **Target (this step)** | `sales-ca__ca-approval` |
| **Parent node ID** | `sales-ca` |
| **Sub-button / stage ID** | `ca-approval` |
| **Connection type** | Direct Beam (e-gateway-approval-ca) · External Webhook (e-ca-produce, e-produce-ca-ingress → produce-ca, ingress) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Client Approval — sign-off & deposit clearance (CA) |
| **Active UI glow target** | `sales-ca__ca-approval` |

**Story (customer):** Final sign-off before factory webhook releases.

**Story (system):** Deposit cleared + e-sign → Produce + Won webhook → Ingress → Katana MO.

**Beam endpoints:**
  - `e-gateway-approval-ca`: `payment-gateway` → `sales-ca__ca-approval`

### Step 8 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-ca__ca-approval` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-pg, e-pg-inngest, e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → work-centers, mfg-pipe |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.

**Beam endpoints:**
  - `e-ingress-pg`: `sales-ca__ca-approval` → `katana`
  - `e-pg-inngest`: `sales-ca__ca-approval` → `katana`
  - `e-inngest-katana`: `sales-ca__ca-approval` → `katana`
  - `e-inngest-mfg`: `sales-ca__ca-approval` → `katana`

### Step 9 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-wc-qc, e-qc-mfg, e-mfg-dispatch-box, e-dispatch-box-delivery) · External Webhook (e-delivery-qbo → qbo) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 8 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`
  - `e-mfg-dispatch-box`: `mfg-pipe__mfg-ready` → `dispatch-routes__dispatch-box`
  - `e-dispatch-box-delivery`: `dispatch-routes__dispatch-box` → `delivery`

### Step 10 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 8 / 56d E2E |
| **Story card title** | Clover POS fuzzy match |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit already paid at POS or link.

**Story (system):** Match by amount/window/location; unmatched → DLQ, invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `delivery` → `clover`

### Step 11 · `reconciled`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `reconciled` |
| **Parent node ID** | `reconciled` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-clover-ok) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +2d · QBO/Clover financial reconciliation |
| **Cumulative calendar** | Day 10 / 56d E2E |
| **Story card title** | Ledger reconciled |
| **Active UI glow target** | `reconciled` |

**Story (customer):** Books match cash — 56-day E2E SLA complete.

**Story (system):** Happy-path close after Clover match (or manual recon).

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `reconciled`

### Step 12 · `postcare`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `reconciled` |
| **Target (this step)** | `postcare` |
| **Parent node ID** | `postcare` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ok-postcare) · Parallel Fan-Out → sales-ca |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 10 / 56d E2E |
| **Story card title** | Post-care & warranty registry |
| **Active UI glow target** | `postcare` |

**Story (customer):** SMS passport, NPS, care guide, seasonal follow-ups.

**Story (system):** GHL sequences; warranty linked to serial number.

**Beam endpoints:**
  - `e-ok-postcare`: `reconciled` → `postcare`

---

## Warranty Claims (Full Map)

- **Playlist ID:** `warranty-full`
- **Journey key:** `warranty`
- **Mode:** full
- **Total steps:** 32

### Step 1 · `chan-whatsapp`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `chan-whatsapp` |
| **Parent node ID** | `chan-whatsapp` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 1800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | WhatsApp service thread |
| **Active UI glow target** | `chan-whatsapp` |

**Story (customer):** Sends photos of damage or a serial-number question.

**Story (system):** WhatsApp Business → GHL inbox → Warranty pipeline.


### Step 2 · `ghl-hub`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `chan-whatsapp` |
| **Target (this step)** | `ghl-hub` |
| **Parent node ID** | `ghl-hub` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-wa-hub) |
| **Dwell (UI animation)** | 2500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | GHL Unified Inbox (the router) |
| **Active UI glow target** | `ghl-hub` |

**Story (customer):** Doesn’t see this — internal brain of intake.

**Story (system):** Tags (retail_az, commercial, warranty) and spawns the card.

**Beam endpoints:**
  - `e-wa-hub`: `chan-whatsapp` → `ghl-hub`

### Step 3 · `warranty-pipe · warranty-discovery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ghl-hub` |
| **Target (this step)** | `warranty-pipe__warranty-discovery` |
| **Parent node ID** | `warranty-pipe` |
| **Sub-button / stage ID** | `warranty-discovery` |
| **Connection type** | Direct Beam (e-hub-warranty) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Warranty discovery |
| **Active UI glow target** | `warranty-pipe__warranty-discovery` |

**Story (customer):** Photos and serial are being reviewed.

**Story (system):** Claim card; no factory until Produce FO.

**Beam endpoints:**
  - `e-hub-warranty`: `ghl-hub` → `warranty-pipe__warranty-discovery`

### Step 4 · `warranty-pipe · warranty-approved`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `warranty-pipe__warranty-discovery` |
| **Target (this step)** | `warranty-pipe__warranty-approved` |
| **Parent node ID** | `warranty-pipe` |
| **Sub-button / stage ID** | `warranty-approved` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Claim approved — selecting colors |
| **Active UI glow target** | `warranty-pipe__warranty-approved` |

**Story (customer):** Picks finish/fabric for the remake.

**Story (system):** Still CRM; Produce FO is the automation gate.


### Step 5 · `warranty-pipe · warranty-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `warranty-pipe__warranty-approved` |
| **Target (this step)** | `warranty-pipe__warranty-produce` |
| **Parent node ID** | `warranty-pipe` |
| **Sub-button / stage ID** | `warranty-produce` |
| **Connection type** | External Webhook (e-warranty-produce, e-produce-wr-ingress → produce-warranty, ingress) |
| **Dwell (UI animation)** | 3000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Warranty Produce FO |
| **Active UI glow target** | `warranty-pipe__warranty-produce` |

**Story (customer):** Approved claim moving to remake/repair.

**Story (system):** Skips sales design loop; middleware → factory; often skips QBO.


### Step 6 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `warranty-pipe__warranty-produce` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Parallel Fan-Out → redis, postgres · External Webhook (e-ingress-redis, e-ingress-pg → redis, postgres) |
| **Dwell (UI animation)** | 2000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Middleware ingress (zero data loss) |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible — reliability layer.

**Story (system):** HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases.


### Step 7 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-pg-inngest) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Inngest CCR (lease + sweeper) |
| **Active UI glow target** | `inngest` |

**Story (customer):** Invisible.

**Story (system):** Fan-out to Katana + GHL Manufacturing mirror under a claim lease.

**Beam endpoints:**
  - `e-pg-inngest`: `ingress` → `inngest`

### Step 8 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inngest` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → mfg-pipe |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.

**Beam endpoints:**
  - `e-inngest-katana`: `inngest` → `katana`
  - `e-inngest-mfg`: `inngest` → `katana`

### Step 9 · `mfg-pipe · mfg-new`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `mfg-pipe__mfg-new` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-new` |
| **Connection type** | Direct Beam (e-katana-mfg-new) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | — |
| **Active UI glow target** | `mfg-pipe__mfg-new` |

_No story card mapped._

**Beam endpoints:**
  - `e-katana-mfg-new`: `katana` → `mfg-pipe__mfg-new`

### Step 10 · `inventory-alloc`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-new` |
| **Target (this step)** | `inventory-alloc` |
| **Parent node ID** | `inventory-alloc` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-katana-alloc) · Parallel Fan-Out → outsourced-accessories, procurement-wait |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Inventory allocation check |
| **Active UI glow target** | `inventory-alloc` |

**Story (customer):** Invisible — materials are being reserved.

**Story (system):** Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement.

**Beam endpoints:**
  - `e-katana-alloc`: `mfg-pipe__mfg-new` → `inventory-alloc`

### Step 11 · `outsourced-accessories`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inventory-alloc` |
| **Target (this step)** | `outsourced-accessories` |
| **Parent node ID** | `outsourced-accessories` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-alloc-outsourced) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Outsourced accessories hold |
| **Active UI glow target** | `outsourced-accessories` |

**Story (customer):** Umbrellas and pool chairs wait for in-house frames.

**Story (system):** Bypasses fabrication pods — merges at Component Assembly / Marriage.

**Beam endpoints:**
  - `e-alloc-outsourced`: `inventory-alloc` → `outsourced-accessories`

### Step 12 · `procurement-wait`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `outsourced-accessories` |
| **Target (this step)** | `procurement-wait` |
| **Parent node ID** | `procurement-wait` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-alloc-procure) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | +10d · Purchasing wait / extrusion procurement |
| **Cumulative calendar** | Day 10 / 56d E2E |
| **Story card title** | Procurement wait loop |
| **Active UI glow target** | `procurement-wait` |

**Story (customer):** Lead time buffer while extrusion stock is ordered.

**Story (system):** 10-day SLA buffer · GHL Manufacturing → Purchasing / Receiving sync.

**Beam endpoints:**
  - `e-alloc-procure`: `outsourced-accessories` → `procurement-wait`

### Step 13 · `mfg-pipe · mfg-purchasing`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `procurement-wait` |
| **Target (this step)** | `mfg-pipe__mfg-purchasing` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-purchasing` |
| **Connection type** | Direct Beam (e-procure-mfg-sync) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 10 / 56d E2E |
| **Story card title** | — |
| **Active UI glow target** | `mfg-pipe__mfg-purchasing` |

_No story card mapped._

**Beam endpoints:**
  - `e-procure-mfg-sync`: `procurement-wait` → `mfg-pipe__mfg-purchasing`

### Step 14 · `work-centers · wc-tube-stock`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-purchasing` |
| **Target (this step)** | `work-centers__wc-tube-stock` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-tube-stock` |
| **Connection type** | Direct Beam (e-procure-stock) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 10 / 56d E2E |
| **Story card title** | Tube metal stock & staging |
| **Active UI glow target** | `work-centers__wc-tube-stock` |

**Story (customer):** Marine-grade aluminum extrusion is being kitted.

**Story (system):** Raw extrusion inventory pulled from tube stock racks.

**Beam endpoints:**
  - `e-procure-stock`: `mfg-pipe__mfg-purchasing` → `work-centers__wc-tube-stock`

### Step 15 · `work-centers · wc-chop-saw`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-tube-stock` |
| **Target (this step)** | `work-centers__wc-chop-saw` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-chop-saw` |
| **Connection type** | Direct Beam (e-alloc-chop) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +3d · Chop saw cut & miter station |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Chop saw cut & miter station |
| **Active UI glow target** | `work-centers__wc-chop-saw` |

**Story (customer):** Extrusions are cut to length — no CNC laser or mandrel bending.

**Story (system):** Precision chop saws: straight cuts, angles, miters, deburring.

**Beam endpoints:**
  - `e-alloc-chop`: `work-centers__wc-tube-stock` → `work-centers__wc-chop-saw`

### Step 16 · `work-centers · wc-cart-parts`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-chop-saw` |
| **Target (this step)** | `work-centers__wc-cart-parts` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-cart-parts` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Rolling cart parts staging |
| **Active UI glow target** | `work-centers__wc-cart-parts` |

**Story (customer):** Cut tube profiles are kitted onto mobile carts.

**Story (system):** Cart-based WIP between cut station and fabrication pods.


### Step 17 · `work-centers · wc-tack`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-cart-parts` |
| **Target (this step)** | `work-centers__wc-tack` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-tack` |
| **Connection type** | External Webhook (e-pod-mfg-production → mfg-pipe) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | 4A · Tack welder station |
| **Active UI glow target** | `work-centers__wc-tack` |

**Story (customer):** Frame is jig-clamped and tacked.

**Story (system):** First of three pod stations — tack before full weld-out.


### Step 18 · `mfg-pipe · mfg-production`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-tack` |
| **Target (this step)** | `mfg-pipe__mfg-production` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-production` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Production in progress (mirror pulse) |
| **Active UI glow target** | `mfg-pipe__mfg-production` |

**Story (customer):** Invisible — CRM shows active factory work.

**Story (system):** Katana → GHL Manufacturing sync when frame enters Fabrication Pod.


### Step 19 · `work-centers · wc-weld-out`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-production` |
| **Target (this step)** | `work-centers__wc-weld-out` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-weld-out` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | 4B · Weld out station |
| **Active UI glow target** | `work-centers__wc-weld-out` |

**Story (customer):** Structural bead welding completes the frame.

**Story (system):** Full structural welds; Gate A inspects dimension + weld quality next.


### Step 20 · `work-centers · wc-grinder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-weld-out` |
| **Target (this step)** | `work-centers__wc-grinder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-grinder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | 4C · Grinder station |
| **Active UI glow target** | `work-centers__wc-grinder` |

**Story (customer):** Weld seams are smoothed and prepped.

**Story (system):** Weld seam smoothing before sub-frame marriage.


### Step 21 · `work-centers · wc-marriage`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-grinder` |
| **Target (this step)** | `work-centers__wc-marriage` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-marriage` |
| **Connection type** | Direct Beam (e-outsourced-marriage) · Parallel Fan-Out → outsourced-accessories |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 13 / 56d E2E |
| **Story card title** | Component assembly & marriage |
| **Active UI glow target** | `work-centers__wc-marriage` |

**Story (customer):** Modular sub-frames join into finished builds.

**Story (system):** Marriage of pod outputs before Gate A weld/dim check.

**Beam endpoints:**
  - `e-outsourced-marriage`: `work-centers__wc-grinder` → `work-centers__wc-marriage`

### Step 22 · `qc-gates · qc-a`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-marriage` |
| **Target (this step)** | `qc-gates__qc-a` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-a` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | +5d · Fabrication pod weld-out (Gate A) |
| **Cumulative calendar** | Day 18 / 56d E2E |
| **Story card title** | Gate A — weld / dimension |
| **Active UI glow target** | `qc-gates__qc-a` |

**Story (customer):** Quality is being proven before coating.

**Story (system):** Fail → NCR freeze + remake at weld. Pass → blast/powder.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 23 · `work-centers · wc-cart-blast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-a` |
| **Target (this step)** | `work-centers__wc-cart-blast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-cart-blast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 18 / 56d E2E |
| **Story card title** | Rolling cart staging to sandblast |
| **Active UI glow target** | `work-centers__wc-cart-blast` |

**Story (customer):** Completed build rolled to surface prep.

**Story (system):** Cart WIP between marriage and sandblast bay.


### Step 24 · `work-centers · wc-sandblast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-cart-blast` |
| **Target (this step)** | `work-centers__wc-sandblast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-sandblast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 18 / 56d E2E |
| **Story card title** | Surface prep & sandblaster |
| **Active UI glow target** | `work-centers__wc-sandblast` |

**Story (customer):** Frame is media-blasted for coating adhesion.

**Story (system):** Prep quality drives Gate B adhesion later.


### Step 25 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-sandblast` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 18 / 56d E2E |
| **Story card title** | Powder coat & curing oven |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Frame finish is being applied and cured.

**Story (system):** Shop floor station; QC Gate B follows adhesion/DFT checks.


### Step 26 · `qc-gates · qc-b`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `qc-gates__qc-b` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-b` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | +5d · Sandblast & powder coat (Gate B) |
| **Cumulative calendar** | Day 23 / 56d E2E |
| **Story card title** | Gate B — DFT / adhesion |
| **Active UI glow target** | `qc-gates__qc-b` |

**Story (customer):** Finish quality is locked.

**Story (system):** Coating thickness + adhesion; fail returns to finishing.


### Step 27 · `work-centers · wc-upholstery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-b` |
| **Target (this step)** | `work-centers__wc-upholstery` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-upholstery` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +4d · Custom upholstery & cushion sewing |
| **Cumulative calendar** | Day 27 / 56d E2E |
| **Story card title** | Custom upholstery & cushion sewing |
| **Active UI glow target** | `work-centers__wc-upholstery` |

**Story (customer):** Cushions and covers are being made to spec.

**Story (system):** Parallel to metal once frames pass Gate B.


### Step 28 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-upholstery` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 27 / 56d E2E |
| **Story card title** | Final assembly, glides & hardware |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Pieces become the finished suite.

**Story (system):** Traveler complete before Gate C photo log.


### Step 29 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2600 ms |
| **SLA delta** | +3d · Final assembly & pre-pack (Gate C) |
| **Cumulative calendar** | Day 30 / 56d E2E |
| **Story card title** | Gate C — pre-pack photo log |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Quality locked before shipping.

**Story (system):** 360° photos can attach to GHL; NCR freezes remakes if fail.


### Step 30 · `dispatch-routes · dispatch-box`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `dispatch-routes__dispatch-box` |
| **Parent node ID** | `dispatch-routes` |
| **Sub-button / stage ID** | `dispatch-box` |
| **Connection type** | Direct Beam (e-mfg-dispatch-box) |
| **Dwell (UI animation)** | 2400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 30 / 56d E2E |
| **Story card title** | CCPatio box truck (< 500 mi) |
| **Active UI glow target** | `dispatch-routes__dispatch-box` |

**Story (customer):** Local white-glove delivery scheduled.

**Story (system):** In-house box truck route · Samsara / Onfleet.

**Beam endpoints:**
  - `e-mfg-dispatch-box`: `mfg-pipe__mfg-ready` → `dispatch-routes__dispatch-box`

### Step 31 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `dispatch-routes__dispatch-box` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-dispatch-box-delivery) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 35 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).

**Beam endpoints:**
  - `e-dispatch-box-delivery`: `dispatch-routes__dispatch-box` → `delivery`

### Step 32 · `warranty-pipe · warranty-closed`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `warranty-pipe__warranty-closed` |
| **Parent node ID** | `warranty-pipe` |
| **Sub-button / stage ID** | `warranty-closed` |
| **Connection type** | Direct Beam (e-delivery-postcare) · Parallel Fan-Out → postcare, reconciled |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 35 / 56d E2E |
| **Story card title** | Claim closed |
| **Active UI glow target** | `warranty-pipe__warranty-closed` |

**Story (customer):** Replacement delivered; claim is done.

**Story (system):** Warranty pipeline terminal; post-care may still fire.

**Beam endpoints:**
  - `e-delivery-postcare`: `warranty-pipe__warranty-closed` → `warranty-pipe__warranty-closed`

---

## Warranty Claims (Board Brief)

- **Playlist ID:** `warranty-board`
- **Journey key:** `warranty`
- **Mode:** board
- **Total steps:** 8

### Step 1 · `chan-whatsapp`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `chan-whatsapp` |
| **Parent node ID** | `chan-whatsapp` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | WhatsApp service thread |
| **Active UI glow target** | `chan-whatsapp` |

**Story (customer):** Sends photos of damage or a serial-number question.

**Story (system):** WhatsApp Business → GHL inbox → Warranty pipeline.


### Step 2 · `ghl-hub`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `chan-whatsapp` |
| **Target (this step)** | `ghl-hub` |
| **Parent node ID** | `ghl-hub` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-wa-hub) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | GHL Unified Inbox (the router) |
| **Active UI glow target** | `ghl-hub` |

**Story (customer):** Doesn’t see this — internal brain of intake.

**Story (system):** Tags (retail_az, commercial, warranty) and spawns the card.

**Beam endpoints:**
  - `e-wa-hub`: `chan-whatsapp` → `ghl-hub`

### Step 3 · `warranty-pipe · warranty-approved`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ghl-hub` |
| **Target (this step)** | `warranty-pipe__warranty-approved` |
| **Parent node ID** | `warranty-pipe` |
| **Sub-button / stage ID** | `warranty-approved` |
| **Connection type** | Direct Beam (e-hub-warranty) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Claim approved — selecting colors |
| **Active UI glow target** | `warranty-pipe__warranty-approved` |

**Story (customer):** Picks finish/fabric for the remake.

**Story (system):** Still CRM; Produce FO is the automation gate.

**Beam endpoints:**
  - `e-hub-warranty`: `ghl-hub` → `warranty-pipe__warranty-discovery`

### Step 4 · `warranty-pipe · warranty-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `warranty-pipe__warranty-approved` |
| **Target (this step)** | `warranty-pipe__warranty-produce` |
| **Parent node ID** | `warranty-pipe` |
| **Sub-button / stage ID** | `warranty-produce` |
| **Connection type** | External Webhook (e-warranty-produce, e-produce-wr-ingress → produce-warranty, ingress) |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Warranty Produce FO |
| **Active UI glow target** | `warranty-pipe__warranty-produce` |

**Story (customer):** Approved claim moving to remake/repair.

**Story (system):** Skips sales design loop; middleware → factory; often skips QBO.


### Step 5 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `warranty-pipe__warranty-produce` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-pg, e-pg-inngest, e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → work-centers, mfg-pipe |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.

**Beam endpoints:**
  - `e-ingress-pg`: `warranty-pipe__warranty-produce` → `katana`
  - `e-pg-inngest`: `warranty-pipe__warranty-produce` → `katana`
  - `e-inngest-katana`: `warranty-pipe__warranty-produce` → `katana`
  - `e-inngest-mfg`: `warranty-pipe__warranty-produce` → `katana`

### Step 6 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +3d · Final assembly & pre-pack (Gate C) |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Gate C — pre-pack photo log |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Quality locked before shipping.

**Story (system):** 360° photos can attach to GHL; NCR freezes remakes if fail.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 7 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qc-mfg, e-mfg-dispatch-box, e-dispatch-box-delivery) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 8 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`
  - `e-mfg-dispatch-box`: `mfg-pipe__mfg-ready` → `dispatch-routes__dispatch-box`
  - `e-dispatch-box-delivery`: `dispatch-routes__dispatch-box` → `delivery`

### Step 8 · `warranty-pipe · warranty-closed`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `warranty-pipe__warranty-closed` |
| **Parent node ID** | `warranty-pipe` |
| **Sub-button / stage ID** | `warranty-closed` |
| **Connection type** | Direct Beam (e-delivery-postcare) · Parallel Fan-Out → postcare |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 8 / 56d E2E |
| **Story card title** | Claim closed |
| **Active UI glow target** | `warranty-pipe__warranty-closed` |

**Story (customer):** Replacement delivered; claim is done.

**Story (system):** Warranty pipeline terminal; post-care may still fire.

**Beam endpoints:**
  - `e-delivery-postcare`: `warranty-pipe__warranty-closed` → `warranty-pipe__warranty-closed`

---

## Exception · NCR Fail (Rose) (Full Map)

- **Playlist ID:** `ncr-full`
- **Journey key:** `ncr`
- **Mode:** full
- **Total steps:** 9

### Step 1 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.


### Step 2 · `inventory-alloc`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `inventory-alloc` |
| **Parent node ID** | `inventory-alloc` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-katana-alloc) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Inventory allocation check |
| **Active UI glow target** | `inventory-alloc` |

**Story (customer):** Invisible — materials are being reserved.

**Story (system):** Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement.

**Beam endpoints:**
  - `e-katana-alloc`: `katana` → `inventory-alloc`

### Step 3 · `work-centers · wc-weld-out`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inventory-alloc` |
| **Target (this step)** | `work-centers__wc-weld-out` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-weld-out` |
| **Connection type** | Direct Beam (e-alloc-chop) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | 4B · Weld out station |
| **Active UI glow target** | `work-centers__wc-weld-out` |

**Story (customer):** Structural bead welding completes the frame.

**Story (system):** Full structural welds; Gate A inspects dimension + weld quality next.

**Beam endpoints:**
  - `e-alloc-chop`: `inventory-alloc` → `work-centers__wc-chop-saw`

### Step 4 · `qc-gates · qc-a`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-weld-out` |
| **Target (this step)** | `qc-gates__qc-a` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-a` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | NCR — Gate A fail |
| **Active UI glow target** | `qc-gates__qc-a` |

**Story (customer):** Doesn’t hear this yet — quality stopped the traveler.

**Story (system):** Weld/dim fail freezes the MO; no powder until remake passes.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 5 · `mfg-pipe · mfg-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-a` |
| **Target (this step)** | `mfg-pipe__mfg-delivered` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-delivered` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Manufacturing mirror — Rejected |
| **Active UI glow target** | `mfg-pipe__mfg-delivered` |

**Story (customer):** Lead time may slip; service/sales get the truth from Ops.

**Story (system):** GHL mirror of Katana reject — Katana remains physical truth.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 6 · `work-centers · wc-weld-out`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-delivered` |
| **Target (this step)** | `work-centers__wc-weld-out` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-weld-out` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | +3d SLA penalty |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Rework at weld |
| **Active UI glow target** | `work-centers__wc-weld-out` |

**Story (customer):** Waiting on a corrected frame.

**Story (system):** Same work center; traveler does not skip Gate A.


### Step 7 · `qc-gates · qc-a`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-weld-out` |
| **Target (this step)** | `qc-gates__qc-a` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-a` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Gate A pass after remake |
| **Active UI glow target** | `qc-gates__qc-a` |

**Story (customer):** Quality is back on the happy path.

**Story (system):** NCR closed at this gate; coating may proceed.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 8 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-a` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Powder coat & curing oven |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Frame finish is being applied and cured.

**Story (system):** Shop floor station; QC Gate B follows adhesion/DFT checks.


### Step 9 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | NCR cleared — Ready for Delivery |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Order can be scheduled again.

**Story (system):** Mirror returns to Ready; logistics picks up.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

---

## Exception · NCR Fail (Rose) (Board Brief)

- **Playlist ID:** `ncr-board`
- **Journey key:** `ncr`
- **Mode:** board
- **Total steps:** 9

### Step 1 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Katana = physical truth |
| **Active UI glow target** | `katana` |

**Story (customer):** Order is now a manufacturing job.

**Story (system):** MO created with Idempotency-Key; GHL Manufacturing only mirrors.


### Step 2 · `inventory-alloc`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `inventory-alloc` |
| **Parent node ID** | `inventory-alloc` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-katana-alloc) |
| **Dwell (UI animation)** | 2800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Inventory allocation check |
| **Active UI glow target** | `inventory-alloc` |

**Story (customer):** Invisible — materials are being reserved.

**Story (system):** Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement.

**Beam endpoints:**
  - `e-katana-alloc`: `katana` → `inventory-alloc`

### Step 3 · `work-centers · wc-weld-out`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inventory-alloc` |
| **Target (this step)** | `work-centers__wc-weld-out` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-weld-out` |
| **Connection type** | Direct Beam (e-alloc-chop) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | 4B · Weld out station |
| **Active UI glow target** | `work-centers__wc-weld-out` |

**Story (customer):** Structural bead welding completes the frame.

**Story (system):** Full structural welds; Gate A inspects dimension + weld quality next.

**Beam endpoints:**
  - `e-alloc-chop`: `inventory-alloc` → `work-centers__wc-chop-saw`

### Step 4 · `qc-gates · qc-a`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-weld-out` |
| **Target (this step)** | `qc-gates__qc-a` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-a` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | NCR — Gate A fail |
| **Active UI glow target** | `qc-gates__qc-a` |

**Story (customer):** Doesn’t hear this yet — quality stopped the traveler.

**Story (system):** Weld/dim fail freezes the MO; no powder until remake passes.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 5 · `mfg-pipe · mfg-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-a` |
| **Target (this step)** | `mfg-pipe__mfg-delivered` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-delivered` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Manufacturing mirror — Rejected |
| **Active UI glow target** | `mfg-pipe__mfg-delivered` |

**Story (customer):** Lead time may slip; service/sales get the truth from Ops.

**Story (system):** GHL mirror of Katana reject — Katana remains physical truth.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 6 · `work-centers · wc-weld-out`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-delivered` |
| **Target (this step)** | `work-centers__wc-weld-out` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-weld-out` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | +3d SLA penalty |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Rework at weld |
| **Active UI glow target** | `work-centers__wc-weld-out` |

**Story (customer):** Waiting on a corrected frame.

**Story (system):** Same work center; traveler does not skip Gate A.


### Step 7 · `qc-gates · qc-a`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-weld-out` |
| **Target (this step)** | `qc-gates__qc-a` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-a` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Gate A pass after remake |
| **Active UI glow target** | `qc-gates__qc-a` |

**Story (customer):** Quality is back on the happy path.

**Story (system):** NCR closed at this gate; coating may proceed.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 8 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-a` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Powder coat & curing oven |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Frame finish is being applied and cured.

**Story (system):** Shop floor station; QC Gate B follows adhesion/DFT checks.


### Step 9 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | NCR cleared — Ready for Delivery |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Order can be scheduled again.

**Story (system):** Mirror returns to Ready; logistics picks up.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

---

## Exception · Clover Miss (Rose) (Full Map)

- **Playlist ID:** `clover-miss-full`
- **Journey key:** `clover-miss`
- **Mode:** full
- **Total steps:** 5

### Step 1 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).


### Step 2 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-delivery-qbo) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | QBO invoice still posts |
| **Active UI glow target** | `qbo` |

**Story (customer):** Will receive the invoice even if POS match is pending.

**Story (system):** V8 rule: Clover never blocks inv_${opportunity_id}.

**Beam endpoints:**
  - `e-delivery-qbo`: `delivery` → `qbo`

### Step 3 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 4800 ms |
| **SLA delta** | +2d SLA penalty |
| **Cumulative calendar** | Day 7–10 / 56d E2E |
| **Story card title** | Clover miss → DLQ |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit exists somewhere; books need a human match.

**Story (system):** Fuzzy match failed (amount/window/location). Unmatched job → DLQ. Invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `qbo` → `clover`

### Step 4 · `sales-az · az-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `sales-az__az-delivered` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-delivered` |
| **Connection type** | Direct Beam (e-clover-ok) · Parallel Fan-Out → reconciled |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 7–10 / 56d E2E |
| **Story card title** | CRM Delivered despite unmatched POS |
| **Active UI glow target** | `sales-az__az-delivered` |

**Story (customer):** Order is complete; finance recon is a back-office loop.

**Story (system):** Happy-path customer stage is not held hostage by Clover.

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `sales-az__az-delivered`

### Step 5 · `postcare`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-delivered` |
| **Target (this step)** | `postcare` |
| **Parent node ID** | `postcare` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ok-postcare) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 7–10 / 56d E2E |
| **Story card title** | Post-care still starts |
| **Active UI glow target** | `postcare` |

**Story (customer):** Care SMS / NPS should not wait on POS matching.

**Story (system):** Post-care is customer lifecycle, not treasury close.

**Beam endpoints:**
  - `e-ok-postcare`: `sales-az__az-delivered` → `postcare`

---

## Exception · Clover Miss (Rose) (Board Brief)

- **Playlist ID:** `clover-miss-board`
- **Journey key:** `clover-miss`
- **Mode:** board
- **Total steps:** 5

### Step 1 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).


### Step 2 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-delivery-qbo) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | QBO invoice still posts |
| **Active UI glow target** | `qbo` |

**Story (customer):** Will receive the invoice even if POS match is pending.

**Story (system):** V8 rule: Clover never blocks inv_${opportunity_id}.

**Beam endpoints:**
  - `e-delivery-qbo`: `delivery` → `qbo`

### Step 3 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 4800 ms |
| **SLA delta** | +2d SLA penalty |
| **Cumulative calendar** | Day 7–10 / 56d E2E |
| **Story card title** | Clover miss → DLQ |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit exists somewhere; books need a human match.

**Story (system):** Fuzzy match failed (amount/window/location). Unmatched job → DLQ. Invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `qbo` → `clover`

### Step 4 · `sales-az · az-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `sales-az__az-delivered` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-delivered` |
| **Connection type** | Direct Beam (e-clover-ok) · Parallel Fan-Out → reconciled |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 7–10 / 56d E2E |
| **Story card title** | CRM Delivered despite unmatched POS |
| **Active UI glow target** | `sales-az__az-delivered` |

**Story (customer):** Order is complete; finance recon is a back-office loop.

**Story (system):** Happy-path customer stage is not held hostage by Clover.

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `sales-az__az-delivered`

### Step 5 · `postcare`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-delivered` |
| **Target (this step)** | `postcare` |
| **Parent node ID** | `postcare` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ok-postcare) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 7–10 / 56d E2E |
| **Story card title** | Post-care still starts |
| **Active UI glow target** | `postcare` |

**Story (customer):** Care SMS / NPS should not wait on POS matching.

**Story (system):** Post-care is customer lifecycle, not treasury close.

**Beam endpoints:**
  - `e-ok-postcare`: `sales-az__az-delivered` → `postcare`

---

## Exception · Redis Fail-Open (Rose) (Full Map)

- **Playlist ID:** `redis-failopen-full`
- **Journey key:** `redis-failopen`
- **Mode:** full
- **Total steps:** 6

### Step 1 · `sales-az · az-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `sales-az__az-produce` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-produce` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Produce Factory Order (Gate 1 prep) |
| **Active UI glow target** | `sales-az__az-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move creates the FO record — webhook fires after Client Approval.


### Step 2 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-produce` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-az-produce, e-produce-az-ingress) · Parallel Fan-Out → produce-az |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Middleware ingress (zero data loss) |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible — reliability layer.

**Story (system):** HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases.

**Beam endpoints:**
  - `e-az-produce`: `sales-az__az-approval` → `ingress`
  - `e-produce-az-ingress`: `sales-az__az-produce` → `ingress`

### Step 3 · `redis`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `redis` |
| **Parent node ID** | `redis` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-redis) |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Redis down — fail-open |
| **Active UI glow target** | `redis` |

**Story (customer):** Never sees this. Order must not stall.

**Story (system):** L1 dedupe timeout/error is ignored; do not 500 the webhook.

**Beam endpoints:**
  - `e-ingress-redis`: `ingress` → `redis`

### Step 4 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `redis` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-pg) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Outbox is source of truth |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** Duplicate protection falls back to Postgres unique / saga — not Redis.

**Beam endpoints:**
  - `e-ingress-pg`: `redis` → `postgres`

### Step 5 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-pg-inngest) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | CCR still leases the job |
| **Active UI glow target** | `inngest` |

**Story (customer):** Invisible.

**Story (system):** Inngest sweeper + claim lease survive Redis absence.

**Beam endpoints:**
  - `e-pg-inngest`: `postgres` → `inngest`

### Step 6 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inngest` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → work-centers, mfg-pipe |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Factory dispatch continues |
| **Active UI glow target** | `katana` |

**Story (customer):** MO is still created.

**Story (system):** Idempotency-Key on Katana absorbs any duplicate retry after Redis recovers.

**Beam endpoints:**
  - `e-inngest-katana`: `inngest` → `katana`
  - `e-inngest-mfg`: `inngest` → `katana`

---

## Exception · Redis Fail-Open (Rose) (Board Brief)

- **Playlist ID:** `redis-failopen-board`
- **Journey key:** `redis-failopen`
- **Mode:** board
- **Total steps:** 6

### Step 1 · `sales-az · az-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `sales-az__az-produce` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-produce` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Produce Factory Order (Gate 1 prep) |
| **Active UI glow target** | `sales-az__az-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move creates the FO record — webhook fires after Client Approval.


### Step 2 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-produce` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-az-produce, e-produce-az-ingress) · Parallel Fan-Out → produce-az |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Middleware ingress (zero data loss) |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible — reliability layer.

**Story (system):** HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases.

**Beam endpoints:**
  - `e-az-produce`: `sales-az__az-approval` → `ingress`
  - `e-produce-az-ingress`: `sales-az__az-produce` → `ingress`

### Step 3 · `redis`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `redis` |
| **Parent node ID** | `redis` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-redis) |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Redis down — fail-open |
| **Active UI glow target** | `redis` |

**Story (customer):** Never sees this. Order must not stall.

**Story (system):** L1 dedupe timeout/error is ignored; do not 500 the webhook.

**Beam endpoints:**
  - `e-ingress-redis`: `ingress` → `redis`

### Step 4 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `redis` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-pg) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Outbox is source of truth |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** Duplicate protection falls back to Postgres unique / saga — not Redis.

**Beam endpoints:**
  - `e-ingress-pg`: `redis` → `postgres`

### Step 5 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-pg-inngest) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | CCR still leases the job |
| **Active UI glow target** | `inngest` |

**Story (customer):** Invisible.

**Story (system):** Inngest sweeper + claim lease survive Redis absence.

**Beam endpoints:**
  - `e-pg-inngest`: `postgres` → `inngest`

### Step 6 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inngest` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → work-centers, mfg-pipe |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Factory dispatch continues |
| **Active UI glow target** | `katana` |

**Story (customer):** MO is still created.

**Story (system):** Idempotency-Key on Katana absorbs any duplicate retry after Redis recovers.

**Beam endpoints:**
  - `e-inngest-katana`: `inngest` → `katana`
  - `e-inngest-mfg`: `inngest` → `katana`

---

## Exception · Gate B Fail (Rose) (Full Map)

- **Playlist ID:** `gate-b-fail-full`
- **Journey key:** `gate-b-fail`
- **Mode:** full
- **Total steps:** 8

### Step 1 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Powder coat & curing oven |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Frame finish is being applied and cured.

**Story (system):** Shop floor station; QC Gate B follows adhesion/DFT checks.


### Step 2 · `qc-gates · qc-b`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `qc-gates__qc-b` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-b` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | NCR — Gate B DFT / adhesion fail |
| **Active UI glow target** | `qc-gates__qc-b` |

**Story (customer):** Lead time slips; finish must be stripped and redone.

**Story (system):** DFT or adhesion below spec; traveler frozen before upholstery.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 3 · `mfg-pipe · mfg-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-b` |
| **Target (this step)** | `mfg-pipe__mfg-delivered` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-delivered` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Manufacturing mirror — Rejected (coating) |
| **Active UI glow target** | `mfg-pipe__mfg-delivered` |

**Story (customer):** Ops communicates revised ETA.

**Story (system):** Katana + GHL mirror show reject; upholstery will not start.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 4 · `work-centers · wc-sandblast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-delivered` |
| **Target (this step)** | `work-centers__wc-sandblast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-sandblast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | +3d SLA penalty |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Blast & prep for recoat |
| **Active UI glow target** | `work-centers__wc-sandblast` |

**Story (customer):** Waiting on corrected finish.

**Story (system):** Strip failed coat; prep for second powder pass.


### Step 5 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-sandblast` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3600 ms |
| **SLA delta** | +2d SLA penalty |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Second powder pass |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Finish is being corrected.

**Story (system):** Same traveler; Gate B must pass before sew/assembly.


### Step 6 · `qc-gates · qc-b`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `qc-gates__qc-b` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-b` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Gate B pass after recoat |
| **Active UI glow target** | `qc-gates__qc-b` |

**Story (customer):** Quality back on path.

**Story (system):** Adhesion/DFT within spec; NCR closed at Gate B.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 7 · `work-centers · wc-upholstery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-b` |
| **Target (this step)** | `work-centers__wc-upholstery` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-upholstery` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +4d · Custom upholstery & cushion sewing |
| **Cumulative calendar** | Day 9 / 56d E2E |
| **Story card title** | Custom upholstery & cushion sewing |
| **Active UI glow target** | `work-centers__wc-upholstery` |

**Story (customer):** Cushions and covers are being made to spec.

**Story (system):** Parallel to metal once frames pass Gate B.


### Step 8 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-upholstery` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 9 / 56d E2E |
| **Story card title** | Ready for Delivery after coating NCR |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Can be scheduled again.

**Story (system):** Mirror → Ready; downstream same as happy path.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

---

## Exception · Gate B Fail (Rose) (Board Brief)

- **Playlist ID:** `gate-b-fail-board`
- **Journey key:** `gate-b-fail`
- **Mode:** board
- **Total steps:** 8

### Step 1 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Powder coat & curing oven |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Frame finish is being applied and cured.

**Story (system):** Shop floor station; QC Gate B follows adhesion/DFT checks.


### Step 2 · `qc-gates · qc-b`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `qc-gates__qc-b` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-b` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | NCR — Gate B DFT / adhesion fail |
| **Active UI glow target** | `qc-gates__qc-b` |

**Story (customer):** Lead time slips; finish must be stripped and redone.

**Story (system):** DFT or adhesion below spec; traveler frozen before upholstery.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 3 · `mfg-pipe · mfg-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-b` |
| **Target (this step)** | `mfg-pipe__mfg-delivered` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-delivered` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Manufacturing mirror — Rejected (coating) |
| **Active UI glow target** | `mfg-pipe__mfg-delivered` |

**Story (customer):** Ops communicates revised ETA.

**Story (system):** Katana + GHL mirror show reject; upholstery will not start.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 4 · `work-centers · wc-sandblast`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-delivered` |
| **Target (this step)** | `work-centers__wc-sandblast` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-sandblast` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | +3d SLA penalty |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Blast & prep for recoat |
| **Active UI glow target** | `work-centers__wc-sandblast` |

**Story (customer):** Waiting on corrected finish.

**Story (system):** Strip failed coat; prep for second powder pass.


### Step 5 · `work-centers · wc-powder`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-sandblast` |
| **Target (this step)** | `work-centers__wc-powder` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-powder` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3600 ms |
| **SLA delta** | +2d SLA penalty |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Second powder pass |
| **Active UI glow target** | `work-centers__wc-powder` |

**Story (customer):** Finish is being corrected.

**Story (system):** Same traveler; Gate B must pass before sew/assembly.


### Step 6 · `qc-gates · qc-b`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-powder` |
| **Target (this step)** | `qc-gates__qc-b` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-b` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Gate B pass after recoat |
| **Active UI glow target** | `qc-gates__qc-b` |

**Story (customer):** Quality back on path.

**Story (system):** Adhesion/DFT within spec; NCR closed at Gate B.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 7 · `work-centers · wc-upholstery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-b` |
| **Target (this step)** | `work-centers__wc-upholstery` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-upholstery` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +4d · Custom upholstery & cushion sewing |
| **Cumulative calendar** | Day 9 / 56d E2E |
| **Story card title** | Custom upholstery & cushion sewing |
| **Active UI glow target** | `work-centers__wc-upholstery` |

**Story (customer):** Cushions and covers are being made to spec.

**Story (system):** Parallel to metal once frames pass Gate B.


### Step 8 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-upholstery` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 9 / 56d E2E |
| **Story card title** | Ready for Delivery after coating NCR |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Can be scheduled again.

**Story (system):** Mirror → Ready; downstream same as happy path.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

---

## Exception · QBO Mutex (Rose) (Full Map)

- **Playlist ID:** `qbo-mutex-full`
- **Journey key:** `qbo-mutex`
- **Mode:** full
- **Total steps:** 6

### Step 1 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).


### Step 2 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-delivery-qbo) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | First Delivered → QBO invoice |
| **Active UI glow target** | `qbo` |

**Story (customer):** Receives invoice for completed delivery.

**Story (system):** OAuth token + mutex around QBO write for franchise entity.

**Beam endpoints:**
  - `e-delivery-qbo`: `delivery` → `qbo`

### Step 3 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Parallel Fan-Out → delivery |
| **Dwell (UI animation)** | 5200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | QBO mutex — second invoice waits |
| **Active UI glow target** | `qbo` |

**Story (customer):** Second customer still gets invoice — just not in the same second.

**Story (system):** Mutex lease held by first inv_${opportunity_id}; second job retries with backoff.


### Step 4 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Mutex released — second invoice posts |
| **Active UI glow target** | `qbo` |

**Story (customer):** Both invoices issued; Clover match proceeds independently.

**Story (system):** Same mutex pattern; Clover miss still never blocks invoice.


### Step 5 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Clover POS fuzzy match |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit already paid at POS or link.

**Story (system):** Match by amount/window/location; unmatched → DLQ, invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `qbo` → `clover`

### Step 6 · `reconciled`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `reconciled` |
| **Parent node ID** | `reconciled` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-clover-ok) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +2d · QBO/Clover financial reconciliation |
| **Cumulative calendar** | Day 7 / 56d E2E |
| **Story card title** | Ledger reconciled |
| **Active UI glow target** | `reconciled` |

**Story (customer):** Books match cash — 56-day E2E SLA complete.

**Story (system):** Happy-path close after Clover match (or manual recon).

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `reconciled`

---

## Exception · QBO Mutex (Rose) (Board Brief)

- **Playlist ID:** `qbo-mutex-board`
- **Journey key:** `qbo-mutex`
- **Mode:** board
- **Total steps:** 6

### Step 1 · `delivery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `delivery` |
| **Parent node ID** | `delivery` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +5d · White-glove delivery |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | White-glove delivery |
| **Active UI glow target** | `delivery` |

**Story (customer):** Furniture placed and signed off on site.

**Story (system):** Katana Delivered event starts financial clearance (retail/trade).


### Step 2 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `delivery` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-delivery-qbo) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | First Delivered → QBO invoice |
| **Active UI glow target** | `qbo` |

**Story (customer):** Receives invoice for completed delivery.

**Story (system):** OAuth token + mutex around QBO write for franchise entity.

**Beam endpoints:**
  - `e-delivery-qbo`: `delivery` → `qbo`

### Step 3 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Parallel Fan-Out → delivery |
| **Dwell (UI animation)** | 5200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | QBO mutex — second invoice waits |
| **Active UI glow target** | `qbo` |

**Story (customer):** Second customer still gets invoice — just not in the same second.

**Story (system):** Mutex lease held by first inv_${opportunity_id}; second job retries with backoff.


### Step 4 · `qbo`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `qbo` |
| **Parent node ID** | `qbo` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Mutex released — second invoice posts |
| **Active UI glow target** | `qbo` |

**Story (customer):** Both invoices issued; Clover match proceeds independently.

**Story (system):** Same mutex pattern; Clover miss still never blocks invoice.


### Step 5 · `clover`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qbo` |
| **Target (this step)** | `clover` |
| **Parent node ID** | `clover` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-qbo-clover) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Clover POS fuzzy match |
| **Active UI glow target** | `clover` |

**Story (customer):** Deposit already paid at POS or link.

**Story (system):** Match by amount/window/location; unmatched → DLQ, invoice stays.

**Beam endpoints:**
  - `e-qbo-clover`: `qbo` → `clover`

### Step 6 · `reconciled`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `clover` |
| **Target (this step)** | `reconciled` |
| **Parent node ID** | `reconciled` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-clover-ok) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | +2d · QBO/Clover financial reconciliation |
| **Cumulative calendar** | Day 7 / 56d E2E |
| **Story card title** | Ledger reconciled |
| **Active UI glow target** | `reconciled` |

**Story (customer):** Books match cash — 56-day E2E SLA complete.

**Story (system):** Happy-path close after Clover match (or manual recon).

**Beam endpoints:**
  - `e-clover-ok`: `clover` → `reconciled`

---

## Exception · Gate C Fail (Rose) (Full Map)

- **Playlist ID:** `gate-c-fail-full`
- **Journey key:** `gate-c-fail`
- **Mode:** full
- **Total steps:** 7

### Step 1 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Final assembly, glides & hardware |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Pieces become the finished suite.

**Story (system):** Traveler complete before Gate C photo log.


### Step 2 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 4800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Gate C fail — fit / finish / photo miss |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Pre-pack hold; delivery date may move.

**Story (system):** 360° photo log or fit check failed; NCR before ship.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 3 · `mfg-pipe · mfg-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `mfg-pipe__mfg-delivered` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-delivered` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 4200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Manufacturing mirror — Rejected (pre-pack) |
| **Active UI glow target** | `mfg-pipe__mfg-delivered` |

**Story (customer):** Ops resets ETA.

**Story (system):** GHL mirror Rejected; upholstery/assembly frozen.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 4 · `work-centers · wc-upholstery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-delivered` |
| **Target (this step)** | `work-centers__wc-upholstery` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-upholstery` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 4600 ms |
| **SLA delta** | +2d SLA penalty |
| **Cumulative calendar** | Day 2 / 56d E2E |
| **Story card title** | Re-upholster / frame adjust |
| **Active UI glow target** | `work-centers__wc-upholstery` |

**Story (customer):** Waiting on corrected fit and finish.

**Story (system):** Gate C failure remediation; +2 calendar-day SLA penalty.


### Step 5 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-upholstery` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 2 / 56d E2E |
| **Story card title** | Final assembly (second pass) |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Suite rebuilt after QC hold.

**Story (system):** Traveler re-enters Gate C photo log.


### Step 6 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | +3d · Final assembly & pre-pack (Gate C) |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Gate C pass — pre-pack cleared |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Quality locked; ship window reopens.

**Story (system):** Photo log attached; NCR closed.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 7 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 3600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Ready for Delivery after Gate C NCR |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Can be scheduled again.

**Story (system):** Mirror → Ready; route scheduling resumes.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

---

## Exception · Gate C Fail (Rose) (Board Brief)

- **Playlist ID:** `gate-c-fail-board`
- **Journey key:** `gate-c-fail`
- **Mode:** board
- **Total steps:** 7

### Step 1 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Final assembly, glides & hardware |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Pieces become the finished suite.

**Story (system):** Traveler complete before Gate C photo log.


### Step 2 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 4800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Gate C fail — fit / finish / photo miss |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Pre-pack hold; delivery date may move.

**Story (system):** 360° photo log or fit check failed; NCR before ship.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 3 · `mfg-pipe · mfg-delivered`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `mfg-pipe__mfg-delivered` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-delivered` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 4200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 0 / 56d E2E |
| **Story card title** | Manufacturing mirror — Rejected (pre-pack) |
| **Active UI glow target** | `mfg-pipe__mfg-delivered` |

**Story (customer):** Ops resets ETA.

**Story (system):** GHL mirror Rejected; upholstery/assembly frozen.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

### Step 4 · `work-centers · wc-upholstery`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `mfg-pipe__mfg-delivered` |
| **Target (this step)** | `work-centers__wc-upholstery` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-upholstery` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 4600 ms |
| **SLA delta** | +2d SLA penalty |
| **Cumulative calendar** | Day 2 / 56d E2E |
| **Story card title** | Re-upholster / frame adjust |
| **Active UI glow target** | `work-centers__wc-upholstery` |

**Story (customer):** Waiting on corrected fit and finish.

**Story (system):** Gate C failure remediation; +2 calendar-day SLA penalty.


### Step 5 · `work-centers · wc-final`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-upholstery` |
| **Target (this step)** | `work-centers__wc-final` |
| **Parent node ID** | `work-centers` |
| **Sub-button / stage ID** | `wc-final` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3400 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 2 / 56d E2E |
| **Story card title** | Final assembly (second pass) |
| **Active UI glow target** | `work-centers__wc-final` |

**Story (customer):** Suite rebuilt after QC hold.

**Story (system):** Traveler re-enters Gate C photo log.


### Step 6 · `qc-gates · qc-c`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `work-centers__wc-final` |
| **Target (this step)** | `qc-gates__qc-c` |
| **Parent node ID** | `qc-gates` |
| **Sub-button / stage ID** | `qc-c` |
| **Connection type** | Direct Beam (e-wc-qc) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | +3d · Final assembly & pre-pack (Gate C) |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Gate C pass — pre-pack cleared |
| **Active UI glow target** | `qc-gates__qc-c` |

**Story (customer):** Quality locked; ship window reopens.

**Story (system):** Photo log attached; NCR closed.

**Beam endpoints:**
  - `e-wc-qc`: `work-centers__wc-marriage` → `qc-gates__qc-a`

### Step 7 · `mfg-pipe · mfg-ready`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `qc-gates__qc-c` |
| **Target (this step)** | `mfg-pipe__mfg-ready` |
| **Parent node ID** | `mfg-pipe` |
| **Sub-button / stage ID** | `mfg-ready` |
| **Connection type** | Direct Beam (e-qc-mfg) |
| **Dwell (UI animation)** | 3600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 5 / 56d E2E |
| **Story card title** | Ready for Delivery after Gate C NCR |
| **Active UI glow target** | `mfg-pipe__mfg-ready` |

**Story (customer):** Can be scheduled again.

**Story (system):** Mirror → Ready; route scheduling resumes.

**Beam endpoints:**
  - `e-qc-mfg`: `qc-gates__qc-c` → `mfg-pipe__mfg-ready`

---

## Exception · CCR Race (Rose) (Full Map)

- **Playlist ID:** `ccr-race-full`
- **Journey key:** `ccr-race`
- **Mode:** full
- **Total steps:** 9

### Step 1 · `sales-az · az-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `sales-az__az-produce` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-produce` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Produce Factory Order (Gate 1 prep) |
| **Active UI glow target** | `sales-az__az-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move creates the FO record — webhook fires after Client Approval.


### Step 2 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-produce` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-az-produce, e-produce-az-ingress) · Parallel Fan-Out → produce-az · External Webhook (e-produce-az-ingress → ingress, produce-az) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Dual webhook — GHL network retry |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible — must not create two factory orders.

**Story (system):** Two simultaneous POSTs hit Ingress for the same Produce FO.

**Beam endpoints:**
  - `e-az-produce`: `sales-az__az-approval` → `ingress`
  - `e-produce-az-ingress`: `sales-az__az-produce` → `ingress`

### Step 3 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-redis, e-ingress-pg) · Parallel Fan-Out → redis |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 1 — mo_create lease acquired |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** FOR UPDATE claim in Postgres; Worker 1 owns the saga.

**Beam endpoints:**
  - `e-ingress-redis`: `ingress` → `postgres`
  - `e-ingress-pg`: `ingress` → `postgres`

### Step 4 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Parallel Fan-Out → produce-az |
| **Dwell (UI animation)** | 4800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — duplicate webhook arrives |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible.

**Story (system):** Second GHL retry enters Ingress while Worker 1 is in-flight.


### Step 5 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-pg) |
| **Dwell (UI animation)** | 5200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — 23505 + CCR_LEASE_ACTIVE |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** UniqueViolation on claim; sees active lease → yields (CCR_LEASE_ACTIVE).

**Beam endpoints:**
  - `e-ingress-pg`: `ingress` → `postgres`

### Step 6 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-pg-inngest) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 1 — Inngest executes MO create |
| **Active UI glow target** | `inngest` |

**Story (customer):** Invisible.

**Story (system):** CCR lease holder runs Katana Idempotency-Key path.

**Beam endpoints:**
  - `e-pg-inngest`: `postgres` → `inngest`

### Step 7 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inngest` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → work-centers, mfg-pipe |
| **Dwell (UI animation)** | 4200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 1 — Katana MO written |
| **Active UI glow target** | `katana` |

**Story (customer):** One physical job — exactly once.

**Story (system):** MO id written to saga row; Manufacturing mirror follows.

**Beam endpoints:**
  - `e-inngest-katana`: `inngest` → `katana`
  - `e-inngest-mfg`: `inngest` → `katana`

### Step 8 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — backoff wake |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** Retry after lease TTL; reads existing katana_mo_id.


### Step 9 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — duplicate safely resolved |
| **Active UI glow target** | `inngest` |

**Story (customer):** Never sees a double build.

**Story (system):** katana_mo_id present → idempotent complete, no second MO.


---

## Exception · CCR Race (Rose) (Board Brief)

- **Playlist ID:** `ccr-race-board`
- **Journey key:** `ccr-race`
- **Mode:** board
- **Total steps:** 9

### Step 1 · `sales-az · az-produce`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `— (origin)` |
| **Target (this step)** | `sales-az__az-produce` |
| **Parent node ID** | `sales-az` |
| **Sub-button / stage ID** | `az-produce` |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3500 ms |
| **SLA delta** | +3d · Client approval → Produce FO |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Produce Factory Order (Gate 1 prep) |
| **Active UI glow target** | `sales-az__az-produce` |

**Story (customer):** FO is drafted; factory queue is prepared.

**Story (system):** GHL stage move creates the FO record — webhook fires after Client Approval.


### Step 2 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `sales-az__az-produce` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-az-produce, e-produce-az-ingress) · Parallel Fan-Out → produce-az · External Webhook (e-produce-az-ingress → ingress, produce-az) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Dual webhook — GHL network retry |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible — must not create two factory orders.

**Story (system):** Two simultaneous POSTs hit Ingress for the same Produce FO.

**Beam endpoints:**
  - `e-az-produce`: `sales-az__az-approval` → `ingress`
  - `e-produce-az-ingress`: `sales-az__az-produce` → `ingress`

### Step 3 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-redis, e-ingress-pg) · Parallel Fan-Out → redis |
| **Dwell (UI animation)** | 4500 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 1 — mo_create lease acquired |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** FOR UPDATE claim in Postgres; Worker 1 owns the saga.

**Beam endpoints:**
  - `e-ingress-redis`: `ingress` → `postgres`
  - `e-ingress-pg`: `ingress` → `postgres`

### Step 4 · `ingress`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `ingress` |
| **Parent node ID** | `ingress` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Parallel Fan-Out → produce-az |
| **Dwell (UI animation)** | 4800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — duplicate webhook arrives |
| **Active UI glow target** | `ingress` |

**Story (customer):** Invisible.

**Story (system):** Second GHL retry enters Ingress while Worker 1 is in-flight.


### Step 5 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `ingress` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-ingress-pg) |
| **Dwell (UI animation)** | 5200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — 23505 + CCR_LEASE_ACTIVE |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** UniqueViolation on claim; sees active lease → yields (CCR_LEASE_ACTIVE).

**Beam endpoints:**
  - `e-ingress-pg`: `ingress` → `postgres`

### Step 6 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-pg-inngest) |
| **Dwell (UI animation)** | 4000 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 1 — Inngest executes MO create |
| **Active UI glow target** | `inngest` |

**Story (customer):** Invisible.

**Story (system):** CCR lease holder runs Katana Idempotency-Key path.

**Beam endpoints:**
  - `e-pg-inngest`: `postgres` → `inngest`

### Step 7 · `katana`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `inngest` |
| **Target (this step)** | `katana` |
| **Parent node ID** | `katana` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | Direct Beam (e-inngest-katana, e-inngest-mfg) · Parallel Fan-Out → work-centers, mfg-pipe |
| **Dwell (UI animation)** | 4200 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 1 — Katana MO written |
| **Active UI glow target** | `katana` |

**Story (customer):** One physical job — exactly once.

**Story (system):** MO id written to saga row; Manufacturing mirror follows.

**Beam endpoints:**
  - `e-inngest-katana`: `inngest` → `katana`
  - `e-inngest-mfg`: `inngest` → `katana`

### Step 8 · `postgres`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `katana` |
| **Target (this step)** | `postgres` |
| **Parent node ID** | `postgres` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3800 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — backoff wake |
| **Active UI glow target** | `postgres` |

**Story (customer):** Invisible.

**Story (system):** Retry after lease TTL; reads existing katana_mo_id.


### Step 9 · `inngest`

| Field | Value |
|-------|-------|
| **Source (prior glow)** | `postgres` |
| **Target (this step)** | `inngest` |
| **Parent node ID** | `inngest` |
| **Sub-button / stage ID** | — (leaf node) |
| **Connection type** | In-place dwell (no new beam) |
| **Dwell (UI animation)** | 3600 ms |
| **SLA delta** | Systems · same day |
| **Cumulative calendar** | Day 3 / 56d E2E |
| **Story card title** | Worker 2 — duplicate safely resolved |
| **Active UI glow target** | `inngest` |

**Story (customer):** Never sees a double build.

**Story (system):** katana_mo_id present → idempotent complete, no second MO.


---
