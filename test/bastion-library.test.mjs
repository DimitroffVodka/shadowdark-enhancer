// The Library's +1 on learning downtime checks: who gets it, on which activities, and that two libraries don't stack.
import test from "node:test";
import assert from "node:assert/strict";

const EXTRAS = "shadowdark-extras";
const players = [{ id: "a", type: "Player", system: { coins: {} } }, { id: "b", type: "Player", system: { coins: {} } }, { id: "c", type: "Player", system: { coins: {} } }];
const actors = Object.assign([...players], { get: (id) => actors.find((a) => a.id === id) });
globalThis.game = { actors };
globalThis.fromUuidSync = (uuid) => actors.find((a) => a.uuid === uuid) ?? null;

const { BASTION_TYPE } = await import("../scripts/bastion/bastion-art.mjs");
const core = await import("../scripts/bastion/bastion-core.mjs");
const { libraryBonus, withLibrary } = await import("../scripts/bastion/bastion-library.mjs");

const party = (id, members) => { const p = { id, uuid: `Actor.${id}`, type: "Party", flags: { [EXTRAS]: { members } } }; actors.push(p); return p; };
/** A keep that stands with these upgrades finished, owned by `partyUuid`. */
function bastion(ids, partyUuid, { going = false } = {}) {
  let s = { ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 };
  for (const id of ids) s = core.build(s, id).state;
  if (!going) s = core.advanceWeek(s);
  const a = { id: `b${actors.length}`, type: BASTION_TYPE, system: { ...s, party: partyUuid, toObject: () => structuredClone(s) } };
  actors.push(a);
  return a;
}
const reset = () => { actors.length = 0; actors.push(...players); };  // keeps the same collection
const learn = { key: "martialTraining" };
const check = { ability: "str", mod: 2 };

test("the Library is an effect only while it is built and finished in a standing bastion", () => {
  assert.equal(core.effects(core.advanceWeek(core.build({ ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 }, "library").state)).library, true);
  assert.equal(core.effects({ ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 }).library, false);
  const going = core.build({ ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 }, "library").state;
  assert.equal(core.effects(going).library, false, "still building");
});

test("a member of the owning party gets +1 on a learning check, others and other activities don't", () => {
  reset();
  bastion(["library"], party("p1", ["a", "b"]).uuid);
  assert.deepEqual(withLibrary(check, learn, players[0]), { ability: "str", mod: 3, library: 1 });
  assert.deepEqual(withLibrary(check, { key: "magicalResearch" }, players[1]), { ability: "str", mod: 3, library: 1 });
  assert.equal(withLibrary(check, learn, players[2]), check, "not a member");
  assert.equal(withLibrary(check, { key: "spiritualism" }, players[0]), check, "not a learning activity");
  assert.equal(withLibrary(check, { key: "skulduggery" }, players[0]), check);
});

test("a Library still going up, none built, or no party link gives nothing", () => {
  reset();
  bastion(["library"], party("p1", ["a"]).uuid, { going: true });
  bastion(["stable"], "Actor.p1");
  bastion(["library"], "");
  assert.equal(withLibrary(check, learn, players[0]), check);
});

test("a party that lists no members covers every player character", () => {
  reset();
  bastion(["library"], party("p1", []).uuid);
  assert.equal(withLibrary(check, learn, players[2]).mod, 3);
});

test("two libraries don't stack", () => {
  reset();
  bastion(["library"], party("p1", ["a"]).uuid);
  bastion(["library"], party("p2", ["a"]).uuid);
  assert.equal(withLibrary(check, learn, players[0]).mod, 3);
});

test("no world, no bonus; and the pure function reads only what it's given", () => {
  assert.equal(libraryBonus(learn, players[0], [{ library: true, people: [players[0]] }]), 1);
  assert.equal(libraryBonus(learn, players[0], [{ library: false, people: [players[0]] }]), 0);
  assert.equal(libraryBonus(learn, null, [{ library: true, people: [players[0]] }]), 0);
  const saved = globalThis.game;
  delete globalThis.game;
  assert.equal(withLibrary(check, learn, players[0]), check);
  globalThis.game = saved;
});
