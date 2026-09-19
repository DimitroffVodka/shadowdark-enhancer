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
import { detectLattice, latticeCentre, cornerSupport } from "./lattice.mjs";
import { foundryOffsetToCube } from "./geometry.mjs";
import { emptyState, encodeTags } from "./tag-store.mjs";

const TAGS_FLAG = "hexTags";
/** Working width for detection: enough for sub-pixel pitches, small enough for a tab. */
const WORK_WIDTH = 5000;

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** The file picker dialog. @returns {Promise<{file:File, name:string}|null>} */
async function pickFile() {
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: "Hex map from image" },
    content: `<p>Pick the map image. It is read in your browser; the hex grid is found on its own, and the image is then copied into this world's folder as the scene background.</p>
      <div class="form-group"><label>Map image</label><input type="file" name="hex-map-image" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"></div>
      <div class="form-group"><label>Scene name</label><input type="text" name="hex-map-name" placeholder="(the file's name)"></div>`,
    buttons: [
      { action: "read", label: "Read the map", default: true, callback: (ev, button, dialog) => {
        const root = dialog.element ?? dialog;
        return { file: root.querySelector?.("input[name='hex-map-image']")?.files?.[0] ?? null, name: root.querySelector?.("input[name='hex-map-name']")?.value.trim() ?? "" };
      } },
      { action: "cancel", label: "Cancel" },
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
 * @returns {Promise<{cols:number, rows:number, rowsLowered?:number, lowered:"odd"|"even", firstNum:string}|null>}
 */
async function confirmLattice({ preview, full, file, lat, imageW, corners: support = [] }) {
  const pw = preview.width, ph = preview.height, k = pw / imageW;
  const short = lat.rowsLowered && lat.rowsLowered !== lat.rows;
  const labels = ["top left", "top right", "bottom left", "bottom right"];
  const found = labels.map((_, i) => support[i]?.ok ?? true);
  const missed = labels.filter((_, i) => !found[i]);
  const verdict = missed.length
    ? `<p class="sde-hexmap-warn"><i class="fas fa-triangle-exclamation"></i> No printed hex outline where the grid puts its ${esc(missed.join(" and "))} corner${missed.length > 1 ? "s" : ""}. Compare the crops below; correct the counts if a row or column is off by one, or cancel and set the scene up by hand.</p>`
    : `<p><i class="fas fa-circle-check"></i> Checked: the grid lands on a printed hex at all four corners. Nothing to do here but <strong>Create scene</strong>; the crops below are the proof.</p>`;
  const content = `
    <div class="sde-hexmap-confirm">
      <div class="sde-hexmap-overview" id="sde-hexmap-preview" title="Open the print on its own, with no marks on it"></div>
      <div class="sde-hexmap-side">
        <p><strong>Check the four crops.</strong> The blue hex should sit on a printed one.</p>
        <p><strong>${lat.cols} × ${lat.rows}</strong> flat-top hexes, ${Math.round(lat.pitchX / 0.75)} × ${Math.round(lat.pitchY)} px, <strong>${esc(lat.lowered)}</strong> columns half a hex lower${short ? ` and one row shorter (${lat.rowsLowered})` : ""}.</p>
        <p class="hint">The three boxes below are all you can change. Where the grid sits and how big it is were measured off the print — if the blue is not on a hex at all, cancel rather than fiddle. Pointy-top maps are not supported.</p>
        ${verdict}
        <p class="hint">Every blue mark is a hex the detector found: an outline on the corner hexes, and a dot at the centre of every fortieth cell across the overview, which is why most hexes there carry no dot. Nothing on this screen marks a fault. Drag the window edge to enlarge; clicking the overview opens your print on its own, with no marks on it.</p>
        <div class="sde-hexmap-corners" id="sde-hexmap-corners"></div>
        <div class="form-group"><label>Columns × rows</label><div class="form-fields">
          <input type="number" name="cols" value="${lat.cols}" min="1" max="99"> ×
          <input type="number" name="rows" value="${lat.rows}" min="1" max="99"></div></div>
        <div class="form-group"><label>Which columns sit lower</label><select name="lowered"><option value="odd" ${lat.lowered === "odd" ? "selected" : ""}>odd (1, 3, 5…)</option><option value="even" ${lat.lowered === "even" ? "selected" : ""}>even (0, 2, 4…)</option></select></div>
        <div class="form-group"><label>Top-left hex is number</label><input type="text" name="firstNum" value="0000" maxlength="4"><p class="hint">The printed number of the top-left cell; every other cell is numbered from it.</p></div>
      </div>
    </div>`;
  const R = lat.pitchX / 1.5, ry = lat.pitchY / 2;
  /** Rows in a column: the lowered parity may end one short. */
  const rowsIn = (col) => ((col % 2 === 1) === (lat.lowered === "odd") ? (lat.rowsLowered || lat.rows) : lat.rows);
  const hexPath = (ctx, x, y, r, h) => { ctx.beginPath(); for (const [dx, dy] of [[r, 0], [r / 2, h], [-r / 2, h], [-r, 0], [-r / 2, -h], [r / 2, -h]]) ctx.lineTo(x + dx, y + dy); ctx.closePath(); };
  // DialogV2 sanitises its content and drops <canvas>, so the pictures are made here.
  const draw = (root) => {
    const slot = root.querySelector?.("#sde-hexmap-preview"); if (!slot) return;
    const c = document.createElement("canvas");
    c.width = pw; c.height = ph;
    slot.replaceChildren(c);
    const ctx = c.getContext("2d");
    ctx.drawImage(preview, 0, 0);
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
    const last = lat.cols - 1;
    const corners = [[0, 0], [last, 0], [0, rowsIn(0) - 1], [last, rowsIn(last) - 1]].map(([c, r], i) => [c, r, `${labels[i]} ${found[i] ? "✓" : "✗"}`]);
    for (const [col, row] of corners) { const p = latticeCentre(lat, col, row); hexPath(ctx, p.u * k, p.v * k, R * k, ry * k); ctx.stroke(); }
    if (file) c.addEventListener("click", () => window.open(URL.createObjectURL(file), "_blank"));
    // The corners at print resolution: 2.6 cells across, the corner cell outlined, neighbours dotted.
    const grid = root.querySelector("#sde-hexmap-corners"); if (!grid || !full) return;
    const side = 2.6 * Math.max(lat.pitchX / 0.75, lat.pitchY), px = 180, kk = px / side;
    for (const [col, row, label] of corners) {
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
      const wrap = document.createElement("figure");
      wrap.append(cc); const cap = document.createElement("figcaption"); cap.textContent = label; wrap.append(cap);
      grid.append(wrap);
    }
  };
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "Hex grid found", resizable: true },
    classes: ["sde-hexmap-dialog"],
    position: { width: Math.min(1100, (globalThis.innerWidth ?? 1200) - 80), height: Math.min(820, (globalThis.innerHeight ?? 900) - 60) },
    content,
    render: (ev, dialog) => draw(dialog.element ?? dialog),
    buttons: [
      { action: "create", label: "Create scene", default: true, callback: (ev, button, dialog) => {
        const root = dialog.element ?? dialog, q = (n) => root.querySelector?.(`[name='${n}']`)?.value;
        return { cols: parseInt(q("cols"), 10), rows: parseInt(q("rows"), 10), lowered: q("lowered") === "even" ? "even" : "odd", firstNum: String(q("firstNum") ?? "0000").trim() || "0000" };
      } },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (!answer || answer === "cancel") return null;
  if (!(answer.cols > 0 && answer.rows > 0) || !/^\d{3,4}$/.test(answer.firstNum)) { ui.notifications?.warn("Columns and rows must be positive and the first number 3 or 4 digits."); return null; }
  // A corrected row count moves the lowered columns' end with it.
  if (short) answer.rowsLowered = Math.max(1, lat.rowsLowered + answer.rows - lat.rows);
  return answer;
}

/** Copy the file into the world's hex-maps folder. @returns {Promise<string>} the path */
async function uploadMap(file) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/hex-maps`;
  try { await FP.createDirectory("data", dir); } catch (_err) { /* exists */ }
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if (!res?.path) throw new Error("upload failed");
  return res.path;
}

/** Whether this Foundry keeps scene backgrounds on levels (14+). */
const sceneHasLevels = () => !!globalThis.foundry?.documents?.BaseScene?.schema?.fields?.levels;

/**
 * Scene data for a print with the given lattice (image pixels): the grid's
 * pitches become Foundry's by stretching, the anchor lands cell (0, 0). Pure
 * apart from the constants, so it can be checked without a world.
 * @param {number} [opts.rowsLowered]  the lowered columns' row count when it differs from `rows`
 * @param {boolean} [opts.levels]  emit the 14+ `levels` form (default: what the running schema has)
 */
export function alignedSceneData({ name, src, imageW, imageH, lat, firstNum = "0000", cols, rows, rowsLowered, levels = sceneHasLevels() }) {
  const size = Math.max(CONST?.GRID_MIN_SIZE ?? 20, Math.round(lat.pitchY));
  const sizeX = size * 2 / Math.sqrt(3);
  const kx = (0.75 * sizeX) / lat.pitchX, ky = size / lat.pitchY;
  const even = lat.lowered === "even";
  const cube = foundryOffsetToCube({ i: 0, j: 0 }, even);
  const state = emptyState();
  const bounds = { cols, rows };
  if (rowsLowered && rowsLowered !== rows) bounds.rowsLowered = rowsLowered;
  // The lowered columns ending exactly one row short means the frame clips the
  // field at both ends: their bottom half cell, and the RAISED columns' top one,
  // which is where a print like the Western Reaches writes its column labels.
  // That row is margin, so it is not numbered; the tagger's "top row is frame"
  // box undoes it for a print whose first row really is map.
  if (bounds.rowsLowered === rows - 1) bounds.firstRow = 1;
  state.origin = { i: 0, j: 0, q: cube.q, r: cube.r, num: firstNum, shifted: lat.lowered, bounds };
  const width = Math.round(imageW * kx), height = Math.round(imageH * ky);
  // The background mesh sits at the scene rect's centre with its anchor at
  // (anchorX, anchorY) of its own size; anchor 0.5 puts the image's corner at
  // the origin, so a shift of (ox, oy) is an anchor of (0.5 - ox/width, 0.5 - oy/height).
  const ox = sizeX / 2 - lat.x0 * kx, oy = -lat.y0 * ky;
  const textures = { fit: "fill", scaleX: 1, scaleY: 1, anchorX: 0.5 - ox / width, anchorY: 0.5 - oy / height };
  const data = {
    name,
    width, height, padding: 0,
    grid: { type: even ? CONST.GRID_TYPES.HEXEVENQ : CONST.GRID_TYPES.HEXODDQ, size, distance: 6, units: "mi" },
    flags: { [MODULE_ID]: { [TAGS_FLAG]: encodeTags(state) } },
  };
  if (levels) data.levels = [{ name: "Map", background: { src }, textures }];   // a Level needs a name
  else data.background = { src, ...textures };
  return data;
}

/** The whole flow, GM only. @returns {Promise<Scene|null>} */
export async function startHexMapFlow() {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can set up hex maps."); return null; }
  const picked = await pickFile();
  if (!picked) return null;
  const { file, name } = picked;
  let full, working;
  try {
    full = await createImageBitmap(file);
  } catch (err) {
    ui.notifications?.error(`Could not read ${file.name} as an image: ${err.message}`); return null;
  }
  const imageW = full.width, imageH = full.height;
  const scale = Math.min(1, WORK_WIDTH / imageW);
  ui.notifications?.info(`Reading ${file.name} (${imageW} × ${imageH})… this takes a few seconds.`);
  try {
    working = scale < 1 ? await createImageBitmap(full, { resizeWidth: Math.round(imageW * scale), resizeHeight: Math.round(imageH * scale), resizeQuality: "medium" }) : full;
    const { ink, w, h } = await imageInk(working, { scale: 1, onProgress: () => new Promise((r) => setTimeout(r, 0)) });
    const det = detectLattice(ink, w, h);
    if (!det) { ui.notifications?.error("No hex grid found on this image. Hand-drawn or faint grids can be tagged the old way: make a scene, align it, and open the Hex tagger."); return null; }
    const s = w / imageW;
    const lat = { x0: det.x0 / s, y0: det.y0 / s, pitchX: det.pitchX / s, pitchY: det.pitchY / s, cols: det.cols, rows: det.rows, rowsLowered: det.rowsLowered, lowered: det.lowered };
    // The overview: up to 1200 px on the long side, scaled by CSS to the window; the corners are cut from the full image.
    const long = Math.min(1200, Math.max(imageW, imageH));
    const pw = Math.round(imageW >= imageH ? long : long * imageW / imageH);
    const preview = await createImageBitmap(working, { resizeWidth: pw, resizeHeight: Math.round(pw * imageH / imageW), resizeQuality: "medium" });
    const answer = await confirmLattice({ preview, full, file, lat, imageW, corners: cornerSupport(ink, w, h, det) });
    preview.close?.();
    if (!answer) return null;
    const src = await uploadMap(file);
    const data = alignedSceneData({ name, src, imageW, imageH, lat: { ...lat, lowered: answer.lowered }, firstNum: answer.firstNum, cols: answer.cols, rows: answer.rows, rowsLowered: answer.rowsLowered });
    const scene = await Scene.create(data);
    ui.notifications?.info(`Scene "${scene.name}" created: ${answer.cols} × ${answer.rows} hexes on a ${data.grid.size} px grid. Opening the tagger on its legend.`);
    await scene.view();
    (await import("./hex-tagger-app.mjs")).HexTaggerApp.open({ legend: true });
    return scene;
  } catch (err) {
    console.error(`${MODULE_ID} | hex map from image`, err);
    ui.notifications?.error(`Hex map setup failed: ${err.message}`);
    return null;
  } finally {
    working?.close?.(); if (working !== full) full?.close?.();
  }
}
