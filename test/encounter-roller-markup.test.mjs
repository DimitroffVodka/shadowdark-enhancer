import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

test("the roller's tab, slot and browse-row selectors match the template's markup", async () => {
  const [app, tpl] = await Promise.all([
    read("scripts/encounter/encounter-roller-app.mjs"),
    read("templates/encounter-roller.hbs"),
  ]);
  // Tab buttons live in .ui-tabs; the panes carry data-tab too, so the selector must stay inside the nav.
  assert.match(app, /querySelectorAll\("\.ui-tabs \[data-tab\]"\)/);
  assert.match(tpl, /<nav class="ui-tabs">[\s\S]*<\/nav>/);
  assert.match(tpl, /<tr [^>]*data-slot-idx="\{\{this\.idx\}\}"/);
  assert.match(app, /querySelectorAll\("tr\[data-slot-idx\]"\)/);
  assert.match(tpl, /<tr class="er-browse-row" draggable="true" data-uuid="\{\{this\.uuid\}\}"/);
  assert.match(app, /querySelectorAll\("tr\[data-uuid\]\[draggable\]"\)/);
  for (const gone of ["sde-tabs", "sde-build-slot", "sde-browse-row"]) {
    assert.doesNotMatch(app, new RegExp(`\\.${gone}(?![\\w-])`), `.${gone} is no longer selected`);
  }
});

test("the Monster Creator opens one tab at a time", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(src, /_openSection\(section\) \{\s*for \(const key of Object\.keys\(this\._sectionOpen\)\) this\._sectionOpen\[key\] = key === section;/);
  assert.match(src, /if \(this\._sectionOpen\[section\]\) this\._sectionOpen\[section\] = false;\s*else this\._openSection\(section\);/);
  // No call site opens a tab by assigning its flag directly (that would leave two open).
  assert.doesNotMatch(src, /this\._sectionOpen\.\w+ = true/);
});

test("a creature result offers the Battle map and Choose map buttons, both routed to one handler", async () => {
  const [app, tpl] = await Promise.all([
    read("scripts/encounter/encounter-roller-app.mjs"),
    read("templates/encounter-roller.hbs"),
  ]);
  // Only the creature card: the flavor card has no creature to put on a map.
  const creature = tpl.slice(tpl.indexOf('class="ui-card sel"'));
  assert.match(creature, /data-action="battleMap"/);
  assert.match(creature, /data-action="chooseBattleMap"/);
  assert.doesNotMatch(tpl.slice(0, tpl.indexOf('class="ui-card sel"')), /data-action="battleMap"/);
  assert.match(app, /battleMap:\s+EncounterRollerApp\.prototype\._onBattleMap/);
  assert.match(app, /chooseBattleMap:\s+EncounterRollerApp\.prototype\._onBattleMap/);
});
