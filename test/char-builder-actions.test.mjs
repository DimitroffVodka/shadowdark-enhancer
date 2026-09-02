/**
 * Every `data-action` in a template must be registered in its app's
 * DEFAULT_OPTIONS.actions.
 *
 * ApplicationV2 dispatches clicks by looking the action name up in that map. A
 * name that isn't there is not an error — the click is simply ignored. So a
 * button can render, look right, sit in the correct place, and do nothing at
 * all, with a silent console: exactly how the char builder's two "from
 * gallery…" buttons shipped. The step's `handleAction` had the cases; the app
 * had never heard of them.
 *
 * Reads both sides as TEXT rather than importing them, because the app modules
 * touch Foundry globals at load. There is nothing to fake and nothing to keep
 * in sync — the assertion is against the real files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Every file under `dir`, recursively, whose name ends in `ext`. */
function walk(dir, ext, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, ext, out);
    else if (entry.name.endsWith(ext)) out.push(rel);
  }
  return out;
}

/** The action names a set of templates ask for, each with the file it came from. */
function templateActions(dir) {
  const found = new Map();
  for (const file of walk(dir, ".hbs")) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(/data-action="([^"{}]+)"/g)) {
      if (!found.has(m[1])) found.set(m[1], file);
    }
  }
  return found;
}

/**
 * The keys of an app's `actions: { … }` block. Scans braces to the matching
 * close so a nested object inside the map can't end the scan early.
 */
function registeredActions(file) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const start = text.indexOf("actions: {");
  assert.notEqual(start, -1, `${file} declares no actions map`);
  let depth = 0, end = start;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) { end = i; break; }
  }
  return new Set([...text.slice(start, end).matchAll(/["']([\w-]+)["']\s*:/g)].map((m) => m[1]));
}

// Two apps render the char-builder templates; each owns its own prefix.
const OWNERS = [
  { prefix: "cb-",  app: "scripts/char-builder/char-builder-app.mjs" },
  { prefix: "ege-", app: "scripts/char-builder/gear-editor-app.mjs" },
];

test("every char-builder template action is registered on its app", () => {
  const asked = templateActions("templates/char-builder");
  assert.ok(asked.size > 10, "expected to find the char-builder template actions");

  const registered = new Map(OWNERS.map((o) => [o.prefix, registeredActions(o.app)]));
  const orphans = [];
  for (const [action, file] of asked) {
    const owner = OWNERS.find((o) => action.startsWith(o.prefix));
    assert.ok(owner, `${file}: action "${action}" matches no known app prefix`);
    if (!registered.get(owner.prefix).has(action)) {
      orphans.push(`"${action}" (${file}) is missing from ${owner.app}`);
    }
  }
  assert.deepEqual(orphans, [], `dead buttons — the click is silently ignored:\n  ${orphans.join("\n  ")}`);
});

test("the gallery buttons reach a handler the preview step implements", () => {
  const step = readFileSync(join(ROOT, "scripts/char-builder/steps/preview-step.mjs"), "utf8");
  for (const action of ["cb-gallery-portrait", "cb-gallery-token"]) {
    assert.match(step, new RegExp(`case "${action}":`), `preview step does not handle ${action}`);
  }
});
