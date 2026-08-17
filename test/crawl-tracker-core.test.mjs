/**
 * Sidebar crawl tracker view model — pure ordering rules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildTrackerRows, showOocReset } from "../scripts/crawl-strip/crawl-tracker-core.mjs";

const rolls = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { roll: v, advantage: 0 }]));

test("rolled members sort highest first", () => {
  const rows = buildTrackerRows({
    members: ["a", "b", "c"],
    oocInitiative: rolls({ a: 8, b: 17, c: 12 }),
  });
  assert.deepEqual(rows.map(r => r.actorId), ["b", "c", "a"]);
  assert.deepEqual(rows.map(r => r.initiative), [17, 12, 8]);
});

test("unrolled members come last, in roster order, with a null initiative", () => {
  const rows = buildTrackerRows({
    members: ["a", "b", "c", "d"],
    oocInitiative: rolls({ c: 4 }),
  });
  assert.deepEqual(rows.map(r => r.actorId), ["c", "a", "b", "d"],
    "the one roll leads; the rest keep the order they were added in");
  assert.equal(rows[0].initiative, 4);
  assert.deepEqual(rows.slice(1).map(r => r.initiative), [null, null, null],
    "null, not 0 — the template has to tell an unrolled member from a rolled zero");
});

test("a rolled zero is a roll, not a blank", () => {
  const rows = buildTrackerRows({ members: ["a", "b"], oocInitiative: rolls({ a: 0 }) });
  assert.deepEqual(rows.map(r => r.actorId), ["a", "b"]);
  assert.equal(rows[0].initiative, 0, "0 sorts and renders as a real initiative");
  assert.equal(rows[1].initiative, null);
});

test("ties keep roster order on every rebuild", () => {
  const state = { members: ["a", "b", "c"], oocInitiative: rolls({ a: 11, b: 11, c: 11 }) };
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(buildTrackerRows(state).map(r => r.actorId), ["a", "b", "c"],
      "equal rolls must not shuffle between renders");
  }
});

test("the holder is flagged, and only the holder", () => {
  const rows = buildTrackerRows({
    members: ["a", "b"], oocInitiative: rolls({ a: 3, b: 9 }), oocTurn: "a",
  });
  assert.deepEqual(rows.map(r => [r.actorId, r.isHolder]), [["b", false], ["a", true]]);
});

test("a holder who is not in the roster flags nobody", () => {
  const rows = buildTrackerRows({
    members: ["a", "b"], oocInitiative: rolls({ a: 3, b: 9 }), oocTurn: "ghost",
  });
  assert.equal(rows.some(r => r.isHolder), false);
});

test("degenerate state yields no rows rather than throwing", () => {
  assert.deepEqual(buildTrackerRows(), []);
  assert.deepEqual(buildTrackerRows({ members: [null, "", 7] }), []);
  assert.deepEqual(buildTrackerRows({ members: ["a"] }).map(r => r.initiative), [null]);
});

test("showOocReset: GM only, and only with something to clear", () => {
  assert.equal(showOocReset({ isGM: true, rolledCount: 1 }), true);
  assert.equal(showOocReset({ isGM: true, rolledCount: 0 }), false, "nothing rolled, nothing to reset");
  assert.equal(showOocReset({ isGM: false, rolledCount: 6 }), false, "players do not reset the party's order");
  assert.equal(showOocReset(), false);
});
