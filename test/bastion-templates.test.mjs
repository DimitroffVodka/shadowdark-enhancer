import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");
const lang = async () => JSON.parse(await read("languages/en.json"));

const actionsOf = (hbs) => new Set([...hbs.matchAll(/data-action="([A-Za-z]+)"/g)].map((m) => m[1]));
const jsActions = (js) => new Set([...js.matchAll(/^\s{6}([A-Za-z]+): \w+\.prototype\./gm)].map((m) => m[1]));
const keysOf = (hbs) => new Set([...hbs.matchAll(/localize ['"]([^'"]+)['"]/g)].map((m) => m[1]));
const lookup = (en, key) => key in en || key.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), en) !== undefined;

test("Bastion sheet template: every data-action has a handler and every string a key", async () => {
  const hbs = await read("templates/actors/bastion-sheet.hbs");
  const handlers = jsActions(await read("scripts/bastion/bastion-sheet.mjs"));
  for (const action of actionsOf(hbs)) assert.ok(action === "editImage" || handlers.has(action), `no handler for ${action}`);
  const en = await lang();
  for (const key of keysOf(hbs)) assert.ok(lookup(en, key), `missing string ${key}`);
});

test("Bastion sheet: controls a viewer who cannot edit still needs are anchors, not buttons", async () => {
  const hbs = await read("templates/actors/bastion-sheet.hbs");
  for (const action of ["changeTab", "setView", "toggleRoofs", "exportSvg", "exportPng"]) {
    const tags = [...hbs.matchAll(new RegExp(`<(a|button)\\b[^>]*data-action="${action}"`, "g"))];
    assert.ok(tags.length, `${action} is in the template`);
    for (const [, tag] of tags) assert.equal(tag, "a", `${action} must be an anchor`);
  }
});

test("Bastion sheet keeps the hooks its script binds", async () => {
  const hbs = await read("templates/actors/bastion-sheet.hbs");
  for (const hook of ["select data-bastion-type", "sde-bastion-map", "sde-bastion-card", 'data-card="{{id}}"', 'name="system.treasury"', 'name="system.hp.value"', 'name="system.party"']) {
    assert.ok(hbs.includes(hook), `missing ${hook}`);
  }
});

test("Bastion panel template: every data-action has a handler and every string a key", async () => {
  const hbs = await read("templates/bastion-panel.hbs");
  const js = await read("scripts/bastion/bastion-panel.mjs");
  const handlers = jsActions(js);
  for (const action of actionsOf(hbs)) assert.ok(handlers.has(action), `no handler for ${action}`);
  const en = await lang();
  for (const key of keysOf(hbs)) assert.ok(lookup(en, key), `missing string ${key}`);
  assert.match(js, /scrollable: \["\.ui-body"\]/);
});
