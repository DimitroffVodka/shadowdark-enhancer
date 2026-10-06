import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const walk = (dir) => readdirSync(new URL(dir, ROOT), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]));
const templates = walk("templates/char-builder/").filter((f) => f.endsWith(".hbs") && !f.endsWith("gear-editor.hbs"));
const all = templates.map(read).join("\n");

test("every string in the Character Builder templates comes from en.json", () => {
  const en = JSON.parse(read("languages/en.json"));
  for (const m of all.matchAll(/localize ['"]([^'"]+)['"]/g)) assert.ok(m[1] in en, `missing string ${m[1]}`);
});

test("the data hooks the builder's steps bind are in the templates", () => {
  const scripts = walk("scripts/char-builder/steps/").map(read).join("\n");
  const hooks = new Set([...scripts.matchAll(/\[(data-cb-[a-z-]+)(?:=|\])/g)].map((m) => m[1]));
  assert.ok(hooks.size > 20);
  for (const hook of hooks) assert.ok(all.includes(hook), `no template carries ${hook}`);
});

test("the frame's data-actions are registered, and its tabs and footer buttons stay", () => {
  const app = read("scripts/char-builder/char-builder-app.mjs");
  const frame = read("templates/char-builder/char-builder.hbs");
  for (const m of frame.matchAll(/data-action="([a-z-]+)"/g)) assert.ok(app.includes(`"${m[1]}"`), `no handler for ${m[1]}`);
  for (const action of ["cb-goto", "cb-prev", "cb-next", "cb-finish", "cb-dismiss", "cb-random", "cb-full-random", "cb-undo", "cb-level-up", "cb-level-up-cancel"]) {
    assert.ok(frame.includes(`data-action="${action}"`), `missing ${action}`);
  }
  assert.match(frame, /data-cb-level/);
  assert.equal([...frame.matchAll(/class="ui-btn primary"/g)].length, 1, "one primary button");
});

test("the builder's steps carry no inline style or literal dice formula in the HP and Gold steps", () => {
  assert.doesNotMatch(read("templates/char-builder/steps/hp.hbs") + read("templates/char-builder/steps/gold.hbs"), /style=|2d6 × 5/);
});
