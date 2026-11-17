---
name: PrimeView 25 Go-Live
overview: "Read-only grounded closeout plan from HEAD `9053cd1`: ship CCP-PH1 + PrimeView Phase 1 (25 of 74 core parents) by Dec 1 via six QCA-locked chunks—stale-server QA gate, order-pipe hardening, Hub finish/data enablement, 169-column CSV + live checkout smoke, then Phase C SOP/ownership packet—while deferring Phases 2–3 and all 3D/CAD/Oct 29–30 recipe repair work."
todos:
  - id: c2-stale-server
    content: "Chunk 2: launch-c2-stale-server-gate — BUILD_ID freshness check in proof-of-life + Playwright reuse"
    status: pending
  - id: pipe-hardening
    content: "Core pipe: soft-delete fallback, FRM-/sku_aliases/-ALU, finish-key aliases, ACF add-ons, resale MTO bypass"
    status: pending
  - id: hub-phase1-data
    content: "Phase 1 Hub data: relink katana IDs, MSRP/weight gaps, web_sellable finishes, TPS for 3 resale SKUs, sync_to_woo"
    status: pending
  - id: csv-smoke-live
    content: Generate 169-col Phase 1 CSV, signed Woo smoke (Make+Resale+add-ons), flip ORDER_PIPELINE_MODE=live
    status: pending
  - id: ccp-ph1-closeout
    content: "CCP-PH1 Phase C packet: SOPs, BOM/Phases 2–3 ownership transfer, Google Sheet retirement"
    status: pending
  - id: phases-2-3-gate
    content: Gate Phases 2–3 (49 parents) on Christian BOM completion; keep 3D/CAD/Oct overwrite out of scope
    status: pending
isProject: false
---

# Back-to-Basics Closeout & PrimeView 25-Product Go-Live Plan