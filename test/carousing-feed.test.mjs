/**
 * Carousing feed tests — the pure layer that mirrors Shadowdark Extras'
 * carousing into the Session Recap.
 *
 * The fixtures reproduce SDX's TWO result shapes verbatim from CarousingSD.mjs
 * (`results[participant.participantId] = { … }` at its original- and
 * expanded-mode roll executors), because the whole point of this layer is
 * surviving both. No book text, no Foundry globals.
 *
 * Also covers the Discord branch that consumes the normalized carouse, and the
 * archive payload — `endAndSave` used to drop downtime/renown, and carousing
 * would have gone the same way.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isExpandedResult,
  normalizeCarousingSession,
  recapRow,
  signedDelta,
  carousingSubtotal,
  tierLine,
} from "../scripts/session-recap/carousing-feed-core.mjs";
import { DEFAULT_DATA, formatForDiscordFromData } from "../scripts/session-recap/session-recap-core.mjs";

/** SDX original mode: one d8 outcome row, an optional benefit, GM applies it. */
function originalResult(over = {}) {
  return {
    roll: 7,
    diceRoll: 5,
    bonus: 2,
    description: "A worthy night of drinking and festivity",
    benefit: "A new drinking companion",
    ...over,
  };
}

/** SDX expanded mode: d8 outcome → XP, plus d100 benefit/mishap arrays. */
function expandedResult(over = {}) {
  return {
    outcomeRoll: 13,
    diceRoll: 10,
    bonus: 3,
    xp: 6,
    benefits: [
      { type: "benefit", diceRoll: 62, modifier: 5, finalRoll: 67, description: "A patron takes an interest", renownDelta: 1 },
    ],
    mishaps: [
      { type: "mishap", diceRoll: 40, modifier: 5, finalRoll: 45, description: "You wake up in the wrong bed", renownDelta: -1 },
    ],
    ...over,
  };
}

/** A whole SDX session flag as `saveCarousingSession` leaves it. */
function session(results, over = {}) {
  return {
    phase: "complete",
    logId: "abcdEFGH12345678",
    logMeta: {
      date: "7/28/2026, 8:14:00 PM",
      tierDescription: "A full day and night of revelry",
      tierCost: 300,
      costPerPerson: 100,
    },
    results,
    ...over,
  };
}

/** Stand-in for the Foundry-backed resolver the watcher supplies. */
const resolve = (id) => ({
  "user-dimi": { player: "Dimi", actorName: "Bazogo" },
  "user-sam": { player: "Sam", actorName: "Ysolde" },
  "actor-npc1": { player: "GM", actorName: "Grumwald" },
}[id] ?? { player: "", actorName: "" });

describe("mode detection", () => {
  test("benefit/mishap ARRAYS are what make a result expanded", () => {
    assert.equal(isExpandedResult(expandedResult()), true);
    assert.equal(isExpandedResult(originalResult()), false);
  });

  test("an expanded result with only mishaps still reads as expanded", () => {
    assert.equal(isExpandedResult({ mishaps: [], xp: 2 }), true);
  });

  test("original mode's string `benefit` must NOT read as expanded", () => {
    // The two fields are one letter apart; confusing them would send an
    // original-mode carouse down the XP-headline branch and lose its outcome.
    assert.equal(isExpandedResult({ benefit: "A new friend" }), false);
  });
});

describe("normalizing a session", () => {
  test("nothing is loggable without SDX's logId", () => {
    // SDX stamps logId in the same breath as the results; no stamp means the
    // carouse has not resolved and there is nothing to mirror.
    assert.equal(normalizeCarousingSession(session({ "user-dimi": originalResult() }, { logId: null }), resolve), null);
  });

  test("nothing is loggable with an empty result set", () => {
    assert.equal(normalizeCarousingSession(session({}), resolve), null);
    assert.equal(normalizeCarousingSession(null, resolve), null);
  });

  test("original mode keeps the outcome text as the headline", () => {
    const c = normalizeCarousingSession(session({ "user-dimi": originalResult() }), resolve);
    assert.equal(c.mode, "original");
    assert.equal(c.entries.length, 1);
    const e = c.entries[0];
    assert.equal(e.player, "Dimi");
    assert.equal(e.actorName, "Bazogo");
    assert.equal(e.roll, 7);
    assert.equal(e.outcome, "A worthy night of drinking and festivity");
    assert.equal(e.xp, 0);
    assert.deepEqual(e.benefits.map(b => b.text), ["A new drinking companion"]);
    assert.deepEqual(e.mishaps, []);
    assert.equal(e.appliedState, "pending");
  });

  test("expanded mode headlines the XP and keeps both roll arrays", () => {
    const c = normalizeCarousingSession(session({ "user-sam": expandedResult() }), resolve);
    assert.equal(c.mode, "expanded");
    const e = c.entries[0];
    assert.equal(e.roll, 13);
    assert.equal(e.xp, 6);
    assert.equal(e.outcome, "6 XP");
    assert.deepEqual(e.benefits.map(b => b.text), ["A patron takes an interest"]);
    assert.deepEqual(e.mishaps.map(m => m.text), ["You wake up in the wrong bed"]);
    // +1 from the benefit, -1 from the mishap.
    assert.equal(e.renownDelta, 0);
    // Expanded results apply themselves as they roll, so there is no pending state.
    assert.equal(e.appliedState, "automatic");
  });

  test("renown deltas are summed across BOTH arrays, not just benefits", () => {
    const c = normalizeCarousingSession(session({
      "user-sam": expandedResult({
        benefits: [{ description: "Feted in the square", renownDelta: 2 }],
        mishaps: [{ description: "A duel you lost", renownDelta: -3 }],
      }),
    }), resolve);
    assert.equal(c.entries[0].renownDelta, -1);
  });

  test("blank benefit/mishap rows are dropped, not rendered empty", () => {
    const c = normalizeCarousingSession(session({
      "user-sam": expandedResult({ benefits: [{ description: "" }, { description: "  " }], mishaps: [] }),
    }), resolve);
    assert.deepEqual(c.entries[0].benefits, []);
  });

  test("a GM-added participant resolves through the actor- prefix", () => {
    const c = normalizeCarousingSession(session({ "actor-npc1": originalResult() }), resolve);
    assert.equal(c.entries[0].actorName, "Grumwald");
    assert.equal(c.entries[0].player, "GM");
  });

  test("the name SDX froze at apply time beats a live lookup", () => {
    // Clearing the overlay's drops erases what the live lookup reads from, so
    // the frozen name is the only thing left. Original mode freezes it on
    // `applied`, expanded mode on `noteApplied`.
    const applied = normalizeCarousingSession(session({
      "gone-user": originalResult({ applied: { at: 1, summary: "+3 XP", actorName: "Bazogo" } }),
    }), resolve);
    assert.equal(applied.entries[0].actorName, "Bazogo");
    assert.equal(applied.entries[0].applied, "+3 XP");
    assert.equal(applied.entries[0].appliedState, "applied");

    const noted = normalizeCarousingSession(session({
      "gone-user": expandedResult({ noteApplied: { at: 1, actorName: "Ysolde" } }),
    }), resolve);
    assert.equal(noted.entries[0].actorName, "Ysolde");
  });

  test("an unresolvable participant falls back to ? / GM, never undefined", () => {
    const c = normalizeCarousingSession(session({ "ghost": originalResult() }), resolve);
    assert.equal(c.entries[0].actorName, "?");
    assert.equal(c.entries[0].player, "GM");
  });

  test("a session with no resolver at all still normalizes", () => {
    const c = normalizeCarousingSession(session({ "user-dimi": originalResult() }));
    assert.equal(c.entries[0].actorName, "?");
  });

  test("tier metadata is carried through as numbers", () => {
    const c = normalizeCarousingSession(session({ "user-dimi": originalResult() }), resolve);
    assert.equal(c.tierDescription, "A full day and night of revelry");
    assert.equal(c.tierCost, 300);
    assert.equal(c.costPerPerson, 100);
    assert.equal(c.date, "7/28/2026, 8:14:00 PM");
  });

  test("missing logMeta degrades to blanks and zeroes, not NaN", () => {
    const c = normalizeCarousingSession(session({ "user-dimi": originalResult() }, { logMeta: undefined }), resolve);
    assert.equal(c.date, "");
    assert.equal(c.tierCost, 0);
    assert.equal(tierLine(c), "");
  });

  test("a mixed-shape session is reported as expanded", () => {
    // Possible when the GM flips SDX's carousing mode between rounds; the
    // expanded rows are the ones that need the expanded reading.
    const c = normalizeCarousingSession(session({
      "user-dimi": originalResult(),
      "user-sam": expandedResult(),
    }), resolve);
    assert.equal(c.mode, "expanded");
    assert.equal(c.entries.find(e => e.player === "Dimi").mode, "original");
    assert.equal(c.entries.find(e => e.player === "Sam").mode, "expanded");
  });
});

describe("row phrasing", () => {
  test("original mode reads name — d8 roll · outcome", () => {
    const c = normalizeCarousingSession(session({ "user-dimi": originalResult() }), resolve);
    assert.equal(recapRow(c.entries[0]), "Bazogo — d8 7 · A worthy night of drinking and festivity");
  });

  test("expanded mode reads name — d8 roll · XP", () => {
    const c = normalizeCarousingSession(session({ "user-sam": expandedResult() }), resolve);
    assert.equal(recapRow(c.entries[0]), "Ysolde — d8 13 · 6 XP");
  });

  test("a roll of 0 is still printed", () => {
    // A negative GM modifier can drag the total to 0; `if (roll)` would hide it.
    assert.equal(recapRow({ actorName: "Bazogo", roll: 0, outcome: "" }), "Bazogo — d8 0");
  });

  test("with neither roll nor outcome it degrades to the bare name", () => {
    assert.equal(recapRow({ actorName: "Bazogo", roll: "", outcome: "" }), "Bazogo");
    assert.equal(recapRow({}), "?");
  });

  test("a renown delta always carries its sign", () => {
    assert.equal(signedDelta(2), "+2");
    assert.equal(signedDelta(-1), "-1");
    assert.equal(signedDelta(0), "0");
    assert.equal(signedDelta("x"), "0");
  });
});

describe("subtotals", () => {
  test("every part that happened is counted, in order", () => {
    const c = normalizeCarousingSession(session({
      "user-dimi": expandedResult({ xp: 4, benefits: [{ description: "A patron", renownDelta: 2 }], mishaps: [] }),
      "user-sam": expandedResult({ xp: 6 }),
    }), resolve);
    assert.equal(
      carousingSubtotal(c.entries),
      "2 carousers · 10 XP · 2 benefits · 1 mishap · renown +2",
    );
  });

  test("a lone carouser is singular", () => {
    assert.equal(carousingSubtotal([{ xp: 0, benefits: [], mishaps: [] }]), "1 carouser");
  });

  test("original mode counts unapplied outcomes so they are chaseable", () => {
    const c = normalizeCarousingSession(session({
      "user-dimi": originalResult(),
      "user-sam": originalResult({ applied: { at: 1, summary: "+2 XP", actorName: "Ysolde" } }),
    }), resolve);
    assert.match(carousingSubtotal(c.entries), /1 not applied$/);
  });

  test("a net-zero renown swing is omitted rather than shown as 0", () => {
    const c = normalizeCarousingSession(session({ "user-sam": expandedResult() }), resolve);
    assert.equal(carousingSubtotal(c.entries).includes("renown"), false);
  });

  test("an empty set does not throw", () => {
    assert.equal(carousingSubtotal(), "0 carousers");
  });
});

describe("the tier line", () => {
  test("description and both costs", () => {
    assert.equal(
      tierLine({ tierDescription: "A hazy, weeklong bender", tierCost: 900, costPerPerson: 300 }),
      "A hazy, weeklong bender — 900 gp total, 300 gp each",
    );
  });

  test("a solo carouse omits the per-person half", () => {
    assert.equal(tierLine({ tierDescription: "One quiet night", tierCost: 30, costPerPerson: 0 }),
      "One quiet night — 30 gp total");
  });

  test("no tier data yields no line", () => {
    assert.equal(tierLine({}), "");
    assert.equal(tierLine(), "");
  });
});

describe("the Discord export", () => {
  const withCarousing = (carousing) => ({ ...structuredClone(DEFAULT_DATA), carousing });

  test("a carouse renders its heading, tier, rows and outcomes", () => {
    const c = normalizeCarousingSession(session({
      "user-sam": expandedResult(),
    }), resolve);
    const out = formatForDiscordFromData(withCarousing([c]), 1000, 61_000);
    assert.match(out, /## Carousing/);
    assert.match(out, /\*\*7\/28\/2026, 8:14:00 PM\*\* — 1 carouser · 6 XP · 1 benefit · 1 mishap/);
    assert.match(out, /\*A full day and night of revelry — 300 gp total, 100 gp each\*/);
    assert.match(out, /- Ysolde — d8 13 · 6 XP/);
    assert.match(out, / {2}- Benefit: A patron takes an interest/);
    assert.match(out, / {2}- Mishap: You wake up in the wrong bed/);
  });

  test("an unapplied original-mode outcome is called out", () => {
    const c = normalizeCarousingSession(session({ "user-dimi": originalResult() }), resolve);
    const out = formatForDiscordFromData(withCarousing([c]), 1000, 61_000);
    assert.match(out, / {2}- \*not applied\*/);
  });

  test("an applied summary replaces the not-applied note", () => {
    const c = normalizeCarousingSession(session({
      "user-dimi": originalResult({ applied: { at: 1, summary: "+3 XP, 12 gp lost", actorName: "Bazogo" } }),
    }), resolve);
    const out = formatForDiscordFromData(withCarousing([c]), 1000, 61_000);
    assert.match(out, / {2}- \*\+3 XP, 12 gp lost\*/);
    assert.equal(out.includes("not applied"), false);
  });

  test("no carousing means no Carousing section", () => {
    const out = formatForDiscordFromData(withCarousing([]), 1000, 61_000);
    assert.equal(out.includes("## Carousing"), false);
  });

  test("carousing alone is enough activity to produce a recap", () => {
    // The export bails with "No session activity recorded." on a bare header;
    // a night that was nothing but carousing must not hit that path.
    const c = normalizeCarousingSession(session({ "user-sam": expandedResult() }), resolve);
    const out = formatForDiscordFromData(withCarousing([c]), 1000, 61_000);
    assert.equal(out.includes("No session activity recorded."), false);
  });

  test("a legacy payload with no carousing key does not throw", () => {
    const data = structuredClone(DEFAULT_DATA);
    delete data.carousing;
    assert.doesNotThrow(() => formatForDiscordFromData(data, 1000, 61_000));
  });
});

describe("the session data shape", () => {
  test("DEFAULT_DATA carries the carousing array", () => {
    assert.deepEqual(DEFAULT_DATA.carousing, []);
  });
});
