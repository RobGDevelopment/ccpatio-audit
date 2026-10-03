#!/usr/bin/env python3
"""
CC Patio — Repeat-MISS Endurance Tester (single-threaded)

Hits the same base URL 15 times with a unique cache-busting query string each
attempt, sleeping 4+ seconds between requests. Prints Attempt / Status / TTFB
so origin lag drift is visible without concurrency.

Safety:
  - Strictly sequential
  - Default --sleep 4 (minimum recommended under OPcache FULL)
  - No async / thread pools

Usage:
  python research/ccpatio_endurance_tester.py "https://www.ccpatio.com/"
  python research/ccpatio_endurance_tester.py "https://www.ccpatio.com/product/YOUR-SLUG/" --sleep 4
  python research/ccpatio_endurance_tester.py "https://www.ccpatio.com/" --runs 15 --json-out research/endurance.json
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import time
import uuid
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


DEFAULT_RUNS = 15
DEFAULT_SLEEP = 4.0
DEFAULT_TIMEOUT = 90.0
USER_AGENT = (
    "CCPatio-EnduranceTester/1.0 (+sequential; repeat-MISS; "
    "OPcache-full safety sleep)"
)


@dataclass
class Attempt:
    attempt: int
    url: str
    status: int | None
    ttfb_ms: float | None
    total_ms: float | None
    error: str | None
    cf_cache_status: str | None
    nitro_cache: str | None
    cf_ray: str | None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def with_cache_buster(base_url: str, attempt: int) -> str:
    """Append unique QS so NitroPack/CF anonymous HTML HIT is unlikely."""
    parsed = urlparse(base_url)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    q["ccp_probe"] = str(attempt)
    q["ccp_nonce"] = uuid.uuid4().hex
    q["t"] = str(int(time.time() * 1000))
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            urlencode(q),
            parsed.fragment,
        )
    )


def header_map(headers) -> dict[str, str]:
    if not headers:
        return {}
    return {k.lower(): v for k, v in headers.items()}


def fetch(url: str, timeout: float) -> Attempt:
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    ctx = ssl.create_default_context()
    t0 = time.perf_counter()
    status: int | None = None
    ttfb_ms: float | None = None
    total_ms: float | None = None
    error: str | None = None
    cf_cache = None
    nitro = None
    cf_ray = None

    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            status = getattr(resp, "status", None) or resp.getcode()
            ttfb_ms = (time.perf_counter() - t0) * 1000.0
            h = header_map(resp.headers)
            cf_cache = h.get("cf-cache-status")
            nitro = h.get("x-nitro-cache") or h.get("x-nitropack-cache")
            cf_ray = h.get("cf-ray")
            resp.read()  # drain body; still sequential / single request
            total_ms = (time.perf_counter() - t0) * 1000.0
    except urllib.error.HTTPError as e:
        status = e.code
        ttfb_ms = (time.perf_counter() - t0) * 1000.0
        h = header_map(e.headers)
        cf_cache = h.get("cf-cache-status")
        nitro = h.get("x-nitro-cache") or h.get("x-nitropack-cache")
        cf_ray = h.get("cf-ray")
        try:
            e.read()
        except Exception:
            pass
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"HTTPError {e.code}"
    except urllib.error.URLError as e:
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"URLError: {e.reason}"
    except TimeoutError:
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"Timeout after {timeout}s"
    except Exception as e:  # noqa: BLE001
        total_ms = (time.perf_counter() - t0) * 1000.0
        error = f"{type(e).__name__}: {e}"

    return Attempt(
        attempt=0,
        url=url,
        status=status,
        ttfb_ms=round(ttfb_ms, 1) if ttfb_ms is not None else None,
        total_ms=round(total_ms, 1) if total_ms is not None else None,
        error=error,
        cf_cache_status=cf_cache,
        nitro_cache=nitro,
        cf_ray=cf_ray,
    )


def print_table(rows: list[Attempt]) -> None:
    # Fixed-width columns for clean terminal drift watching
    hdr = (
        f"{'#':>3}  {'Status':>6}  {'TTFB_ms':>10}  {'Total_ms':>10}  "
        f"{'CF':>8}  {'Nitro':>6}  Error"
    )
    sep = "-" * len(hdr)
    print(sep)
    print(hdr)
    print(sep)
    for r in rows:
        status = "-" if r.status is None else str(r.status)
        ttfb = "-" if r.ttfb_ms is None else f"{r.ttfb_ms:.1f}"
        total = "-" if r.total_ms is None else f"{r.total_ms:.1f}"
        cf = r.cf_cache_status or "-"
        nitro = r.nitro_cache or "-"
        err = r.error or ""
        print(
            f"{r.attempt:>3}  {status:>6}  {ttfb:>10}  {total:>10}  "
            f"{cf:>8}  {nitro:>6}  {err}"
        )
    print(sep)

    ttfbs = [r.ttfb_ms for r in rows if r.ttfb_ms is not None]
    if ttfbs:
        drift = ttfbs[-1] - ttfbs[0]
        print(
            f"TTFB min={min(ttfbs):.1f} ms  max={max(ttfbs):.1f} ms  "
            f"avg={sum(ttfbs)/len(ttfbs):.1f} ms  "
            f"drift(last-first)={drift:+.1f} ms"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="15x sequential cache-busting TTFB endurance probe"
    )
    parser.add_argument("url", help="Target base URL (query string will be appended)")
    parser.add_argument("--runs", type=int, default=DEFAULT_RUNS, help="Number of attempts (default 15)")
    parser.add_argument(
        "--sleep",
        type=float,
        default=DEFAULT_SLEEP,
        help="Seconds to wait after each request (default 4; do not lower under OPcache FULL)",
    )
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parser.add_argument("--json-out", default="", help="Optional JSON results path")
    args = parser.parse_args()

    if args.sleep < 4.0:
        print(
            "WARNING: --sleep < 4s is unsafe on OPcache-full origin. "
            "Raising to 4.0s.",
            file=sys.stderr,
        )
        args.sleep = 4.0

    if args.runs < 1:
        print("ERROR: --runs must be >= 1", file=sys.stderr)
        return 1

    print(
        f"Endurance MISS probe\n"
        f"  base={args.url}\n"
        f"  runs={args.runs}  sleep={args.sleep}s  timeout={args.timeout}s\n"
        f"  mode=single-threaded sequential cache-bust\n",
        file=sys.stderr,
    )

    rows: list[Attempt] = []
    for i in range(1, args.runs + 1):
        busted = with_cache_buster(args.url, i)
        result = fetch(busted, args.timeout)
        result.attempt = i
        rows.append(result)
        ttfb = "-" if result.ttfb_ms is None else f"{result.ttfb_ms:.1f}ms"
        print(
            f"[{i}/{args.runs}] status={result.status} ttfb={ttfb} "
            f"nitro={result.nitro_cache or '-'} cf={result.cf_cache_status or '-'}",
            file=sys.stderr,
        )
        if i < args.runs:
            time.sleep(args.sleep)

    print()
    print_table(rows)

    if args.json_out:
        from pathlib import Path

        payload = {
            "probed_at_utc": utc_now(),
            "base_url": args.url,
            "runs": args.runs,
            "sleep_sec": args.sleep,
            "timeout_sec": args.timeout,
            "attempts": [asdict(r) for r in rows],
        }
        path = Path(args.json_out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nWrote JSON: {path}", file=sys.stderr)

    # Exit 2 if any 5xx/522-ish failure
    bad = any(
        (r.status is not None and r.status >= 500)
        or (r.error and "Timeout" in r.error)
        for r in rows
    )
    return 2 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
