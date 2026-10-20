"""
Shadowdark Enhancer: fetch the CC0 Poly Haven assets the landing table is built with (polyhaven.com, no account).

    python3 tools/landing-table/fetch_assets.py [art folder]

Downloads each asset's 2k .blend with its textures into the art folder (default: $LT_ART, else
~/git/.demo/landing-art), keeping Poly Haven's own relative paths. The assets are CC0 (public domain); they stay
outside the module, which ships only the rendered pictures. build_table.py reads them from the same folder.
"""
import json
import os
import sys
import urllib.request

ASSETS = ["treasure_chest", "brass_goblets", "wooden_candlestick", "seadogs_compass", "wood_table_001", "leather_red_02"]
ART = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("LT_ART", "~/git/.demo/landing-art"))
UA = {"User-Agent": "shadowdark-enhancer landing-table build"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def save(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = get(url)
    with open(path + ".part", "wb") as f:
        f.write(data)
    os.replace(path + ".part", path)


for asset in ASSETS:
    files = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))
    blend = files["blend"]["2k"]["blend"]
    folder = os.path.join(ART, asset)
    save(blend["url"], os.path.join(folder, f"{asset}.blend"))
    for rel, inc in (blend.get("include") or {}).items():
        save(inc["url"], os.path.join(folder, rel))
    print("fetched", asset)
