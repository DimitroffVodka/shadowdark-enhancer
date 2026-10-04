import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const css = await readFile(new URL("styles/sde-ui.css", ROOT), "utf8");
const manifest = JSON.parse(await readFile(new URL("module.json", ROOT), "utf8"));

test("the UI kit is listed after the module stylesheet", () => {
  const srcs = manifest.styles.map((s) => s.src);
  assert.ok(srcs.includes("styles/sde-ui.css"));
  assert.ok(srcs.indexOf("styles/sde-ui.css") > srcs.indexOf("styles/shadowdark-enhancer.css"));
});

test("the dark token block carries the kit values", () => {
  const block = css.match(/^\.sde-ui \{([^}]*)\}/m)?.[1];
  assert.ok(block, ".sde-ui token block exists");
  assert.match(block, /--ui-page:#000;/);
  assert.match(block, /--ui-gold:#c9aa58;/);
  assert.match(block, /--ui-text:#fff;/);
  assert.match(block, /color-scheme: dark;/);
});

test("the light token block exists", () => {
  const block = css.match(/\.sde-ui\.theme-light, \.theme-light \.sde-ui \{([^}]*)\}/)?.[1];
  assert.ok(block, "light token block exists");
  assert.match(block, /--ui-page:#f4f0e6;/);
  assert.match(block, /color-scheme: light;/);
});

test("the switch and chip parts exist", () => {
  assert.match(css, /\.ui-switch\s*\{/);
  assert.match(css, /\.ui-chip\s*\{/);
});

test("chips, tags and buttons have no pill radius", () => {
  const rules = css.match(/[^{}]*\{[^}]*\}/g) ?? [];
  for (const rule of rules) {
    const selector = rule.slice(0, rule.indexOf("{"));
    if (!/\.ui-(chip|tag|btn)\b/.test(selector)) continue;
    assert.doesNotMatch(rule, /border-radius:\s*(999px|50%)/, `pill radius in ${selector.trim()}`);
  }
});

test("the digits font resolves relative to the stylesheet", () => {
  assert.match(css, /url\("\.\.\/\.\.\/\.\.\/systems\/shadowdark\/fonts\/Montserrat-SemiBold\.ttf"\)/);
});
