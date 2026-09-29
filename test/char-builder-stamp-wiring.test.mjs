// P0 wiring (#168): every item the builder embeds on a fresh build carries its compendium link.
// commit.mjs needs Foundry globals to run, so this scans the source, as ancestry-adopt does for its wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../scripts/char-builder/commit.mjs", import.meta.url), "utf8");
const start = src.indexOf("async function gatherItems(");
const body = src.slice(start);
const lines = body.split("\n");

test("every gatherItems push site goes through stampSource, except the source-less trinket", () => {
  assert.ok(start > 0);
  let obj = "";
  let pushes = 0;
  for (const line of lines) {
    const decl = line.match(/const obj = (.*);/);
    if (decl) obj = decl[1];
    const push = line.match(/items\.push\((.*)/);
    if (!push) continue;
    pushes++;
    const arg = push[1];
    if (arg.startsWith("stampSource(")) continue;
    if (arg.startsWith("applyFix(")) continue;
    if (arg.startsWith("{")) continue; // the trinket: a hand-made item with no compendium entry
    if (arg.startsWith("obj)")) {
      assert.ok(obj.startsWith("stampSource("), `items.push(obj) after "const obj = ${obj}"`);
      continue;
    }
    assert.fail(`unstamped push: items.push(${arg}`);
  }
  assert.ok(pushes >= 6, "the scan actually saw the push sites");
});

test("the talent fix helper stamps what it returns", () => {
  const at = body.indexOf("const applyFix");
  assert.ok(at > 0);
  assert.match(body.slice(at, at + 250), /return stampSource\(obj, doc\.uuid\)/);
});

test("the trinket push is the only literal one", () => {
  assert.equal(lines.filter((l) => /items\.push\(\{/.test(l)).length, 1);
  assert.match(body, /name: state\.trinket/);
});
