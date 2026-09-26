import test from "node:test";
import assert from "node:assert/strict";
import { extrasHexApi, handoffDataset, handoffToPrint, importDatasetRecords } from "../scripts/importer/hex/hex-handoff.mjs";

const clean = () => {
  delete globalThis.game;
  delete globalThis.ui;
  delete globalThis.foundry;
  delete globalThis.saveDataToFile;
};

test.afterEach(clean);

test("handoff is GM-only even when a builder is exposed", async () => {
  let calls = 0;
  globalThis.game = { user: { isGM: false }, shadowdarkExtras: { hex: { buildHexcrawl: async () => { calls++; } } } };
  globalThis.ui = { notifications: { warn: () => {} } };
  assert.deepEqual(await handoffDataset({ name: "Test" }), { via: "none", reason: "not-gm" });
  assert.equal(calls, 0);
});

test("compatible namespace receives a GM handoff", async () => {
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: { buildHexcrawl: async (ds) => ({ name: ds.name }) } } };
  const result = await handoffDataset({ name: "Test" });
  assert.deepEqual(result, { via: "extras", summary: { name: "Test" } });
});

test("raw module.api is not treated as the compatible builder", async () => {
  let saved;
  globalThis.game = { user: { isGM: true }, modules: { get: () => ({ api: { buildHexcrawl: () => { throw new Error("wrong contract"); } } }) } };
  globalThis.foundry = { utils: { saveDataToFile: (body, type, filename) => { saved = { body, type, filename }; } } };
  assert.equal(extrasHexApi(), null);
  assert.deepEqual(await handoffDataset({ name: "Test Map" }), { via: "download", filename: "test-map-hexcrawl.json" });
  assert.equal(saved.type, "text/json");
  assert.match(saved.body, /Test Map/);
});

test("a failed compatible handoff falls back to the JSON download", async () => {
  let saved;
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: { buildHexcrawl: async () => { throw new Error("builder failed"); } } } };
  globalThis.foundry = { utils: { saveDataToFile: (body, type, filename) => { saved = { body, type, filename }; } } };
  globalThis.ui = { notifications: { error: () => {} } };
  assert.deepEqual(await handoffDataset({ name: "Test" }), { via: "download", filename: "test-hexcrawl.json", reason: "extras-error" });
  assert.ok(saved);
});

// ── importDatasetRecords: details onto an already-built scene ────────────────

test("import strips art and icon, which Extras rejects on an existing scene", async () => {
  let sent;
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: {
    buildHexcrawl: async () => {},
    upsertHexRecords: async (sceneId, records) => { sent = { sceneId, records }; return { sceneId, records: records.length }; },
  } } };
  globalThis.ui = { notifications: { info: () => {} } };

  const dataset = { hexes: [
    { num: 1403, name: "Chimera Pride", terrain: "arctic sea", zone: "Darkwood", desc: "A cold shore.",
      art: "modules/shadowdark-extras/assets/Hexes/forest-01.webp", icon: "modules/x/tower.webp" },
  ] };
  const result = await importDatasetRecords("scene-1", dataset, { repaint: false });

  assert.deepEqual(sent.records, [
    { num: 1403, name: "Chimera Pride", terrain: "arctic sea", desc: "A cold shore.", zone: "Darkwood" },
  ], "art and icon are build-only and must never reach upsertHexRecords");
  assert.equal(sent.sceneId, "scene-1");
  assert.deepEqual(result, { via: "extras", summary: { sceneId: "scene-1", records: 1 }, repaint: null });
});

test("import repaints the tiles of hexes whose terrain it asserted", async () => {
  const seen = {};
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: {
    buildHexcrawl: async () => {},
    upsertHexRecords: async (id, records) => { seen.records = records; return { sceneId: id, records: records.length }; },
    repaintHexTiles: async (id, hexes) => { seen.repaint = hexes; return { sceneId: id, repainted: hexes.length, removed: hexes.length }; },
  } } };
  globalThis.ui = { notifications: { info: () => {} } };

  const result = await importDatasetRecords("scene-1", { hexes: [
    { num: 1403, name: "Chimera Pride", terrain: "swamp", art: "modules/shadowdark-extras/assets/Hexes/swamp.webp" },
    { num: 1404, name: "No terrain here" },
  ] });

  assert.deepEqual(seen.repaint, [
    { num: 1403, terrain: "swamp", art: "modules/shadowdark-extras/assets/Hexes/swamp.webp" },
  ], "only hexes carrying a terrain word are repainted, and art rides along");
  assert.equal(seen.records.length, 2, "both hexes still get their words");
  assert.deepEqual(result.repaint, { sceneId: "scene-1", repainted: 1, removed: 1 });
});

test("a failed repaint still keeps the words that were already written", async () => {
  let wrote = 0;
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: {
    buildHexcrawl: async () => {},
    upsertHexRecords: async (id, r) => { wrote = r.length; return { sceneId: id, records: r.length }; },
    repaintHexTiles: async () => { throw new Error("SDX | Hexcrawl: scene not found"); },
  } } };
  let shown = "";
  globalThis.ui = { notifications: { error: (m) => { shown = m; }, info: () => {} } };

  const result = await importDatasetRecords("scene-1", { hexes: [{ num: 1403, name: "x", terrain: "swamp" }] });
  assert.equal(wrote, 1, "words are written before the repaint is attempted");
  assert.equal(result.via, "extras");
  assert.equal(result.reason, "repaint-error");
  assert.match(shown, /could not be repainted/);
});

test("an Extras without repaintHexTiles imports the words and says the art is stale", async () => {
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: {
    buildHexcrawl: async () => {},
    upsertHexRecords: async (id, r) => ({ sceneId: id, records: r.length }),
  } } };
  let warned = "";
  globalThis.ui = { notifications: { warn: (m) => { warned = m; }, info: () => {} } };

  const result = await importDatasetRecords("scene-1", { hexes: [{ num: 1403, name: "x", terrain: "swamp" }] });
  assert.equal(result.reason, "no-repaint");
  assert.match(warned, /too old to repaint/);
});

test("import is GM-only and never calls Extras", async () => {
  let calls = 0;
  globalThis.game = { user: { isGM: false }, shadowdarkExtras: { hex: {
    buildHexcrawl: async () => {}, upsertHexRecords: async () => { calls++; },
  } } };
  globalThis.ui = { notifications: { warn: () => {} } };
  assert.deepEqual(await importDatasetRecords("scene-1", { hexes: [{ num: 1, name: "x" }] }), { via: "none", reason: "not-gm" });
  assert.equal(calls, 0);
});

test("import needs a scene id and a dataset that carries something", async () => {
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: {
    buildHexcrawl: async () => {}, upsertHexRecords: async () => { throw new Error("should not be called"); },
  } } };
  globalThis.ui = { notifications: { warn: () => {} } };
  assert.deepEqual(await importDatasetRecords("", { hexes: [{ num: 1, name: "x" }] }), { via: "none", reason: "no-scene" });
  // num alone is a no-op write, so a dataset of bare numbers counts as empty.
  assert.deepEqual(await importDatasetRecords("scene-1", { hexes: [{ num: 1 }] }), { via: "none", reason: "empty" });
});

test("an older Extras without upsertHexRecords is refused, not crashed into", async () => {
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: { buildHexcrawl: async () => {} } } };
  globalThis.ui = { notifications: { warn: () => {} } };
  assert.deepEqual(await importDatasetRecords("scene-1", { hexes: [{ num: 1, name: "x" }] }), { via: "none", reason: "no-extras" });
});

test("Extras refusing a record surfaces its message instead of throwing", async () => {
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: {
    buildHexcrawl: async () => {},
    upsertHexRecords: async () => { throw new Error("SDX | Hexcrawl: hex 9999 is outside the published grid"); },
  } } };
  let shown = "";
  globalThis.ui = { notifications: { error: (m) => { shown = m; } } };
  assert.deepEqual(await importDatasetRecords("scene-1", { hexes: [{ num: 9999, name: "x" }] }), { via: "none", reason: "extras-error" });
  assert.match(shown, /outside the published grid/);
});

// ── handoffToPrint: details onto the GM's own print (#175) ───────────────────

const printDataset = {
  name: "Book", grid: { cols: 3, rows: 3, origin: 0, distance: 6, units: "mi" },
  hexes: [
    { num: 101, name: "Town", terrain: "grassland", desc: "Invented.", zone: "Vale", zoneColor: "#1e7e34", art: "Hexes/x.webp",
      features: [{ id: "settlement-101", type: "town", name: "Town", discovered: false }] },
    { num: 202, terrain: "forest", zone: "Vale" },
  ],
};
function printExtras({ adopted = true, adopt = true } = {}) {
  const calls = { adopt: [], upsert: [], repaint: 0 };
  const hex = {
    buildHexcrawl: async () => { throw new Error("must not build"); },
    upsertHexRecords: async (sceneId, records) => { calls.upsert.push({ sceneId, records }); return { sceneId, records: records.length }; },
    repaintHexTiles: async () => { calls.repaint++; return { repainted: 0 }; },
  };
  if (adopt) hex.adoptHexcrawl = async (sceneId, opts) => { calls.adopt.push({ sceneId, opts }); return { sceneId, adopted }; };
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex } };
  globalThis.ui = { notifications: { info: () => { calls.toast = true; }, warn: () => {}, error: () => {} } };
  return calls;
}

test("the print is adopted with the dataset's grid, then every hex's details land on it, unpainted", async () => {
  const calls = printExtras();
  const res = await handoffToPrint("print-1", printDataset);
  assert.deepEqual(res, { via: "extras", adopted: true, summary: { sceneId: "print-1", records: 2 }, repaint: null });
  assert.deepEqual(calls.adopt, [{ sceneId: "print-1", opts: { grid: printDataset.grid } }]);
  assert.equal(calls.repaint, 0, "nothing is painted over the print");
  assert.equal(calls.toast, undefined, "the tagger reports; the import stays quiet");
  const [town, wood] = calls.upsert[0].records;
  assert.deepEqual(town, { num: 101, name: "Town", terrain: "grassland", desc: "Invented.", zone: "Vale", zoneColor: "#1e7e34",
    features: [{ id: "settlement-101", type: "town", name: "Town", discovered: false }] }, "art stays behind; the settlement goes on the first adoption");
  assert.deepEqual(wood, { num: 202, terrain: "forest", zone: "Vale" });
});

test("a map Extras already adopted gets its records updated, and keeps the players' discoveries", async () => {
  const calls = printExtras({ adopted: false });
  const res = await handoffToPrint("print-1", printDataset);
  assert.equal(res.adopted, false);
  assert.equal(calls.upsert[0].records[0].features, undefined, "features would replace the discovery state Extras holds");
  assert.equal(calls.upsert[0].records[0].name, "Town");
});

test("an Extras that cannot adopt is named, not worked round with a new scene", async () => {
  const calls = printExtras({ adopt: false });
  assert.deepEqual(await handoffToPrint("print-1", printDataset), { via: "none", reason: "no-adopt" });
  assert.deepEqual(calls.upsert, []);
});

test("an adoption Extras refuses writes nothing and carries its reason back", async () => {
  const calls = printExtras();
  globalThis.game.shadowdarkExtras.hex.adoptHexcrawl = async () => { throw new Error("SDX | Hexcrawl: scene grid must be HEXODDQ"); };
  const res = await handoffToPrint("print-1", printDataset);
  assert.deepEqual(res, { via: "none", reason: "extras-error", error: "SDX | Hexcrawl: scene grid must be HEXODDQ" });
  assert.deepEqual(calls.upsert, []);
});

test("sending to the print is GM-only and needs Extras", async () => {
  const calls = printExtras();
  globalThis.game.user.isGM = false;
  assert.deepEqual(await handoffToPrint("print-1", printDataset), { via: "none", reason: "not-gm" });
  assert.deepEqual(calls.adopt, []);
  globalThis.game = { user: { isGM: true } };
  assert.deepEqual(await handoffToPrint("print-1", printDataset), { via: "none", reason: "no-extras" });
});
