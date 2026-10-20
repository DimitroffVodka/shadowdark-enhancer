/**
 * Maps for this world: what each map's row offers (in this world, Load from the Adventures compendium, Add map file),
 * and what its button does, with the Foundry parts as stand-ins. Then the quick guide opened on its Terrain page alone,
 * as a hex map brought into the world is offered, and the Welcome page's way into the list.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rowState, mapList, mapsView, hexFilesFrom, loadMap, addMapFiles } from "../scripts/importer/world-maps-core.mjs";
import { HEX_MAPS } from "../scripts/importer/wizard/wizard-core.mjs";
import { allSites } from "../scripts/importer/adventure/adventure-manifest.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";
import { ADVENTURE_PACK_FLAG, onPreImportAdventure, importPackedAdventure } from "../scripts/importer/adventure/adventure-pack.mjs";
import { findHexScene, isHandMadeA0 } from "../scripts/importer/hex/hex-adventure.mjs";
import { HEXMAP_FLAG } from "../scripts/hex-map/hex-map-flow.mjs";

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;
const file = (name) => ({ name, size: 1000 });
const none = { inWorld: new Set(), packed: new Set(), filed: new Set() };

test("a row is in this world before it is in the compendium, and a never-seen map asks for its file", () => {
  const known = { inWorld: new Set(["hex-wr", "s1"]), packed: new Set(["hex-wr", "hex-cs1", "s2"]), filed: new Set(["s3"]) };
  assert.equal(rowState("hex-wr", known), "world", "in the world and packed: nothing to do");
  assert.equal(rowState("hex-cs1", known), "load");
  assert.equal(rowState("s2", known), "load", "a packed adventure loads even when its book's journal is gone from the pack");
  assert.equal(rowState("hex-cs2", known), "add", "a hex map needs no book to be built");
  assert.equal(rowState("s3", known), "add");
  assert.equal(rowState("s4", known), "book", "an adventure map whose book was never imported has no places to pin");
});

test("the list has every hex map and every adventure map, by book, Western Reaches first and a book's hex map first", () => {
  const groups = mapList(none);
  const rows = groups.flatMap((g) => g.rows);
  assert.equal(groups[0].src, "WR");
  assert.deepEqual(HEX_MAPS.map((h) => h.id).filter((id) => !rows.some((r) => r.id === id)), []);
  assert.deepEqual(allSites().map((s) => s.id).filter((id) => !rows.some((r) => r.id === id)), []);
  assert.equal(groups.some((g) => !g.rows.length), false, "no empty book");
  for (const g of groups) { const i = g.rows.findIndex((r) => !r.hex); assert.equal(g.rows.slice(i < 0 ? g.rows.length : i).some((r) => r.hex), false, g.src); }
  assert.equal(rows.find((r) => r.id === "hex-cs4").parts, 2, "the Black River asks for both halves");
  assert.equal(rows.find((r) => r.id === "hex-wr").state, "add");
});

test("the drawn rows: one row at work locks the others, a book row says what is missing, View only once a map is in", () => {
  const site = allSites()[0].id;
  const groups = mapsView(mapList({ inWorld: new Set(["hex-wr"]), packed: new Set(["hex-cs1"]), filed: new Set() }), {
    busy: "hex-cs1", lines: { "hex-wr": { text: "", sceneId: "a0" }, "hex-cs2": { text: "a line", sceneId: "x" } }, canUpload: false, t,
  });
  const row = (id) => groups.flatMap((g) => g.rows).find((r) => r.id === id);
  assert.deepEqual([row("hex-wr").world, row("hex-wr").viewScene], [true, "a0"]);
  assert.deepEqual([row("hex-cs1").busy, row("hex-cs1").load], [true, true]);
  assert.equal(row("hex-cs2").locked, true);
  assert.equal(row("hex-cs2").viewScene, null, "a map not in the world has nothing to view");
  assert.equal(row("hex-cs2").line, "a line");
  assert.equal(row("hex-cs2").noUpload, true, "Add map file is off for a user who may not upload");
  assert.equal(row(site).book, true);
  assert.equal(row(site).line, "SDE.importer.maps.line.needsBook");
});

test("a one-file hex map takes the picked picture whatever its name; the Black River sorts its halves by name", () => {
  const any = file("my scan.jpg");
  assert.deepEqual(hexFilesFrom("hex-cs1", [any]), [any]);
  const north = file("Jungle Hex Map North.png"), south = file("Jungle Hex Map South.png");
  assert.deepEqual(hexFilesFrom("hex-cs4", [south, north]), [north, south]);
  const a = file("a.png"), b = file("b.png");
  assert.deepEqual(hexFilesFrom("hex-cs4", [a, b]), [a, b], "names that say nothing: as picked");
  assert.equal(hexFilesFrom("hex-cs4", [north]), null, "one half is not a map");
  assert.equal(hexFilesFrom("hex-cs1", []), null);
});

test("Load imports the packed map and finds its scene; a map gone from the pack, or one that did not land, says so", async () => {
  const calls = [];
  const deps = (status, scene) => ({ importPacked: async (id) => { calls.push(id); return { status }; }, sceneOf: () => scene });
  assert.deepEqual(await loadMap("hex-cs1", deps("imported", "s1")), { ok: true, sceneId: "s1" });
  assert.deepEqual(await loadMap("hex-cs1", deps("already", "s1")), { ok: true, sceneId: "s1" }, "already there is still in this world");
  assert.equal((await loadMap("x", deps("missing", null))).line.key, "SDE.importer.maps.line.notPacked");
  assert.equal((await loadMap("x", deps("imported", null))).line.key, "SDE.importer.maps.line.loadFailed");
  assert.deepEqual(calls, ["hex-cs1", "hex-cs1", "x", "x"]);
});

test("Add map file builds a hex map from the picked files; with no key locations it still loads and names the book", async () => {
  const built = [];
  const deps = (made) => ({ buildHex: async (id, files) => { built.push([id, files.map((f) => f.name)]); return made; }, sceneOf: () => null });
  const half = await addMapFiles("hex-cs4", [file("Jungle Hex Map North.png")], deps({}));
  assert.deepEqual([half.ok, half.line.key], [false, "SDE.importer.maps.line.bothHalves"]);
  assert.deepEqual(built, [], "nothing is built from half a map");
  const done = await addMapFiles("hex-cs4", [file("Jungle Hex Map South.png"), file("Jungle Hex Map North.png")], deps({ status: "ready", sceneId: "br", pinned: 36 }));
  assert.deepEqual(done, { ok: true, sceneId: "br", line: null });
  assert.deepEqual(built.at(-1), ["hex-cs4", ["Jungle Hex Map North.png", "Jungle Hex Map South.png"]]);
  const bare = await addMapFiles("hex-cs1", [file("x.png")], deps({ status: "ready", sceneId: "g", pinned: 0 }));
  assert.deepEqual([bare.ok, bare.line.key, bare.line.args.book], [true, "SDE.importer.maps.line.noKeys", "Cursed Scroll 1: Diablerie"]);
  assert.equal((await addMapFiles("hex-wr", [file("x.png")], deps({ status: "ready", sceneId: "a0", pinned: 0 }))).line.args.book, "Game Master's Guide to the Western Reaches");
  assert.equal((await addMapFiles("hex-cs1", [file("x.png")], deps({ status: "needsLook" }))).line.key, "SDE.importer.maps.line.needsLook");
});

test("Add map file uploads an adventure map's picture, builds it into the world, and says what pins are left", async () => {
  const site = allSites()[0].id;
  let builds = 0;
  const deps = ({ path = "worlds/w/adventure-maps/x.png", result, scene = "s" } = {}) => ({
    uploadMap: async () => path, buildSite: async (id, p) => { builds += 1; assert.equal(p, path); return result; }, sceneOf: () => scene,
  });
  assert.deepEqual(await addMapFiles(site, [file("x.png")], deps({ path: null })), { ok: false }, "a refused upload says why itself");
  assert.equal(builds, 0);
  assert.deepEqual(await addMapFiles(site, [file("x.png")], deps({ result: { status: "built", known: true, left: 0 } })), { ok: true, sceneId: "s", line: null });
  assert.equal((await addMapFiles(site, [file("x.png")], deps({ result: { status: "built", known: true, left: 2 } }))).line.key, "SDE.importer.wizard.run.pinsLeft");
  assert.equal((await addMapFiles(site, [file("x.png")], deps({ result: { status: "built", known: false, left: 9 } }))).line.key, "SDE.importer.wizard.run.pinsByHand");
  assert.equal((await addMapFiles(site, [file("x.png")], deps({ result: { status: "failed" }, scene: null }))).ok, false);
});

/** A guide opened on the Terrain page alone, with stand-in Legends; `need` says which maps still have terrain to name. */
async function terrainOnly(rows, need) {
  const opened = [], asked = [];
  const ctl = new WizardController({
    t, release: async () => {},
    terrainNeed: async (r) => { asked.push(r.id); return need.includes(r.id); },
    legendOpen: async (m) => { opened.push(m.id); return { cards: () => [], answer: () => false, pick() {}, apply: async () => true, close() {} }; },
    artOffer: async () => { throw new Error("no art offer for a terrain step"); },
  }, () => {});
  await ctl.startTerrain(rows);
  return { ctl, opened, asked };
}

test("a hex map brought in from the compendium opens the guide's Terrain page, even a drawn one, and Done has no import counts", async () => {
  const rows = [{ id: "hex-wr", title: "A0", sceneId: "a0" }, { id: "hex-cs1", title: "Gloaming", sceneId: "g" }];
  const { ctl, opened, asked } = await terrainOnly(rows, ["hex-wr", "hex-cs1"]);
  assert.deepEqual(asked, ["hex-wr", "hex-cs1"]);
  assert.equal(ctl.state.page, "terrain");
  assert.deepEqual(opened, ["hex-wr"]);
  await ctl.dispatch("next");
  await ctl.dispatch("next");
  assert.equal(ctl.state.page, "done");
  assert.deepEqual(opened, ["hex-wr", "hex-cs1"], "the GM asked for it, so a drawn map is named too");
  const done = ctl.viewModel().done;
  assert.equal(done.counts, false);
  assert.equal(done.hexBody, "");
  assert.equal(done.art, null);
  assert.deepEqual(done.hexMaps.map((h) => h.line.replace(/\{.*/, "")), ["SDE.importer.wizard.done.hexStatus.named", "SDE.importer.wizard.done.hexStatus.named"]);
});

test("a map whose terrain is already named goes straight to Done", async () => {
  const { ctl, opened } = await terrainOnly([{ id: "hex-wr", title: "A0", sceneId: "a0" }], []);
  assert.equal(ctl.state.page, "done");
  assert.deepEqual(opened, []);
});

test("the Welcome page offers Maps for this world only once the world has imported, and not for an update", async () => {
  const opened = [];
  const make = (env) => new WizardController({ t, openMaps: () => opened.push("maps"), ...env }, () => {});
  assert.equal(make({}).viewModel().welcomeMaps, false);
  const ctl = make({ imported: true });
  assert.equal(ctl.viewModel().welcomeMaps, true);
  await ctl.dispatch("openMaps");
  assert.deepEqual(opened, ["maps"]);
  ctl.state.page = "books";
  await ctl.dispatch("openMaps");
  assert.deepEqual(opened, ["maps"], "only from the Welcome page");
  const update = make({ imported: true });
  update.state.update = { n: 3, books: ["CS1"], needed: ["CS1"] };
  assert.equal(update.viewModel().welcomeMaps, false);
});

/** A packed Adventure whose import runs the real hook as Adventure#import does, creating these scenes. */
const packedAdventure = (scenes) => {
  const adv = { getFlag: (m, k) => (k === ADVENTURE_PACK_FLAG ? { site: "x" } : undefined) };
  adv.import = async (opts) => {
    const options = { preImport: [], postImport: [], ...opts };
    onPreImportAdventure(adv, options);
    const result = { created: { Scene: scenes } };
    for (const fn of options.postImport) await fn(result, options);
    return result;
  };
  return adv;
};
const hexScene = (mapId) => ({ id: `s-${mapId}`, notes: { size: 3 }, getFlag: (m, k) => (k === HEXMAP_FLAG ? mapId : undefined) });
const siteScene = { id: "site", getFlag: () => undefined };

test("importing a packed hex map asks once to set up its terrain; the wizard's own import asks nothing", async () => {
  const asked = [];
  const before = { foundry: globalThis.foundry, game: globalThis.game };
  globalThis.foundry = { applications: { api: {
    ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c,
    DialogV2: { confirm: async (o) => { asked.push(o.content); return false; } },
  } } };
  globalThis.game = { user: { isGM: true } };
  try {
    const settle = () => new Promise((r) => setTimeout(r, 50));
    await importPackedAdventure(packedAdventure([hexScene("hex-cs1"), siteScene]));
    await settle();
    assert.equal(asked.length, 1, "one question, for the hex map only");
    assert.match(asked[0], /terrainOffer\.body/);
    await importPackedAdventure(packedAdventure([hexScene("hex-cs2")]), { offer: false });
    await settle();
    assert.equal(asked.length, 1, "the wizard names the terrain itself");
    await importPackedAdventure(packedAdventure([siteScene]));
    await settle();
    assert.equal(asked.length, 1, "an adventure map is never asked about");
  } finally {
    globalThis.foundry = before.foundry; globalThis.game = before.game;
  }
});

test("a Western Reaches A0 made by hand is found as the A0, so it is not built or loaded twice", () => {
  const flags = (f) => ({ getFlag: (m, k) => f[k] });
  const a0Origin = { origin: { bounds: { cols: 64, rows: 75 } } };
  const handMade = flags({ hexTags: a0Origin });
  assert.equal(isHandMadeA0(handMade), true);
  assert.equal(isHandMadeA0(flags({ hexTags: { origin: { bounds: { cols: 30, rows: 22 } } } })), false, "another print's field");
  assert.equal(isHandMadeA0(flags({ hexTags: a0Origin, [HEXMAP_FLAG]: "hex-wr" })), false, "one the module made is found by its id");
  const before = globalThis.game;
  globalThis.game = { scenes: [flags({}), handMade] };
  try {
    assert.equal(findHexScene("hex-wr"), handMade);
    assert.equal(findHexScene("hex-cs1"), null);
  } finally { globalThis.game = before; }
});
