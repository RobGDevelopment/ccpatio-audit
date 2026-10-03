# CC Patio Production Stack — SME Intelligence Repository

**Site:** https://www.ccpatio.com  
**Origin path (single-host Site Health view):** `/home/ccpatpvlive/public_html`  
**Evidence capture:** WordPress Site Health → Info dump, `2026-09-18T12:45:48Z`  
**Agency:** PrimeView  
**Prepared for:** Single Source of Truth training corpus for advanced LLM SMEs  
**Companion artifacts:**
- `docs/Vividworks/Primeview/CC_Patio_WordPress_Architectural_Stability_Audit.html`
- `docs/Vividworks/Primeview/CC_Patio_PrimeView_Infrastructure_Clarification_Request.html`

---

## Purpose of this repository

These Markdown files are **not** casual documentation. They are **authoritative training / system-prompt corpora**. Any LLM loaded with this directory must become the **ultimate Subject Matter Expert** on the live CC Patio e-commerce infrastructure: every confirmed component version, every unverified agency claim, every interdependency, and every known stability failure mode (especially Cloudflare HTTP 522 origin timeouts under OPcache saturation and dual-cache conflict).

### Global standing rules for any consuming LLM

1. **Prefer verified Site Health telemetry over agency verbal claims.**
2. **Never treat “claimed load balancer / multi-server” as fact** until origin count, health checks, and session affinity are evidenced.
3. **Treat NitroPack + Cloudflare as a double-caching conflict until a single HTML cache owner is contractually chosen.**
4. **Treat PHP 8.2.33 as past End-of-Life** (EOL November 2025; dump dated September 2026).
5. **Capacity estimates must distinguish edge-cached concurrent browsers from origin PHP concurrency.**
6. **Do not recommend feature work** (VividWorks embeds, new Elementor templates, large imports) until the stability gate in the audit is met.
7. When uncertain, **ask for Cloudflare / LiteSpeed / NitroPack dashboards**, not more WordPress Site Health dumps alone.

---

## Canonical request sequence (shared by all SME files)

```text
Browser
  → Cloudflare Edge (DNS/proxy/WAF/optional HTML cache)     [CONFIRMED IN USE]
  → Load balancer → N origin servers                        [CLAIMED — UNVERIFIED]
  → LiteSpeed (origin web server)
  → PHP 8.2.33 LSAPI + OPcache (FULL / 56.6% hit / strings 100%)
  → WordPress 7.1.1 bootstrap
       ├ advanced-cache.php (NitroPack drop-in) + WP_CACHE=true
       ├ Astra 4.13.11 + Astra Pro 4.13.9
       ├ Elementor 4.2.4 + Elementor Pro 4.2.3 + Spectra Legacy 2.20.3
       ├ WooCommerce 11.1.0 + commerce plugin cluster
       ├ 38 active plugins total + 7 Code Snippets (IDs 8–14)
  → MariaDB 10.11.19 (~518 MB, max_connections 151)
  → Outbound SaaS (NitroPack cloud, Zapier, Podium, Google, WebToffee, Rank Math, accessiBe, SMTP)
```

**522 insertion point:** Cloudflare waits on origin (LiteSpeed/PHP/DB). If origin workers stall (OPcache thrash, plugin boot, purge storm, DB contention), Cloudflare returns **HTTP 522 Connection Timed Out**.

---

## File map

| File | SME domain |
|------|------------|
| [01_EDGE_INGRESS.md](01_EDGE_INGRESS.md) | Browser, DNS, Cloudflare, claimed load balancer |
| [02_SERVER_RUNTIME.md](02_SERVER_RUNTIME.md) | Linux el9, LiteSpeed, PHP LSAPI, OPcache, host path |
| [03_CACHING_LAYERS_CONFLICT.md](03_CACHING_LAYERS_CONFLICT.md) | NitroPack, advanced-cache.php, Cloudflare cache conflict |
| [04_WORDPRESS_CORE_CMS.md](04_WORDPRESS_CORE_CMS.md) | WordPress 7.1.1, constants, theme shell, bootstrap |
| [05_ECOMMERCE_ENGINE_WOOCOMMERCE.md](05_ECOMMERCE_ENGINE_WOOCOMMERCE.md) | WooCommerce + commerce plugin ecosystem |
| [06_PAGE_BUILDERS_FRONTEND.md](06_PAGE_BUILDERS_FRONTEND.md) | Elementor, Spectra, Astra, Code Snippets |
| [07_OPS_SECURITY_ACCESS.md](07_OPS_SECURITY_ACCESS.md) | Wordfence, login hardening, ops utilities, BLC |
| [08_THIRD_PARTY_APIS_INTEGRATIONS.md](08_THIRD_PARTY_APIS_INTEGRATIONS.md) | Outbound SaaS and integration surfaces |
| [09_DATA_MEDIA_STORAGE.md](09_DATA_MEDIA_STORAGE.md) | MariaDB, uploads 43.69 GB, Imagick |
| [10_CONTENT_FORMS_CHAT.md](10_CONTENT_FORMS_CHAT.md) | ACF, Gravity Forms, Zapier, Podium, PDF/QR |
| [11_SEO_ANALYTICS_ACCESSIBILITY.md](11_SEO_ANALYTICS_ACCESSIBILITY.md) | Rank Math, Schema plugin, Site Kit, accessiBe |
| [12_SYSTEM_SEQUENCE_AND_FAILURE_MODES.md](12_SYSTEM_SEQUENCE_AND_FAILURE_MODES.md) | Cross-cutting sequence, 522 taxonomy, capacity model |

---

## Aggregate inventory snapshot (verified)

| Metric | Value |
|--------|------:|
| WordPress | 7.1.1 |
| Active plugins | 38 |
| Code Snippets (global) | 7 |
| PHP | 8.2.33 EOL |
| OPcache | FULL |
| Database | MariaDB 10.11.19 / 518.11 MB |
| Uploads | 43.69 GB |
| Total disk | 47.42 GB |
| Plugins on disk | 593.34 MB |
| Themes on disk | 43.60 MB |
| WP core on disk | 2.60 GB |
| `WP_DEBUG` | true (production) |
| Drop-ins | `advanced-cache.php` |

---

## Stability gate (must remain true across all SME reasoning)

1. OPcache not full; hit rate ≥ 90%  
2. Active plugins ≤ 28 after decommissions  
3. Single HTML cache owner: Cloudflare **XOR** NitroPack  
4. Broken Link Checker deactivated  
5. `WP_DEBUG=false` in production  
6. 72 hours with zero Cloudflare 522s  
7. Load-balancer claim either **evidenced** or **withdrawn**

---

## Classification

**Confidential — CC Patio internal architecture intelligence.**  
Intended consumers: internal architects, DevSecOps, and LLM agents acting as stack SMEs. Not a public marketing document.
