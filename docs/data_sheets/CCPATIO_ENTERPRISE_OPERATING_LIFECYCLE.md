# CCPATIO ENTERPRISE OPERATING LIFECYCLE (MASTER BLUEPRINT)

**Primary System:** CCPATIO ENTERPRISE INFRASTRUCTURE & LIFECYCLE  
**Companion:** Topology dashboard (`topology/`) · `CCPatio_E2E_Customer_Lifecycle.md` · Master Build Plan V8

```
[Phase 0: Omnichannel Ingestion] ➔ [Phase 1: Pipeline Routing] ➔ [Phase 2: Design & CAD/CAM] ➔
[Phase 3: Sales & Contract] ➔ [Phase 4: Middleware Engine] ➔ [Phase 5: Factory Work Centers] ➔
[Phase 6: QC & Assurance] ➔ [Phase 7: Logistics] ➔ [Phase 8: Financial Settlement] ➔ [Phase 9: Post-Care]
```

## 0. Omnichannel Marketing & GHL Unified Ingestion

Before a card exists in a pipeline, GHL is the central ingestion engine for brand traffic, communications, and marketing funnels.

**Traffic & Ad Sources:** Meta Ads (IG/FB), Google Search/Max, Pinterest Design Showcase, SEO/Organic, Trade Shows.

**Communication Channels:** Inbound Phone/Voicemail (Twilio/GHL), Two-Way SMS/Text, WhatsApp Business, Web Chat (ccpatio.com), Social DMs (IG/FB Messenger), Email sequences.

**GHL Workflow Router:** Listens across channels, parses keywords/forms/call routes, assigns tags (`commercial`, `warranty`, `retail_az`), and creates the Opportunity in the correct pipeline.

## 1. GHL Pipeline Distribution (Inception)

| Pipeline | Path |
| --- | --- |
| **Leads (Retail)** | New → Contacted → Interested → Nurture → **Website Order Form** → Sales |
| **Trade / Commercial** | Application Submitted → **Approved** (+ Commercial tag) → Sales · Declined |
| **Warranty Claims** | Discovery → … → Selecting Colors → **Produce FO** (Gate 1) → Claim Closed |

## 2–3. Design & Sales

Field Survey (`01.D`) → SketchUp (`02.D`) → DXF/CAM/BOM → Sales (`03.S`–`05.S`) → **`06.D Produce Factory Order` + Won**.

Parallel franchises: **Scottsdale | Sales** · **Solana Beach | Sales**.

## 4. Middleware (V8)

HMAC Ingress → Redis L1 fail-open → Postgres Outbox + Saga freeze → CCR leases → Katana MO (`Idempotency-Key`) → GHL writeback + Manufacturing mirror.

## 5–6. Factory & QC

Stations 01–07 mirrored in GHL Manufacturing. QC Gates A/B/C + NCR remake travelers.

## 7–9. Logistics · Treasury · Post-Care

White-glove dispatch → Katana Delivered → QBO mutex/invoice → Clover fuzzy match → `08. Delivered` · NPS / care / warranty registry.
