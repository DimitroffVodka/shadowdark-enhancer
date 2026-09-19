import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Every hex-map string the UI shows comes from `languages/en.json`, so a
 * translator has one file to work in and a typo in a key is caught here rather
 * than shown to the GM as a raw `SDE.hexMap.…`.
 */
const en = JSON.parse(readFileSync("languages/en.json", "utf8"));
const PREFIX = "SDE.hexMap.";

const sources = [
  ...readdirSync("scripts/hex-map").filter((f) => f.endsWith(".mjs")).map((f) => `scripts/hex-map/${f}`),
  "templates/hex-tagger.hbs",
  "templates/hex-brush.hbs",
];

/** Every SDE.hexMap key mentioned anywhere, with the file that mentions it. */
function used() {
  const out = new Map();
  for (const file of sources) {
    for (const m of readFileSync(file, "utf8").matchAll(/SDE\.hexMap\.[A-Za-z0-9_.]+/g)) {
      if (!out.has(m[0])) out.set(m[0], file);
    }
  }
  return out;
}

test("every hex-map key the code asks for exists in en.json", () => {
  const missing = [...used()].filter(([key]) => !(key in en)).map(([key, file]) => `${key} (${file})`);
  assert.deepEqual(missing, []);
});

test("en.json carries no hex-map key nothing asks for", () => {
  const asked = new Set(used().keys());
  assert.deepEqual(Object.keys(en).filter((k) => k.startsWith(PREFIX) && !asked.has(k)), []);
});

test("no hex-map string is left empty", () => {
  const blank = Object.entries(en).filter(([k, v]) => k.startsWith(PREFIX) && !String(v).trim()).map(([k]) => k);
  assert.deepEqual(blank, []);
});

test("every {n} placeholder in a hex-map string is filled by a format call", () => {
  // `localize` does not interpolate; only `format` does. A string with a
  // placeholder reached through `localize` shows the GM a literal {count}.
  const code = sources.map((f) => readFileSync(f, "utf8")).join("\n");
  const wrong = [];
  for (const [key, value] of Object.entries(en)) {
    if (!key.startsWith(PREFIX) || !/\{[a-z]/i.test(String(value))) continue;
    const viaLocalize = new RegExp(`localize\\(\\s*["'\`]${key.replace(/\./g, "\\.")}["'\`]\\s*\\)`);
    const viaHbs = new RegExp(`\\{\\{\\s*localize\\s+["']${key.replace(/\./g, "\\.")}["']\\s*\\}\\}`);
    if (viaLocalize.test(code) || viaHbs.test(code)) wrong.push(key);
  }
  assert.deepEqual(wrong, []);
});
