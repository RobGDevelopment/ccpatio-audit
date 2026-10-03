# 11 — SEO, Analytics & Accessibility SME

**Domain:** Rank Math · Schema & Structured Data plugin · Google Site Kit · accessiBe · related theme SEO hooks  
**Site:** https://www.ccpatio.com  
**Evidence baseline:** Site Health dump `2026-09-18T12:45:48Z`  

---

## Component Identity & Versioning

| Component | Vendor | Version | Auto-updates | Role |
|-----------|--------|---------|--------------|------|
| Rank Math SEO | Rank Math | **1.0.278** | Enabled | Primary SEO suite |
| Schema & Structured Data for WP & AMP | Magazine3 | **1.66** | Disabled | **Second** JSON-LD/schema emitter |
| Site Kit by Google | Google | **1.187.0** | Enabled | GA4/SC/PSI wiring — **not connected** in dump |
| Web Accessibility by accessiBe | accessiBe | **2.13** | Disabled | Accessibility overlay SaaS |

### Site Kit snapshot (critical excerpts)

| Item | Dump value |
|------|------------|
| reference_url | `https://www.ccpatio.com` |
| site_status | **not-connected** |
| user_status | **not authenticated** |
| search_console_property | `https://ccpatio.com/` |
| analytics_4_measurement_id | present (masked G-…) |
| analytics_4_use_snippet | yes |
| consent_mode | disabled |
| conversion_tracking | disabled |
| Many OAuth scopes | ⭕ not granted |

### Theme adjacency

Astra feature flags include `rank-math-breadcrumbs` support.

### EOL / support

- Rank Math actively maintained; auto-updates on.  
- Dual schema plugins are a **logic defect**, not an EOL issue.  
- accessiBe is subscription SaaS — legal/compliance posture is business-owned.

---

## LLM SME Directive

```text
YOU ARE THE SUBJECT MATTER EXPERT FOR SEO, ANALYTICS, SCHEMA, AND ACCESSIBILITY INTEGRATIONS
ON www.ccpatio.com.

You own Rank Math configuration surfaces, DUPLICATE schema risk with Magazine3 plugin,
Site Kit auth split-brain, apex vs www property mismatch, and accessiBe overlay implications.

MANDATORY BEHAVIORS:
1. Insist on ONE schema emitter — prefer Rank Math; deactivate Schema & Structured Data plugin
   after validation.
2. Never declare analytics “healthy” while Site Kit shows not-connected — even if gtag fires.
3. Treat apex SC property vs www reference_url as a canonicalization defect until proven 301.
4. When advising NitroPack/CF, require re-validation of JSON-LD and canonical tags post-optimize.
5. Coordinate breadcrumbs: Rank Math + Astra + Code Snippet “Primary Category Breadcrumbs”
   may triple.
6. Accessibility overlay does not replace semantic HTML fixes in Elementor templates.

SEO SME FORBIDDEN:
- Adding more SEO plugins.
- Ignoring duplicate JSON-LD as “harmless.”
```

---

## Architectural Role

This layer influences:

- Organic discovery (titles, sitemaps, schema, canonicals)  
- Measurement (GA4, Search Console)  
- Compliance UX (accessibility overlay)  

It runs on **every public HTML response** (extra PHP filters + frontend scripts), contributing to MISS cost and DOM weight.

---

## Deep Technical Mechanics

### 1. Rank Math

Typically injects:

- Meta titles/descriptions  
- Open Graph / Twitter cards  
- JSON-LD graph  
- Sitemaps  
- Breadcrumb APIs  
- Redirect features (overlap possible with Redirection plugin)

On Woo products, schema types include Product/Offer — sensitive to catalog mode (price hidden) and variation availability.

### 2. Dual schema conflict (Rank Math + Magazine3)

Two plugins emitting JSON-LD ⇒

- Duplicate `Product` / `Organization` / `BreadcrumbList` graphs  
- Google Rich Results warnings  
- Extra PHP on_boot filters  
- Confusing admin ownership  

**Remediation:** keep Rank Math; disable Magazine3; inspect view-source for single graph; Rich Results test.

### 3. Site Kit split-brain

Tags may fire via `analytics_4_use_snippet: yes` while OAuth connection is broken. Outcomes:

- Admins cannot trust Site Kit dashboards  
- Measurement ID ownership unclear  
- SC property on apex while site referenced as www  

### 4. Canonical host analytics/SEO coupling

If both apex and www answer 200:

- Duplicate indexing  
- Split GA hostnames  
- Rank Math canonical tags must force one host — verify they do  

### 5. accessiBe overlay

Injects third-party JS to modify UI for accessibility claims. Considerations:

- Performance (third-party script)  
- Legal debates around overlay adequacy  
- Interaction with Elementor markup and NitroPack delayed JS  

Not a 522 root cause; still part of frontend integrity testing.

### 6. Breadcrumb multiplicity

Possible simultaneous breadcrumb sources:

1. Rank Math  
2. Astra Rank Math integration  
3. Code Snippet 10 “Primary Category Breadcrumbs”  
4. Elementor breadcrumb widget  

Duplicate visible breadcrumbs harm UX/SEO clarity.

---

## Interdependencies & Communication Flow

```text
HTML response assembly
  → Rank Math meta/schema
  → Magazine3 schema (conflict)
  → accessiBe script
  → GA snippet (Site Kit)
  → NitroPack may rewrite DOM/scripts
  → Cloudflare may cache HTML containing schema
```

Purge/cache correctness matters: stale Product schema after price/finish changes misleads Google Merchant / organic results.

---

## Current Known State vs. Critical Vulnerabilities

### Known state

- Rank Math + second schema plugin both active  
- Site Kit installed but not connected  
- GA measurement ID present  
- SC on apex; reference www  
- accessiBe active  
- Consent mode disabled  

### Critical vulnerabilities

1. **Duplicate JSON-LD emitters**.  
2. **Analytics auth/governance failure**.  
3. **www vs apex property mismatch**.  
4. **Possible triple breadcrumbs**.  
5. **Cached stale Product schema** under dual HTML cache.  
6. **Consent mode off** while multiple trackers present.  
7. SEO plugin auto-updates during instability.

---

## Verified vs. Claimed Discrepancies

| Statement | Class |
|-----------|-------|
| Plugin versions and Site Kit disconnected state | **Verified** |
| “SEO fully covered by Rank Math alone” | **Contradicted** — Magazine3 also active |
| GA data pipeline fully trusted | **Unsafe** given Site Kit status |
| Canonical host locked | **Contested** |

---

## SEO/analytics remediation punch list

| Pri | Action | Acceptance |
|-----|--------|------------|
| P1 | Disable Schema & Structured Data plugin | Single JSON-LD in view-source |
| P1 | Fix or remove Site Kit; align SC property to canonical host | Auth green OR plugin gone |
| P1 | Force www↔apex single 301 | One host only |
| P2 | Deduplicate breadcrumbs | One trail |
| P2 | Re-test Rich Results on top PDPs after cache owner chosen | Valid Product schema |
| P3 | Consent strategy vs accessiBe/GA | Policy documented |

---

## Cross-references

- Edge canonical → `01_EDGE_INGRESS.md`  
- Snippet breadcrumbs → `06_PAGE_BUILDERS_FRONTEND.md`  
- Integrations auth → `08_THIRD_PARTY_APIS_INTEGRATIONS.md`  
- Catalog mode pricing schema → `05_ECOMMERCE_ENGINE_WOOCOMMERCE.md`
