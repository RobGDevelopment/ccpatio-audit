# CC Patio — External Black-Box Stability Audit Playbook

**Target:** https://www.ccpatio.com  
**Constraints:** No SSH / LiteSpeed / Cloudflare dashboard yet. Sequential probes only.  
**Context:** OPcache FULL; 38 plugins; Cloudflare + NitroPack; WooCommerce **Catalog Mode** (no live checkout load yet).  
**Companion script:** `research/ccpatio_external_stability_probe.py`

---

## 1. Run the Python probe

```bash
python research/ccpatio_external_stability_probe.py
python research/ccpatio_external_stability_probe.py --sleep 3 --timeout 90 --json-out research/probe-results.json
python research/ccpatio_external_stability_probe.py --extra-url /product/some-heavy-pdp-slug/
```

**What it proves**

| Signal | Meaning |
|--------|---------|
| `cf-ray` / `cf-cache-status` / `server: cloudflare` | Request traversed Cloudflare |
| Nitro-related headers or HTML fingerprints | NitroPack in response path |
| `cf-cache-status: HIT` vs `MISS`/`BYPASS`/`DYNAMIC`/`EXPIRED` | Edge HTML/asset cache behavior |
| TTFB gap: homepage vs cache-buster / `wp-json` | Edge HIT cheap vs origin-leaning expensive |
| Unique `/wp-content/plugins/...` slugs in DOM | Frontend bloat footprint (lower bound of plugin surface) |
| Status 522 / CF 522 HTML | Live timeout class without CF dashboard |
| High TTFB on bypass paths **in catalog mode** | Origin already fragile **before** transactional Woo traffic |

**What it cannot prove directly**

- Exact OPcache `%` full (needs server)  
- LSAPI max children  
- MariaDB slow-query internals  
- Whether CF APO is enabled (only infer from headers like `cf-apo-via` if present)

---

## 2. Cache-bypass / origin-leaning TTFB probes (`curl`)

> Run **one at a time**. Wait 2–5 seconds between commands. Do **not** loop these in parallel.

Replace timestamps as needed. Catalog mode: `/cart/` and `/checkout/` are still useful as **uncacheable personalized routes** even if purchase is disabled.

### 2.1 Header inspection (routing signatures)

```bash
curl -sI "https://www.ccpatio.com/" | findstr /I "cf-ray cf-cache-status server nitro cache age"
curl -sI "https://www.ccpatio.com/?ccp_probe=%RANDOM%" | findstr /I "cf-ray cf-cache-status server nitro cache age"
```

macOS/Linux:

```bash
curl -sI "https://www.ccpatio.com/" | egrep -i 'cf-ray|cf-cache-status|server|nitro|cache-control|age'
curl -sI "https://www.ccpatio.com/?ccp_probe=$(date +%s)" | egrep -i 'cf-ray|cf-cache-status|server|nitro|cache-control|age'
```

### 2.2 TTFB measurement (write-out)

```bash
curl -o NUL -s -w "url:%{url_effective}\nhttp:%{http_code}\nttfb:%{time_starttransfer}s\ntotal:%{time_total}s\n" "https://www.ccpatio.com/"
curl -o NUL -s -w "url:%{url_effective}\nhttp:%{http_code}\nttfb:%{time_starttransfer}s\ntotal:%{time_total}s\n" "https://www.ccpatio.com/?ccp_probe=$(date +%s%N)"
```

Windows PowerShell-friendly:

```powershell
curl.exe -o NUL -s -w "http:%{http_code} ttfb:%{time_starttransfer}s total:%{time_total}s`n" "https://www.ccpatio.com/"
curl.exe -o NUL -s -w "http:%{http_code} ttfb:%{time_starttransfer}s total:%{time_total}s`n" "https://www.ccpatio.com/?ccp_probe=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
```

### 2.3 Origin-forcing / often-uncached paths

These are the highest-value external proxies for “OPcache FULL hurts”:

```bash
# WordPress REST index — usually dynamic PHP
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/wp-json/"

# Woo REST namespace (may 401 — still measures auth/bootstrap cost)
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/wp-json/wc/v3/"

# Core REST sample
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/wp-json/wp/v2/posts?per_page=1&ccp_probe=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

# Default login (may 404 if WPS Hide Login) — still informative
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/wp-login.php"

# xmlrpc — often dynamic / blocked; timing still useful
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/xmlrpc.php"

# RSS feed — frequently bypasses page HTML cache
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/feed/"

# Woo session-ish routes (catalog mode safe)
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/cart/"
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/checkout/"
curl.exe -o NUL -s -w "ttfb:%{time_starttransfer}s code:%{http_code}`n" "https://www.ccpatio.com/my-account/"
```

### 2.4 Cache-buster query strings (defeat anonymous HTML HIT)

```bash
curl.exe -sI "https://www.ccpatio.com/?nocache=$([guid]::NewGuid())"
curl.exe -sI "https://www.ccpatio.com/?nitro=ignore&ccp_probe=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
curl.exe -sI "https://www.ccpatio.com/?$(Get-Random)=$(Get-Random)"
```

**How to read results**

| Pattern | Interpretation |
|---------|----------------|
| Homepage TTFB low + `cf-cache-status: HIT` | Edge (or upstream CDN) serving cached HTML — **masks** origin pain |
| Same path with unique QS → TTFB jumps to multi-second + MISS/BYPASS | Origin PHP path exposed |
| `/wp-json/` always slow | REST bootstrap cost under plugin bloat / OPcache thrash |
| Occasional `522` or client timeout | Live confirmation of the incident class |
| Homepage HIT fast **and** JSON slow | Double-stack can look “fine” to executives while origin is already saturated |

**Catalog-mode risk statement:** if bypass TTFB is already catastrophic with carts disabled, enabling real Woo sessions/checkouts adds cookie-bypass traffic and write-heavy requests on the same exhausted OPcache — **522 risk rises before marketing traffic does**.

---

## 3. Alternative external telemetry (no backend login)

### A. Chrome / Edge DevTools (single page load)

1. Open window → Network → disable cache → load homepage, then a heavy PDP.  
2. Record:
   - Waiting (TTFB) for document  
   - Response headers: `cf-cache-status`, `cf-ray`, any `nitro*`  
   - Waterfall: long tasks after HTML (Elementor/Spectra JS)  
3. Repeat with `?ccp_probe=<random>` and compare document TTFB.

**Proves:** HIT vs miss latency; frontend JS/CSS bloat; CF presence.

### B. View-Source / plugin path census

Search page source for `/wp-content/plugins/`. Count unique slugs.

**Proves:** lower-bound plugin asset surface (not full 38, but bloat evidence).

### C. WebPageTest (one run at a time) — webpagetest.org

- Location far from origin + near origin  
- Compare first view vs repeat view  

**Proves:** TTFB geography; cacheable vs uncacheable document behavior; filmstrip for Elementor cost.

### D. Cloudflare trace (no login)

```bash
curl.exe -s "https://www.ccpatio.com/cdn-cgi/trace"
```

**Proves:** CF PoP / colo / http version — confirms orange-cloud path.

### E. SecurityHeaders / response header dumps over time

Save `curl -sI` outputs morning/afternoon/evening.

**Proves:** intermittent `MISS` storms; changing `age`; nitro header presence variance.

### F. RSS + REST as “DB/PHP canaries”

Hit `/feed/` and `/wp-json/` once each during business hours vs off-peak (still sequential).

**Proves:** origin compile/query lag without needing slow-query log. External proxy for DB+PHP health — not a substitute for `EXPLAIN`, but directional.

### G. Hide-login / health-check side effects

If `/wp-login.php` is 404 quickly via CF vs slow soft-404 through PHP, note which.

**Proves:** whether probes burn full WP boot (bad for LB health checks later).

### H. DNS / proxy confirmation

```bash
nslookup www.ccpatio.com
```

Cloudflare anycast IPs ⇒ proxied. Grey-cloud would show origin host IPs (rare if CF active).

### I. Optional: Mozilla observatory / SSL labs

Non-invasive TLS/config posture — not OPcache proof, but stack hygiene.

### J. What each method says about OPcache FULL + going live on transactions

| External observation | Link to OPcache FULL | Risk if Woo transactions go live |
|----------------------|----------------------|----------------------------------|
| Huge TTFB on `/wp-json/` & cache-busters | Origin recompile/bootstrap cost | Checkout/account AJAX joins same pool → more 522s |
| Fast HIT homepage, slow bypass | Edge masking origin disease | Campaign traffic + purge → everyone lands on MISS path |
| Nitro + CF headers both present | Dual acceleration path | Purge/API “handshake” ≠ less PHP RAM |
| Many plugin paths in DOM | Large PHP file working set | More files touch OPcache slab → more thrash |
| Intermittent 522 on single sequential probes | Origin already failing under **tiny** load | Cart/session concurrency will not be tiny |

---

## 4. Evidence pack for PrimeView (no credentials required)

Collect in one folder:

1. `probe-results.json` from the Python script  
2. Screenshot of any Cloudflare 522 page (URL + timestamp)  
3. Side-by-side TTFB: `/` vs `/?ccp_probe=…` vs `/wp-json/`  
4. Header dumps showing `cf-cache-status` HIT vs MISS/BYPASS  
5. List of unique plugin slugs parsed from HTML  

**Claim you can defend:** Origin-leaning paths are slow/unstable under catalog mode; enabling transactional Woo increases dynamic, uncacheable load on an already saturated PHP opcode cache — without needing their panel to make that engineering case.
