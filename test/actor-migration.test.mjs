/** The retired pre-suite monster migration (actor-migration.mjs): what it picks up, and what it never copies twice. */
import test from "node:test";
import assert from "node:assert/strict";
import { selectWorldImportedActors, migratedCopies } from "../scripts/importer/monsters/actor-migration.mjs";

const MOD = "shadowdark-enhancer";

test("a monster placed from the suite pack is not an import to migrate", () => {
  const imported = { name: "Goblin", flags: { [MOD]: { source: "core" } } };
  const placed = { name: "Goblin", flags: { [MOD]: { source: "core" } }, _stats: { compendiumSource: "Compendium.world.shadowdark-enhancer--actors.Actor.abc" } };
  const done = { name: "Orc", flags: { [MOD]: { source: "core", migratedToSuite: true } } };
  assert.deepEqual(selectWorldImportedActors([imported, placed, done]), [imported]);
});

test("copies already in the suite pack are known by name and source", () => {
  const keys = migratedCopies([
    { name: "Goblin", flags: { [MOD]: { source: "core", migratedToSuite: true } } },
    { name: "Hag", flags: { [MOD]: { source: "cs2" } } },   // imported straight into the pack, never migrated
    { name: "Wraith" },
  ]);
  assert.deepEqual([...keys], ["Goblin|core"]);
});
