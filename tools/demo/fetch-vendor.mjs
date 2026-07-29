#!/usr/bin/env node
/**
 * Download the demo site's third-party web assets into demo/vendor/.
 *
 * Run by hand when refreshing them; the results are COMMITTED, so neither the
 * Pages build nor CI ever reaches the network. This script exists mainly to
 * record provenance: every file below is redistributable, and this is the
 * evidence of where it came from and under what licence.
 *
 *   npm run demo:vendor
 *
 * WHY FONT AWESOME **FREE 6** AND NOT 7:
 * styles/shadowdark-enhancer.css:766 and :1927 hardcode the family chain
 *   "Font Awesome 7 Pro", "Font Awesome 6 Free", "Font Awesome 5 Free", "FontAwesome"
 * FA Free 6 registers "Font Awesome 6 Free" -- the second entry. FA Free 7
 * registers "Font Awesome 7 Free", which appears nowhere in that chain, so the
 * two pseudo-element glyphs would render as blank boxes.
 *
 * Foundry bundles Font Awesome *Pro*, licensed to Foundry. Never copy it here.
 *
 * NOT handled by this script (copied from the Shadowdark system by hand, see
 * demo/vendor/fonts/README.md): JSL Blackletter, which its readme permits
 * redistributing only UNALTERED and accompanied by that readme -- so it ships
 * as the original .ttf, not converted to woff2.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR = path.join(ROOT, "demo", "vendor");

// A browser UA is required: the Google Fonts CSS API serves .ttf to unknown
// clients and .woff2 only to browsers that advertise support for it.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FA = "6.7.2";
const FA_CDN = `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@${FA}`;

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

async function save(url, dest) {
  const res = await get(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const abs = path.join(VENDOR, dest);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  console.log(`  ${dest.padEnd(46)} ${(buf.length / 1024).toFixed(1)} KB`);
  return buf;
}

/**
 * Pull one subset's woff2 out of a Google Fonts css2 response.
 *
 * css2 returns one @font-face per (weight x subset) -- for Montserrat that is
 * five subsets per weight -- each preceded by a `/* subset *\/` comment. The
 * demo is English, so we keep `latin` only and drop the rest.
 */
async function googleFont(family, axis, subset, dest) {
  const q = axis ? `${family}:${axis}` : family;
  const css = await (await get(`https://fonts.googleapis.com/css2?family=${q}&display=swap`)).text();
  const blocks = css.split(/\/\*\s*/).filter((b) => b.startsWith(`${subset} `) || b.startsWith(`${subset}*`));
  if (!blocks.length) throw new Error(`no "${subset}" subset in css2 for ${q}`);
  const url = blocks[0].match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
  if (!url) throw new Error(`no woff2 url in the "${subset}" block for ${q}`);
  return save(url, dest);
}

console.log(`Font Awesome Free ${FA}:`);
await save(`${FA_CDN}/css/all.min.css`, "fontawesome/css/all.min.css");
for (const f of ["fa-solid-900", "fa-regular-400", "fa-brands-400"]) {
  await save(`${FA_CDN}/webfonts/${f}.woff2`, `fontawesome/webfonts/${f}.woff2`);
}
await save(`${FA_CDN}/LICENSE.txt`, "fontawesome/LICENSE.txt");

console.log("\nFonts (SIL OFL 1.1):");
// IM Fell English stands in for "Old Newspaper Font", which is licensed free
// for PERSONAL USE only and cannot ship. See demo/vendor/fonts/README.md.
await googleFont("IM+Fell+English", "", "latin", "fonts/imfell-english-400.woff2");
await googleFont("Montserrat", "wght@500", "latin", "fonts/montserrat-500.woff2");
await googleFont("Montserrat", "wght@600", "latin", "fonts/montserrat-600.woff2");

console.log("\nLicences:");
for (const [slug, dest] of [
  ["imfellenglish", "fonts/OFL-IMFellEnglish.txt"],
  ["montserrat", "fonts/OFL-Montserrat.txt"],
]) {
  await save(`https://raw.githubusercontent.com/google/fonts/main/ofl/${slug}/OFL.txt`, dest);
}

console.log("\nDone. Review demo/vendor/fonts/README.md before committing.");
