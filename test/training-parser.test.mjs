import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseTrainerPage } from "../scripts/training/training-parser.mjs";

/**
 * Every fixture here is INVENTED, per the repo's rule that no book text ships.
 * What they reproduce is the SHAPE the column splitter emits — which is the
 * only thing the parser knows about — including the three traps that shape
 * carries: the display title sorting after the tasks, a bare page number
 * landing inside the task block, and tasks wrapping across lines.
 */
const SPREAD = [
  "Wilhelmina keeps a quiet forge",
  "at the edge of the fen and sings",
  "to the coals until they answer.",
  "TASKS",
  "1. Carry a lit coal across the",
  "marsh without letting it die.",
  "2. Recover the tongs she threw",
  "into the deep pool in a temper.",
  "3. Name the note a true blade",
  "rings at when it is struck.",
  "4. Forge a nail good enough that",
  "she cannot tell it from her own.",
  "404",
  "Coalsinging Training With",
  "Wilhelmina",
  "BENEFITS",
  "If you complete a task,",
  "Wilhelmina teaches you a new",
  "technique. You gain one of the",
  "following benefits (once each):",
  "BENEFITS",
  "d4 Benefit",
  "1 Something the table decides",
].join("\n");

describe("parseTrainerPage", () => {
  const p = parseTrainerPage(SPREAD);

  it("reads the description from before the TASKS caption", () => {
    // The display title sorts AFTER the tasks, so "everything before TASKS"
    // is the description and nothing else is.
    assert.equal(
      p.description,
      "Wilhelmina keeps a quiet forge at the edge of the fen and sings to the coals until they answer."
    );
  });

  it("reads four tasks, rejoining the lines each one wraps across", () => {
    assert.equal(p.tasks.length, 4);
    assert.equal(p.tasks[0], "Carry a lit coal across the marsh without letting it die.");
    assert.equal(p.tasks[3], "Forge a nail good enough that she cannot tell it from her own.");
  });

  it("stops at the page number sitting inside the task block", () => {
    // The real trap: a bare page number lands between task 4 and the title.
    // Glued on, it would end every fourth task with a stray number.
    assert.ok(!p.tasks.some((t) => /404/.test(t)), "404 must not be swallowed into a task");
  });

  it("never reads the benefits — the RollTable is their one source", () => {
    const joined = `${p.description} ${p.tasks.join(" ")}`;
    assert.ok(!/BENEFITS|d4 Benefit|the table decides/i.test(joined));
  });

  it("reports ok with nothing left to flag on a clean read", () => {
    assert.equal(p.ok, true);
    assert.equal(p.why, "");
  });
});

describe("parseTrainerPage — pages that do not cooperate", () => {
  it("refuses a page with no TASKS caption rather than filing an empty entry", () => {
    const r = parseTrainerPage("Just some prose about a place.\nAnd more of it.");
    assert.equal(r.ok, false);
    assert.equal(r.why, "no TASKS caption");
    assert.deepEqual(r.tasks, []);
  });

  it("files a short read and says it is short", () => {
    const r = parseTrainerPage(["A trainer.", "TASKS", "1. Only this one.", "88", "X Training With"].join("\n"));
    assert.equal(r.ok, true);
    assert.equal(r.tasks.length, 1);
    assert.equal(r.why, "read 1 of 4 tasks");
  });

  it("drops page furniture appearing before the first numbered task", () => {
    const r = parseTrainerPage(["A trainer.", "TASKS", "stray header", "1. The task.", "BENEFITS"].join("\n"));
    assert.deepEqual(r.tasks, ["The task."]);
  });

  it("handles an empty or absent page without throwing", () => {
    for (const input of ["", null, undefined, "   \n  \n"]) {
      const r = parseTrainerPage(input);
      assert.equal(r.ok, false);
      assert.deepEqual(r.tasks, []);
    }
  });

  it("stops at a bare 'With' line, which is how one title splits", () => {
    // Piracy's title breaks as "… / Training With" across the column split.
    const r = parseTrainerPage(["A trainer.", "TASKS", "1. The task.", "With", "junk"].join("\n"));
    assert.deepEqual(r.tasks, ["The task."]);
  });
});
