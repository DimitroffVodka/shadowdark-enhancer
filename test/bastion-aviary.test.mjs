// The Aviary: one pigeon a world-clock day, the day marked before the message goes and put back if it can't.
import test from "node:test";
import assert from "node:assert/strict";

const core = await import("../scripts/bastion/bastion-core.mjs");
const { sendPigeon } = await import("../scripts/bastion/bastion-aviary.mjs");

const keep = (ids, { going = false } = {}) => {
  let s = { ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 };
  for (const id of ids) s = core.build(s, id).state;
  return going ? s : core.advanceWeek(s);
};
/** A bastion actor holding `state`; `outcomes` says how its next writes go ("ok" or "veto"). */
function bastion(state, outcomes = []) {
  const raw = structuredClone(state);
  return {
    raw, system: { toObject: () => structuredClone(raw) },
    write: async (_actor, next) => {
      if ((outcomes.shift() ?? "ok") === "veto") return false;
      Object.assign(raw, structuredClone(next));
      return true;
    },
  };
}

test("a finished Aviary sends one pigeon a day and logs it; the next day it flies again", () => {
  const s = keep(["aviary"]);
  const one = core.sendPigeon(s, 500);
  assert.equal(one.error, null);
  assert.equal(one.state.pigeonDay, 500);
  assert.equal(one.state.log.at(-1).key, "SDE.bastion.log.pigeon");
  assert.equal(core.sendPigeon(one.state, 500).error, "flown");
  assert.equal(core.sendPigeon(one.state, 501).error, null);
  assert.equal(core.effects(s).aviary, true);
});

test("no Aviary, or one still going up, sends nothing", () => {
  assert.equal(core.sendPigeon(keep(["stable"]), 1).error, "aviary");
  assert.equal(core.sendPigeon(keep(["aviary"], { going: true }), 1).error, "aviary");
});

test("a pigeon marks the day, posts the message, once", async () => {
  const b = bastion(keep(["aviary"]));
  const posts = [];
  const done = await sendPigeon(b, 7, "Hold the bridge.", { write: b.write, post: async () => { posts.push(1); } });
  assert.deepEqual(done, { ok: true, error: null });
  assert.equal(b.raw.pigeonDay, 7);
  const again = await sendPigeon(b, 7, "Another", { write: b.write, post: async () => { posts.push(2); } });
  assert.deepEqual([again.ok, again.error], [false, "flown"]);
  assert.deepEqual(posts, [1]);
});

test("an empty message sends nothing and doesn't use the day", async () => {
  const b = bastion(keep(["aviary"]));
  const done = await sendPigeon(b, 7, "   ", { write: b.write, post: async () => { throw new Error("must not post"); } });
  assert.equal(done.error, "text");
  assert.equal(b.raw.pigeonDay, null);
});

test("a vetoed write posts nothing", async () => {
  const b = bastion(keep(["aviary"]), ["veto"]);
  let posted = 0;
  const done = await sendPigeon(b, 7, "x", { write: b.write, post: async () => { posted++; } });
  assert.equal(done.error, "write");
  assert.equal(posted, 0);
  assert.equal(b.raw.pigeonDay, null);
});

test("a message that can't be posted puts the day back, so the pigeon can fly again", async () => {
  const b = bastion(keep(["aviary"]));
  const quiet = console.error;
  console.error = () => {};
  try {
    const done = await sendPigeon(b, 7, "x", { write: b.write, post: async () => { throw new Error("chat down"); } });
    assert.equal(done.error, "write");
  } finally { console.error = quiet; }
  assert.equal(b.raw.pigeonDay, null);
  const retry = await sendPigeon(b, 7, "x", { write: b.write, post: async () => {} });
  assert.equal(retry.ok, true);
});
