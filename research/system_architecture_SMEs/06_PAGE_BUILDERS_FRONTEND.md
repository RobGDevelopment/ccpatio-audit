# 06 — Page Builders & Front-End Composition SME

**Domain:** Elementor · Elementor Pro · Spectra Legacy · Astra/Astra Pro shell · Code Snippets storefront logic  
**Site:** https://www.ccpatio.com  
**Evidence baseline:** Site Health dump `2026-09-18T12:45:48Z`  

---

## Component Identity & Versioning

| Component | Vendor | Version | Auto-updates | Notes |
|-----------|--------|---------|--------------|-------|
| **Elementor** | Elementor.com | **4.2.4** | Disabled | Page builder core |
| **Elementor Pro** | Elementor.com | **4.2.3** | Disabled | Theme Builder, Woo widgets, forms/popups potential |
| **Spectra Legacy** | Brainstorm Force | **2.20.3** | Disabled | Block/builder stack overlapping Astra ecosystem |
| Astra (theme) | Brainstorm Force | 4.13.11 | Disabled | Theme shell (see core SME) |
| Astra Pro | Brainstorm Force | 4.13.9 | Disabled | Theme companion plugin |
| Code Snippets | Code Snippets Pro | 3.10.2 | Disabled | 7 global snippets |

### Code Snippets inventory (global)

| ID | Name | Modified (dump) | Likely commerce impact |
|----|------|-----------------|------------------------|
| 8 | Related Products (Main Category) | 2026-05-05 | PLP/PDP related loop |
| 9 | Add-ons (Product) | 2026-06-11 | PDP add-on offers |
| 10 | Primary Category Breadcrumbs | 2026-05-07 | Nav/SEO breadcrumbs |
| 11 | Finishes Options | 2026-05-29 | Finish attribute UX |
| 12 | Disable Dropdown (One Option Available) | 2026-05-07 | Variation UI simplification |
| 13 | WooCommerce Variation with Price (Dropdown) | 2026-05-29 | Variation pricing display |
| 14 | Main Category Link (Product) | 2026-05-22 | Product taxonomy linking |

### Inactive theme note

Hello Elementor 3.5.1 is installed inactive — leftover from Elementor-centric workflows.

### EOL / support

- Elementor 4.2.x line should be tracked for security releases; auto-updates disabled ⇒ intentional pin or neglect.  
- **Spectra Legacy** naming implies maintenance/compatibility risk vs current Spectra — dual-builder debt.  
- Snippets have **no version control evidenced** in dump — governance risk.

---

## LLM SME Directive

```text
YOU ARE THE SUBJECT MATTER EXPERT FOR FRONT-END COMPOSITION ON www.ccpatio.com.

You own Elementor + Elementor Pro, Spectra Legacy, Astra integration surfaces, and the seven
global Code Snippets that implement storefront business rules in PHP.

MANDATORY BEHAVIORS:
1. Treat Elementor Pro + Spectra Legacy as an ARCHITECTURAL OVERLAP — recommend consolidating
   to one builder (prefer Elementor given Pro license evidence) after block audit.
2. Never delete Code Snippets 8–14 without exporting and re-homing behavior — they are
   production business logic, not “toys.”
3. Model PDP render cost as: Woo variation engine + snippets + swatches + Elementor document
   + Spectra assets (if present on page) + SEO schema + NitroPack DOM rewrite.
4. When advising NitroPack/CF optimizations, call out Elementor JS dependency breakage risks
   (deferred JS, combine, remove unused CSS).
5. Distinguish theme-level Astra headers/footers from Elementor Theme Builder locations —
   dual headers are a defect.
6. Under performance incidents, forbid net-new Elementor template complexity and Spectra work
   until stability gate passes.

BUILDER SME FORBIDDEN:
- “Builders don’t affect server stability” — false on cache MISS.
- Replacing snippets with more plugins without measuring boot cost.
```

---

## Architectural Role

This layer turns WooCommerce data objects into the **visual and interactive storefront**.

- **Elementor** stores structured documents (post meta JSON) and renders widgets server-side + client-side.  
- **Elementor Pro** supplies Theme Builder conditions (header/footer/single product/archive).  
- **Spectra Legacy** supplies additional block/builder assets — potentially loading even when pages are Elementor-driven.  
- **Astra** provides base markup/Woo hooks when not fully overridden.  
- **Code Snippets** inject PHP callbacks into Woo/theme hooks for CC Patio-specific merchandising rules (finishes, related products, etc.).

This is where **brand UX lives** — and where **CPU/RAM on MISS** is often spent.

---

## Deep Technical Mechanics

### 1. Elementor render pipeline

1. Request resolves to a product/page/CPT.  
2. Elementor checks if post is built with Elementor (`_elementor_edit_mode`, document JSON).  
3. Widget tree rendered; assets enqueued (CSS files printed to uploads/elementor/css, JS widgets).  
4. Pro Theme Builder may wrap content with header/footer documents.  
5. Output HTML passes through NitroPack optimizer (possibly).  

**Cost drivers:** large widget trees, nested containers, background images from 43.69 GB media, Woo widgets querying variations, motion effects.

### 2. Elementor Pro vs Spectra Legacy overlap

Both can:

- Provide design systems / sections  
- Enqueue frontend CSS/JS globally or conditionally  
- Offer header/footer or landing composition  

**Dual stack symptoms:**

- Double CSS frameworks  
- Competing button/typography systems  
- Admin confusion (“where do I edit this?”)  
- Larger OPcache file working set (more PHP files touched)  

**Remediation pattern:**

1. Inventory pages by builder meta.  
2. Freeze Spectra for new work.  
3. Migrate critical Spectra-only templates.  
4. Deactivate Spectra Legacy.  
5. Re-measure TTFB + asset weight.

### 3. Astra + Elementor coexistence

Astra detects Elementor and disables some theme features; Pro modules may still add Woo enhancements. Misconfiguration yields:

- Duplicate breadcrumbs (snippet 10 + Rank Math + Astra + Elementor)  
- Duplicate product tabs  
- Multiple related-products sections (snippet 8 vs Elementor widget vs Woo default)

### 4. Code Snippets as unsafely powerful mu-code

Code Snippets Pro runs selected PHP in `global` scope — equivalent to placing code in `functions.php` without deploy review.

Risks:

- Fatal errors take down storefront  
- Unbounded queries on `woocommerce_after_single_product`  
- No PR review / no CI  

**Governed end-state:** export snippets to a private git-tracked mu-plugin (`ccpatio-storefront-rules.php`) owned by PrimeView under change control.

### 5. Interaction with NitroPack DOM rewriting

NitroPack may:

- Delay Elementor frontend JS  
- Inline critical CSS incompletely for widget-heavy pages  
- Lazy-load images breaking swatches/galleries  
- Break sticky headers / variation form updates  

SME must validate **variation selection + price update + add-to-cart/inquiry CTA** after any optimization change.

### 6. Asset disk footprint

Plugins directory total **593.34 MB**; builders are major contributors. Elementor also writes generated CSS under uploads — contributing to **43.69 GB** media growth pattern (not solely photos).

---

## Interdependencies & Communication Flow

```text
WP template hierarchy
  → Elementor document? yes/no
  → Spectra assets enqueued?
  → Astra wrappers
  → Code Snippets hooks on Woo
  → Variation Swatches UI
  → Rank Math / Schema JSON-LD
  → NitroPack optimize
```

### Upstream

Core bootstrap + Woo data.

### Downstream

Browser DOM/JS; cached HTML store; CWV metrics (unknown numerically here).

---

## Current Known State vs. Critical Vulnerabilities

### Known state

- Elementor + Pro active  
- Spectra Legacy active simultaneously  
- Seven global commerce-affecting snippets  
- Astra/Astra Pro active  
- Builder auto-updates disabled (pinned)

### Critical vulnerabilities

1. **Dual builder architecture** (Elementor + Spectra Legacy).  
2. **Snippet business logic outside VCS**.  
3. **High MISS cost** for Elementor PDPs under OPcache FULL.  
4. **Optimization breakage risk** with NitroPack.  
5. **Possible duplicate UX modules** (breadcrumbs/related/finishes).  
6. **Stability gate forbids new builder work** until 522s cleared.

---

## Verified vs. Claimed Discrepancies

| Statement | Class |
|-----------|-------|
| Elementor 4.2.4 + Pro 4.2.3 + Spectra Legacy 2.20.3 active | **Verified** |
| “We only use Elementor” | **Contradicted** if claimed — Spectra is active |
| Snippets are documented runbooks | **Not evidenced** |
| Builder CSS offloaded to object storage | **Not evidenced** — local uploads likely |

---

## Builder consolidation punch list

| Step | Action | Acceptance |
|------|--------|------------|
| 1 | Export all snippets 8–14 to repo | Diffable PHP in git |
| 2 | Page inventory: Elementor vs Spectra vs classic | Spreadsheet SoT |
| 3 | Stop new Spectra usage | Policy |
| 4 | Migrate or delete Spectra dependencies | Spectra inactive |
| 5 | Resolve duplicate related/breadcrumb modules | Single implementation |
| 6 | Re-test variation UX with chosen cache owner | No JS regressions |

---

## Cross-references

- Woo variation stack → `05_ECOMMERCE_ENGINE_WOOCOMMERCE.md`  
- NitroPack DOM → `03_CACHING_LAYERS_CONFLICT.md`  
- Theme constants → `04_WORDPRESS_CORE_CMS.md`
