import test from "node:test";
import assert from "node:assert/strict";
import { campArtFor, campTransition } from "../scripts/stage/stage-core.mjs";
import { registerStage, onPartyCamp, toggleCampPicture } from "../scripts/stage/stage.mjs";

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


test("an update that does not touch the camping flag does nothing", async () => {
  const w = world();
  w.flags[M].camping = { id: "c1", phase: "setup" };
  await onPartyCamp(w.party, { flags: { [M]: { partyCoins: {} } } });
  await onPartyCamp(w.party, { name: "x" });
  assert.equal(w.written.length, 0);
});


test("registerStage listens to updateActor with the watcher", () => {
  const w = world(), on = {};
  globalThis.Hooks = { once() {}, on: (n, f) => { on[n] = f; } };
  registerStage();
  assert.equal(on.updateActor, onPartyCamp);
  void w;
});


test("a camp that begins and ends with the button never pressed writes nothing: no picture comes up by itself", async () => {
  for (const token of [false, true]) {
    const w = world({ token });
    delete globalThis.canvas;
    await w.begin({ id: "c1", phase: "setup" });
    for (const phase of ["setup", "fuel", "tasks", "awaitingRest", "complete"]) await w.set({ id: "c1", phase });
    await w.begin({ id: "c2", phase: "setup" });
    await w.set(null);
    assert.deepEqual(w.written, [], `party token on the map: ${token}`);
  }
});

test("the button during a camp shows it, the camp's end drops it; pressed again it hides, and the end then writes nothing", async () => {
  const w = world();
  await w.begin({ id: "c1", phase: "setup" });
  w.flags[M].camping = { id: "c1", phase: "tasks" };
  await toggleCampPicture(w.party);
  assert.deepEqual(w.written, [raised]);
  await w.set({ id: "c1", phase: "complete" });
  assert.deepEqual(w.written, [raised, { ...raised, shown: false }]);

  const x = world();
  x.flags[M].camping = { id: "c1", phase: "tasks" };
  await toggleCampPicture(x.party);
  await toggleCampPicture(x.party);
  assert.deepEqual(x.written.map((v) => v.shown), [true, false]);
  await x.set({ id: "c1", phase: "complete" });
  assert.equal(x.written.length, 2, "already down: the end writes nothing");
});

test("only the active GM's client drops it; a non-party actor is ignored", async () => {
  const w = world({ active: false, stage: raised });
  await w.set(null);
  assert.equal(w.written.length, 0);
  const n = world({ stage: raised });
  n.flags[M].party = false;
  await n.set(null);
  assert.equal(n.written.length, 0);
});

test("a picture shown with no camp running stays when a later camp ends", () => {
  const byHand = { ...raised, campId: "" };
  assert.equal(campTransition(byHand, { id: "c1", phase: "complete" }, { partyId: "p1" }), null);
  assert.equal(campTransition(byHand, null, { partyId: "p1" }), null, "nor when a camp record goes");
});
