import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every string the module shows comes from `languages/en.json` (#169), so a
 * translator has one file to work in and a typo in a key is caught here rather
 * than shown to the GM as a raw `SDE.…`.
 *
 * Keys are found by scanning every script and template for `SDE.…` written out
 * in full, which is why the code never builds a key from pieces.
 */
const en = JSON.parse(readFileSync("languages/en.json", "utf8"));

const walk = (path) => (statSync(path).isDirectory()
  ? readdirSync(path).flatMap((f) => walk(join(path, f)))
  : /\.(mjs|hbs)$/.test(path) ? [path] : []);
const sources = new Map([...walk("scripts"), ...walk("templates")].map((f) => [f, readFileSync(f, "utf8")]));

/**
 * Prefixes whose keys older code still builds from pieces
 * (`SDE.settings.${key}.name`), so no scan can see every key they use. Their
 * keys are spared the "nothing asks for it" check only; docs-contract checks
 * the settings keys its own way.
 */
const BUILT = ["SDE.settings.", "SDE.charBuilder.", "SDE.rulesData.", "SDE.training.notify."];

/** Every key mentioned in full anywhere, with one file that mentions it. */
const used = new Map();
for (const [file, src] of sources) {
  for (const m of src.matchAll(/\bSDE\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g)) {
    // `SDE.x.` + y or `SDE.x.${y}` names a prefix, not a key.
    if (/[.$]/.test(src[m.index + m[0].length] ?? "")) continue;
    if (!used.has(m[0])) used.set(m[0], file);
  }
}

test("every key the code asks for exists in en.json", () => {
  const missing = [...used].filter(([key]) => !(key in en)).map(([key, file]) => `${key} (${file})`);
  assert.deepEqual(missing, []);
});

test("en.json carries no key nothing asks for", () => {
  const unused = Object.keys(en)
    .filter((k) => k.startsWith("SDE.") && !BUILT.some((p) => k.startsWith(p)) && !used.has(k));
  assert.deepEqual(unused, []);
});

test("no string is left empty", () => {
  assert.deepEqual(Object.entries(en).filter(([, v]) => !String(v).trim()).map(([k]) => k), []);
});

test("no key is both a string and a group", () => {
  // Foundry expands dotted keys into objects; `a.b` and `a.b.c` cannot both be strings.
  const keys = new Set(Object.keys(en));
  const clash = [...keys].filter((k) => [...keys].some((o) => o.startsWith(`${k}.`)));
  assert.deepEqual(clash, []);
});

test("every {n} placeholder is filled by a format call", () => {
  // `localize` does not interpolate; only `format` does. A string with a
  // placeholder reached through `localize` shows the GM a literal {count}.
  const code = [...sources.values()].join("\n");
  const wrong = [];
  for (const [key, value] of Object.entries(en)) {
    if (!/\{[a-z]/i.test(String(value))) continue;
    const esc = key.replace(/\./g, "\\.");
    if (new RegExp(`localize\\(\\s*["'\`]${esc}["'\`]\\s*\\)`).test(code)
      || new RegExp(`\\{\\{\\{?\\s*localize\\s+["']${esc}["']\\s*\\}\\}`).test(code)) wrong.push(key);
  }
  assert.deepEqual(wrong, []);
});

/**
 * The translator is often called `t`, and `t` is a tempting name for a tag, a
 * table or a timer. A local one shadows it, and the call then throws "t is not
 * a function" at render time — which looks to the GM like the button doing
 * nothing at all. That shipped once; this is what stops it shipping twice.
 */
test("no file that has the translator also declares a local t", () => {
  const bad = [];
  for (const [file, src] of sources) {
    // Files that reach the translator as `t` — either their own or the shared one.
    if (!file.endsWith(".mjs") || !/\bt\(\s*["'`]SDE\./.test(src)) continue;
    for (const m of src.matchAll(/\b(?:const|let|var)\s+t\s*=(?!\s*\((?:key|k)\b)/g)) {
      bad.push(`${file}: ${src.slice(m.index, m.index + 40).split("\n")[0]}`);
    }
    for (const m of src.matchAll(/\((?:[^()]*,\s*)?t\s*(?:,[^()]*)?\)\s*=>/g)) {
      bad.push(`${file}: arrow parameter t — ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
