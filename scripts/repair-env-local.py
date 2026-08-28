"""One-shot repair: split glued KEY= values in middleware/.env.local."""
from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

KNOWN = [
    "POSTGRES_URL",
    "WOOCOMMERCE_WEBHOOK_SECRET",
    "GHL_WEBHOOK_SECRET",
    "KATANA_API_KEY",
    "INNGEST_EVENT_KEY",
    "DOWNSTREAM_MUTATIONS",
]

p = Path(__file__).resolve().parents[1] / ".env.local"
if not p.is_file():
    raise SystemExit(f"Missing {p}")

backup = p.with_name(
    f".env.local.bak-{datetime.now().strftime('%Y%m%d%H%M%S')}"
)
shutil.copy2(p, backup)

raw = p.read_text(encoding="utf-8")
pattern = re.compile(r'(?:^|[\r\n"\']+)(' + "|".join(KNOWN) + r")=")
matches = list(pattern.finditer(raw))
if not matches:
    raise SystemExit("No known keys found in .env.local")

merged: dict[str, str] = {}
for i, m in enumerate(matches):
    key = m.group(1)
    start = m.end()
    end = matches[i + 1].start() if i + 1 < len(matches) else len(raw)
    val = raw[start:end].strip().strip("\r\n")
    if len(val) >= 2 and val[0] in "\"'" and val[-1] == val[0]:
        val = val[1:-1]
    else:
        val = val.strip("\"'")
    merged[key] = val

url = merged.get("POSTGRES_URL", "")
parsed = urlparse(url)
db_path = unquote(parsed.path or "")

print(f"backup: {backup.name}")
print(f"keys: {sorted(merged)}")
print(f"db_path: {db_path!r}")
print(f"host: {parsed.hostname}")
if any(tok in db_path for tok in ("KATANA", "API", "WOO", "GHL")) or '"' in url:
    raise SystemExit("POSTGRES_URL still dirty after split — fix manually")

lines: list[str] = []
for key in KNOWN:
    if key not in merged:
        continue
    val = merged[key]
    if any(c in val for c in ' #"\''):
        lines.append(f'{key}="{val}"')
    else:
        lines.append(f"{key}={val}")

p.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote clean .env.local")
