import test from "node:test";
import assert from "node:assert/strict";
import { campArtFor } from "../scripts/stage/stage-core.mjs";
import { registerStage, onPartyCamp } from "../scripts/stage/stage.mjs";

const M = "shadowdark-enhancer";
const IMAGE = campArtFor("").image;

/** A GM client (active unless said otherwise) with a party actor whose camp flag the test changes between calls. */
function world({ active = true, stage = null, token = false } = {}) {
  const store = { stage }, written = [];
  const flags = { [M]: { party: true } };
  const party = { id: "p1", type: "NPC", flags };
  const me = { id: "gm1", isGM: true };
  globalThis.document = { body: { append() {} }, createElement: () => ({ setAttribute() {}, style: {}, remove() {} }), querySelector: () => null };
  globalThis.canvas = token ? { scene: { tokens: [{ actorId: "p1" }] } } : { scene: { tokens: [] } };
  globalThis.ui = {};
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = {
    user: me, users: { activeGM: active ? me : { id: "other" } }, actors: { contents: [party] },
    settings: { register() {}, get: (m, k) => store[k], set: async (m, k, v) => { store[k] = v; written.push(v); } },
  };
  // v14 sends the PLAIN key with the operator as its value (helpers.mjs diff); begin marks the creating write's options
  const op = (camp) => ({ __$OPERATOR$__: "ForcedReplacement", value: camp });
  const set = async (camp, { key = "camping", begin = false } = {}) => {
    flags[M].camping = camp;
    await onPartyCamp(party, { flags: { [M]: { [key]: key === "camping" ? op(camp) : camp } } }, begin ? { [M]: { campBegin: true } } : {});
  };
  const begin = (camp) => set(camp, { begin: true });
  return { store, written, party, set, begin, flags };
}

const raised = { shown: true, place: "camp", image: IMAGE, partyId: "p1", campId: "c1" };

test("a camp begun in setup with no token on the map raises the camp picture and stores the campId", async () => {
  const w = world();
  await w.begin({ id: "c1", phase: "setup" });
  assert.deepEqual(w.written, [raised]);
});

test("later writes of the same camp do not write again", async () => {
  const w = world();
  await w.begin({ id: "c1", phase: "setup" });
  for (const phase of ["setup", "setup", "fuel", "awaitingRest"]) await w.set({ id: "c1", phase });
  assert.equal(w.written.length, 1);
});

test("a GM who hid the picture mid-camp is not overruled by later camp writes", async () => {
  const w = world();
  await w.begin({ id: "c1", phase: "setup" });
  w.store.stage = { ...raised, shown: false };
  await w.set({ id: "c1", phase: "setup", fuel: "wood" });
  await w.set({ id: "c1", phase: "fuel" });
  assert.equal(w.written.length, 1);
});

test("a completed or cancelled camp drops the picture it raised", async () => {
  for (const end of [{ id: "c1", phase: "complete" }, null]) {
    const w = world({ stage: raised });
    await w.set(end);
    assert.deepEqual(w.written, [{ ...raised, shown: false }]);
  }
});

test("the legacy ==camping spelling still counts as a camp change", async () => {
  const w = world({ stage: raised });
  await w.set({ id: "c1", phase: "complete" }, { key: "==camping" });
  assert.deepEqual(w.written, [{ ...raised, shown: false }]);
});

test("a removed key (-=camping) still counts as a camp change", async () => {
  const w = world({ stage: raised });
  w.flags[M].camping = undefined;
  await onPartyCamp(w.party, { flags: { [M]: { "-=camping": null } } });
  assert.deepEqual(w.written, [{ ...raised, shown: false }]);
});

test("another party's cancelled camp, or a different place on the stage, is not dropped", async () => {
  const w = world({ stage: { ...raised, partyId: "p2" } });
  await w.set(null);
  assert.equal(w.written.length, 0);
  const x = world({ stage: { ...raised, shown: false } });
  await x.set(null);
  assert.equal(x.written.length, 0);
});

test("with a party token on the viewed map the camp does not raise it", async () => {
  const w = world({ token: true });
  await w.begin({ id: "c1", phase: "setup" });
  assert.equal(w.written.length, 0);
});

test("no canvas means no token on the map", async () => {
  const w = world();
  delete globalThis.canvas;
  await w.begin({ id: "c1", phase: "setup" });
  assert.deepEqual(w.written, [raised]);
});

test("a second night (new camp id) raises again", async () => {
  const w = world();
  await w.begin({ id: "c1", phase: "setup" });
  await w.set({ id: "c1", phase: "complete" });
  await w.begin({ id: "c2", phase: "setup" });
  assert.deepEqual(w.written.map((s) => [s.shown, s.campId]), [[true, "c1"], [false, "c1"], [true, "c2"]]);
});

test("the camp is read from the actor document, not from the diff", async () => {
  const w = world();
  w.flags[M].camping = { id: "c1", phase: "setup" };
  await onPartyCamp(w.party, { flags: { [M]: { camping: "OPERATOR-NOT-A-CAMP" } } }, { [M]: { campBegin: true } });
  assert.deepEqual(w.written, [raised]);
});

test("an update that does not touch the camping flag does nothing", async () => {
  const w = world();
  w.flags[M].camping = { id: "c1", phase: "setup" };
  await onPartyCamp(w.party, { flags: { [M]: { partyCoins: {} } } });
  await onPartyCamp(w.party, { name: "x" });
  assert.equal(w.written.length, 0);
});

test("only the active GM's client acts; a non-party actor is ignored", async () => {
  const w = world({ active: false });
  await w.begin({ id: "c1", phase: "setup" });
  assert.equal(w.written.length, 0);
  const v = world();
  globalThis.game.user = { id: "pl", isGM: false };
  await v.begin({ id: "c1", phase: "setup" });
  assert.equal(v.written.length, 0);
  const n = world();
  n.flags[M].party = false;
  await n.begin({ id: "c1", phase: "setup" });
  assert.equal(n.written.length, 0);
});

test("a begin write without the option raises nothing; with it and no token it raises once and later setup writes do nothing", async () => {
  const w = world();
  await w.set({ id: "c1", phase: "setup" });
  assert.equal(w.written.length, 0);
  await w.begin({ id: "c1", phase: "setup" });
  await w.set({ id: "c1", phase: "setup", fuel: "wood" });
  await w.set({ id: "c1", phase: "fuel" });
  assert.deepEqual(w.written, [raised]);
});

test("scenario a: begun with a token on the map, then viewing another scene, later setup writes never raise", async () => {
  const w = world({ token: true });
  await w.begin({ id: "c1", phase: "setup" });
  globalThis.canvas = { scene: { tokens: [] } };
  await w.set({ id: "c1", phase: "setup", fuel: "wood" });
  await w.set({ id: "c1", phase: "setup", fuel: "torches" });
  assert.equal(w.written.length, 0);
});

test("scenario b: two parties, B raises over A, GM hides B, A's later setup writes do not put A back", async () => {
  const w = world();
  await w.begin({ id: "cA", phase: "setup" });
  const b = { id: "p2", type: "NPC", flags: { [M]: { party: true, camping: { id: "cB", phase: "setup" } } } };
  globalThis.game.actors.contents.push(b);
  const op = { __$OPERATOR$__: "ForcedReplacement" };
  await onPartyCamp(b, { flags: { [M]: { camping: op } } }, { [M]: { campBegin: true } });
  assert.deepEqual(w.written.map((s) => s.partyId), ["p1", "p2"]);
  await w.set({ id: "cA", phase: "setup", fuel: "wood" });
  await w.set({ id: "cA", phase: "setup", fuel: "none" });
  assert.equal(w.written.length, 2); // no flip before the hide
  w.store.stage = { ...w.store.stage, shown: false };
  await w.set({ id: "cA", phase: "setup", fuel: "wood" });
  assert.equal(w.written.length, 2);
});

test("registerStage listens to updateActor with the watcher", () => {
  const w = world(), on = {};
  globalThis.Hooks = { once() {}, on: (n, f) => { on[n] = f; } };
  registerStage();
  assert.equal(on.updateActor, onPartyCamp);
  void w;
});
