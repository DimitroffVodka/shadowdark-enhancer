import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), "utf8");

// Every action a window's app registers must still have a control in its template, and the hooks its script
// queries must still exist. The windows were rebuilt on the UI kit; the behaviour is unchanged.
const WINDOWS = [
  ["templates/loot-generator.hbs", "scripts/loot/loot-generator-app.mjs", ["rollLoot", "rollForToken", "postEntry", "giveEntry", "dropEntry", "dropCoinsPrompt", "clearHistory", "forgeEntryItem", "openSetup", "toggleFavourite", "toggleFavOnly"], ["data-loot-table", "sde-lootgen-recipient"]],
  ["templates/loot-setup.hbs", "scripts/loot/loot-setup-app.mjs", ["bindLibrary", "bindCustom", "unlockLibrary", "addPicker", "removePicker"], ["data-picker-add", "data-custom-tier", "data-custom-table"]],
  ["templates/monster-loot-review.hbs", "scripts/loot/monster-loot-review-app.mjs", ["openSheet"], ["data-ml-filter", "data-actor-id", "sde-ml-list", 'name="table"', 'name="chance"']],
  ["templates/forge-loot.hbs", "scripts/forge-loot/forge-loot-app.mjs", ["selectGenerator", "generatePreview", "reroll", "cancel", "approve", "reset"], ["data-forge-input"]],
  ["templates/party-xp.hbs", "scripts/party-xp/party-xp.mjs", ["award", "selectAll", "selectNone", "clearItem"], ["sde-pxp-drop", "data-member", 'name="amount"', 'name="label"', 'name="saveToItem"']],
];

for (const [tpl, app, actions, hooks] of WINDOWS) {
  test(`${tpl} keeps its actions and script hooks and its window carries the kit class`, async () => {
    const [hbs, src] = await Promise.all([read(tpl), read(app)]);
    for (const a of actions) assert.ok(hbs.includes(`data-action="${a}"`), `${a} control missing`);
    for (const h of hooks) assert.ok(hbs.includes(h), `${h} hook missing`);
    assert.match(src, /classes:\s*\["sde-ui"/);
    assert.ok(!hbs.includes("SDE.proposed"));
  });
}
