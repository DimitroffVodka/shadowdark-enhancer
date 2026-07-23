/**
 * Docs contract — keeps docs/wiki/, README.md and docs/API.md honest against
 * the code they describe.
 *
 * Every assertion here corresponds to real drift found during the 2026-07-22
 * documentation pass:
 *   - the README documented a "Hide hidden NPCs from the strip" setting that
 *     has never existed, and gave the wrong default for another;
 *   - docs/API.md covered 11 of the 16 live `game.shadowdarkEnhancer`
 *     namespaces;
 *   - languages/en.json carried `SDE.settings.*` keys with no code behind them.
 *
 * These are all mechanically checkable, so they are checked. Prose accuracy
 * still needs a human — this only guarantees that the *inventory* matches.
 *
 * Pure filesystem + string work: no Foundry globals, runs under `npm test`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = path.join(ROOT, "docs", "wiki");
const IMAGES = path.join(WIKI, "images");

const read = (p) => fs.readFileSync(p, "utf8");
const exists = (p) => fs.existsSync(p);

/** Every .mjs under scripts/. */
function scriptFiles(dir = path.join(ROOT, "scripts"), out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scriptFiles(p, out);
    else if (e.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

/**
 * Brace-match an object literal starting at the `{` at `start`.
 * A length-capped regex mis-reads the settings with long comments/defaults
 * (charBuilderArtFolder), so match braces properly.
 */
function objectAt(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

/** All `game.settings.register(MODULE_ID, "key", {...})` calls. */
function registeredSettings() {
  const found = [];
  for (const f of scriptFiles()) {
    const src = read(f);
    const re = /game\.settings\.register\(\s*MODULE_ID\s*,\s*"([^"]+)"\s*,\s*(?=\{)/g;
    let m;
    while ((m = re.exec(src))) {
      const body = objectAt(src, re.lastIndex);
      // A label may be an i18n key or — per the module's English-only stance —
      // a literal string written straight into the registration.
      const nameLit = body.match(/\bname:\s*"([^"]*)"/);
      found.push({
        key: m[1],
        file: path.relative(ROOT, f),
        config: /\bconfig:\s*true\b/.test(body),
        literalName: nameLit && !nameLit[1].startsWith("SDE.") ? nameLit[1] : null,
        hasLiteralHint: /\bhint:\s*"(?!SDE\.)[^"]*"/.test(body),
      });
    }
  }
  return found;
}

/** All `game.settings.registerMenu(MODULE_ID, "key", {...})` calls. */
function registeredMenus() {
  const found = [];
  for (const f of scriptFiles()) {
    const src = read(f);
    const re = /game\.settings\.registerMenu\(\s*MODULE_ID\s*,\s*"([^"]+)"\s*,\s*(?=\{)/g;
    let m;
    while ((m = re.exec(src))) found.push(m[1]);
  }
  return found;
}

/** Markdown files that make up the published docs. */
function docPages() {
  const pages = fs
    .readdirSync(WIKI)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(WIKI, f));
  pages.push(path.join(ROOT, "README.md"));
  return pages;
}

const LINK_RE = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
const IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;
const isExternal = (t) => /^(https?:|mailto:|#)/.test(t);

describe("docs contract — links and images", () => {
  test("every relative link resolves to a real file", () => {
    const broken = [];
    for (const page of docPages()) {
      const txt = read(page);
      for (const m of txt.matchAll(LINK_RE)) {
        const target = m[1].split("#")[0].trim();
        if (!target || isExternal(target)) continue;
        const abs = path.resolve(path.dirname(page), target);
        if (!exists(abs)) broken.push(`${path.relative(ROOT, page)} -> ${target}`);
      }
    }
    assert.deepEqual(broken, [], `broken relative links:\n  ${broken.join("\n  ")}`);
  });

  test("every #anchor points at a real heading", () => {
    // GitHub's heading slug: lowercase, drop anything that isn't a word
    // character/space/hyphen, spaces to hyphens, duplicates get -1, -2, ...
    const slugsOf = (md) => {
      const seen = new Map();
      const out = new Set();
      for (const m of md.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
        const base = m[1]
          .replace(/`/g, "")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
          .replace(/[*_]/g, "")
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-");
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        out.add(n ? `${base}-${n}` : base);
      }
      return out;
    };

    const cache = new Map();
    const headingsFor = (file) => {
      if (!cache.has(file)) cache.set(file, slugsOf(read(file)));
      return cache.get(file);
    };

    const broken = [];
    for (const page of docPages()) {
      const txt = read(page);
      for (const m of txt.matchAll(LINK_RE)) {
        const raw = m[1].trim();
        if (/^(https?:|mailto:)/.test(raw)) continue;
        const [target, frag] = raw.split("#");
        if (!frag) continue;
        const file = target ? path.resolve(path.dirname(page), target) : page;
        if (!file.endsWith(".md") || !exists(file)) continue; // covered elsewhere
        if (!headingsFor(file).has(frag)) {
          broken.push(
            `${path.relative(ROOT, page)} -> ${raw}  (no heading "#${frag}" in ${path.basename(file)})`,
          );
        }
      }
    }
    assert.deepEqual(broken, [], `anchors with no matching heading:\n  ${broken.join("\n  ")}`);
  });

  test("every image reference resolves to a real file", () => {
    const broken = [];
    for (const page of docPages()) {
      for (const m of read(page).matchAll(IMAGE_RE)) {
        const target = m[1].split("#")[0].trim();
        if (isExternal(target)) continue;
        const abs = path.resolve(path.dirname(page), target);
        if (!exists(abs)) broken.push(`${path.relative(ROOT, page)} -> ${target}`);
      }
    }
    assert.deepEqual(broken, [], `broken image refs:\n  ${broken.join("\n  ")}`);
  });

  test("no orphaned images — every file in docs/wiki/images is used", () => {
    if (!exists(IMAGES)) return;
    const used = new Set();
    for (const page of docPages()) {
      for (const m of read(page).matchAll(IMAGE_RE)) used.add(path.basename(m[1].split("#")[0].trim()));
    }
    const orphans = fs
      .readdirSync(IMAGES)
      .filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f))
      .filter((f) => !used.has(f));
    assert.deepEqual(
      orphans,
      [],
      `unreferenced images (delete them, or reference them):\n  ${orphans.join("\n  ")}`,
    );
  });

  test("every wiki page is linked from at least one other page", () => {
    const linked = new Set();
    for (const page of docPages()) {
      for (const m of read(page).matchAll(LINK_RE)) {
        const target = m[1].split("#")[0].trim();
        if (!target || isExternal(target)) continue;
        const abs = path.resolve(path.dirname(page), target);
        if (abs.startsWith(WIKI) && abs.endsWith(".md")) linked.add(path.basename(abs));
      }
    }
    const orphans = fs
      .readdirSync(WIKI)
      .filter((f) => f.endsWith(".md") && f !== "Home.md")
      .filter((f) => !linked.has(f));
    assert.deepEqual(
      orphans,
      [],
      `wiki pages nothing links to (add them to Home.md):\n  ${orphans.join("\n  ")}`,
    );
  });
});

describe("docs contract — settings", () => {
  const settings = registeredSettings();
  const i18n = JSON.parse(read(path.join(ROOT, "languages", "en.json")));

  test("registration parser finds the known settings", () => {
    // Guards the parser itself: a silent regex failure would make every other
    // settings assertion vacuously pass.
    assert.ok(settings.length >= 40, `expected 40+ registered settings, found ${settings.length}`);
    const keys = settings.map((s) => s.key);
    for (const k of ["combatMovementDefault", "charBuilderArtFolder", "shopSellRatio", "tokenArtSource"]) {
      assert.ok(keys.includes(k), `parser missed a known setting: ${k}`);
    }
  });

  /** The human label for a setting: i18n string, else a literal in the source. */
  const labelOf = (s) => i18n[`SDE.settings.${s.key}.name`] ?? s.literalName;

  test("every config:true setting has a name and a hint", () => {
    const missing = [];
    for (const s of settings.filter((x) => x.config)) {
      if (!labelOf(s)) missing.push(`${s.key}.name (${s.file})`);
      if (!i18n[`SDE.settings.${s.key}.hint`] && !s.hasLiteralHint) {
        missing.push(`${s.key}.hint (${s.file})`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `settings shown in Configure Settings with no label/hint:\n  ${missing.join("\n  ")}`,
    );
  });

  test("every config:true setting is documented in Settings-Reference.md", () => {
    const doc = read(path.join(WIKI, "Settings-Reference.md")).toLowerCase();
    const undocumented = [];
    for (const s of settings.filter((x) => x.config)) {
      const label = labelOf(s);
      if (!label) continue; // covered by the label test above
      // The doc may write "Character Builder — ability roll method" as
      // "Ability roll method" under a Character Builder heading, so accept the
      // distinctive tail too. Case-insensitive: headings recase the label.
      const full = label.toLowerCase();
      const tail = full.split("—").pop().trim();
      if (!doc.includes(full) && !doc.includes(tail)) {
        undocumented.push(`${s.key} — "${label}" (${s.file})`);
      }
    }
    assert.deepEqual(
      undocumented,
      [],
      `settings visible in Configure Settings but missing from ` +
        `docs/wiki/Settings-Reference.md:\n  ${undocumented.join("\n  ")}`,
    );
  });

  test("no orphaned SDE.settings.* strings in en.json", () => {
    const known = new Set([...settings.map((s) => s.key), ...registeredMenus()]);
    // A menu is registered under its own key but conventionally labelled with
    // the key of the setting it edits, so accept both spellings.
    for (const k of [...known]) known.add(k.replace(/Menu$/, ""));
    const orphans = [...new Set(
      Object.keys(i18n)
        .filter((k) => k.startsWith("SDE.settings."))
        .map((k) => k.split(".")[2]),
    )].filter((key) => !known.has(key));
    assert.deepEqual(
      orphans,
      [],
      `en.json has SDE.settings.* strings with no registered setting ` +
        `(delete them):\n  ${orphans.join("\n  ")}`,
    );
  });
});

describe("docs contract — code-derived facts", () => {
  // Both of these were real drift caught by an external review (2026-07-22):
  // the wiki said "119 tables" after the count moved to 125, and claimed a
  // verified Foundry version the manifest doesn't declare.

  test("verified Foundry version in docs matches module.json", () => {
    const manifest = JSON.parse(read(path.join(ROOT, "module.json")));
    const verified = manifest.compatibility?.verified;
    assert.ok(verified, "module.json has no compatibility.verified");
    for (const page of ["docs/wiki/Installation-and-Setup.md", "README.md"]) {
      const txt = read(path.join(ROOT, page));
      const claimed = [...txt.matchAll(/\*\*v?(1[34]\.\d+)\*\*/g)].map((m) => m[1]);
      for (const v of claimed.filter((v) => v.startsWith("14."))) {
        assert.equal(
          v,
          verified,
          `${page} claims verified Foundry ${v} but module.json declares ${verified}`,
        );
      }
    }
  });

  test("table-recipe count in docs matches CONTENT_ENTRIES", () => {
    const src = read(path.join(ROOT, "scripts", "importer", "tables", "table-shapes.mjs"));
    const actual = (src.match(/_entry\(/g) || []).length;
    const doc = read(path.join(WIKI, "Table-Import-and-Shapes.md"));
    const m = doc.match(/\*\*(\d+) tables\*\* currently carry a recipe/);
    assert.ok(m, "Table-Import-and-Shapes.md no longer states the recipe count");
    assert.equal(
      Number(m[1]),
      actual,
      `docs say ${m[1]} recipes, table-shapes.mjs has ${actual} — update the page`,
    );
  });
});

describe("docs contract — public API", () => {
  test("every game.shadowdarkEnhancer namespace has a section in docs/API.md", () => {
    const entry = read(path.join(ROOT, "scripts", "shadowdark-enhancer.mjs"));
    const start = entry.indexOf("game.shadowdarkEnhancer = {");
    assert.ok(start > -1, "could not find the API object literal in the entry point");
    const api = objectAt(entry, entry.indexOf("{", start));

    // Top-level keys of the API object, at one indent level inside it.
    const keys = [...api.matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*):/gm)]
      .map((m) => m[1])
      .filter((k) => k !== "apiVersion");
    assert.ok(keys.length >= 15, `expected 15+ API namespaces, parsed ${keys.length}`);

    const doc = read(path.join(ROOT, "docs", "API.md"));
    const documented = new Set(
      [...doc.matchAll(/^##\s+`([a-zA-Z]+)`/gm)].map((m) => m[1]),
    );
    // "## `monsterCreator` / `forge`" documents two namespaces in one heading.
    for (const m of doc.matchAll(/^##\s+.*$/gm)) {
      for (const t of m[0].matchAll(/`([a-zA-Z]+)`/g)) documented.add(t[1]);
    }
    const missing = keys.filter((k) => !documented.has(k));
    assert.deepEqual(
      missing,
      [],
      `API namespaces exposed on game.shadowdarkEnhancer but absent from ` +
        `docs/API.md:\n  ${missing.join("\n  ")}`,
    );
  });
});
