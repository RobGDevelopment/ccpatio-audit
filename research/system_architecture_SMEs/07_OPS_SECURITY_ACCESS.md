# 07 — Ops, Security & Access Control SME

**Domain:** Security plugins · login hardening · operational utilities · high-overhead crawlers · header injection overlap  
**Site:** https://www.ccpatio.com  
**Evidence baseline:** Site Health dump `2026-09-18T12:45:48Z`  

---

## Component Identity & Versioning

### Security / access cluster

| Component | Vendor | Version | Auto-updates | Function |
|-----------|--------|---------|--------------|----------|
| Wordfence Security | Wordfence | 9.0.1 | Disabled | WAF (plugin-level), malware scan, login security |
| Limit Login Attempts Reloaded | LLA Reloaded | 3.3.9 | Disabled | Brute-force throttling |
| WPS Hide Login | WPServeur et al. | 1.9.19 | Disabled | Obfuscate `wp-login.php` path |
| Temporary Login Without Password | StoreApps | 1.9.9 | Disabled | Time-boxed magic login links |

### Ops / utility cluster (stability-relevant)

| Component | Vendor | Version | Auto-updates | Function |
|-----------|--------|---------|--------------|----------|
| Broken Link Checker | WPMU DEV | 2.4.14.1 | Disabled | Continuous link crawl → DB writes |
| WP Activity Log | Melapress | 5.6.6 | Disabled | Audit logging of admin/user events |
| Better Search Replace | WP Engine | 1.4.11 | Disabled | Destructive DB search-replace |
| WordPress Importer | wordpressdotorg | 0.9.6 | Disabled | Content import tool |
| Yoast Duplicate Post | Yoast team | 4.7 | Disabled | Copy posts/pages/products |
| Redirection | John Godley | 5.10.0 | Disabled | 301/302 rule engine |
| Header Footer Code Manager | DraftPress | 1.1.46 | Disabled | Head/body script injection |
| WP Headers And Footers | WPBrigade | 3.1.5 | Enabled | Head/footer code injection |
| EMCP Tools (Premium) | Mian Shahzad Raza | 3.16.1 | Disabled | Opaque ops tooling |
| Dynamic QR Code | SOSidee | 1.0.1 | Disabled | QR generation |
| PDF Embedder | PDF Embedder | 5.0.2 | Disabled | PDF viewing |
| WP Mail SMTP | WP Mail SMTP | 4.9.0 | Disabled | Mail transport (Lite) |

### Overlaps to treat as defects

1. **Wordfence + Limit Login + Hide Login + Temporary Login** — stacked auth controls.  
2. **HFCM + WP Headers And Footers** — dual script injection planes.  
3. **Broken Link Checker on 47 GB media / large URL space** — known origin aggressor.

---

## LLM SME Directive

```text
YOU ARE THE SUBJECT MATTER EXPERT FOR OPERATIONS, SECURITY, AND ACCESS CONTROL PLUGINS
ON www.ccpatio.com.

You own login surfaces, plugin-level WAF vs Cloudflare WAF overlap, audit logging cost,
dangerous admin tools left active in production, and crawler utilities that create load.

MANDATORY BEHAVIORS:
1. Recommend immediate deactivation of Broken Link Checker in production during 522 incidents.
2. Treat Temporary Login Without Password as elevated standing risk unless actively needed —
   demand inventory of active temporary users.
3. Treat Better Search Replace + WordPress Importer as “break glass only” — must not remain
   active day-to-day in production.
4. Consolidate header injection to ONE plugin.
5. Prefer Wordfence as primary WP-side security; disable redundant Limit Login if Wordfence
   lockouts cover the need; keep Hide Login only if monitors/health checks are updated.
6. Coordinate with Edge SME: Cloudflare WAF + Wordfence WAF double-inspection can add latency;
   still usually secondary to OPcache issues — but document both.
7. Never advise security through obscurity alone (Hide Login) without rate limits + CF rules.

SECOPS SME FORBIDDEN:
- Leaving BLC running “because SEO.”
- Using Temporary Login as standing vendor access without expiry audit.
```

---

## Architectural Role

This layer does **not** sell furniture; it attempts to:

- Reduce account takeover risk  
- Provide audit trails  
- Manage redirects after IA changes  
- Inject marketing/analytics tags  
- Perform maintenance transformations  

On an unstable origin, several of these plugins become **load generators** or **change-risk amplifiers**.

---

## Deep Technical Mechanics

### 1. Wordfence mechanics

Wordfence typically:

- Intercepts requests via `auto_prepend` or WP hooks (mode dependent — unknown here)  
- Maintains IP blocklists / rate rules  
- Runs filesystem malware scans (CPU/disk intensive)  
- May connect to Wordfence threat intelligence servers  

**Conflict:** scans scheduled during traffic peaks amplify LSAPI contention.

### 2. Limit Login Attempts Reloaded

Tracks failed logins in DB options/transients; locks out IPs. Overlaps Wordfence login security. Duplicate counters and lockout UX confusion possible.

### 3. WPS Hide Login

Renames login path. Side effects:

- Uptime monitors hitting `/wp-login.php` get 404 — may still execute WP bootstrap depending on implementation  
- LB health checks aimed at default login break  
- Vendor bookmarks break ⇒ pressure to install Temporary Login  

### 4. Temporary Login Without Password

Creates tokenized admin access without password. Powerful for agency support; dangerous if:

- Tokens don’t expire  
- Capabilities over-granted  
- Tokens shared in chat logs  

### 5. Broken Link Checker — CRITICAL LOAD MECHANICS

BLC crawls site links, writes status to custom tables, rechecks on schedules.

On CC Patio scale drivers:

- Large Woo catalog URL space  
- Premmerce/custom permalinks  
- 43.69 GB media URLs  
- Possible filter URL combinations  

**Failure mode:** continuous DB writes + HTTP fetches (internal/external) steal CPU from storefront → 522 correlation. **P0 deactivate.**

### 6. WP Activity Log

Records admin events to DB. Useful for forensics; cost scales with noisy plugins/editors (Elementor saves). Must retention-cap.

### 7. Better Search Replace / Importer

These tools can:

- Corrupt serialized PHP data if misused  
- Duplicate content  
- Lock tables  

They belong offline or on staging clones — **not always-on production**.

### 8. Dual header managers

HFCM and WP Headers And Footers both inject into `wp_head` / `wp_footer`. Risks:

- Double GTM snippets  
- Double pixel fires  
- Ordering races with NitroPack / Elementor  

Consolidate to one.

### 9. Redirection plugin

Essential for SEO migrations; can grow to thousands of rules evaluated on 404 paths. Keep rule sets lean; export backups before mass Premmerce changes.

### 10. EMCP Tools Premium

Opaque third-party “tools” plugin — unknown hooks. Treat as **unauthorized complexity** until purpose documented by PrimeView.

---

## Interdependencies & Communication Flow

```text
Request
  → Cloudflare WAF (edge, unknown rules)
  → LiteSpeed
  → Wordfence (possible early intercept)
  → WP bootstrap
  → Hide Login / Limit Login on auth routes
  → Activity Log writers on admin actions
  → BLC cron independently crawling
```

### Upstream

Edge WAF/bots; agency human admins; temporary tokens.

### Downstream

MariaDB log tables; outbound Wordfence/email alerts; SMTP via WP Mail SMTP.

---

## Current Known State vs. Critical Vulnerabilities

### Known state

- Four access-control plugins active  
- BLC active in production  
- Dual header injectors  
- Dangerous DB tools active  
- Temporary Login present  
- Activity Log present  
- `WP_DEBUG` log path active (core SME) — additional forensic I/O  

### Critical vulnerabilities

1. **BLC production crawl** — P0 stability defect.  
2. **Standing Temporary Login risk**.  
3. **Always-on destructive tools** (BSR, Importer).  
4. **Auth plugin pile-up**.  
5. **Dual header injection**.  
6. **EMCP unknown surface**.  
7. **Hide Login vs health checks / LB probes**.  
8. **Wordfence scan scheduling unknown**.

### Immediate decommission list (ops/security owned)

| Plugin | Urgency |
|--------|---------|
| Broken Link Checker | Critical |
| Better Search Replace | High (deactivate until needed) |
| WordPress Importer | High |
| Temporary Login (if unused) | High |
| One of HFCM / WP Headers And Footers | Medium |
| EMCP Tools (unless justified) | Medium |
| Limit Login (if Wordfence covers) | Medium |

---

## Verified vs. Claimed Discrepancies

| Statement | Class |
|-----------|-------|
| Listed security/ops plugins active at versions above | **Verified** |
| Cloudflare WAF ruleset contents | **Unknown** |
| “Security is fully handled by Wordfence alone” | **Contradicted** by stacked plugins |
| BLC “harmless background SEO” | **Operationally false** on this scale |

---

## SecOps hardening sequence

1. Deactivate BLC; clear its crons.  
2. Inventory Temporary Login users; revoke.  
3. Deactivate BSR + Importer.  
4. Choose Wordfence as primary; simplify login stack.  
5. Merge header scripts to one plugin; remove duplicate pixels.  
6. Document EMCP purpose or remove.  
7. Align CF WAF + uptime paths with Hide Login slug.  
8. Schedule Wordfence scans off-peak only.

---

## Cross-references

- Edge WAF → `01_EDGE_INGRESS.md`  
- DB write pressure → `09_DATA_MEDIA_STORAGE.md`  
- SMTP outbound → `08_THIRD_PARTY_APIS_INTEGRATIONS.md`  
- Stability gate → `00_INDEX_SME_REPOSITORY.md`
