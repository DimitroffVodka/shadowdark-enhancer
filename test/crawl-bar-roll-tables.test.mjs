import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("Tools > Roll tables opens the Roll Tables tab, not the Importer Hub", async () => {
  const src = await fs.readFile(new URL("../scripts/crawl-bar/crawl-bar.mjs", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => /^\s*rollTables:/.test(l));
  assert.ok(line, "the opener exists");
  assert.ok(!/openHub/.test(line), "it must not route to the importer");
  assert.match(line, /changeTab\("tables"/);
});
