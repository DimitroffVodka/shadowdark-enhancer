#!/usr/bin/env python3
"""Where do a map's room numbers sit? Render the book's key-map page, find the GM's
map image on it (all four rotations), and carry the page's number labels across.
usage: derive_pdf.py <config.json> <outdir>   (config: list of {id,pdf,page,vtt,lo,hi})"""
import sys, re, json, subprocess, os, tempfile
import numpy as np
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None

BLUR = 3.0

def ink(im, thresh=None):
    """Darkness 0..1 (grayscale), lightly blurred so line positions that differ by a pixel still agree."""
    from PIL import ImageFilter
    g = im.convert("L").filter(ImageFilter.GaussianBlur(BLUR))
    return (255.0 - np.asarray(g, dtype=np.float32)) / 255.0

def fft_corr(big, small):
    H, W = big.shape; h, w = small.shape
    if h > H or w > W: return None
    sh = (H + h, W + w)
    c = np.fft.irfft2(np.fft.rfft2(big, s=sh) * np.fft.rfft2(small[::-1, ::-1], s=sh), s=sh)
    return c[h - 1:H, w - 1:W]

def box_sum(a, h, w):
    c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), 0), 1)
    return c[h:, w:] - c[:-h, w:] - c[h:, :-w] + c[:-h, :-w]

def score_at(Rk, V, W):
    """Zero-mean normalised cross-correlation of the map image at width W against the render."""
    H = int(round(W * V.size[1] / V.size[0]))
    if H < 8: return None
    small = ink(V.resize((W, H), Image.LANCZOS if W < V.size[0] else Image.BILINEAR))
    if Rk.shape[0] < H or Rk.shape[1] < W: return None
    n = float(H * W)
    t = small - small.mean(); tn = np.sqrt((t * t).sum())
    if tn < 1e-6: return None
    num = fft_corr(Rk, t)
    s1 = box_sum(Rk, H, W); s2 = box_sum(Rk * Rk, H, W)
    var = np.maximum(s2 - s1 * s1 / n, 1e-9)
    sc = num / (tn * np.sqrt(var))
    i = np.unravel_index(np.argmax(sc), sc.shape)
    return {"score": float(sc[i]), "x": int(i[1]), "y": int(i[0]), "w": W, "h": H}

def register(render, vtt, search_w=900):
    """Find the GM's map image on the rendered page: all four rotations, several starting
    placements each, refined by affine ECC. Returns the best fit."""
    import ecc
    R = Image.open(render); s = min(1.0, search_w / R.size[0])
    Rs = R.resize((int(R.size[0] * s), int(R.size[1] * s)), Image.LANCZOS); Rk = ink(Rs)
    V0 = Image.open(vtt).convert("RGB")
    if max(V0.size) > 2400: V0.thumbnail((2400, 2400), Image.LANCZOS)
    best = None
    for k in range(4):
        V = V0.rotate(90 * k, expand=True)
        inits = []
        coarse = None
        for W in range(int(Rs.size[0] * 0.45), Rs.size[0] + 1, 6):
            r = score_at(Rk, V, W)
            if r and (coarse is None or r["score"] > coarse["score"]): coarse = r
        if coarse: inits.append(coarse)
        # the map filling the page (the book often prints it that way)
        for fill in (0.97, 0.80):
            W = int(Rs.size[0] * fill); H = int(round(W * V.size[1] / V.size[0]))
            if H > Rs.size[1]: H = int(Rs.size[1] * fill); W = int(round(H * V.size[0] / V.size[1]))
            inits.append({"x": (Rs.size[0] - W) // 2, "y": (Rs.size[1] - H) // 2, "w": W, "h": H})
        for g in inits:
            try:
                warp, cc = ecc.refine_img(Rs, V, g)
            except Exception:
                continue
            if cc is not None and (best is None or cc > best["cc"]):
                best = {"cc": float(cc), "k": k, "warp": warp, "g": g}
    best["scale"] = s
    return best, V0.size

def words(html):
    return [(float(a), float(b), float(c), float(d), w) for a, b, c, d, w in
            re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', html)]

def unrot(u, v, k):
    # point (u,v) as a fraction of the VTT rotated ccw by k*90 -> fraction of the original
    return [(u, v), (1 - v, u), (1 - u, 1 - v), (v, 1 - u)][k]

def derive(cfg, outdir, dpi=110):
    tmp = tempfile.mkdtemp()
    pdf, page = cfg["pdf"], str(cfg["page"])
    subprocess.run(["pdftoppm", "-r", str(dpi), "-f", page, "-l", page, "-png", pdf, f"{tmp}/p"], check=True)
    png = [f for f in os.listdir(tmp) if f.endswith(".png")][0]
    subprocess.run(["pdftotext", "-bbox", "-f", page, "-l", page, pdf, f"{tmp}/p.html"], check=True)
    best, vsize = register(f"{tmp}/{png}", cfg["vtt"])
    k, s_, g, M = best["k"], best["scale"], best["g"], np.vstack([best["warp"], [0, 0, 1]])
    kf = dpi / 72.0 * s_
    ws = words(open(f"{tmp}/p.html").read())
    pts = {}
    for i, (x0, y0, x1, y1, w) in enumerate(ws):
        if not re.fullmatch(r"\d{1,2}", w): continue
        n = int(w)
        if n < cfg["lo"] or n > cfg["hi"]: continue
        if i and ws[i - 1][4].lower().startswith("area"): continue   # "To Area 8"
        cx, cy = (x0 + x1) / 2 * kf, (y0 + y1) / 2 * kf
        px, py, _ = M @ np.array([cx, cy, 1.0])
        u, v = (px - g["x"]) / g["w"], (py - g["y"]) / g["h"]
        if not (-0.02 <= u <= 1.02 and -0.02 <= v <= 1.02): continue
        pts.setdefault(n, []).append(unrot(min(max(u, 0), 1), min(max(v, 0), 1), k))
    final = {n: v[0] for n, v in pts.items()}
    dups = sorted(n for n, v in pts.items() if len(v) > 1)
    missing = [n for n in range(cfg["lo"], cfg["hi"] + 1) if n not in final]
    # overlay
    im = Image.open(cfg["vtt"]); im.draft("RGB", (2000, 2000)); im = im.convert("RGB"); W, H = im.size
    d = ImageDraw.Draw(im); r = int(max(W, H) / 70)
    for n, (u, v) in final.items():
        X, Y = u * W, v * H
        d.ellipse([X - r, Y - r, X + r, Y + r], outline=(255, 0, 0), width=max(3, r // 5)); d.text((X + r, Y - r), str(n), fill=(255, 0, 0))
    im.thumbnail((1500, 1500)); im.save(f"{outdir}/{cfg['id']}.png")
    out = {"id": cfg["id"], "score": round(best["cc"], 3), "rot": k, "found": len(final), "expected": cfg["hi"] - cfg["lo"] + 1,
           "missing": missing, "dups": dups, "aspect": round(vsize[0] / vsize[1], 4), "pins": {str(n): [round(u, 4), round(v, 4)] for n, (u, v) in sorted(final.items())}}
    json.dump(out, open(f"{outdir}/{cfg['id']}.json", "w"))
    return out

if __name__ == "__main__":
    cfgs = json.load(open(sys.argv[1])); outdir = sys.argv[2]; os.makedirs(outdir, exist_ok=True)
    only = set(sys.argv[3:])
    for c in cfgs:
        if only and c["id"] not in only: continue
        try:
            o = derive(c, outdir)
            print(f"{o['id']}: score={o['score']} rot={o['rot']} found={o['found']}/{o['expected']} missing={o['missing']} dups={o['dups']}", flush=True)
        except Exception as e:
            print(f"{c['id']}: FAILED {e}", flush=True)
