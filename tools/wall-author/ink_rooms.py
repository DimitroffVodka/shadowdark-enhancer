#!/usr/bin/env python3
"""
Walls and doors for a Cursed Scrolls map drawn as bold ink rooms (the Iron Fortress is the model): the white space between
the bold wall lines is the floor, door bars join rooms, and the floor's outline becomes the walls.

  python ink_rooms.py bars  map.json out/     numbers every solid black door bar on an overlay (bars.png) and in bars.json
  python ink_rooms.py build map.json out/     floor.png, overlay.png and entry.txt, the block to paste into ADVENTURE_WALLS

map.json (see maps/cs2-iron-fortress.json): image, site, pitch + origin (the drawn grid's lattice in pixels, so squares
are measured the way you read them off the map), erase (polygons in squares over river banks and bridges, which are not
walls), doors (the bar numbers from bars.json that are doors), lights (in squares), min_room_px.

Needs numpy and opencv (the auto-wall venv has both). Look at overlay.png and run the leak test (test/adventure-walls.test.mjs)
before shipping: the picture is the only judge of what is a door and what is a wall.
"""
import json, math, sys
import numpy as np, cv2

def load(cfg_path):
    cfg = json.load(open(cfg_path)); base = cfg_path.rsplit("/", 1)[0] if "/" in cfg_path else "."
    img = cfg["image"] if cfg["image"].startswith("/") else f"{base}/{cfg['image']}"
    g = cv2.imread(img, 0)
    if g is None: sys.exit(f"cannot read {img}")
    return cfg, g, (g < 120).astype(np.uint8)

K = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

def find_bars(ink):
    """Solid black bodies: an opening by a 17 px square keeps door bars and drops wall lines, grid lines and stipple."""
    n, _, st, _ = cv2.connectedComponentsWithStats(cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((17, 17), np.uint8)), 8)
    bars = [dict(x0=int(x), y0=int(y), x1=int(x + w - 1), y1=int(y + h - 1)) for x, y, w, h, a in st[1:] if a >= 250]
    bars.sort(key=lambda b: ((b["y0"] + b["y1"]) // 2, (b["x0"] + b["x1"]) // 2))
    for i, b in enumerate(bars): b["id"] = i
    return bars

def along_x(ink, b):
    """A door lies along its wall: the longer side, or for a near-square mark the way the wall line goes on past it."""
    w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
    if max(w, h) >= 1.5 * min(w, h): return w >= h
    cx, cy = (b["x0"] + b["x1"]) // 2, (b["y0"] + b["y1"]) // 2
    hx = ink[cy - 4:cy + 5, b["x0"] - 40:b["x0"] - 4].sum() + ink[cy - 4:cy + 5, b["x1"] + 5:b["x1"] + 41].sum()
    vy = ink[b["y0"] - 40:b["y0"] - 4, cx - 4:cx + 5].sum() + ink[b["y1"] + 5:b["y1"] + 41, cx - 4:cx + 5].sum()
    return hx >= vy

def cmd_bars(cfg, g, ink, out):
    bars = find_bars(ink); json.dump(bars, open(f"{out}/bars.json", "w"))
    c = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
    for b in bars:
        cv2.rectangle(c, (b["x0"] - 8, b["y0"] - 8), (b["x1"] + 8, b["y1"] + 8), (0, 0, 255), 4)
        cv2.putText(c, str(b["id"]), (b["x0"] - 4, b["y0"] - 14), cv2.FONT_HERSHEY_SIMPLEX, 1.7, (0, 0, 255), 4)
    H, W = g.shape; cv2.imwrite(f"{out}/bars.png", cv2.resize(c, (1800, round(1800 * H / W))))
    print(len(bars), "bars; look at bars.png and list the doors in map.json")

def simplify(pts, eps):
    r = cv2.approxPolyDP(np.array(pts, np.int32).reshape(-1, 1, 2), eps, True); return [tuple(map(float, q[0])) for q in r]

def square(l, pitch, ang=4.0):
    """Runs within 4 degrees of an axis, at least 0.3 square long, become exact horizontals and verticals."""
    n = len(l); kind = [None] * n
    for i in range(n):
        (ax, ay), (bx, by) = l[i], l[(i + 1) % n]
        if math.hypot(bx - ax, by - ay) < 0.3 * pitch: continue
        a = math.degrees(math.atan2(abs(by - ay), abs(bx - ax))); kind[i] = "H" if a <= ang else ("V" if a >= 90 - ang else None)
    for k, coord in (("H", 1), ("V", 0)):
        i = 0
        while i < n:
            if kind[i] == k:
                j, vs = i, [i, (i + 1) % n]
                while kind[(j + 1) % n] == k and (j + 1) % n != i: j = (j + 1) % n; vs.append((j + 1) % n)
                m = sum(l[v][coord] for v in set(vs)) / len(set(vs))
                for v in set(vs): p = list(l[v]); p[coord] = m; l[v] = tuple(p)
                i = j + 1
            else: i += 1
    return l

def cmd_build(cfg, g, ink, out):
    H, W = g.shape; P = cfg["pitch"]; ox, oy = cfg["origin"]
    px = lambda x, y: (ox + P * x, oy + P * y)
    bars = [b for b in find_bars(ink) if b["id"] in cfg["doors"]]
    bold = cv2.dilate(cv2.erode(ink, K(2)), K(2))
    n, lab, st, _ = cv2.connectedComponentsWithStats(bold, 8)
    walls = (lab == int(np.argmax(st[1:, 4])) + 1).astype(np.uint8)     # the wall network; icons, bridge edges and loose lines are islands and drop out
    for poly in cfg.get("erase", []): cv2.fillPoly(walls, [np.array([px(*p) for p in poly], np.int32)], 0)
    MC = 12                                                                # a door bar closes its doorway's hairline gaps in the wall mask
    seal = walls.copy()
    for b in bars: cv2.rectangle(seal, (b["x0"] - MC, b["y0"] - MC), (b["x1"] + MC, b["y1"] + MC), 1, -1)
    seal = cv2.dilate(seal, np.ones((3, 3), np.uint8))                    # and no diagonal cracks
    nf, fl, fs, _ = cv2.connectedComponentsWithStats(1 - seal, 8)
    rock = fl[10, 10]; floor = np.zeros_like(seal)
    for i in range(1, nf):
        if i != rock and fs[i, 4] >= cfg.get("min_room_px", 12000): floor[fl == i] = 1
    cells = []                                                             # a doorway is floor across the bar, so rooms join through it
    for b in bars:
        hx = along_x(ink, b); a, al = 14, 4
        c = (b["x0"] - al, b["y0"] - a, b["x1"] + al, b["y1"] + a) if hx else (b["x0"] - a, b["y0"] - al, b["x1"] + a, b["y1"] + al)
        floor[c[1]:c[3] + 1, c[0]:c[2] + 1] = 1; cells.append(c + (hx,))
    cv2.imwrite(f"{out}/floor.png", cv2.resize((1 - floor) * 255, (1600, round(1600 * H / W))))
    cs, h = cv2.findContours(floor, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    loops, solids = [], []
    for i, c in enumerate(cs):
        if len(c) < 8: continue
        area = cv2.contourArea(c); pts = [tuple(p[0]) for p in c]
        if h[0][i][3] == -1 and area >= cfg.get("min_room_px", 12000): loops.append(square(simplify(pts, 3.0), P))
        elif h[0][i][3] != -1 and area >= 30000: solids.append(square(simplify(pts, 3.0), P))   # a real hole in the floor; smaller ones are icons
    vedges = [(a[0], min(a[1], b[1]), max(a[1], b[1])) for l in loops for a, b in zip(l, l[1:] + l[:1]) if abs(a[0] - b[0]) < .5]
    hedges = [(a[1], min(a[0], b[0]), max(a[0], b[0])) for l in loops for a, b in zip(l, l[1:] + l[:1]) if abs(a[1] - b[1]) < .5]
    def snap(v, along, edges):   # a door's end lies exactly on the wall end beside its doorway, so no sub-pixel gap is left
        best = [e for e in edges if e[1] - 1 <= along <= e[2] + 1 and abs(e[0] - v) <= 10]
        return min(best, key=lambda e: abs(e[0] - v))[0] if best else v
    doors = []
    for x0, y0, x1, y1, hx in cells:
        if hx: cy = (y0 + y1) / 2; doors.append([snap(x0, cy, vedges), cy, snap(x1, cy, vedges), cy])
        else: cx = (x0 + x1) / 2; doors.append([cx, snap(y0, cx, hedges), cx, snap(y1, cx, hedges)])
    ov = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
    for l in loops + solids: cv2.polylines(ov, [np.array(l, np.int32)], True, (0, 0, 230), 3)
    for d in doors: cv2.line(ov, (int(d[0]), int(d[1])), (int(d[2]), int(d[3])), (0, 170, 0), 6)
    cv2.imwrite(f"{out}/overlay.png", cv2.resize(ov, (1800, round(1800 * H / W))))
    num = lambda v: ("%.4f" % v).rstrip("0").rstrip(".")
    def ring(r):
        pts = ["[%s, %s]" % (num(x / W), num(y / H)) for x, y in r]
        return "      [\n" + "\n".join("        " + ", ".join(pts[i:i + 6]) + "," for i in range(0, len(pts), 6)) + "\n      ],"
    L = [f'  "{cfg["site"]}": {{', f"    aspect: {num(W / H)},", "    loops: ["] + [ring(r) for r in loops] + ["    ],"] + (["    solids: ["] + [ring(r) for r in solids] + ["    ],"] if solids else ["    solids: [],"]) + ["    doors: ["]
    L += ["      [%s]," % ", ".join(num(v) for v in (d[0] / W, d[1] / H, d[2] / W, d[3] / H)) for d in doors] + ["    ],"]
    if cfg.get("lights"):
        L.append("    lights: [")
        for l in cfg["lights"]:
            x, y = px(*l["at"]); L.append('      { at: [%s, %s], bright: %d, dim: %d, color: "%s", label: "%s" },' % (num(x / W), num(y / H), l["bright"], l["dim"], l["color"], l["label"]))
        L.append("    ],")
    L.append("  },")
    open(f"{out}/entry.txt", "w").write("\n".join(L) + "\n")
    print(f"{len(loops)} loops, {len(solids)} solids, {len(doors)} doors; entry.txt is the block for adventure-walls.mjs")

if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("bars", "build"): sys.exit(__doc__)
    cfg, g, ink = load(sys.argv[2]); {"bars": cmd_bars, "build": cmd_build}[sys.argv[1]](cfg, g, ink, sys.argv[3])
