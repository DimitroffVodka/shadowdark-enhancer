import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");
const lookup = (en, key) => key in en || key.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), en) !== undefined;

test("Boat sheet template: every data-action has a handler", async () => {
  const hbs = await read("templates/actors/boat-sheet.hbs");
  const handlers = new Set();
  for (const file of ["scripts/actors/boat-sheet.mjs", "scripts/actors/vehicle-sheet.mjs"]) {
    for (const m of (await read(file)).matchAll(/^\s{6}([A-Za-z]+): \w+\.prototype\./gm)) handlers.add(m[1]);
  }
  const actions = new Set([...hbs.matchAll(/data-action="([A-Za-z]+)"/g)].map((m) => m[1]));
  for (const action of ["changeTab", "placeTokens", "openOccupant", "removeOccupant", "openItem", "deleteItem", "weaponAttack", "weaponDamage",
    "beginSinking", "advanceSinking", "stopSinking", "sinkChance", "rightShip"]) assert.ok(actions.has(action), `${action} is in the template`);
  for (const action of actions) assert.ok(handlers.has(action), `no handler for ${action}`);
});

test("Boat sheet: tabs are anchors and the drop zones and role selects the script binds are there", async () => {
  const hbs = await read("templates/actors/boat-sheet.hbs");
  const tabs = [...hbs.matchAll(/<(a|button)\b[^>]*data-action="changeTab"/g)];
  assert.equal(tabs.length, 5);
  for (const [, tag] of tabs) assert.equal(tag, "a");
  for (const hook of ['data-drop="occupant"', 'data-drop="inventory"', 'data-drop="weapon"', "select data-role", 'data-tab-content="overview"', 'name="system.notes"']) {
    assert.ok(hbs.includes(hook), `missing ${hook}`);
  }
  assert.equal([...hbs.matchAll(/data-tab-content="/g)].length, 5);
});

test("Boat sheet template: every string comes from a language key", async () => {
  const hbs = await read("templates/actors/boat-sheet.hbs");
  const en = JSON.parse(await read("languages/en.json"));
  for (const m of hbs.matchAll(/localize ['"]([^'"]+)['"]/g)) assert.ok(lookup(en, m[1]), `missing string ${m[1]}`);
});
