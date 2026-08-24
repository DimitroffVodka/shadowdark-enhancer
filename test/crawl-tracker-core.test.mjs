/**
 * Sidebar crawl tracker view model — pure ordering rules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackerRows, showOocReset, rowRollable, trackerFooter, parseInitiativeInput,
} from "../scripts/crawl-strip/crawl-tracker-core.mjs";

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

test("rowRollable: the owner or the GM rolls, and only before a number exists", () => {
  assert.equal(rowRollable({ isGM: false, isOwner: true, hasInitiative: false }), true,
    "a player rolls their own character, as in the combat tracker");
  assert.equal(rowRollable({ isGM: true, isOwner: false, hasInitiative: false }), true,
    "the GM rolls for anyone");
  assert.equal(rowRollable({ isGM: false, isOwner: false, hasInitiative: false }), false,
    "somebody else's character is not yours to roll");
  assert.equal(rowRollable({ isGM: true, isOwner: true, hasInitiative: true }), false,
    "a rolled row shows its number instead — not even the GM re-rolls from here");
  assert.equal(rowRollable(), false);
});

test("trackerFooter: the GM gets the turn controls, a player only on their own turn", () => {
  assert.deepEqual(trackerFooter({ isGM: true, orderActive: false, ownsHolder: false, round: 0 }),
    { gm: true, playerTurn: false, canAdvance: false, canStepBackRound: false },
    "a GM keeps the footer before anyone rolls; the turn controls are merely disabled");
  assert.deepEqual(trackerFooter({ isGM: true, orderActive: true, ownsHolder: false, round: 2 }),
    { gm: true, playerTurn: false, canAdvance: true, canStepBackRound: true });
  assert.deepEqual(trackerFooter({ isGM: false, orderActive: true, ownsHolder: true, round: 2 }),
    { gm: false, playerTurn: true, canAdvance: true, canStepBackRound: false },
    "the holder's player gets the big End Turn button, never the round controls");
  assert.deepEqual(trackerFooter({ isGM: false, orderActive: true, ownsHolder: false, round: 2 }),
    { gm: false, playerTurn: false, canAdvance: true, canStepBackRound: false },
    "a player waiting their turn gets no footer controls at all");
  assert.deepEqual(trackerFooter({ isGM: false, orderActive: false, ownsHolder: true }),
    { gm: false, playerTurn: false, canAdvance: false, canStepBackRound: false },
    "no live order, no player footer — the holder flag is stale");
  assert.deepEqual(trackerFooter(),
    { gm: false, playerTurn: false, canAdvance: false, canStepBackRound: false });
});

test("trackerFooter: round 0 has nothing to step back to", () => {
  assert.equal(trackerFooter({ isGM: true, orderActive: true, ownsHolder: false, round: 0 }).canStepBackRound, false);
  assert.equal(trackerFooter({ isGM: true, orderActive: true, ownsHolder: false, round: 1 }).canStepBackRound, true);
});

test("showOocReset: GM only, and only with something to clear", () => {
  assert.equal(showOocReset({ isGM: true, rolledCount: 1 }), true);
  assert.equal(showOocReset({ isGM: true, rolledCount: 0 }), false, "nothing rolled, nothing to reset");
  assert.equal(showOocReset({ isGM: false, rolledCount: 6 }), false, "players do not reset the party's order");
  assert.equal(showOocReset(), false);
});

// ─── Typed initiative ───────────────────────────────────────────────────────

test("REGRESSION: a cleared initiative box is not an initiative of 0", () => {
  // `Number("")` is 0, not NaN, so a `Number.isFinite` gate accepted a blanked
  // field as a deliberate roll of zero. That is a real, storable initiative: it
  // sorted the member last, counted them as having rolled — so the order could
  // go "complete" behind the GM's back — and no control in the tracker could
  // unset it again.
  assert.deepEqual(parseInitiativeInput(""), { ok: false });
  assert.deepEqual(parseInitiativeInput("   "), { ok: false }, "whitespace is still blank");
  assert.deepEqual(parseInitiativeInput("\t\n"), { ok: false });
});

test("a real zero typed on purpose is still stored", () => {
  // The fix must not cost the GM the ability to type a genuine 0 — Shadowdark
  // initiative is DEX-based and a low enough modifier reaches it.
  assert.deepEqual(parseInitiativeInput("0"), { ok: true, value: 0 });
  assert.deepEqual(parseInitiativeInput(" 0 "), { ok: true, value: 0 });
});

test("ordinary and negative values parse", () => {
  assert.deepEqual(parseInitiativeInput("17"), { ok: true, value: 17 });
  assert.deepEqual(parseInitiativeInput(" 12 "), { ok: true, value: 12 });
  assert.deepEqual(parseInitiativeInput("-2"), { ok: true, value: -2 }, "a DEX penalty can go below zero");
  assert.deepEqual(parseInitiativeInput("8.5"), { ok: true, value: 8.5 });
});

test("unparseable entries leave the stored value alone", () => {
  assert.deepEqual(parseInitiativeInput("high"), { ok: false });
  assert.deepEqual(parseInitiativeInput("1d20"), { ok: false });
  assert.deepEqual(parseInitiativeInput("Infinity"), { ok: false }, "finite rolls only");
  assert.deepEqual(parseInitiativeInput(undefined), { ok: false });
  assert.deepEqual(parseInitiativeInput(null), { ok: false });
});
