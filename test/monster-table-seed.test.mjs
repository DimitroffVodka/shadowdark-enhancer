/**
 * Monster-table import routing + fail-closed matrix commit — SYNTHETIC only.
 *
 * Covers the pure helpers behind the review remediation:
 *   - buildMonsterTableSeed() produces a seed carrying the exact Core source
 *     key, page/book, and manifest/matrix/column fields the Importer Hub needs;
 *   - that seed resolves a Core PDF href + grab target through the source-PDF
 *     registry (stubbed game/foundry — no live world);
 *   - validateMatrixCommit() enforces all-or-nothing whole-matrix commits.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMonsterTableSeed,
  CORE_PDF_SOURCE_KEY,
} from "../scripts/encounter/monster-table-runtime.mjs";
import {
  validateMatrixCommit,
  parseMatrixByColumns,
} from "../scripts/encounter/table-importer.mjs";
import { columnManifestId } from "../scripts/encounter/table-manifest.mjs";

/* -- seed shape ------------------------------------------------------------ */

test("buildMonsterTableSeed carries the Core source key + matrix/PDF fields", () => {
  const gen = buildMonsterTableSeed("generator");
  assert.equal(gen.src, "CORE");
  assert.equal(CORE_PDF_SOURCE_KEY, "CORE");
  assert.equal(gen.manifestId, "core-monster-generator");
  assert.equal(gen.matrix, true);
  assert.deepEqual(gen.columns, ["Combat", "Quality", "Strength", "Weakness"]);
  assert.ok(Array.isArray(gen.widths) && gen.widths.length === 20);
  assert.equal(gen.formula, "1d20");
  assert.equal(gen.die, "d20");
  assert.equal(gen.page, 190);
  assert.equal(gen.book, "Shadowdark RPG");
  assert.equal(gen.category, "Monsters");
  assert.ok(gen.folderLabel);

  const mut = buildMonsterTableSeed("mutations");
  assert.equal(mut.manifestId, "core-monster-mutations");
  assert.equal(mut.formula, "1d12");
  assert.equal(mut.columns.length, 3);
  assert.equal(mut.page, 191);

  assert.throws(() => buildMonsterTableSeed("nope"), /Unknown monster-table set/);
});

/* -- PDF href/target resolves for a normal Monster table seed -------------- */

test("a Monster table seed resolves a Core PDF href + grab target", async () => {
  const savedGame = globalThis.game;
  const savedFoundry = globalThis.foundry;
  // No world journal → registry falls back to SOURCE_PDFS["CORE"]; getRoute is
  // identity so the href assertion is deterministic.
  globalThis.game = {};
  globalThis.foundry = { utils: { getRoute: (p) => p } };
  try {
    const { sourcePdfHref, sourcePdfTarget } = await import("../scripts/encounter/source-pdf-registry.mjs");
    const seed = buildMonsterTableSeed("generator");

    const target = sourcePdfTarget(seed.src, seed.page);
    assert.ok(target, "grab target resolves");
    assert.equal(target.page, 194, "printed p.190 + Core +4 offset");
    assert.match(target.file, /Core Rulebook/i);

    const href = sourcePdfHref(seed.src, seed.page);
    assert.ok(href, "viewer href resolves");
    assert.match(href, /#page=194$/);
    assert.match(href, /viewer\.html/);
  } finally {
    if (savedGame === undefined) delete globalThis.game; else globalThis.game = savedGame;
    if (savedFoundry === undefined) delete globalThis.foundry; else globalThis.foundry = savedFoundry;
  }
});

/* -- fail-closed whole-matrix commit --------------------------------------- */

// Build the N child ParsedTables the hub's _applyImportSeed would produce.
function childrenFor(seed, { rows } = {}) {
  const n = rows ?? (seed.formula === "1d20" ? 20 : 12);
  let text = "";
  for (let i = 1; i <= n; i++) {
    text += `${i} ${seed.columns.map((c, ci) => `${c}${ci}-${i}`).join(" | ")}\n`;
  }
  const split = parseMatrixByColumns(text, seed.columns, seed.widths);
  split.forEach((t, i) => {
    t.formula = seed.formula;
    t.manifestId = columnManifestId(seed.manifestId, seed.columns[i]);
  });
  return split;
}

test("valid 4/4 and 3/3 matrices pass the commit gate", () => {
  for (const key of ["generator", "mutations"]) {
    const seed = buildMonsterTableSeed(key);
    const res = validateMatrixCommit(seed, childrenFor(seed));
    assert.equal(res.ok, true, `${key}: ${res.errors.join(" ")}`);
  }
});

test("a missing child column blocks the whole matrix commit", () => {
  const seed = buildMonsterTableSeed("generator");
  const kids = childrenFor(seed).slice(0, 3); // drop Weakness
  const res = validateMatrixCommit(seed, kids);
  assert.equal(res.ok, false);
  assert.match(res.errors.join(" "), /Expected 4 child tables.*found 3/);
});

test("a wrong id / wrong order blocks the whole matrix commit", () => {
  const seed = buildMonsterTableSeed("generator");
  const kids = childrenFor(seed);
  // Swap columns 0 and 1 so the manifestIds no longer line up in order.
  [kids[0], kids[1]] = [kids[1], kids[0]];
  const res = validateMatrixCommit(seed, kids);
  assert.equal(res.ok, false);
  assert.match(res.errors.join(" "), /expected "core-monster-generator:combat"/);
});

test("an invalid child (empty cell) blocks the whole matrix commit", () => {
  const seed = buildMonsterTableSeed("mutations");
  const kids = childrenFor(seed);
  // Blank out one result's text so computeBlockers reports an empty row.
  kids[2].rows[4].text = "   ";
  const res = validateMatrixCommit(seed, kids);
  assert.equal(res.ok, false);
  assert.match(res.errors.join(" "), /Mutation 3|empty|no result text/i);
});

test("a non-matrix seed is rejected as not-a-matrix", () => {
  assert.equal(validateMatrixCommit({ name: "x" }, []).ok, false);
  assert.match(validateMatrixCommit({ name: "x" }, []).errors[0], /Not a valid matrix seed/);
});
