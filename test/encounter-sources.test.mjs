import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ENCOUNTER_SOURCES,
  SOURCE_ID_RENAMES,
  migrateEncounterSources,
} from "../scripts/encounter/encounter-sources.mjs";

// Shadowdark 4.x renamed the bundled monster pack. Verified live against
// Shadowdark 4.0.6 / Foundry 14.365: game.packs.get("shadowdark.bestiary") is
// undefined, game.packs.get("shadowdark.monsters") holds 244 actors.
test("default browses the system pack that actually exists in Shadowdark 4.x", () => {
  assert.deepEqual([...DEFAULT_ENCOUNTER_SOURCES], ["world", "shadowdark.monsters"]);
  assert.ok(!DEFAULT_ENCOUNTER_SOURCES.includes("shadowdark.bestiary"));
});

test("the default is frozen so a consumer can't mutate it for everyone else", () => {
  assert.throws(() => DEFAULT_ENCOUNTER_SOURCES.push("world.junk"));
  assert.throws(() => { SOURCE_ID_RENAMES["shadowdark.bestiary"] = "nope"; });
});

test("migrates a stored list carrying the pre-4.x pack id", () => {
  assert.deepEqual(
    migrateEncounterSources(["world", "shadowdark.bestiary"]),
    ["world", "shadowdark.monsters"],
  );
});

test("returns null when nothing needs changing, so no pointless settings write", () => {
  assert.equal(migrateEncounterSources(["world", "shadowdark.monsters"]), null);
  assert.equal(migrateEncounterSources([]), null);
  assert.equal(migrateEncounterSources(["world"]), null);
});

test("a list naming BOTH the old and new pack collapses to one entry", () => {
  // A GM who added shadowdark.monsters by hand before this fix shipped would
  // otherwise end up browsing the same 244 actors twice.
  assert.deepEqual(
    migrateEncounterSources(["world", "shadowdark.bestiary", "shadowdark.monsters"]),
    ["world", "shadowdark.monsters"],
  );
  assert.deepEqual(
    migrateEncounterSources(["shadowdark.monsters", "shadowdark.bestiary"]),
    ["shadowdark.monsters"],
  );
});

test("source order is preserved — the pills keep the GM's arrangement", () => {
  assert.deepEqual(
    migrateEncounterSources(["scene", "shadowdark.bestiary", "world", "my-module.npcs"]),
    ["scene", "shadowdark.monsters", "world", "my-module.npcs"],
  );
});

test("third-party and virtual sources pass through untouched", () => {
  assert.equal(migrateEncounterSources(["scene", "world", "some-module.beasts"]), null);
});

test("an empty list stays empty — that's a deliberate deselect-all, not corruption", () => {
  assert.equal(migrateEncounterSources([]), null);
});

test("non-array and junk entries are handled without throwing", () => {
  for (const junk of [null, undefined, "shadowdark.bestiary", 42, {}]) {
    assert.equal(migrateEncounterSources(junk), null, `bare ${JSON.stringify(junk)} is not a list`);
  }
  // Junk INSIDE a real list is dropped rather than written back to the setting.
  assert.deepEqual(
    migrateEncounterSources(["world", null, "", "shadowdark.bestiary", 7]),
    ["world", "shadowdark.monsters"],
  );
});

test("migration is idempotent — a second pass is a no-op", () => {
  const once = migrateEncounterSources(["world", "shadowdark.bestiary"]);
  assert.equal(migrateEncounterSources(once), null);
});
