/**
 * The wizard's offer of walls and doors for the adventure scenes it built: the run records each scene, the Done page lists
 * them with a button, and the button opens the walls window for that scene. Foundry is a stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newState, addFiles } from "../scripts/importer/wizard/wizard-core.mjs";
import { runWizardImport } from "../scripts/importer/wizard/wizard-run.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;
const file = (name, mb = 2) => ({ name, size: Math.round(mb * 1048576) });
const SITES = { "Ruins of Bittermold Keep (68 wide x 44 high).png": { id: "cs1-mugdulblub", title: "The Hideous Halls" }, "The Iron Fortress (45 wide x 35 high).png": { id: "cs2-iron-fortress", title: "The Iron Fortress" } };

const deps = (over = {}) => ({
  t, adventureBooks: [], keyBooks: [], library: async () => ({ documents: 0, nothing: 0, lines: [] }),
  fileAdventures: async () => ({ sites: [], failed: [] }), keyLocations: async () => ({ hexes: 0, created: 0, failed: [] }),
  hexMap: async () => ({ status: "failed" }),
  siteOf: (id) => Object.values(SITES).find((s) => s.id === id) ?? null, isFiled: async () => true,
  ...over,
});

async function run(buildScene) {
  const s = newState();
  addFiles(s, Object.keys(SITES).map((n) => file(n)));
  s.check = { done: true, ready: Object.keys(s.maps).map((id) => `map:${id}`), problems: [], items: [] };
  return runWizardImport(s, { onProgress() {}, cancelled: () => false }, deps({ buildScene }));
}

test("a built scene and one that was already there are both offered walls and doors; a failed one is not", async () => {
  const r = await run(async (id) => (id === "cs1-mugdulblub" ? { status: "built", placed: 3, left: 0, known: true, sceneId: "new" } : { status: "already", placed: 0, left: 0, known: true, sceneId: "old" }));
  assert.deepEqual(r.siteMaps.map((m) => [m.id, m.sceneId]).sort(), [["cs1-mugdulblub", "new"], ["cs2-iron-fortress", "old"]]);
  const failed = await run(async () => ({ status: "failed", placed: 0, left: 0, known: false }));
  assert.deepEqual(failed.siteMaps, []);
});

test("the Done page lists the scenes and the button opens the walls window for that scene", async () => {
  const opened = [];
  const ctl = new WizardController({
    t, release: async () => {},
    run: async () => ({ imported: 2, already: 0, needsYou: [], hex: [], siteMaps: [{ id: "cs1-mugdulblub", title: "The Hideous Halls", sceneId: "new" }, { id: "x", title: "No scene yet" }] }),
    openWalls: async (sceneId) => { opened.push(sceneId); },
  }, () => {});
  ctl.state.page = "ready"; ctl.state.check = { done: true, ready: [], problems: [], items: [] };
  await ctl.dispatch("next");
  assert.equal(ctl.state.page, "done");
  const rows = ctl.viewModel().done.siteMaps;
  assert.deepEqual(rows.map((m) => m.sceneId), ["new"], "a map with no scene has nothing to open");
  await ctl.dispatch("openWalls", { scene: "new" });
  assert.deepEqual(opened, ["new"]);
});
