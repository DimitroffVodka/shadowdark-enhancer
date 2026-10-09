import test from "node:test";
import assert from "node:assert/strict";
import { HexRecords, publishHexProjection, cacheHexJournal } from "../scripts/hex-map/hex-records.mjs";
import { planExplorerEdit, explorerView } from "../scripts/hex-map/hex-explorer.mjs";
import { effectiveDiscovery } from "../scripts/hex-map/hex-fog-core.mjs";

const MOD = "shadowdark-enhancer";
/** One native party A with player character pc, one hex 0_0 in the GM's store. */
function world(cell) {
  const apply = target => async data => { for (const [key, value] of Object.entries(data)) { const [, mod, flag] = key.split("."); (target.flags[mod] ??= {})[flag] = value; } };
  const journal = { id: "jc", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.c", fogImported: true, cells: { "0_0": cell } } } } };
  journal.update = apply(journal);
  cacheHexJournal(journal);
  const publicJournal = { id: "pubc", flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.c", cells: {} } } } };
  publicJournal.update = apply(publicJournal);
  const scene = { id: "c", uuid: "Scene.c", flags: { [MOD]: { hexFog: { enabled: true }, hexRecords: { adopted: true } } }, getFlag: (mod, key) => scene.flags[mod]?.[key] };
  const pc = { id: "pc", uuid: "Actor.pc", type: "Player", isOwner: false };
  const A = { id: "A", uuid: "Actor.A", type: "NPC", name: "A", flags: { [MOD]: { party: true, partyData: { members: ["Actor.pc"] } } }, testUserPermission: () => true };
  const actors = [A, pc];
  globalThis._replace = value => value;
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: actors, get: id => actors.find(a => a.id === id) ?? null },
    journal: { contents: [publicJournal] }, packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" } }) },
    modules: { get: () => undefined }, settings: { get: () => { throw new Error("not registered"); } }, i18n: { localize: key => key, format: key => key } };
  return { journal, publicJournal, scene, pc, stored: () => journal.flags[MOD].hexRecords.cells["0_0"] };
}
const lair = () => ({ title: "Dragon lair", terrain: "forest", links: [{ uuid: "JournalEntry.k", label: "Lair key", visible: true }], discovery: { revealed: true, visited: true } });
/** The Hexplorer save sequence: plan for the viewed party, merge into the store, publish. */
async function save(w, input) {
  const record = HexRecords.read({ i: 0, j: 0 }, w.scene);
  const plan = planExplorerEdit(record, { terrain: "forest", revealed: true, visited: true, location: "auto", ...input }, null, "A");
  w.journal.flags[MOD].hexRecords.cells["0_0"] = { ...w.stored(), discovery: plan.patch.discovery };
  await publishHexProjection(w.scene);
}
function asPlayer(w, fn) {
  w.pc.isOwner = true; globalThis.game.user = { id: "p1", isGM: false };
  try { return fn(); } finally { w.pc.isOwner = false; globalThis.game.user = { id: "gm", isGM: true }; }
}
async function inWorld(cell, body) {
  const saved = { game: globalThis.game, replace: globalThis._replace };
  try { await body(world(cell)); } finally {
    globalThis._replace = saved.replace;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
}

test("hiding the location of a hex everyone knows hides it from the party's players too", () => inWorld(lair(), async w => {
  await save(w, { location: "hide" });
  assert.equal(effectiveDiscovery(w.stored().discovery, ["A"]).locationRevealed, false);
  const seen = asPlayer(w, () => HexRecords.read({ i: 0, j: 0 }, w.scene));
  assert.ok(seen, "the terrain stays known");
  assert.equal(seen.title, undefined);
  assert.equal(seen.links, undefined);
}));
test("unticking Revealed on a hex everyone knows takes it off the party's players' map", () => inWorld(lair(), async w => {
  await save(w, { revealed: false, visited: false });
  assert.equal(asPlayer(w, () => HexRecords.read({ i: 0, j: 0 }, w.scene)), null);
}));
test("a hex the party has not touched still reads from what everyone knows, and is not stored twice", () => inWorld(lair(), async w => {
  await save(w, { location: "auto" });
  const seen = asPlayer(w, () => HexRecords.read({ i: 0, j: 0 }, w.scene));
  assert.equal(seen.title, "Dragon lair");
  assert.deepEqual(w.publicJournal.flags[MOD].hexRecordProjection.parties.A.cells, {});
}));
test("a player in no party still sees what everyone knows", () => inWorld(lair(), async w => {
  await publishHexProjection(w.scene);
  w.publicJournal.flags[MOD].hexRecordProjection.parties.B = { members: [], cells: {} };
  w.publicJournal.flags[MOD].hexRecordProjection.parties.A.members = [];
  assert.equal(asPlayer(w, () => HexRecords.read({ i: 0, j: 0 }, w.scene)).title, "Dragon lair");
}));
test("the GM's hover card shows the title of a hex only the viewed party has visited", () => inWorld(
  { title: "Old Mill", terrain: "forest", notes: [{ text: "A wheel", visible: true }], discovery: { by: { A: { revealed: true, visited: true } } } }, async w => {
    const record = HexRecords.read({ i: 0, j: 0 }, w.scene);
    assert.equal(explorerView(record, true), null, "viewing no party: nothing is known to everyone");
    const view = explorerView(record, true, ["A"]);
    assert.equal(view.title, "Old Mill");
    assert.deepEqual(view.notes, [{ text: "A wheel" }]);
  }));
