/**
 * Monster Table Runtime Adapter — synthetic fixtures only (NEVER Core book
 * content). Exercises identity, validation, set-state assembly, selection
 * resolution, sanitization, and the conservative apply/provenance builders.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SET_DEFS,
  IDENTITY_IDS,
  toPlainText,
  featureDescriptionHtml,
  featureName,
  featureFromResult,
  validateChildTable,
  buildSetState,
  buildSetStates,
  resolveSelection,
  assertResultRefs,
  buildProvenanceV2,
  refKey,
} from "../scripts/monster-creator/monster-table-runtime.mjs";

/* -- helpers: synthetic descriptors ---------------------------------------- */

// A valid child table for a set def's column at index `col`.
function makeChild(def, colIdx, { uuid, formula, cardinality, textPrefix = "row" } = {}) {
  const ident = def.identities[colIdx];
  const n = cardinality ?? def.cardinality;
  const results = [];
  for (let i = 1; i <= n; i++) {
    results.push({ id: `r${colIdx}-${i}`, range: [i, i], text: `${textPrefix} ${ident.columnKey} ${i}` });
  }
  return {
    uuid: uuid ?? `Compendium.world.sde-tables.RollTable.${ident.columnKey}`,
    manifestId: ident.manifestId,
    formula: formula ?? def.formula,
    results,
  };
}

// A complete, valid set of child tables for a def.
function makeReadySet(def, opts = {}) {
  return def.identities.map((_, i) => makeChild(def, i, opts));
}

const GEN = SET_DEFS.generator;
const MUT = SET_DEFS.mutations;

/* -- identity -------------------------------------------------------------- */

test("exposes the seven canonical child identities in stable order", () => {
  assert.deepEqual(IDENTITY_IDS, [
    "core-monster-generator:combat",
    "core-monster-generator:quality",
    "core-monster-generator:strength",
    "core-monster-generator:weakness",
    "core-monster-mutations:mutation-1",
    "core-monster-mutations:mutation-2",
    "core-monster-mutations:mutation-3",
  ]);
  assert.equal(GEN.formula, "1d20");
  assert.equal(GEN.cardinality, 20);
  assert.equal(MUT.formula, "1d12");
  assert.equal(MUT.cardinality, 12);
  // Column order preserved from the manifest.
  assert.deepEqual(GEN.columns, ["Combat", "Quality", "Strength", "Weakness"]);
  assert.deepEqual(MUT.columns, ["Mutation 1", "Mutation 2", "Mutation 3"]);
});

/* -- set state: ready / locked / missing ----------------------------------- */

test("Generator 4/4 ready and Mutations 3/3 ready", () => {
  const states = buildSetStates([...makeReadySet(GEN), ...makeReadySet(MUT)]);
  assert.equal(states.generator.state, "ready");
  assert.equal(states.generator.ready, true);
  assert.equal(states.mutations.state, "ready");
  assert.equal(states.mutations.ready, true);
  assert.equal(states.generator.columns[0].results.length, 20);
  assert.equal(states.mutations.columns[0].results.length, 12);
});

test("one set complete, the other missing → independent unlock", () => {
  const states = buildSetStates(makeReadySet(GEN)); // no mutations tables
  assert.equal(states.generator.ready, true);
  assert.equal(states.mutations.state, "locked");
  assert.equal(states.mutations.ready, false);
  assert.match(states.mutations.diagnostics[0].message, /Not imported/i);
});

test("both locked when nothing is imported", () => {
  const states = buildSetStates([]);
  assert.equal(states.generator.state, "locked");
  assert.equal(states.mutations.state, "locked");
});

/* -- partial (3/4 and 2/3) ------------------------------------------------- */

test("3/4 columns present → Generator partial", () => {
  const tables = makeReadySet(GEN).slice(0, 3); // drop Weakness
  const set = buildSetState(GEN, tables);
  assert.equal(set.state, "partial");
  assert.equal(set.ready, false);
  assert.match(set.diagnostics[0].message, /Missing: Weakness/);
});

test("2/3 columns present → Mutations partial", () => {
  const tables = makeReadySet(MUT).slice(0, 2);
  const set = buildSetState(MUT, tables);
  assert.equal(set.state, "partial");
  assert.match(set.diagnostics[0].message, /Mutation 3/);
});

test("deleting a table relocks the affected set (ready → not ready)", () => {
  const full = makeReadySet(GEN);
  assert.equal(buildSetState(GEN, full).ready, true);
  const missingOne = full.slice(1); // delete Combat table
  const set = buildSetState(GEN, missingOne);
  assert.equal(set.ready, false);
  assert.equal(set.state, "partial");
});

/* -- ambiguity ------------------------------------------------------------- */

test("duplicate exact manifestId flag → ambiguous (blocks the set)", () => {
  const dupe = makeChild(GEN, 0, { uuid: "Compendium.world.sde-tables.RollTable.dupe" });
  const set = buildSetState(GEN, [...makeReadySet(GEN), dupe]);
  assert.equal(set.state, "ambiguous");
  assert.equal(set.ready, false);
  assert.match(set.diagnostics[0].message, /Duplicate/i);
  assert.match(set.diagnostics[0].message, /Combat/);
});

test("duplicate NAMES with wrong/missing flags do not unlock or interfere", () => {
  // Two extra tables named like the Core columns but with no / foreign flag.
  const decoyNoFlag = { uuid: "x1", manifestId: null, formula: "1d20", results: [] };
  const decoyForeign = { uuid: "x2", manifestId: "core-encounter-forest", formula: "1d20", results: [] };
  const states = buildSetStates([...makeReadySet(GEN), decoyNoFlag, decoyForeign, ...makeReadySet(MUT)]);
  assert.equal(states.generator.ready, true, "decoys ignored — matched only by flag");
  assert.equal(states.mutations.ready, true);
});

/* -- invalid: formula / cardinality / gaps / overlaps / empty -------------- */

test("wrong formula → invalid", () => {
  const tables = makeReadySet(GEN);
  tables[0].formula = "1d12";
  const set = buildSetState(GEN, tables);
  assert.equal(set.state, "invalid");
  assert.match(set.diagnostics[0].message, /Combat/);
  assert.match(set.diagnostics[0].message, /not 1d20/);
});

test("wrong cardinality → invalid", () => {
  const tables = makeReadySet(MUT);
  tables[1].results = tables[1].results.slice(0, 10); // 10 not 12
  const set = buildSetState(MUT, tables);
  assert.equal(set.state, "invalid");
  assert.match(set.diagnostics.map((d) => d.message).join(" "), /Expected 12/);
});

test("validateChildTable flags gaps, overlaps, and empty rows", () => {
  const expect = { expectedFormula: "1d12", cardinality: 12 };

  // Gap: face 6 missing (only 11 rows) → cardinality + coverage errors.
  const gap = { formula: "1d12", results: [] };
  for (let i = 1; i <= 12; i++) if (i !== 6) gap.results.push({ id: `g${i}`, range: [i, i], text: `t${i}` });
  const gv = validateChildTable(gap, expect);
  assert.equal(gv.valid, false);
  assert.match(gv.errors.join(" "), /cover 1\.\.12/);

  // Overlap: two rows both cover face 3.
  const ov = { formula: "1d12", results: [] };
  for (let i = 1; i <= 12; i++) ov.results.push({ id: `o${i}`, range: [i, i], text: `t${i}` });
  ov.results[3].range = [3, 3]; // duplicate face 3, now 13 rows though → adjust
  ov.results.push({ id: "extra", range: [3, 3], text: "dup" });
  const ovv = validateChildTable(ov, expect);
  assert.equal(ovv.valid, false);

  // Empty row text.
  const empt = { formula: "1d12", results: [] };
  for (let i = 1; i <= 12; i++) empt.results.push({ id: `e${i}`, range: [i, i], text: i === 5 ? "   " : `t${i}` });
  const ev = validateChildTable(empt, expect);
  assert.equal(ev.valid, false);
  assert.match(ev.errors.join(" "), /no text/);
});

test("shuffled result collections are sorted by range", () => {
  const shuffled = { formula: "1d12", results: [] };
  const order = [7, 1, 12, 4, 2, 9, 3, 11, 5, 8, 6, 10];
  for (const i of order) shuffled.results.push({ id: `s${i}`, range: [i, i], text: `t${i}` });
  const v = validateChildTable(shuffled, { expectedFormula: "1d12", cardinality: 12 });
  assert.equal(v.valid, true);
  assert.deepEqual(v.results.map((r) => r.min), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

/* -- sanitization ---------------------------------------------------------- */

test("hostile HTML/entities normalize to safe plain text and escaped feature HTML", () => {
  const hostile = `<img src=x onerror=alert(1)>Grasping <b>claws</b> &amp; &lt;spikes&gt;`;
  const plain = toPlainText(hostile);
  assert.ok(!/[<>]img/i.test(plain));
  assert.match(plain, /Grasping claws & <spikes>/);
  const html = featureDescriptionHtml(hostile);
  assert.ok(!/<img|<script|<b>/i.test(html), `raw tag survived: ${html}`);
  assert.match(html, /^<p>/);
  assert.match(html, /&lt;spikes&gt;/);
  assert.match(html, /&amp;/);
});

test("empty text yields empty feature description", () => {
  assert.equal(featureDescriptionHtml(""), "");
  assert.equal(featureDescriptionHtml("   "), "");
});

/* -- selection resolution -------------------------------------------------- */

test("resolveSelection separates live results from stale references", () => {
  const states = buildSetStates([...makeReadySet(GEN), ...makeReadySet(MUT)]);
  const good = states.generator.columns[2].results[4]; // Strength, face 5
  const staleRef = { manifestId: GEN.identities[0].manifestId, tableUuid: "gone", resultId: "nope" };
  const { live, stale } = resolveSelection(states, [
    { tableUuid: good.tableUuid, resultId: good.resultId, manifestId: good.manifestId },
    staleRef,
  ]);
  assert.equal(live.length, 1);
  assert.equal(live[0].text, good.text);
  assert.equal(stale.length, 1);
  assert.equal(refKey(stale[0]), "gone::nope");
});

test("selection goes stale after a table is replaced (new uuid)", () => {
  const before = buildSetStates(makeReadySet(GEN));
  const picked = before.generator.columns[0].results[0];
  const ref = { manifestId: picked.manifestId, tableUuid: picked.tableUuid, resultId: picked.resultId };

  // Replace the Combat table with a new uuid (re-import).
  const replaced = makeReadySet(GEN);
  replaced[0].uuid = "Compendium.world.sde-tables.RollTable.NEWID";
  const after = buildSetStates(replaced);
  const { live, stale } = resolveSelection(after, [ref]);
  assert.equal(live.length, 0);
  assert.equal(stale.length, 1);
});

/* -- reference guard + deprecation ----------------------------------------- */

test("assertResultRefs rejects deprecated string ids before persistence", () => {
  assert.throws(() => assertResultRefs(["form-wings"]), /Deprecated mutation id/);
  assert.throws(() => assertResultRefs([]), /No imported results/);
  assert.throws(() => assertResultRefs([{ manifestId: "x" }]), /Invalid imported-result reference/);
  const ok = [{ manifestId: "a", tableUuid: "b", resultId: "c" }];
  assert.equal(assertResultRefs(ok), ok);
});

/* -- conservative apply + provenance --------------------------------------- */

test("featureFromResult: draft feature carries PLAIN text — no literal HTML", () => {
  const result = {
    manifestId: MUT.identities[0].manifestId,
    tableUuid: "T",
    resultId: "R",
    range: [4, 4],
    columnKey: "mutation-1",
    columnLabel: "Mutation 1",
    text: "<script>evil()</script>Sprouts extra limbs.",
  };
  assert.equal(featureName(result), "Mutation 1"); // generic — never the prose
  const f = featureFromResult(result);
  assert.equal(f.name, "Mutation 1");
  // Draft-plain-text contract: NO tags at all, not even a <p> wrapper.
  assert.ok(!/[<>]/.test(f.description), `draft feature must be plain text: ${f.description}`);
  assert.match(f.description, /Sprouts extra limbs\./);
});

test("featureDescriptionHtml wraps plain text in exactly one safe <p> at the persistence boundary", () => {
  const html = featureDescriptionHtml("<script>evil()</script>Sprouts extra limbs.");
  assert.equal((html.match(/<p>/g) || []).length, 1);
  assert.match(html, /^<p>/);
  assert.match(html, /<\/p>$/);
  assert.ok(!/<script/i.test(html));
});

test("buildProvenanceV2 stores stable refs only — no source prose", () => {
  const results = [
    { manifestId: "m1", tableUuid: "t1", resultId: "r1", range: [1, 1], columnLabel: "Combat", text: "SECRET PROSE" },
  ];
  const prov = buildProvenanceV2(results, { baseUuid: "Actor.abc", baseName: "Goblin", createdAt: 123 });
  assert.equal(prov.version, 2);
  assert.equal(prov.baseUuid, "Actor.abc");
  assert.equal(prov.baseName, "Goblin");
  assert.equal(prov.createdAt, 123);
  assert.deepEqual(prov.refs, [{ manifestId: "m1", tableUuid: "t1", resultId: "r1", range: [1, 1] }]);
  assert.ok(!JSON.stringify(prov).includes("SECRET PROSE"));
});
