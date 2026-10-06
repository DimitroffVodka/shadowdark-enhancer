import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abilityLabel, abilityInfo, ABILITY_ORDER } from "../scripts/char-builder/constants.mjs";
const en = JSON.parse(readFileSync("languages/en.json", "utf8"));
const read = path => readFileSync(path, "utf8");
globalThis.game = { i18n: { localize: key => en[key] ?? key } };

test("ability labels and reference text come from en.json", () => {
  assert.deepEqual(ABILITY_ORDER.map(abilityLabel), ["STR", "DEX", "CON", "INT", "WIS", "CHA"]);
  for (const key of ABILITY_ORDER) {
    const info = abilityInfo(key);
    assert.deepEqual(Object.keys(info), ["label", "represents", "checks", "mechanics", "keyClasses"]);
    for (const [field, text] of Object.entries(info)) assert.ok(text && !text.startsWith("SDE."), `${key}.${field}`);
  }
  assert.equal(abilityInfo("str").label, "Strength");
});
test("the HP and Gold steps carry no literal English or inline style", () => {
  const hp = read("templates/char-builder/steps/hp.hbs"), gold = read("templates/char-builder/steps/gold.hbs");
  assert.doesNotMatch(hp, /\+ CON \(/);
  assert.match(hp, /SDE\.charBuilder\.ability\.con\.short/);
  assert.doesNotMatch(gold, /2d6 × 5|style=/);
  assert.match(gold, /SDE\.charBuilder\.gold\.rollFormula/);
  assert.ok(!String(en["SDE.charBuilder.gold.rollFormula"] ?? "").startsWith("SDE."));
  assert.doesNotMatch(hp + gold, /style=/);
  assert.doesNotMatch(read("scripts/char-builder/constants.mjs"), /Physical power/);
});
