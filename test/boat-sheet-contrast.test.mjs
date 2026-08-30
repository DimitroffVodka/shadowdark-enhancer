import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");
const DESCRIPTION_SELECTOR = ".sde-boat-sheet .sde-veh-tab-content[data-tab-content=\"description\"] textarea";

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleBody(css, selector) {
  const match = css.match(new RegExp(`${escaped(selector)}\\s*\\{([^}]*)\\}`, "s"));
  assert.ok(match, `missing scoped rule: ${selector}`);
  return match[1];
}

function channel(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 0xff, value & 0xff].map((n) => {
    const srgb = n / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
}

function contrastRatio(foreground, background) {
  const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const light = luminance(channel(foreground));
  const dark = luminance(channel(background));
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

test("Boat description textarea keeps readable contrast across interaction states", async () => {
  const css = await read("styles/shadowdark-enhancer.css");
  const base = ruleBody(css, DESCRIPTION_SELECTOR);
  const hover = ruleBody(css, `${DESCRIPTION_SELECTOR}:hover`);
  const focus = ruleBody(css, `${DESCRIPTION_SELECTOR}:focus`);
  const placeholder = ruleBody(css, `${DESCRIPTION_SELECTOR}::placeholder`);
  const nonEditable = ruleBody(
    css,
    `${DESCRIPTION_SELECTOR}:read-only,\n${DESCRIPTION_SELECTOR}:disabled`,
  );

  assert.match(base, /color:\s*#191813/);
  assert.match(base, /background:\s*#f4f0e8/);
  assert.match(base, /border:\s*1px solid rgba\(25, 24, 19, 0\.45\)/);
  assert.match(hover, /border-color:\s*rgba\(25, 24, 19, 0\.7\)/);
  assert.match(focus, /border-color:\s*#7a5a1e/);
  assert.match(focus, /outline:\s*2px solid #7a5a1e/);
  assert.match(focus, /box-shadow:/);
  assert.match(placeholder, /color:\s*#6c5c48/);
  assert.match(placeholder, /opacity:\s*1/);
  assert.match(nonEditable, /color:\s*#191813/);
  assert.match(nonEditable, /background:\s*#f4f0e8/);

  const ink = base.match(/(?:^|\s)color:\s*(#[0-9a-f]{6})/i)?.[1];
  const surface = base.match(/background:\s*(#[0-9a-f]{6})/i)?.[1];
  const hint = placeholder.match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(ink && surface && hint, "contrast colors must be explicit six-digit hex values");
  assert.ok(contrastRatio(ink, surface) >= 4.5, "description text must meet AA contrast");
  assert.ok(contrastRatio(hint, surface) >= 4.5, "description placeholder must meet AA contrast");
});

test("Boat description contrast selectors stay inside the Boat sheet scope", async () => {
  const css = await read("styles/shadowdark-enhancer.css");
  for (const selector of [
    DESCRIPTION_SELECTOR,
    `${DESCRIPTION_SELECTOR}:hover`,
    `${DESCRIPTION_SELECTOR}:focus`,
    `${DESCRIPTION_SELECTOR}::placeholder`,
    `${DESCRIPTION_SELECTOR}:read-only`,
    `${DESCRIPTION_SELECTOR}:disabled`,
  ]) {
    assert.match(selector, /^\.sde-boat-sheet\s/);
  }
  assert.doesNotMatch(
    css,
    /(?:^|\n)\s*\.sde-veh-tab-content\[data-tab-content="description"\]\s+textarea\s*\{/,
    "description sizing must not leak to non-Boat sheets",
  );
});
