import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(ROOT, path), "utf8");
const en = JSON.parse(read("languages/en.json"));

test("Token HUD controls are keyboard-reachable buttons with a name and a tooltip", () => {
  for (const path of ["scripts/crawl-strip/movement-tracker.mjs", "scripts/loot/item-drops.mjs", "scripts/monster-creator/quick-adjust-app.mjs"]) {
    const source = read(path);
    assert.doesNotMatch(source, /createElement\("div"\);\s*btn\.classList\.add\("control-icon"\)/, path);
    assert.match(source, /const btn = document\.createElement\("button"\);\s*btn\.type = "button";\s*btn\.className = "control-icon sde-hud-btn";/, path);
    assert.match(source, /btn\.dataset\.tooltip = tip;\s*btn\.setAttribute\("aria-label", tip\);/, path);
  }
  assert.match(read("scripts/monster-creator/quick-adjust-app.mjs"), /btn\.dataset\.action = "sde-quick-adjust";/);
});

class Node {
  children = []; dataset = {}; attrs = {}; listeners = {}; className = ""; parent = null;
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  append(n) { n.parent = this; this.children.push(n); }
  appendChild(n) { this.append(n); return n; }
  querySelector(sel) { return sel === "span" ? this.children.find(c => c.tag === "span") ?? null : sel === ".sde-prayer-roll" ? this.#find(this, "sde-prayer-roll") : null; }
  #find(node, cls) { for (const c of node.children) { if (c.className?.includes(cls)) return c; const d = this.#find(c, cls); if (d) return d; } return null; }
}
test("the prayer roll is a labelled button injected once, through either sheet hook", async () => {
  const hooks = new Map(); let table = true;
  globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn) };
  globalThis.document = { createElement: tag => Object.assign(new Node(), { tag }) };
  globalThis.fromUuidSync = () => ({ name: "Test Deity" });
  globalThis.game = { i18n: { localize: k => en[k], format: (k, d) => en[k].replace(/\{(\w+)\}/g, (_m, x) => d[x]) }, tables: { find: t => table && t({ name: "Test Deity Prayers" }) ? { name: "Test Deity Prayers" } : undefined }, packs: [] };
  const { init } = await import("../scripts/character-sheet/prayer-roll.mjs");
  init();
  assert.ok(hooks.has("renderActorSheet")); assert.ok(hooks.has("renderActorSheetV2"));
  const span = Object.assign(new Node(), { tag: "span" });
  const header = Object.assign(new Node(), { tag: "header" }); header.append(span);
  const label = { textContent: "Deity", closest: () => header };
  const root = { querySelectorAll: () => [label] };
  const actor = { type: "Player", system: { deity: "Item.deity" } };
  hooks.get("renderActorSheet")({}, root, { actor });
  hooks.get("renderActorSheetV2")({ document: actor }, root, {});
  const buttons = span.children.filter(c => c.className === "sde-prayer-roll");
  assert.equal(buttons.length, 1, "one button even when both hooks fire for the same render");
  const [button] = buttons;
  assert.equal(button.tag, "button"); assert.equal(button.type, "button");
  assert.equal(button.attrs["aria-label"], "Pray to Test Deity");
  assert.equal(button.children[0].alt, en["SDE.prayerRoll.alt"]);
  assert.equal(button.children[0].style, undefined, "no inline styles");
  // V1-style jQuery-like root and a non-Player actor
  const other = Object.assign(new Node(), { tag: "header" }); other.append(Object.assign(new Node(), { tag: "span" }));
  hooks.get("renderActorSheet")({}, [{ querySelectorAll: () => [{ textContent: "Deity", closest: () => other }] }], { actor });
  assert.equal(other.children[0].children.length, 1);
  hooks.get("renderActorSheet")({}, root, { actor: { type: "NPC", system: { deity: "x" } } });
  assert.equal(span.children.length, 1);
});

test("the prayer roll has a stylesheet rule and no literal English left in its script", () => {
  assert.match(read("styles/shadowdark-enhancer.css"), /\.sde-prayer-roll \{[^}]*width: 24px; height: 24px;[^}]*background: transparent;[^}]*cursor: pointer;/);
  const source = read("scripts/character-sheet/prayer-roll.mjs");
  assert.doesNotMatch(source, /alt = "Pray"|cssText|mouseenter/);
});
