/**
 * Shadowdark Enhancer — hex map from an image (Foundry-bound).
 *
 * One button for the GM: pick the map image, and the module finds the hex
 * lattice on its own (lattice.mjs), shows the result over a thumbnail to
 * confirm, uploads the image into the world's folder, creates a scene whose
 * hex grid sits exactly on the print, and opens the Hex Tagger with the
 * anchor and the map size already set. Replaces the hand alignment, anchor
 * and map-size steps of the tagger; the tagger itself stays for hand-drawn
 * maps the detector cannot read.
 *
 * Scene geometry: Foundry's flat-top grid of size s has cell height s and
 * column pitch 0.75 · s · 2/√3. The print's pitches rarely match that ratio
 * (the Western Reaches hexes are 5.7% taller than regular), so the scene is
 * sized so that the image, stretched to fill it, has Foundry's pitches, and
 * the background anchor slides the print so its first cell centre lands on
 * Foundry's cell (0, 0), which a column grid centres on the scene's top edge.
 * Foundry 14 keeps the image and its anchor on the scene's first level
 * (`levels[0].background.src`, `levels[0].textures.anchorX`); the old
 * `background` block is only a read shim there and is ignored on create, so
 * the data is emitted in whichever form the running schema has.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { imageInk } from "./ink.mjs";
import { detectLattice, latticeCentre, latticeFromCorners, cornerSupport } from "./lattice.mjs";
import { foundryOffsetToCube, framesTopRow, withAnchorNumber, extrasNumbersAlike } from "./geometry.mjs";
import { emptyState, encodeTags } from "./tag-store.mjs";
import { A0_PRINT, isA0 } from "./a0-print.mjs";
import { hexPrint, printBySize, knownAnswer } from "./hex-prints.mjs";
import { L as t } from "../shared/i18n.mjs";

const TAGS_FLAG = "hexTags";
/** On a scene this flow made: which of the book's hex maps it is, so setting it up again finds it instead of making a second. */
export const HEXMAP_FLAG = "hexMapId";
/** Working width for detection: enough for sub-pixel pitches, small enough for a tab. */
const WORK_WIDTH = 5000;

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));


/** The file picker dialog. @returns {Promise<{file:File, name:string}|null>} */
async function pickFile() {
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.hexMap.flow.pickTitle") },
    content: `<p>${t("SDE.hexMap.flow.pickHint")}</p>
      <div class="form-group"><label>${t("SDE.hexMap.flow.mapImage")}</label><input type="file" name="hex-map-image" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"></div>
      <div class="form-group"><label>${t("SDE.hexMap.flow.sceneName")}</label><input type="text" name="hex-map-name" placeholder="${t("SDE.hexMap.flow.sceneNamePlaceholder")}"></div>`,
    buttons: [
      { action: "read", label: t("SDE.hexMap.btn.read"), default: true, callback: (ev, button, dialog) => {
        const root = dialog.element ?? dialog;
        return { file: root.querySelector?.("input[name='hex-map-image']")?.files?.[0] ?? null, name: root.querySelector?.("input[name='hex-map-name']")?.value.trim() ?? "" };
      } },
      { action: "cancel", label: t("SDE.hexMap.btn.cancel") },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (!picked || picked === "cancel" || !picked.file) return null;
  return { file: picked.file, name: picked.name || picked.file.name.replace(/\.[^.]+$/, "") };
}

/**
 * Confirm the detected lattice: a resizable window with the print on the
 * left (click it for the full image in a new tab) and, on the right, the four
 * corners at print resolution with the detected hex outlined, then the counts,
 * the lowered parity and the first cell's printed number to confirm or correct.
 * When the detector got the grid wrong, or found none, "Set the corners by
 * hand" swaps it for a lattice hung on two clicks: the top-left and the
 * bottom-right hex, placed on the print and then nudged in their pictures.
 * @returns {Promise<{lat:object, cols:number, rows:number, rowsLowered?:number, lowered:"odd"|"even", firstNum:string}|null>}
 *   `lat` is the lattice shown when Create scene was pressed: the detector's, or the hand-set one
 */
export async function confirmLattice({ preview, full, file, lat: detected, imageW, corners: support = [], firstNum: knownNum = "0000" }) {
  const pw = preview.width, ph = preview.height, k = pw / imageW, imageH = ph / k;
  const labels = ["SDE.hexMap.corner.topLeft", "SDE.hexMap.corner.topRight",
    "SDE.hexMap.corner.bottomLeft", "SDE.hexMap.corner.bottomRight"].map((k) => t(k));
  const found = labels.map((_, i) => support[i]?.ok ?? true);
  const missed = labels.filter((_, i) => !found[i]);
  const verdict = missed.length
    ? `<p class="sde-hexmap-warn"><i class="fas fa-triangle-exclamation"></i> ${t(missed.length > 1 ? "SDE.hexMap.flow.cornersMissedMany" : "SDE.hexMap.flow.cornersMissedOne", { corners: esc(missed.join(" and ")) })}</p>`
    : `<p><i class="fas fa-circle-check"></i> ${t("SDE.hexMap.flow.cornersOk")}</p>`;
  let lat = detected;       // the lattice on show: the detector's until the corners are set by hand
  let hand = null;          // the two hexes the GM set by hand ([tl, br]); the lattice is fitted to them and the boxes
  let unfit = false;        // ...and the last fit failed, so `lat` is only the previous one, kept as a picture
  let pick = null, tap = null, root = null;   // pick: "tl" | "br" while the GM clicks the print; tap: the top-left click, waiting for the second
  const content = `
    <div class="sde-hexmap-confirm">
      <div class="sde-hexmap-overview" id="sde-hexmap-preview" title="${t('SDE.hexMap.flow.openPrint')}"></div>
      <div class="sde-hexmap-side">
        <p>${t("SDE.hexMap.flow.checkCrops")}</p>
        <div id="sde-hexmap-info" style="display: contents"></div>
        <button type="button" id="sde-hexmap-hand"><i class="fas fa-crosshairs"></i> ${t("SDE.hexMap.flow.handButton")}</button>
        <p class="hint">${t("SDE.hexMap.flow.marks")}</p>
        <div class="sde-hexmap-corners" id="sde-hexmap-corners"></div>
        <div class="form-group"><label>${t("SDE.hexMap.flow.colsRows")}</label><div class="form-fields">
          <input type="number" name="cols" value="${detected?.cols ?? ""}" min="1" max="99"> ×
          <input type="number" name="rows" value="${detected?.rows ?? ""}" min="1" max="99"></div></div>
        <div class="form-group"><label>${t("SDE.hexMap.flow.whichLower")}</label><select name="lowered"><option value="odd" ${detected?.lowered !== "even" ? "selected" : ""}>${t("SDE.hexMap.label.loweredOdd")}</option><option value="even" ${detected?.lowered === "even" ? "selected" : ""}>${t("SDE.hexMap.label.loweredEven")}</option></select></div>
        <div class="form-group"><label>${t("SDE.hexMap.flow.lowShort")}</label><input type="checkbox" name="short" ${detected?.rowsLowered < detected?.rows ? "checked" : ""}></div>
        <div class="form-group"><label>${t("SDE.hexMap.flow.firstNum")}</label><input type="text" name="firstNum" value="${esc(knownNum)}" maxlength="4"><p class="hint">${t("SDE.hexMap.flow.firstNumHint")}</p></div>
      </div>
    </div>`;
  /** Rows in a column: the lowered parity may end one short. */
  const rowsIn = (col) => ((col % 2 === 1) === (lat.lowered === "odd") ? (lat.rowsLowered || lat.rows) : lat.rows);
  const hexPath = (ctx, x, y, r, h) => { ctx.beginPath(); for (const [dx, dy] of [[r, 0], [r / 2, h], [-r / 2, h], [-r, 0], [-r / 2, -h], [r / 2, -h]]) ctx.lineTo(x + dx, y + dy); ctx.closePath(); };
  const field = (name) => root.querySelector(`[name='${name}']`);
  /** The two hexes a hand-set lattice hangs on: the GM's clicks, or where the shown lattice has them. */
  const anchors = () => hand ?? [latticeCentre(lat, 0, 0), latticeCentre(lat, lat.cols - 1, rowsIn(lat.cols - 1) - 1)];
  /** The lattice for two centres and the counts as the boxes read now, or null when they span none. */
  const fit = ([tl, br]) => {
    const cols = parseInt(field("cols").value, 10), rows = parseInt(field("rows").value, 10);
    return latticeFromCorners({ tl, br, cols, rows, rowsLowered: Math.max(1, rows - (field("short").checked ? 1 : 0)), lowered: field("lowered").value === "even" ? "even" : "odd" });
  };
  /**
   * Hang a lattice on the top-left and bottom-right centres. When the counts do not fit them the last lattice
   * stays on the picture, but `unfit` holds Create off until the boxes and the corners make a grid again.
   */
  const place = (pair) => {
    hand = pair;
    const fitted = fit(pair);
    if (fitted) lat = fitted;
    unfit = !fitted;
    render();
  };
  const info = () => {
    const status = pick ? `<p><i class="fas fa-crosshairs"></i> ${t(pick === "tl" ? "SDE.hexMap.flow.handTopLeft" : "SDE.hexMap.flow.handBottomRight")}</p>`
      : unfit ? `<p class="sde-hexmap-warn"><i class="fas fa-triangle-exclamation"></i> ${t("SDE.hexMap.flow.handNoFit")}</p>`
      : hand ? `<p><i class="fas fa-circle-check"></i> ${t("SDE.hexMap.flow.handDone")}</p>`
      : !lat ? `<p class="sde-hexmap-warn"><i class="fas fa-triangle-exclamation"></i> ${t("SDE.hexMap.flow.noGrid")}</p>`
      : verdict;
    if (!lat || unfit) return status;
    const short = lat.rowsLowered && lat.rowsLowered !== lat.rows;
    return `<p>${t("SDE.hexMap.flow.found", { cols: lat.cols, rows: lat.rows, px: Math.round(lat.pitchX / 0.75), py: Math.round(lat.pitchY), lowered: esc(lat.lowered) })}${short ? t("SDE.hexMap.flow.foundShort", { rows: lat.rowsLowered }) : ""}.</p>`
      + (!hand ? `<p class="hint">${t("SDE.hexMap.flow.measured")}</p>` : "") + status;
  };
  // DialogV2 sanitises its content and drops <canvas>, so the pictures are made here.
  const render = () => {
    root.querySelector("#sde-hexmap-info").innerHTML = info();
    const create = root.querySelector("[data-action='create']"); if (create) create.disabled = !lat || unfit;
    const c = document.createElement("canvas");
    c.width = pw; c.height = ph;
    root.querySelector("#sde-hexmap-preview").replaceChildren(c);
    const ctx = c.getContext("2d");
    ctx.drawImage(preview, 0, 0);
    c.style.cursor = pick ? "crosshair" : "";
    c.addEventListener("click", (ev) => {
      if (!pick) { if (file) window.open(URL.createObjectURL(file), "_blank"); return; }
      const r = c.getBoundingClientRect();
      const at = { u: (ev.clientX - r.left) / r.width * imageW, v: (ev.clientY - r.top) / r.height * imageH };
      if (pick === "tl") { tap = at; pick = "br"; render(); return; }
      const tl = tap; pick = tap = null; place([tl, at]);
    });
    if (tap) { ctx.fillStyle = "rgba(230, 120, 20, 0.95)"; ctx.beginPath(); ctx.arc(tap.u * k, tap.v * k, Math.max(3, pw / 250), 0, Math.PI * 2); ctx.fill(); }
    const grid = root.querySelector("#sde-hexmap-corners"); grid.replaceChildren();
    if (!lat) return;
    const R = lat.pitchX / 1.5, ry = lat.pitchY / 2, last = lat.cols - 1;
    // Same blue as the outlined corners, because these mean the same thing:
    // here is a hex the detector found. They were red, and a red mark on a map
    // reads as a fault — Patrick took them for hexes the module had got wrong.
    ctx.fillStyle = "rgba(30, 90, 220, 0.85)";
    const step = Math.max(1, Math.round(Math.max(lat.cols, lat.rows) / 40));
    for (let col = 0; col < lat.cols; col += step) for (let row = 0; row < rowsIn(col); row += step) {
      const p = latticeCentre(lat, col, row);
      ctx.beginPath(); ctx.arc(p.u * k, p.v * k, Math.max(1.5, pw / 400), 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(30, 90, 220, 0.9)"; ctx.lineWidth = Math.max(1.5, pw / 500);
    const byHand = !!hand, [tl, br] = anchors();
    const corners = [[0, 0], [last, 0], [0, rowsIn(0) - 1], [last, rowsIn(last) - 1]].map(([c, r], i) => [c, r, byHand ? labels[i] : `${labels[i]} ${found[i] ? "✓" : "✗"}`]);
    for (const [col, row] of corners) { const p = latticeCentre(lat, col, row); hexPath(ctx, p.u * k, p.v * k, R * k, ry * k); ctx.stroke(); }
    // The corners at print resolution: 2.6 cells across, the corner cell outlined, neighbours dotted.
    if (!full) return;
    const side = 2.6 * Math.max(lat.pitchX / 0.75, lat.pitchY), px = 180, kk = px / side;
    corners.forEach(([col, row, label], i) => {
      const p = latticeCentre(lat, col, row), x0 = p.u - side / 2, y0 = p.v - side / 2;
      const cc = document.createElement("canvas"); cc.width = cc.height = px;
      const cx = cc.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, px, px);
      cx.drawImage(full, x0, y0, side, side, 0, 0, px, px);
      cx.fillStyle = "rgba(30, 90, 220, 0.85)";
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        const nc = col + dc, nr = row + dr;
        if ((dc || dr) && nc >= 0 && nc < lat.cols && nr >= 0 && nr < rowsIn(nc)) { const q = latticeCentre(lat, nc, nr); cx.beginPath(); cx.arc((q.u - x0) * kk, (q.v - y0) * kk, 3, 0, Math.PI * 2); cx.fill(); }
      }
      cx.strokeStyle = "rgba(30, 90, 220, 0.9)"; cx.lineWidth = 2;
      hexPath(cx, (p.u - x0) * kk, (p.v - y0) * kk, R * kk, ry * kk); cx.stroke();
      // The top-left and bottom-right pictures are the two hexes a hand-set lattice hangs on: a click moves that hex's centre.
      if (byHand && (i === 0 || i === 3)) {
        cc.style.cursor = "crosshair";
        cc.addEventListener("click", (ev) => {
          const r = cc.getBoundingClientRect();
          const at = { u: x0 + (ev.clientX - r.left) / r.width * side, v: y0 + (ev.clientY - r.top) / r.height * side };
          place(i === 0 ? [at, br] : [tl, at]);
        });
      }
      const wrap = document.createElement("figure");
      wrap.append(cc); const cap = document.createElement("figcaption"); cap.textContent = label; wrap.append(cap);
      grid.append(wrap);
    });
  };
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: t("SDE.hexMap.flow.gridFound"), resizable: true },
    classes: ["sde-hexmap-dialog"],
    position: { width: Math.min(1100, (globalThis.innerWidth ?? 1200) - 80), height: Math.min(820, (globalThis.innerHeight ?? 900) - 60) },
    content,
    render: (ev, dialog) => {
      root = dialog.element ?? dialog;
      root.querySelector("#sde-hexmap-hand").addEventListener("click", () => { pick = "tl"; tap = null; render(); });
      // Once the corners are set, the counts and the parity say how many pitches lie between them: changing one re-fits the grid.
      for (const name of ["cols", "rows", "lowered", "short"]) field(name).addEventListener("change", () => { if (hand) place(hand); });
      render();
    },
    buttons: [
      { action: "create", label: t("SDE.hexMap.btn.createScene"), default: true, callback: (ev, button, dialog) => {
        const root = dialog.element ?? dialog, q = (n) => root.querySelector?.(`[name='${n}']`)?.value;
        // A hand-set lattice is fitted to the boxes as they read now, not as they read when last fitted: one answer, coherent.
        return { lat: hand ? fit(hand) : lat, cols: parseInt(q("cols"), 10), rows: parseInt(q("rows"), 10), short: !!root.querySelector?.("[name='short']")?.checked, lowered: q("lowered") === "even" ? "even" : "odd", firstNum: String(q("firstNum") ?? "0000").trim() || "0000" };
      } },
      { action: "cancel", label: t("SDE.hexMap.btn.cancel") },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (!answer || answer === "cancel") return null;
  if (!(answer.lat && answer.cols > 0 && answer.rows > 0) || !/^\d{3,4}$/.test(answer.firstNum)) { ui.notifications?.warn(t("SDE.hexMap.notify.badCounts")); return null; }
  // A corrected row count moves the lowered columns' end with it.
  if (answer.short) answer.rowsLowered = Math.max(1, answer.rows - 1);
  return answer;
}

/** Copy the file into the world's hex-maps folder. @returns {Promise<string>} the path */
async function uploadMap(file) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/hex-maps`;
  try { await FP.createDirectory("data", dir); } catch (_err) { /* exists */ }
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if (!res?.path) throw new Error(t("SDE.hexMap.error.uploadFailed"));
  return res.path;
}

/** Whether this Foundry keeps scene backgrounds on levels (14+). */
const sceneHasLevels = () => !!globalThis.foundry?.documents?.BaseScene?.schema?.fields?.levels;

/**
 * Scene data for a print with the given lattice (image pixels): the grid's
 * pitches become Foundry's by stretching, the anchor lands cell (0, 0). Pure
 * apart from the constants, so it can be checked without a world.
 * @param {number} [opts.rowsLowered]  the lowered columns' row count when it differs from `rows`
 * @param {boolean} [opts.frameCut]  whether the frame cuts the raised columns' first row in half (the detector's answer):
 *   false numbers that row, true skips it, absent falls back to the guess from the row counts (framesTopRow)
 * @param {number} [opts.topRows]  whole rows of Foundry cells left above the print's first row (default 0). Foundry
 *   centres the unshifted columns' first row on the scene's top edge, so half of it falls outside the scene; one row
 *   above the print puts that whole row inside. The print's first cell then sits at Foundry row `topRows`.
 * @param {boolean} [opts.levels]  emit the 14+ `levels` form (default: what the running schema has)
 * @param {string} [opts.mapId]  which of the book's hex maps this is (hex-prints.mjs), kept on the scene so a second setup finds it
 */
export function alignedSceneData({ name, src, imageW, imageH, lat, firstNum = "0000", cols, rows, rowsLowered, frameCut, topRows = 0, levels = sceneHasLevels(), mapId = "" }) {
  const size = Math.max(CONST?.GRID_MIN_SIZE ?? 20, Math.round(lat.pitchY));
  const sizeX = size * 2 / Math.sqrt(3);
  const kx = (0.75 * sizeX) / lat.pitchX, ky = size / lat.pitchY;
  const even = lat.lowered === "even";
  const cube = foundryOffsetToCube({ i: topRows, j: 0 }, even);
  const state = emptyState();
  const bounds = { cols, rows };
  if (rowsLowered && rowsLowered !== rows) bounds.rowsLowered = rowsLowered;
  // The lowered columns ending exactly one row short means the frame clips the
  // field at both ends: their bottom half cell, and the RAISED columns' top one,
  // which is where a print like the Western Reaches writes its column labels.
  // That row is margin, so it is not numbered; the tagger's "top row is frame"
  // box undoes it for a print whose first row really is map. One row short is
  // also what a jagged print of full hexes looks like (The Gloaming), so when
  // the detector has looked at that first row (frameCut) it decides, in both
  // directions and whatever the row counts say: a cut first row is skipped even
  // when the lowered columns are as long as the raised ones.
  if (typeof frameCut === "boolean") bounds.firstRow = frameCut ? 1 : 0;
  else if (framesTopRow(bounds)) bounds.firstRow = 1;
  // The anchor is the print's first hex. It starts as 0000 with the detector's lowered columns, and
  // withAnchorNumber gives it the number the print really starts from (The Gloaming's is 0001):
  // the counts' base, and the lowered columns named by PRINTED column rather than the image's.
  state.origin = withAnchorNumber({ i: topRows, j: 0, q: cube.q, r: cube.r, num: "0000", shifted: lat.lowered, bounds }, firstNum);
  // Foundry's cell (0, 0) sits half a row down when its column is the lowered
  // one (HEXEVENQ lowers column 0), on the top edge when it is not; the print's
  // first cell has to land on its Foundry cell, whichever parity the print
  // lowers, `topRows` whole rows further down. (ox, oy) is where the stretched
  // image's top-left corner then falls in the scene.
  const imgW = imageW * kx, imgH = imageH * ky;
  const ox = sizeX / 2 - lat.x0 * kx, oy = (even ? size / 2 : 0) + topRows * size - lat.y0 * ky;
  // The scene is the image's size, or taller by the strip the shifted image leaves at the top, so
  // nothing of the image is cut at the bottom. The mesh is sized scene x scale and drawn at the
  // scene's centre with its anchor at (anchorX, anchorY) of its own size (PrimarySpriteMesh), so a
  // taller scene needs scaleY to give the image back its size, and the anchor follows.
  const width = Math.round(imgW), height = Math.round(imgH + Math.max(0, oy));
  const scaleY = height === Math.round(imgH) ? 1 : imgH / height;
  const textures = { fit: "fill", scaleX: 1, scaleY, anchorX: 0.5 - ox / width, anchorY: (height / 2 - oy) / (height * scaleY) };
  const data = {
    name,
    width, height, padding: 0,
    grid: { type: even ? CONST.GRID_TYPES.HEXEVENQ : CONST.GRID_TYPES.HEXODDQ, size, distance: 6, units: "mi" },
    flags: { [MODULE_ID]: { [TAGS_FLAG]: encodeTags(state), ...(mapId ? { [HEXMAP_FLAG]: mapId } : {}) } },
  };
  if (levels) data.levels = [{ name: "Map", background: { src }, textures }];   // a Level needs a name
  else data.background = { src, ...textures };
  return data;
}

/**
 * How many rows of Foundry cells the scene keeps above a confirmed print's first row.
 *
 * One row above a print whose first row is full hexes puts the raised columns' first row whole
 * inside the scene instead of half of it outside (alignedSceneData `topRows`). But that moves the
 * print's first hex off Foundry's cell (0, 0), and Shadowdark Extras numbers a scene from exactly
 * there (adoptHexcrawl: printed (col, row) is Foundry offset {i: row - base, j: col - base}, with no
 * way to say "one row down"), so Send to Extras would refuse the print (extrasNumbersAlike), or worse
 * put every record a row off. So a print Extras can adopt as it stands keeps its first hex at
 * (0, 0), as it always had; the row is added only to a print Extras could not take anyway (an
 * even-lowered one, which needs a HEXEVENQ grid, or one whose first hex is not 0000 / 0101).
 * ponytail: a print Extras can adopt keeps its top raised row half outside the scene until Extras
 * can adopt a scene with a row offset; then this returns 1 whenever the frame does not cut the row.
 * @param {{lat:{lowered:"odd"|"even"}, firstNum?:string, frameCut?:boolean}} args  the lowered parity as confirmed
 * @returns {0|1}
 */
export function topRowsFor({ lat, firstNum = "0000", frameCut = false }) {
  if (frameCut) return 0;   // the half cell is margin; the first hex is the scene's top-left cell
  if (lat.lowered === "odd") {
    const first = withAnchorNumber({ cube: foundryOffsetToCube({ i: 0, j: 0 }, false), num: "0000", shifted: "odd" }, firstNum);
    if (first && [0, 1].some((base) => extrasNumbersAlike(first, base))) return 0;
  }
  return 1;
}

/**
 * The scene for a confirmed lattice: what the flow creates, in one place so it can be checked without a world.
 * A hand-set lattice says nothing about the frame: its first row is map (no `frameCut`).
 * @param {{name:string, src:string, imageW:number, imageH:number, answer:object, mapId?:string}} args  answer: from confirmLattice
 */
export function sceneDataFromAnswer({ name, src, imageW, imageH, answer, mapId = "" }) {
  const frameCut = answer.lat.frameCut ?? false;
  const lat = { ...answer.lat, lowered: answer.lowered };
  const { firstNum } = answer;
  return alignedSceneData({ name, src, imageW, imageH, lat, firstNum, cols: answer.cols, rows: answer.rows, rowsLowered: answer.rowsLowered, frameCut, topRows: topRowsFor({ lat, firstNum, frameCut }), mapId });
}

/**
 * The Western Reaches A0: its lattice is known (a0-print.mjs), so there is
 * nothing to detect or confirm. The scene is made to fit the print, then Make
 * this map playable does the rest.
 * @param {{mapId?:string, quiet?:boolean}} [opts]  quiet: no checklist or Legend window; the answer says whether the Legend is still to do
 * @returns {Promise<{status:"ready", scene:Scene, legend:boolean, pinned:number}>}
 */
async function a0Scene(file, name, { mapId = "", quiet = false } = {}) {
  const src = await uploadMap(file);
  const { width, height, lat, firstNum, bounds } = A0_PRINT;
  const data = alignedSceneData({ name, src, imageW: width, imageH: height, lat, firstNum, cols: bounds.cols, rows: bounds.rows, rowsLowered: bounds.rowsLowered, mapId });
  const scene = await Scene.create(data);
  if (!quiet) ui.notifications?.info(t("SDE.hexMap.notify.sceneCreated", { name: scene.name, cols: bounds.cols, rows: bounds.rows, size: data.grid.size }));
  await scene.view();
  const made = await (await import("./hex-tagger-app.mjs")).HexTaggerApp.makePlayable({ quiet });
  return { status: "ready", scene, legend: made?.legend ?? true, pinned: scene.notes.size };
}

/**
 * One image from a print that ships as two files (hex-prints.mjs `join`): the second is laid `dy` pixels below the first,
 * where the two lattices are one. The halves' margins overlap there and are white, so multiplying the two together keeps
 * every pixel of both. Null when a file is not the size the print says (another edition).
 * @param {File[]} files  [first, second], in the print's order
 * @returns {Promise<File|null>}
 */
export async function joinHalves(files, { width, height, dy }) {
  if (files.length !== 2) return null;
  const [a, b] = await Promise.all(files.map((f) => createImageBitmap(f)));
  try {
    if ([a, b].some((m) => m.width !== width || m.height !== height)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = dy + height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(a, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(b, 0, dy);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    return blob ? new File([blob], "joined-hex-map.jpg", { type: "image/jpeg" }) : null;
  } finally { a.close?.(); b.close?.(); }
}

/**
 * Pin a book's keyed hexes on the scene being viewed: every crawl filed from that book's key locations
 * (importKeyLocations), which this map's numbering has to match. Nothing is pinned when none are filed yet.
 * @returns {Promise<number>} how many pins the scene now has
 */
async function pinBookKey(mapId) {
  const print = hexPrint(mapId);
  if (!print) return 0;
  const [{ crawlEntries }, { pinCrawlOnActiveScene }, { sourceFolderName }, { HEX_FLAG }] = await Promise.all([
    import("./hex-region.mjs"), import("./hex-pins.mjs"), import("../shared/compendium-suite.mjs"), import("../importer/hex/hex-commit.mjs"),
  ]);
  for (const entry of await crawlEntries()) {
    if (sourceFolderName(entry.getFlag(MODULE_ID, HEX_FLAG)?.source) === print.folder) await pinCrawlOnActiveScene(entry);
  }
  return canvas.scene?.notes.size ?? 0;
}

/**
 * Make the scene for a hex map image the GM already has, GM only.
 *
 * `auto` is the wizard's way in: nothing is asked. A print whose grid the finder is sure of (all four corners sit on a
 * printed hex) becomes a scene at once; a print it is unsure of is NOT sent to the confirm window mid-run, the answer is
 * `needsLook` and the GM opens the full flow (auto off) when they choose. Either way the scene is flagged with `mapId`,
 * so a second run finds it and leaves it alone, and the book's keyed hexes are pinned on it.
 * A print the module has measured (hex-prints.mjs `grid`) needs nothing asked in either mode: it is used as it is when the
 * image is that print's size, and a print that ships as two files is joined first.
 * @param {File|File[]} files  one image, or the two halves of a joined print in order
 * @param {{name?:string, mapId?:string, firstNum?:string, auto?:boolean}} [opts]  firstNum: the printed number of the first hex
 *   (hex-prints.mjs), used when nothing is asked
 * @returns {Promise<{status:"ready"|"already"|"needsLook"|"cancelled"|"failed", scene?:Scene, legend?:boolean, pinned?:number}>}
 */
export async function hexMapFromFile(files, { name, mapId = "", firstNum = "0000", auto = false } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.hexMap.notify.gmOnlySetup")); return { status: "failed" }; }
  const list = [files].flat().filter(Boolean);
  let file = list[0];
  if (!file) return { status: "failed" };
  name ||= file.name.replace(/\.[^.]+$/, "");
  const have = mapId && game.scenes.find((s) => s.getFlag(MODULE_ID, HEXMAP_FLAG) === mapId);
  if (have) return { status: "already", scene: have };
  const joined = hexPrint(mapId)?.join;
  if (joined) {
    file = await joinHalves(list, joined);
    if (!file) { ui.notifications?.error(t("SDE.hexMap.notify.halvesShape")); return { status: "failed" }; }
  }
  let full, working;
  try {
    full = await createImageBitmap(file);
  } catch (err) {
    ui.notifications?.error(t("SDE.hexMap.notify.notAnImage", { file: file.name, error: err.message })); return { status: "failed" };
  }
  const imageW = full.width, imageH = full.height;
  const scale = Math.min(1, WORK_WIDTH / imageW);
  if (!auto) ui.notifications?.info(t("SDE.hexMap.notify.readingImage", { file: file.name, w: imageW, h: imageH }));
  try {
    if (isA0(imageW, imageH)) return await a0Scene(file, name, { mapId, quiet: auto });
    // A print the module has measured is used as it is; one that is not the print's size is not trusted to it.
    if (!mapId) mapId = printBySize(imageW, imageH)?.id ?? "";
    const print = hexPrint(mapId);
    const sized = print?.grid && Math.abs(imageW - print.size[0]) <= 2 && Math.abs(imageH - print.size[1]) <= 2;
    if (sized) {
      const answer = knownAnswer(mapId);
      const src = await uploadMap(file);
      const scene = await Scene.create(sceneDataFromAnswer({ name, src, imageW, imageH, answer, mapId }));
      if (!auto) ui.notifications?.info(t("SDE.hexMap.notify.sceneCreated", { name: scene.name, cols: answer.cols, rows: answer.rows, size: scene.grid.size }));
      await scene.view();
      const pinned = await pinBookKey(mapId);
      if (!auto) (await import("./hex-tagger-app.mjs")).HexTaggerApp.open({ legend: true });
      return { status: "ready", scene, legend: true, pinned };
    }
    working = scale < 1 ? await createImageBitmap(full, { resizeWidth: Math.round(imageW * scale), resizeHeight: Math.round(imageH * scale), resizeQuality: "medium" }) : full;
    const { ink, w, h } = await imageInk(working, { scale: 1, onProgress: () => new Promise((r) => setTimeout(r, 0)) });
    const det = detectLattice(ink, w, h);
    // No grid found is not the end: the confirmation window lets the GM set the corners by hand.
    const s = w / imageW;
    const lat = det && { x0: det.x0 / s, y0: det.y0 / s, pitchX: det.pitchX / s, pitchY: det.pitchY / s, cols: det.cols, rows: det.rows, rowsLowered: det.rowsLowered, lowered: det.lowered, frameCut: det.frameCut };
    const support = det ? cornerSupport(ink, w, h, det) : [];
    let answer;
    if (auto) {
      if (!det || support.length !== 4 || !support.every((c) => c.ok)) return { status: "needsLook" };
      answer = { lat, cols: det.cols, rows: det.rows, lowered: det.lowered, firstNum, short: det.rowsLowered < det.rows };
      if (answer.short) answer.rowsLowered = Math.max(1, answer.rows - 1);
    } else {
      // The overview: up to 1200 px on the long side, scaled by CSS to the window; the corners are cut from the full image.
      const long = Math.min(1200, Math.max(imageW, imageH));
      const pw = Math.round(imageW >= imageH ? long : long * imageW / imageH);
      const preview = await createImageBitmap(working, { resizeWidth: pw, resizeHeight: Math.round(pw * imageH / imageW), resizeQuality: "medium" });
      answer = await confirmLattice({ preview, full, file, lat, imageW, corners: support, firstNum });
      preview.close?.();
      if (!answer) return { status: "cancelled" };
    }
    const src = await uploadMap(file);
    const data = sceneDataFromAnswer({ name, src, imageW, imageH, answer, mapId });
    const scene = await Scene.create(data);
    if (!auto) ui.notifications?.info(t("SDE.hexMap.notify.sceneCreated", { name: scene.name, cols: answer.cols, rows: answer.rows, size: data.grid.size }));
    await scene.view();
    const pinned = await pinBookKey(mapId);
    // Run by hand, the tagger opens on the Legend; run by the wizard, the Done page offers it once for every map.
    if (!auto) (await import("./hex-tagger-app.mjs")).HexTaggerApp.open({ legend: true });
    return { status: "ready", scene, legend: true, pinned };
  } catch (err) {
    console.error(`${MODULE_ID} | hex map from image`, err);
    ui.notifications?.error(t("SDE.hexMap.notify.setupFailed", { error: err.message }));
    return { status: "failed" };
  } finally {
    working?.close?.(); if (working !== full) full?.close?.();
  }
}

/** The whole flow with its own file window, GM only. @returns {Promise<Scene|null>} */
export async function startHexMapFlow() {
  if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.hexMap.notify.gmOnlySetup")); return null; }
  const picked = await pickFile();
  if (!picked) return null;
  const { scene } = await hexMapFromFile(picked.file, { name: picked.name });
  return scene ?? null;
}
