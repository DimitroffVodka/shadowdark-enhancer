#!/usr/bin/env node
/**
 * Mirror `docs/wiki/` into the GitHub wiki.
 *
 * `docs/wiki/` is the single source: MkDocs publishes the Pages site from it,
 * and the wiki is a derived copy. Nothing synced the two, so they drifted — by
 * the time this script was written the wiki was five weeks stale, four pages
 * had never been published at all, and `Importer-Hub` was missing every mention
 * of "Import everything" because that section landed after the last hand-sync.
 *
 * Three transformations, and they are the whole reason a copy is not enough:
 *
 *   1. `index.md` becomes `Home.md`. The wiki's landing page is `Home`.
 *   2. Internal links lose their `.md`. MkDocs resolves `Page.md`; the wiki
 *      resolves `Page` and 404s on the extension.
 *   3. Image links become absolute `raw.githubusercontent.com` URLs on
 *      `master`. The wiki is a separate repository and does not hold the image
 *      files. NOTE the consequence: a screenshot only appears on the wiki once
 *      it has been merged to `master`, so syncing from a release branch shows
 *      the images that branch has in common with master.
 *
 * Usage:
 *   node tools/sync-wiki.mjs [--check] [--wiki <path>]
 *
 *   --check   write nothing; exit 1 if the wiki is out of date. For CI.
 *   --wiki    path to a checkout of `<repo>.wiki.git`
 *             (default: ../shadowdark-enhancer.wiki)
 *
 * Committing and pushing is deliberately left to the caller: this script owns
 * the transformation, not the decision to publish.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "docs", "wiki");
const RAW = "https://raw.githubusercontent.com/DimitroffVodka/shadowdark-enhancer/master/docs/wiki";

const args = process.argv.slice(2);
const check = args.includes("--check");
const wikiArg = args[args.indexOf("--wiki") + 1];
const WIKI = path.resolve(args.includes("--wiki") && wikiArg
  ? wikiArg
  : path.join(ROOT, "..", "shadowdark-enhancer.wiki"));

/** Source page name → the wiki page name it publishes as. */
const wikiName = (file) => (file === "index.md" ? "Home.md" : file);

/**
 * Rewrite one page for the wiki. Link and image forms differ; the prose does
 * not, so a wiki page is never edited by hand — it is regenerated.
 */
export function toWiki(markdown) {
  return String(markdown)
    // Images first: they also end in a path, and the link rule below would
    // otherwise strip an extension it has no business touching.
    .replace(/\]\(images\/([^)\s]+)\)/g, `](${RAW}/images/$1)`)
    // Internal page links: `](Page.md)` → `](Page)`, `](index.md)` → `](Home)`.
    // Anchors survive: `](Page.md#section)` → `](Page#section)`.
    .replace(/\]\((?!https?:|images\/)([A-Za-z0-9._-]+)\.md(#[^)]*)?\)/g,
      (_m, page, anchor = "") => `](${page === "index" ? "Home" : page}${anchor})`);
}

if (!existsSync(WIKI)) {
  console.error(`✗ no wiki checkout at ${WIKI}`);
  console.error("  git clone https://github.com/DimitroffVodka/shadowdark-enhancer.wiki.git "
    + path.basename(WIKI));
  process.exit(2);
}

const pages = readdirSync(SRC).filter((f) => f.endsWith(".md")).sort();
const expected = new Set(pages.map(wikiName));
const changed = [];
const added = [];

for (const file of pages) {
  const target = path.join(WIKI, wikiName(file));
  const next = toWiki(readFileSync(path.join(SRC, file), "utf8"));
  const prev = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (prev === next) continue;
  (prev === null ? added : changed).push(wikiName(file));
  if (!check) writeFileSync(target, next);
}

// A page deleted from docs/wiki must not linger on the wiki as a dead entry.
const stale = readdirSync(WIKI)
  .filter((f) => f.endsWith(".md") && !expected.has(f))
  .sort();
if (!check) for (const f of stale) rmSync(path.join(WIKI, f));

const total = added.length + changed.length + stale.length;
const report = (label, list) => { if (list.length) console.log(`  ${label}: ${list.join(", ")}`); };
console.log(`${pages.length} source pages → ${WIKI}`);
report("new", added);
report("updated", changed);
report("removed", stale);

if (!total) { console.log("✓ wiki is up to date."); process.exit(0); }
if (check) {
  console.error(`\n✗ wiki is ${total} page(s) out of date. Run \`npm run wiki:sync\` and push.`);
  process.exit(1);
}
console.log(`\n✓ wrote ${total} page(s). Commit and push from ${WIKI}.`);
