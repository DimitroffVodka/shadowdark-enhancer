import sys, json, os
import numpy as np, cv2
def candidates(path, d_frac):
    img = cv2.imread(path); gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); H, W = gray.shape; d = d_frac * W
    _, dark = cv2.threshold(gray, 90, 255, cv2.THRESH_BINARY_INV)
    filled = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(d * 0.35) | 1,) * 2))
    k = int(d * 0.72) | 1
    opened = cv2.morphologyEx(filled, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(opened, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if not (0.6 * d <= w <= 1.4 * d and 0.6 * d <= h <= 1.4 * d): continue
        if abs(w - h) > 0.25 * max(w, h): continue
        out.append({"cx": float(cent[i][0]), "cy": float(cent[i][1]), "r": min(w, h) / 2.0})
    out.sort(key=lambda c: (round(c["cy"] / (0.8 * d)), c["cx"]))
    return img, out
def sheet(img, cs, outpng, cols=8, cell=150):
    rows = (len(cs) + cols - 1) // cols
    S = np.full((rows * (cell + 24), cols * cell, 3), 255, np.uint8)
    for i, c in enumerate(cs):
        r = int(c["r"] * 1.35); x0, y0 = int(c["cx"]) - r, int(c["cy"]) - r
        crop = img[max(y0, 0):y0 + 2 * r, max(x0, 0):x0 + 2 * r]
        if crop.size == 0: continue
        crop = cv2.resize(crop, (cell, cell)); rr, cc = divmod(i, cols)
        S[rr * (cell + 24) + 24:(rr + 1) * (cell + 24), cc * cell:(cc + 1) * cell] = crop
        cv2.putText(S, str(i), (cc * cell + 4, rr * (cell + 24) + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    cv2.imwrite(outpng, S)
if __name__ == "__main__":
    cfgs = json.load(open(sys.argv[1])); os.makedirs(sys.argv[2], exist_ok=True)
    allc = {}
    for c in cfgs:
        img, cs = candidates(c["vtt"], c["d"]); allc[c["id"]] = {"W": img.shape[1], "H": img.shape[0], "cands": cs}
        sheet(img, cs, f"{sys.argv[2]}/{c['id']}-sheet.png"); print(c["id"], len(cs), "candidates")
    json.dump(allc, open(f"{sys.argv[2]}/cands.json", "w"))
