# 05 — E-Commerce Engine (WooCommerce Ecosystem) SME

**Domain:** WooCommerce 11.1.0 and all commerce-adjacent active plugins  
**Site:** https://www.ccpatio.com  
**Evidence baseline:** Site Health dump `2026-09-18T12:45:48Z`  

---

## Component Identity & Versioning

| Component | Vendor | Version | Auto-updates (dump) | Role |
|-----------|--------|---------|---------------------|------|
| **WooCommerce** | Automattic | **11.1.0** | Enabled | Core commerce engine |
| Variation Swatches for WooCommerce | CartFlows | 1.0.14 | Enabled | Attribute UX swatches |
| Premmerce Permalink Manager for WooCommerce | Premmerce | 2.3.13 | Disabled | Woo URL structure control |
| YITH WooCommerce Catalog Mode | YITH | 2.58.0 | Disabled | Hide prices/cart behaviors (catalog mode) |
| Filter Everything — WordPress & WooCommerce Filters | Andrii Stepasiuk | 1.9.6 | Disabled | Layered navigation / filters |
| Favorites | Hook & Filter | 2.3.8 | Disabled | Wishlist/favorites |
| **CC Patio Rug Catalog** | **PrimeView** | **2.0.0** | Disabled | Custom catalog feature |
| WebToffee WooCommerce Product Feeds | WebToffee | 2.4.2 | Disabled | Google/Pinterest/TikTok feeds |

### Closely coupled non-commerce plugins that still shape commerce UX

| Component | Why commerce-relevant |
|-----------|----------------------|
| Elementor Pro | Product template builder |
| Code Snippets 8–14 | Related products, add-ons, finishes, variation price dropdowns, breadcrumbs |
| NitroPack | HTML cache of PDPs/PLPs |
| Rank Math | Product SEO schema |
| Gravity Forms | Lead/quote flows under catalog-mode constraints |

### EOL / support

- WooCommerce 11.1.0 is modern relative to the dump date; keep aligned with Automattic security releases (auto-updates enabled — mixed blessing on unstable infra).  
- Custom **CC Patio Rug Catalog 2.0.0** has **unknown support SLA** — treat as agency-owned critical path code.

---

## LLM SME Directive

```text
YOU ARE THE SUBJECT MATTER EXPERT FOR THE WOOCOMMERCE COMMERCE ENGINE ON www.ccpatio.com.

You own cart/session semantics, product/variation rendering cost, catalog-mode implications,
feed generation load, permalink interactions, and how commerce cookies interact with
Cloudflare/NitroPack caches.

MANDATORY BEHAVIORS:
1. Distinguish CATALOG MODE (YITH) browsing from full checkout commerce — do not assume
   standard cart conversion paths without verifying YITH configuration.
2. Always map cache bypass cookies for Woo sessions when advising edge/HTML cache.
3. Treat variation PDPs + swatches + Elementor templates as HIGH COST dynamic endpoints —
   primary origin stress pages.
4. Treat WebToffee feed generation as BACKGROUND LOAD that can coincide with 522 windows.
5. Treat Premmerce permalinks + WP permalink structure + Redirection as a URL triad — never
   change one without the others.
6. Flag PrimeView CC Patio Rug Catalog as custom code requiring source review before
   performance claims.
7. Under claimed load balancers, require sticky sessions or shared session storage for Woo.

COMMERCE SME FORBIDDEN:
- Recommending Cache Everything on CF without Woo cookie bypasses.
- Large feed regenerations or catalog imports during stability incidents.
```

---

## Architectural Role

WooCommerce is the **primary business application** running on the WordPress portal. It owns:

- Product, product variation, taxonomies (categories/tags/attributes)  
- Cart and session persistence  
- Pricing display (subject to YITH catalog mode)  
- Order objects (if checkout enabled — confirm against catalog mode)  
- REST API and Store API endpoints used by builders/integrations  
- Hooks consumed by snippets, swatches, filters, feeds  

For CC Patio furniture retail, PDPs are media-heavy and option-heavy (finishes, fabrics — reflected in Code Snippets names), making commerce endpoints the **hottest dynamic paths**.

---

## Deep Technical Mechanics

### 1. WooCommerce request classes

| Class | Examples | Cacheability |
|-------|----------|--------------|
| Anonymous PLP/PDP | Category archives, product pages | Cacheable if no personalization |
| Sessioned browse | Cart fragment, favorites | Bypass HTML cache |
| Account | my-account | Bypass |
| Checkout | checkout | Bypass |
| Admin / AJAX | `admin-ajax.php`, Store API | Bypass; CPU heavy |
| Feeds | WebToffee cron | Origin CLI/web heavy |

### 2. Session and cookie mechanics

WooCommerce sets cookies such as:

- `wp_woocommerce_session_*`  
- `woocommerce_items_in_cart`  
- `woocommerce_cart_hash`  

**Edge/NitroPack must vary or bypass** on these. Failure modes: cross-user cart bleed, stale fragments, mysterious “empty cart” while HTML shows items.

Under **claimed multi-server LB** without shared `wp_options`/Redis sessions or sticky affinity, sessions break intermittently — can be misdiagnosed as “Woo bugs.”

### 3. YITH Catalog Mode

Catalog mode plugins typically:

- Hide add-to-cart / prices for guests or all users  
- Replace with inquiry CTAs (often Gravity Forms / Podium)  
- Still load much of WooCommerce stack  

SME must not assume high checkout RPS; load may be **browse + lead-gen** dominant. Still expensive.

### 4. Variations + swatches + snippets

Stack for a complex PDP:

1. Woo variation engine  
2. CartFlows Variation Swatches UI  
3. Code Snippet “Finishes Options”  
4. Code Snippet “WooCommerce Variation with Price (Dropdown)”  
5. Code Snippet “Disable Dropdown (One Option Available)”  
6. Elementor product template  
7. Rank Math / Schema JSON-LD  
8. NitroPack DOM rewrites on cached copy  

This is a **latency onion**. Each layer adds JS/CSS and PHP filters.

### 5. Premmerce Permalink Manager

Alters Woo URL patterns beyond core `/%category%/%postname%/`. Implications:

- Cache key cardinality ↑  
- Redirection rules must cover legacy  
- NitroPack/CF purge patterns must include custom structures  
- Incorrect changes → mass 404 → BLC crawl amplification  

### 6. Filter Everything

Faceted filters often trigger expensive product queries and AJAX. Risk:

- Uncached filter combinations  
- High DB temporary table usage  
- Bot enumeration of filter URLs  

### 7. WebToffee product feeds

Feed generation walks large catalogs, writes files, may remote-ping marketplaces. Schedule overlap with peak traffic is a classic 522 contributor.

### 8. Favorites plugin

Adds per-user or cookie personalization — another HTML cache bypass class.

### 9. CC Patio Rug Catalog (PrimeView custom)

Unknown internals. SME protocol:

1. Locate plugin code under `wp-content/plugins/`  
2. Inventory hooks on `woocommerce_*`  
3. Check for heavy queries, remote HTTP, admin-ajax polling  
4. Determine if it registers its own CPTs affecting permalinks/cache  

Until reviewed, treat as **potential wild card load**.

---

## Interdependencies & Communication Flow

```text
Cloudflare/NitroPack cookies decision
    ↓
Woo session / catalog mode
    ↓
Elementor product template + snippets + swatches
    ↓
MariaDB posts/postmeta/options/woocommerce tables
    ↓
Outbound: WebToffee feeds, possibly Zapier via forms, Podium chat
```

### Upstream

Edge + cache layers decide whether PHP runs at all.

### Downstream

MariaDB commerce schema; builders for presentation; forms/chat for non-cart conversion.

---

## Current Known State vs. Critical Vulnerabilities

### Known state

- Woo 11.1.0 active with rich plugin cluster  
- Catalog mode present ⇒ conversion path may be inquiry-centric  
- Custom Rug Catalog plugin active  
- Feeds plugin active  
- Auto-updates enabled on Woo core (and some adjacent) while infra unstable  

### Critical vulnerabilities

1. **Dynamic PDP cost** on OPcache-full origin.  
2. **Cache personalization bugs** if dual HTML cache misconfigured.  
3. **Feed/cron contention**.  
4. **Permalink complexity** (core + Premmerce + Redirection).  
5. **Custom plugin opacity** (Rug Catalog).  
6. **LB session affinity unknown**.  
7. **Auto-updates** of Woo during instability windows.

### Commerce endpoints to load-test after remediation

- Top 20 PDPs (variation-heavy)  
- Top category PLPs with filters applied  
- Favorites add/remove  
- Cart fragment AJAX (if cart enabled)  
- `/?wc-ajax=` critical calls  

Target: staging survives **50 concurrent PDP** loads without 5xx (from audit gate).

---

## Verified vs. Claimed Discrepancies

| Statement | Class |
|-----------|-------|
| WooCommerce 11.1.0 + listed commerce plugins active | **Verified** |
| Full checkout enabled vs catalog-only | **Unknown** (YITH present) |
| Shared sessions across claimed LB nodes | **Unknown / claimed topology** |
| Rug Catalog performance characteristics | **Unknown** |

---

## Commerce-specific remediation notes

- Freeze Woo auto-updates until 522 gate passes (policy decision).  
- Schedule WebToffee off-peak.  
- Export YITH catalog mode settings into SoT.  
- Code-review Rug Catalog.  
- Align Premmerce + Redirection + CF purge allowlists.

---

## Cross-references

- Caching cookies → `03_CACHING_LAYERS_CONFLICT.md`  
- Snippets/builders → `06_PAGE_BUILDERS_FRONTEND.md`  
- Forms lead-gen → `10_CONTENT_FORMS_CHAT.md`  
- Capacity model → `12_SYSTEM_SEQUENCE_AND_FAILURE_MODES.md`
