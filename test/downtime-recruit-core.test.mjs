// Recruit a warband, the pure rules (#205): the DC, what a settlement supplies, and what a character is offered.
// The limits here are invented; the book's numbers reach a world through the rules data, never the repo.
import test from "node:test";
import assert from "node:assert/strict";

import {
  recruitDC, recruitIdOf, recruitKey, recruitOffers, recruitRefusal, recruitSlot, settlementKindAt, settlementLimit, settlementNow,
} from "../scripts/downtime/downtime-recruit-core.mjs";
import { rulesApi } from "../scripts/rules-data/rules-data-core.mjs";

const ID = "abcdEFGH12345678";
const warbands = [
  { id: "a", name: "Rabble", level: 1 }, { id: "b", name: "Melee, Light", level: 2 },
  { id: "c", name: "Melee, Heavy", level: 3 }, { id: "d", name: "Mounted, Light", level: 4 },
  { id: "e", name: "Mounted, Heavy", level: 5 }, { id: "f", name: "Berserkers", level: 3 },
];
const limits = { village: 2, town: 4, city: 6, city_state: 10 };
const rules = rulesApi(() => ({ recruiting: limits }));
const townLimit = settlementLimit("town", (k) => rules.recruitingLimit(k));

test("the DC is 10 plus the warband's level", () => {
  assert.deepEqual([1, 3, 5].map(recruitDC), [11, 13, 15]);
  assert.equal(recruitSlot({ id: ID, name: "Rabble", level: 2 }).dc, 12);
  assert.equal(recruitSlot({ id: ID, name: "Rabble", level: 2 }).paid, false, "no fee");
});

test("the slot key names a warband by its 16-character id, and nothing else", () => {
  assert.equal(recruitKey(ID), `recruit:${ID}`);
  assert.equal(recruitIdOf(recruitKey(ID)), ID);
  for (const bad of ["church-favor", "recruit:", "recruit:short", `recruit:${ID}x`, `recruit:${ID.slice(0, 15)}.`, "recruit:../../x", null, undefined, 7]) {
    assert.equal(recruitIdOf(bad), null, String(bad));
  }
});

test("in a town a level 3 character is offered warbands up to level 3, and nothing above 4 is ever offered", () => {
  assert.equal(townLimit, 4);
  assert.deepEqual(recruitOffers(warbands, { level: 3, limit: townLimit }).map((w) => w.name),
    ["Rabble", "Melee, Light", "Berserkers", "Melee, Heavy"], "lowest first, then by name");
  // A level 5 character in the same town: their level would allow a level 5, the town doesn't.
  const high = recruitOffers(warbands, { level: 5, limit: townLimit });
  assert.deepEqual(high.map((w) => w.level), [1, 2, 3, 3, 4]);
  assert.ok(high.every((w) => w.level <= 4));
});

test("a village, a city and a city-state set their own ceiling; a level 1 character is offered level 1 only", () => {
  const top = (kind, level) => recruitOffers(warbands, { level, limit: settlementLimit(kind, (k) => rules.recruitingLimit(k)) }).map((w) => w.level);
  assert.deepEqual(top("village", 9), [1, 2]);
  assert.deepEqual(top("city", 9), [1, 2, 3, 3, 4, 5]);
  assert.deepEqual(top("city_state", 9), [1, 2, 3, 3, 4, 5]);
  assert.deepEqual(top("town", 1), [1]);
  assert.deepEqual(recruitOffers(warbands, { level: 0, limit: Infinity }), [], "a level 0 character can recruit no one");
});

test("outside a settlement, and while the table isn't filled in, only the character's level limits it", () => {
  const empty = rulesApi(() => ({}));
  assert.equal(settlementLimit("town", (k) => empty.recruitingLimit(k)), Infinity, "not set up is not zero");
  assert.equal(settlementLimit("none", (k) => rules.recruitingLimit(k)), Infinity);
  assert.equal(settlementLimit("hamlet", (k) => rules.recruitingLimit(k)), Infinity);
  assert.deepEqual(recruitOffers(warbands, { level: 5, limit: Infinity }).map((w) => w.level), [1, 2, 3, 3, 4, 5]);
});

test("the refusal names why in plain words, and is null for a warband on offer", () => {
  const here = { level: 3, limit: 4, settlementLabel: "Hollowmere, Town" };
  assert.equal(recruitRefusal(warbands[2], here), null);
  assert.match(recruitRefusal(warbands[3], here), /aboveYou/, "level 4 is above a level 3 character");
  assert.match(recruitRefusal(warbands[4], { ...here, level: 9 }), /aboveSettlement/, "level 5 is above what a town supplies");
  assert.match(recruitRefusal(undefined, here), /gone/);
});

test("the GM's choice outranks the party's hex; none means no settlement", () => {
  const map = { kind: "city", name: "Hollowmere" };
  assert.deepEqual(settlementNow("", map), { kind: "city", name: "Hollowmere", chosen: false });
  assert.deepEqual(settlementNow("town", map), { kind: "town", name: "", chosen: true });
  assert.deepEqual(settlementNow("none", map), { kind: "none", name: "", chosen: true });
  assert.deepEqual(settlementNow("", null), { kind: "none", name: "", chosen: false }, "no map, no choice");
  assert.deepEqual(settlementNow("castle", map), { kind: "city", name: "Hollowmere", chosen: false }, "an unknown choice is ignored");
});

test("the party's settlement is the keyed row of its hex that the book marks as one", () => {
  const entries = [
    { flags: { "shadowdark-enhancer": { hex: { keyed: [
      { num: "0712", feature: "keyed_location", name: "Old Tower" },
      { num: "0712", feature: "town", name: "Hollowmere" },
      { num: "0713", feature: "city", name: "Elsewhere" },
    ] } } } },
    { flags: {} },
  ];
  assert.deepEqual(settlementKindAt(entries, 712), { kind: "town", name: "Hollowmere" });
  assert.deepEqual(settlementKindAt(entries, "0713"), { kind: "city", name: "Elsewhere" });
  assert.equal(settlementKindAt(entries, 999), null);
  assert.equal(settlementKindAt(entries, "not a hex"), null);
  assert.equal(settlementKindAt(undefined, 712), null);
});
