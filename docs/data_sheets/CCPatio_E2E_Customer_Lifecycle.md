# CCPATIO END-TO-END CUSTOMER LIFECYCLE & STAGE MAPPING

**Purpose:** This document maps the physical movement of a customer opportunity across all GoHighLevel (GHL) pipelines, defining the exact human workflows and the automated middleware triggers.

## 1. INCEPTION (ENTRY FUNNELS)
Customers enter the ecosystem via three distinct pipelines before routing to Sales or Manufacturing.

**A. Leads Pipeline (Retail)**
* `New | Uncontacted`
* `Contacted | No Response`
* `Interested | Needs Follow Up`
* `Nurture | Needs Follow Up`
* `Website Order Form` *(Terminal stage -> Routes to Sales)*

**B. Trade Pipeline (B2B)**
* `Application Submitted`
* `Approved` *(Routes to Sales)*
* `Declined`

**C. Warranty Claims Pipeline (Service)**
* `Discovery` ➔ `Paused` ➔ `File Claim` ➔ `Claim Filed` ➔ `Claim Denied` ➔ `Claim Approved` ➔ `Selecting Colors`
* **Trigger Stage:** `Produce FO` *(Fires Middleware)*
* `Send To Manufacturing`
* `Claim Closed` *(Terminal)*

---

## 2. DESIGN & SALES (`Scottsdale | Sales` & `Solana Beach | Sales`)
Retail and Trade deals are processed here. Scottsdale utilizes `.D` (Design/Field) and `.S` (Sales) ownership prefixes.

1. `01.D - On-Site Scheduled`
2. `02.D - Sketchup Needed | Schedule Proposal` *(Human Engineering/BOM formulation)*
3. `03.S - Sketchup Done`
4. `04.S - Proposal Given | Follow Up`
5. `05.S - Finalize Finishes`
6. **Trigger Stage:** `06.D - Produce Factory Order` *(Fires Middleware)*
7. `07.S - Get Client Approval | Transfer to ...`
8. `08. Delivered` *(Terminal)*
9. `09. Lost` *(Solana Beach only)*

---

## 3. FACTORY OPERATIONS (`Manufacturing` Pipeline)
Triggered by the middleware upon Katana MO creation. Reflects real-time physical factory state.

* **Inception:** `New FO / New SO`
* **Hold States:** `Updated FO`, `Order Paused`, `Collect Payment`, `Schedule Delivery`, `Delivery Scheduled`
* **Active Production:** `Purchasing` ➔ `Receiving` ➔ `Production in Progress` ➔ `Ready for Delivery`
* **Terminal:** `Delivered | Rejected`

---

## 4. AUTOMATION TRIGGERS & MIDDLEWARE HANDOFFS

**GATE 1: Factory Dispatch (`mo_create`)**
* **Trigger:** Card dragged to `06.D - Produce Factory Order` (Sales) OR `Produce FO` (Warranty) AND `Status = Won`.
* **Action:** Middleware validates BOM, claims lease, creates Katana MO.
* **Sync:** Writes `katana_mo_id` to original GHL Opportunity. Creates mirror card in `Manufacturing` pipeline at `New FO / New SO`.

**GATE 2: Financial Clearance & Final Sync (`invoice_create`)**
* **Trigger:** Katana fires `Delivered` webhook (backed by hourly cron).
* **Action:** Middleware safely rotates QBO token, generates QBO Invoice, runs Clover POS reconciliation.
* **Sync:** Moves `Manufacturing` card to `Delivered | Rejected`. Moves original `Sales` card to `08. Delivered` (or Warranty to `Claim Closed`).
