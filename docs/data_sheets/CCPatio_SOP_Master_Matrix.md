# CCPATIO Standard Operating Procedure — Master Matrix

> Auto-generated from `sequences.ts`, `stories.ts`, `roleConfig.ts`, and `dwellCalendar.ts`.  
> Regenerate: `npm run generate:sop` · Generated: 2026-08-22

## Executive summary

| Metric | Value |
| --- | --- |
| E2E SLA (Retail happy path) | **56 calendar days** |
| Retail full-map steps | 50 |
| Trade full-map steps | 49 |
| Warranty full-map steps | 32 |
| Terminal milestone | `reconciled` @ Day 53 |

This matrix maps **who** executes each step, **what** happens on the floor, **what** the CRM/digital trigger is, and **what** the Next.js middleware automates in the background.

---

## Happy Path · Retail · Scottsdale AZ (Full Map E2E)

| Step | Phase | Assigned Role | Digital Trigger / CRM Stage | Physical Action | System Automation / Sync | SLA Allotment |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Omnichannel | Marketing Ops | Demand enters the brand | Sees an ad or design post and starts a conversation. | UTM / click IDs land in session; GHL can attribute the lead. | Systems · same day (cumulative ~Day 0) |
| 2 | Channel | Showroom Rep | Live conversation on ccpatio.com | Asks about sizing, fabrics, or showroom visits. | Web chat routes into the GHL Unified Inbox. | Systems · same day (cumulative ~Day 0) |
| 3 | Aggregator | GHL Router | GHL Unified Inbox (the router) | Doesn’t see this — internal brain of intake. | Tags (retail_az, commercial, warranty) and spawns the card. | Systems · same day (cumulative ~Day 0) |
| 4 | Retail Leads | Showroom Rep | leads-pipe · lead-new | Waiting for a human reply after the first touch. | Leads pipeline card; SLA clock starts. | Systems · same day (cumulative ~Day 0) |
| 5 | Retail Leads | Web Lead Queue | leads-pipe · lead-website | Submits project details online. | Lead qualifies → Scottsdale or Solana Beach Sales opportunity. | Systems · same day (cumulative ~Day 0) |
| 6 | Phase 1: Lead ingestion → On-site scheduled | Showroom Rep | sales-az · az-onsite | Expects a field visit or measurement appointment. | CRM stage only — no middleware mutations. | +4d · Lead ingestion → On-site scheduled (cumulative ~Day 4) |
| 7 | Sales AZ | Design / Engineering | sales-az · az-sketchup-needed | Waiting on a 3D concept that matches their space. | Human BOM + dimensions; CAD/CAM packets prepared later. | Systems · same day (cumulative ~Day 4) |
| 8 | Design | SketchUp Designer | SketchUp 3D modeling | Waiting for a visual they can approve. | Human modeling; tube cut schedules follow. | Systems · same day (cumulative ~Day 4) |
| 9 | Cut Lists | Engineering | Tube cut schedules & miter angles | Invisible — chop saw traveler is being prepared. | Manual chop saw schedules — no CNC laser nesting. | Systems · same day (cumulative ~Day 4) |
| 10 | Phase 4: Tube cut lists & BOM packet | Engineering / Sales | BOM assembly packet | Spec is becoming real SKUs and finishes. | Shop drawings + frozen SKU list for Produce FO. | +2d · Tube cut lists & BOM packet (cumulative ~Day 6) |
| 11 | Sales AZ | Sales Rep | sales-az · az-sketchup-done | Sees a 3D that they can react to. | Packet returns to Sales; SKUs not frozen until finalize. | Systems · same day (cumulative ~Day 6) |
| 12 | Phase 2: SketchUp 3D modeling & proposal | Sales Rep | sales-az · az-proposal | Reviews pricing, fabrics, and lead time. | CRM document / e-sign; still no factory webhook. | +7d · SketchUp 3D modeling & proposal (cumulative ~Day 13) |
| 13 | Sales AZ | Sales Rep | sales-az · az-finalize | Picks powder, fabric, and configuration details. | SKU freeze in the packet that Produce FO will send. | Systems · same day (cumulative ~Day 13) |
| 14 | Phase 3: Produce FO → Client approval | Sales / Ops | sales-az · az-produce | FO is drafted; factory queue is prepared. | GHL stage move creates the FO record — deposit must clear before Client Approval. | +3d · Produce FO → Client approval (cumulative ~Day 16) |
| 15 | Gate 0.5 | Finance / Ops | Omnichannel payment gateway | Deposit is confirmed — order can release to factory. | Either QBO link or Clover swipe must clear before 07.S Client Approval. | Systems · same day (cumulative ~Day 16) |
| 16 | Sales AZ | Customer + Sales | sales-az · az-approval | Final sign-off before factory webhook releases. | Deposit cleared + e-sign complete → Produce + Won webhook → Ingress outbox → Katana MO. | Systems · same day (cumulative ~Day 16) |
| 17 | Edge | Next.js Middleware | Middleware ingress (zero data loss) | Invisible — reliability layer. | HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases. | Systems · same day (cumulative ~Day 16) |
| 18 | Execution | Inngest Worker | Inngest CCR (lease + sweeper) | Invisible. | Fan-out to Katana + GHL Manufacturing mirror under a claim lease. | Systems · same day (cumulative ~Day 16) |
| 19 | Factory API | Katana ERP Sync | Katana = physical truth | Order is now a manufacturing job. | MO created with Idempotency-Key; GHL Manufacturing only mirrors. | Systems · same day (cumulative ~Day 16) |
| 20 | Full Map | GHL Mirror Sync | mfg-pipe · mfg-new | Add customer-facing language as you gather ops detail. | Node is live on the Full Map — enrich this story anytime. | Systems · same day (cumulative ~Day 16) |
| 21 | Materials | Factory / Purchasing | Inventory allocation check | Invisible — materials are being reserved. | Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement. | Systems · same day (cumulative ~Day 16) |
| 22 | Bypass | Vendor / Ops | Outsourced accessories hold | Umbrellas and pool chairs wait for in-house frames. | Bypasses fabrication pods — merges at Component Assembly / Marriage. | Systems · same day (cumulative ~Day 16) |
| 23 | Phase 5: Procurement wait (backorder buffer) | Purchasing | Procurement wait loop | Lead time buffer while extrusion stock is ordered. | 10-day SLA buffer · GHL Manufacturing → Purchasing / Receiving sync. | +10d · Procurement wait (backorder buffer) (cumulative ~Day 26) |
| 24 | Shop floor | Materials Staging | work-centers · wc-tube-stock | Marine-grade aluminum extrusion is being kitted. | Raw extrusion inventory pulled from tube stock racks. | Systems · same day (cumulative ~Day 26) |
| 25 | Full Map | GHL Mirror · Purchasing | mfg-pipe · mfg-purchasing | Add customer-facing language as you gather ops detail. | Node is live on the Full Map — enrich this story anytime. | Systems · same day (cumulative ~Day 26) |
| 26 | Phase 6: Chop saw cut & miter station | Chop Saw Operator | work-centers · wc-chop-saw | Extrusions are cut to length — no CNC laser or mandrel bending. | Precision chop saws: straight cuts, angles, miters, deburring. | +3d · Chop saw cut & miter station (cumulative ~Day 29) |
| 27 | Shop floor | Fab Pod 1 | work-centers · wc-cart-parts | Cut tube profiles are kitted onto mobile carts. | Cart-based WIP between cut station and fabrication pods. | Systems · same day (cumulative ~Day 29) |
| 28 | Shop floor | Fab Pod 1 · Tack | work-centers · wc-tack | Frame is jig-clamped and tacked. | First of three pod stations — tack before full weld-out. | Systems · same day (cumulative ~Day 29) |
| 29 | Manufacturing mirror | GHL Mirror · Production | mfg-pipe · mfg-production | Invisible — CRM shows active factory work. | Katana → GHL Manufacturing sync when frame enters Fabrication Pod. | Systems · same day (cumulative ~Day 29) |
| 30 | Shop floor | Fab Pod 1 · Weld Out | work-centers · wc-weld-out | Structural bead welding completes the frame. | Full structural welds; Gate A inspects dimension + weld quality next. | Systems · same day (cumulative ~Day 29) |
| 31 | Shop floor | Fab Pod 2 · Grinder | work-centers · wc-grinder | Weld seams are smoothed and prepped. | Weld seam smoothing before sub-frame marriage. | Systems · same day (cumulative ~Day 29) |
| 32 | Shop floor | Fab Pod 3 · Assembly | work-centers · wc-marriage | Modular sub-frames join into finished builds. | Marriage of pod outputs before Gate A weld/dim check. | Systems · same day (cumulative ~Day 29) |
| 33 | Phase 7: Fabrication pod weld-out (Gate A) | QC Inspector · Gate A | qc-gates · qc-a | Quality is being proven before coating. | Fail → NCR freeze + remake at weld. Pass → blast/powder. | +5d · Fabrication pod weld-out (Gate A) (cumulative ~Day 34) |
| 34 | Shop floor | Finishing Lead | work-centers · wc-cart-blast | Completed build rolled to surface prep. | Cart WIP between marriage and sandblast bay. | Systems · same day (cumulative ~Day 34) |
| 35 | Shop floor | Sandblast Operator | work-centers · wc-sandblast | Frame is media-blasted for coating adhesion. | Prep quality drives Gate B adhesion later. | Systems · same day (cumulative ~Day 34) |
| 36 | Shop floor | Powder Coat Tech | work-centers · wc-powder | Frame finish is being applied and cured. | Shop floor station; QC Gate B follows adhesion/DFT checks. | Systems · same day (cumulative ~Day 34) |
| 37 | Phase 8: Sandblast & powder coat (Gate B) | QC Inspector · Gate B | qc-gates · qc-b | Finish quality is locked. | Coating thickness + adhesion; fail returns to finishing. | +5d · Sandblast & powder coat (Gate B) (cumulative ~Day 39) |
| 38 | Phase 9: Custom upholstery & cushion sewing | Upholstery / Sewing | work-centers · wc-upholstery | Cushions and covers are being made to spec. | Parallel to metal once frames pass Gate B. | +4d · Custom upholstery & cushion sewing (cumulative ~Day 43) |
| 39 | Shop floor | Final Assembly Lead | work-centers · wc-final | Pieces become the finished suite. | Traveler complete before Gate C photo log. | Systems · same day (cumulative ~Day 43) |
| 40 | Phase 10: Final assembly & pre-pack (Gate C) | QC Inspector · Gate C | qc-gates · qc-c | Quality locked before shipping. | 360° photos can attach to GHL; NCR freezes remakes if fail. | +3d · Final assembly & pre-pack (Gate C) (cumulative ~Day 46) |
| 41 | Manufacturing mirror | GHL Mirror · Ready | mfg-pipe · mfg-ready | Product is waiting on a scheduled route. | GHL Manufacturing mirrors Katana — not the system of record. | Systems · same day (cumulative ~Day 46) |
| 42 | Logistics | Dispatch Coordinator | dispatch-routes · dispatch-box | Local white-glove delivery scheduled. | In-house box truck route · Samsara / Onfleet. | Systems · same day (cumulative ~Day 46) |
| 43 | Logistics | Freight Coordinator | dispatch-routes · dispatch-3pl | National freight carrier scheduled. | Third-party freight · same delivery + invoice path. | Systems · same day (cumulative ~Day 46) |
| 44 | Logistics | Showroom / Ops | dispatch-routes · dispatch-willcall | Picks up finished goods at factory. | Will-call route · still flows through QBO invoice + ledger reconciled. | Systems · same day (cumulative ~Day 46) |
| 45 | Phase 12: White-glove delivery | White-Glove Driver | White-glove delivery | Furniture placed and signed off on site. | Katana Delivered event starts financial clearance (retail/trade). | +5d · White-glove delivery (cumulative ~Day 51) |
| 46 | Treasury | Finance / QBO | Financial clearance — QBO invoice | Receives formal invoice / remaining balance path. | OAuth mutex; inv_${opportunity_id}; never blocked by Clover miss. | Systems · same day (cumulative ~Day 51) |
| 47 | Treasury | QBO Matcher | Clover POS fuzzy match | Deposit already paid at POS or link. | Match by amount/window/location; unmatched → DLQ, invoice stays. | Systems · same day (cumulative ~Day 51) |
| 48 | Phase 13: QBO/Clover financial reconciliation | Finance Controller | Ledger reconciled | Books match cash — 56-day E2E SLA complete. | Happy-path close after Clover match (or manual recon). | +2d · QBO/Clover financial reconciliation (cumulative ~Day 53) |
| 49 | Sales AZ | Sales / Finance | sales-az · az-delivered | Order is complete in the CRM they were sold from. | Stage move after Delivered + QBO path; Clover miss does not block this. | Systems · same day (cumulative ~Day 53) |
| 50 | Post-care | Customer Success | Post-care & warranty registry | SMS passport, NPS, care guide, seasonal follow-ups. | GHL sequences; warranty linked to serial number. | Systems · same day (cumulative ~Day 53) |

---

## Happy Path · Trade · Solana Beach CA

| Step | Phase | Assigned Role | Digital Trigger / CRM Stage | Physical Action | System Automation / Sync | SLA Allotment |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Channel | Sales / Trade Desk | Inbound call (Trade / Commercial) | Designer or developer calls to open an account or project. | Twilio/GHL call route → Unified Inbox → Trade pipeline. | Systems · same day (cumulative ~Day 0) |
| 2 | Aggregator | GHL Router | GHL Unified Inbox (the router) | Doesn’t see this — internal brain of intake. | Tags (retail_az, commercial, warranty) and spawns the card. | Systems · same day (cumulative ~Day 0) |
| 3 | Trade | Trade Desk | trade-pipe · trade-app | Designer/developer requests wholesale or project pricing. | Application card; credit/terms review is human. | Systems · same day (cumulative ~Day 0) |
| 4 | Trade | Trade Desk | trade-pipe · trade-approved | Can now specify CCPatio on commercial projects. | Commercial tag + Solana Beach Sales swimlane. | Systems · same day (cumulative ~Day 0) |
| 5 | Phase 1: Lead ingestion → On-site scheduled | Sales CA / Field | sales-ca · ca-onsite | Site walk or showroom appointment for a commercial project. | CRM stage only. | +4d · Lead ingestion → On-site scheduled (cumulative ~Day 4) |
| 6 | Sales CA | Design / Engineering | sales-ca · ca-sketchup-needed | Waiting on drawings that match the job site. | Same CAD/CAM path as retail; commercial SKUs. | Systems · same day (cumulative ~Day 4) |
| 7 | Design | SketchUp Designer | SketchUp 3D modeling | Waiting for a visual they can approve. | Human modeling; tube cut schedules follow. | Systems · same day (cumulative ~Day 4) |
| 8 | Cut Lists | Engineering | Tube cut schedules & miter angles | Invisible — chop saw traveler is being prepared. | Manual chop saw schedules — no CNC laser nesting. | Systems · same day (cumulative ~Day 4) |
| 9 | Phase 4: Tube cut lists & BOM packet | Engineering / Sales | BOM assembly packet | Spec is becoming real SKUs and finishes. | Shop drawings + frozen SKU list for Produce FO. | +2d · Tube cut lists & BOM packet (cumulative ~Day 6) |
| 10 | Sales CA | Sales CA | sales-ca · ca-sketchup-done | Reviews the 3D / shop intent. | Packet returns to Solana Beach Sales. | Systems · same day (cumulative ~Day 6) |
| 11 | Phase 2: SketchUp 3D modeling & proposal | Sales CA | sales-ca · ca-proposal | Trade/commercial pricing and lead time on the table. | CRM docs; no factory webhook yet. | +7d · SketchUp 3D modeling & proposal (cumulative ~Day 13) |
| 12 | Sales CA | Sales CA | sales-ca · ca-finalize | Locks spec for the purchase order. | SKU freeze for Produce FO payload. | Systems · same day (cumulative ~Day 13) |
| 13 | Phase 3: Produce FO → Client approval | Sales CA / Ops | sales-ca · ca-produce | FO is drafted; factory queue is prepared. | GHL stage move — deposit must clear before Client Approval. | +3d · Produce FO → Client approval (cumulative ~Day 16) |
| 14 | Gate 0.5 | Finance / Ops | Omnichannel payment gateway | Deposit is confirmed — order can release to factory. | Either QBO link or Clover swipe must clear before 07.S Client Approval. | Systems · same day (cumulative ~Day 16) |
| 15 | Sales CA | Customer + Sales | sales-ca · ca-approval | Final sign-off before factory webhook releases. | Deposit cleared + e-sign → Produce + Won webhook → Ingress → Katana MO. | Systems · same day (cumulative ~Day 16) |
| 16 | Edge | Next.js Middleware | Middleware ingress (zero data loss) | Invisible — reliability layer. | HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases. | Systems · same day (cumulative ~Day 16) |
| 17 | Execution | Inngest Worker | Inngest CCR (lease + sweeper) | Invisible. | Fan-out to Katana + GHL Manufacturing mirror under a claim lease. | Systems · same day (cumulative ~Day 16) |
| 18 | Factory API | Katana ERP Sync | Katana = physical truth | Order is now a manufacturing job. | MO created with Idempotency-Key; GHL Manufacturing only mirrors. | Systems · same day (cumulative ~Day 16) |
| 19 | Full Map | GHL Mirror Sync | mfg-pipe · mfg-new | Add customer-facing language as you gather ops detail. | Node is live on the Full Map — enrich this story anytime. | Systems · same day (cumulative ~Day 16) |
| 20 | Materials | Factory / Purchasing | Inventory allocation check | Invisible — materials are being reserved. | Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement. | Systems · same day (cumulative ~Day 16) |
| 21 | Bypass | Vendor / Ops | Outsourced accessories hold | Umbrellas and pool chairs wait for in-house frames. | Bypasses fabrication pods — merges at Component Assembly / Marriage. | Systems · same day (cumulative ~Day 16) |
| 22 | Phase 5: Procurement wait (backorder buffer) | Purchasing | Procurement wait loop | Lead time buffer while extrusion stock is ordered. | 10-day SLA buffer · GHL Manufacturing → Purchasing / Receiving sync. | +10d · Procurement wait (backorder buffer) (cumulative ~Day 26) |
| 23 | Shop floor | Materials Staging | work-centers · wc-tube-stock | Marine-grade aluminum extrusion is being kitted. | Raw extrusion inventory pulled from tube stock racks. | Systems · same day (cumulative ~Day 26) |
| 24 | Full Map | GHL Mirror · Purchasing | mfg-pipe · mfg-purchasing | Add customer-facing language as you gather ops detail. | Node is live on the Full Map — enrich this story anytime. | Systems · same day (cumulative ~Day 26) |
| 25 | Phase 6: Chop saw cut & miter station | Chop Saw Operator | work-centers · wc-chop-saw | Extrusions are cut to length — no CNC laser or mandrel bending. | Precision chop saws: straight cuts, angles, miters, deburring. | +3d · Chop saw cut & miter station (cumulative ~Day 29) |
| 26 | Shop floor | Fab Pod 1 | work-centers · wc-cart-parts | Cut tube profiles are kitted onto mobile carts. | Cart-based WIP between cut station and fabrication pods. | Systems · same day (cumulative ~Day 29) |
| 27 | Shop floor | Fab Pod 1 · Tack | work-centers · wc-tack | Frame is jig-clamped and tacked. | First of three pod stations — tack before full weld-out. | Systems · same day (cumulative ~Day 29) |
| 28 | Manufacturing mirror | GHL Mirror · Production | mfg-pipe · mfg-production | Invisible — CRM shows active factory work. | Katana → GHL Manufacturing sync when frame enters Fabrication Pod. | Systems · same day (cumulative ~Day 29) |
| 29 | Shop floor | Fab Pod 1 · Weld Out | work-centers · wc-weld-out | Structural bead welding completes the frame. | Full structural welds; Gate A inspects dimension + weld quality next. | Systems · same day (cumulative ~Day 29) |
| 30 | Shop floor | Fab Pod 2 · Grinder | work-centers · wc-grinder | Weld seams are smoothed and prepped. | Weld seam smoothing before sub-frame marriage. | Systems · same day (cumulative ~Day 29) |
| 31 | Shop floor | Fab Pod 3 · Assembly | work-centers · wc-marriage | Modular sub-frames join into finished builds. | Marriage of pod outputs before Gate A weld/dim check. | Systems · same day (cumulative ~Day 29) |
| 32 | Phase 7: Fabrication pod weld-out (Gate A) | QC Inspector · Gate A | qc-gates · qc-a | Quality is being proven before coating. | Fail → NCR freeze + remake at weld. Pass → blast/powder. | +5d · Fabrication pod weld-out (Gate A) (cumulative ~Day 34) |
| 33 | Shop floor | Finishing Lead | work-centers · wc-cart-blast | Completed build rolled to surface prep. | Cart WIP between marriage and sandblast bay. | Systems · same day (cumulative ~Day 34) |
| 34 | Shop floor | Sandblast Operator | work-centers · wc-sandblast | Frame is media-blasted for coating adhesion. | Prep quality drives Gate B adhesion later. | Systems · same day (cumulative ~Day 34) |
| 35 | Shop floor | Powder Coat Tech | work-centers · wc-powder | Frame finish is being applied and cured. | Shop floor station; QC Gate B follows adhesion/DFT checks. | Systems · same day (cumulative ~Day 34) |
| 36 | Phase 8: Sandblast & powder coat (Gate B) | QC Inspector · Gate B | qc-gates · qc-b | Finish quality is locked. | Coating thickness + adhesion; fail returns to finishing. | +5d · Sandblast & powder coat (Gate B) (cumulative ~Day 39) |
| 37 | Phase 9: Custom upholstery & cushion sewing | Upholstery / Sewing | work-centers · wc-upholstery | Cushions and covers are being made to spec. | Parallel to metal once frames pass Gate B. | +4d · Custom upholstery & cushion sewing (cumulative ~Day 43) |
| 38 | Shop floor | Final Assembly Lead | work-centers · wc-final | Pieces become the finished suite. | Traveler complete before Gate C photo log. | Systems · same day (cumulative ~Day 43) |
| 39 | Phase 10: Final assembly & pre-pack (Gate C) | QC Inspector · Gate C | qc-gates · qc-c | Quality locked before shipping. | 360° photos can attach to GHL; NCR freezes remakes if fail. | +3d · Final assembly & pre-pack (Gate C) (cumulative ~Day 46) |
| 40 | Manufacturing mirror | GHL Mirror · Ready | mfg-pipe · mfg-ready | Product is waiting on a scheduled route. | GHL Manufacturing mirrors Katana — not the system of record. | Systems · same day (cumulative ~Day 46) |
| 41 | Logistics | Dispatch Coordinator | dispatch-routes · dispatch-box | Local white-glove delivery scheduled. | In-house box truck route · Samsara / Onfleet. | Systems · same day (cumulative ~Day 46) |
| 42 | Logistics | Freight Coordinator | dispatch-routes · dispatch-3pl | National freight carrier scheduled. | Third-party freight · same delivery + invoice path. | Systems · same day (cumulative ~Day 46) |
| 43 | Logistics | Showroom / Ops | dispatch-routes · dispatch-willcall | Picks up finished goods at factory. | Will-call route · still flows through QBO invoice + ledger reconciled. | Systems · same day (cumulative ~Day 46) |
| 44 | Phase 12: White-glove delivery | White-Glove Driver | White-glove delivery | Furniture placed and signed off on site. | Katana Delivered event starts financial clearance (retail/trade). | +5d · White-glove delivery (cumulative ~Day 51) |
| 45 | Treasury | Finance / QBO | Financial clearance — QBO invoice | Receives formal invoice / remaining balance path. | OAuth mutex; inv_${opportunity_id}; never blocked by Clover miss. | Systems · same day (cumulative ~Day 51) |
| 46 | Treasury | QBO Matcher | Clover POS fuzzy match | Deposit already paid at POS or link. | Match by amount/window/location; unmatched → DLQ, invoice stays. | Systems · same day (cumulative ~Day 51) |
| 47 | Phase 13: QBO/Clover financial reconciliation | Finance Controller | Ledger reconciled | Books match cash — 56-day E2E SLA complete. | Happy-path close after Clover match (or manual recon). | +2d · QBO/Clover financial reconciliation (cumulative ~Day 53) |
| 48 | Sales CA | Sales / Finance | sales-ca · ca-delivered | Project is closed in the selling pipeline. | Stage move after Katana Delivered + QBO. | Systems · same day (cumulative ~Day 53) |
| 49 | Post-care | Customer Success | Post-care & warranty registry | SMS passport, NPS, care guide, seasonal follow-ups. | GHL sequences; warranty linked to serial number. | Systems · same day (cumulative ~Day 53) |

---

## Happy Path · Warranty Claims

| Step | Phase | Assigned Role | Digital Trigger / CRM Stage | Physical Action | System Automation / Sync | SLA Allotment |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Channel | Service Rep | WhatsApp service thread | Sends photos of damage or a serial-number question. | WhatsApp Business → GHL inbox → Warranty pipeline. | Systems · same day (cumulative ~Day 0) |
| 2 | Aggregator | GHL Router | GHL Unified Inbox (the router) | Doesn’t see this — internal brain of intake. | Tags (retail_az, commercial, warranty) and spawns the card. | Systems · same day (cumulative ~Day 0) |
| 3 | Warranty | Service Rep | warranty-pipe · warranty-discovery | Photos and serial are being reviewed. | Claim card; no factory until Produce FO. | Systems · same day (cumulative ~Day 0) |
| 4 | Warranty | Service Rep | warranty-pipe · warranty-approved | Picks finish/fabric for the remake. | Still CRM; Produce FO is the automation gate. | Systems · same day (cumulative ~Day 0) |
| 5 | Gate 1 | Service / Ops | warranty-pipe · warranty-produce | Approved claim moving to remake/repair. | Skips sales design loop; middleware → factory; often skips QBO. | Systems · same day (cumulative ~Day 0) |
| 6 | Edge | Next.js Middleware | Middleware ingress (zero data loss) | Invisible — reliability layer. | HMAC, Postgres outbox, Redis dedupe, Inngest CCR leases. | Systems · same day (cumulative ~Day 0) |
| 7 | Execution | Inngest Worker | Inngest CCR (lease + sweeper) | Invisible. | Fan-out to Katana + GHL Manufacturing mirror under a claim lease. | Systems · same day (cumulative ~Day 0) |
| 8 | Factory API | Katana ERP Sync | Katana = physical truth | Order is now a manufacturing job. | MO created with Idempotency-Key; GHL Manufacturing only mirrors. | Systems · same day (cumulative ~Day 0) |
| 9 | Full Map | GHL Mirror Sync | mfg-pipe · mfg-new | Add customer-facing language as you gather ops detail. | Node is live on the Full Map — enrich this story anytime. | Systems · same day (cumulative ~Day 0) |
| 10 | Materials | Factory / Purchasing | Inventory allocation check | Invisible — materials are being reserved. | Katana stock check: in-stock fast-tracks to chop saw; backorder enters 10-day procurement. | Systems · same day (cumulative ~Day 0) |
| 11 | Bypass | Vendor / Ops | Outsourced accessories hold | Umbrellas and pool chairs wait for in-house frames. | Bypasses fabrication pods — merges at Component Assembly / Marriage. | Systems · same day (cumulative ~Day 0) |
| 12 | Phase 5: Procurement wait (backorder buffer) | Purchasing | Procurement wait loop | Lead time buffer while extrusion stock is ordered. | 10-day SLA buffer · GHL Manufacturing → Purchasing / Receiving sync. | +10d · Procurement wait (backorder buffer) (cumulative ~Day 10) |
| 13 | Shop floor | Materials Staging | work-centers · wc-tube-stock | Marine-grade aluminum extrusion is being kitted. | Raw extrusion inventory pulled from tube stock racks. | Systems · same day (cumulative ~Day 10) |
| 14 | Full Map | GHL Mirror · Purchasing | mfg-pipe · mfg-purchasing | Add customer-facing language as you gather ops detail. | Node is live on the Full Map — enrich this story anytime. | Systems · same day (cumulative ~Day 10) |
| 15 | Phase 6: Chop saw cut & miter station | Chop Saw Operator | work-centers · wc-chop-saw | Extrusions are cut to length — no CNC laser or mandrel bending. | Precision chop saws: straight cuts, angles, miters, deburring. | +3d · Chop saw cut & miter station (cumulative ~Day 13) |
| 16 | Shop floor | Fab Pod 1 | work-centers · wc-cart-parts | Cut tube profiles are kitted onto mobile carts. | Cart-based WIP between cut station and fabrication pods. | Systems · same day (cumulative ~Day 13) |
| 17 | Shop floor | Fab Pod 1 · Tack | work-centers · wc-tack | Frame is jig-clamped and tacked. | First of three pod stations — tack before full weld-out. | Systems · same day (cumulative ~Day 13) |
| 18 | Manufacturing mirror | GHL Mirror · Production | mfg-pipe · mfg-production | Invisible — CRM shows active factory work. | Katana → GHL Manufacturing sync when frame enters Fabrication Pod. | Systems · same day (cumulative ~Day 13) |
| 19 | Shop floor | Fab Pod 1 · Weld Out | work-centers · wc-weld-out | Structural bead welding completes the frame. | Full structural welds; Gate A inspects dimension + weld quality next. | Systems · same day (cumulative ~Day 13) |
| 20 | Shop floor | Fab Pod 2 · Grinder | work-centers · wc-grinder | Weld seams are smoothed and prepped. | Weld seam smoothing before sub-frame marriage. | Systems · same day (cumulative ~Day 13) |
| 21 | Shop floor | Fab Pod 3 · Assembly | work-centers · wc-marriage | Modular sub-frames join into finished builds. | Marriage of pod outputs before Gate A weld/dim check. | Systems · same day (cumulative ~Day 13) |
| 22 | Phase 7: Fabrication pod weld-out (Gate A) | QC Inspector · Gate A | qc-gates · qc-a | Quality is being proven before coating. | Fail → NCR freeze + remake at weld. Pass → blast/powder. | +5d · Fabrication pod weld-out (Gate A) (cumulative ~Day 18) |
| 23 | Shop floor | Finishing Lead | work-centers · wc-cart-blast | Completed build rolled to surface prep. | Cart WIP between marriage and sandblast bay. | Systems · same day (cumulative ~Day 18) |
| 24 | Shop floor | Sandblast Operator | work-centers · wc-sandblast | Frame is media-blasted for coating adhesion. | Prep quality drives Gate B adhesion later. | Systems · same day (cumulative ~Day 18) |
| 25 | Shop floor | Powder Coat Tech | work-centers · wc-powder | Frame finish is being applied and cured. | Shop floor station; QC Gate B follows adhesion/DFT checks. | Systems · same day (cumulative ~Day 18) |
| 26 | Phase 8: Sandblast & powder coat (Gate B) | QC Inspector · Gate B | qc-gates · qc-b | Finish quality is locked. | Coating thickness + adhesion; fail returns to finishing. | +5d · Sandblast & powder coat (Gate B) (cumulative ~Day 23) |
| 27 | Phase 9: Custom upholstery & cushion sewing | Upholstery / Sewing | work-centers · wc-upholstery | Cushions and covers are being made to spec. | Parallel to metal once frames pass Gate B. | +4d · Custom upholstery & cushion sewing (cumulative ~Day 27) |
| 28 | Shop floor | Final Assembly Lead | work-centers · wc-final | Pieces become the finished suite. | Traveler complete before Gate C photo log. | Systems · same day (cumulative ~Day 27) |
| 29 | Phase 10: Final assembly & pre-pack (Gate C) | QC Inspector · Gate C | qc-gates · qc-c | Quality locked before shipping. | 360° photos can attach to GHL; NCR freezes remakes if fail. | +3d · Final assembly & pre-pack (Gate C) (cumulative ~Day 30) |
| 30 | Logistics | Dispatch Coordinator | dispatch-routes · dispatch-box | Local white-glove delivery scheduled. | In-house box truck route · Samsara / Onfleet. | Systems · same day (cumulative ~Day 30) |
| 31 | Phase 12: White-glove delivery | White-Glove Driver | White-glove delivery | Furniture placed and signed off on site. | Katana Delivered event starts financial clearance (retail/trade). | +5d · White-glove delivery (cumulative ~Day 35) |
| 32 | Warranty | Service Rep | warranty-pipe · warranty-closed | Replacement delivered; claim is done. | Warranty pipeline terminal; post-care may still fire. | Systems · same day (cumulative ~Day 35) |

---

## Role legend

| Category | Examples | Dashboard badge color |
| --- | --- | --- |
| **System / API** | Next.js Middleware, GHL Router, Katana sync | Slate / Cyan |
| **Sales & Design** | Showroom Rep, SketchUp Designer | Blue / Indigo |
| **Factory / Ops** | Fab Pod, QC Inspector, Chop Saw | Amber / Orange |
| **Logistics & Treasury** | Driver, Finance, QBO Matcher | Emerald / Green |

---

## SLA phase reference (56-day E2E)

1. **Lead ingestion → On-site scheduled** — 4d
2. **SketchUp 3D modeling & proposal** — 7d
3. **Produce FO → Client approval** — 3d
4. **Tube cut lists & BOM packet** — 2d
5. **Procurement wait (backorder buffer)** — 10d
6. **Chop saw cut & miter station** — 3d
7. **Fabrication pod weld-out (Gate A)** — 5d
8. **Sandblast & powder coat (Gate B)** — 5d
9. **Custom upholstery & cushion sewing** — 4d
10. **Final assembly & pre-pack (Gate C)** — 3d
11. **3-way dispatch routing** — 3d
12. **White-glove delivery** — 5d
13. **QBO/Clover financial reconciliation** — 2d

---

*CCPATIO Enterprise Infrastructure & Lifecycle · Cinematic Brain topology*
