import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("runtime stylesheet loader is cache-busted with its current content hash", async () => {
  const [manifest, css, entry] = await Promise.all([
    read("module.json").then(JSON.parse),
    read("styles/shadowdark-enhancer.css"),
    read("scripts/shadowdark-enhancer.mjs"),
  ]);
  const expected = createHash("sha256").update(css).digest("hex").slice(0, 12);
  const src = manifest.styles?.find((item) => item.src.startsWith("styles/shadowdark-enhancer.css"))?.src;

  assert.equal(src, "styles/shadowdark-enhancer.css", "Foundry validates manifest styles as real package paths");
  assert.match(entry, new RegExp(`const STYLESHEET_REV = "${expected}";`));
  assert.match(entry, /styles\/shadowdark-enhancer\.css\?v=\$\{STYLESHEET_REV\}/);
  assert.match(entry, /Hooks\.once\("init", \(\) => \{\s*ensureFreshStylesheet\(\);/s);
});

test("monster generator owns a compact responsive layout contract", async () => {
  const [css, template] = await Promise.all([
    read("styles/shadowdark-enhancer.css"),
    read("templates/encounter-creator.hbs"),
  ]);

  // Two panes (the creature's core, one tab on the right) that stack below 800px of the window's own width.
  assert.match(template, /<div class="mc">/);
  assert.match(template, /class="mc-panes"/);
  assert.match(template, /<p class="ui-note info"><span >\{\{\{localize "SDE\.encounterCreator\.mut\.notice"\}\}\}<\/span><\/p>/);
  assert.match(css, /\.mc-panes\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*340px\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /@container\s*\(max-width:\s*800px\)\s*\{[^}]*\.mc-panes[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.mc-cols\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/s);
});
