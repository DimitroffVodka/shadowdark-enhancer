/**
 * Downtime unlocks route through Manage → Downtime only (#313).
 *
 * The hub's Downtime section used to carry its own book `<select
 * data-downtime-source>`, and the Importing selector listed "Downtime" as a
 * standalone type — two ways to pick a book the Manage row had already picked.
 * The section is now fixed to the book that opened it, so the slug that keys
 * the `downtimeContent` world setting can only come from the row's
 * data-list-key (or the Downtime window's frozen
 * `openHub("import", { downtimeSource })` seed).
 *
 * ImporterHubApp binds to Foundry's ApplicationV2 runtime, so the routing is
 * pinned by reading the source rather than calling it (same approach as
 * mount-import.test.mjs). The patterns match raw text: when one misses, it
 * means the code was reformatted — update the pattern, not the claim.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const template = read("templates/importer-hub.hbs");
const pasteSource = read("scripts/importer/importer-hub-paste.mjs");
const appSource = read("scripts/importer/importer-hub-app.mjs");
const manageSource = read("scripts/importer/importer-hub-manage.mjs");
const batchSource = read("scripts/importer/importer-hub-batch.mjs");

describe("the Downtime section carries no book picker", () => {
  test("the template has no downtime source select", () => {
    assert.doesNotMatch(template, /data-downtime-source/);
    assert.doesNotMatch(template, /sde-hub-downtime-source/);
  });

  test("no script reads a downtime source select", () => {
    for (const [name, src] of [
      ["importer-hub-paste.mjs", pasteSource],
      ["importer-hub-app.mjs", appSource],
      ["importer-hub-manage.mjs", manageSource],
    ]) {
      assert.doesNotMatch(src, /select\[data-downtime-source\]/, `${name} must not query a picker that no longer exists`);
    }
  });

  test("the section names the book it was opened for as plain text", () => {
    // The fixed book shows through the pasteFrom note ("...from your own copy
    // of {book}"), not a control.
    assert.match(template, /SDE\.importer\.downtime\.pasteFrom" book=importData\.downtime\.label/);
  });
});

describe("the downtime slug comes from the row, never a select", () => {
  test("the parse branch derives its slug from _downtimeSource only", () => {
    const branch = pasteSource.match(/if \(type === "downtime"\) \{(?<body>[\s\S]*?)\n {4}\}/)?.groups?.body;
    assert.ok(branch,
      "downtime parse branch not found in _onHubParse — if it was reformatted, update this pattern");
    assert.match(branch,
      /const slug = DOWNTIME_SOURCES\[this\._downtimeSource\] \? this\._downtimeSource : DOWNTIME_SLUGS\[0\]/);
    assert.doesNotMatch(branch, /querySelector|\.value\b/);
  });

  test("a Manage row seeds the slug through data-list-key", () => {
    assert.match(manageSource,
      /async _onDowntimeSeedPaste\(event, target\) \{[\s\S]{0,400}target\?\.dataset\?\.listKey/);
    assert.match(manageSource,
      /_seedDowntimeUnlock\(slug\) \{[\s\S]{0,400}this\._importType = "downtime"[\s\S]{0,200}this\._downtimeSource = DOWNTIME_SOURCES\[slug\] \? slug : DOWNTIME_SLUGS\[0\]/);
  });

  test("the batch route hands the job's row slug to the same seed path", () => {
    assert.match(batchSource,
      /_batchRunDowntime\(job\) \{[\s\S]{0,400}dataset: \{ listKey: job\.entry\.listKey \?\? "" \}/);
  });

  test("_seedDowntimeUnlock is the only writer of the downtime import type", () => {
    const writers = [manageSource, appSource, pasteSource]
      .filter((src) => /_importType\s*=\s*"downtime"/.test(src));
    assert.deepEqual(writers, [manageSource]);
  });

  test("the Downtime window's frozen seed contract still opens the workspace", () => {
    assert.match(appSource, /seed\?\.downtimeSource/);
    assert.match(read("scripts/downtime/downtime-app.mjs"), /openHub\("import", \{ downtimeSource: slug \}\)/);
  });
});

describe("the Importing selector offers Downtime only while it is seeded", () => {
  const types = appSource.match(/typeGroups: \[(?<body>[\s\S]*?)\]\.map\(g =>/)?.groups?.body;
  const conditional = /\.\.\.\(t === "downtime" \? \[\{ value: "downtime", label: tr\("SDE\.importer\.type\.downtime"\) \}\] : \[\]\),?/;

  test("the only downtime entry is the one shown while the type is downtime", () => {
    assert.ok(types,
      "typeGroups list not found in the hub context — if it was reformatted, update this pattern");
    assert.match(types, conditional);
    assert.doesNotMatch(types.replace(conditional, ""), /"downtime"/);
  });

  test("a seeded downtime type is the selected option, not Auto-detect", () => {
    // The selected flag is derived from the same list, so an entry in the list is what makes it show.
    assert.match(appSource, /options: g\.options\.map\(o => \(\{ \.\.\.o, selected: o\.value === t \}\)\)/);
  });
});
