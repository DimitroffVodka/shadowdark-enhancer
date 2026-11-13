#!/usr/bin/env node
/**
 * npm run hexes:manifest — rewrite assets/hexes/manifest.json from the folders.
 *
 * The drawn hex map (docs/plans/hex-painting.md) never browses folders at run time: a GM-only
 * FilePicker browse is what made Extras cache a catalogue per world that went stale when new
 * art shipped. The manifest ships with the module instead, so adding art is: drop the WebP
 * files into a terrain's folder, run this, commit both. test/tile-sets.test.mjs fails when the
 * manifest and the folders disagree.
 */

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HEX_ART_DIR = fileURLToPath(new URL("../assets/hexes/", import.meta.url));

/** Every folder of WebP files under `root`, files sorted by code unit so every machine writes the same bytes. */
export function scanHexArt(root = HEX_ART_DIR) {
  const folders = {};
  for (const name of readdirSync(root).sort()) {
    if (!statSync(join(root, name)).isDirectory()) continue;
    const files = readdirSync(join(root, name)).filter((f) => f.toLowerCase().endsWith(".webp")).sort();
    if (files.length) folders[name] = files;
  }
  return { version: 1, folders };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = scanHexArt();
  writeFileSync(join(HEX_ART_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  const count = Object.values(manifest.folders).reduce((n, files) => n + files.length, 0);
  console.log(`Wrote assets/hexes/manifest.json: ${count} files in ${Object.keys(manifest.folders).length} folders.`);
}
