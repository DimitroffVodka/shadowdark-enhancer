#!/usr/bin/env python3
"""Numbered black discs baked into a map image: find them and read their digits.
usage: derive_circles.py <config.json> <outdir>  (config: list of {id,vtt,lo,hi,d})  d = disc diameter as a fraction of image width"""
import sys, json, os, subprocess, tempfile
import numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

def _ocr(arr, psm):
    with tempfile.TemporaryDirectory() as t:
        cv2.imwrite(f"{t}/c.png", arr)
        return subprocess.run(["tesseract", f"{t}/c.png", "-", "--psm", str(psm), "-c", "tessedit_char_whitelist=0123456789"],
                              capture_output=True, text=True).stdout.strip()

def _glyph(dg):
    H2 = 120; W2 = max(int(dg.shape[1] * H2 / dg.shape[0]), 24)
    dg = cv2.resize(dg, (W2, H2), interpolation=cv2.INTER_CUBIC)
    dg = cv2.dilate(dg, np.ones((3, 3), np.uint8))
    return cv2.copyMakeBorder(255 - dg, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)

def read_digits(crop, disc_r=None):
    """The digits of a white-on-black numbered disc. The white pixels well inside the disc are split
    into glyphs, left to right, and each glyph is read on its own (single characters read far more
    reliably than a small two-digit run); if that fails the whole run is read in one go."""
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY); h, w = g.shape; r = min(h, w) // 2
    m = np.zeros_like(g); cv2.circle(m, (w // 2, h // 2), int((disc_r or r) * 0.70), 255, -1)
    white = ((g > 140) & (m > 0)).astype(np.uint8) * 255
    n, lab, st, _ = cv2.connectedComponentsWithStats(white, 8)
    boxes = sorted([st[i] for i in range(1, n) if st[i][4] >= 12], key=lambda s: s[0])
    if not boxes or len(boxes) > 3: return None
    out = ""
    for x, y, bw, bh, _a in boxes:
        glyph = white[y:y + bh, x:x + bw]
        got = _ocr(_glyph(glyph), 10)
        if not got.isdigit() or len(got) != 1: out = None; break
        out += got
    if out: return int(out)
    ys, xs = np.where(white > 0)
    if len(xs) < 20: return None
    arr = _glyph(white[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    for psm in (8, 13, 7):
        o = _ocr(arr, psm)
        if o.isdigit(): return int(o)
    return None

def derive(cfg, outdir):
    img = cv2.imread(cfg["vtt"]); H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, dark = cv2.threshold(gray, 90, 255, cv2.THRESH_BINARY_INV)
    d = cfg["d"] * W
    # fill the white digits, then keep only what can hold a disc: labels and leader lines are thinner
    filled = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(d * 0.35) | 1,) * 2))
    k = int(d * 0.72) | 1
    opened = cv2.morphologyEx(filled, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(opened, 8)
    found = {}
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (0.6 * d <= w <= 1.4 * d and 0.6 * d <= h <= 1.4 * d): continue
        if abs(w - h) > 0.25 * max(w, h): continue
        cx, cy = int(cent[i][0]), int(cent[i][1]); dr = min(w, h) / 2.0; r = int(dr * 1.3)
        num = read_digits(img[max(cy - r, 0):cy + r, max(cx - r, 0):cx + r], dr)
        if num is None or not (cfg["lo"] <= num <= cfg["hi"]): continue
        found.setdefault(num, []).append((float(cent[i][0]) / W, float(cent[i][1]) / H))
    final = {n: v[0] for n, v in found.items()}
    missing = [n for n in range(cfg["lo"], cfg["hi"] + 1) if n not in final]
    dups = sorted(n for n, v in found.items() if len(v) > 1)
    ov = img.copy(); r = int(d * 0.8)
    for nn, (u, v) in final.items():
        cv2.circle(ov, (int(u * W), int(v * H)), r, (0, 0, 255), max(4, r // 8)); cv2.putText(ov, str(nn), (int(u * W) + r, int(v * H) - r), cv2.FONT_HERSHEY_SIMPLEX, d / 40, (0, 0, 255), max(2, int(d / 25)))
    s = 1500.0 / max(W, H); ov = cv2.resize(ov, (int(W * s), int(H * s))); cv2.imwrite(f"{outdir}/{cfg['id']}.png", ov)
    out = {"id": cfg["id"], "score": 1.0, "rot": 0, "found": len(final), "expected": cfg["hi"] - cfg["lo"] + 1, "missing": missing, "dups": dups, "aspect": round(W / H, 4),
           "pins": {str(n): [round(u, 4), round(v, 4)] for n, (u, v) in sorted(final.items())}}
    json.dump(out, open(f"{outdir}/{cfg['id']}.json", "w")); return out

if __name__ == "__main__":
    cfgs = json.load(open(sys.argv[1])); outdir = sys.argv[2]; os.makedirs(outdir, exist_ok=True)
    for c in cfgs:
        o = derive(c, outdir)
        print(f"{o['id']}: found={o['found']}/{o['expected']} missing={o['missing']} dups={o['dups']}", flush=True)
