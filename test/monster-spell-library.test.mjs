import test from "node:test";
import assert from "node:assert/strict";

import {
  collectMonsterSpells,
  legacyMonsterSpellMaterializedFingerprint,
  materializeMonsterSpell,
  normalizeMonsterSpellAttachment,
  planMonsterSpellRefresh,
  validateMonsterSpell,
} from "../scripts/monster-creator/monster-spell-library-core.mjs";

function actor(name, uuid, spells) {
  return {
    name,
    uuid,
    sourcePack: "shadowdark.monsters",
    sourceLabel: "Shadowdark Core",
    sourceVersion: "4.0.6",
    items: spells.map((spell, index) => ({
      _id: `spell-${index}`,
      type: "Spell",
      img: "icons/svg/book.svg",
      system: {},
      effects: [],
      ...spell,
    })),
  };
}

test("identical embedded spells become one library entry with every source", () => {
  const entries = collectMonsterSpells([
    actor("Sphinx", "Compendium.shadowdark.monsters.Actor.sphinx", [
      { name: "Gate", system: { tier: 5, range: "self", description: "<p>Open a gate.</p>" } },
    ]),
    actor("Rathgamnon", "Compendium.shadowdark.monsters.Actor.rath", [
      { name: "Gate", system: { tier: 5, range: "self", description: "<p>Open a gate.</p>" } },
    ]),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Gate");
  assert.equal(entries[0].sources.length, 2);
  assert.deepEqual(entries[0].sources.map(source => source.actorName), ["Rathgamnon", "Sphinx"]);
  assert.match(entries[0].fingerprint, /^fnv1a32:[0-9a-f]{8}$/);
});

test("same-name variants remain distinct and receive source-qualified names", () => {
  const entries = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      { name: "Blast", system: { tier: 2, range: "far", description: "<p>2d6 damage.</p>" } },
    ]),
    actor("Mordanticus", "Compendium.shadowdark.monsters.Actor.mordanticus", [
      { name: "Blast", system: { tier: 4, range: "near", description: "<p>5d8 damage.</p>" } },
    ]),
  ]);

  assert.deepEqual(entries.map(entry => entry.name), ["Blast — Mage", "Blast — Mordanticus"]);
  assert.ok(entries.every(entry => entry.originalName === "Blast"));
  assert.ok(entries.every(entry => entry.variant === true));
  assert.notEqual(entries[0].fingerprint, entries[1].fingerprint);
});

test("same-name variants from one Actor receive unique tier-qualified names", () => {
  const entries = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      { _id: "blast-1", name: "Blast", type: "Spell", system: { tier: 1, description: "<p>Cold.</p>" } },
      { _id: "blast-2", name: "Blast", type: "Spell", system: { tier: 2, description: "<p>Fire.</p>" } },
    ]),
  ]);

  assert.deepEqual(entries.map(entry => entry.name), [
    "Blast — Mage (Tier 1)",
    "Blast — Mage (Tier 2)",
  ]);
});

test("validation reports a stated DC that disagrees with tier plus ten", () => {
  const warnings = validateMonsterSpell({
    name: "Impale",
    type: "Spell",
    system: { tier: 1, description: "<p>DC 12. Far range.</p>" },
  });

  assert.deepEqual(warnings, [{
    code: "dc-tier-mismatch",
    message: "Description says DC 12, but tier 1 derives DC 11.",
  }]);
});

test("validation reports prose dice and duration missing from structured spell data", () => {
  const warnings = validateMonsterSpell({
    name: "Slow",
    type: "Spell",
    system: {
      tier: 2,
      description: "<p>One target moves at half speed for 1d4 rounds and takes 1d6 damage.</p>",
      duration: { type: "instant", value: "-1" },
      formula: "",
    },
  });

  assert.deepEqual(warnings.map(warning => warning.code), [
    "unenriched-dice",
    "duration-mismatch",
    "missing-damage-formula",
  ]);
});

test("validation compares prose turn and day durations with structured duration", () => {
  const turnWarnings = validateMonsterSpell({
    system: { description: "<p>The target is blinded for 2 turns.</p>", duration: { type: "days", value: 2 } },
  });
  const dayWarnings = validateMonsterSpell({
    system: { description: "<p>The ward lasts 3 days.</p>", duration: { type: "turns", value: 3 } },
  });

  assert.ok(turnWarnings.some(warning => warning.code === "duration-mismatch"));
  assert.ok(dayWarnings.some(warning => warning.code === "duration-mismatch"));
});

test("collected entries carry validation warnings from their copied spell data", () => {
  const [entry] = collectMonsterSpells([
    actor("Dremir", "Compendium.world.shadowdark-enhancer--actors.Actor.dremir", [
      { name: "Impale", system: { tier: 1, description: "<p>DC 12. Target takes 1d6 damage.</p>", formula: "" } },
    ]),
  ]);

  assert.deepEqual(entry.warnings.map(warning => warning.code), [
    "dc-tier-mismatch",
    "unenriched-dice",
    "missing-damage-formula",
  ]);
});

test("refresh plan creates materialized spells with deterministic provenance flags", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      { name: "Arcane Armor", system: { tier: 1, range: "self", description: "<p>Armor.</p>" } },
    ]),
  ]);

  const materialized = materializeMonsterSpell(entry, { folder: "folder-core" });
  const plan = planMonsterSpellRefresh([entry], []);
  const provenance = materialized.flags["shadowdark-enhancer"].monsterSpell;

  assert.equal(plan.create.length, 1);
  assert.equal(plan.update.length, 0);
  assert.equal(materialized.folder, "folder-core");
  assert.equal(materialized.name, "Arcane Armor");
  assert.equal(provenance.generated, true);
  assert.equal(provenance.sourceFingerprint, entry.fingerprint);
  assert.equal(provenance.sources[0].actorUuid, "Compendium.shadowdark.monsters.Actor.mage");
  assert.match(provenance.libraryId, /^fnv1a32:[0-9a-f]{8}$/);
  assert.match(provenance.materializedFingerprint, /^fnv1a32:[0-9a-f]{8}$/);
});

test("refresh plan leaves an unchanged generated spell alone", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      { name: "Arcane Armor", system: { tier: 1, description: "<p>Armor.</p>" } },
    ]),
  ]);
  const existing = { _id: "generated-1", ...materializeMonsterSpell(entry) };

  const plan = planMonsterSpellRefresh([entry], [existing]);

  assert.equal(plan.create.length, 0);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.unchanged[0].document._id, "generated-1");
});

test("refresh plan updates an untouched generated spell when its source changes", () => {
  const sourceUuid = "Compendium.shadowdark.monsters.Actor.mage";
  const [oldEntry] = collectMonsterSpells([
    actor("Mage", sourceUuid, [
      { name: "Blast", system: { tier: 2, description: "<p>2d6 damage.</p>" } },
    ]),
  ]);
  const existing = { _id: "generated-1", ...materializeMonsterSpell(oldEntry) };
  const [newEntry] = collectMonsterSpells([
    actor("Mage", sourceUuid, [
      { name: "Blast", system: { tier: 3, description: "<p>3d6 damage.</p>" } },
    ]),
  ]);

  const plan = planMonsterSpellRefresh([newEntry], [existing]);

  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].document._id, "generated-1");
  assert.equal(plan.update[0].data.system.tier, 3);
});

test("refresh plan reports a conflict instead of overwriting a curated generated spell", () => {
  const sourceUuid = "Compendium.shadowdark.monsters.Actor.mage";
  const [oldEntry] = collectMonsterSpells([
    actor("Mage", sourceUuid, [
      { name: "Blast", system: { tier: 2, description: "<p>2d6 damage.</p>" } },
    ]),
  ]);
  const existing = {
    _id: "generated-1",
    ...materializeMonsterSpell(oldEntry),
    name: "Blast — My Curated Version",
  };
  const [newEntry] = collectMonsterSpells([
    actor("Mage", sourceUuid, [
      { name: "Blast", system: { tier: 3, description: "<p>3d6 damage.</p>" } },
    ]),
  ]);

  const plan = planMonsterSpellRefresh([newEntry], [existing]);

  assert.equal(plan.update.length, 0);
  assert.equal(plan.conflict.length, 1);
  assert.equal(plan.conflict[0].document.name, "Blast — My Curated Version");
});

test("refresh treats edits to copied source flags as curated conflicts", () => {
  const sourceUuid = "Compendium.shadowdark.monsters.Actor.mage";
  const [oldEntry] = collectMonsterSpells([
    actor("Mage", sourceUuid, [
      { _id: "blast", name: "Blast", type: "Spell", flags: { custom: { mode: "old" } }, system: { tier: 2 } },
    ]),
  ]);
  const existing = { _id: "generated-1", ...materializeMonsterSpell(oldEntry) };
  existing.flags.custom.mode = "curated";
  const [changedEntry] = collectMonsterSpells([
    actor("Mage", sourceUuid, [
      { _id: "blast", name: "Blast", type: "Spell", flags: { custom: { mode: "new" } }, system: { tier: 3 } },
    ]),
  ]);

  const plan = planMonsterSpellRefresh([changedEntry], [existing]);

  assert.equal(plan.update.length, 0);
  assert.equal(plan.conflict.length, 1);
});

test("legacy generated fingerprints migrate without becoming false curated conflicts", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [{
      name: "Ward",
      flags: { custom: { mode: "source" } },
      system: { tier: 2 },
    }]),
  ]);
  const existing = { _id: "generated-ward", ...materializeMonsterSpell(entry) };
  existing.flags["shadowdark-enhancer"].monsterSpell.materializedFingerprint =
    legacyMonsterSpellMaterializedFingerprint(existing);

  const plan = planMonsterSpellRefresh([entry], [existing]);

  assert.equal(plan.update.length, 1);
  assert.equal(plan.conflict.length, 0);
});

test("legacy fingerprints accept Foundry-normalized instant durations and formula defaults", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [{
      name: "Abjure",
      system: {
        tier: 3,
        duration: { type: "instant", value: "-1" },
        formula: undefined,
      },
    }]),
  ]);
  const existing = { _id: "generated-abjure", ...materializeMonsterSpell(entry) };
  existing.flags["shadowdark-enhancer"].monsterSpell.materializedFingerprint =
    legacyMonsterSpellMaterializedFingerprint(existing);
  existing.system.duration.value = "1";
  existing.system.formula = "";

  const plan = planMonsterSpellRefresh([entry], [existing]);

  assert.equal(plan.update.length, 1);
  assert.equal(plan.conflict.length, 0);
});

test("legacy fingerprint migration still preserves curated copied flags", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [{
      name: "Ward",
      flags: { custom: { mode: "source" } },
      system: { tier: 2 },
    }]),
  ]);
  const existing = { _id: "generated-ward", ...materializeMonsterSpell(entry) };
  existing.flags["shadowdark-enhancer"].monsterSpell.materializedFingerprint =
    legacyMonsterSpellMaterializedFingerprint(existing);
  existing.flags.custom.mode = "curated";

  const plan = planMonsterSpellRefresh([entry], [existing]);

  assert.equal(plan.update.length, 0);
  assert.equal(plan.conflict.length, 1);
});

test("refresh plan reports missing generated entries as stale and ignores user-created spells", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      { name: "Blast", system: { tier: 2, description: "<p>2d6 damage.</p>" } },
    ]),
  ]);
  const generated = { _id: "generated-1", ...materializeMonsterSpell(entry) };
  const userCreated = { _id: "user-1", name: "Homebrew", type: "Spell", system: { tier: 1 } };

  const plan = planMonsterSpellRefresh([], [generated, userCreated]);

  assert.equal(plan.stale.length, 1);
  assert.equal(plan.stale[0].document._id, "generated-1");
});

test("materialization preserves source flags while adding library provenance", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      {
        name: "Blast",
        flags: { shadowdark: { imported: true } },
        system: { tier: 2, description: "<p>2d6 damage.</p>" },
      },
    ]),
  ]);

  const data = materializeMonsterSpell(entry);

  assert.deepEqual(data.flags.shadowdark, { imported: true });
  assert.equal(data.flags["shadowdark-enhancer"].monsterSpell.generated, true);
});

test("attaching a generated variant restores its original name and removes library provenance", () => {
  const [entry] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      { _id: "blast", name: "Blast", type: "Spell", flags: { custom: { mode: "kept" } }, system: { tier: 2 } },
    ]),
    actor("Mordanticus", "Compendium.shadowdark.monsters.Actor.mordanticus", [
      { _id: "blast", name: "Blast", type: "Spell", system: { tier: 3 } },
    ]),
  ]);
  const generated = materializeMonsterSpell(entry);

  const attached = normalizeMonsterSpellAttachment(generated);

  assert.equal(generated.name, "Blast — Mage");
  assert.equal(attached.name, "Blast");
  assert.equal(attached.flags.custom.mode, "kept");
  assert.equal(attached.flags["shadowdark-enhancer"]?.monsterSpell, undefined);
});

test("definition identity keeps same-name spells with different copied flags distinct", () => {
  const entries = collectMonsterSpells([
    actor("Sphinx", "Compendium.shadowdark.monsters.Actor.sphinx", [
      { name: "Gate", flags: { source: { actor: "sphinx" } }, system: { tier: 5, description: "<p>Gate.</p>" } },
    ]),
    actor("Rathgamnon", "Compendium.shadowdark.monsters.Actor.rath", [
      { name: "Gate", flags: { source: { actor: "rath" } }, system: { tier: 5, description: "<p>Gate.</p>" } },
    ]),
  ]);

  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.variant));
  assert.notEqual(entries[0].fingerprint, entries[1].fingerprint);
});

test("reconciliation reuses a consolidated entry when only a secondary source is scanned", () => {
  const sourceUuid = "Compendium.shadowdark.monsters.Actor";
  const allSourcesEntry = collectMonsterSpells([
    actor("Rathgamnon", `${sourceUuid}.rath`, [
      { name: "Gate", system: { tier: 5, description: "<p>Gate.</p>" } },
    ]),
    actor("Sphinx", `${sourceUuid}.sphinx`, [
      { name: "Gate", system: { tier: 5, description: "<p>Gate.</p>" } },
    ]),
  ])[0];
  const existing = { _id: "generated-gate", ...materializeMonsterSpell(allSourcesEntry) };
  const secondaryOnlyEntry = collectMonsterSpells([
    actor("Sphinx", `${sourceUuid}.sphinx`, [
      { name: "Gate", system: { tier: 5, description: "<p>Gate.</p>" } },
    ]),
  ])[0];

  const plan = planMonsterSpellRefresh([secondaryOnlyEntry], [existing]);

  assert.equal(plan.create.length, 0);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.stale.length, 0);
  assert.equal(
    plan.unchanged[0].data.flags["shadowdark-enhancer"].monsterSpell.libraryId,
    existing.flags["shadowdark-enhancer"].monsterSpell.libraryId,
  );
});

test("reconciliation preserves identity when a replaced source Actor and Item get new ids", () => {
  const [original] = collectMonsterSpells([
    actor("Mage", "Compendium.world.sde-actors.Actor.old-mage", [
      { _id: "old-gate", name: "Gate", system: { tier: 5 } },
    ]),
  ]);
  original.sources[0].sourcePack = "world.sde-actors";
  const existing = { _id: "generated-gate", ...materializeMonsterSpell(original) };
  const replacementActor = actor("Mage", "Compendium.world.sde-actors.Actor.new-mage", [
    { _id: "new-gate", name: "Gate", system: { tier: 5 } },
  ]);
  replacementActor.sourcePack = "world.sde-actors";
  const [replacement] = collectMonsterSpells([replacementActor]);

  const plan = planMonsterSpellRefresh([replacement], [existing], {
    refreshedSourcePacks: ["world.sde-actors"],
  });

  assert.equal(plan.create.length, 0);
  assert.equal(plan.stale.length, 0);
  assert.equal(plan.update.length, 1);
  assert.equal(
    plan.update[0].data.flags["shadowdark-enhancer"].monsterSpell.libraryId,
    existing.flags["shadowdark-enhancer"].monsterSpell.libraryId,
  );
});

test("partial source refresh splits a changed definition from unselected consolidated sources", () => {
  const core = actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
    { _id: "gate", name: "Gate", system: { tier: 5 } },
  ]);
  const enhancer = actor("Mage Copy", "Compendium.world.sde-actors.Actor.mage", [
    { _id: "gate", name: "Gate", system: { tier: 5 } },
  ]);
  enhancer.sourcePack = "world.sde-actors";
  enhancer.sourceLabel = "Shadowdark Enhancer — Actors";
  const [consolidated] = collectMonsterSpells([core, enhancer]);
  const existing = { _id: "generated-gate", ...materializeMonsterSpell(consolidated) };
  const [changedCore] = collectMonsterSpells([
    actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
      { _id: "gate", name: "Gate", system: { tier: 6 } },
    ]),
  ]);

  const plan = planMonsterSpellRefresh([changedCore], [existing], {
    refreshedSourcePacks: ["shadowdark.monsters"],
  });

  assert.equal(plan.create.length, 1);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.metadataUpdate.length, 0);
  assert.deepEqual(
    plan.update[0].data.flags["shadowdark-enhancer"].monsterSpell.sources
      .map(source => source.sourcePack),
    ["world.sde-actors"],
  );
  assert.equal(plan.stale.length, 0);
});

test("reconciliation refreshes provenance when an identical source is added", () => {
  const mage = actor("Mage", "Compendium.shadowdark.monsters.Actor.mage", [
    { _id: "gate", name: "Gate", type: "Spell", system: { tier: 5, description: "<p>Gate.</p>" } },
  ]);
  const sphinx = actor("Sphinx", "Compendium.shadowdark.monsters.Actor.sphinx", [
    { _id: "gate", name: "Gate", type: "Spell", system: { tier: 5, description: "<p>Gate.</p>" } },
  ]);
  const originalEntry = collectMonsterSpells([mage])[0];
  const existing = { _id: "generated-gate", ...materializeMonsterSpell(originalEntry) };
  const consolidatedEntry = collectMonsterSpells([mage, sphinx])[0];

  const plan = planMonsterSpellRefresh([consolidatedEntry], [existing]);

  assert.equal(plan.update.length, 1);
  assert.equal(
    plan.update[0].data.flags["shadowdark-enhancer"].monsterSpell.sources.length,
    2,
  );
});
