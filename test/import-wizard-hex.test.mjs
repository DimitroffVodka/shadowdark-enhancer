/**
 * The wizard's hex maps: what is known of each print, the stages that set them up, and what the Done page offers.
 * Foundry is a stub; what is tested is the order, the numbers, and which map is never asked about mid-run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newState, addFiles, HEX_MAPS } from "../scripts/importer/wizard/wizard-core.mjs";
import { runWizardImport } from "../scripts/importer/wizard/wizard-run.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";
import { HEX_PRINTS, hexPrint } from "../scripts/hex-map/hex-prints.mjs";
import { KEY_LOCATION_PAGES } from "../scripts/importer/char-content/char-content-manifest.mjs";

const file = (name, mb = 2) => ({ name, size: Math.round(mb * 1048576) });
const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;
const HEX_FILES = {
  "hex-wr": "Western Reaches GM Map A0.jpg", "hex-cs1": "The Gloaming Hex Map.png", "hex-cs2": "The Djurum Hex Map.png",
  "hex-cs3": "Isles of Andrik Hex Map.png", "hex-cs4:north": "Jungle Hex Map North.png", "hex-cs4:south": "Jungle Hex Map South.png",
  "hex-cs5": "Morzomotha Map.jpg",
};
const ready = (...files) => {
  const s = newState();
  addFiles(s, files);
  s.check = { done: true, ready: [...Object.keys(s.books).map((id) => `book:${id}`), ...Object.keys(s.maps).map((id) => `map:${id.split(":")[0]}`)], problems: [], items: [] };
  return s;
};
const deps = (over = {}) => {
  const calls = [];
  return {
    calls, t, adventureBooks: [], keyBooks: ["GMWR", "CS1", "CS2", "CS3", "CS4", "CS5"],
    library: async () => ({ documents: 0, nothing: 0, lines: [] }),
    fileAdventures: async () => ({ sites: [], failed: [] }), siteOf: () => null, isFiled: async () => true, buildScene: async () => ({ status: "built" }),
    keyLocations: async (src) => { calls.push(`keys:${src}`); return { hexes: 40, created: 40, failed: [] }; },
    hexMap: async (id, o) => { calls.push(`hex:${id}:${o.firstNum ?? ""}`); return { status: "ready", sceneId: `s-${id}`, legend: true, pinned: 12 }; },
    ...over,
  };
};
const hooks = () => { const seen = []; return { seen, onProgress: (pct) => seen.push(pct), cancelled: () => false }; };

test("every hex map the wizard asks for has a print entry, its key book's data, and a plausible first number", () => {
  for (const h of HEX_MAPS) {
    const p = hexPrint(h.id);
    assert.ok(p, `${h.id} has no print entry`);
    assert.ok(KEY_LOCATION_PAGES[p.keySrc], `${h.id}: ${p.keySrc} has no key locations`);
    if (p.firstNum) assert.match(p.firstNum, /^\d{3,4}$/);
  }
  assert.deepEqual(Object.keys(HEX_PRINTS).sort(), HEX_MAPS.map((h) => h.id).sort());
  assert.equal(hexPrint("hex-cs4:north"), HEX_PRINTS["hex-cs4"], "a half of a split map is the map");
});

test("every Cursed Scroll hex map is numbered from 0001, the A0 needs no number", () => {
  assert.deepEqual(["hex-cs1", "hex-cs2", "hex-cs3", "hex-cs4", "hex-cs5"].map((id) => hexPrint(id).firstNum), ["0001", "0001", "0001", "0001", "0001"]);
  assert.equal(hexPrint("hex-wr").firstNum, undefined);
});

test("keyed hexes are imported before any hex map is set up, and each hex map is set up with its own first number", async () => {
  const d = deps();
  const r = await runWizardImport(ready(file("Cursed Scroll 1 - Diablerie V4-3.pdf"), file(HEX_FILES["hex-cs1"])), hooks(), d);
  assert.deepEqual(d.calls, ["keys:CS1", "hex:hex-cs1:0001"]);
  assert.deepEqual(r.hex.map((h) => [h.id, h.status, h.legend, h.look]), [["hex-cs1", "ready", true, false]]);
  assert.equal(r.imported, 40 + 1);
});

test("the A0 is set up with no first number", async () => {
  const d = deps();
  await runWizardImport(ready(file("Game Master's Guide to the Western Reaches.pdf", 97), file(HEX_FILES["hex-wr"], 21)), hooks(), d);
  assert.deepEqual(d.calls, ["keys:GMWR", "hex:hex-wr:"]);
});

test("the Black River (both halves, in order) and Morzomotha are set up like any other map, with their own first numbers", async () => {
  const seen = [];
  const d = deps({ hexMap: async (id, o) => { seen.push([id, o.firstNum]); return { status: "ready", sceneId: `s-${id}`, legend: true, pinned: 20 }; } });
  const r = await runWizardImport(ready(file(HEX_FILES["hex-cs4:north"]), file(HEX_FILES["hex-cs4:south"]), file(HEX_FILES["hex-cs5"])), hooks(), d);
  assert.deepEqual(seen, [["hex-cs4", "0001"], ["hex-cs5", "0001"]]);
  assert.deepEqual(r.hex.map((h) => [h.id, h.status, h.legend]), [["hex-cs4", "ready", true], ["hex-cs5", "ready", true]]);
  assert.deepEqual(r.needsYou, []);
});

test("a second run leaves finished hex maps alone and counts the re-read key pages as already had", async () => {
  const d = deps({
    keyLocations: async () => ({ hexes: 40, created: 0, failed: [] }),
    hexMap: async () => ({ status: "already", sceneId: "s1", legend: false }),
  });
  const r = await runWizardImport(ready(file("Cursed Scroll 1 - Diablerie V4-3.pdf"), file(HEX_FILES["hex-cs1"])), hooks(), d);
  assert.equal(r.imported, 0);
  assert.equal(r.already, 40 + 1);
  assert.equal(r.hex[0].legend, false);
});

test("a map the grid finder is unsure of is left for the Done page, and a failure is a problem", async () => {
  const unsure = await runWizardImport(ready(file(HEX_FILES["hex-cs2"])), hooks(), deps({ hexMap: async () => ({ status: "needsLook" }) }));
  assert.equal(unsure.hex[0].status, "needsLook");
  assert.equal(unsure.hex[0].look, true);
  assert.deepEqual(unsure.needsYou, []);
  const failed = await runWizardImport(ready(file(HEX_FILES["hex-cs2"])), hooks(), deps({ hexMap: async () => ({ status: "failed" }) }));
  assert.deepEqual(failed.needsYou, []);
  assert.deepEqual(failed.hex.map((h) => [h.status, h.look, h.legend]), [["failed", true, false]], "its row offers the by-hand setup, since the GM still holds the file");
});

test("key-location failures are things to look at; progress still only moves forward", async () => {
  const h = hooks();
  const r = await runWizardImport(ready(file("Cursed Scroll 1 - Diablerie V4-3.pdf"), file(HEX_FILES["hex-cs1"])), h, deps({ keyLocations: async () => ({ hexes: 3, created: 3, failed: [{ region: "The Gloaming", error: "page unreadable" }] }) }));
  assert.deepEqual(r.needsYou.map((x) => x.title), ["The Gloaming"]);
  assert.deepEqual(h.seen, [...h.seen].sort((a, b) => a - b));
  assert.equal(h.seen.at(-1), 100);
});

test("the Done page lists each hex map with its status and offers only what is left to do", () => {
  const ctl = new WizardController({ t }, () => {});
  ctl.state.page = "done";
  ctl.state.result = { imported: 1, already: 0, needsYou: [], hex: [
    { id: "hex-wr", title: "Western Reaches hex map (A0)", status: "ready", legend: true, look: false, sceneId: "a0", pinned: 270 },
    { id: "hex-cs2", title: "The Djurum hex map", status: "needsLook", legend: false, look: true },
    { id: "hex-cs4", title: "The Black River hex map (Jungle)", status: "already", legend: false, look: false, sceneId: "br" },
    { id: "hex-cs1", title: "The Gloaming hex map", status: "already", legend: false, look: false, sceneId: "g" },
  ] };
  const done = ctl.viewModel().done;
  assert.equal(done.hexMaps.length, 4);
  assert.deepEqual(done.hexMaps.map((h) => [h.id, !!h.legend, !!h.look]), [["hex-wr", true, false], ["hex-cs2", false, true], ["hex-cs4", false, false], ["hex-cs1", false, false]]);
  assert.match(done.hexMaps[0].line, /hexStatus\.ready.*"n":270/);
  assert.match(done.hexMaps[2].line, /hexStatus\.already/);
  assert.equal(done.hexLegend, true);
  // With no map left to name, the explanation of the Legend is not shown.
  ctl.state.result.hex[0].legend = false;
  assert.equal(ctl.viewModel().done.hexLegend, false);
});

test("the measured grids are hexes, sit inside their print, and describe a field of the right shape", async () => {
  const { latticeCentre } = await import("../scripts/hex-map/lattice.mjs");
  const { printBySize, knownAnswer } = await import("../scripts/hex-map/hex-prints.mjs");
  for (const id of ["hex-cs4", "hex-cs5"]) {
    const p = hexPrint(id), { lat, cols, rows, rowsLowered } = p.grid, [w, h] = p.size;
    // regular hexes: the column pitch is 0.866 of the row pitch
    assert.ok(Math.abs(lat.pitchX / lat.pitchY - Math.sqrt(3) / 2) < 0.003, `${id}: pitches are not a regular hex's`);
    const lowered = (col) => (lat.lowered === "odd") === (col % 2 === 1);
    for (const [col, row] of [[0, 0], [cols - 1, 0], [0, (lowered(0) ? rowsLowered : rows) - 1], [cols - 1, (lowered(cols - 1) ? rowsLowered : rows) - 1]]) {
      const c = latticeCentre(lat, col, row);
      assert.ok(c.u > 0 && c.u < w && c.v > 0 && c.v < h, `${id}: cell ${col},${row} at ${c.u},${c.v} is outside ${w}x${h}`);
    }
    // the field fills its print: the last cell's far edge is within a hex of the image's
    const last = latticeCentre(lat, cols - 1, rows - 1);
    assert.ok(w - (last.u + lat.pitchX / 0.75 / 2) < lat.pitchX, `${id}: field stops short of the image's right edge`);
  }
  // Morzomotha's print is found by its size alone (the old Hex map from image flow has no id to give), the Black River's halves are not
  assert.equal(printBySize(4500, 3348)?.id, "hex-cs5");
  assert.equal(printBySize(2250, 1674), null);
  assert.equal(printBySize(2250, 3169), null, "the joined image only exists inside the flow");
  assert.equal(knownAnswer("hex-cs1"), null, "the Gloaming is read from its print, not looked up");
});

test("the Black River's second half is laid exactly eleven rows below the first, so the two lattices are one", () => {
  const { grid, join, size } = hexPrint("hex-cs4");
  assert.equal(join.dy, Math.round(11 * grid.lat.pitchY), "dy is eleven row pitches");
  assert.equal(size[1], join.dy + join.height);
  assert.equal(size[0], join.width);
  // 11 rows in each half: the joined field has the raised columns' 22 and the lowered columns' 21 (the south half's lowered columns end a row short)
  assert.deepEqual([grid.rows, grid.rowsLowered], [22, 21]);
});
