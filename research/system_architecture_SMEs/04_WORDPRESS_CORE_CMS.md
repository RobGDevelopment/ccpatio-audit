# 04 — WordPress Core CMS SME

**Domain:** WordPress 7.1.1 as system of record portal · constants · theme shell · bootstrap · multisite-off production  
**Site:** https://www.ccpatio.com  
**Evidence baseline:** Site Health dump `2026-09-18T12:45:48Z`  

---

## Component Identity & Versioning

| Component | Exact identity | Version / value | Notes |
|-----------|----------------|-----------------|-------|
| CMS | WordPress | **7.1.1** | Core portal |
| Language | `en_US` | site + user | |
| Timezone | `+00:00` UTC | | |
| Multisite | `false` | Single site | |
| Permalinks | `/%category%/%postname%/` | Pretty permalinks on | |
| User registration | `0` (disabled) | | |
| `blog_public` | `1` | Indexable | |
| Environment type (WP detection) | `production` | | |
| `WP_ENVIRONMENT_TYPE` constant | **undefined** | Soft env signaling | |
| `WP_HOME` / `WP_SITEURL` | **undefined** | DB-driven URLs | |
| `WP_DEBUG` | **true** | Production anti-pattern | |
| `WP_DEBUG_DISPLAY` | false | | |
| `WP_DEBUG_LOG` | `/home/ccpatpvlive/logs/ccp-wp-errors.log` | | |
| `WP_CACHE` | true | Triggers drop-in | |
| `WP_MEMORY_LIMIT` | 512M | | |
| `WP_MAX_MEMORY_LIMIT` | 1G | | |
| `DB_CHARSET` | utf8 | Not utf8mb4 explicitly in constants dump | |
| `EMPTY_TRASH_DAYS` | 30 | | |
| Active theme | Astra | 4.13.11 (latest noted 4.13.12) | Parent: none |
| Theme Pro companion | Astra Pro | 4.13.9 | Plugin-classified in active list |
| Auto-updates (theme) | Disabled | | |
| Filesystem writability | wordpress, wp-content, uploads, plugins, themes, mu-plugins writable | fonts dir missing | |
| Dotorg communication | true | Can reach WP.org | |
| User count | 9 | | |

### Inactive default/other themes (present on disk)

Hello Elementor 3.5.1; Twenty Twenty-Five 1.5; Twenty Twenty-One 2.9; Twenty Twenty-Three 1.7; Twenty Twenty-Two 2.2 — all auto-updates disabled.

### EOL / support

- WordPress 7.1.1 should be tracked against wordpress.org security releases continuously.  
- Theme Astra 4.13.11 is one patch behind 4.13.12 per dump note.  
- Core itself is not EOL; **PHP underneath is EOL**, which is the sharper runtime risk.

---

## LLM SME Directive

```text
YOU ARE THE SUBJECT MATTER EXPERT FOR WORDPRESS CORE AS THE SYSTEM PORTAL FOR www.ccpatio.com.

You own bootstrap order, constants, permalinks, theme shell (Astra), production hardening
flags, and how core becomes a bus for 38 plugins.

MANDATORY BEHAVIORS:
1. Model WordPress as the integration bus — not as a lightweight brochure CMS.
2. Treat WP_DEBUG=true in production as an active reliability defect (I/O + potential info leak
   via logs), not a minor nit.
3. Treat undefined WP_HOME/WP_SITEURL as fragility for CDN URL rewriting and migrations.
4. Remember advanced-cache.php executes early when WP_CACHE is true — core is not “first.”
5. When recommending plugin removals, ensure Code Snippets storefront behaviors are preserved
   via governed replacements.
6. Never assume mu-plugins exist beyond writability; dump does not inventory mu-plugin code.
7. Astra is the theme shell; Elementor/Spectra often override templates — see page-builder SME.

CORE SME FORBIDDEN CLAIMS:
- “WordPress is fine; only hosting is broken” while 38 plugins and DEBUG=true remain.
- That Site Health alone proves multi-server identity of core files.
```

---

## Architectural Role

WordPress is the **primary customer and admin portal**:

- Serves storefront routes (via WooCommerce templates + builders)  
- Hosts admin for merchandising, SEO, forms, security  
- Loads every active plugin service container on relevant requests  
- Owns authentication cookies, nonces, cron hooks, options API, REST API  

CC Patio’s broader enterprise systems (Katana MDM, VividWorks, etc. documented elsewhere in the repo) are **not** evidenced inside this Site Health dump as runtime WP plugins. This SME file covers **the public web portal stack only**.

---

## Deep Technical Mechanics

### 1. Front-controller flow

1. LiteSpeed routes pretty permalinks to `index.php`.  
2. `wp-blog-header.php` → `wp-load.php` → `wp-settings.php`.  
3. If `WP_CACHE`: load `advanced-cache.php` (NitroPack) — possible early return.  
4. Load `wp-config.php` constants (DB, salts, debug).  
5. Load core, then must-use plugins, then network (N/A), then active plugins.  
6. Load theme functions (`Astra` + Astra Pro hooks).  
7. Parse request → WP_Query → template hierarchy — often overridden by Elementor locations.  

### 2. Permalink structure implications

Structure `/%category%/%postname%/` means:

- Product and post URLs embed category segments  
- Premmerce Permalink Manager (commerce SME) may further rewrite Woo URLs  
- Redirection plugin manages legacy path migrations  
- Cache keys proliferate with category changes  

### 3. Production constants hygiene

| Constant | Current | Desired for stability |
|----------|---------|------------------------|
| `WP_DEBUG` | true | false (incident-only true) |
| `WP_DEBUG_LOG` | always-on path | sampled / rotated / flag-gated |
| `WP_ENVIRONMENT_TYPE` | undefined | `production` |
| `WP_HOME` / `WP_SITEURL` | undefined | hardcoded https www canonical |
| `WP_CACHE` | true | true only with single cache owner |

### 4. Astra theme shell mechanics

Astra provides:

- Lightweight theme framework with WooCommerce support flags  
- Hooks consumed by Astra Pro  
- Compatibility with Elementor and Spectra  
- Feature flags in Site Health include Woo gallery zoom/lightbox/slider, Rank Math breadcrumbs, AMP-related flags  

**Conflict surface:** Astra Theme Builder / headers vs Elementor Theme Builder vs Spectra — dual/triple header-footer ownership possible.

### 5. Autoload and options pressure

WordPress options autoload is a classic bottleneck under many plugins. Not directly measured in dump, but with Activity Log, BLC, NitroPack, Elementor CSS prints, Rank Math, etc., SME must assume **autoload bloat risk** and validate via DB queries when access exists.

### 6. Cron model

Unknown whether system cron hits `wp-cron.php` or relies on visit-triggered WP-Cron. Under caching, visit-triggered cron becomes unreliable; scheduled tasks may bunch — dangerous with BLC + feeds.

---

## Interdependencies & Communication Flow

### Upstream

- LiteSpeed/PHP (`02`) after edge (`01`) and possible cache HIT short-circuit (`03`)

### Downstream

- All plugin domains (`05`–`11`)  
- MariaDB (`09`)  
- Outbound HTTP (`08`)

### Plugin load reality

Every cache MISS pays for initialization of **38 active plugins** + theme + snippets. Core is the scheduler of that cost.

---

## Current Known State vs. Critical Vulnerabilities

### Known state

- WP 7.1.1 production single-site  
- Astra + Astra Pro active  
- DEBUG logging enabled  
- Cache drop-in enabled  
- Writable filesystem across major trees  
- 9 users  

### Critical vulnerabilities

1. **`WP_DEBUG=true` in production** — log I/O under load.  
2. Soft URL env constants — migration/CDN fragility.  
3. Core used as bus for **excessive active plugin surface**.  
4. Theme one patch behind; Pro/theme version skew possible.  
5. Inactive themes still on disk — attack/surface hygiene minor issue.  
6. No evidenced governance of snippet-to-code promotion.

---

## Verified vs. Claimed Discrepancies

| Statement | Class |
|-----------|-------|
| WordPress 7.1.1 production at path above | **Verified** |
| Identical core on multiple LB nodes | **Claimed only if LB true — unverified** |
| Staging mirrors production constants/plugins | **Unknown** (ops says staging fragile) |
| Enterprise object cache accompanying core | **Not evidenced** |

---

## Core hardening punch list

1. Set `WP_DEBUG=false`; gate logs.  
2. Define `WP_ENVIRONMENT_TYPE`, `WP_HOME`, `WP_SITEURL`.  
3. Patch Astra to 4.13.12 after staging check.  
4. Reduce active plugins per Ops/Security + Commerce SMEs.  
5. Move critical snippets toward version-controlled mu-plugin.  
6. Confirm real system cron.

---

## Cross-references

- Caching early bootstrap → `03_CACHING_LAYERS_CONFLICT.md`  
- Builders overriding templates → `06_PAGE_BUILDERS_FRONTEND.md`  
- Security plugins on same bus → `07_OPS_SECURITY_ACCESS.md`
