import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, ROOT), "utf8");

test("Monster Creator spellcasting UI exposes library refresh, source filtering, and source Actor links", async () => {
  const [template, creator, css] = await Promise.all([
    read("templates/encounter-creator.hbs"),
    read("scripts/monster-creator/encounter-creator.mjs"),
    read("styles/shadowdark-enhancer.css"),
  ]);

  assert.match(template, /data-action="creatorMonsterSpellsBuild"/);
  assert.match(template, /data-spell-source/);
  assert.match(template, /data-action="creatorSpellOpenSource"/);
  assert.match(template, /\{\{#if this\.variant\}\}/);
  assert.match(template, /sde-spell-conflict/);
  assert.match(creator, /this\._spellSource\s*=\s*""/);
  assert.match(creator, /source:\s*this\._spellSource/);
  assert.match(creator, /SpellIndex\.sourceOptions\(all\)/);
  assert.match(creator, /creatorMonsterSpellsBuild:\s*MonsterCreatorApp\.prototype\._onMonsterSpellsBuild/);
  assert.match(creator, /creatorSpellOpenSource:\s*MonsterCreatorApp\.prototype\._onSpellOpenSource/);
  assert.match(creator, /normalizeMonsterSpellAttachment\(doc\.toObject\(\)\)/);
  assert.doesNotMatch(creator, /this\._sectionOpen\.spellcasting\s*&&\s*spellHasQuery/);
  assert.match(css, /\.sde-spell-library-build\s*\{/);
  assert.match(css, /\.sde-spell-source\s*\{/);
  assert.match(css, /\.sde-spell-open-source\s*\{/);
  assert.match(css, /\.sde-spell-warning\s*\{/);
  assert.match(css, /\.sde-spell-variant\s*\{/);
  assert.match(css, /\.sde-spell-conflict\s*\{/);
});
