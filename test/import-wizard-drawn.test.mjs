/**
 * The five hex maps that are drawings with a grid laid over them (hex-prints.mjs `drawn`) are set up and pinned like any
 * other, but their terrain is a choice, not a step: the Terrain page is only for the maps where the Legend works (the
 * Western Reaches' A0). What the run marks, what the pages say, and what the Done page offers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newState, addFiles } from "../scripts/importer/wizard/wizard-core.mjs";
import { runWizardImport } from "../scripts/importer/wizard/wizard-run.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";
import { readFileSync } from "node:fs";
import { HEX_PRINTS } from "../scripts/hex-map/hex-prints.mjs";

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;
const file = (name, mb = 2) => ({ name, size: Math.round(mb * 1048576) });
const HEX = (id, over = {}) => ({ id, title: `Map ${id}`, status: "ready", legend: true, look: false, optional: false, sceneId: `s-${id}`, pinned: 10, ...over });

test("the A0 is the one map whose terrain is a step; the five drawings are not", () => {
  assert.deepEqual(Object.entries(HEX_PRINTS).filter(([, p]) => p.drawn).map(([id]) => id), ["hex-cs1", "hex-cs2", "hex-cs3", "hex-cs4", "hex-cs5"]);
  assert.equal(HEX_PRINTS["hex-wr"].drawn, undefined);
});

test("a run marks each hex map it set up as optional or not, from its print", async () => {
  const s = newState();
  addFiles(s, [file("Western Reaches GM Map A0.jpg", 21), file("The Gloaming Hex Map.png"), file("Jungle Hex Map North.png"), file("Jungle Hex Map South.png")]);
  s.check = { done: true, ready: [...Object.keys(s.maps).map((id) => `map:${id.split(":")[0]}`)], problems: [], items: [] };
  const r = await runWizardImport(s, { onProgress() {}, cancelled: () => false }, {
    t, adventureBooks: [], keyBooks: [], library: async () => ({ documents: 0, nothing: 0, lines: [] }),
    fileAdventures: async () => ({ sites: [], failed: [] }), siteOf: () => null, isFiled: async () => true, buildScene: async () => ({ status: "built" }), keyLocations: async () => ({ hexes: 0, created: 0, failed: [] }),
    hexMap: async (id) => ({ status: "ready", sceneId: `s-${id}`, legend: true, pinned: 5 }),
  });
  assert.deepEqual(r.hex.map((h) => [h.id, h.optional]), [["hex-wr", false], ["hex-cs1", true], ["hex-cs4", true]]);
});

/** A controller whose run has finished with these hex results, on the page after the import. */
async function afterRun(hex) {
  const opened = [];
  const ctl = new WizardController({
    t, release: async () => {},
    run: async () => ({ imported: 1, already: 0, needsYou: [], hex }),
    legendOpen: async (m) => { opened.push(m.id); return { cards: () => [], answer: () => false, pick() {}, apply: async () => true, close() {} }; },
  }, () => {});
  ctl.state.page = "ready"; ctl.state.check = { done: true, ready: [], problems: [], items: [] };
  await ctl.dispatch("next");
  return { ctl, opened };
}

test("only the A0 is walked through on the Terrain page; a drawn map waits on the Done page with its terrain offered", async () => {
  const { ctl, opened } = await afterRun([HEX("hex-wr"), HEX("hex-cs1", { optional: true }), HEX("hex-cs4", { optional: true })]);
  assert.equal(ctl.state.page, "terrain");
  assert.deepEqual(opened, ["hex-wr"]);
  assert.match(ctl.viewModel().terrain.heading, /"n":1,"of":1/, "one map is waiting, not three");
  await ctl.dispatch("cancel");   // skip the A0
  assert.equal(ctl.state.page, "done");
  const done = ctl.viewModel().done;
  assert.deepEqual(done.hexMaps.map((h) => [h.id, h.legend]), [["hex-wr", true], ["hex-cs1", true], ["hex-cs4", true]], "every unnamed map still has its Name the terrain button");
  assert.match(done.hexMaps[0].line, /hexStatus\.ready\{/, "the A0 line is the ordinary one");
  assert.match(done.hexMaps[1].line, /hexStatus\.readyDrawn.*"n":10/);
  assert.equal(done.hexLegend, true, "the A0 is still unnamed, so the ordinary explanation shows");
});

test("a run of drawn maps only goes straight to Done, with the optional explanation", async () => {
  const { ctl, opened } = await afterRun([HEX("hex-cs1", { optional: true }), HEX("hex-cs5", { optional: true })]);
  assert.equal(ctl.state.page, "done");
  assert.deepEqual(opened, [], "no Legend is read until the GM asks");
  const done = ctl.viewModel().done;
  assert.equal(done.hexLegend, false);
  assert.equal(done.hexLegendOptional, true);
  assert.equal(done.hexMaps.every((h) => h.legend), true);
});

test("a drawn map that is already named reads as named, and the explanation goes when nothing is left", async () => {
  const { ctl } = await afterRun([HEX("hex-cs1", { optional: true, legend: false, named: true })]);
  const done = ctl.viewModel().done;
  assert.match(done.hexMaps[0].line, /hexStatus\.named/);
  assert.equal(done.hexLegend || done.hexLegendOptional, false);
});

test("the Ready page's hex note is the optional one only when every chosen map is a drawing", () => {
  const ctl = new WizardController({ t }, () => {});
  ctl.state.page = "ready";
  ctl.state.check = { done: true, ready: ["map:hex-cs1", "map:hex-cs2"], problems: [], items: [] };
  assert.deepEqual([ctl.viewModel().ready.hexNote, ctl.viewModel().ready.hexDrawnOnly], [true, true]);
  ctl.state.check = { done: true, ready: ["map:hex-cs1", "map:hex-wr"], problems: [], items: [] };
  assert.deepEqual([ctl.viewModel().ready.hexNote, ctl.viewModel().ready.hexDrawnOnly], [true, false]);
});

test("a drawn map that was already set up and is still unnamed says its terrain is optional, without a pin count", async () => {
  const { ctl } = await afterRun([HEX("hex-cs1", { optional: true, status: "already", pinned: 0 })]);
  const lines = ctl.viewModel().done.hexMaps.map((h) => h.line);
  assert.match(lines[0], /hexStatus\.alreadyDrawn/);
  assert.doesNotMatch(JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"))["SDE.importer.wizard.done.hexStatus.alreadyDrawn"], /\{n\}/, "the string has no count to print");
});

test("the Ready page's drawing-only note is false when no hex map is chosen", () => {
  const ctl = new WizardController({ t }, () => {});
  ctl.state.page = "ready";
  ctl.state.check = { done: true, ready: ["book:x"], problems: [], items: [] };
  assert.deepEqual([ctl.viewModel().ready.hexNote, ctl.viewModel().ready.hexDrawnOnly], [false, false]);
});
