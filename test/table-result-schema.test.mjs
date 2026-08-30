import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * TableResult document references must use the v13 canonical `documentUuid`.
 *
 * `documentCollection` / `documentId` are deprecation getters in v13/v14 and are
 * REMOVED in v15, so anything persisted through them stops resolving. They were
 * written in two unrelated places — the loot linker and the encounter builder —
 * and each was found only when a deprecation warning happened to be noticed in a
 * console. This guard is cheaper than noticing.
 *
 * `documentCollection` is the unambiguous half of the pair: it exists only as a
 * TableResult field, whereas `documentId` is also a perfectly ordinary property
 * name (monster-spell-library builds a refresh signature with one). Both sites
 * wrote the pair together, so guarding the unambiguous half catches the pattern
 * without false positives.
 */

const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));

/** Every .mjs under scripts/, recursively. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/**
 * Blank out block and line comments so prose about the field doesn't count as
 * use. Newlines are preserved so reported line numbers still match the file.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

test("no module writes the v15-removed documentCollection field", () => {
  const offenders = [];
  for (const file of sourceFiles(SCRIPTS)) {
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    const rel = path.relative(SCRIPTS, file);
    lines.forEach((l, i) => {
      if (l.includes("documentCollection")) offenders.push(`scripts/${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders, [],
    `use documentUuid instead — documentCollection is removed in Foundry v15: ${offenders.join(", ")}`,
  );
});

test("the two known TableResult writers reference documents by uuid", () => {
  for (const rel of ["loot/loot-catalog.mjs", "encounter/encounter-build.mjs"]) {
    const code = stripComments(readFileSync(path.join(SCRIPTS, rel), "utf8"));
    assert.ok(
      /documentUuid/.test(code),
      `${rel} should store a document reference as documentUuid`,
    );
  }
});
