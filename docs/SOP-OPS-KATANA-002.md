# CC PATIO FACTORY OPERATIONS MANUAL
## Standard Operating Procedure (SOP): Katana MRP, Shop Floor Execution & Automated QBO Ledger Integration

| Document Metadata | Details |
| :--- | :--- |
| **Document ID** | `SOP-OPS-KATANA-002` |
| **Version** | `v2.1 (Interactive Video Training Edition — Phases 1, 2 & 3)` |
| **Supersedes** | `CC_Patio_Katana_Factory_Manual_v1.docx (Phase 1 Crawl)` |
| **Middleware Stack** | CC Patio MDM Hub (Next.js 16.3 / Supabase / Inngest / Katana MRP / QuickBooks Online / GoHighLevel) |
| **Digital Portal** | `/embed/training` (Interactive Tablet Training Hub) |
| **Effective Date** | October 2026 |
| **Target Audience** | Receiving Dock, Warehouse Managers, Floor Foremen, Line Operators (Welders, Seamstresses, Finishers), Shipping & Fulfillment Managers |

---

## TABLE OF CONTENTS

1. [Section 1: System Architecture & The Golden Rules](#section-1-system-architecture--the-golden-rules)
   - 1.1 Overview of the CC Patio Connected Factory
   - 1.2 The Three Unbreakable Golden Rules
   - 1.3 Automated Financial & ERP Trigger Matrix
   - 1.4 Order Prefix & SKU Prefix Reference Guide
2. [Section 2: Role-Based SOP — Receiving Dock (`Buy` Screen)](#section-2-role-based-sop--receiving-dock-buy-screen)
   - 2.1 Receiving Raw Materials & Freight Deliveries
   - 2.2 Handling Partial Deliveries & Damaged Freight
3. [Section 3: Role-Based SOP — Warehouse Manager (`Stock` Screen)](#section-3-role-based-sop--warehouse-manager-stock-screen)
   - 3.1 Weekly Cycle Counting & Stock Adjustments
   - 3.2 Managing Showroom Holds (`HOLD-`) & Batch/Lot Integrity
4. [Section 4: Role-Based SOP — Floor Foreman (`Make` Screen: Schedule & `Tasks`)](#section-4-role-based-sop--floor-foreman-make-screen-schedule--tasks)
   - 4.1 Managing the Master Build Queue (`Make` -> `Schedule`)
   - 4.2 Checking Material Availability ("Ingredients") & Cut Cards
   - 4.3 Foreman Task Scheduling (`Make` -> `Tasks` View)
   - 4.4 Filtering by Physical Work Centers (Resources) & Bulk-Assigning Operators
   - 4.5 Final Quality Control & Closing Manufacturing Orders (`Done`)
5. [Section 5: Role-Based SOP — Line Operators: Phase 2 (Katana Shop Floor Control App)](#section-5-role-based-sop--line-operators-phase-2-katana-shop-floor-control-app)
   - 5.1 Tablet Station Setup & Operator Login (6-Digit PIN / QR Badge)
   - 5.2 Navigating Your Assigned Task Queue & Digital Cut Cards
   - 5.3 Mandatory Time Tracking (`Start` / `Pause` / `Finish`)
   - 5.4 Reporting Actual Material Usage, Scrap & Secondary Consumables
6. [Section 6: Role-Based SOP — Shipping Manager & Production Planner: Phase 3 (Fulfillment & Sub-Assemblies)](#section-6-role-based-sop--shipping-manager--production-planner-phase-3-fulfillment--sub-assemblies)
   - 6.1 Outbound Fulfillment & Marking Sales Orders `Delivered` (`Sell` Screen)
   - 6.2 Cushion Fulfillment Modes (Standard vs. Vacuum-Compressed)
   - 6.3 Executing Make-to-Stock (MTS) Orders for Generic Sub-Assemblies
7. [Section 7: Appendix — Daily Factory Checklists & Escalation Protocol](#section-7-appendix--daily-factory-checklists--escalation-protocol)

---

## SECTION 1: SYSTEM ARCHITECTURE & THE GOLDEN RULES

### 1.1 Overview of the CC Patio Connected Factory
Katana MRP is the central operational command system and **perpetual inventory sub-ledger** for the CC Patio Factory. It replaces all legacy Google Sheets, paper travelers, and manual clipboards.

Katana does not operate in isolation. It is directly wired into our custom **Next.js 16.3 / Supabase / Inngest Master Data Management (MDM) Hub**, which connects:
1. **GoHighLevel (GHL) Showroom Quoting Engine & 3D CAD Pipeline (Path A):** Extracts exact 3D SketchUp/Blender geometry, aluminum cut lengths, mitre angles, powder coat square footage, Sunbrella fabric yardage, and Industrial Engineering Standard Minute Values (SMVs).
2. **WooCommerce + VividWorks 3D CPQ (Path B):** Captures online custom-configured orders.
3. **Clover POS:** Captures showroom customer deposits.
4. **QuickBooks Online (QBO):** Executes real-time, automated General Ledger (GL) accounting via Inngest webhooks.

---

### 1.2 The Three Unbreakable Golden Rules

> ### 🚨 CRITICAL SYSTEM RULES — READ BEFORE TOUCHING KATANA 🚨
>
> **RULE #1: NEVER MANUALLY CREATE SALES ORDERS IN KATANA.**
> Sales Orders are automatically generated and pushed to Katana by our MDM Hub the exact second a customer pays their **50% deposit** in the showroom (via GoHighLevel / Clover POS) or completes checkout online (via WooCommerce). Creating a manual Sales Order in Katana breaks the webhook link to GoHighLevel and QuickBooks Online.
>
> **RULE #2: NEVER EDIT MASTER PRODUCT RECIPES.**
> If the 3D Engine extracts data incorrectly, DO NOT edit the Master BOM. The Foreman must adjust the 'Ingredients' on the specific Manufacturing Order, OR the Line Operator must report 'Actual Consumed' amounts on their tablet. Report all 3D errors to the MDM Admin.
>
> **RULE #3: EVERY BUTTON CLICK IN KATANA FIRES REAL MONEY INTO QUICKBOOKS ONLINE.**
> Katana is our perpetual inventory sub-ledger; QuickBooks Online (QBO) is our financial system of record. Changing a status to **`Received`**, **`Finish`**, **`Done`**, or **`Delivered`** immediately triggers automated accounting transactions in QBO. Never click a status change before the physical work is 100% verified.

---

### 1.3 Automated Financial & ERP Trigger Matrix

| Factory Role | Katana Screen / App | Action Taken in Katana | Automated Middleware & QBO Financial Result |
| :--- | :--- | :--- | :--- |
| **Showroom / Customer** | GHL Order Desk / Clover POS | Pays 50% Deposit | MDM Hub creates Katana Sales Order (`PA-*` or `GHL-*`), generates Manufacturing Orders (MOs), attaches 3D Cut Cards, and posts a **Customer Deposit Journal Entry** in QBO. |
| **Receiving Dock** | `Buy` Screen (Desktop/Tablet) | Marks Purchase Order **`Received`** | **Auto-creates an Accounts Payable (A/P) Vendor Bill in QBO** linked to the PO and debits Raw Materials Inventory. |
| **Line Operator** | **Shop Floor App** (Tablet) | Taps **`Start`** / **`Pause`** / **`Finish`** & confirms materials | **Auto-creates Direct Labor Absorption & Factory Overhead Journal Entries in QBO** based on tracked active time vs. SMV minutes. |
| **Floor Foreman** | `Make` Screen (Desktop) | Marks Manufacturing Order **`Done`** | **Auto-moves Raw Materials & WIP into the Finished Goods Asset account in QBO** via a balanced capitalization Journal Entry. |
| **Shipping Manager** | `Sell` Screen (Desktop) | Marks Sales Order **`Delivered`** | **Auto-recognizes Revenue & Cost of Goods Sold (COGS) in QBO**, relieves Finished Goods Inventory, and **updates the GHL Opportunity stage**. |

---

### 1.4 Order Prefix & SKU Prefix Reference Guide

#### Sales Order Prefixes (`Sell` & `Make` Screens)
* **`PA-<OpportunityID>`:** Custom Showroom / 3D CAD Order released after 50% deposit.
* **`GHL-<OpportunityID>`:** Standard Showroom Order released from GoHighLevel after 50% deposit.
* **`WOO-<OrderID>`:** E-Commerce 3D CPQ Order placed via WooCommerce.
* **`HOLD-<HoldID>`:** Temporary 14-day Showroom Inventory Reservation. **DO NOT MANUFACTURE OR SHIP `HOLD-` ORDERS** until they automatically convert to `GHL-` or `PA-` upon deposit payment.

#### Standardized SKU Prefixes
* **`FIN-*` (Finished Goods):** Complete, sellable patio furniture pieces (e.g., `FIN-OCN-CLUB-TJM`). Converges at Final QC and Assembly & Packaging.
* **`ASM-*-FRAME` (1st Floor Metal Sub-Assembly):** Raw welded and powder-coated aluminum frames built on the 1st Floor.
* **`ASM-*-CUSH` (2nd Floor Upholstery Sub-Assembly):** Sewn and stuffed cushion sets built on the 2nd Floor.
* **`STN-*` / Dekton (Specialty Stone Sub-Assembly):** Fabricated ultra-compact stone table tops.
* **`RM-*` / `FAB-*` / `PWD-*` / `FRM-*` (Raw Materials):** Aluminum extrusions, Sunbrella rolls, Tiger Drylac powder, Argon gas, blasting media, and packaging (`RM-PKG-CORRUGATE`, `RM-PKG-EDGE-BOARD`, `RM-PKG-STRETCH`).

---

## SECTION 2: ROLE-BASED SOP — RECEIVING DOCK (`BUY` SCREEN)

📺 **REQUIRED VIDEO TRAINING:** [Katana Purchasing & Receiving Full Demo (Watch from 2:00 - 4:30)](https://www.youtube.com/watch?v=fxxbW0robyA)

### 2.1 Receiving Raw Materials & Freight Deliveries
When a freight carrier arrives at the dock with aluminum extrusions, Sunbrella fabric rolls, powder coat boxes, Dekton slabs, or packaging supplies, the Receiving Dock Clerk must log the receipt in Katana **immediately upon unloading and physical verification**.

`[ 📸 INSERT SCREENSHOT HERE: Katana BUY screen showing the list of Open Purchase Orders and the Receive status dropdown ]`

#### Step-by-Step Procedure:
1. **Collect Documentation:** Obtain the physical Packing Slip and Bill of Lading (BOL) from the freight driver before signing for the delivery.
2. **Open the `Buy` Screen:** Log into Katana on the Receiving Station desktop and click the **`Buy`** tab in the top navigation bar.
3. **Locate the Purchase Order (PO):**
   * Search by **PO Number** (e.g., `PO-PA-...`) or filter by **Supplier Name** (e.g., *Sunbrella / Glen Raven*, *Tiger Drylac*, *Dekton*).
   * Click on the matching PO row to open the line-item detail view.
4. **Physical Count & Quality Inspection:**
   * Inspect all pallets, tubes, and rolls for freight damage prior to releasing the driver.
   * Count the physical units received and verify that the **Unit of Measure (UoM)** on the packing slip matches Katana (e.g., Linear Feet vs. 20ft Extrusion Sticks; Yards vs. Rolls; Pounds vs. Boxes).
5. **Update Status to `Received`:**
   * If 100% of the items on the PO arrived undamaged and match the expected quantities, click the **Delivery Status** dropdown at the top right of the PO and select **`Received`**.

> *** 💰 ACCOUNTING AUTOMATION NOTICE (PO RECEIVING): ***
> **The exact moment you click `Received` on a Purchase Order, our middleware automatically creates an Accounts Payable (A/P) Vendor Bill in QuickBooks Online and debits Raw Materials Inventory so ownership can pay the vendor.**
> * **NEVER** mark a PO as `Received` based on an emailed invoice or carrier tracking notice alone.
> * **ONLY** mark `Received` when the physical material is sitting on the CC Patio receiving dock and has been counted.

---

### 2.2 Handling Partial Deliveries & Damaged Freight
If a vendor short-ships an order (backordered items) or if items are rejected at the dock due to freight damage:

`[ 📸 INSERT SCREENSHOT HERE: Katana Purchase Order detail view highlighting the "Partially received" option and "Received quantity" column ]`

1. Open the Purchase Order on the **`Buy`** screen.
2. Do **NOT** click full `Received`. Instead, click the status dropdown and select **`Partially received`** (or click into the **Received** quantity column on each individual line item).
3. Enter the **exact physical quantity** unloaded in good condition today.
4. Leave the remaining backordered or damaged quantity unreceived so Katana keeps the PO open for the follow-up shipment and QuickBooks only bills for the materials actually accepted.
5. Note the carrier PRO number and any freight damage notes in the PO **Additional Info / Comments** field.

---

## SECTION 3: ROLE-BASED SOP — WAREHOUSE MANAGER (`STOCK` SCREEN)

📺 **REQUIRED VIDEO TRAINING:** [Katana Inventory Management Tutorial (Watch Full Video)](https://www.youtube.com/watch?v=c-JWBGA1mcY)

### 3.1 Weekly Cycle Counting & Stock Adjustments
To ensure the GoHighLevel Showroom Order Desk never sells a fabric or frame we do not physically have, and to ensure automated BOM shortage checks remain 100% accurate, the Warehouse Manager must perform scheduled cycle counts.

`[ 📸 INSERT SCREENSHOT HERE: Katana STOCK screen highlighting the "+" Global Add button -> "Stock adjustment" ]`

#### Step-by-Step Procedure:
1. **Open the `Stock` Screen:** Click the **`Stock`** tab in the top navigation bar.
2. **Verify Current System Stock:**
   * Filter between **Products** (`FIN-*`, `ASM-*`) and **Materials** (`FAB-*`, `FRM-*`, `PWD-*`, `RM-*`).
   * Review the **`In stock`** column (physical quantity on the shelf) versus the **`Committed`** column (allocated to open MOs/SOs) and **`Available`** column.
3. **Initiate a Stock Adjustment:**
   * Click the global **`+`** icon in the top-right corner of Katana and select **`Stock adjustment`** (or navigate to **`Stock`** $\rightarrow$ **`Stock adjustments`** sub-tab $\rightarrow$ **`+ Stock adjustment`**).
4. **Log the Adjustment:**
   * **Stock adjustment # / Reason:** Enter a standardized audit code and clear reason in the **Reason** field:
     * `CYCLE-COUNT: Weekly physical audit`
     * `DAMAGE-SCRAP: Forklift / water / warehouse damage`
     * `CUT-VARIANCE: Remnant / roll-end yardage reconciliation`
   * **Line Items:** Search for the exact SKU (e.g., `FAB-SUN-5404` *Sunbrella Canvas Natural*).
   * Enter the **Adjustment Quantity** (positive `+` or negative `-` delta) or update the **Actual In-Stock Quantity** so Katana matches the physical shelf count.
5. **Complete Adjustment:** Review the **Cost per unit** and total value impact, then click **`Done`** / **`Save`**.

> *** 💰 ACCOUNTING AUTOMATION NOTICE (INVENTORY SHRINKAGE & VALUATION): ***
> **Stock Adjustments directly modify our perpetual inventory sub-ledger quantities and valuation.** Unexplained negative adjustments represent inventory shrinkage. Any single stock adjustment exceeding **$250.00** in material value requires dual sign-off from the Factory Plant Manager in the **Reason** field.

---

### 3.2 Managing Showroom Holds (`HOLD-`) & Batch/Lot Integrity
* **Showroom Holds (`HOLD-*`):** When a Showroom Sales Rep places a 14-day hold on in-stock furniture in GoHighLevel, the MDM Hub creates a `HOLD-<id>` Sales Order in Katana. This moves the quantity into the **`Committed`** column so no other rep can sell it. Do **not** delete or manually fulfill `HOLD-` orders; our automated Inngest sweeper releases expired holds automatically after 14 days, or converts them to `GHL-` production orders upon deposit.
* **Dye Lot & Powder Batch Discipline:** Always store and pull Sunbrella rolls (`FAB-*`) and Tiger Drylac powder boxes (`PWD-*`) on a strict **First-In, First-Out (FIFO)** basis. Never mix two different Sunbrella dye lots on the same customer Sales Order.

---

## SECTION 4: ROLE-BASED SOP — FLOOR FOREMAN (`MAKE` SCREEN: SCHEDULE & `TASKS`)

📺 **REQUIRED VIDEO TRAINING:** [How Katana Smart Manufacturing Works (Watch from 0:45 - 2:20)](https://www.youtube.com/watch?v=OwoSsyzTtZg)

### 4.1 Managing the Master Build Queue (`Make` -> `Schedule`)
The **`Make`** tab is the master production control center for the 1st Floor (Metal & Powder), 2nd Floor (Upholstery), Specialty Stone Pod (Dekton), and Final Assembly & Packaging.

`[ 📸 INSERT SCREENSHOT HERE: Katana MAKE -> Schedule screen showing open Manufacturing Orders, Rank priority, and Ingredients status badges ]`

#### Understanding the Parallel Factory Topology:
Every custom customer order (`PA-*`, `GHL-*`, `WOO-*`) flows through CC Patio's parallel manufacturing tracks:
1. **1st Floor Metal Track (`ASM-*-FRAME`):** `Metal Cutting` $\rightarrow$ `FAB POD A / B / C` $\rightarrow$ `Sandblasting` $\rightarrow$ `Powder Coating Booth` $\rightarrow$ `Curing Oven`.
2. **2nd Floor Upholstery Track (`ASM-*-CUSH`):** `Fabric Cutting` $\rightarrow$ `Fabric Sewing` $\rightarrow$ `Cushion Stuffing` $\rightarrow$ `Quality Control`.
3. **Specialty Stone Track (`STN-*` / Dekton):** `Dekton Fabrication`.
4. **Convergence Track (`FIN-*`):** `Quality Control` $\rightarrow$ `Assembly & Packaging` (marries the completed frame, cushion set, stone top, hardware, and skid packaging).

#### Step-by-Step Queue Management:
1. Click the **`Make`** tab at the top of your screen (defaults to the **`Schedule`** sub-tab).
2. **Priority Ranking:** Manufacturing Orders (MOs) at the **top of the list (Rank 1, 2, 3...)** are the highest priority. Drag and drop rows using the left-hand grip handle to re-sequence priority based on Production Deadline and LTL freight pickup dates.
3. **Never Release Red Material Orders to the Floor:** Check the **`Ingredients`** column before releasing any MO to operators:
   * 🟢 **`In stock` (Green):** All required extrusions, fabrics, powder, and sub-assemblies are physically on hand. Safe to start.
   * 🟡 **`Expected` (Yellow):** Raw materials are on an open Purchase Order with an upcoming ETA. Hold until the Receiving Dock marks the PO `Received`.
   * 🔴 **`Not available` (Red):** Material shortage detected. Coordinate with Purchasing / Warehouse before starting work.

---

### 4.2 Checking Material Availability ("Ingredients") & Cut Cards
For custom Path A orders (`PA-*`), our MDM Hub attaches a cryptographically signed **Digital 3D Cut Card URL** (`/factory/cut-cards/[token]`) directly to the Manufacturing Order notes/additional info.
* Open the MO to verify that the 3D Cut Card link is present and displays the exact extrusion profiles, cut lengths, and mitre angles (`45°`, `90°`, etc.) before assigning the `Metal Cutting` task.

---

### 4.3 Foreman Task Scheduling (`Make` -> `Tasks` View)
While the **`Schedule`** view shows whole Manufacturing Orders, the **`Tasks`** view allows the Floor Foreman to schedule and dispatch individual work-center operations to specific shop-floor tablets.

`[ 📸 INSERT SCREENSHOT HERE: Katana MAKE -> Tasks view showing the Resource filter dropdown and Operator bulk-assignment checkboxes ]`

#### Step-by-Step Procedure:
1. Inside the **`Make`** tab, click the **`Tasks`** sub-tab in the upper-left corner (next to `Schedule`).
2. You will see a granular list of every individual operation step across all open Manufacturing Orders, ordered by **Manufacturing Order Rank** and **Operation Sequence (`10`, `20`, `30`, `40`, `50`)**.

---

### 4.4 Filtering by Physical Work Centers (Resources) & Bulk-Assigning Operators
CC Patio's Katana environment is locked to **13 canonical physical Work Centers (`Resources`)**. Never create custom resource names.

| Floor / Zone | Katana `Resource` Filter Name | Standard Operation Name | Primary Role |
| :--- | :--- | :--- | :--- |
| **1st Floor — Metal** | `Metal Cutting` | Cold Saw Fabrication (Seq 10) | Saw Operator |
| **1st Floor — Metal** | `FAB POD A` | Fabrication & Welding (Seq 20) | Master Welder — Pod A |
| **1st Floor — Metal** | `FAB POD B` | Fabrication & Welding (Seq 20) | Master Welder — Pod B |
| **1st Floor — Metal** | `FAB POD C` | Fabrication & Welding (Seq 20) | Master Welder — Pod C |
| **1st Floor — Finishing** | `Sandblasting` | Sandblast (Seq 30) | Blast Booth Operator |
| **1st Floor — Finishing** | `Powder Coating Booth` | Powder Coat — Active Labor (Seq 40) | Powder Tech |
| **1st Floor — Finishing** | `Curing Oven` | Cure — Passive Oven Dwell (Seq 50) | Powder Tech |
| **2nd Floor — Soft Goods** | `Fabric Cutting` | Fabric Cut (Seq 10) | Cutter / CNC Table Operator |
| **2nd Floor — Soft Goods** | `Fabric Sewing` | Sew (Seq 20) | Seamstress |
| **2nd Floor — Soft Goods** | `Cushion Stuffing` | Stuff (Seq 30) | Cushion Finisher |
| **Specialty Pod — Stone** | `Dekton Fabrication` | Dekton Fabrication (Seq 10) | Stone CNC / Saw Operator |
| **Convergence — Final** | `Quality Control` | Upholstery QC (Seq 40) / Final QC (Seq 10) | QC Inspector |
| **Convergence — Final** | `Assembly & Packaging` | Assemble & Pack (Seq 20) | Pack & Skid Crew |

#### How to Filter and Bulk-Assign Tasks Every Morning (6:45 AM Shift Huddle):
1. **Filter by Work Center (`Resource`):**
   * On the **`Make` -> `Tasks`** screen, click the **`Resource`** column filter header.
   * Select a single physical cell (for example, **`Metal Cutting`** or **`Powder Coating Booth`** or **`FAB POD A`**).
   * Filter **`Status`** to show **`Not started`** and **`In progress`** tasks.
2. **Load-Level Welding Pods (`FAB POD A`, `FAB POD B`, `FAB POD C`):**
   * By default, standard tracks route welding to **`FAB POD A`**.
   * If `FAB POD A` has a backlog exceeding 1 shift of SMV hours, click the **`Resource`** dropdown on overflow MOs and re-route them to **`FAB POD B`** or **`FAB POD C`** to balance welding capacity across pods.
3. **Bulk-Assign Tasks to Specific Operators:**
   * Select the checkboxes on the left side of the task rows you want to schedule for a specific operator's shift (e.g., selecting the top 8 `Metal Cutting` tasks for the morning saw operator, or grouping all `Powder Coating Booth` tasks sharing the same *Tiger Drylac Matte Black* color code to minimize booth changeover).
   * Click the **`Bulk actions`** bar (or the **`Operators`** column dropdown on the selected rows).
   * Select the specific Operator's name from the list and apply.
   * Those tasks immediately appear at the top of that Operator's personal queue on their **Katana Shop Floor App** tablet.

---

### 4.5 Final Quality Control & Closing Manufacturing Orders (`Done`)
As operators complete their assigned steps on the Shop Floor tablets, individual task statuses turn green (`Completed`).

1. When all operations on a Manufacturing Order are finished—and the physical piece has passed **`Quality Control`** and **`Assembly & Packaging`**—the MO status will advance or await final Foreman sign-off.
2. Verify that all **Ingredients** (raw materials) and **Operations** (labor steps) on the MO show accurate actual quantities and times.
3. Click the **Manufacturing Order Status** dropdown and change it to **`Done`** (if not already auto-completed by the final Shop Floor task).

> *** 💰 ACCOUNTING AUTOMATION NOTICE (MO COMPLETION & WIP CAPITALIZATION): ***
> **The exact moment a Manufacturing Order is marked `Done`, our middleware fires the `katana/manufacturing_order.done` webhook and automatically posts a balanced Journal Entry in QuickBooks Online:**
> * **Debits** the **Finished Goods Inventory Asset** account for the total manufactured cost.
> * **Credits** **Raw Materials / WIP Inventory** (aluminum, powder, Sunbrella, argon gas, blasting sand, and skid packaging).
> * **Credits** **Applied Direct Labor & Factory Overhead Absorption** based on completed operation times.
>
> **Accuracy is mandatory!** Never mark an MO `Done` if a sub-assembly or operation was skipped or if defective parts are still being reworked.

---

## SECTION 5: ROLE-BASED SOP — LINE OPERATORS: PHASE 2 (KATANA SHOP FLOOR CONTROL APP)

📺 **REQUIRED VIDEO TRAINING:** [How Katana Smart Manufacturing Works (Watch from 2:20 - End for Shop Floor UI)](https://www.youtube.com/watch?v=OwoSsyzTtZg)

> **APPLICABLE ROLES:** Cold Saw Operators, Welders (`FAB POD A/B/C`), Sandblasters, Powder Coat Technicians, Fabric Cutters, Seamstresses, Cushion Stuffers, Stone Fabricators, QC Inspectors, and Packaging Crew.

All shop-floor personnel interact with Katana exclusively through the **Katana Shop Floor App** mounted on ruggedized iPad/Android tablets at each physical workstation. **Line operators never use the desktop manager interface.**

---

### 5.1 Tablet Station Setup & Operator Login (6-Digit PIN / QR Badge)

`[ 📸 INSERT SCREENSHOT HERE: Katana Shop Floor App tablet login screen showing Operator selection and 6-digit PIN keypad ]`

#### Step-by-Step Login Procedure:
1. **Wake the Workstation Tablet:** Open the **Katana Shop Floor App** (or Chrome in Kiosk Mode at `shop.katanamrp.com`) mounted at your work center.
2. **Authenticate Your Identity:**
   * **Option A — 6-Digit PIN Code:** Tap your name on the Operator list and enter your personal **6-digit PIN code** on the on-screen keypad.
   * **Option B — Employee QR Badge:** Tap **Scan QR Code** and hold your laminated Employee ID badge in front of the tablet camera to log in instantly.
3. **Badge-Out Rule:** Never operate under another employee's login. Always tap **`Log out`** (top-right profile icon) when leaving your workstation for lunch or at the end of your shift.

---

### 5.2 Navigating Your Assigned Task Queue & Digital Cut Cards

`[ 📸 INSERT SCREENSHOT HERE: Katana Shop Floor App My Tasks queue showing chronological order, Resource name, Product SKU, and Notes/Cut Card link ]`

1. Once logged in, the tablet defaults to your personal **`My Tasks`** queue.
2. **Strict Top-Down Execution:** Tasks are sorted in priority order by the Floor Foreman. **Always work from the top of your queue down.** Do not cherry-pick easier orders further down the list unless explicitly instructed by the Foreman (e.g., batching identical powder coat colors).
3. **Open the Task Detail & Cut Card:**
   * Tap on the top task to open its execution panel.
   * Review the **Product Name / SKU** (e.g., `ASM-OCN-CLUB-FRAME` or `ASM-OCN-CLUB-CUSH`), **Target Quantity**, and **Order Notes**.
   * **For Metal Cutting & Welding (`FAB POD A/B/C`):** Tap the attached **Digital Cut Card link** (`/factory/cut-cards/[token]`) in the task notes to view the 3D render, exact extrusion tube profiles, cut lengths (in inches/mm), and left/right mitre angles.
   * **For Sewing & Stuffing (`Fabric Cutting`, `Fabric Sewing`, `Cushion Stuffing`):** Verify the exact `FAB-SUN-*` SKU, welt/piping specification, and whether the order requires **Standard** or **Vacuum-Compressed** cushion fulfillment.

---

### 5.3 Mandatory Time Tracking (`Start` / `Pause` / `Finish`)

`[ 📸 INSERT SCREENSHOT HERE: Katana Shop Floor App task execution screen highlighting the green START button, yellow PAUSE button, and blue FINISH button ]`

Every operation in Katana is pre-engineered with an Industrial Engineering **Standard Minute Value (SMV)**. However, our accounting system requires your **exact actual start and stop times** on the tablet.

#### How to Use the Task Timer Buttons:
1. **🟢 `START` (Green Button):**
   * Tap **`Start`** the exact moment you begin physical setup or production on the order (e.g., loading the extrusion onto the cold saw, clamping the weld jig in `FAB POD A`, or laying out the Sunbrella roll on the cutting table).
   * **Rule:** You may only have **ONE** active task running at a time (except passive dwell inside `Curing Oven`).
2. **🟡 `PAUSE` (Yellow Button):**
   * Tap **`Pause`** immediately whenever you stop actively working on the task for **more than 3 minutes**, including:
     * Morning/afternoon breaks or lunch.
     * Waiting on forklift material handling or crane assistance.
     * Machine maintenance, saw blade change, welding gas cylinder swap, or sewing bobbin/needle jam.
     * Switching to a hot rush order at the Foreman's direction.
   * When you return to the workpiece, tap **`Start` / `Resume`** to continue timing.
3. **🔵 `FINISH` (Blue/Checkmark Button):**
   * Tap **`Finish`** the exact moment the physical operation is 100% complete, self-inspected, and placed in the outbound staging rack for the next workstation.

> *** 💰 ACCOUNTING AUTOMATION NOTICE (SHOP FLOOR TIME TRACKING & LABOR ABSORPTION): ***
> **Accurate `Start`, `Pause`, and `Finish` times on the Katana Shop Floor App are MANDATORY for QuickBooks Online (QBO) Direct Labor Absorption.**
> * Our middleware reads your completed task timestamps and compares them against the engineered SMV minutes to auto-create **Direct Labor Absorption and Factory Overhead Journal Entries in QBO**.
> * **NEVER "batch-click" `Start` and `Finish` back-to-back at the end of your shift.** Doing so records `0m 02s` of labor time, which understates Finished Goods inventory value on the balance sheet and corrupts job-costing variance reports.
> * **NEVER leave a task running overnight.** An unpaused timer left running for 16 hours overnight will inject massive false labor cost into the Manufacturing Order and trigger a QBO Ledger Triage exception.

---

### 5.4 Reporting Actual Material Usage, Scrap & Secondary Consumables

When you tap **`Finish`** on a task that consumes raw materials (or via the **`Ingredients`** tab inside the Shop Floor App before finishing), Katana prompts you to confirm the **Actual Material Consumed**.

`[ 📸 INSERT SCREENSHOT HERE: Katana Shop Floor App "Consumed Materials / Ingredients" confirmation modal when finishing a task ]`

#### Step-by-Step Material Reporting:
1. **Review Planned Quantity:** The modal displays the **Planned Quantity** extracted from our 3D CAD BOM (which already includes a standard mathematical scrap factor).
2. **100% Match (Normal Build):** If you used the exact planned amount of aluminum extrusions, Sunbrella yardage, or packaging materials, tap **`Confirm`** / **`Complete`**.
3. **Reporting Excess Scrap, Recuts, or Flaws:**
   * If you had to re-cut an aluminum tube due to a mitre error (`Metal Cutting`), or cut an extra **1.5 yards** of Sunbrella fabric to bypass a mill flaw (`Fabric Cutting`), **you MUST update the `Actual Consumed` field** to reflect the true total quantity pulled from the rack.
   * **Why this matters:** Updating the actual consumed quantity in the Shop Floor App immediately deducts the extra material from Katana **`Stock`** (preventing ghost inventory in the showroom) and includes the true material cost in the QBO WIP-to-Finished-Goods Journal Entry.
4. **Secondary Extraction & Packaging Consumables:**
   * Note that shielding gas (`Argon`), blasting media (`Sand`), and freight packaging (`RM-PKG-CORRUGATE`, `RM-PKG-EDGE-BOARD`, `RM-PKG-STRETCH`) are automatically pre-calculated on the BOM by our physics engine. Verify packaging consumption during the **`Assembly & Packaging`** step.

---

## SECTION 6: ROLE-BASED SOP — SHIPPING MANAGER & PRODUCTION PLANNER: PHASE 3 (FULFILLMENT & SUB-ASSEMBLIES)

### 6.1 Outbound Fulfillment & Marking Sales Orders `Delivered` (`Sell` Screen)
Once the `FIN-*` Manufacturing Order is marked **`Done`** on the `Make` screen, the physical furniture is wrapped, strapped to its pallet/skid, and staged in the Outbound Shipping Bay.

`[ 📸 INSERT SCREENSHOT HERE: Katana SELL screen showing Sales Orders with "Product Availability: In Stock" and "Delivery Status" dropdown ]`

#### Step-by-Step Outbound Shipping Procedure:
1. **Open the `Sell` Screen:** Click the **`Sell`** tab in the top navigation bar.
2. **Locate Ready-to-Ship Orders:**
   * Filter the **`Sales items`** (Product Availability) column to **`In stock` (Green)** and **`Manufacturing`** status to **`Done`**.
   * Verify the order prefix (`PA-*`, `GHL-*`, or `WOO-*`). **Reminder:** Never ship a `HOLD-*` row.
3. **Stage & Pack (`Packed` Status):**
   * Print the Packing Slip and verify every line item on the Sales Order against the physical skids/boxes staged on the dock.
   * Confirm carrier routing from the order notes (Priority1 LTL, FedEx Freight, Shippo Parcel, or CC Patio Internal Fleet White-Glove Delivery).
   * Change the Sales Order **Delivery Status** from `Not shipped` to **`Packed`** while staged for carrier pickup.
4. **Final Dispatch (`Delivered` Status):**
   * Once the LTL freight driver signs the Bill of Lading (BOL) and departs the dock—or our Internal Fleet driver completes delivery—open the Sales Order on the **`Sell`** screen, record the **Tracking / PRO Number**, and change the status dropdown to **`Delivered`** (or **`Partially delivered`** for split shipments).

> *** 💰 ACCOUNTING AUTOMATION NOTICE (SO DELIVERY, REVENUE RECOGNITION & GHL SYNC): ***
> **The exact moment you mark a Sales Order `Delivered` on the `Sell` screen, our middleware fires `katana/sales_order.delivered` and executes three irreversible automations:**
> 1. **QBO Revenue Recognition:** Converts the unearned **Customer Deposit Liability** into earned **Product & Freight Revenue (`85 Sales of Product Income`)** and generates the final commercial Invoice/ledger entry in QuickBooks Online.
> 2. **QBO COGS Recognition:** Moves the exact manufactured cost of the furniture out of the **Finished Goods Asset** account and into **Cost of Goods Sold (`5000 COGS`)** in QuickBooks Online.
> 3. **GoHighLevel (GHL) CRM Sync:** Automatically updates the customer's **GHL Opportunity** status and writes the fulfillment completion timestamp back to the showroom sales team.
>
> **NEVER mark a Sales Order `Delivered` before the shipment has physically left the dock or while a customer balance hold is unresolved.**

---

### 6.2 Cushion Fulfillment Modes (Standard vs. Vacuum-Compressed)
Check the Manufacturing Order / Sales Order notes during **`Assembly & Packaging`**:
* **Standard Mode (`standard`):** Cushions are married directly to the powder-coated frame on the LTL skid and wrapped with edge board (`RM-PKG-EDGE-BOARD`) and stretch film (`RM-PKG-STRETCH`).
* **Vacuum-Compressed Mode (`vacuum_compressed`):** Adds `+15.0 SMV minutes` to packaging labor. Cushions are vacuum-sealed in heavy-duty compression bags and packed into corrugated parcel/skid cartons (`RM-PKG-CORRUGATE`) to reduce LTL freight class and cubic volume.

---

### 6.3 Executing Make-to-Stock (MTS) Orders for Generic Sub-Assemblies
While custom finished goods (`FIN-*`) are strictly **Make-to-Order (MTO)** and driven by automated GHL/WooCommerce webhooks, the Factory Plant Manager / Production Planner is authorized to run **Make-to-Stock (MTS)** batches for **generic, high-velocity sub-assemblies** during off-peak capacity windows.

`[ 📸 INSERT SCREENSHOT HERE: Katana MAKE screen highlighting "+ Manufacturing order" for an ASM-* Sub-Assembly Make-to-Stock batch ]`

#### Approved MTS Sub-Assembly Categories:
* **Raw Unfinished Welded Frames (`ASM-*-RAW` / `ASM-*-FRAME` in standard base colors):** High-runner Club Chair, Dining Chair, and Ottoman frames welded in batches of 10–25 units to maximize `Metal Cutting` and `FAB POD A/B/C` jig efficiency.
* **Standard Uncovered Foam Inserts / Muslin Cores & High-Velocity Stock Cushions (`ASM-*-CUSH`):** Pre-cut DACRON/foam cores or standard Quick-Ship Sunbrella Canvas Natural (`FAB-SUN-5404`) cushion sets.

#### How to Create and Execute a Make-to-Stock (MTS) Sub-Assembly Order:
1. **Verify Rule #1 & Rule #2 Compliance:**
   * You are **never** creating a new product recipe or a customer Sales Order. You are only ordering a stock replenishment batch of an **existing, MDM-approved `ASM-*` Sub-Assembly SKU**.
2. **Initiate the MTS Manufacturing Order:**
   * Click the global **`+`** button at the top right of Katana and select **`Manufacturing order`** (or click **`+ Manufacturing order`** on the **`Make`** screen).
3. **Select the Existing Sub-Assembly SKU:**
   * In the **Product** field, search for the approved `ASM-*` SKU (e.g., `ASM-OCN-CLUB-FRAME` or `ASM-OCN-CLUB-CUSH-CORE`).
   * Enter the **Planned Quantity** (e.g., `20 pcs`) and set the **Production Deadline**.
   * **Notice:** Because this order is created directly on the `Make` screen without a linked Customer Sales Order, Katana automatically classifies it as a **Make-to-Stock (MTS)** order.
4. **Floor Execution & Shop Floor App:**
   * The MTS order populates in the **`Make` -> `Schedule`** and **`Make` -> `Tasks`** queues just like any other order.
   * The Foreman assigns the tasks to operators (`Metal Cutting`, `FAB POD A`, `Fabric Cutting`, `Fabric Sewing`, etc.), and operators MUST track their `Start` / `Pause` / `Finish` times on the tablets as normal.
5. **Completion (`Done`) & Automatic Sub-Assembly Allocation:**
   * When the MTS batch is finished and marked **`Done`**, Katana places the 20 completed sub-assemblies directly into **`Stock`** (`In stock` column).
   * **Automated Downstream Benefit:** The next time a customer pays a 50% deposit in GoHighLevel for a finished good (`FIN-OCN-CLUB-*`) that uses that sub-assembly, Katana sees the `ASM-*` sub-assembly **`In stock` (Green)** and automatically reserves it—allowing the factory to skip raw frame fabrication and jump straight to powder coat/final assembly!

> *** 💰 ACCOUNTING AUTOMATION NOTICE (MAKE-TO-STOCK SUB-ASSEMBLIES): ***
> **Marking an MTS Sub-Assembly Manufacturing Order as `Done` triggers the exact same QBO Capitalization webhook (`katana/manufacturing_order.done`) as a customer order.** Raw materials and absorbed direct labor are capitalized into Inventory Asset in QuickBooks Online so our balance sheet reflects the true value of pre-built frames and cushions sitting on the rack.

---

## SECTION 7: APPENDIX — DAILY FACTORY CHECKLISTS & ESCALATION PROTOCOL

### 7.1 Daily Role Checklists

#### Receiving Dock Clerk
- [ ] Inspect all inbound freight for damage before signing carrier BOL.
- [ ] Match every delivery to an open PO on the **`Buy`** screen.
- [ ] Mark full deliveries **`Received`** or short deliveries **`Partially received`** within **15 minutes** of unloading.

#### Floor Foreman (1st Floor Metal & 2nd Floor Upholstery)
- [ ] **6:45 AM:** Review **`Make` -> `Schedule`**, verify `Ingredients` are Green (`In stock`), and verify 3D Cut Cards are attached.
- [ ] **6:50 AM:** Open **`Make` -> `Tasks`**, filter by each physical **`Resource`** (`Metal Cutting`, `FAB POD A/B/C`, `Sandblasting`, `Powder Coating Booth`, `Curing Oven`, `Fabric Cutting`, `Fabric Sewing`, `Cushion Stuffing`, `Dekton Fabrication`, `Quality Control`, `Assembly & Packaging`), and bulk-assign shifts to operators.
- [ ] **Mid-Shift & End-of-Shift:** Audit the `Tasks` view to ensure no operator has left an active timer running during lunch or after clocking out.
- [ ] **Continuous:** Inspect completed builds and mark verified Manufacturing Orders **`Done`**.

#### Line Operators (Shop Floor Tablets)
- [ ] Log into the **Katana Shop Floor App** using your personal **6-Digit PIN** or **QR Badge**.
- [ ] Work strictly from the top of **`My Tasks`** downward.
- [ ] Open the **3D Digital Cut Card** link before cutting or welding.
- [ ] Tap **`Start`** when beginning work, **`Pause`** for any break/interruption $>3$ minutes, and **`Finish`** immediately upon completion.
- [ ] Report any extra scrap or recut yardage/footage in the **Ingredients** confirmation screen before finishing.

#### Warehouse & Shipping Manager
- [ ] Check **`Sell`** screen for orders with `Sales items: In stock` and `Manufacturing: Done`.
- [ ] Mark staged orders **`Packed`**, capture carrier BOL/PRO tracking, and mark **`Delivered`** immediately upon truck departure.
- [ ] Execute Friday afternoon cycle counts on the **`Stock`** screen via **Stock Adjustments**.

---

### 7.2 Exception & Escalation Protocol ("Stop-Work Conditions")
If you encounter any of the following conditions on the shop floor, **STOP** and escalate immediately to the Plant Manager / MDM Administrator:
1. **Missing SKU or Missing Recipe:** An order appears in Katana with missing operations or zero BOM ingredients. *(Do NOT manually type ingredients into Katana; the MDM Airlock must re-sync the recipe).*
2. **Post-Deposit Customer Change Request:** A showroom rep asks the floor to change a fabric or frame finish via verbal request, Slack, or text message. *(Refuse verbal changes; all changes must flow through GoHighLevel / MDM Hub so Katana and QBO stay synchronized).*
3. **Accidental Status Click (`Received`, `Done`, or `Delivered`):** If you accidentally mark a PO `Received`, an MO `Done`, or an SO `Delivered` prematurely, notify the Plant Manager & Accounting **immediately** with the Document Number (`PO-#`, `MO-#`, or `PA-/GHL-/WOO-#`) so the QBO Journal Entry / Bill can be reconciled in the MDM Ledger Triage queue.
