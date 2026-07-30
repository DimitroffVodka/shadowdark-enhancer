/**
 * Renown core tests — the band ladder, the bonus lookup, the negative range,
 * the double-1s reaction rule, and the shared row phrasing.
 *
 * No book text: band thresholds and bonus numbers are bare mechanics, and the
 * band descriptions asserted here are the module's own wording.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RENOWN_BANDS,
  RENOWN_HISTORY_CAP,
  RENOWN_TRIGGERS,
  appendRenownHistory,
  authorizeRenownAward,
  groupHistoryByPlayer,
  historyRow,
  isDoubleOnes,
  recapRow,
  renownBand,
  renownBonus,
  renownChangeLine,
  renownValue,
  shouldSeedStartingRenown,
  signedRenown,
  startingRenown,
} from "../scripts/renown/renown-core.mjs";
import { reactionBand } from "../scripts/encounter/encounter-result.mjs";

describe("renown bands", () => {
  test("the ladder is contiguous, ascending, and open-ended at the top", () => {
    assert.equal(RENOWN_BANDS.length, 4);
    for (let i = 1; i < RENOWN_BANDS.length; i++) {
      assert.ok(RENOWN_BANDS[i].max > RENOWN_BANDS[i - 1].max, `band ${i} must sit above band ${i - 1}`);
      assert.ok(RENOWN_BANDS[i].bonus >= RENOWN_BANDS[i - 1].bonus);
    }
    assert.equal(RENOWN_BANDS.at(-1).max, Infinity);
    assert.deepEqual(RENOWN_BANDS.map(b => b.bonus), [0, 1, 2, 3]);
  });

  test("every band carries a label and a short meaning", () => {
    for (const band of RENOWN_BANDS) {
      assert.ok(band.key && band.label && band.note, `band ${band.key} is incomplete`);
    }
  });

  test("the boundaries land in the right band", () => {
    const cases = [
      [-99, "unknown"], [-1, "unknown"], [0, "unknown"], [3, "unknown"],
      [4, "local"], [7, "local"],
      [8, "name"], [11, "name"],
      [12, "celebrity"], [40, "celebrity"],
    ];
    for (const [value, key] of cases) {
      assert.equal(renownBand(value).key, key, `${value} renown should be band "${key}"`);
    }
  });

  test("the bonus is 0/+1/+2/+3 across the four bands", () => {
    assert.equal(renownBonus(3), 0);
    assert.equal(renownBonus(4), 1);
    assert.equal(renownBonus(8), 2);
    assert.equal(renownBonus(12), 3);
  });

  test("renown may be negative and still reads as a band", () => {
    assert.equal(renownValue(-4), -4);
    assert.equal(renownBand(-4).key, "unknown");
    assert.equal(renownBonus(-4), 0);
  });

  test("garbage and unset read as 0, not NaN", () => {
    for (const junk of [undefined, null, "", "abc", NaN, {}]) {
      assert.equal(renownValue(junk), 0);
      assert.equal(renownBand(junk).key, "unknown");
    }
    assert.equal(renownValue("5"), 5);
    assert.equal(renownValue(2.9), 2, "fractions truncate rather than round up a band");
  });
});

describe("starting renown", () => {
  test("starts at the CHA modifier, negative included", () => {
    assert.equal(startingRenown(3), 3);
    assert.equal(startingRenown(0), 0);
    assert.equal(startingRenown(-2), -2);
  });
});

describe("phrasing", () => {
  test("a positive delta always carries its sign", () => {
    assert.equal(signedRenown(2), "+2");
    assert.equal(signedRenown(0), "0");
    assert.equal(signedRenown(-1), "-1");
  });

  test("the change line names the band it lands in", () => {
    assert.equal(
      renownChangeLine({ actorName: "Eliara", delta: 1, after: 8 }),
      "Eliara: renown +1 → 8 (Known name)"
    );
    assert.equal(
      renownChangeLine({ actorName: "Bazogo", delta: -1, after: -2 }),
      "Bazogo: renown -1 → -2 (Unknown)"
    );
  });

  test("the recap row appends the reason only when there is one", () => {
    const base = { actorName: "Eliara", delta: 1, after: 4 };
    assert.equal(recapRow(base), "Eliara: renown +1 → 4 (Locally known)");
    assert.equal(
      recapRow({ ...base, reason: "Gained a level" }),
      "Eliara: renown +1 → 4 (Locally known) — Gained a level"
    );
    assert.equal(recapRow({ ...base, reason: "   " }), "Eliara: renown +1 → 4 (Locally known)");
  });

  test("the trigger lists are short labels, not sentences", () => {
    const all = [...RENOWN_TRIGGERS.gains, ...RENOWN_TRIGGERS.losses];
    assert.ok(all.length >= 8);
    for (const label of all) {
      assert.ok(label.length <= 40, `"${label}" is too long to be a label`);
      assert.ok(!label.endsWith("."), `"${label}" reads as prose`);
    }
  });
});

describe("double 1s on a reaction roll", () => {
  test("only a raw 2d6 total of 2 is double 1s", () => {
    assert.equal(isDoubleOnes(2), true);
    for (const total of [3, 4, 7, 11, 12]) assert.equal(isDoubleOnes(total), false);
  });

  test("double 1s stay hostile however large the modifiers get", () => {
    // The pre-renown behaviour: 2 + a +5 CHA mod reached "Suspicious".
    assert.equal(reactionBand(7), "Suspicious");
    // With the rule applied, the same total is hostile.
    assert.equal(reactionBand(7, { doubleOnes: true }), "Hostile");
    assert.equal(reactionBand(12, { doubleOnes: true }), "Hostile");
  });

  test("the band ladder is unchanged when the dice were not double 1s", () => {
    const cases = [[2, "Hostile"], [6, "Hostile"], [7, "Suspicious"], [8, "Suspicious"],
      [9, "Neutral"], [10, "Curious"], [11, "Curious"], [12, "Friendly"]];
    for (const [total, band] of cases) {
      assert.equal(reactionBand(total), band, `total ${total}`);
      assert.equal(reactionBand(total, { doubleOnes: false }), band, `total ${total} (explicit false)`);
    }
  });

  test("the renown bonus can move a reaction up a band", () => {
    // A raw 7 with no CHA mod is Suspicious; a Known name (+2) makes it Neutral.
    assert.equal(reactionBand(7 + 0 + renownBonus(3)), "Suspicious");
    assert.equal(reactionBand(7 + 0 + renownBonus(8)), "Neutral");
    assert.equal(reactionBand(7 + 0 + renownBonus(12)), "Curious");
  });
});

describe("who may change renown", () => {
  test("a GM may proceed", () => {
    assert.equal(authorizeRenownAward({ requesterIsGM: true }), null);
  });

  test("a player is refused, and the refusal is already result-shaped", () => {
    const denied = authorizeRenownAward({ requesterIsGM: false });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "Only a GM can change renown.");
  });

  test("an absent or malformed context is refused, not waved through", () => {
    // The query handler passes `!!user?.isGM` — an unauthenticated sender must
    // land in the refusal branch rather than defaulting to allowed.
    for (const ctx of [undefined, {}, { requesterIsGM: null }, { requesterIsGM: 0 }]) {
      assert.equal(authorizeRenownAward(ctx)?.ok, false, `context ${JSON.stringify(ctx)}`);
    }
  });
});

describe("the one automatic starting seed", () => {
  test("a fresh character is owed one", () => {
    assert.equal(shouldSeedStartingRenown({ seeded: false, renown: 0, historyCount: 0 }), true);
    // The eligibility rule must also hold for an absent context, since the
    // caller reads three optional flags off a live actor.
    assert.equal(shouldSeedStartingRenown(), true);
    assert.equal(shouldSeedStartingRenown({}), true);
  });

  test("a spent flag ends it, whatever the other two say", () => {
    assert.equal(shouldSeedStartingRenown({ seeded: true, renown: 0, historyCount: 0 }), false);
  });

  test("a non-zero score is somebody's real renown and is never overwritten", () => {
    // Typed on the sheet, imported with the character, or awarded — the seed
    // cannot tell the difference, and must not touch any of them.
    for (const renown of [1, -1, 7, -4]) {
      assert.equal(shouldSeedStartingRenown({ renown }), false, `renown ${renown}`);
    }
  });

  test("a character docked back to exactly zero is protected by its ledger", () => {
    // The whole reason historyCount is a condition: renown 0 alone cannot tell
    // a new character from one who earned a point and lost it again.
    assert.equal(shouldSeedStartingRenown({ renown: 0, historyCount: 2 }), false);
  });
});

describe("the renown ledger", () => {
  const entry = { delta: 1, before: 4, after: 5, reason: "A major triumph", source: "gm", player: "Vella", at: 1000 };

  test("an append returns a new array and leaves the stored one alone", () => {
    const stored = [{ delta: 1, after: 4 }];
    const next = appendRenownHistory(stored, entry);
    assert.equal(stored.length, 1, "the live actor flag must not be mutated");
    assert.equal(next.length, 2);
    assert.notEqual(next, stored);
  });

  test("junk in the stored flag is treated as an empty ledger", () => {
    for (const junk of [undefined, null, "nope", 7, {}]) {
      assert.equal(appendRenownHistory(junk, entry).length, 1, `junk ${JSON.stringify(junk)}`);
    }
    // A row that is not an object cannot be rendered, so it is dropped rather
    // than carried forward into the display.
    assert.equal(appendRenownHistory([null, "x", { delta: 1 }], entry).length, 2);
  });

  test("every field is coerced, so a malformed caller cannot store garbage", () => {
    const [row] = appendRenownHistory([], { delta: "2", before: null, after: "9.7", reason: 5, source: undefined, at: "1000" });
    assert.equal(row.delta, 2);
    assert.equal(row.before, 0);
    assert.equal(row.after, 9, "truncated, like every other renown value");
    assert.equal(row.reason, "5");
    assert.equal(row.source, "gm");
    assert.equal(row.at, 1000);
  });

  test("the cap drops the OLDEST entries, not the newest", () => {
    let log = [];
    for (let i = 1; i <= RENOWN_HISTORY_CAP + 5; i++) log = appendRenownHistory(log, { ...entry, after: i });
    assert.equal(log.length, RENOWN_HISTORY_CAP);
    assert.equal(log.at(-1).after, RENOWN_HISTORY_CAP + 5, "the newest change survives");
    assert.equal(log[0].after, 6, "the first five fell off the front");
  });

  test("a nonsense cap still keeps at least the change being recorded", () => {
    assert.equal(appendRenownHistory([{ delta: 1 }], entry, { cap: 0 }).length, 1);
    assert.equal(appendRenownHistory([{ delta: 1 }], entry, { cap: -3 }).length, 1);
  });
});

describe("ledger display", () => {
  test("a row reads as the change, the resulting total, and the reason", () => {
    assert.equal(historyRow({ delta: 1, after: 5, reason: "A major triumph" }), "+1 → 5 · A major triumph");
    assert.equal(historyRow({ delta: -2, after: -1, reason: "Public humiliation" }), "-2 → -1 · Public humiliation");
  });

  test("with no reason, the source tag is spelled out instead of leaking a slug", () => {
    assert.equal(historyRow({ delta: 1, after: 2, source: "level-up" }), "+1 → 2 · Gained a level");
    assert.equal(historyRow({ delta: 2, after: 2, source: "start" }), "+2 → 2 · Starting renown");
    // An unrecognised tag falls back to itself rather than vanishing.
    assert.equal(historyRow({ delta: 1, after: 1, source: "carousing" }), "+1 → 1 · carousing");
    assert.equal(historyRow({ delta: 1, after: 1, source: "" }), "+1 → 1");
    assert.equal(historyRow(), "0 → 0");
  });
});

describe("grouping the ledger per player", () => {
  const rows = [
    { player: "Vella", actorName: "Troana", delta: 2 },
    { player: "Sam", actorName: "Bazogo", delta: 1 },
    { player: "Vella", actorName: "Troana", delta: -1 },
    { player: "Vella", actorName: "Willow", delta: 3 },
  ];

  test("each player gets their net change and their own rows", () => {
    const groups = groupHistoryByPlayer(rows);
    assert.deepEqual(groups.map(g => g.player), ["Sam", "Vella"], "sorted by player name");

    const vella = groups.find(g => g.player === "Vella");
    assert.equal(vella.net, 4);
    assert.equal(vella.count, 3);
    assert.deepEqual(vella.entries.map(e => e.actorName), ["Troana", "Troana", "Willow"]);
  });

  test("an unattributed change is filed under the GM rather than dropped", () => {
    const groups = groupHistoryByPlayer([{ delta: 1 }, { player: "", delta: 1 }]);
    assert.deepEqual(groups.map(g => g.player), ["GM"]);
    assert.equal(groups[0].count, 2);
  });

  test("junk input groups to nothing instead of throwing", () => {
    for (const junk of [undefined, null, "nope", 7, {}]) {
      assert.deepEqual(groupHistoryByPlayer(junk), [], `junk ${JSON.stringify(junk)}`);
    }
  });
});
