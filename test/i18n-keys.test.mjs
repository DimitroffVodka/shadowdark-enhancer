import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Every string these features show comes from `languages/en.json`, so a
 * translator has one file to work in and a typo in a key is caught here rather
 * than shown to the GM as a raw `SDE.…`.
 */
const en = JSON.parse(readFileSync("languages/en.json", "utf8"));

const dir = (path, match = /\.mjs$/) => readdirSync(path).filter((f) => match.test(f)).map((f) => `${path}/${f}`);

const FEATURES = {
  "SDE.hexMap.": [...dir("scripts/hex-map"), "templates/hex-tagger.hbs", "templates/hex-brush.hbs"],
  "SDE.importer.": [...dir("scripts/importer", /^importer-hub.*\.mjs$/), "templates/importer-hub.hbs", "templates/partials/tree-node.hbs"],
};

/** Every key of `prefix` mentioned anywhere in its files, with one file that mentions it. */
function used(prefix, sources) {
  const out = new Map();
  const pattern = new RegExp(`${prefix.replace(/\./g, "\\.")}[A-Za-z0-9_.]+`, "g");
  for (const file of sources) {
    for (const m of readFileSync(file, "utf8").matchAll(pattern)) {
      if (!out.has(m[0])) out.set(m[0], file);
    }
  }
  return out;
}

for (const [prefix, sources] of Object.entries(FEATURES)) {
  test(`${prefix}: every key the code asks for exists in en.json`, () => {
    const missing = [...used(prefix, sources)].filter(([key]) => !(key in en)).map(([key, file]) => `${key} (${file})`);
    assert.deepEqual(missing, []);
  });

  test(`${prefix}: en.json carries no key nothing asks for`, () => {
    const asked = new Set(used(prefix, sources).keys());
    assert.deepEqual(Object.keys(en).filter((k) => k.startsWith(prefix) && !asked.has(k)), []);
  });

  test(`${prefix}: no string is left empty`, () => {
    const blank = Object.entries(en).filter(([k, v]) => k.startsWith(prefix) && !String(v).trim()).map(([k]) => k);
    assert.deepEqual(blank, []);
  });

  test(`${prefix}: every {n} placeholder is filled by a format call`, () => {
    // `localize` does not interpolate; only `format` does. A string with a
    // placeholder reached through `localize` shows the GM a literal {count}.
    const code = sources.map((f) => readFileSync(f, "utf8")).join("\n");
    const wrong = [];
    for (const [key, value] of Object.entries(en)) {
      if (!key.startsWith(prefix) || !/\{[a-z]/i.test(String(value))) continue;
      const esc = key.replace(/\./g, "\\.");
      if (new RegExp(`localize\\(\\s*["'\`]${esc}["'\`]\\s*\\)`).test(code)
        || new RegExp(`\\{\\{\\s*localize\\s+["']${esc}["']\\s*\\}\\}`).test(code)) wrong.push(key);
    }
    assert.deepEqual(wrong, []);
  });
}

/**
 * The translator is called `t`, and `t` is a tempting name for a tag, a table
 * or a timer. A local one shadows it, and the call then throws "t is not a
 * function" at render time — which looks to the GM like the button doing
 * nothing at all. That shipped once; this is what stops it shipping twice.
 */
test("no file that has the translator also declares a local t", () => {
  const files = [...dir("scripts/hex-map"), ...dir("scripts/importer", /^importer-hub.*\.mjs$/)];
  const bad = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Files that reach the translator as `t` — either their own or the shared one.
    if (!/\bt\(\s*["'`]SDE\./.test(src)) continue;
    for (const m of src.matchAll(/\b(?:const|let|var)\s+t\s*=(?!\s*\(key)/g)) {
      bad.push(`${file}: ${src.slice(m.index, m.index + 40).split("\n")[0]}`);
    }
    for (const m of src.matchAll(/\((?:[^()]*,\s*)?t\s*(?:,[^()]*)?\)\s*=>/g)) {
      bad.push(`${file}: arrow parameter t — ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
