import cv2, numpy as np
from PIL import Image

def gray(im, sigma):
    a = np.asarray(im.convert("L"), dtype=np.float32) / 255.0
    return cv2.GaussianBlur(a, (0, 0), sigma)

def refine(render_png, V, guess, iters=200):
    """guess: {x,y,w,h} placement of PIL image V on the render (px). Returns (3x3 map render->V fraction, cc)."""
    R = Image.open(render_png).convert("L"); RW, RH = R.size
    canvas = Image.new("L", (RW, RH), 255)
    Vs = V.convert("L").resize((guess["w"], guess["h"]), Image.LANCZOS)
    canvas.paste(Vs, (guess["x"], guess["y"]))
    mask = Image.new("L", (RW, RH), 0); mask.paste(255, (guess["x"], guess["y"], guess["x"] + guess["w"], guess["y"] + guess["h"]))
    warp = np.eye(2, 3, dtype=np.float32); cc = None
    # coarse-to-fine: heavier blur first
    for sigma in (8, 4, 2):
        T = gray(R, sigma); I = gray(canvas, sigma)
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-6)
        try:
            cc, warp = cv2.findTransformECC(T, I, warp, cv2.MOTION_AFFINE, crit, np.asarray(mask), 5)
        except cv2.error:
            break
    return warp, cc


def refine_img(Rs, V, guess, iters=200):
    """Like refine, but takes the render as a PIL image. Returns (2x3 warp render->canvas, cc)."""
    RW, RH = Rs.size
    canvas = Image.new("L", (RW, RH), 255)
    Vs = V.convert("L").resize((guess["w"], guess["h"]), Image.LANCZOS)
    canvas.paste(Vs, (guess["x"], guess["y"]))
    mask = np.zeros((RH, RW), np.uint8); mask[max(guess["y"], 0):guess["y"] + guess["h"], max(guess["x"], 0):guess["x"] + guess["w"]] = 255
    warp = np.eye(2, 3, dtype=np.float32); cc = None
    for sigma in (8, 4, 2):
        T = gray(Rs, sigma); I = gray(canvas, sigma)
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-6)
        cc, warp = cv2.findTransformECC(T, I, warp, cv2.MOTION_AFFINE, crit, mask, 5)
    return warp, cc
