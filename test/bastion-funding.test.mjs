// Paying into a bastion: who the linked party's people are, what a deposit or withdrawal does to a purse
// and to the treasury, and that Extras' own party coins are never read or written.
import test from "node:test";
import assert from "node:assert/strict";
import { isPartyActor, fundingActors, planDeposit, planWithdraw, purseUpdate, purseOf } from "../scripts/bastion/bastion-funding.mjs";
import { newBastion, deposit, withdraw } from "../scripts/bastion/bastion-core.mjs";

const actor = (id, coins, flags) => ({ id, name: id, system: coins ? { coins } : {}, flags: flags ?? {} });

test("a party is Extras' (isParty) or the Enhancer's own, read without getFlag", () => {
  assert.equal(isPartyActor(actor("a", null, { "shadowdark-extras": { isParty: true } })), true);
  assert.equal(isPartyActor(actor("b", null, { "shadowdark-enhancer": { party: true } })), true);
  assert.equal(isPartyActor(actor("c", null, { "shadowdark-extras": { isParty: false } })), false);
  assert.equal(isPartyActor(actor("d")), false);
  assert.equal(isPartyActor(null), false);
  // an actor whose getFlag would throw for an inactive scope is never asked
  assert.equal(isPartyActor({ flags: {}, getFlag() { throw new Error("scope not active"); } }), false);
});

test("a linked party's members pay, or every player does when there are none to find", () => {
  const ann = actor("ann", { gp: 5, sp: 0, cp: 0 }), bo = actor("bo", { gp: 1, sp: 0, cp: 0 }), npc = actor("npc");
  const world = { ann, bo, npc };
  const resolve = (id) => world[id] ?? null;
  const party = actor("party", null, { "shadowdark-extras": { isParty: true, members: ["ann", "npc", "ghost", "bo"] } });
  assert.deepEqual(fundingActors({ party, resolve, players: [ann, bo, actor("cy", { gp: 9, sp: 0, cp: 0 })] }).map((a) => a.id), ["ann", "bo"]);
  assert.deepEqual(fundingActors({ party: null, resolve, players: [ann, bo] }).map((a) => a.id), ["ann", "bo"]);
  const empty = actor("p2", null, { "shadowdark-extras": { isParty: true, members: [] } });
  assert.deepEqual(fundingActors({ party: empty, resolve, players: [ann] }).map((a) => a.id), ["ann"]);
  const none = actor("p3", null, { "shadowdark-enhancer": { party: true } });
  assert.deepEqual(fundingActors({ party: none, resolve, players: [ann, npc] }).map((a) => a.id), ["ann"]);   // no purse, no paying
});

test("the Enhancer's own party roster is read first; Extras' members are the fallback", () => {
  const ann = actor("ann", { gp: 5, sp: 0, cp: 0 }), bo = actor("bo", { gp: 1, sp: 0, cp: 0 }), cy = actor("cy", { gp: 9, sp: 0, cp: 0 });
  const world = { "Actor.ann": ann, "Actor.bo": bo, cy };
  const resolve = (ref) => world[ref] ?? null;
  const native = actor("party", null, { "shadowdark-enhancer": { party: true, partyData: { members: ["Actor.ann", "Actor.bo"] } }, "shadowdark-extras": { members: ["cy"] } });
  assert.deepEqual(fundingActors({ party: native, resolve, players: [] }).map((a) => a.id), ["ann", "bo"], "partyData's UUIDs win over Extras' stale ids");
  const empty = actor("party2", null, { "shadowdark-enhancer": { party: true, partyData: { members: [] } }, "shadowdark-extras": { members: ["cy"] } });
  assert.deepEqual(fundingActors({ party: empty, resolve, players: [ann] }).map((a) => a.id), ["ann"], "an emptied native roster falls to the players, not Extras");
  const legacy = actor("party3", null, { "shadowdark-extras": { isParty: true, members: ["cy"] } });
  assert.deepEqual(fundingActors({ party: legacy, resolve, players: [] }).map((a) => a.id), ["cy"], "no Enhancer roster: Extras' members still pay");
});

test("a deposit takes gold from the purse, breaking coin only when it must", () => {
  assert.deepEqual(planDeposit({ gp: 12, sp: 3, cp: 4 }, 5), { ok: true, coins: { gp: 7, sp: 3, cp: 4 }, error: null });
  assert.deepEqual(planDeposit({ gp: 4, sp: 90, cp: 0 }, 10).coins, { gp: 3, sp: 0, cp: 0 });   // silver goes first, then one gold coin
  assert.deepEqual(planDeposit({ gp: 2, sp: 0, cp: 0 }, 3), { ok: false, error: "broke" });
  assert.equal(planDeposit({ gp: 9, sp: 0, cp: 0 }, 0).error, "amount");
  assert.equal(planDeposit({ gp: 9, sp: 0, cp: 0 }, 2.5).error, "amount");
  assert.equal(planDeposit({ gp: 9, sp: 0, cp: 0 }, -1).error, "amount");
});

test("a deposit leaves the purse worth exactly what it was less the gold", () => {
  const worth = (c) => c.gp * 100 + c.sp * 10 + c.cp;
  for (const coins of [{ gp: 7, sp: 8, cp: 9 }, { gp: 1, sp: 99, cp: 3 }, { gp: 0, sp: 150, cp: 0 }]) {
    for (const gp of [1, 2, 7]) {
      const plan = planDeposit(coins, gp);
      if (plan.ok) assert.equal(worth(plan.coins), worth(coins) - gp * 100);
      else assert.equal(plan.error, "broke");
    }
  }
});

test("a withdrawal adds gold to the purse without collapsing the coins already there", () => {
  assert.deepEqual(planWithdraw({ gp: 1, sp: 150, cp: 0 }, 4), { ok: true, coins: { gp: 5, sp: 150, cp: 0 }, error: null });
  assert.equal(planWithdraw({ gp: 1, sp: 0, cp: 0 }, 0).error, "amount");
});

test("a purse is written as its three fields and read back the same", () => {
  assert.deepEqual(purseUpdate({ gp: 3, sp: 2, cp: 1 }), { "system.coins.gp": 3, "system.coins.sp": 2, "system.coins.cp": 1 });
  assert.deepEqual(purseOf(actor("x", { gp: 3, sp: 2, cp: 1 })), { gp: 3, sp: 2, cp: 1 });
  assert.deepEqual(purseOf(actor("y")), { gp: 0, sp: 0, cp: 0 });
});

test("the treasury takes a deposit and pays a withdrawal, whole gold only, and logs who", () => {
  const s = { ...newBastion("keep"), weeksLeft: 0, treasury: 100 };
  const d = deposit(s, 250, "Ann");
  assert.equal(d.state.treasury, 350);
  assert.deepEqual(d.state.log.at(-1), { week: 0, key: "SDE.bastion.log.deposited", data: { who: "Ann", gp: 250 } });
  const w = withdraw(d.state, 300, "Bo");
  assert.equal(w.state.treasury, 50);
  assert.equal(w.state.log.at(-1).key, "SDE.bastion.log.withdrew");
  assert.equal(withdraw(w.state, 51, "Bo").error, "broke");
  assert.equal(withdraw(w.state, 51, "Bo").state.treasury, 50);   // refused, unchanged
  assert.equal(deposit(s, 0).error, "amount");
  assert.equal(deposit(s, 1.5).error, "amount");
  assert.equal(withdraw(s, -3).error, "amount");
});
