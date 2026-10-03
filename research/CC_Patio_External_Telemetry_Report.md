# CC Patio — External Black-Box Telemetry Report

**Classification:** Confidential — Executive / Architecture  
**Subject environment:** https://www.ccpatio.com (WordPress / WooCommerce production)  
**Audit type:** External black-box stability & caching telemetry (no SSH / LiteSpeed / Cloudflare dashboard required for these findings)  
**Evidence date:** 18 September 2026  
**Evidence archive:** `research/telemetry_archive_20260918/`  
**Prepared by:** Principal Systems Architecture (CC Patio stability program)  
**Related corpus:** `research/system_architecture_SMEs/`, `research/MASTER_CCPATIO_ARCHITECTURE_SME.md`, prior Site Health dump `2026-09-18T12:45:48Z`

---

## 1. Purpose

This report records **empirical, externally observed** behavior of the live origin behind Cloudflare and NitroPack. It converts sequential probe telemetry into an executive verdict on whether the current architecture is stable enough for continued operation—and whether enabling full WooCommerce transactional traffic is safe.

All probes were **single-threaded and sequential**, with a **minimum 4-second sleep** between endurance requests, explicitly to avoid load-testing a known OPcache-saturated origin.

---

## 2. Method summary

| Tool | Role | Artifact |
|------|------|----------|
| `ccpatio_external_stability_probe.py` | Header signatures, plugin DOM census, multi-URL TTFB | `probe-results.json`, `probe-pdp.json` |
| `ccpatio_endurance_tester.py` | 15× cache-busted Repeat-MISS on a heavy PDP | `endurance.json` |
| Playbook | Curl / DevTools / interpretation guide | `EXTERNAL_BLACKBOX_STABILITY_AUDIT.md` |

**Primary endurance target:** `https://www.ccpatio.com/product/brooklyn-corner-sofa/`  
**Safety controls:** sequential only; `--sleep 4`; no async concurrency.

---

## 3. Verified findings

### 3.1 The Edge Masking (NitroPack HIT performance)

When NitroPack serves a cache **HIT**, Time to First Byte appears highly performant:

| URL | `x-nitro-cache` | TTFB | Approximate HTML size |
|-----|-----------------|------|------------------------|
| `/product/brooklyn-corner-sofa/` | **HIT** | **~145.3 ms** | **~3.3 MB** |
| `/collections/bravada-collections/` | **HIT** | **~106.9 ms** | **~3.0 MB** |

**Interpretation:** Edge/optimizer HTML caching **masks** origin cost for warmed anonymous views. Executive “the site feels fast” observations are consistent with **HIT path only**, not with origin health.

---

### 3.2 The Cloudflare Reality (`cf-cache-status: DYNAMIC`)

Across baseline, PDP/PLP, and endurance probes, Cloudflare consistently returned:

- `server: cloudflare`
- `cf-ray: …` (e.g., PHX / LAX PoPs)
- **`cf-cache-status: DYNAMIC`** on measured HTML/document responses

**Interpretation:** On these probes, Cloudflare is **proxying / WAF**, **not** serving HTML page-cache HITs. NitroPack owns the HTML HIT/MISS behavior (`x-nitro-cache: HIT|MISS`).

**Agency claim impact:** The defense that Cloudflare and NitroPack are “working together via API to save memory” is **not supported** by this telemetry as a dual HTML-cache memory architecture. Observed behavior is:

1. Cloudflare = DYNAMIC edge proxy  
2. NitroPack = HTML cache layer coupled to origin generation on MISS  

An API purge handshake (if present) may coordinate invalidation. It does **not** demonstrate Cloudflare HTML caching, does **not** expand PHP OPcache, and does **not** prevent origin stalls on MISS.

---

### 3.3 The 20.5-Second Origin Stall (Smoking Gun)

**Test:** 15 sequential GETs to `/product/brooklyn-corner-sofa/` with unique cache-busting query strings (`ccp_probe`, UUID nonce, timestamp), `--sleep 4`, forcing NitroPack **MISS** each attempt.

| Metric | Observed value |
|--------|----------------|
| HTTP status | 15/15 × **200** (no 522 in this window) |
| Cloudflare | **DYNAMIC** all attempts |
| NitroPack | **MISS** all attempts |
| TTFB typical band | **~685–932 ms** |
| **Attempt 3 TTFB** | **20,451.7 ms (20.5 seconds)** |
| TTFB min / max / avg | 685.3 / **20,451.7** / 2,101.1 ms |

**Interpretation:** Under tiny sequential load on an origin-leaning MISS path, the origin suffered a **catastrophic multi-second TTFB cliff**. A ~20.5s first-byte delay is the same failure class that produces Cloudflare **HTTP 522 Connection Timed Out** when the edge abandons the origin wait. Returning HTTP 200 after 20.5s is **not** evidence of stability; it is evidence of a **near-miss timeout**.

This externally corroborates the prior Site Health finding that PHP **OPcache is 100% FULL** (interned strings exhausted): LiteSpeed/PHP workers under miss pressure exhibit lockup-class latency consistent with compile/eviction thrash on a saturated opcode cache—especially on heavy Elementor PDPs.

---

### 3.4 The DOM Bloat

The Elementor-built Brooklyn Corner Sofa PDP returned approximately **3.3 MB** of HTML on the HIT path, with plugin footprints in the DOM including (non-exhaustive): Elementor, Elementor Pro, WooCommerce, Variation Swatches, Astra Addon, Favorites, EMCP Pro.

**Interpretation:** Each forced MISS requires regenerating an extremely large document through a bloated plugin/builder stack. That amplifies OPcache working-set pressure and LSAPI hold time.

---

### 3.5 The Soft-404 Trap (disabled commerce routes)

With transactional commerce effectively disabled / catalog-oriented:

| Path | Status | Approx. body | TTFB band |
|------|--------|--------------|-----------|
| `/cart/` | **404** | **~2.2–2.3 MB** | **~480–560 ms** |
| `/checkout/` | **404** | **~2.2–2.3 MB** | **~480–560 ms** |
| `/my-account/` | **404** | **~2.2–2.3 MB** | **~480–560 ms** |

DOM still showed `yith-woocommerce-catalog-mode` and full theme/builder plugin assets on these responses.

**Interpretation:** Disabled commerce URLs still trigger a **full WordPress / Astra / plugin boot** and return a **massive soft-404**. That is a standing **origin tax** for bots, scanners, and mistaken links—even while checkout is off.

---

## 4. What this audit did *not* claim

- It did **not** read live OPcache percentages from outside (Site Health remains the direct OPcache evidence).  
- It did **not** reproduce a Cloudflare 522 HTML error page in these specific runs (the 20.5s stall is the stronger near-timeout proof).  
- It did **not** authorize concurrent load testing (explicitly avoided).  
- It does **not** prove multi-server load-balancer topology (still an unverified agency claim).

---

## 5. Evidence inventory

Archived under `research/telemetry_archive_20260918/`:

| File | Description |
|------|-------------|
| `probe-results.json` | Initial sequential multi-URL probe |
| `probe-pdp.json` | PDP/PLP + baseline probe including Brooklyn sofa / Bravada collection |
| `endurance.json` | 15× Repeat-MISS endurance on Brooklyn Corner Sofa |
| `ccpatio_external_stability_probe.py` | Probe tool (reproducible method) |
| `ccpatio_endurance_tester.py` | Endurance tool (reproducible method) |
| `EXTERNAL_BLACKBOX_STABILITY_AUDIT.md` | Method playbook |

---

## 6. Executive verdict

**The origin architecture is critically unstable.**

NitroPack cache HITs (~107–145 ms) create a false sense of performance while Cloudflare remains `DYNAMIC` (proxy, not HTML cache). Under forced MISS conditions—even with a 4-second pause between single requests—a heavy Elementor PDP exhibited a **20.5-second TTFB stall**, aligning with documented **100% OPcache saturation** and explaining intermittent Cloudflare **522** risk. Soft-404 commerce routes still impose multi-megabyte origin boots.

**Mandatory before any launch or re-enablement of live WooCommerce sessions/checkouts:**

1. **Feature freeze** on net-new storefront/builder work  
2. **OPcache limit expansion** and verification (`opcode_cache_full=false`, hit rate ≥ 90%)  
3. **Single HTML cache owner** decision (NitroPack *or* Cloudflare—not a “memory-saving dual stack” narrative)  
4. Re-run Repeat-MISS endurance with no ≥3s TTFB cliffs before declaring stability  

Until those gates pass, activating uncacheable WooCommerce session traffic should be treated as an **imminent queue / stall / 522 event**, not a routine go-live step.

---

## 7. Recommended next actions (owner: PrimeView + hosting)

| Priority | Action | Acceptance |
|----------|--------|------------|
| P0 | Export/resize OPcache (`memory_consumption`, `interned_strings_buffer`) fleet-wide | Site Health: not full; hit rate ≥ 90% |
| P0 | Confirm HTML cache owner; document CF Cache Rules (expect DYNAMIC today) | Written single-owner sign-off |
| P0 | 72h Cloudflare 5xx review once dashboard access granted | Zero 522s or explained residual |
| P1 | Eliminate fat soft-404 commerce routes or return lightweight 404 | Soft-404 body ≪ 100 KB |
| P1 | Deactivate Broken Link Checker / reduce plugin boot surface | Active plugins reduced; MISS TTFB flattened |
| P2 | Re-run `ccpatio_endurance_tester.py` on Brooklyn PDP | 15/15 MISS TTFB without multi-second cliffs |

---

**End of report.**
