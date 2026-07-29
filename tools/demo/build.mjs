#!/usr/bin/env node
/**
 * Assemble the public demo site into dist/demo/.
 *
 * The demo reuses the module's REAL stylesheet and icons rather than a
 * committed copy, so it can never drift out of sync with what the module
 * actually looks like. Nothing in this repo would catch a stale snapshot:
 * no test reads styles/, and eslint.config.mjs ignores it.
 *
 * Layout produced (flat site root -- see the icon-path note below):
 *
 *   dist/demo/
 *     index.html, demo.css, demo.js, vendor/, assets/     <- from demo/
 *     styles/shadowdark-enhancer.css                      <- the real one
 *     modules/shadowdark-enhancer/icons/**                <- the real ones
 *
 * WHY THE ODD icons/ DESTINATION: scripts/shared/icons.mjs:14 defines
 *   const P = "modules/shadowdark-enhancer/icons"
 * with no leading slash, i.e. RELATIVE to the page. Mirroring the directory
 * under that exact name makes the module's own markup resolve byte-for-byte,
 * so the demo can paste real markup without rewriting a single src.
 *
 * That buys one constraint: every HTML page must sit at the artifact root.
 * A page in a subdirectory would resolve the same relative path one level
 * too deep. Do not add <base href> to work around it -- that hardcodes the
 * Pages sub-path and breaks local file:// preview.
 *
 * Run with --clean to delete dist/demo first (CI always starts clean anyway).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "dist", "demo");

/** Source -> destination, relative to ROOT and OUT respectively. */
const COPIES = [
  { from: "demo", to: "." },
  { from: "styles/shadowdark-enhancer.css", to: "styles/shadowdark-enhancer.css" },
  { from: "icons", to: "modules/shadowdark-enhancer/icons" },
  // Ancestry portraits (CC0 / public domain / CC BY) and the Shikashi item
  // icons, whose pack readme permits use in commercial projects -- both are
  // credited in CREDITS.md. Copied whole rather than cherry-picked: a
  // hand-maintained list of "icons the demo happens to use" silently rots the
  // first time someone edits the markup. assets/pdf and assets/portraits stay
  // out; the demo has no use for them.
  { from: "assets/ancestries", to: "modules/shadowdark-enhancer/assets/ancestries" },
  { from: "assets/icons/shikashi", to: "modules/shadowdark-enhancer/assets/icons/shikashi" },
];

function copy(from, to) {
  const src = path.join(ROOT, from);
  const dest = path.join(OUT, to);
  if (!fs.existsSync(src)) throw new Error(`build.mjs: missing source ${from}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

function dirSize(dir) {
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    bytes += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return bytes;
}

if (process.argv.includes("--clean") && fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true });
}

fs.mkdirSync(OUT, { recursive: true });
for (const { from, to } of COPIES) copy(from, to);

// The site is only usable if the entry point landed.
const index = path.join(OUT, "index.html");
if (!fs.existsSync(index)) throw new Error("build.mjs: dist/demo/index.html was not produced");

const mb = (dirSize(OUT) / 1024 / 1024).toFixed(2);
console.log(`Built dist/demo -- ${countFiles(OUT)} files, ${mb} MB`);
