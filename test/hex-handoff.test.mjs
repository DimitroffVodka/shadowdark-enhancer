import test from "node:test";
import assert from "node:assert/strict";
import { extrasHexApi, extrasFeaturesOn, extrasHexRecords, handoffDataset, handoffToPrint, importDatasetRecords, SETTLEMENTS_SENT_FLAG } from "../scripts/importer/hex/hex-handoff.mjs";

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
// The print as a Foundry scene: getFlag, and update() understanding the
// `-=key` deletion replaceModuleFlag writes before the new value.
function printScene(flags = {}) {
  const scene = {
    id: "print-1", flags: { "shadowdark-enhancer": { ...flags } },
    getFlag: (scope, key) => scene.flags[scope]?.[key],
    async update(diff) {
      for (const [path, value] of Object.entries(diff)) {
        const [, scope, key] = path.split(".");
        scene.flags[scope] ??= {};
        if (key.startsWith("-=")) delete scene.flags[scope][key.slice(2)];
        else scene.flags[scope][key] = value;
      }
    },
  };
  return scene;
}
// Extras as the print sees it. Its hex store is the `hexData` flag on the
// `__sdx_hex_data__` journal, one object per scene, a record per Foundry offset
// `${i}_${j}` = published {row - base}_{col - base} (#196). upsertHexRecords
// merges each patch over the record, a `features` list replacing the old one,
// which is exactly why the hand-off has to read before it writes.
function printExtras({ adopted = true, adopt = true, scene = printScene(), base = 0 } = {}) {
  const calls = { adopt: [], upsert: [], repaint: 0, scene, hexData: {} };
  const hex = {
    buildHexcrawl: async () => { throw new Error("must not build"); },
    upsertHexRecords: async (sceneId, records) => {
      calls.upsert.push({ sceneId, records });
      const stored = (calls.hexData[sceneId] ??= {});
      for (const { num, ...patch } of records) {
        const key = `${num % 100 - base}_${Math.floor(num / 100) - base}`;
        stored[key] = { ...(stored[key] ?? { features: [] }), ...patch };
      }
      return { sceneId, records: records.length };
    },
    repaintHexTiles: async () => { calls.repaint++; return { repainted: 0 }; },
  };
  if (adopt) hex.adoptHexcrawl = async (sceneId, opts) => { calls.adopt.push({ sceneId, opts }); return { sceneId, adopted }; };
  const journal = { getFlag: (scope, key) => (scope === "shadowdark-extras" && key === "hexData" ? calls.hexData : undefined) };
  globalThis.game = {
    user: { isGM: true }, shadowdarkExtras: { hex },
    scenes: { get: (id) => (id === scene.id ? scene : undefined) },
    journal: { getName: (name) => (name === "__sdx_hex_data__" ? journal : undefined) },
  };
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
  assert.equal(calls.scene.getFlag("shadowdark-enhancer", SETTLEMENTS_SENT_FLAG), true, "the settlements are marked delivered");
});

test("once the settlements are in, a re-send updates the records and keeps the players' discoveries", async () => {
  const calls = printExtras({ adopted: false, scene: printScene({ [SETTLEMENTS_SENT_FLAG]: true }) });
  calls.hexData["print-1"] = { "1_1": { name: "101. Town", features: [{ id: "settlement-101", type: "town", name: "Town", discovered: true }] } };
  const res = await handoffToPrint("print-1", printDataset);
  assert.equal(res.adopted, false);
  assert.equal(calls.upsert[0].records[0].features, undefined, "nothing to change, so the list Extras holds is not touched");
  assert.equal(calls.upsert[0].records[0].name, "Town");
  assert.equal(calls.hexData["print-1"]["1_1"].features[0].discovered, true, "the players' discovery survives");
  assert.equal(res.featuresUnread, undefined);
});

test("a first send whose record write failed delivers the settlements once Extras holds the records", async () => {
  const calls = printExtras();
  const hex = globalThis.game.shadowdarkExtras.hex;
  const upsert = hex.upsertHexRecords;
  hex.upsertHexRecords = async () => { throw new Error("storage failed"); };
  assert.equal((await handoffToPrint("print-1", printDataset)).reason, "extras-error");
  assert.equal(calls.scene.getFlag("shadowdark-enhancer", SETTLEMENTS_SENT_FLAG), undefined, "nothing was delivered");
  hex.upsertHexRecords = upsert;
  hex.adoptHexcrawl = async (sceneId) => ({ sceneId, adopted: false }); // the layout from the first try stayed
  // The retry is not a fresh adoption and Extras holds nothing for the map, so
  // nothing says what it holds: the details go, the features wait.
  const retry = await handoffToPrint("print-1", printDataset);
  assert.equal(retry.featuresUnread, true);
  assert.equal("features" in calls.upsert[0].records[0], false);
  assert.equal(calls.scene.getFlag("shadowdark-enhancer", SETTLEMENTS_SENT_FLAG), undefined);
  // The records are in now, so the next send can read them and carries the settlements.
  const next = await handoffToPrint("print-1", printDataset);
  assert.equal(next.featuresUnread, undefined);
  assert.equal(calls.upsert[1].records[0].features?.[0]?.id, "settlement-101");
  assert.equal(calls.scene.getFlag("shadowdark-enhancer", SETTLEMENTS_SENT_FLAG), true);
});

test("a send without the crawl's settlements does not mark them delivered", async () => {
  const calls = printExtras();
  const bare = { ...printDataset, hexes: printDataset.hexes.map((hex) => { const copy = { ...hex }; delete copy.features; return copy; }) };
  await handoffToPrint("print-1", bare);
  assert.equal(calls.scene.getFlag("shadowdark-enhancer", SETTLEMENTS_SENT_FLAG), undefined, "a later send with the keyed pages must still carry them");
});

test("extrasHexRecords reads Extras' store back by published number; extrasFeaturesOn trusts an empty one only when fresh", () => {
  const calls = printExtras();
  calls.hexData["print-1"] = { "1_1": { features: [{ id: "a" }] }, "3_2": { features: [] }, "0_0": { name: "no features" } };
  assert.deepEqual(Object.keys(extrasHexRecords("print-1", 0)), ["0", "101", "203"]);
  assert.deepEqual([...extrasFeaturesOn("print-1", 0)], [[101, [{ id: "a" }]], [203, []]]);
  assert.deepEqual([...extrasFeaturesOn("print-1", 1)].map(([num]) => num), [202, 304], "a map numbered from 1 shifts by one");
  delete calls.hexData["print-1"];
  assert.equal(extrasHexRecords("print-1", 0), null, "no records for the scene");
  assert.equal(extrasFeaturesOn("print-1", 0), null, "which could mean the store moved: send no features");
  assert.deepEqual([...extrasFeaturesOn("print-1", 0, { fresh: true })], [], "right after a fresh adoption it can only mean none yet");
  globalThis.game.journal = undefined;
  assert.equal(extrasFeaturesOn("print-1", 0), null, "no journal at all: the same");
});

test("a re-send merges river, path and coast into what Extras holds, and keeps the rest (#196)", async () => {
  const calls = printExtras({ adopted: false, scene: printScene({ [SETTLEMENTS_SENT_FLAG]: true }) });
  calls.hexData["print-1"] = { "1_1": { features: [
    { id: "settlement-101", type: "town", name: "Town", discovered: true },
    { id: "gm-dungeon", type: "dungeon", name: "Barrow", discovered: false },
    { id: "path-101", type: "path", name: "", discovered: true },
  ] } };
  const dataset = { ...printDataset, hexes: [
    { ...printDataset.hexes[0], features: [
      { id: "settlement-101", type: "town", name: "Town", discovered: false },
      { id: "river-101", type: "river", name: "", discovered: true },
      { id: "coast-101", type: "coast", name: "", discovered: true },
    ] },
    printDataset.hexes[1],
  ] };
  await handoffToPrint("print-1", dataset);
  const [town, wood] = calls.upsert[0].records;
  assert.deepEqual(town.features.map((f) => f.id), ["settlement-101", "gm-dungeon", "river-101", "coast-101"],
    "the path taken off the tag goes, river and coast arrive, no id twice");
  assert.equal(town.features[0].discovered, true, "the players' discovery survives");
  assert.equal("features" in wood, false, "a hex whose features would not change sends none");
  // Sending the same again changes nothing and duplicates nothing.
  await handoffToPrint("print-1", dataset);
  assert.equal("features" in calls.upsert[1].records[0], false);
  assert.deepEqual(calls.hexData["print-1"]["1_1"].features.map((f) => f.id), ["settlement-101", "gm-dungeon", "river-101", "coast-101"]);
});

test("the same tags give the same records on every send: a second and third send change nothing", async () => {
  const calls = printExtras();
  const dataset = { ...printDataset, hexes: [
    ...printDataset.hexes,
    { num: 303, terrain: "grassland", features: [   // a river mouth on land, as buildHexDataset now reads it
      { id: "settlement-303", type: "city_state", name: "Port", discovered: false },
      { id: "river-303", type: "river", name: "", discovered: true },
      { id: "coast-303", type: "coast", name: "", discovered: true },
    ] },
  ] };
  await handoffToPrint("print-1", dataset);
  const first = structuredClone(calls.hexData);
  globalThis.game.shadowdarkExtras.hex.adoptHexcrawl = async (sceneId) => ({ sceneId, adopted: false });
  await handoffToPrint("print-1", dataset);
  assert.deepEqual(calls.hexData, first, "send 2 leaves every record as send 1 left it");
  assert.equal(calls.upsert[1].records.some((r) => "features" in r), false, "and writes no features list at all");
  await handoffToPrint("print-1", dataset);
  assert.deepEqual(calls.hexData, first, "and so does send 3");
  assert.equal(first["print-1"]["3_3"].terrain, "grassland");
  assert.deepEqual(first["print-1"]["3_3"].features.map((f) => f.id), ["settlement-303", "river-303", "coast-303"]);
});

test("a missing store on a send that did not just adopt sends no features, and says so", async () => {
  // The review's case: if Extras moved its store, reading it as empty would send
  // each hex's river alone, and Extras would drop the settlement and the GM's
  // features beside it.
  const calls = printExtras({ adopted: false, scene: printScene({ [SETTLEMENTS_SENT_FLAG]: true }) });
  globalThis.game.journal = { getName: () => undefined };
  const dataset = { ...printDataset, hexes: [{ num: 202, terrain: "forest", features: [{ id: "river-202", type: "river", name: "", discovered: true }] }] };
  const res = await handoffToPrint("print-1", dataset);
  assert.equal(res.featuresUnread, true);
  assert.deepEqual(calls.upsert[0].records, [{ num: 202, terrain: "forest" }], "the details still go");
});

test("a hex whose tags were cleared loses its river, path and coast in Extras, and nothing else", async () => {
  const calls = printExtras({ adopted: false, scene: printScene({ [SETTLEMENTS_SENT_FLAG]: true }) });
  calls.hexData["print-1"] = {
    "3_3": { features: [{ id: "river-303", type: "river", name: "", discovered: true }, { id: "gm-dungeon", type: "dungeon", name: "Barrow", discovered: false }] },
    "4_4": { features: [{ id: "gm-cave", type: "cave", name: "Cave", discovered: false }] },
  };
  await handoffToPrint("print-1", printDataset);
  const records = calls.upsert[0].records;
  assert.deepEqual(records.find((r) => r.num === 303), { num: 303, features: [{ id: "gm-dungeon", type: "dungeon", name: "Barrow", discovered: false }] });
  assert.equal(records.some((r) => r.num === 404), false, "a hex with none of ours is not written");
});

test("an unreadable Extras store sends no features at all rather than wiping them", async () => {
  const calls = printExtras();
  globalThis.game.journal = { getName: () => ({ getFlag: () => { throw new Error("scope not active"); } }) };
  const warn = console.warn; console.warn = () => {};
  let res;
  try { res = await handoffToPrint("print-1", printDataset); } finally { console.warn = warn; }
  assert.equal(res.featuresUnread, true);
  assert.equal("features" in calls.upsert[0].records[0], false);
  assert.equal(calls.scene.getFlag("shadowdark-enhancer", SETTLEMENTS_SENT_FLAG), undefined, "nothing delivered, nothing marked");
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
