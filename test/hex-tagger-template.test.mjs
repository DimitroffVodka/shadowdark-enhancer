import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The block conditions a control sits inside, read from the template's own nesting.
 * Handlebars is not installed for the tests, so the template is read as text.
 */
function conditionsAround(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at > 0, `${marker} is in the template`);
  const stack = [];
  for (const m of source.slice(0, at).matchAll(/\{\{(#|\/)(if|unless|each|with)\b([^}]*)\}\}/g)) {
    if (m[1] === "#") stack.push(`${m[2]} ${m[3].trim()}`);
    else stack.pop();
  }
  return stack;
}

const template = readFileSync(new URL("../templates/hex-tagger.hbs", import.meta.url), "utf8");

test("the brush and the tag overlay are offered on a numbered map with nothing tagged yet", () => {
  // Painting is how the first tags get made. Gated on hasTags, a map the classifier reads badly (a
  // hand-drawn one) had no way to be painted by hand: the button only appeared once a hex was tagged.
  for (const marker of ['data-action="hxtBrush"', 'data-action="hxtShowTags" data-mode="terrain"']) {
    const around = conditionsAround(template, marker);
    assert.ok(around.includes("if origin"), `${marker} needs a numbered map`);
    assert.ok(!around.includes("if hasTags"), `${marker} must not wait for a tag: ${around.join(" > ")}`);
  }
});

test("sending the tags to Extras still waits for a tag, since there is nothing to send before", () => {
  assert.ok(conditionsAround(template, 'data-action="hxtBuildDataset"').includes("if hasTags"));
});

test("a map the importer made lists only its own book's keyed hexes (another book's number must not star a hex)", () => {
  const app = readFileSync(new URL("../scripts/hex-map/hex-tagger-app.mjs", import.meta.url), "utf8");
  const load = app.slice(app.indexOf("async _loadEntries()"), app.indexOf("_selectedEntries()"));
  assert.match(load, /hexPrint\(this\._scene\(\)\?\.getFlag\(MODULE_ID, "hexMapId"\)\)\?\.folder/, "the folder comes from the scene's hexMapId");
  assert.match(load, /sourceFolderName\(e\.doc\.getFlag\(MODULE_ID, HEX_FLAG\)\?\.source\) === folder/, "and only entries of that folder stay");
});
