import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCurrency, sumCoins, formatDuration, generateSessionName,
} from "../scripts/session-recap/session-recap-core.mjs";

test("formatCurrency", () => {
  assert.equal(formatCurrency(0), "0cp");
  assert.equal(formatCurrency(123), "1gp 2sp 3cp");
  assert.equal(formatCurrency(50), "5sp");
  assert.equal(formatCurrency(-10), "0cp"); // clamped
});

test("sumCoins", () => {
  assert.equal(sumCoins([{ gp: 1 }, { sp: 5 }, { cp: 3 }]), "1gp 5sp 3cp");
  assert.equal(sumCoins([]), "0cp");
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(-5), "0m");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(200_000), "3m 20s");
  assert.equal(formatDuration(3_900_000), "1h 5m");
});

test("generateSessionName disambiguates same-day duplicates", () => {
  const ts = new Date(2026, 6, 3).getTime(); // 2026-07-03 local
  assert.equal(generateSessionName(ts), "2026.07.03 Session");
  assert.equal(generateSessionName(ts, ["2026.07.03 Session"]), "2026.07.03 Session 2");
  assert.equal(
    generateSessionName(ts, ["2026.07.03 Session", "2026.07.03 Session 2"]),
    "2026.07.03 Session 3",
  );
});

import { classifyCombatant } from "../scripts/session-recap/session-recap-core.mjs";

test("classifyCombatant: tokened combatants keep the token disposition rule", () => {
  const owned = { hasPlayerOwner: true, type: "Player" };
  assert.deepEqual(classifyCombatant({ actor: owned, token: { disposition: 1 } }), { friendly: true, participant: true });
  assert.deepEqual(classifyCombatant({ actor: { hasPlayerOwner: false }, token: { document: { disposition: 1 } } }), { friendly: true, participant: false });
  assert.deepEqual(classifyCombatant({ actor: owned, token: { disposition: -1 } }), { friendly: false, participant: false });
});

test("classifyCombatant: a tokenless combatant falls back to the actor", () => {
  const pc = { actor: { type: "Player", hasPlayerOwner: true, prototypeToken: { disposition: 0 } } };
  assert.deepEqual(classifyCombatant(pc), { friendly: true, participant: true });
  const foe = { actor: { type: "NPC", hasPlayerOwner: false, prototypeToken: { disposition: -1 } } };
  assert.deepEqual(classifyCombatant(foe), { friendly: false, participant: false });
  assert.equal(classifyCombatant({ actor: { type: "NPC", prototypeToken: { disposition: 1 } } }).participant, false);
  const npcOwned = classifyCombatant({ actor: { type: "NPC", hasPlayerOwner: true, prototypeToken: { disposition: -1 } } });
  assert.deepEqual(npcOwned, { friendly: false, participant: false });
});

test("classifyCombatant: no actor is skipped without throwing", () => {
  assert.equal(classifyCombatant({ token: { disposition: 1 } }), null);
  assert.equal(classifyCombatant({}), null);
  assert.equal(classifyCombatant(undefined), null);
});

import { hpDrop, recapDrop, stampHpFrom } from "../scripts/session-recap/session-recap-core.mjs";

test("hpDrop: only a fall in HP is damage; healing, no change or a missing reading is not", () => {
  assert.deepEqual(hpDrop(10, 4), { lost: 6, to: 4 });
  assert.deepEqual(hpDrop("3", -2), { lost: 5, to: -2 }, "a drop past 0 counts in full");
  assert.equal(hpDrop(4, 10), null);
  assert.equal(hpDrop(4, 4), null);
  assert.equal(hpDrop(undefined, 4), null, "no stamp from the writer: not counted");
  assert.equal(hpDrop(4, null), null);
});

const M = "shadowdark-enhancer";
const plain = { maxWritten: false, poolWritten: false };

test("stampHpFrom: one shared options object keeps each actor's own HP and other option keys", () => {
  const options = { [M]: { discard: true } };
  stampHpFrom(options, M, "Actor.a", 12);
  stampHpFrom(options, M, "Actor.b", 9);
  assert.deepEqual(options[M], { discard: true, hpFrom: { "Actor.a": 12, "Actor.b": 9 } });
  assert.deepEqual(recapDrop(options, M, "Actor.a", { ...plain, to: 8, hp: 8 }), { lost: 4, to: 8 });
  assert.deepEqual(recapDrop(options, M, "Actor.b", { ...plain, to: 6, hp: 6 }), { lost: 3, to: 6 });
});

test("recapDrop: an update that rewrites the maximum or the pool is not damage", () => {
  const options = { [M]: { hpFrom: { "Actor.a": 30 } } };
  assert.equal(recapDrop(options, M, "Actor.a", { to: 18, hp: 18, maxWritten: true, poolWritten: false }), null, "quick adjust / rollHP");
  assert.equal(recapDrop(options, M, "Actor.a", { to: 12, hp: 12, maxWritten: false, poolWritten: true }), null, "temp HP settle");
});

test("recapDrop: points soaked by temp HP count as damage without a kill", () => {
  const options = { [M]: { tempHpSpent: 3 } };
  assert.deepEqual(recapDrop(options, M, "Actor.a", { to: undefined, hp: 12, maxWritten: false, poolWritten: true }), { lost: 3, to: 12 });
});
