import test from "node:test";
import assert from "node:assert/strict";
import { folderChain, adventureData, removalPlan, createOnly, createdSince, ADVENTURE_PACK_FLAG } from "../scripts/importer/adventure/adventure-pack.mjs";
import { SUITE_PACKS } from "../scripts/shared/compendium-suite.mjs";

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

const staged = { scene: "S1", journal: "J1", actors: ["a1", "a2", "a3"], folders: ["root", "mid", "leaf"] };
const noOtherScenes = new Map([["S1", new Set(["a1", "a2", "a3"])]]);

test("removalPlan: deletes what the run made and nothing it did not", () => {
  const plan = removalPlan(staged, { scene: true, journal: true, actors: ["a1", "a3"], folders: ["leaf", "mid"] }, { sceneActors: noOtherScenes });
  assert.equal(plan.scene, "S1");
  assert.equal(plan.journal, "J1");
  assert.deepEqual(plan.actors, ["a1", "a3"]);     // a2 was in the world before the run
  assert.deepEqual(plan.folders, ["leaf", "mid"]); // deepest first; root was not made by the run
});

test("removalPlan: a run that made nothing deletes nothing", () => {
  const plan = removalPlan(staged, {}, { sceneActors: noOtherScenes });
  assert.deepEqual(plan, { scene: null, journal: null, actors: [], folders: [], kept: [] });
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
  const before = { journals: new Set(["J-old"]), actors: new Set(["a-old"]), folders: new Set(["f-old"]) };
  const staged = { scene: "S", journal: "J-new", actors: ["a-old", "a-new"], folders: ["f-old", "f-new"] };
  assert.deepEqual(createdSince(before, staged), { scene: true, journal: true, actors: ["a-new"], folders: ["f-new"] });
  // A journal the world already had (deployed by an earlier run) is not the run's to delete.
  assert.equal(createdSince(before, { ...staged, journal: "J-old" }).journal, false);
  assert.equal(createdSince(before, { ...staged, journal: null }).journal, false);
});
