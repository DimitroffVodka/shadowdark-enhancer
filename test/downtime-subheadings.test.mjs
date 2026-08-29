/**
 * Downtime sub-heading tolerance.
 *
 * The bug this pins, reported live 2026-08-29: a GM pasted all four activities
 * and the window showed only Spiritualism and Skulduggery. Nothing was missing
 * from the paste — those two need only an ALL-CAPS header plus a check line,
 * while Martial Training and Magical Research each need a SUB-heading, and both
 * matchers were anchored so tightly that a missing period or a trailing colon
 * left the segment unopened. Every bullet then resolved to nothing, both
 * activities stayed empty, and an activity with no rows isn't drawn.
 *
 * It also failed silently: the parser's "couldn't place this line" codes had no
 * prose, so they rendered as quiet info notes. Both halves are pinned here.
 *
 * Every fixture is INVENTED — synthetic outcome sentences sharing the published
 * structure without reproducing a sentence of anyone's book.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseDowntimeText } from "../scripts/downtime/downtime-parser.mjs";
import { warningLines } from "../scripts/downtime/downtime-warnings.mjs";

const keys = (r) => Object.keys(r.filled);
const problems = (r) => warningLines(r).filter((l) => !l.info).map((l) => l.text);

describe("martial tier lines", () => {
  const tierPaste = (line) => `MARTIAL TRAINING\n${line}\n• DC 9*: Borrow a rack of spare armor or weapon kit.`;

  for (const line of [
    "d8+. INT, STR, or DEX Check",   // as the book prints it
    "d8+ INT, STR, or DEX Check",    // period lost in a PDF copy
    "d8. INT, STR, or DEX Check",
    "d8+: INT, STR, or DEX Check",
    "d8+.",                          // tier alone on its line
  ]) {
    test(`opens the tier from ${JSON.stringify(line)}`, () => {
      assert.deepEqual(keys(parseDowntimeText(tierPaste(line), { source: "cs6" })), ["d8-new-armor-weapon"]);
    });
  }

  test("a wrapped bullet starting with a die size does NOT open a tier", () => {
    // "New weapon (d6 max)" wraps easily. Swallowing that line as a tier header
    // would silently move every bullet after it into the wrong tier.
    const r = parseDowntimeText(
      "MARTIAL TRAINING\nd4. INT, STR, or DEX Check\n" +
      "• DC 18*: Take up a new weapon of modest heft, no larger than\nd6 max, and drill with it.",
      { source: "cs6" },
    );
    assert.deepEqual(keys(r), ["d4-new-weapon"]);
    assert.match(r.filled["d4-new-weapon"], /d6 max, and drill with it\.$/);
  });

  test("a wrapped bullet does not open a tier on a dash either", () => {
    // The comma form above was the only pinned shape, but a wrapped outcome
    // line reaches the parser hyphenated or em-dashed just as easily, and a
    // dash used to count as tier punctuation — so each of these opened a tier
    // without naming a check and re-homed every bullet below it.
    for (const wrap of [
      "d6-max weapon, and drill with it.",
      "d6 - the heaviest blade you can lift.",
      "d8 – a wrapped line of outcome text.",
      "d8+ — another wrapped line of outcome text.",
    ]) {
      const r = parseDowntimeText(
        "MARTIAL TRAINING\nd4. INT, STR, or DEX Check\n" +
        `• DC 18*: Take up a new weapon of modest heft, no larger than\n${wrap}`,
        { source: "cs6" },
      );
      assert.deepEqual(keys(r), ["d4-new-weapon"], `"${wrap}" must not open a tier`);
      assert.ok(r.filled["d4-new-weapon"].endsWith(wrap),
        `"${wrap}" belongs to the bullet above it: ${r.filled["d4-new-weapon"]}`);
    }
  });

  test("a real tier heading still opens on a dash when it names its check", () => {
    // Dropping the dash from the punctuation shape must not cost a page that
    // genuinely separates that way — the check on the same line carries it.
    const r = parseDowntimeText(
      tierPaste("d8+ — INT, STR, or DEX Check"),
      { source: "cs6" },
    );
    assert.deepEqual(keys(r), ["d8-new-armor-weapon"]);
  });
});

describe("caster and check lines", () => {
  const casterPaste = (line) => `MAGICAL RESEARCH\n${line}\n• DC 12: Study a scroll closely for an edge.`;

  for (const line of ["INT or CHA Spellcasters", "INT or CHA Spellcasters:", "INT OR CHA SPELLCASTERS"]) {
    test(`opens the arcane list from ${JSON.stringify(line)}`, () => {
      assert.deepEqual(keys(parseDowntimeText(casterPaste(line), { source: "cs6" })), ["arcane-scroll-adv"]);
    });
  }

  test("a check line keeps routing skulduggery's two groups when it carries a colon", () => {
    const r = parseDowntimeText(
      "SKULDUGGERY\nCHA Check:\n• DC 9: Spread a rumor about a rival.\n" +
      "DEX Check:\n• DC 15*: Lift a purse by petty theft.",
      { source: "cs6" },
    );
    assert.deepEqual(keys(r).sort(), ["minor-crime", "rumor"]);
  });
});

describe("the reported symptom", () => {
  // Complete paste, real-world punctuation: previously yielded ONLY the first
  // two activities, with no error that said so.
  const FULL = `
SPIRITUALISM
WIS Check
• DC 9: Sweep the church steps and earn goodwill.
SKULDUGGERY
CHA Check:
• DC 9: Spread a rumor about a rival.
MARTIAL TRAINING
d8+ INT, STR, or DEX Check
• DC 9*: Borrow a rack of spare armor or weapon kit.
MAGICAL RESEARCH
INT or CHA Spellcasters:
• DC 12: Study a scroll closely for an edge.
`;

  test("all four activities fill, and nothing is left unplaced", () => {
    const r = parseDowntimeText(FULL, { source: "cs6" });
    assert.deepEqual(keys(r).sort(), ["arcane-scroll-adv", "church-favor", "d8-new-armor-weapon", "rumor"]);
    assert.deepEqual(r.unmatchedBullets, []);
  });
});

describe("a sub-heading that never opens is reported as a problem", () => {
  const NO_SUBHEADS = `
MARTIAL TRAINING
Tier by hit die
• DC 9*: Borrow a rack of spare armor or weapon kit.
• DC 12*: Sharpen one blade for +1 hit and damage.
MAGICAL RESEARCH
Spellcasters of any stripe
• DC 12: Study a scroll closely for an edge.
`;
  const r = parseDowntimeText(NO_SUBHEADS, { source: "cs6" });

  test("nothing is guessed", () => {
    assert.deepEqual(r.filled, {});
    assert.equal(r.unmatchedBullets.length, 3);
  });

  test("each activity gets a loud note naming the line the paste needs", () => {
    const lines = problems(r);
    const martial = lines.find((t) => t.includes("Martial Training"));
    const magical = lines.find((t) => t.includes("Magical Research"));
    assert.ok(martial, "no note for martial training");
    assert.ok(magical, "no note for magical research");
    assert.match(martial, /d4\. INT, STR, or DEX Check/);
    assert.match(magical, /INT or CHA Spellcasters/);
  });

  test("the per-bullet codes collapse to one line per activity, not one per bullet", () => {
    // 3 unplaced bullets, but only 2 activities failed to open.
    const notes = problems(r).filter((t) => t.includes("no sub-heading"));
    assert.equal(notes.length, 2);
  });

  test("these are problems, never quiet info notes", () => {
    const quiet = warningLines(r).filter((l) => l.info).map((l) => l.text);
    assert.deepEqual(quiet, [], `unexpected info-level notes: ${quiet.join(" | ")}`);
    assert.equal(warningLines(r).every((l) => !/^Parser note:/.test(l.text)), true);
  });
});
