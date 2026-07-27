// Committed regression tests for the Background paste parser. Fixtures are
// synthetic: only the metadata names and printed d100 range shape are retained.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCharContent } from "../scripts/importer/char-content/char-content-manifest.mjs";

const backgrounds = (text) =>
  parseCharContent(text, "backgrounds").map(({ draft }) => draft);

test("background parser accepts single values and hyphen/en-dash/em-dash ranges", () => {
  const drafts = backgrounds([
    "84 Cartographer. Synthetic single-value description.",
    "85-86 Meridian. Synthetic ASCII-hyphen description.",
    "87–88 Peasant. Synthetic en-dash description.",
    "89—90 Beggar. Synthetic em-dash description.",
    "91-92   Soldier. Synthetic range-with-extra-spacing description.",
  ].join("\n"));

  assert.deepEqual(drafts.map((d) => d.name), [
    "Cartographer",
    "Meridian",
    "Peasant",
    "Beggar",
    "Soldier",
  ]);
  assert.deepEqual(drafts.map((d) => d.description), [
    "<p>Synthetic single-value description.</p>",
    "<p>Synthetic ASCII-hyphen description.</p>",
    "<p>Synthetic en-dash description.</p>",
    "<p>Synthetic em-dash description.</p>",
    "<p>Synthetic range-with-extra-spacing description.</p>",
  ]);
  assert.ok(drafts.every((d) => d.type === "Background"));
});
