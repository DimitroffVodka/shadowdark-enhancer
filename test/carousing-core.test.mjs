import test from "node:test";
import assert from "node:assert/strict";
import { eventTiers, outcomeRows, outcomeAt, outcomeEffects, holidayFor, preflight, recapNight } from "../scripts/carousing/carousing-core.mjs";
const tiers = [{ id: "t1", cost: 10, bonus: 0, description: "Test outing" }, { id: "t2", cost: 20, bonus: 2, description: "Test feast" }];
const outcomes = [{ range: [1, 10], description: "Synthetic night", benefit: "Gain 2 XP and a luck token" }];
const people = [{ uuid: "Actor.a", actorId: "a", confirmed: true, participate: true, tierId: "t1", coins: { gp: 10 } }, { uuid: "Actor.b", actorId: "b", confirmed: true, participate: false, coins: { gp: 0 } }];
const check = patch => preflight({ participants: people, tiers, outcomes, limit: Infinity, now: 2000000000, ...patch });
test("event and outcome adapters consume imported pipe rows, never seed prose", () => {
  assert.deepEqual(eventTiers([{ _id: "e", description: "10 gp | Synthetic party | +2", range: [1, 1] }]), [{ id: "e", cost: 10, description: "Synthetic party", bonus: 2 }]);
  assert.deepEqual(outcomeRows([{ description: "Synthetic event | Gain 2 XP", range: [1, 8] }]), [{ range: [1, 8], description: "Synthetic event", benefit: "Gain 2 XP" }]);
  assert.deepEqual(eventTiers([{ description: "malformed" }]), []);
  assert.equal(eventTiers([{ id: "v14", name: "10 gp | Synthetic party | +2", description: "" }])[0].cost, 10);
  assert.deepEqual(outcomeRows([]), []);
});
test("only confirmed participating recipients; each pays full selected cost", () => {
  const r = check(); assert.equal(r.ok, true); assert.deepEqual(r.participants.map(p => p.actorId), ["a"]); assert.equal(r.participants[0].cost, 10);
  assert.equal(check({ participants: [] }).error, "SDE.carousing.noParticipants");
  assert.equal(check({ participants: people.map(p => ({ ...p, confirmed: false })) }).error, "SDE.carousing.confirm");
});
test("all-or-nothing funds, missing tables, holes and settlement checks", () => {
  assert.equal(check({ participants: people.map(p => ({ ...p, coins: { gp: 9 } })) }).error, "SDE.carousing.funds");
  assert.equal(check({ outcomes: [] }).error, "SDE.carousing.tablesMissing");
  assert.equal(check({ outcomes: [{ ...outcomes[0], range: [1, 2] }, { ...outcomes[0], range: [6, 10] }] }).error, "SDE.carousing.tablesMissing");
  assert.equal(check({ limit: 9 }).error, "SDE.carousing.limit");
  assert.equal(check({ downtime: true }).error, "SDE.carousing.downtime");
  assert.equal(check({ participants: people.map(p => ({ ...p, lastAt: 1999999999 })) }).error, "SDE.carousing.cooldown");
  assert.equal(check({ participants: people.map(p => ({ ...p, lastAt: 0 })) }).ok, true);
});
test("holiday admission and owner garb bonus apply only when admitted", () => {
  const h = { garb: [{ key: "dress", required: true, modifier: 1 }], carousing: { eventBonus: 2, extraMishap: true } };
  assert.equal(holidayFor(h, {}).admitted, false);
  assert.equal(holidayFor(h, { dress: true }).bonus, 3);
  assert.equal(check({ holiday: h }).error, "SDE.carousing.holidayEntry");
  assert.equal(check({ holiday: h, participants: people.map(p => ({ ...p, garb: { dress: true } })) }).ok, true);
});
test("clamps extremes to actual rows without fabricating gaps; concrete effects only", () => {
  assert.deepEqual(outcomeAt(-3, outcomes), outcomes[0]); assert.deepEqual(outcomeAt(99, outcomes), outcomes[0]);
  assert.equal(outcomeAt(4, [{ range: [1, 2] }, { range: [6, 8] }]), undefined);
  assert.deepEqual(outcomeEffects("Lose 5% of your total wealth and +2 Renown", "Gain 4 XP and a luck token"), { xp: 4, luck: 1, renown: 2 });
  assert.deepEqual(outcomeEffects("Gain 5% of your total wealth", "Gain 4 XP"), { xp: 4, luck: 0, renown: 0 });
  assert.equal(outcomeEffects("A mysterious friend", "").xp, 0);
});
test("XP and Luck automate only explicit unconditional positive rewards", () => {
  for (const text of ["Lose 2 XP and lose a luck token", "-2 XP and -1 luck token", "Do not gain 2 XP or a luck token", "No 2 XP or luck token", "Gain 2 XP and a luck token if you win", "If you win, gain 2 XP", "You may gain 2 XP and a luck token", "Gain 2 XP for completing the GM's task", "2 XP and a luck token", "Gain -2 XP and lose one luck token"]) {
    const effects = outcomeEffects("Synthetic custom outcome", text);
    assert.equal(effects.xp, 0, text); assert.equal(effects.luck, 0, text);
  }
  for (const text of ["Gain 2 XP and a luck token", "You gain 2 XP and gain one luck token", "+2 XP and +1 luck token", "Receive 2 XP. Gain a luck token."]) {
    const effects = outcomeEffects("Synthetic reward", text);
    assert.equal(effects.xp, 2, text); assert.equal(effects.luck, 1, text);
  }
  assert.equal(outcomeEffects("Lose 2 XP", "Gain a luck token").xp, 0);
  assert.equal(outcomeEffects("Lose 2 XP", "Gain a luck token").luck, 1);
});
test("recap stable id and full individual costs, history-only rows never become recipients", () => {
  const night = { logId: "night", at: 1, participants: [{ actorId: "a", name: "Test PC", cost: 10 }], results: { a: { total: 7, description: "Test result", benefit: "Gain 2 XP", effects: { xp: 2, renown: 0 } } } };
  const row = recapNight(night); assert.equal(row.logId, "night"); assert.equal(row.tierCost, 10); assert.equal(row.entries.length, 1); assert.equal(row.entries[0].xp, 2);
  assert.equal(recapNight({ ...night, historyOnly: true }), null);
});
