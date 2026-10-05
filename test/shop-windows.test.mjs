import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), "utf8");

// The shop windows were rebuilt on the UI kit. Their actions and the classes their scripts select on must survive.
const WINDOWS = [
  ["templates/magic-forge.hbs", "scripts/magic-forge/magic-forge-app.mjs",
    ["setType", "setMode", "setBonus", "pickBase", "clearBase", "toggleSpell", "setTier", "openSpell", "coreRoll", "coreClear", "coreImport", "createItem"],
    ["sde-forge-base-search", "sde-forge-base-row", "sde-forge-spell-search", "sde-forge-spell-group", "sde-forge-spell-row", "sde-forge-tier", "sde-forge-core-select", "sde-forge-preview-name", "sde-forge-preview-lines", "sde-forge-create", "name=\"identified\"", "id=\"sde-forge-name\""]],
  ["templates/bastion-shop.hbs", "scripts/bastion/bastion-shop-app.mjs",
    ["buy"],
    ["sde-bs-list", "sde-bs-row", "name=\"buyer\"", "name=\"search\"", "name=\"qty\"", "data-name="]],
];

for (const [tpl, app, actions, hooks] of WINDOWS) {
  test(`${tpl} keeps its actions and script hooks and its window carries the kit class`, async () => {
    const [hbs, src] = await Promise.all([read(tpl), read(app)]);
    for (const a of actions) assert.ok(hbs.includes(`data-action="${a}"`), `${a} control missing`);
    for (const h of hooks) assert.ok(hbs.includes(h), `${h} hook missing`);
    assert.match(src, /classes:\s*\[[^\]]*"sde-ui"/);
    assert.ok(!hbs.includes("SDE.proposed"));
  });
}

test("the spell tier chips show the chosen tier in both the old and the kit class", async () => {
  const src = await read("scripts/magic-forge/magic-forge-app.mjs");
  assert.match(src, /chip\.classList\.toggle\("active"/);
  assert.match(src, /chip\.classList\.toggle\("sel"/);
});

test("the merchant window keeps every control class its script selects on", async () => {
  const [hbs, src] = await Promise.all([read("templates/merchant-shop.hbs"), read("scripts/merchant/merchant-shop.mjs")]);
  const created = new Set(["sdems-item-desc", "sdems-chat-card-v2", "sdems-shop-card-open-btn"]);
  const used = [...new Set(src.match(/sdems-[a-z-]+/g))].filter((c) => !created.has(c) && !c.endsWith("-v"));
  assert.ok(used.length > 40);
  for (const c of used) assert.ok(hbs.includes(c), `${c} missing from the template`);
  assert.match(src, /classes:\s*\[[^\]]*"sde-ui"/);
});

test("the merchant stock tooltip reads an unlimited flag instead of comparing a display string", async () => {
  const [hbs, src] = await Promise.all([read("templates/merchant-shop.hbs"), read("scripts/merchant/merchant-shop.mjs")]);
  assert.match(hbs, /else if unlimited\}\}\{\{localize 'SDE\.merchant\.stockUnlimited'\}\}/);
  assert.doesNotMatch(hbs, /eq stockDisplay/);
  assert.match(src, /unlimited: entry\.stock === -1,/);
});
