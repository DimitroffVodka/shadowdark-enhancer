/**
 * Shadowdark Enhancer — Town: the Western Reaches Player's Map, cut from the GM's own Player's Guide.
 *
 * The map is printed across pages 2 and 3 of the Player's Guide as two pictures (3597 x 2224 and 3597 x 2584) that
 * join top to bottom with no seam. Taken straight from the PDF they carry no title and no place names (those are
 * text set on top), so the joined picture is a clean background for the Western Reaches' landing pages. Book art
 * never ships in the module: this runs in the GM's browser, on the GM's own PDF, and saves the picture in their
 * world (the `landingPlayerMap` setting holds its path). The import makes it; the Landing pages window offers it
 * for a world imported before.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { PLAYER_MAP_SETTING } from "./landing-pages-core.mjs";

/** The Player's Guide's source key, and the PDF pages the map is printed on (top half, then bottom half). */
export const PLAYER_GUIDE = "WR";
export const MAP_PAGES = [2, 3];
const FILE = "western-reaches-player-map.webp";

/** pdf.js raw pixels (`kind` 1: 1 bit grey, 2: RGB, 3: RGBA) as RGBA, for ImageData. Pure. */
export function toRgba({ width, height, kind, data }) {
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === 3) { out.set(data.subarray(0, out.length)); return out; }
  if (kind === 2) {
    for (let p = 0, q = 0; q < out.length; p += 3, q += 4) { out[q] = data[p]; out[q + 1] = data[p + 1]; out[q + 2] = data[p + 2]; out[q + 3] = 255; }
    return out;
  }
  // 1 bit per pixel, each row padded to a whole byte; a set bit is white.
  const row = (width + 7) >> 3;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (data[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, q = (y * width + x) * 4;
    out[q] = out[q + 1] = out[q + 2] = v; out[q + 3] = 255;
  }
  return out;
}

/** Whether the GM's Player's Guide is linked (or given for this session), so the map can be made. */
export async function canMakePlayerMap() {
  const { resolveSourcePdf } = await import("../importer/source-pdf-registry.mjs");
  return !!resolveSourcePdf(PLAYER_GUIDE);
}

/**
 * Cut the map from the GM's Player's Guide, join its halves, save it in the world and remember it. Returns
 * `{ status: "made" | "already" | "noBook" | "failed", src? }`; `force` makes it again over an existing one.
 */
export async function makePlayerMap({ force = false } = {}) {
  if (!game.user?.isGM) return { status: "failed" };
  const have = game.settings.get(MODULE_ID, PLAYER_MAP_SETTING);
  if (have && !force) return { status: "already", src: have };
  const { resolveSourcePdf } = await import("../importer/source-pdf-registry.mjs");
  const path = resolveSourcePdf(PLAYER_GUIDE);
  if (!path) return { status: "noBook" };
  if (!game.user.can("FILES_UPLOAD")) { ui.notifications.warn(t("SDE.adventure.notify.uploadDenied")); return { status: "failed" }; }
  try {
    const { extractPageImages } = await import("../importer/pdf-text-extract.mjs");
    const halves = await extractPageImages(path, MAP_PAGES);
    if (halves.some((h) => !h?.width)) throw new Error("the Player's Guide's map pages hold no picture");
    const width = Math.max(...halves.map((h) => h.width)), height = halves.reduce((n, h) => n + h.height, 0);
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
    let y = 0;
    for (const h of halves) {
      if (h.bitmap) ctx.drawImage(h.bitmap, 0, y);
      else ctx.putImageData(new ImageData(toRgba(h), h.width, h.height), 0, y);
      y += h.height;
    }
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    const FP = foundry.applications.apps.FilePicker.implementation;
    const dir = `worlds/${game.world.id}/landing-pages`;
    try { await FP.createDirectory("data", dir); } catch (_err) { /* already there */ }
    const res = await FP.upload("data", dir, new File([blob], FILE, { type: "image/webp" }), {}, { notify: false });
    if (!res?.path) throw new Error("the server refused the upload");
    await game.settings.set(MODULE_ID, PLAYER_MAP_SETTING, res.path);
    return { status: "made", src: res.path };
  } catch (err) {
    console.error(`${MODULE_ID} | Player's Map`, err);
    return { status: "failed" };
  }
}
