#!/usr/bin/env python3
"""
CC Patio — External Black-Box Stability Probe (single-threaded)

Purpose:
  Prove Cloudflare / NitroPack routing signatures, frontend plugin footprint,
  and origin-leaning TTFB from outside the firewall — WITHOUT SSH, LiteSpeed,
  or Cloudflare dashboard access.

Safety:
  - Strictly sequential (one request at a time)
  - Configurable sleep between probes
  - Default target count is small; never fans out concurrency
  - Does NOT hammer the origin; suitable for fragile 522-prone hosts

Usage:
  python research/ccpatio_external_stability_probe.py
  python research/ccpatio_external_stability_probe.py --base https://www.ccpatio.com --sleep 2.5
  python research/ccpatio_external_stability_probe.py --json-out research/probe-results.json

Requires: Python 3.10+ (stdlib only)
"""

from __future__ import annotations

import argparse
import json
import random
import re
import ssl
import string
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any
from pathlib import Path
from urllib.parse import urljoin, urlparse


# ---------------------------------------------------------------------------
# Defaults — keep deliberately gentle
# ---------------------------------------------------------------------------

DEFAULT_BASE = "https://www.ccpatio.com"
DEFAULT_SLEEP_SEC = 2.0
DEFAULT_TIMEOUT_SEC = 60.0
USER_AGENT = (
    "CCPatio-ExternalStabilityProbe/1.0 (+sequential; black-box audit; "
    "contact: internal-architecture)"
)

PLUGIN_PATH_RE = re.compile(
    r"""(?:https?:)?//[^"'>\s]*/wp-content/plugins/([^/"'\s?]+)""",
    re.IGNORECASE,
)
PLUGIN_PATH_REL_RE = re.compile(
    r"""/wp-content/plugins/([^/"'\s?]+)""",
    re.IGNORECASE,
)
NITRO_HINT_RE = re.compile(r"nitropack", re.IGNORECASE)
CF_RAY_RE = re.compile(r"^[a-f0-9]+-[A-Z0-9]+$", re.IGNORECASE)


@dataclass
class ProbeResult:
    label: str
    url: str
    ok: bool
    status_code: int | None
    ttfb_ms: float | None
    total_ms: float | None
    error: str | None
    headers: dict[str, str] = field(default_factory=dict)
    cache_signals: dict[str, Any] = field(default_factory=dict)
    plugins_found: list[str] = field(default_factory=list)
    plugin_count_unique: int = 0
    body_bytes: int = 0
    is_cloudflare_522_page: bool = False
    notes: list[str] = field(default_factory=list)


class ScriptSrcCollector(HTMLParser):
    """Collect script/link/img URLs that may reference plugins."""

    def __init__(self) -> None:
        super().__init__()
        self.urls: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if tag == "script" and attr_map.get("src"):
            self.urls.append(attr_map["src"])
        elif tag == "link" and attr_map.get("href"):
            self.urls.append(attr_map["href"])
        elif tag in {"img", "source"} and attr_map.get("src"):
            self.urls.append(attr_map["src"])
        elif tag == "img" and attr_map.get("data-src"):
            self.urls.append(attr_map["data-src"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rand_token(n: int = 12) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def extract_plugins(html: str) -> list[str]:
    found: set[str] = set()
    for rx in (PLUGIN_PATH_RE, PLUGIN_PATH_REL_RE):
        for m in rx.finditer(html):
            slug = m.group(1).strip().lower()
            if slug and slug not in {".", ".."}:
                found.add(slug)
    # Also walk parsed src/href attributes for robustness
    collector = ScriptSrcCollector()
    try:
        collector.feed(html)
    except Exception:
        pass
    for u in collector.urls:
        for rx in (PLUGIN_PATH_RE, PLUGIN_PATH_REL_RE):
            m = rx.search(u)
            if m:
                found.add(m.group(1).strip().lower())
    return sorted(found)


def classify_cache_headers(headers: dict[str, str]) -> dict[str, Any]:
    # Normalize to lowercase keys for analysis; keep originals separately
    h = {k.lower(): v for k, v in headers.items()}
    signals: dict[str, Any] = {
        "server": h.get("server"),
        "cf_ray": h.get("cf-ray"),
        "cf_cache_status": h.get("cf-cache-status"),
        "cf_apo_via": h.get("cf-apo-via") or h.get("apo-via"),
        "age": h.get("age"),
        "cache_control": h.get("cache-control"),
        "x_cache": h.get("x-cache"),
        "x_nitro_cache": None,
        "nitro_headers": {},
        "likely_behind_cloudflare": bool(h.get("cf-ray") or "cloudflare" in (h.get("server") or "").lower()),
        "nitropack_header_hits": [],
    }

    for key, val in h.items():
        if "nitro" in key.lower() or (isinstance(val, str) and NITRO_HINT_RE.search(val or "")):
            signals["nitro_headers"][key] = val
            signals["nitropack_header_hits"].append(key)

    # Common NitroPack header names seen in the wild
    for candidate in (
        "x-nitropack-cache",
        "x-nitro-cache",
        "x-nitropack",
        "nitro-cache",
    ):
        if candidate in h:
            signals["x_nitro_cache"] = h[candidate]

    return signals


def looks_like_cf_522(status: int | None, body: bytes) -> bool:
    if status == 522:
        return True
    if not body:
        return False
    text = body[:8000].decode("utf-8", errors="ignore").lower()
    return "error code 522" in text or "connection timed out" in text and "cloudflare" in text


def fetch(
    url: str,
    *,
    timeout: float,
    method: str = "GET",
    extra_headers: dict[str, str] | None = None,
) -> ProbeResult:
    label = url
    headers_out: dict[str, str] = {}
    req_headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    if extra_headers:
        req_headers.update(extra_headers)

    request = urllib.request.Request(url, method=method, headers=req_headers)
    ctx = ssl.create_default_context()

    t0 = time.perf_counter()
    ttfb_ms: float | None = None
    total_ms: float | None = None
    status: int | None = None
    body = b""
    error: str | None = None
    notes: list[str] = []

    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ctx) as resp:
            status = getattr(resp, "status", None) or resp.getcode()
            # First byte / headers available ≈ TTFB for urllib
            ttfb_ms = (time.perf_counter() - t0) * 1000.0
            headers_out = {k: v for k, v in resp.headers.items()}
            body = resp.read()
            total_ms = (time.perf_counter() - t0) * 1000.0
    except urllib.error.HTTPError as e:
        # HTTPError is also a response (e.g. 404/403/522 pages)
        status = e.code
        ttfb_ms = (time.perf_counter() - t0) * 1000.0
        try:
            headers_out = {k: v for k, v in e.headers.items()} if e.headers else {}
        except Exception:
            headers_out = {}
        try:
            body = e.read() or b""
        except Exception:
            body = b""
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"HTTPError {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"URLError: {e.reason}"
        notes.append("Network/TLS failure or origin unreachable via edge")
    except TimeoutError:
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"Timeout after {timeout}s"
        notes.append("Client-side timeout — consistent with origin stall / CF 522 class")
    except Exception as e:  # noqa: BLE001 — probe must never crash the suite
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"{type(e).__name__}: {e}"

    html = ""
    plugins: list[str] = []
    if body and status and status < 600:
        # Only parse HTML-ish bodies
        ctype = ""
        for k, v in headers_out.items():
            if k.lower() == "content-type":
                ctype = v.lower()
                break
        if "html" in ctype or body.lstrip()[:1] == b"<" or b"<!DOCTYPE" in body[:200].upper():
            html = body.decode("utf-8", errors="ignore")
            plugins = extract_plugins(html)
            if NITRO_HINT_RE.search(html):
                notes.append("NitroPack fingerprint found in HTML body")

    cache_signals = classify_cache_headers(headers_out)
    is_522 = looks_like_cf_522(status, body)

    if is_522:
        notes.append("Cloudflare 522 page or status detected")
    if cache_signals.get("cf_cache_status"):
        notes.append(f"cf-cache-status={cache_signals['cf_cache_status']}")
    if cache_signals.get("x_nitro_cache"):
        notes.append(f"nitro-cache={cache_signals['x_nitro_cache']}")
    if ttfb_ms is not None and ttfb_ms >= 3000:
        notes.append("TTFB >= 3s (origin stress signal on MISS/bypass paths)")
    if ttfb_ms is not None and ttfb_ms >= 8000:
        notes.append("TTFB >= 8s (severe — 522-adjacent)")

    return ProbeResult(
        label=label,
        url=url,
        ok=error is None and status is not None and status < 500,
        status_code=status,
        ttfb_ms=round(ttfb_ms, 1) if ttfb_ms is not None else None,
        total_ms=round(total_ms, 1) if total_ms is not None else None,
        error=error,
        headers=headers_out,
        cache_signals=cache_signals,
        plugins_found=plugins,
        plugin_count_unique=len(plugins),
        body_bytes=len(body),
        is_cloudflare_522_page=is_522,
        notes=notes,
    )


def build_targets(base: str) -> list[tuple[str, str]]:
    """Return (label, url) pairs — sequential probe plan."""
    base = base.rstrip("/")
    token = _rand_token()
    nonce = int(time.time())

    return [
        ("homepage_warm", f"{base}/"),
        ("homepage_cache_buster", f"{base}/?ccp_probe={token}&t={nonce}"),
        ("wp_json_index", f"{base}/wp-json/"),
        ("wp_json_wc_v3", f"{base}/wp-json/wc/v3/"),
        ("wp_json_wp_v2_posts", f"{base}/wp-json/wp/v2/posts?per_page=1&ccp_probe={token}"),
        ("wp_login_default", f"{base}/wp-login.php"),
        ("xmlrpc", f"{base}/xmlrpc.php"),
        ("feed_rss", f"{base}/feed/"),
        # Catalog-mode safe: cart/checkout may redirect or render inquiry UX
        ("cart_path", f"{base}/cart/"),
        ("checkout_path", f"{base}/checkout/"),
        ("my_account", f"{base}/my-account/"),
        # Query patterns that often defeat anonymous HTML page cache
        ("nitro_ignore_hint", f"{base}/?nitro=ignore&ccp_probe={token}"),
        ("nocache_hint", f"{base}/?nocache={token}"),
        ("random_qs", f"{base}/?{token}={nonce}"),
    ]


def summarize(results: list[ProbeResult]) -> dict[str, Any]:
    ttfbs = [r.ttfb_ms for r in results if r.ttfb_ms is not None]
    plugin_counter: Counter[str] = Counter()
    for r in results:
        plugin_counter.update(r.plugins_found)

    cf_statuses = [
        r.cache_signals.get("cf_cache_status")
        for r in results
        if r.cache_signals.get("cf_cache_status")
    ]
    nitro_hits = sum(1 for r in results if r.cache_signals.get("nitropack_header_hits") or any(
        "nitro" in n.lower() for n in r.notes
    ))

    return {
        "probed_at_utc": _now_iso(),
        "result_count": len(results),
        "http_5xx_or_522": sum(
            1
            for r in results
            if r.is_cloudflare_522_page or (r.status_code is not None and r.status_code >= 500)
        ),
        "ttfb_ms_min": min(ttfbs) if ttfbs else None,
        "ttfb_ms_max": max(ttfbs) if ttfbs else None,
        "ttfb_ms_avg": round(sum(ttfbs) / len(ttfbs), 1) if ttfbs else None,
        "cf_cache_status_values": sorted({str(s) for s in cf_statuses}),
        "nitropack_signal_on_responses": nitro_hits,
        "unique_plugins_seen_across_html": len(plugin_counter),
        "top_plugins": plugin_counter.most_common(25),
        "interpretation_hints": [
            "HIT vs MISS/BYPASS/DYNAMIC/EXPIRED in cf-cache-status shows Cloudflare HTML/asset caching behavior.",
            "Large TTFB gap between homepage and ?cache-buster / wp-json paths suggests edge HIT vs origin compile cost.",
            "Plugin path count in DOM understates active plugins (not all enqueue assets on every URL) but proves frontend bloat.",
            "OPcache FULL cannot be read externally; catastrophic TTFB on bypass paths is the external proxy evidence.",
            "Catalog mode means this lag exists BEFORE checkout concurrency — enabling transactions increases origin risk.",
        ],
    }


def print_report(results: list[ProbeResult], summary: dict[str, Any]) -> None:
    print("=" * 78)
    print("CC Patio External Stability Probe — Sequential Report")
    print("=" * 78)
    for r in results:
        print(f"\n[{r.label}]")
        print(f"  URL:        {r.url}")
        print(f"  Status:     {r.status_code}  ok={r.ok}  522={r.is_cloudflare_522_page}")
        print(f"  TTFB ms:    {r.ttfb_ms}")
        print(f"  Total ms:   {r.total_ms}")
        print(f"  Bytes:      {r.body_bytes}")
        print(f"  CF cache:   {r.cache_signals.get('cf_cache_status')}")
        print(f"  CF-Ray:     {r.cache_signals.get('cf_ray')}")
        print(f"  Server:     {r.cache_signals.get('server')}")
        print(f"  Nitro hdrs: {r.cache_signals.get('nitropack_header_hits')}")
        print(f"  Plugins:    {r.plugin_count_unique} unique → {r.plugins_found[:12]}")
        if r.error:
            print(f"  Error:      {r.error}")
        if r.notes:
            print(f"  Notes:      {'; '.join(r.notes)}")

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)
    print(json.dumps(summary, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="Sequential black-box probe for www.ccpatio.com")
    parser.add_argument("--base", default=DEFAULT_BASE, help="Site base URL")
    parser.add_argument("--sleep", type=float, default=DEFAULT_SLEEP_SEC, help="Seconds between probes")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SEC, help="Per-request timeout seconds")
    parser.add_argument("--json-out", default="", help="Optional path to write full JSON results")
    parser.add_argument(
        "--extra-url",
        action="append",
        default=[],
        help="Additional URL to probe (repeatable). Use absolute or site-relative path.",
    )
    args = parser.parse_args()

    targets = build_targets(args.base)
    for i, raw in enumerate(args.extra_url):
        if raw.startswith("http://") or raw.startswith("https://"):
            targets.append((f"extra_{i}", raw))
        else:
            targets.append((f"extra_{i}", urljoin(args.base.rstrip("/") + "/", raw.lstrip("/"))))

    print(
        f"Starting sequential probe of {len(targets)} URLs against {args.base}\n"
        f"sleep={args.sleep}s timeout={args.timeout}s  (single-threaded)\n",
        file=sys.stderr,
    )

    results: list[ProbeResult] = []
    for idx, (label, url) in enumerate(targets):
        # rewrite label into result after fetch
        result = fetch(url, timeout=args.timeout)
        result.label = label
        results.append(result)
        print(
            f"[{idx + 1}/{len(targets)}] {label}: status={result.status_code} "
            f"ttfb={result.ttfb_ms}ms plugins={result.plugin_count_unique}",
            file=sys.stderr,
        )
        if idx < len(targets) - 1 and args.sleep > 0:
            time.sleep(args.sleep)

    summary = summarize(results)
    print_report(results, summary)

    if args.json_out:
        payload = {
            "meta": {
                "base": args.base,
                "sleep_sec": args.sleep,
                "timeout_sec": args.timeout,
                "user_agent": USER_AGENT,
                "probed_at_utc": _now_iso(),
                "parsed_host": urlparse(args.base).hostname,
            },
            "summary": summary,
            "results": [asdict(r) for r in results],
        }
        out_path = Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nWrote JSON: {out_path}", file=sys.stderr)

    # Non-zero if we observed 522/5xx — useful for CI-ish gating later
    bad = summary["http_5xx_or_522"]
    return 2 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
