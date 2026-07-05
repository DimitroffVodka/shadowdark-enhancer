import test from "node:test";
import assert from "node:assert/strict";
import { titleCaseName, splitStatblocks, parseStatblock } from "../scripts/encounter/statblock-parser.mjs";

test("titleCaseName", () => {
  assert.equal(titleCaseName("GOBLIN"), "Goblin");
  assert.equal(titleCaseName("BAT, GIANT"), "Bat, Giant");
  assert.equal(titleCaseName("will-o'-wisp"), "Will-O'-Wisp");
});

const GOBLIN = [
  "GOBLIN",
  "AC 12, HP 4, ATK 1 shortsword +1 (1d6), MV near,",
  "S -1, D +2, C +0, I -1, W -1, Ch -1, AL C, LV 1",
  "A small, wicked humanoid that hates the sun.",
].join("\n");

test("splitStatblocks identifies a well-formed monster block", () => {
  const { monsters } = splitStatblocks(GOBLIN);
  assert.equal(monsters.length, 1);
  assert.match(monsters[0], /GOBLIN/);
});

test("splitStatblocks skips a non-stat lore block", () => {
  const lore = "THE UNDERWORLD\nA sunless realm beneath the earth where horrors dwell.";
  const { monsters, skipped } = splitStatblocks(lore);
  assert.equal(monsters.length, 0);
  assert.ok(skipped.length >= 1);
});

test("parseStatblock extracts the name, level, and core stats", () => {
  const { draft } = parseStatblock(GOBLIN);
  assert.equal(draft.name, "Goblin");
  assert.equal(draft.level, 1);
  assert.equal(draft.ac, 12);
  assert.equal(draft.hp.value, 4);
  assert.equal(draft.abilities.dex, 2);
});
