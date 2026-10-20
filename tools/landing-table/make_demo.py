"""
Shadowdark Enhancer: copy the landing table's pictures and layout next to the public demo page
(docs/wiki/demo/landing-table/, published with the manual on GitHub Pages).

    python3 tools/landing-table/make_demo.py

Run after make_assets.py. The demo page is plain HTML and needs no Foundry; its Liar's dice is the module's own
liars-dice-core.mjs, copied next to it.
"""
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "assets", "landing-table")
DEMO = os.path.join(ROOT, "docs", "wiki", "demo", "landing-table")
OUT = os.path.join(DEMO, "assets")

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(SRC, OUT)
layout = open(os.path.join(ROOT, "scripts", "town", "landing-table-layout.mjs")).read()
body = re.search(r"export default (\{.*\});", layout, re.S).group(1)
with open(os.path.join(DEMO, "layout.js"), "w") as f:
    f.write("// Copied from scripts/town/landing-table-layout.mjs by tools/landing-table/make_demo.py.\nexport default " + body + ";\n")
# The demo plays the module's own Liar's dice rules (pure, no Foundry), copied as they are.
shutil.copyfile(os.path.join(ROOT, "scripts", "town", "liars-dice-core.mjs"), os.path.join(DEMO, "liars-dice-core.js"))
print("demo assets:", sorted(os.listdir(OUT)))
