/**
 * Pit Fighting core — the bout set-up mechanics (Cursed Scroll 2, pgs 20–24).
 *
 * No book text: dice ranges, tier thresholds and table NAMES only. The names are
 * asserted against the importer's own manifest, which is the point of the last
 * suite here — the roller asks for tables by name, so a rename on either side
 * would otherwise leave it drawing from nothing at runtime with every unit test
 * still green.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DANGER_LEVELS,
  STAKES_TIERS,
  TWIST_BANDS,
  averagePartyLevel,
  buildBout,
  dangerFor,
  encounterTableName,
  stakesFor,
  stakesUp,
  suggestedDanger,
  suggestedRenown,
  twistFor,
  venueRowFor,
} from "../scripts/pit-fighting/pit-fighting-core.mjs";
import { TABLE_MANIFEST } from "../scripts/importer/tables/table-manifest-data.mjs";

describe("stakes tiers", () => {
  test("the ladder is contiguous and open-ended at the top", () => {
    assert.equal(STAKES_TIERS.length, 4);
    for (let i = 1; i < STAKES_TIERS.length; i++) {
      assert.equal(STAKES_TIERS[i].min, STAKES_TIERS[i - 1].max + 1, `gap before tier ${i}`);
    }
    assert.equal(STAKES_TIERS.at(-1).max, Infinity);
  });

  test("every printed band maps to its tier", () => {
    const cases = [[2, "low"], [5, "low"], [6, "mid"], [10, "mid"],
      [11, "high"], [13, "high"], [14, "epic"], [99, "epic"]];
    for (const [total, key] of cases) {
      assert.equal(stakesFor(total).key, key, `total ${total}`);
    }
  });

  test("a total below the printed table reads as the lowest tier", () => {
    // A level-0 funnel party rolling a 1 is off the bottom of the table.
    for (const total of [1, 0, -3]) assert.equal(stakesFor(total).key, "low", `total ${total}`);
  });

  test("junk reads as the lowest tier rather than throwing", () => {
    for (const total of [undefined, null, NaN, "seven"]) {
      assert.equal(stakesFor(total).key, "low");
    }
  });

  test("a raise steps up one tier and stops at epic", () => {
    assert.equal(stakesUp("low").key, "mid");
    assert.equal(stakesUp("mid").key, "high");
    assert.equal(stakesUp("high").key, "epic");
    assert.equal(stakesUp("epic").key, "epic", "epic is the cap");
    assert.equal(stakesUp("low", 2).key, "high");
    assert.equal(stakesUp("low", 99).key, "epic");
  });
});

describe("average party level", () => {
  test("a whole average is itself", () => {
    assert.equal(averagePartyLevel([2, 2, 2, 2]).apl, 2);
  });

  test("a fractional average rounds half up, and the mean stays visible", () => {
    const r = averagePartyLevel([1, 2, 2, 2]);   // mean 1.75
    assert.equal(r.apl, 2);
    assert.equal(r.mean, 1.75);

    assert.equal(averagePartyLevel([1, 2]).apl, 2, "exactly .5 rounds up");
    assert.equal(averagePartyLevel([1, 1, 1, 2]).apl, 1, "1.25 rounds down");
  });

  test("levels can be read off objects as well as numbers", () => {
    assert.equal(averagePartyLevel([{ level: 3 }, { level: 5 }]).apl, 4);
  });

  test("unreadable levels are ignored, not counted as zero", () => {
    // Counting a junk sheet as 0 would drag the whole party's stakes down.
    const r = averagePartyLevel([4, 4, undefined, null, "x"]);
    assert.equal(r.apl, 4);
    assert.equal(r.counted, 2);
  });

  test("an empty party is APL 1, not 0", () => {
    // Level 0 is a real Shadowdark level; "nobody" is not a level-0 party.
    const r = averagePartyLevel([]);
    assert.equal(r.apl, 1);
    assert.equal(r.counted, 0);
  });
});

describe("venue rows", () => {
  test("the five bands cover 2–12 with no gap", () => {
    const seen = new Set();
    for (let total = 2; total <= 12; total++) seen.add(venueRowFor(total).row);
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5]);
  });

  test("the top two bands are single numbers", () => {
    assert.equal(venueRowFor(10).row, 3);
    assert.equal(venueRowFor(11).row, 4);
    assert.equal(venueRowFor(12).row, 5);
  });

  test("totals outside 2d6 clamp instead of returning nothing", () => {
    assert.equal(venueRowFor(1).row, 1);
    assert.equal(venueRowFor(13).row, 5);
    assert.equal(venueRowFor(undefined).row, 1);
  });
});

describe("twist bands", () => {
  test("the four bands cover 2–12 with no gap", () => {
    assert.equal(TWIST_BANDS.length, 4);
    const seen = new Set();
    for (let total = 2; total <= 12; total++) seen.add(twistFor(total).key);
    assert.deepEqual([...seen].sort(), ["boon", "danger", "none", "stakesUp"]);
  });

  test("each band lands on its printed range", () => {
    const cases = [[2, "danger"], [5, "danger"], [6, "none"], [9, "none"],
      [10, "stakesUp"], [11, "stakesUp"], [12, "boon"]];
    for (const [total, key] of cases) assert.equal(twistFor(total).key, key, `total ${total}`);
  });

  test("only the extra-danger band calls for a second die", () => {
    assert.equal(twistFor(3).subRoll, "1d4");
    for (const total of [7, 10, 12]) assert.equal(twistFor(total).subRoll, null, `total ${total}`);
  });

  test("the middle band is the most likely outcome", () => {
    // 6–9 on 2d6 is the fat part of the curve: most bouts have no twist at all.
    let none = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      if (twistFor(a + b).key === "none") none++;
    }
    assert.equal(none, 20);   // of 36
  });
});

describe("danger level", () => {
  test("the module suggests from the stakes and never from the venue", () => {
    // The book gives the GM stakes AND venue then says the GM decides. Only the
    // stakes half is derivable; a venue risk column would have to be invented.
    assert.equal(suggestedDanger("low").key, "low");
    assert.equal(suggestedDanger("mid").key, "mid");
    assert.equal(suggestedDanger("high").key, "high");
    assert.equal(suggestedDanger("epic").key, "high", "epic fights at High danger");
  });

  test("high and epic share one encounter tier, so there are three, not four", () => {
    assert.equal(DANGER_LEVELS.length, 3);
    assert.deepEqual(DANGER_LEVELS.map((d) => d.encounterTier), ["low", "mid", "high-epic"]);
  });

  test("an unknown key falls back to Mid rather than throwing", () => {
    assert.equal(dangerFor("nonsense").key, "mid");
    assert.equal(dangerFor(undefined).key, "mid");
  });
});

describe("bout assembly", () => {
  test("a plain bout records the rolls and derives the rest", () => {
    const bout = buildBout({ venueTotal: 7, stakesTotal: 8, apl: 3, group: false });
    assert.equal(bout.venue.row, 2);
    assert.equal(bout.stakes.key, "mid");
    assert.equal(bout.stakes.raised, false);
    assert.equal(bout.danger.key, "mid");
    assert.equal(bout.danger.overridden, false);
    assert.equal(bout.encounterTable, "Mid Stakes Pit Fight (solo)");
    assert.equal(bout.twist, null, "an unrolled twist stays unrolled");
  });

  test("the stakes-raising twist moves the prize table", () => {
    const bout = buildBout({ venueTotal: 7, stakesTotal: 4, twistTotal: 10 });
    assert.equal(bout.stakes.rolledKey, "low");
    assert.equal(bout.stakes.key, "mid", "raised a step");
    assert.equal(bout.stakes.raised, true);
    assert.equal(bout.stakes.table, "Mid Stakes");
  });

  test("a raised purse does not make the fight deadlier", () => {
    // The GM set the danger and the fighters accepted on that basis before the
    // twist was revealed, so danger follows the ROLLED stakes.
    const bout = buildBout({ venueTotal: 7, stakesTotal: 4, twistTotal: 10 });
    assert.equal(bout.danger.key, "low");
    assert.equal(bout.encounterTable, "Low Stakes Pit Fight (solo)");
  });

  test("a GM override changes the danger and the table with it", () => {
    const bout = buildBout({ venueTotal: 12, stakesTotal: 3, danger: "high", group: true });
    assert.equal(bout.stakes.key, "low");
    assert.equal(bout.danger.key, "high");
    assert.equal(bout.danger.suggested, "low");
    assert.equal(bout.danger.overridden, true);
    assert.equal(bout.encounterTable, "High/epic Stakes Pit Fight (group)");
  });

  test("an override that agrees with the suggestion is not flagged as one", () => {
    const bout = buildBout({ venueTotal: 7, stakesTotal: 8, danger: "mid" });
    assert.equal(bout.danger.overridden, false);
  });
});

describe("bout renown", () => {
  test("the default is a flat point for a win and nothing for a loss", () => {
    // CS2 prints no renown value for a bout, so this is the module's default and
    // not a rule. It must not scale with stakes, which would read as one.
    assert.equal(suggestedRenown("win"), 1);
    assert.equal(suggestedRenown("loss"), 0);
    assert.equal(suggestedRenown(undefined), 0);
  });
});

describe("every table the roller asks for is one the importer can produce", () => {
  const cs2Names = new Set(
    TABLE_MANIFEST.filter((r) => r.source === "cs2").map((r) => r.name),
  );

  test("all six encounter tables exist in the manifest under those exact names", () => {
    for (const danger of ["low", "mid", "high"]) {
      for (const group of [false, true]) {
        const name = encounterTableName({ danger, group });
        assert.ok(cs2Names.has(name), `manifest has no CS2 table named "${name}"`);
      }
    }
  });

  test("all four prize tables exist in the manifest", () => {
    for (const tier of STAKES_TIERS) {
      assert.ok(cs2Names.has(tier.table), `manifest has no CS2 table named "${tier.table}"`);
    }
  });

  test("the three set-up tables exist in the manifest", () => {
    for (const name of ["Venue", "Stakes", "Twist"]) {
      assert.ok(cs2Names.has(name), `manifest has no CS2 table named "${name}"`);
    }
  });

  test("solo and group are distinct tables at every danger level", () => {
    const names = new Set();
    for (const danger of ["low", "mid", "high"]) {
      for (const group of [false, true]) names.add(encounterTableName({ danger, group }));
    }
    assert.equal(names.size, 6);
  });
});
