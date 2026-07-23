#!/usr/bin/env node
/**
 * npm run inventory          — regenerate docs/FILE-INVENTORY.md in place.
 * npm run inventory -- --check — exit non-zero if it is stale (for CI).
 *
 * Only the marked regions (the header stat lines and the whole §3 `scripts/`
 * block) are rewritten; all hand-written prose is preserved. Descriptions,
 * section titles and ordering come from dev/inventory/data.json.
 */

import fs from "node:fs";
import { INVENTORY_MD, loadData, render } from "./lib.mjs";

const check = process.argv.includes("--check");
const data = loadData();
const current = fs.readFileSync(INVENTORY_MD, "utf8");
const { md, warnings } = render(data, current);

for (const w of warnings) console.warn(`⚠️  ${w}`);

if (check) {
  if (md !== current) {
    console.error(
      "\n✗ docs/FILE-INVENTORY.md is out of date.\n" +
        "  Run `npm run inventory` and commit the result.",
    );
    process.exit(1);
  }
  console.log("✓ docs/FILE-INVENTORY.md is up to date.");
} else {
  if (md === current) {
    console.log("docs/FILE-INVENTORY.md already up to date.");
  } else {
    fs.writeFileSync(INVENTORY_MD, md);
    console.log("Regenerated docs/FILE-INVENTORY.md.");
  }
  if (warnings.length) {
    console.warn("\nReview the warnings above — new files got a TODO description.");
  }
}
