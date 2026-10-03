# 09 — Data & Media Storage SME

**Domain:** MariaDB 10.11.19 · local uploads 43.69 GB · Imagick/ImageMagick · filesystem writability · claimed multi-node storage implications  
**Site:** https://www.ccpatio.com  
**Evidence baseline:** Site Health dump `2026-09-18T12:45:48Z`  

---

## Component Identity & Versioning

### Database

| Item | Value |
|------|-------|
| Engine | **MariaDB** |
| Server version | **10.11.19-MariaDB** |
| PHP client | mysqlnd 8.2.33 |
| Extension | mysqli |
| Database size | **518.11 MB** (543277056 bytes) |
| max_allowed_packet | 268435456 (256 MB) |
| max_connections | **151** |
| `DB_CHARSET` (WP constant) | `utf8` |
| `DB_COLLATE` | undefined |

### Media / filesystem

| Item | Value |
|------|-------|
| Uploads path | `/home/ccpatpvlive/public_html/wp-content/uploads` |
| Uploads size | **43.69 GB** (46912910634 bytes) |
| WordPress core size | 2.60 GB |
| Plugins size | 593.34 MB |
| Themes size | 43.60 MB |
| Total size | **47.42 GB** |
| Fonts path | `uploads/fonts` — **directory not found** |
| FS writability | wordpress, wp-content, uploads, plugins, themes, mu-plugins **writable** |

### Image processing

| Item | Value |
|------|-------|
| Editor | `WP_Image_Editor_Imagick` |
| ImageMagick | 6.9.13-52 (Beta) Q16 x86_64 |
| Imagick ext | 3.8.1 |
| GD | bundled 2.1.0-compatible (GIF/JPEG/PNG/WebP/BMP/AVIF/XPM) |
| Ghostscript | 9.54.0 |
| upload_max_filesize | 20 MB |
| post_max_size | 40 MB |
| max_effective_size | 20 MB |
| max_file_uploads | 20 |
| HEIC transforms | heic/heif → jpeg |

### EOL / support

- MariaDB 10.11 is an LTS line (verify host vendor support calendar).  
- ImageMagick 6.9 “Beta” label in dump is unusual for prod — note as hygiene flag.  
- Local 43.69 GB media is not “EOL”; it is an **architecture smell** under claimed multi-server topologies.

---

## LLM SME Directive

```text
YOU ARE THE SUBJECT MATTER EXPERT FOR DATA PERSISTENCE AND MEDIA STORAGE ON www.ccpatio.com.

You own MariaDB behavior under Woo/Elementor/plugin write load, the 43.69 GB local uploads
tree, image processing costs, and storage implications of the UNVERIFIED load balancer claim.

MANDATORY BEHAVIORS:
1. Never equate “DB is only 518 MB” with “DB is healthy.” Connection concurrency, locks,
   autoload options, and BLC tables can hurt despite modest size.
2. Treat local uploads as incompatible with naive multi-origin LB unless shared FS or
   object storage (S3/R2/Spaces) is evidenced.
3. Treat thumbnail regeneration / NitroPack image ops / Elementor image sizes as CPU storms.
4. Flag upload_max_filesize=20MB as workflow constraint for furniture CAD/PDF — not a 522 root
   cause, but an ops friction point.
5. Demand slow query log evidence before blaming MariaDB as primary 522 driver — PHP OPcache
   is the stronger evidenced culprit — but DB can be secondary under BLC/feeds.
6. Recommend object storage offload as P2 after HTML cache owner + OPcache P0s.

DATA SME FORBIDDEN:
- Shrugging at 43.69 GB local media when agency claims multiple servers.
- Assuming Redis is present (it is not evidenced).
```

---

## Architectural Role

MariaDB is the **system of record** for:

- WordPress posts/products/pages  
- Product meta, Elementor JSON, options/transients  
- WooCommerce orders/sessions/tables (as applicable)  
- Gravity Forms entries  
- Activity Log / BLC / Redirection tables  

Uploads are the **binary system of record** for product photography, PDFs, Elementor CSS, optimized derivatives, feed artifacts, etc.

Without shared storage, horizontal scale claims collapse into **split-brain media**.

---

## Deep Technical Mechanics

### 1. MariaDB 10.11 under WordPress

Typical hotspots:

| Pattern | Source plugins | Symptom |
|---------|----------------|---------|
| Autoloaded options bloat | Many plugins | Every request pays large options query |
| postmeta explosion | Elementor, ACF, Woo variations | Slow PDPs |
| Transient churn | NitroPack, scanners, APIs | Write amplification |
| Crawl tables | Broken Link Checker | Continuous writes |
| Action Scheduler | Woo / GF / others | Table growth + cron bursts |
| Connection spikes | Burst MISSes | Hit `max_connections` 151 |

`max_allowed_packet=256MB` is generous — good for large Elementor revisions — but large packets during peak can spike memory.

### 2. Why 518 MB can still hurt

Size ≠ QPS capacity. A small DB with:

- Missing indexes on custom plugin tables  
- Full table scans from filters  
- Lock contention on `wp_options`  

…will stall PHP workers → Cloudflare 522.

### 3. Local uploads growth anatomy (43.69 GB)

Contributors typically include:

- Original product images (high-res)  
- Multiple resized derivatives (WP image sizes + theme + Woo + Elementor)  
- NitroPack/optimized copies if stored locally  
- PDFs (PDF Embedder)  
- WebToffee feed files  
- Elementor generated CSS under uploads  
- Unused media after product deletions  

`upload_max_filesize=20MB` limits new uploads but **does not shrink historical bloat**.

### 4. Imagick resource profile

Site Health reports extremely high Imagick resource limits (AREA/MAP/MEMORY figures are enormous). That means a single malicious or accidental giant image operation **can** consume large RAM/CPU — governance needed for regeneration jobs.

### 5. Claimed LB × local disk

If multiple origins each have local `uploads/`:

| Strategy | Result |
|----------|--------|
| No sharing | Missing images depending on node; editors confused |
| Rsync cron | Race conditions, delayed media |
| NFS/shared mount | Correct direction if performant |
| Object storage + CDN | Best enterprise pattern |

**SME rule:** until shared media is proven, treat multi-server claim as **incomplete architecture**.

### 6. Charset note

`DB_CHARSET=utf8` in WP historically means **utf8mb3** on MySQL/MariaDB — emoji/supplementary character risks. Not today’s outage driver; note for cleanliness toward utf8mb4.

### 7. Backup / filesystem writability

Fully writable trees simplify ops and enlarge ransomware/malware blast radius. Pair with Wordfence + host snapshots (unknown).

---

## Interdependencies & Communication Flow

```text
PHP mysqli
  → MariaDB 10.11 (posts, meta, options, woo, gf, logs)
LiteSpeed static/media
  → /wp-content/uploads (43.69 GB)
Imagick
  → CPU/RAM on derivative generation
Cloudflare / NitroPack
  → Cache media URLs; purge on replace
```

### Upstream writers

Elementor saves, Woo admin, GF entries, BLC, Activity Log, feed generators, editors.

### Downstream readers

Storefront PDPs, feeds, chat widgets loading images, Google bots.

---

## Current Known State vs. Critical Vulnerabilities

### Known state

- MariaDB 10.11.19, 518 MB, 151 max connections  
- Uploads 43.69 GB local  
- Imagick primary editor  
- 20 MB upload cap  
- Fonts directory missing  
- No evidenced object-cache tier to absorb repeated option reads  

### Critical vulnerabilities

1. **Local media vs claimed multi-node** — architectural contradiction risk.  
2. **BLC + Activity Log write pressure** on modest DB.  
3. **postmeta/options bloat potential** (unmeasured but likely).  
4. **Image CPU storms** on large library.  
5. **No evidenced offload/CDN origin shield for media** beyond CF/NitroPack unknowns.  
6. **Connection ceiling 151** under purge-storm PHP fan-out.

### Capacity interaction

Even with edge caching, **admin bulk image regen** or **feed rebuild** can monopolize DB/CPU and induce storefront 522s — schedule isolation required.

---

## Verified vs. Claimed Discrepancies

| Statement | Class |
|-----------|-------|
| DB and uploads sizes/paths above | **Verified** |
| MariaDB co-located on same VM as LiteSpeed | **Unknown** (often true on shared hosts) |
| Shared storage across LB nodes | **Not evidenced** |
| Object storage already in use | **Not evidenced** |
| “DB is fine because <1GB” | **Unsafe inference** |

---

## Data/media remediation roadmap

| Pri | Action | Acceptance |
|-----|--------|------------|
| P0 | Deactivate BLC; monitor DB write IOPS | Write rate ↓ |
| P1 | Autoload options audit; transient cleanup | Options query shrink |
| P1 | Prove media sharing strategy if LB real | No node-local image 404s |
| P2 | Offload cold media to object storage + CF |
| P2 | Lifecycle unused derivatives | Uploads MoM flat/down |
| P3 | Move to utf8mb4 with planned maintenance | Charset modernized |

---

## Cross-references

- BLC → `07_OPS_SECURITY_ACCESS.md`  
- LB claim → `01_EDGE_INGRESS.md`  
- PDP media weight → `06_PAGE_BUILDERS_FRONTEND.md`  
- Failure modes → `12_SYSTEM_SEQUENCE_AND_FAILURE_MODES.md`
