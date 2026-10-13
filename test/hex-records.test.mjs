import test from "node:test";
import assert from "node:assert/strict";
import { recordView, playerProjection, HexRecords, loadHexRecords } from "../scripts/hex-map/hex-records.mjs";
const base = { sceneUuid: "Scene.a", offset: { i: -2, j: 3 }, num: 101 };
test("facade reads terrain/features/provenance from existing tags, not archived legacy", () => {
  const r = recordView({ ...base, cell: { title: "Ford", terrain: "river", features: [{ type: "river", id: "old" }, { type: "dungeon", id: "cave" }], legacy: { terrain: "lake" } }, tag: { terrain: "forest", features: ["path"], source: "auto", margin: 1.42, review: true } });
  assert.equal(r.terrain, "forest");
  assert.deepEqual(r.features.map(f => f.type), ["dungeon", "path"]);
  assert.deepEqual(r.provenance, { source: "auto", margin: 1.42, review: true });
  assert.equal(r.sceneUuid, "Scene.a");
  assert.deepEqual(r.offset, base.offset);
});
test("projection never carries unknown fields, GM notes, unvisited keyed content or feature extras", () => {
  const r = { ...base, terrain: "forest", title: "Secret dungeon", notes: [{ id: "public", text: "Bridge", visible: true, private: "secret" }, { text: "GM" }], features: [{ id: "river", type: "river", discovered: true, secret: "hide" }, { id: "cave", type: "dungeon", name: "Cave", discovered: true }], links: [{ uuid: "JournalEntry.a", label: "Clue", visible: true, secret: "hide" }], legacy: { secret: true }, discovery: { revealed: false, visited: false } };
  assert.equal(playerProjection(r), null);
  r.discovery.revealed = true;
  let p = playerProjection(r);
  assert.equal(p.title, undefined);
  assert.deepEqual(p.features, [{ id: "river", type: "river" }]);
  assert.deepEqual(p.notes, [{ id: "public", text: "Bridge" }]);
  assert.equal(p.links, undefined);
  r.discovery.visited = true;
  p = playerProjection(r);
  assert.equal(p.title, "Secret dungeon");
  assert.deepEqual(p.links, [{ uuid: "JournalEntry.a", label: "Clue" }]);
  assert.equal(JSON.stringify(p).includes("secret"), false);
});
test("explicitly hidden keyed location stays hidden after a visit", () => {
  const p = playerProjection({ ...base, title: "Secret", features: [{ type: "dungeon", discovered: true }], discovery: { revealed: true, visited: true, locationRevealed: false } });
  assert.equal(p.title, undefined);
  assert.deepEqual(p.features, []);
});
test("player facade applies effective location disclosure to readable pinned pages", () => {
  const oldGame = globalThis.game;
  const page = { uuid: "JournalEntry.public.JournalEntryPage.location", name: "Keyed location", testUserPermission: () => true };
  const entry = { pages: { get: id => id === "location" ? page : null }, testUserPermission: () => true };
  const scene = { id: "a", uuid: base.sceneUuid, notes: { contents: [{ entryId: "public", pageId: "location", getFlag: () => ({ num: 101 }) }] } };
  const cells = {};
  const projectionJournal = { flags: { "shadowdark-enhancer": { hexRecordProjection: { sceneUuid: base.sceneUuid, cells } } } };
  globalThis.game = { user: { isGM: false }, journal: { contents: [projectionJournal], get: id => id === "public" ? entry : null } };
  try {
    for (const [discovery, visible] of [
      [{ revealed: true, visited: false }, false],
      [{ revealed: true, visited: true }, true],
      [{ revealed: true, visited: true, locationRevealed: false }, false],
      [{ revealed: true, visited: false, locationRevealed: true }, true],
      [{ revealed: true, visited: true, locationRevealed: false }, false],
    ]) {
      cells["-2_3"] = playerProjection({ ...base, title: page.name, discovery });
      const read = HexRecords.read(base.offset, scene);
      assert.equal(read.title, visible ? page.name : undefined);
      assert.deepEqual(read.keyed ?? [], visible ? [{ uuid: page.uuid, title: page.name }] : []);
      assert.equal(read.discovery.locationRevealed ?? !!read.discovery.visited, visible);
    }
  } finally {
    if (oldGame === undefined) delete globalThis.game;
    else globalThis.game = oldGame;
  }
});
test("a keyed hex with no typed title is named by its journal page, without the printed number", () => {
  const keyed = [{ uuid: "JournalEntry.a.JournalEntryPage.p", title: "3826 Haldrin's Tower" }];
  assert.equal(recordView({ ...base, cell: {}, keyed }).title, "Haldrin's Tower");
  assert.equal(recordView({ ...base, cell: { title: "My name" }, keyed }).title, "My name", "a typed title wins");
  assert.equal(recordView({ ...base, cell: {}, keyed: [] }).title, undefined, "no page, no invented title");
  assert.deepEqual(recordView({ ...base, cell: {}, keyed }).keyed, keyed);
});
test("private store reads are GM only; same offset in different scenes never shares data", async () => {
  const journals = ["a", "b"].map(id => ({ id, flags: { "shadowdark-enhancer": { hexRecords: { version: 1, sceneUuid: `Scene.${id}`, cells: { "-2_3": { title: id, terrain: "Forest", discovery: { revealed: true, visited: true } } } } } } }));
  const scene = id => ({ id, uuid: `Scene.${id}`, getFlag: () => null });
  globalThis.game = { user: { isGM: true }, journal: { contents: [] }, packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => journals }) } };
  await loadHexRecords();
  assert.equal(HexRecords.read(base.offset, scene("a")).title, "a");
  assert.equal(HexRecords.read(base.offset, scene("b")).title, "b");
  globalThis.game.user.isGM = false;
  assert.equal(HexRecords.read(base.offset, scene("a")), null);
  delete globalThis.game;
});
test("raw cell writes refuse archive and history fields but keep the editable set", async () => {
  const scene = { id: "s", uuid: "Scene.s", grid: { isHexagonal: false } };
  const oldGame = globalThis.game;
  globalThis.game = { user: { isGM: true }, journal: { contents: [] } };
  try {
    for (const patch of [{ legacy: {} }, { arrivalRolled: true }, { discovery: { revealed: false } }, { unknownField: 1 }]) {
      await assert.rejects(HexRecords.write({ i: 0, j: -1 }, patch, scene), /protectedField/);
    }
    await assert.rejects(HexRecords.write({ i: 0, j: -1 }, { title: "New" }, scene), /unreadable/, "an editable patch passes validation and stops where the store is missing");
  } finally {
    if (oldGame === undefined) delete globalThis.game; else globalThis.game = oldGame;
  }
});
test("publishing the players' view decodes the map's tags once, not once a recorded hex (a second a walked hex)", async () => {
  const { publishHexProjection, cacheHexJournal } = await import("../scripts/hex-map/hex-records.mjs");
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, replace: globalThis._replace };
  let decoded = 0, published = null;
  const tags = { origin: null, get cells() { decoded += 1; return {}; } };
  const scene = { id: "pub", uuid: "Scene.pub", getFlag: (mod, key) => (mod === MOD && key === "hexTags" ? tags : undefined) };
  const cells = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`${n}_0`, { discovery: { revealed: true } }]));
  cacheHexJournal({ id: "jpub", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.pub", cells } } } });
  const publicJournal = { flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.pub", cells: {} } } }, update: async (data) => { published = data; } };
  globalThis._replace = (value) => value;
  globalThis.game = { user: { isGM: true }, journal: { contents: [publicJournal], get: () => null },
    packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" } }) } };
  try {
    await publishHexProjection(scene);
    assert.ok(published, "the view is written");
    assert.equal(decoded, 1);
  } finally {
    globalThis._replace = saved.replace;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
});
test("a store the pack re-seated is read and published from the seated copy, not the one loaded first", async () => {
  const { publishHexProjection } = await import("../scripts/hex-map/hex-records.mjs");
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, replace: globalThis._replace };
  const store = revealed => ({ id: "jseat", ownership: { default: 0 }, update: async () => {},
    flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.seat", cells: { "1_1": { discovery: { revealed, visited: false } } } } } } });
  const loaded = store(false), seated = store(true), held = new Map();
  let published = null;
  const publicJournal = { flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.seat", cells: {} } } }, update: async data => { published = data; } };
  // getDocuments() answers with copies; the pack applies updates to the one it holds, and drops it when idle.
  const pack = { ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [loaded], get: id => held.get(id) };
  globalThis._replace = value => value;
  globalThis.game = { user: { isGM: true }, journal: { contents: [publicJournal], get: () => null }, packs: { get: () => pack } };
  const scene = { id: "seat", uuid: "Scene.seat", getFlag: () => null };
  const revealed = () => HexRecords.read({ i: 1, j: 1 }, scene).discovery.revealed;
  try {
    await loadHexRecords();
    assert.equal(revealed(), false, "until the pack holds a copy, the loaded one answers");
    held.set("jseat", seated);
    assert.equal(revealed(), true, "an update landed on the pack's copy: reads follow it");
    held.clear();
    assert.equal(revealed(), true, "once the pack drops it, the last copy it held answers, not the first one loaded");
    await publishHexProjection(scene);
    assert.ok(published["flags.shadowdark-enhancer.hexRecordProjection"].cells["1_1"], "players are shown the revealed hex");
  } finally {
    globalThis._replace = saved.replace;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
});
test("a write is based on the pack's held copy, so one reveal does not erase the others", async () => {
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, replace: globalThis._replace };
  const landed = [];
  const store = (name, keys) => ({ id: "jwrite", ownership: { default: 0 }, update: async data => { landed.push({ name, cells: Object.keys(data[`flags.${MOD}.hexRecords`].cells) }); },
    flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.write", cells: Object.fromEntries(keys.map(k => [k, { discovery: { revealed: true, visited: false } }])) } } } });
  const loaded = store("loaded", ["0_0"]), seated = store("seated", ["0_0", "0_1", "0_2"]), held = new Map();
  const publicJournal = { flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.write", cells: {} } } }, update: async () => {} };
  const pack = { ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [loaded], get: id => held.get(id) };
  globalThis._replace = value => value;
  globalThis.game = { user: { isGM: true }, journal: { contents: [publicJournal], get: () => null }, packs: { get: () => pack } };
  const scene = { id: "write", uuid: "Scene.write", grid: { isHexagonal: false }, getFlag: () => null };
  try {
    await loadHexRecords();
    held.set("jwrite", seated);
    await HexRecords.write({ i: 5, j: 0 }, { title: "New" }, scene);
    assert.deepEqual(landed.at(-1), { name: "seated", cells: ["0_0", "0_1", "0_2", "5_0"] }, "the update lands on the pack's copy and keeps every cell it holds");
    held.clear();
    await HexRecords.write({ i: 6, j: 0 }, { title: "Next" }, scene);
    assert.deepEqual(landed.at(-1), { name: "seated", cells: ["0_0", "0_1", "0_2", "6_0"] }, "once the pack drops it, the last held copy is the baseline, not the one loaded first");
  } finally {
    globalThis._replace = saved.replace;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
});
