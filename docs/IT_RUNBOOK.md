# CC Patio MDM Hub — IT Runbook

**Audience:** Mid-level IT administrators  
**Owner:** Client IT (day-to-day) · React/Node developer (mapper/schema changes only)  
**Binding architecture:** [`MDM_MASTER_BLUEPRINT.md`](./MDM_MASTER_BLUEPRINT.md)

---

## 1. Architecture Summary

This application is a **Master Data Hub**, not an order processor.

| Stage | What happens |
|--------|----------------|
| SketchUp | CAD export posts a BOM draft to `/api/webhooks/sketchup` (HMAC-signed). |
| Quarantine | Operators enrich MSRP / SEO at `/admin/quarantine` and click **Approve**. |
| Fan-out | Approve queues an Inngest job (`publish-approved-product`) that creates/updates catalog items in **Katana**, **WooCommerce**, and **Clover**. |

**What this system does *not* do**

- It does **not** create sales orders, manufacturing orders, invoices, or deposits.
- Live storefront / POS / accounting **transactions** stay on **native vendor connectors** (see §5).
- Failed Zod validation on SketchUp ingest returns HTTP `400` and does **not** page developers — fix the CAD payload and re-export.

If something “didn’t sell” or “inventory is wrong,” look at Katana ↔ Woo / Clover / QBO connectors first — not this repo’s Approve button.

---

## 2. Secret Management & Key Rotation

### Where secrets live

| Environment | Where to edit |
|-------------|----------------|
| Production | **Vercel** → Project → Settings → Environment Variables |
| Database / Auth / Storage | **Supabase** Dashboard (project settings, API keys, Storage) |
| Local laptop | `.env.local` (never commit; copy from `.env.example`) |

After rotating a production secret in Vercel, **redeploy** (or restart) so the new value is loaded.

### Keys this hub uses

| Secret | Purpose | How to rotate |
|--------|---------|----------------|
| `KATANA_PERSONAL_ACCESS_TOKEN` (or legacy `KATANA_API_KEY`) | Katana catalog API | Katana → Settings → API → create new personal access token → update Vercel → revoke old token |
| `WOOCOMMERCE_URL` + `WOOCOMMERCE_CONSUMER_KEY` + `WOOCOMMERCE_CONSUMER_SECRET` | WooCommerce **catalog** REST (not order webhooks) | WooCommerce → WooCommerce → Settings → Advanced → REST API → Add key (Read/Write) → update Vercel → revoke old key |
| `CLOVER_API_TOKEN` + `CLOVER_MERCHANT_ID` | Clover inventory items | Clover Dashboard → API tokens / app credentials → issue new token → update Vercel → revoke old |
| `SKETCHUP_WEBHOOK_SECRET` | HMAC for header `X-CCPatio-Signature` | Generate a long random string → update Vercel **and** the SketchUp exporter config to the same value |
| `RESEND_API_KEY` + `OH_CRAP_ADMIN_EMAIL` | Ops alert email (“Oh-Crap”) | Resend dashboard → API keys → create/revoke; set `OH_CRAP_ADMIN_EMAIL` to the IT distribution list |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Durable jobs + cron | Inngest Cloud → app keys → rotate → update Vercel |
| `POSTGRES_URL` | Hub database (Drizzle) | Supabase → Database → connection string (prefer pooled URI for serverless) |
| `PIM_SESSION_SECRET` | Operator session cookies for `/admin/*` | Generate new random secret → update Vercel → operators must sign in again |

**Never** paste tokens into Slack, tickets, or this runbook. **Never** put secrets in `NEXT_PUBLIC_*` variables.

### Daily token check

Every day at **06:00** (server cron), Inngest runs **`system.health.ping`**. It performs a lightweight authenticated GET against Katana, WooCommerce, and Clover.

If any spoke returns **401** or **403**, Resend emails **`OH_CRAP_ADMIN_EMAIL`** naming which system’s token needs rotation. You do **not** need an Approve click for this alert.

---

## 3. Inngest DLQ & Retry Guide

This hub has **no custom dead-letter UI**. Partial failures (e.g. Katana OK, Clover 504) are visible in **Inngest Cloud**.

### Steps

1. Open [Inngest Cloud](https://app.inngest.com) and select the **ccpatio-middleware** (or your deployed) app.
2. Go to **Functions** (or **Runs**).
3. Find **`publish-approved-product`** (catalog Approve fan-out) or **`system.health.ping`** (daily token check).
4. Open a **failed** run. Read the step error (e.g. `Clover unauthorized (401)`, `HTTP 504`).
5. Fix the underlying cause first:
   - **401 / 403** → rotate the named token (§2), redeploy if needed.
   - **429 / 5xx** → often transient; wait, then retry.
6. Click **Retry** on that run (or the failed step, if offered).

### Why Retry is safe

Each spoke writes a `channel_sync` row. When status is already **`success`**, that spoke **no-ops** on Retry. A successful Katana publish will **not** create a second Katana product when only Clover is retried.

### Double-Approve protection

`publish-approved-product` allows only **one concurrent run per SKU**. Operators can click Approve twice; Inngest will not double-create catalogs for the same `globalSku` race.

---

## 4. Escalation Matrix

| Situation | Who owns it | Action |
|-----------|-------------|--------|
| Token expired / 401 / 403 Oh-Crap email | **IT** | Rotate key (§2), Retry Inngest run |
| Transient 429 / 502 / 504 on one spoke | **IT** | Wait / Retry in Inngest; if persistent, check vendor status page |
| SketchUp webhook `401` (bad signature) | **IT** | Align `SKETCHUP_WEBHOOK_SECRET` with the exporter |
| SketchUp webhook `400` with Zod field errors | **CAD / ops** | Fix export payload; re-send. No developer required |
| Approve blocked (MSRP required when Woo/Clover on) | **Ops** | Enter MSRP in Quarantine UI |
| Wrong price/SEO after Approve | **Ops** | Edit dictionary / commerce fields; ask for **republish** process if configured — do not hand-edit three systems forever |
| Katana / Woo / Clover **API shape** changed (e.g. Katana `v2`, new required fields) | **Hire React/Node developer** | Update `src/mappers/*.ts` and publish helpers; unit tests required |
| New database columns / BOM rules / Quarantine UI behavior | **Developer** | Schema + migrations + App Router changes |
| Need a custom “redrive” admin page or WordPress plugin | **Do not build** | Use Inngest Retry + native connectors |

**Rule of thumb:** If rotating a secret or clicking Retry fixes it, stay in IT. If code in `src/mappers/` must change, escalate to a developer.

---

## 5. Native Connector Checklist (outside this codebase)

Configure and monitor these **in the vendor products themselves**. This middleware does not own them.

| Integration | Purpose | IT action |
|-------------|---------|-----------|
| **Katana ↔ WooCommerce** (native) | Live **orders** and **inventory** sync | Enable/verify in Katana + Woo apps; do not re-build in this repo |
| **Katana ↔ QuickBooks Online** (native) | **COGS** / accounting | Enable/verify Katana↔QBO connector; invoice/COGS issues are not MDM bugs |
| Clover payments / deposits | Storefront / POS money movement | Clover + accounting tools — not Approve fan-out |

If a customer paid and the factory never saw the order, debug **native order connectors**, not `/admin/quarantine`.

---

## 6. Data Governance

### SKU policy

| Prefix | Meaning |
|--------|---------|
| `FIN-*` | Finished goods (sellable catalog roots) |
| `SA-*` | Sub-assemblies (welded / intermediate) |
| `RM-*` | Raw materials |

- Hub SKUs are minted on **Approve** and must stay unique.
- Do **not** invent colliding SKUs that clash with unmanaged legacy Katana codes (especially historical `BRA-*` style leftovers). Do not remap unmatched legacy SKUs in this hub.
- Dictionary edits for **already-approved** rows do not automatically fan out; fan-out is Approve → Inngest (or an explicit republish when provided).

### Supabase / Hub tables

- Hub tables (`sku_mappings`, `product_bom`, `product_intake`, `channel_sync`, etc.) are accessed by the **Next.js server** via `POSTGRES_URL` (Drizzle).
- **Do not** expose these hub tables on the public Supabase **Data API** (PostgREST) for anonymous or broad client access.
- Keep **RLS** enabled on exposed schemas; prefer server-only service role for privileged writes.
- Storage for product images may use Supabase Storage; the **service role key** is server-only — never ship it to the browser.

### Useful URLs (ops)

| Path | Use |
|------|-----|
| `/admin/quarantine` | Review drafts, Approve / Reject |
| `/admin/dictionary` | Edit approved catalog attributes |
| `/api/health` | Liveness JSON: `{ status, db, inngest }` — **no secrets** |
| Inngest Cloud | Failed publishes, Retry, `system.health.ping` history |

---

## Quick reference — Oh-Crap email

1. Read which **spoke** failed (Katana / WooCommerce / Clover) or which **SKU** failed publish.
2. Rotate the named credential or fix the Quarantine row.
3. Retry the Inngest run.
4. Escalate to a developer only if Retry still fails with a **payload / schema** error after credentials are confirmed good.
