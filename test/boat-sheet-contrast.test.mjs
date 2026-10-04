import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

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

/** The parchment token block that re-points the kit at the system's parchment (Bastion and Boat sheets). */
async function parchmentTokens() {
  const css = await read("styles/shadowdark-enhancer.css");
  const block = css.match(/\.sde-ui\.sde-parchment,[^{]*\{([^}]*)\}/s);
  assert.ok(block, "missing the .sde-ui.sde-parchment token block");
  return Object.fromEntries([...block[1].matchAll(/--ui-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

test("Parchment sheets keep readable text on every kit surface", async () => {
  const tokens = await parchmentTokens();
  for (const surface of ["page", "panel", "raised", "hover"]) {
    for (const ink of ["text", "body", "muted", "danger-text"]) {
      assert.ok(tokens[ink], `${ink} token`);
      assert.ok(contrastRatio(tokens[ink], tokens[surface]) >= 4.5, `${ink} on ${surface} must meet AA contrast`);
    }
  }
  assert.ok(contrastRatio(tokens["btn-fg"], tokens["btn-bg"]) >= 4.5, "primary button text must meet AA contrast");
  assert.ok(contrastRatio(tokens.gold, tokens.panel) >= 4.5, "gold text must meet AA contrast");
});

test("The Boat sheet's old description textarea rules left with the old design", async () => {
  const css = await read("styles/shadowdark-enhancer.css");
  assert.doesNotMatch(css, /\.sde-boat-sheet\s/, "no rule should still target the old Boat chrome");
});
