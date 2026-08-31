import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, ROOT), "utf8");

test("the public API exposes Monster Spell Library preview, refresh, and source discovery", async () => {
  const [entry, docs] = await Promise.all([
    read("scripts/shadowdark-enhancer.mjs"),
    read("docs/API.md"),
  ]);

  assert.match(entry, /monsterSpells:\s*\{/);
  assert.match(entry, /listSources:/);
  assert.match(entry, /preview:/);
  assert.match(entry, /refresh:/);
  assert.match(docs, /^## `monsterSpells`$/m);
  assert.match(docs, /Build\/Refresh Monster Spells/);
});

test("ready schedules the GM-only Monster Spell update gate, not a per-activation sync", async () => {
  const entry = await read("scripts/shadowdark-enhancer.mjs");
  assert.match(entry, /runMonsterSpellUpdateGate\(\{\s*game\s*\}\)/);
  // The entry point must not reach past the gate and start a refresh of its own:
  // that is what made the library rebuild on every activation (#75).
  assert.doesNotMatch(entry, /syncMonsterSpellLibrary\(/);
  assert.doesNotMatch(entry, /migrateMonsterSpellPack\(/);
});

test("Monster Importer syncs generated spells after creating or replacing monsters", async () => {
  const importer = await read("scripts/importer/monsters/monster-importer.mjs");
  assert.match(importer, /await syncImportedMonsterSpells\(out\)/);
});

test("the public Monster Spell API cannot replace the live game authority", async () => {
  const entry = await read("scripts/shadowdark-enhancer.mjs");
  assert.match(entry, /preview:\s*\(opts\)\s*=>\s*previewMonsterSpellLibrary\(\{\s*\.\.\.\(opts \?\? \{\}\),\s*game\s*\}\)/);
  assert.match(entry, /refresh:\s*\(opts\)\s*=>\s*runMonsterSpellLibraryRefresh\(\{\s*\.\.\.\(opts \?\? \{\}\),\s*game\s*\}\)/);
});
