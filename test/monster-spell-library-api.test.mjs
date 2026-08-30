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

test("the public Monster Spell API cannot replace the live game authority", async () => {
  const entry = await read("scripts/shadowdark-enhancer.mjs");
  assert.match(entry, /preview:\s*\(opts\)\s*=>\s*previewMonsterSpellLibrary\(\{\s*\.\.\.\(opts \?\? \{\}\),\s*game\s*\}\)/);
  assert.match(entry, /refresh:\s*\(opts\)\s*=>\s*runMonsterSpellLibraryRefresh\(\{\s*\.\.\.\(opts \?\? \{\}\),\s*game\s*\}\)/);
});
