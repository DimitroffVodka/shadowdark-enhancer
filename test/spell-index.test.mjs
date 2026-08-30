import test from "node:test";
import assert from "node:assert/strict";

import { SpellIndex } from "../scripts/monster-creator/spell-index.mjs";

test("spell filtering can isolate generated Monster Spells or one exact source", () => {
  const rows = [
    { name: "Blast — Mage", tier: 2, sourceId: "monster-spells", isMonsterSpell: true },
    { name: "Magic Missile", tier: 1, sourceId: "shadowdark.spells", isMonsterSpell: false },
  ];

  assert.deepEqual(
    SpellIndex.filter(rows, { source: "monster-spells" }).map(row => row.name),
    ["Blast — Mage"],
  );
  assert.deepEqual(
    SpellIndex.filter(rows, { source: "shadowdark.spells" }).map(row => row.name),
    ["Magic Missile"],
  );
});

test("source options group generated Monster Spells ahead of compendium sources", () => {
  const rows = [
    { sourceId: "shadowdark.spells", sourceLabel: "Spells" },
    { sourceId: "monster-spells", sourceLabel: "Monster Spell — Mage", isMonsterSpell: true },
    { sourceId: "shadowdark.spells", sourceLabel: "Spells" },
  ];

  assert.deepEqual(SpellIndex.sourceOptions(rows), [
    { value: "", label: "All spell sources" },
    { value: "monster-spells", label: "Monster Spells" },
    { value: "shadowdark.spells", label: "Spells" },
  ]);
});

test("generated library rows expose monster provenance and source Actor links", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  let requestedFields = [];
  const fakePack = {
    collection: "world.shadowdark-enhancer--items",
    documentName: "Item",
    metadata: { type: "Item", label: "Shadowdark Enhancer — Items" },
    async getIndex({ fields }) {
      requestedFields = fields;
      return [{
        _id: "blast",
        uuid: "Compendium.world.shadowdark-enhancer--items.Item.blast",
        name: "Blast — Mage",
        type: "Spell",
        system: { tier: 2, range: "far", duration: { type: "instant", value: "" } },
        flags: {
          "shadowdark-enhancer": {
            monsterSpell: {
              generated: true,
              variant: true,
              conflict: true,
              warnings: [{ code: "unenriched-dice" }],
              sources: [{ actorName: "Mage", actorUuid: "Compendium.shadowdark.monsters.Actor.mage" }],
            },
          },
        },
      }];
    },
  };
  const packs = [fakePack];
  packs.get = id => packs.find(candidate => candidate.collection === id);
  globalThis.game = { packs, items: [], i18n: { localize: value => value } };
  globalThis.CONFIG = { SHADOWDARK: { SPELL_RANGES: {}, SPELL_DURATIONS: {} } };

  try {
    SpellIndex.invalidate();
    const rows = await SpellIndex.loadAll();
    const row = rows[0];
    assert.ok(requestedFields.includes("flags.shadowdark-enhancer.monsterSpell"));
    assert.equal(row.sourceId, "monster-spells");
    assert.equal(row.sourceLabel, "Monster Spell — Mage");
    assert.equal(row.isMonsterSpell, true);
    assert.equal(row.sourceActorUuid, "Compendium.shadowdark.monsters.Actor.mage");
    assert.equal(row.variant, true);
    assert.equal(row.conflict, true);
    assert.equal(row.warningCount, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
    SpellIndex.invalidate();
  }
});
