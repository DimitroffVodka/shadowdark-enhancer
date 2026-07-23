/**
 * Inventory contract — keeps docs/FILE-INVENTORY.md §3 honest against the
 * tracked scripts it lists.
 *
 * This is the fast gate: it trips when a tracked `.mjs` under scripts/ is
 * added, removed or renamed without the inventory following, and when any
 * listed file has no description. It deliberately does NOT check line counts —
 * those drift on every edit and are refreshed by `npm run inventory` (enforced
 * in CI via `npm run inventory:check`), so gating them here would fail the
 * build on every code change.
 *
 * Pure filesystem + git, no Foundry globals; runs under `npm test`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(p, "utf8");

const data = JSON.parse(read(path.join(ROOT, "tools", "inventory", "data.json")));
const md = read(path.join(ROOT, "docs", "FILE-INVENTORY.md"));

/** The full paths + descriptions the §3 tables currently document. */
function documented() {
  const START = "<!-- inventory:scripts:start -->";
  const END = "<!-- inventory:scripts:end -->";
  const s = md.indexOf(START);
  const e = md.indexOf(END);
  assert.ok(s > -1 && e > s, "FILE-INVENTORY.md is missing the scripts marker region");
  const dirById = new Map(data.sections.map((sec) => [sec.id, sec.dir]));

  const rows = new Map();
  let dir = null;
  for (const line of md.slice(s + START.length, e).split("\n")) {
    const h = line.match(/^### (3\.\d+)\s/);
    if (h) {
      dir = dirById.get(h[1]);
      continue;
    }
    if (!line.startsWith("|")) continue;
    if (/\|\s*File\s*\|/i.test(line) || /^\|[\s|:-]*\|$/.test(line)) continue;
    const c = line.split("|");
    const rel = c[1].trim().replace(/`/g, "");
    const desc = c.slice(3, c.length - 1).join("|").trim();
    rows.set(dir ? path.posix.join(dir, rel) : rel, desc);
  }
  return rows;
}

/** Tracked .mjs files under scripts/ — what §3 is responsible for. */
function trackedScripts() {
  return execFileSync("git", ["ls-files", "scripts/*"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".mjs"));
}

describe("inventory contract — §3 file coverage", () => {
  const rows = documented();
  const tracked = trackedScripts();

  test("parser found the §3 tables", () => {
    assert.ok(rows.size >= 100, `expected 100+ documented files, parsed ${rows.size}`);
  });

  test("every tracked script has an inventory row", () => {
    const missing = tracked.filter((f) => !rows.has(f));
    assert.deepEqual(
      missing,
      [],
      `scripts files with no row in docs/FILE-INVENTORY.md — run ` +
        `\`npm run inventory\`:\n  ${missing.join("\n  ")}`,
    );
  });

  test("no inventory row points at a file that no longer exists", () => {
    const live = new Set(tracked);
    const dead = [...rows.keys()].filter((p) => !live.has(p));
    assert.deepEqual(
      dead,
      [],
      `inventory rows for deleted files — run \`npm run inventory\`:\n  ${dead.join("\n  ")}`,
    );
  });

  test("every documented file has a real description", () => {
    const blank = [...rows.entries()]
      .filter(([, d]) => !d || /TODO: describe/i.test(d))
      .map(([p]) => p);
    assert.deepEqual(
      blank,
      [],
      `files listed with no description (fill them in dev/inventory/data.json):\n  ${blank.join("\n  ")}`,
    );
  });
});
