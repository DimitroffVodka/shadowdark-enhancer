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

  assert.match(template, /<details class="sde-creator-section sde-mut-section"/);
  assert.match(
    template,
    /<p class="sde-mut-notice">[\s\S]*<i[^>]*><\/i>[\s\S]*<span class="sde-mut-notice-copy">/,
    "notice prose is one flex child instead of fragmented inline flex items",
  );
  assert.match(css, /\.sde-mut-section\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /\.sde-mut-columns\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@container\s*\(max-width:\s*700px\)[\s\S]*?\.sde-mut-columns\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.sde-mut-selected\s*\{[^}]*grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)\s+24px/s);
  assert.match(css, /\.sde-mut-actions\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.sde-mut-actions\s+button\s*\{[^}]*flex:\s*0\s+1\s+240px/s);
});
