import test from "node:test";
import assert from "node:assert/strict";
import {
  folderChain, adventureData, removalPlan, createOnly, createdSince, ADVENTURE_PACK_FLAG,
  reuseWorldActors, importMissingOnly, onPreImportAdventure, removeStaged, worldSnapshot,
} from "../scripts/importer/adventure/adventure-pack.mjs";
import { SUITE_PACKS } from "../scripts/shared/compendium-suite.mjs";
import { bookFolderId } from "../scripts/importer/world-folders.mjs";

// Invented data throughout.

const folders = new Map([
  ["root", { id: "root", folder: null }],
  ["mid", { id: "mid", folder: "root" }],
  ["leaf", { id: "leaf", folder: "mid" }],
  ["other", { id: "other", folder: null }],
]);

test("folderChain: parents come first, each folder once, unknown ids dropped", () => {
  assert.deepEqual(folderChain(["leaf", "mid", null, "gone"], folders), ["root", "mid", "leaf"]);
  assert.deepEqual(folderChain(["leaf", "other"], folders), ["root", "mid", "leaf", "other"]);
  assert.deepEqual(folderChain([], folders), []);
});

test("adventureData: one scene, the journal when there is one, flagged with its site", () => {
  const d = adventureData({ name: "Test Keep", site: "s1", scene: { _id: "S" }, journal: { _id: "J" }, actors: [{ _id: "A" }], folders: [{ _id: "F" }] });
  assert.deepEqual(d.scenes, [{ _id: "S" }]);
  assert.deepEqual(d.journal, [{ _id: "J" }]);
  assert.deepEqual(d.flags["shadowdark-enhancer"][ADVENTURE_PACK_FLAG], { site: "s1" });
  assert.equal(d.img, undefined);
  assert.deepEqual(adventureData({ name: "T", site: "s", scene: {} }).journal, []);
  assert.equal(adventureData({ name: "T", site: "s", scene: {}, img: "a.webp" }).img, "a.webp");
});

const staged = { scene: "S1", journal: "J1", actors: ["a1", "a2", "a3"] };
const noOtherScenes = new Map([["S1", new Set(["a1", "a2", "a3"])]]);

test("removalPlan: deletes what the run made and nothing it did not", () => {
  const plan = removalPlan(staged, { scene: true, journal: true, actors: ["a1", "a3"] }, { sceneActors: noOtherScenes });
  assert.equal(plan.scene, "S1");
  assert.equal(plan.journal, "J1");
  assert.deepEqual(plan.actors, ["a1", "a3"]);     // a2 was in the world before the run
  assert.equal("folders" in plan, false); // folders always stay: the next adventure of the book files into them
});

test("removalPlan: a run that made nothing deletes nothing", () => {
  const plan = removalPlan(staged, {}, { sceneActors: noOtherScenes });
  assert.deepEqual(plan, { scene: null, journal: null, actors: [], kept: [] });
});

test("removalPlan: an actor another scene still has a token for is kept", () => {
  const scenes = new Map([["S1", new Set(["a1", "a2"])], ["S2", new Set(["a2"])]]);
  const plan = removalPlan(staged, { scene: true, actors: ["a1", "a2"] }, { sceneActors: scenes });
  assert.deepEqual(plan.actors, ["a1"]);
  assert.deepEqual(plan.kept, ["a2"]);
});

test("the Adventures pack is in the suite, as a new pack of its own", () => {
  const d = SUITE_PACKS.find((p) => p.key === "adventures");
  assert.equal(d.type, "Adventure");
  assert.equal(d.id, "sde-adventures");
  // The packs that already exist keep their ids: worlds hold references to them.
  for (const id of ["sde-actors", "sde-items", "sde-tables", "sde-journal", "sde-scenes"]) assert.ok(SUITE_PACKS.some((p) => p.id === id), id);
});

test("createOnly: nothing already in the world is updated, and the count follows", () => {
  const data = { toCreate: { Scene: [{}], JournalEntry: [{}, {}] }, toUpdate: { Actor: [{}, {}], Folder: [{}] }, documentCount: 6 };
  const kept = createOnly(data);
  assert.deepEqual(data.toUpdate, {});
  assert.equal(data.documentCount, 3);
  assert.deepEqual(kept, { Actor: 2, Folder: 1 });
  const none = { toCreate: {}, toUpdate: {}, documentCount: 0 };
  assert.deepEqual(createOnly(none), {});
  assert.equal(none.documentCount, 0);
});

test("createdSince: only what was not in the world before the build", () => {
  const before = { journals: new Set(["J-old"]), actors: new Set(["a-old"]) };
  const staged = { scene: "S", journal: "J-new", actors: ["a-old", "a-new"] };
  assert.deepEqual(createdSince(before, staged), { scene: true, journal: true, actors: ["a-new"] });
  // A journal the world already had (deployed by an earlier run) is not the run's to delete.
  assert.equal(createdSince(before, { ...staged, journal: "J-old" }).journal, false);
  assert.equal(createdSince(before, { ...staged, journal: null }).journal, false);
});

// ---- the Import button on the Adventure's own sheet (#429 review) ----

const overwrites = () => ({
  toCreate: { Scene: [{ _id: "S", tokens: [{ actorId: "packed-goblin" }, { actorId: "orc" }] }], Actor: [{ _id: "packed-goblin", name: "Goblin", type: "NPC" }, { _id: "orc", name: "Orc", type: "NPC" }] },
  toUpdate: { Actor: [{ _id: "kept", name: "Troll" }], Folder: [{ _id: "f" }] },
  documentCount: 5,
});
const packedAdventure = { getFlag: (scope, key) => (scope === "shadowdark-enhancer" && key === ADVENTURE_PACK_FLAG ? { site: "s" } : undefined) };

test("preImportAdventure: the sheet's Import (no preImport of its own) never overwrites a packed adventure's documents", async () => {
  const options = { dialog: true, preImport: [] };      // what Adventure#import hands the hook for the sheet's call
  assert.equal(onPreImportAdventure(packedAdventure, options), undefined, "does not veto the import");
  const data = overwrites();
  for (const fn of options.preImport) await fn(data, options);   // Adventure#import runs these before the overwrite dialog
  assert.deepEqual(data.toUpdate, {}, "nothing to overwrite, so no overwrite warning either");
});

test("preImportAdventure: another module's Adventure is left to Foundry", () => {
  const options = { preImport: [] };
  onPreImportAdventure({ getFlag: () => undefined }, options);
  assert.deepEqual(options.preImport, []);
});

test("reuseWorldActors: a creature the world has by name is not made twice, and the packed tokens follow it", () => {
  const data = overwrites();
  reuseWorldActors(data, [{ id: "world-goblin", name: "Goblin", type: "NPC" }, { id: "x", name: "Orc", type: "Player" }]);
  assert.deepEqual(data.toCreate.Actor.map((a) => a._id), ["orc"]);   // the Orc in the world is a different type
  assert.deepEqual(data.toCreate.Scene[0].tokens.map((t) => t.actorId), ["world-goblin", "orc"]);
  assert.equal(data.documentCount, 4);
  const all = { toCreate: { Actor: [{ _id: "p", name: "Goblin", type: "NPC" }] }, toUpdate: {}, documentCount: 1 };
  reuseWorldActors(all, [{ id: "w", name: "Goblin", type: "NPC" }]);
  assert.deepEqual(all.toCreate, {});
});

test("importMissingOnly: reuses, then creates only", () => {
  const data = overwrites();
  const kept = importMissingOnly(data, [{ id: "world-goblin", name: "Goblin", type: "NPC" }]);
  assert.deepEqual(kept, { Actor: 1, Folder: 1 });
  assert.equal(data.documentCount, 2);   // the Scene and the Orc
});

// ---- two adventures of one book (#417 x #429) ----

class Coll extends Array {
  get(id) { return this.find((d) => d.id === id); }
  has(id) { return !!this.get(id); }
}

test("two adventures of one book packed to the compendium leave one folder per type, and importing both back makes no more", async () => {
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const world = { folders: new Coll(), actors: new Coll(), scenes: new Coll(), journal: new Coll() };
  const add = (coll, doc) => { const d = { ...doc, delete: async () => { coll.splice(coll.indexOf(d), 1); } }; coll.push(d); return d; };
  const had = { game: globalThis.game, Folder: globalThis.Folder };
  globalThis.game = { user: { isGM: true }, ...world };
  globalThis.Folder = { create: async (d) => add(world.folders, { id: id("F"), folder: null, ...d }) };
  try {
    const packed = [];
    for (const [site, creatures] of [["cs2-iron-fortress", ["Goblin", "Orc"]], ["cs2-mines", ["Goblin", "Troll"]]]) {
      const before = worldSnapshot();
      // What the build makes: the book's folders and the documents in them.
      const af = await bookFolderId("Actor", site);
      const sf = await bookFolderId("Scene", site);
      const jf = await bookFolderId("JournalEntry", site);
      const actors = creatures.map((name) => add(world.actors, { id: id("A"), name, type: "NPC", folder: af }));
      const scene = add(world.scenes, { id: id("S"), folder: sf, tokens: [] });
      const journal = add(world.journal, { id: id("J"), folder: jf });
      const byId = new Map(world.folders.map((f) => [f.id, { id: f.id, folder: f.folder }]));
      const folderIds = folderChain([af, sf, jf], byId);
      packed.push(adventureData({ name: site, site, scene: { _id: scene.id }, journal: { _id: journal.id }, actors: actors.map((a) => ({ _id: a.id })), folders: folderIds.map((f) => ({ _id: f })) }));
      const staged = { scene: scene.id, journal: journal.id, actors: actors.map((a) => a.id) };
      await removeStaged(staged, createdSince(before, staged));
    }
    assert.equal(world.actors.length + world.scenes.length + world.journal.length, 0, "the world copies are gone");
    // Foundry's Adventure#prepareImport: what is not in the world yet is created, with the packed id.
    for (const a of packed) for (const f of a.folders) if (!world.folders.has(f._id)) add(world.folders, { id: f._id, folder: null });
    for (const type of ["Actor", "Scene", "JournalEntry"]) assert.equal(world.folders.filter((f) => f.type === type).length, 1, type);
    assert.deepEqual(packed[0].folders.map((f) => f._id).sort(), packed[1].folders.map((f) => f._id).sort(), "both adventures carry the same folders");
  } finally {
    globalThis.game = had.game;
    globalThis.Folder = had.Folder;
  }
});
