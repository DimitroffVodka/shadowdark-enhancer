import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, ROOT), "utf8");

test("Monster Spell Library has a linked quick-use guide with reconciliation details", async () => {
  const home = await read("docs/wiki/Home.md");
  assert.match(home, /\[Monster Spell Library\]\(Monster-Spell-Library\.md\)/);

  const guide = await read("docs/wiki/Monster-Spell-Library.md");
  assert.match(guide, /^# Monster Spell Library$/m);
  assert.match(guide, /^## Quick use$/m);
  assert.match(guide, /Build \/ Refresh/);
  assert.match(guide, /Source Actors keep their embedded spells/);
  assert.match(guide, /<details>/);
  assert.match(guide, /curated edits/i);
});
