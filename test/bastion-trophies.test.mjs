// The Trophy Room: a trophy placed in a finished room is kept and gives each party member 1 XP, or nothing happens.
import test from "node:test";
import assert from "node:assert/strict";

const players = [{ id: "a", type: "Player" }, { id: "b", type: "Player" }];
const actors = Object.assign([...players], { get: (id) => actors.find((a) => a.id === id) });
globalThis.game = { actors };
globalThis.fromUuidSync = (uuid) => actors.find((a) => a.uuid === uuid) ?? null;

const core = await import("../scripts/bastion/bastion-core.mjs");
const { placeTrophy } = await import("../scripts/bastion/bastion-trophies.mjs");
const { membersOf } = await import("../scripts/bastion/bastion-members.mjs");

const keep = (ids, { going = false } = {}) => {
  let s = { ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 };
  for (const id of ids) s = core.build(s, id).state;
  return going ? s : core.advanceWeek(s);
};
/** A bastion actor holding `state`; `outcomes` says how its next writes go ("ok" or "veto"). */
function bastion(state, outcomes = []) {
  const raw = structuredClone(state);
  return {
    raw, outcomes, system: { toObject: () => structuredClone(raw) },
    write: async (_actor, next) => {
      if ((outcomes.shift() ?? "ok") === "veto") return false;
      Object.assign(raw, structuredClone(next));
      return true;
    },
  };
}
const room = () => keep(["trophy-room"]);

test("a finished Trophy Room keeps a trophy's name and logs it; blank and no room are refused", () => {
  const { state, error } = core.placeTrophy(room(), "  A  troll's   ear ");
  assert.equal(error, null);
  assert.deepEqual(state.trophies, ["A troll's ear"]);
  assert.equal(state.log.at(-1).key, "SDE.bastion.log.trophy");
  assert.equal(core.placeTrophy(room(), "   ").error, "name");
  assert.equal(core.placeTrophy(keep(["stable"]), "x").error, "trophyRoom");
  assert.equal(core.placeTrophy(keep(["trophy-room"], { going: true }), "x").error, "trophyRoom", "still building");
  assert.equal(core.effects(room()).trophyRoom, true);
});

test("a trophy name is cut to 60 characters and the list keeps the last 100", () => {
  let s = room();
  s = core.placeTrophy(s, "x".repeat(200)).state;
  assert.equal(s.trophies[0].length, 60);
  for (let i = 0; i < 105; i++) s = core.placeTrophy(s, `t${i}`).state;
  assert.equal(s.trophies.length, 100);
  assert.equal(s.trophies.at(-1), "t104");
});

test("a trophy comes off the list by index, and a bad index is refused", () => {
  let s = core.placeTrophy(core.placeTrophy(room(), "a").state, "b").state;
  assert.deepEqual(core.removeTrophy(s, 0).state.trophies, ["b"]);
  assert.equal(core.removeTrophy(s, 5).error, "nothing");
  assert.equal(core.removeTrophy(s, 1.5).error, "nothing");
});

test("placing a trophy writes it and gives each Player member 1 XP, once", async () => {
  const b = bastion(room());
  const awards = [];
  const done = await placeTrophy(b, "Troll ear", { write: b.write, award: async (xp, o) => { awards.push([xp, o]); return [{}]; }, people: players });
  assert.deepEqual(done, { ok: true, error: null, xp: 1 });
  assert.deepEqual(b.raw.trophies, ["Troll ear"]);
  assert.deepEqual(awards, [[1, { actorIds: ["a", "b"], label: "Troll ear" }]]);
});

test("a vetoed write places nothing and gives no XP", async () => {
  const b = bastion(room(), ["veto"]);
  let given = 0;
  const done = await placeTrophy(b, "x", { write: b.write, award: async () => { given++; return [{}]; }, people: players });
  assert.deepEqual([done.ok, done.error], [false, "write"]);
  assert.deepEqual(b.raw.trophies, []);
  assert.equal(given, 0);
});

test("a write that reports success but did not keep the trophy is not paid either", async () => {
  const b = bastion(room());
  let given = 0;
  const done = await placeTrophy(b, "x", { write: async () => true, award: async () => { given++; return [{}]; }, people: players });
  assert.equal(done.error, "write");
  assert.equal(given, 0);
});

test("no one to give the XP to: nothing is placed (and a trophy written before a refused award is taken back)", async () => {
  const b = bastion(room());
  assert.equal((await placeTrophy(b, "x", { write: b.write, award: async () => [{}], people: [] })).error, "nobody");
  assert.deepEqual(b.raw.trophies, []);
  const refused = await placeTrophy(b, "y", { write: b.write, award: async () => null, people: players });
  assert.deepEqual([refused.ok, refused.error], [false, "nobody"]);
  assert.deepEqual(b.raw.trophies, [], "put back");
});

test("an award that throws keeps the trophy (some XP may have gone out) and says so", async () => {
  const b = bastion(room());
  const quiet = console.error;
  console.error = () => {};
  try {
    const done = await placeTrophy(b, "x", { write: b.write, award: async () => { throw new Error("update failed"); }, people: players });
    assert.deepEqual([done.ok, done.error], [true, "xp"]);
  } finally { console.error = quiet; }
  assert.deepEqual(b.raw.trophies, ["x"]);
});

test("the members are the linked party's, else every player; no link, no one", () => {
  actors.length = 0;
  actors.push(...players, { id: "p", uuid: "Actor.p", flags: { "shadowdark-extras": { members: ["a"] } } }, { id: "q", uuid: "Actor.q", flags: { "shadowdark-extras": { members: [] } } });
  assert.deepEqual(membersOf({ system: { party: "Actor.p" } }).map((a) => a.id), []);   // "a" has no purse
  players.forEach((p) => { p.system = { coins: {} }; });
  assert.deepEqual(membersOf({ system: { party: "Actor.p" } }).map((a) => a.id), ["a"]);
  assert.deepEqual(membersOf({ system: { party: "Actor.q" } }).map((a) => a.id), ["a", "b"]);
  assert.deepEqual(membersOf({ system: { party: "" } }), []);
});
