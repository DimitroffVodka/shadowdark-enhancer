#!/usr/bin/env node
/**
 * npm run inventory          — refresh the build revision in place.
 * npm run inventory:check    — exit non-zero if it is stale (for CI).
 *
 * Foundry serves module scripts as ordinary HTTP resources at unchanging URLs,
 * so a browser that has them cached keeps running the OLD build after an
 * update — silently, with no error and nothing in the UI to say so. That cost
 * Patrick a whole classification pass on 2026-09-18: the tab was running a
 * previous build's classifier defaults while the files on disk had newer ones.
 *
 * The stylesheet already solves this by carrying a content hash in its URL
 * (STYLESHEET_REV). Scripts cannot: their URLs come from the manifest, which
 * Foundry validates as real package paths. So instead we stamp the same hash
 * in two places — the bundle (cacheable, therefore possibly stale) and
 * module.json (fetched fresh at runtime) — and let the running code compare
 * them. A mismatch IS a stale cache, by construction.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "scripts/shadowdark-enhancer.mjs");
const MANIFEST = path.join(ROOT, "module.json");

/** Every file the browser caches as code: the module's own scripts. */
export function scriptFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.m?js$/.test(e.name)) out.push(full);
    }
  };
  walk(path.join(root, "scripts"));
  return out;
}

const REV_LINE = /^const BUILD_REV = "[0-9a-f]{12}";$/m;

/**
 * Hash path + contents of every script. Paths are included so that renaming or
 * deleting a file moves the revision too, not just editing one.
 *
 * The entry file's own stamp is blanked before hashing. Without that the hash
 * covers the value derived from it, and stamping the new value changes the hash
 * again — a fixed point you cannot reach except by luck, so the check would
 * fail immediately after every regeneration.
 */
export function buildRev(root = ROOT) {
  const h = createHash("sha256");
  const entry = path.join(root, "scripts/shadowdark-enhancer.mjs");
  for (const f of scriptFiles(root)) {
    h.update(path.relative(root, f).replaceAll(path.sep, "/"));
    h.update("\0");
    const body = fs.readFileSync(f, "utf8");
    h.update(f === entry ? body.replace(REV_LINE, 'const BUILD_REV = "";') : body);
    h.update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

function main() {
  const check = process.argv.includes("--check");
  const rev = buildRev();

  const entry = fs.readFileSync(ENTRY, "utf8");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  if (!REV_LINE.test(entry)) {
    console.error(`\n✗ ${path.relative(ROOT, ENTRY)} has no \`const BUILD_REV = "…";\` line to stamp.`);
    process.exit(1);
  }

  const entryStale = !entry.includes(`const BUILD_REV = "${rev}";`);
  const manifestStale = manifest.flags?.buildRev !== rev;

  if (check) {
    if (entryStale || manifestStale) {
      console.error(
        `\n✗ Build revision is out of date (scripts hash to ${rev}).\n` +
          "  Run `npm run inventory` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`✓ Build revision ${rev} is up to date.`);
    return;
  }

  if (!entryStale && !manifestStale) {
    console.log(`Build revision ${rev} already up to date.`);
    return;
  }

  const stamped = rev;
  fs.writeFileSync(ENTRY, entry.replace(REV_LINE, `const BUILD_REV = "${stamped}";`));

  // Surgical: re-serialising the whole manifest would reformat every hand-laid
  // one-line object in it and bury this one field in the diff.
  const raw = fs.readFileSync(MANIFEST, "utf8");
  const flags = /\n  "flags": \{[^{}]*\}\n\}\s*$/;
  if (!flags.test(raw)) {
    console.error('\n✗ module.json has no top-level "flags" object to stamp.');
    process.exit(1);
  }
  fs.writeFileSync(MANIFEST, raw.replace(flags, `\n  "flags": { "buildRev": "${stamped}" }\n}\n`));
  console.log(`Stamped build revision ${stamped}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
