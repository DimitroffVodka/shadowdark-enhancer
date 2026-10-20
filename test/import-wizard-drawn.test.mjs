/**
 * The five hex maps that are drawings with a grid laid over them (hex-prints.mjs `drawn`): the wizard builds them like
 * any other map, but their terrain is a choice, not a step: the Terrain page after a run is for the A0 alone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newState, addFiles } from "../scripts/importer/wizard/wizard-core.mjs";
import { runWizardImport } from "../scripts/importer/wizard/wizard-run.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";
import { HEX_PRINTS } from "../scripts/hex-map/hex-prints.mjs";

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;
const file = (name, mb = 2) => ({ name, size: Math.round(mb * 1048576) });
const HEX = (id, over = {}) => ({ id, title: `Map ${id}`, status: "ready", legend: false, look: false, optional: false, sceneId: `s-${id}`, pinned: 10, ...over });

test("the A0 is the one map whose terrain is not a drawing", () => {
  assert.deepEqual(Object.entries(HEX_PRINTS).filter(([, p]) => p.drawn).map(([id]) => id), ["hex-cs1", "hex-cs2", "hex-cs3", "hex-cs4", "hex-cs5"]);
  assert.equal(HEX_PRINTS["hex-wr"].drawn, undefined);
});

test("a run marks each hex map with its print and keeps whether its terrain is still to name", async () => {
  const s = newState();
  addFiles(s, [file("Western Reaches GM Map A0.jpg", 21), file("The Gloaming Hex Map.png"), file("Jungle Hex Map North.png"), file("Jungle Hex Map South.png")]);
  s.check = { done: true, ready: [...Object.keys(s.maps).map((id) => `map:${id.split(":")[0]}`)], problems: [], items: [] };
  const r = await runWizardImport(s, { onProgress() {}, cancelled: () => false }, {
    t, adventureBooks: [], keyBooks: [], library: async () => ({ documents: 0, nothing: 0, lines: [] }),
    fileAdventures: async () => ({ sites: [], failed: [] }), siteOf: () => null, isFiled: async () => true, buildScene: async () => ({ status: "built" }), keyLocations: async () => ({ hexes: 0, created: 0, failed: [] }),
    hexMap: async (id) => ({ status: "ready", sceneId: `s-${id}`, legend: true, pinned: 5 }),
  });
  assert.deepEqual(r.hex.map((h) => [h.id, h.optional, h.legend]), [["hex-wr", false, true], ["hex-cs1", true, true], ["hex-cs4", true, true]]);
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

test("a run of hex maps whose terrain is named, or a choice, goes straight to Done; no Legend is opened", async () => {
  const { ctl, opened } = await afterRun([HEX("hex-wr"), HEX("hex-cs1", { optional: true }), HEX("hex-cs4", { optional: true })]);
  assert.equal(ctl.state.page, "done");
  assert.deepEqual(opened, [], "nothing is left to name");
  const done = ctl.viewModel().done;
  assert.equal(done.hexMaps.every((h) => !h.legend), true, "no map offers a Name the terrain button from the import");
  assert.equal(done.hexBody, "SDE.importer.wizard.done.hexBody");
});

test("a packed map's Done row says it waits in the Adventures compendium", async () => {
  const { ctl } = await afterRun([HEX("hex-cs1", { status: "packed", packed: true })]);
  const line = ctl.viewModel().done.hexMaps[0].line;
  assert.match(line, /hexStatus\.packed.*"n":10/);
});

test("the Ready page's hex note is the same tagging note for every chosen hex map", () => {
  const ctl = new WizardController({ t }, () => {});
  ctl.state.page = "ready";
  ctl.state.check = { done: true, ready: ["map:hex-cs1", "map:hex-cs2"], problems: [], items: [] };
  assert.equal(ctl.viewModel().ready.hexNote, "SDE.importer.wizard.hex.ready");
  ctl.state.check = { done: true, ready: ["map:hex-cs1", "map:hex-wr"], problems: [], items: [] };
  assert.equal(ctl.viewModel().ready.hexNote, "SDE.importer.wizard.hex.ready");
});

test("the Ready page's hex note is empty when no hex map is chosen", () => {
  const ctl = new WizardController({ t }, () => {});
  ctl.state.page = "ready";
  ctl.state.check = { done: true, ready: ["book:x"], problems: [], items: [] };
  assert.equal(ctl.viewModel().ready.hexNote, "");
});
