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
