import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `{{../g.idx}}` renders EMPTY when `g` is a block param.
 *
 * Handlebars resolves a block param lexically, so `../` walks the context
 * stack past it and finds nothing — no error, no warning, just an empty
 * attribute. In hex-tagger.hbs that put `data-idx=""` on every opened-card
 * select, so all of them read back as card 0 and the GM's answers were wiped
 * on the next render. Inside the block, the plain name is already in scope.
 */
function templates(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) templates(p, out);
    else if (e.name.endsWith(".hbs")) out.push(p);
  }
  return out;
}

test("no template reaches a block param through ../", () => {
  const bad = [];
  for (const file of templates("templates")) {
    const src = readFileSync(file, "utf8");
    const params = new Set([...src.matchAll(/as \|([^|]+)\|/g)].flatMap((m) => m[1].trim().split(/\s+/)));
    if (!params.size) continue;
    for (const m of src.matchAll(/\{\{[#/]?\s*(?:\.\.\/)+([A-Za-z_$][\w$]*)/g)) {
      if (params.has(m[1])) bad.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
