import { test } from "node:test";
import assert from "node:assert/strict";
import { npcPreviewModel, npcPreviewHtml } from "../scripts/encounter/npc-preview.mjs";

const werewolf = {
  uuid: "Compendium.x.Actor.w", name: "Were<wolf>", img: "w.webp",
  system: { level: { value: 5 }, alignment: "chaotic", attributes: { hp: { value: 24, max: 24 }, ac: { value: 12 } }, move: "near",
    spellcasting: { attacks: 0 } },
  items: [
    { type: "NPC Attack", name: "Bite", system: { attack: { num: 2 }, bonuses: { attackBonus: 4 }, damage: { value: "1d8", special: "" }, ranges: ["close"] } },
    { type: "NPC Special Attack", name: "Howl", system: { description: "<p>All who hear it are <b>afraid</b>.</p>" } },
    { type: "NPC Feature", name: "Curse", system: { description: "@UUID[Item.x]{Lycanthropy} <p>Bitten PCs [[/r 1d6]] days</p>" } },
  ],
};

test("npcPreviewModel carries the stats, every attack and the features", () => {
  const m = npcPreviewModel(werewolf);
  assert.equal(m.level, "5");
  assert.equal(m.ac, "12");
  assert.equal(m.hp, "24");
  assert.deepEqual(m.attacks.map((a) => a.name), ["Bite", "Howl"]);
  assert.equal(m.attacks[0].text, "2× +4 · 1d8");
  assert.equal(m.attacks[1].extra, "All who hear it are afraid.");
  assert.equal(m.features[0].text, "Lycanthropy Bitten PCs 1d6 days");
});

test("npcPreviewHtml escapes names and always ends on the double-click hint", () => {
  const html = npcPreviewHtml(npcPreviewModel(werewolf));
  assert.match(html, /Were&lt;wolf&gt;/);
  assert.doesNotMatch(html, /<wolf>/);
  assert.match(html, /<strong>/);
  assert.match(html, /sde-np-hint">SDE\.encounter\.openSheetTip</);
});

test("an NPC with no attacks or features leaves those sections out", () => {
  const html = npcPreviewHtml(npcPreviewModel({ name: "Bat", system: {}, items: [] }));
  assert.doesNotMatch(html, /preview\.attacks|preview\.features/);
});
