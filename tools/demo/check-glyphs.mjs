#!/usr/bin/env node
/**
 * Fail the demo build if it asks for a Font Awesome glyph the vendored FREE
 * kit does not have.
 *
 * Foundry bundles FA *Pro*, so Pro-only glyphs render fine while developing
 * against a live world and silently become blank boxes on the public site.
 * The module uses at least five of them (fa-swords, fa-bow-arrow, fa-axe,
 * fa-dagger, fa-hand-holding-magic), and fixing them one at a time as they
 * are noticed does not scale -- four of those five went unnoticed until this
 * check existed.
 *
 * A blank box is invisible to every other gate in the repo: it is valid HTML,
 * valid CSS, and renders without an error.
 *
 *   npm run demo:check
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEMO = path.join(ROOT, "demo");
const FA_CSS = path.join(DEMO, "vendor", "fontawesome", "css", "all.min.css");

/**
 * FA class names that select a style, size or animation rather than a glyph.
 * Anything here is skipped; anything not here must resolve to a real icon.
 */
const NOT_GLYPHS = new Set([
  "fa-solid", "fa-regular", "fa-brands", "fa-light", "fa-thin", "fa-duotone", "fa-sharp",
  "fa-fw", "fa-li", "fa-ul", "fa-border", "fa-inverse", "fa-layers", "fa-stack",
  "fa-stack-1x", "fa-stack-2x", "fa-pull-left", "fa-pull-right",
  "fa-spin", "fa-spin-pulse", "fa-spin-reverse", "fa-pulse", "fa-beat", "fa-fade",
  "fa-beat-fade", "fa-bounce", "fa-flip", "fa-shake",
  "fa-rotate-by", "fa-flip-horizontal", "fa-flip-vertical", "fa-flip-both",
  "fa-xs", "fa-sm", "fa-lg", "fa-xl", "fa-2xl", "fa-1x", "fa-2x", "fa-3x", "fa-4x",
  "fa-5x", "fa-6x", "fa-7x", "fa-8x", "fa-9x", "fa-10x", "fa-2xs",
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "vendor") walk(p, out);
    } else if (/\.(html|js|css)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

if (!fs.existsSync(FA_CSS)) {
  console.error(`check-glyphs: vendored Font Awesome CSS not found at ${path.relative(ROOT, FA_CSS)}`);
  console.error("Run `npm run demo:vendor` first.");
  process.exit(1);
}

const faCss = fs.readFileSync(FA_CSS, "utf8");

/**
 * FA 6.7 declares each glyph as `SELECTORS{--fa:"\fXXX"}`. Utility classes
 * carry no `--fa`, so requiring it is a precise "is a real icon" test rather
 * than a substring match.
 *
 * The selector list must be parsed whole, not just the name adjacent to the
 * brace: aliases are grouped, e.g.
 *   .fa-close,.fa-multiply,.fa-remove,.fa-times,.fa-xmark{--fa:"\f00d"}
 * Reading only the last entry would wrongly report fa-times as missing.
 */
const available = new Set();
for (const rule of faCss.matchAll(/([^{}]+)\{--fa:/g)) {
  for (const sel of rule[1].split(",")) {
    const name = sel.trim().match(/^\.(fa-[a-z0-9-]+)$/);
    if (name) available.add(name[1]);
  }
}

/**
 * Drop comments before scanning. A glyph named in a comment cannot render, and
 * the comments explaining *why* a Pro glyph was replaced necessarily name it --
 * without this, documenting the fix would fail the build.
 *
 * `//` is only treated as a line comment when it is not preceded by a colon,
 * so `https://` inside a string survives.
 */
function stripComments(src, file) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/<!--[\s\S]*?-->/g, " ");
  if (file.endsWith(".js")) out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}

const missing = new Map(); // glyph -> Set of files

for (const file of walk(DEMO)) {
  const src = stripComments(fs.readFileSync(file, "utf8"), file);
  for (const m of src.matchAll(/\bfa-[a-z0-9-]+\b/g)) {
    const g = m[0];
    if (NOT_GLYPHS.has(g) || available.has(g)) continue;
    if (!missing.has(g)) missing.set(g, new Set());
    missing.get(g).add(path.relative(ROOT, file));
  }
}

console.log(`check-glyphs: ${available.size} glyphs available in the vendored Free kit`);

if (missing.size) {
  console.error(`\n✗ ${missing.size} glyph(s) are not in Font Awesome Free:\n`);
  for (const [glyph, files] of [...missing].sort()) {
    console.error(`  ${glyph}`);
    for (const f of files) console.error(`      ${f}`);
  }
  console.error("\nThese render as blank boxes on the public site. Either pick a Free");
  console.error("glyph, or use one of the repo's vendored game-icons SVGs the way");
  console.error("scripts/shared/icons.mjs:30 does.\n");
  process.exit(1);
}

console.log("✓ every glyph the demo references exists in Font Awesome Free");
