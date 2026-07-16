/**
 * Importer matrix contract for the two Monster Generator / Make It Weird
 * matrices — SYNTHETIC matrices only (never Core book content). Mirrors the
 * per-column split the Importer/Table hubs run (`parseMatrixByColumns` +
 * `columnManifestId`) and the persistence shape (`buildTableData`) + commit
 * gate (`computeBlockers`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMatrixByColumns,
  buildTableData,
  computeBlockers,
} from "../scripts/encounter/table-importer.mjs";
import { findById, columnManifestId, isMatrix } from "../scripts/encounter/table-manifest.mjs";
import { SET_DEFS, IDENTITY_IDS } from "../scripts/encounter/monster-table-runtime.mjs";

const GEN = findById("core-monster-generator");
const MUT = findById("core-monster-mutations");

// Build a synthetic matrix dump: a header line (skipped) + contiguous numeric
// rows, one cell per column separated by " | " (invented words only).
function synthMatrix(columns, rows, cellText) {
  const lines = ["Roll " + columns.join("  ")]; // header — no leading number, skipped
  for (let i = 1; i <= rows; i++) {
    const cells = columns.map((c, ci) => cellText(i, ci, c));
    lines.push(`${i} ${cells.join(" | ")}`);
  }
  return lines.join("\n");
}

// Replicate the hub's `seed.matrix` split (importer-hub-app / table-hub-app).
function splitAsHub(entry, text) {
  const split = parseMatrixByColumns(text, entry.columns, entry.widths);
  split.forEach((t, i) => {
    t.name = `${entry.name} - ${entry.columns[i]}`;
    t.manifestId = columnManifestId(entry.id, entry.columns[i]);
  });
  return split;
}

test("manifest entries are matrices with the expected shape", () => {
  assert.ok(isMatrix(GEN));
  assert.ok(isMatrix(MUT));
  assert.equal(GEN.columns.length, 4);
  assert.equal(MUT.columns.length, 3);
  assert.equal(GEN.rows, 20);
  assert.equal(MUT.rows, 12);
});

test("Generator: all 4 columns split, each stamped with its expected manifestId", () => {
  const text = synthMatrix(GEN.columns, 20, (i, ci, c) => `${c.toLowerCase()} trait ${i}`);
  const split = splitAsHub(GEN, text);
  assert.equal(split.length, 4, "no collapsed columns / no phantom column");
  const ids = split.map((t) => t.manifestId);
  assert.deepEqual(ids, IDENTITY_IDS.slice(0, 4));
  assert.deepEqual(ids, [
    "core-monster-generator:combat",
    "core-monster-generator:quality",
    "core-monster-generator:strength",
    "core-monster-generator:weakness",
  ]);
  for (const t of split) assert.equal(t.rows.length, 20, "no phantom rows");
});

test("Mutations: all 3 columns split with expected manifestIds", () => {
  const text = synthMatrix(MUT.columns, 12, (i, ci) => `mutation ${ci + 1} effect ${i}`);
  const split = splitAsHub(MUT, text);
  assert.equal(split.length, 3);
  assert.deepEqual(split.map((t) => t.manifestId), IDENTITY_IDS.slice(4));
  for (const t of split) assert.equal(t.rows.length, 12);
});

test("each child produces exact NdM RollTable data with per-face ranges + text", () => {
  const text = synthMatrix(GEN.columns, 20, (i, ci, c) => `${c} option ${i}`);
  const split = splitAsHub(GEN, text);
  for (const child of split) {
    child.formula = SET_DEFS.generator.formula; // hub forces the manifest formula
    const data = buildTableData(child);
    assert.equal(data.formula, "1d20");
    assert.equal(data.results.length, 20);
    // Contiguous single-face ranges, in order, with the pasted cell text.
    data.results.forEach((r, idx) => {
      assert.deepEqual(r.range, [idx + 1, idx + 1]);
      assert.ok(r.name.length > 0, "no empty result text");
    });
    assert.equal(computeBlockers(child).length, 0, "clean matrix commits");
  }
});

test("terminator-like but valid payload survives (die-phrase in prose is not a die row)", () => {
  const text = synthMatrix(MUT.columns, 12, (i, ci) =>
    i === 3 && ci === 0 ? "deals 1d6 extra on a hit" : `effect ${ci}-${i}`);
  const split = splitAsHub(MUT, text);
  split.forEach((t) => (t.formula = SET_DEFS.mutations.formula));
  const child = split[0];
  const data = buildTableData(child);
  assert.equal(data.results[2].name, "deals 1d6 extra on a hit");
  assert.equal(computeBlockers(child).length, 0, "die notation inside prose is not a die-as-row");
});

test("d12 mutations exact 3×12 output — no phantom rows, no collapsed columns", () => {
  const text = synthMatrix(MUT.columns, 12, (i, ci, c) => `${c} · ${i}`);
  const split = splitAsHub(MUT, text);
  assert.equal(split.length, 3);
  const totalCells = split.reduce((n, t) => n + t.rows.length, 0);
  assert.equal(totalCells, 36); // 3 × 12
});

test("an incomplete matrix row (missing a column cell) is BLOCKED at commit", () => {
  // Row 5 supplies only 2 of 3 columns → the 3rd column gets an empty cell.
  const lines = ["d12  Mutation 1  Mutation 2  Mutation 3"];
  for (let i = 1; i <= 12; i++) {
    if (i === 5) lines.push(`${i} only two | cells here`);
    else lines.push(`${i} a-${i} | b-${i} | c-${i}`);
  }
  const split = splitAsHub(MUT, lines.join("\n"));
  split.forEach((t) => (t.formula = SET_DEFS.mutations.formula));
  const thirdCol = split[2];
  const blockers = computeBlockers(thirdCol);
  assert.ok(blockers.length > 0, "empty cell → commit blocked");
  assert.ok(blockers.some((b) => b.code === "empty-row"));
});

/* -- column-major / split-plane layout (real Core p.191 shape) ------------- */

// Build a synthetic split-plane paste: numbered first column 1..M, prose, a
// header naming the remaining columns, then M unnumbered plane rows. All words
// are invented — no Core content. `widths` = per-row [c0, c1, c2, …] counts.
function synthSplitPlane(columns, M, widths, { rows = M } = {}) {
  const L = ["Some introductory prose about this table.", `d${M} ${columns[0]}`];
  for (let i = 1; i <= M; i++) {
    const w = widths[i - 1][0];
    L.push(`${i} ${Array.from({ length: w }, (_, k) => `c0r${i}w${k}`).join(" ")}`);
  }
  L.push("A flavor quote sitting between the two planes.", "SOME CAPTION",
    columns.slice(1).join(" "));
  for (let i = 1; i <= rows; i++) {
    const parts = [];
    for (let c = 1; c < columns.length; c++) {
      for (let k = 0; k < widths[i - 1][c]; k++) parts.push(`c${c}r${i}w${k}`);
    }
    L.push(parts.join(" "));
  }
  return L.join("\n");
}

test("split-plane: 3-column column-major layout parses 1..M with prose ignored", () => {
  const columns = ["Effect", "Bonus", "Bane"];
  const M = 8;
  const widths = Array.from({ length: M }, (_, r) => [2, 1 + (r % 2), 2]); // varied cell widths
  const split = parseMatrixByColumns(synthSplitPlane(columns, M, widths), columns, widths);
  assert.equal(split.length, 3);
  assert.equal(split[0].formula, "1d8");
  for (const t of split) assert.equal(t.rows.length, M);
  // First column from the numbered block; remaining from the plane below.
  assert.equal(split[0].rows[0].text, "c0r1w0 c0r1w1");
  assert.equal(split[1].rows[0].text, "c1r1w0"); // width 1
  assert.equal(split[2].rows[0].text, "c2r1w0 c2r1w1"); // width 2
  // Row 2's Bonus column has width 2 (r%2) — proves per-row width split.
  assert.equal(split[1].rows[1].text, "c1r2w0 c1r2w1");
  assert.equal(split[0].warnings.some((w) => /column-major/i.test(w)), true);
  for (const t of split) assert.equal(computeBlockers(t).length, 0);
});

test("split-plane: an incomplete second plane stays blocked (empty cells)", () => {
  const columns = ["Effect", "Bonus", "Bane"];
  const M = 8;
  const widths = Array.from({ length: M }, () => [1, 1, 1]);
  // Only 5 of 8 plane rows present.
  const split = parseMatrixByColumns(synthSplitPlane(columns, M, widths, { rows: 5 }), columns, widths);
  assert.equal(split.length, 3);
  // First column is complete; the plane columns are short → empty rows → blocked.
  assert.equal(computeBlockers(split[0]).length, 0);
  assert.ok(computeBlockers(split[1]).some((b) => b.code === "empty-row"));
  assert.ok(computeBlockers(split[2]).some((b) => b.code === "empty-row"));
  assert.ok(split[0].warnings.some((w) => /only 5 of 8/i.test(w)));
});

test("split-plane detection does NOT fire on a normal row-major matrix", () => {
  const columns = ["A", "B", "C", "D"];
  const lines = [];
  for (let i = 1; i <= 20; i++) lines.push(`${i} a${i} | b${i} | c${i} | d${i}`);
  const split = parseMatrixByColumns(lines.join("\n"), columns, null);
  assert.equal(split.length, 4);
  assert.equal(split[0].rows.length, 20);
  // Row-major path emits no split-plane detection warning.
  assert.equal(split[0].warnings.some((w) => /column-major/i.test(w)), false);
});
