/**
 * Magic Item Table Runtime Adapter — synthetic fixtures only (NEVER Core book
 * content). Exercises identity, range-aware validation, set-state assembly,
 * bundle-import atomicity, selection resolution, sanitization, and the
 * refs-only provenance builder. All result text is invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { findById } from "../scripts/encounter/table-manifest.mjs";
import {
  MAGIC_SET_DEFS,
  MAGIC_SET_KEYS,
  CHILD_IDS,
  formulaDomain,
  roleFromChildId,
  roleIsMechanical,
  roleIsHint,
  buildChildSeed,
  buildSetSeed,
  toPlainText,
  featureDescriptionHtml,
  validateChildTable,
  buildSetState,
  buildSetStates,
  matchBundleTables,
  resolveSelection,
  assertResultRefs,
  forgeRef,
  buildForgeProvenance,
  refKey,
} from "../scripts/encounter/magic-table-runtime.mjs";

/* -- synthetic fixtures ---------------------------------------------------- */

/** Partition [lo,hi] into `n` contiguous integer ranges (gapless, complete). */
function coverRanges(lo, hi, n) {
  const faces = hi - lo + 1;
  const base = Math.floor(faces / n);
  const rem = faces % n;
  const ranges = [];
  let cur = lo;
  for (let i = 0; i < n; i++) {
    const size = base + (i < rem ? 1 : 0);
    ranges.push([cur, cur + size - 1]);
    cur += size;
  }
  return ranges;
}

/** A valid child-table descriptor for a child requirement. */
function makeChildFor(child, { uuid, manifestId, textPrefix = "row", stampId = true } = {}) {
  const ranges = coverRanges(child.domain[0], child.domain[1], child.expectedCount);
  const results = ranges.map(([min, max], i) => ({
    id: stampId ? `r-${child.manifestId}-${i}` : null,
    range: [min, max],
    text: `${textPrefix} ${child.role} ${i + 1}`,
  }));
  return {
    uuid: uuid ?? `Compendium.world.sde-tables.RollTable.${child.manifestId}`,
    manifestId: manifestId ?? child.manifestId,
    formula: child.formula,
    results,
  };
}

/** An unstamped (no manifestId) valid draft — for structural bundle matching. */
function makeUnstampedFor(child, opts = {}) {
  const d = makeChildFor(child, { ...opts, manifestId: null });
  d.manifestId = null;
  return d;
}

const WB = MAGIC_SET_DEFS["magic-weapon-base"];
const AB = MAGIC_SET_DEFS["magic-armor-base"];
const WBEN = MAGIC_SET_DEFS["magic-weapon-benefit"];
const ACUR = MAGIC_SET_DEFS["magic-armor-curse"];
const PERS = MAGIC_SET_DEFS["magic-personality-detail"];

function readySet(def, opts) {
  return def.children.map((c) => makeChildFor(c, opts));
}

/* -- identity + derived shape ---------------------------------------------- */

test("set defs expose the Phase-1 sets with correct formulas/domains/counts", () => {
  assert.deepEqual(MAGIC_SET_KEYS, [
    "magic-weapon-base", "magic-weapon-benefit", "magic-weapon-curse",
    "magic-armor-base", "magic-armor-benefit", "magic-armor-curse",
    "magic-personality-detail",
  ]);

  const [wType, wBonus, wFeat] = WB.children;
  assert.equal(wType.manifestId, "core-weapon-type");
  assert.deepEqual([wType.formula, wType.domain, wType.expectedCount], ["1d20", [1, 20], 16]);
  assert.deepEqual([wBonus.formula, wBonus.domain, wBonus.expectedCount], ["2d6", [2, 12], 4]);
  assert.deepEqual([wFeat.formula, wFeat.domain, wFeat.expectedCount], ["1d20", [1, 20], 20]);

  const [aType, aBonus, aFeat] = AB.children;
  assert.deepEqual([aType.formula, aType.domain, aType.expectedCount], ["2d6", [2, 12], 5]);
  assert.deepEqual([aBonus.formula, aBonus.domain, aBonus.expectedCount], ["2d6", [2, 12], 4]);
  assert.deepEqual([aFeat.formula, aFeat.domain, aFeat.expectedCount], ["1d20", [1, 20], 20]);

  assert.deepEqual([ACUR.children[0].formula, ACUR.children[0].domain, ACUR.children[0].expectedCount], ["1d12", [1, 12], 11]);
  const [virtue, flaw, trait] = PERS.children;
  assert.deepEqual([virtue.formula, virtue.expectedCount], ["1d20", 20]);
  assert.deepEqual([flaw.formula, flaw.expectedCount], ["1d20", 20]);
  assert.deepEqual([trait.formula, trait.domain, trait.expectedCount], ["1d16", [1, 16], 16]);
  assert.equal(PERS.perTable, true);
});

test("CHILD_IDS lists every child once", () => {
  assert.equal(new Set(CHILD_IDS).size, CHILD_IDS.length);
  for (const id of ["core-weapon-type", "core-weapon-bonus", "core-weapon-feature",
    "core-weapon-benefit", "core-weapon-curse", "core-armor-type", "core-armor-bonus",
    "core-armor-feature", "core-armor-benefit", "core-armor-curse",
    "core-item-virtue", "core-item-flaw", "core-personality-trait"]) {
    assert.ok(CHILD_IDS.includes(id), `${id} missing from CHILD_IDS`);
  }
});

test("formulaDomain + role helpers", () => {
  assert.deepEqual(formulaDomain("1d20"), [1, 20]);
  assert.deepEqual(formulaDomain("1d16"), [1, 16]);
  assert.deepEqual(formulaDomain("1d12"), [1, 12]);
  assert.deepEqual(formulaDomain("2d6"), [2, 12]);
  assert.equal(formulaDomain("d4,d4"), null);
  assert.equal(formulaDomain("garbage"), null);

  assert.equal(roleFromChildId("core-weapon-bonus"), "bonus");
  assert.equal(roleFromChildId("core-weapon-type"), "type");
  assert.equal(roleFromChildId("core-armor-feature"), "feature");
  assert.equal(roleFromChildId("core-item-virtue"), "virtue");
  assert.equal(roleIsMechanical("bonus"), true);
  assert.equal(roleIsMechanical("feature"), false);
  assert.equal(roleIsHint("type"), true);
  assert.equal(roleIsHint("bonus"), false);
});

/* -- metadata page correction (regression) --------------------------------- */

test("core-item-flaw page corrected 395 → 295", () => {
  assert.equal(findById("core-item-flaw").page, 295);
  assert.equal(findById("core-item-virtue").page, 294);
  assert.equal(findById("core-personality-trait").page, 295);
});

/* -- import seeds ---------------------------------------------------------- */

test("buildChildSeed / buildSetSeed carry CORE source + manifest identity, no prose", () => {
  const childSeed = buildChildSeed("core-weapon-benefit");
  assert.equal(childSeed.src, "CORE");
  assert.equal(childSeed.manifestId, "core-weapon-benefit");
  assert.equal(childSeed.formula, "1d12");
  assert.equal(childSeed.page, 293);

  // single-table set → child seed with a magicSet marker
  const riderSeed = buildSetSeed("magic-weapon-benefit");
  assert.equal(riderSeed.magicSet, "magic-weapon-benefit");
  assert.equal(riderSeed.manifestId, "core-weapon-benefit");

  // base recipe → bundle seed listing every expected child
  const baseSeed = buildSetSeed("magic-weapon-base");
  assert.equal(baseSeed.magicSet, "magic-weapon-base");
  assert.equal(baseSeed.src, "CORE");
  assert.equal(baseSeed.children.length, 3);
  assert.deepEqual(baseSeed.children.map((c) => c.manifestId), ["core-weapon-type", "core-weapon-bonus", "core-weapon-feature"]);
  assert.ok(!JSON.stringify(baseSeed).match(/prose|SECRET/i));

  // personality is per-table
  const persSeed = buildSetSeed("magic-personality-detail");
  assert.equal(persSeed.perTable, true);
  assert.equal(persSeed.children.length, 3);
});

/* -- five states ----------------------------------------------------------- */

test("READY when every child resolves to exactly one valid table", () => {
  const states = buildSetStates([...readySet(WB), ...readySet(WBEN)]);
  assert.equal(states["magic-weapon-base"].state, "ready");
  assert.equal(states["magic-weapon-base"].ready, true);
  assert.equal(states["magic-weapon-benefit"].state, "ready");
  assert.equal(states["magic-weapon-base"].requirements[0].results.length, 16);
  assert.equal(states["magic-weapon-base"].requirements[2].results.length, 20);
});

test("LOCKED when nothing imported", () => {
  const states = buildSetStates([]);
  for (const k of MAGIC_SET_KEYS) assert.equal(states[k].state, "locked");
  assert.match(states["magic-weapon-base"].diagnostics[0].message, /Not imported/i);
});

test("PARTIAL when some (but not all) children present", () => {
  const set = buildSetState(WB, readySet(WB).slice(0, 2)); // drop feature
  assert.equal(set.state, "partial");
  assert.equal(set.ready, false);
  assert.match(set.diagnostics[0].message, /Weapon Feature/);
});

test("AMBIGUOUS when a child manifestId is duplicated", () => {
  const dupe = makeChildFor(WB.children[0], { uuid: "Compendium.world.sde-tables.RollTable.dupe" });
  const set = buildSetState(WB, [...readySet(WB), dupe]);
  assert.equal(set.state, "ambiguous");
  assert.match(set.diagnostics[0].message, /Duplicate/i);
});

test("INVALID when a present child fails validation", () => {
  const tables = readySet(WB);
  tables[1].formula = "1d20"; // weapon-bonus is 2d6
  const set = buildSetState(WB, tables);
  assert.equal(set.state, "invalid");
  assert.match(set.diagnostics.map((d) => d.message).join(" "), /not 2d6/);
});

test("precedence: ambiguous outranks invalid outranks partial", () => {
  // duplicate + invalid → ambiguous
  const dupe = makeChildFor(WB.children[0], { uuid: "u2" });
  const withBad = readySet(WB);
  withBad[1].formula = "1d20";
  assert.equal(buildSetState(WB, [...withBad, dupe]).state, "ambiguous");
  // invalid + missing → invalid
  const invalidPlusMissing = readySet(WB).slice(0, 2); // feature missing
  invalidPlusMissing[0].formula = "1d12";
  assert.equal(buildSetState(WB, invalidPlusMissing).state, "invalid");
});

test("decoy tables with wrong/absent flags never unlock or interfere", () => {
  const decoyNoFlag = { uuid: "x1", manifestId: null, formula: "1d20", results: [] };
  const decoyForeign = { uuid: "x2", manifestId: "core-encounter-forest", formula: "1d20", results: [] };
  const set = buildSetState(WB, [...readySet(WB), decoyNoFlag, decoyForeign]);
  assert.equal(set.ready, true, "decoys ignored — matched only by flag");
});

/* -- range-aware validation ------------------------------------------------ */

test("range coverage: 1d20 with 16 ranges, 2d6 with 4 and 5, 1d12 with 11 — all valid", () => {
  for (const child of [WB.children[0] /*1d20×16*/, WB.children[1] /*2d6×4*/, AB.children[0] /*2d6×5*/, ACUR.children[0] /*1d12×11*/]) {
    const v = validateChildTable(makeChildFor(child), {
      expectedFormula: child.formula, domain: child.domain, expectedCount: child.expectedCount,
    });
    assert.equal(v.valid, true, `${child.manifestId} should validate: ${v.errors.join("; ")}`);
    assert.equal(v.results.length, child.expectedCount);
  }
});

test("row-count mismatch is rejected (rows need not equal face cardinality, but must equal expected)", () => {
  const child = WB.children[0]; // 1d20, 16 rows
  const short = makeChildFor(child);
  short.results = short.results.slice(0, 15);
  const v = validateChildTable(short, { expectedFormula: child.formula, domain: child.domain, expectedCount: 16 });
  assert.equal(v.valid, false);
  assert.match(v.errors.join(" "), /Expected 16/);
});

test("gaps, overlaps, reversed, out-of-domain, missing ids, empty text all fail", () => {
  const child = ACUR.children[0]; // 1d12, [1,12], 11 rows
  const exp = { expectedFormula: "1d12", domain: [1, 12], expectedCount: 11 };

  // gap
  const gap = makeChildFor(child);
  gap.results[5].range = [gap.results[5].range[0] + 1, gap.results[5].range[1]]; // introduce gap
  assert.equal(validateChildTable(gap, exp).valid, false);

  // overlap
  const ov = makeChildFor(child);
  ov.results[3].range = [ov.results[2].range[0], ov.results[3].range[1]];
  assert.equal(validateChildTable(ov, exp).valid, false);

  // reversed range
  const rev = makeChildFor(child);
  rev.results[0].range = [3, 1];
  assert.equal(validateChildTable(rev, exp).valid, false);

  // out of domain (a 1d20-style face on a 1d12 table)
  const oob = makeChildFor(child);
  oob.results[oob.results.length - 1].range = [oob.results[oob.results.length - 1].range[0], 20];
  assert.equal(validateChildTable(oob, exp).valid, false);

  // missing id
  const noId = makeChildFor(child);
  noId.results[2].id = "";
  const nv = validateChildTable(noId, exp);
  assert.equal(nv.valid, false);
  assert.match(nv.errors.join(" "), /no stable id/);

  // empty text
  const empty = makeChildFor(child);
  empty.results[4].text = "   ";
  const ev = validateChildTable(empty, exp);
  assert.equal(ev.valid, false);
  assert.match(ev.errors.join(" "), /no text/);
});

test("2d6 domain lower bound is 2 — a face-1 result is out of domain", () => {
  const child = WB.children[1]; // 2d6 [2,12] ×4
  const bad = makeChildFor(child);
  bad.results[0].range = [1, bad.results[0].range[1]];
  const v = validateChildTable(bad, { expectedFormula: "2d6", domain: [2, 12], expectedCount: 4 });
  assert.equal(v.valid, false);
  assert.match(v.errors.join(" "), /cover 2\.\.12/);
});

/* -- bundle import atomicity ----------------------------------------------- */

test("bundle: all children present + valid → ok with candidate payloads (structural, no ids)", () => {
  const drafts = WB.children.map((c) => makeUnstampedFor(c));
  const res = matchBundleTables(WB, drafts);
  assert.equal(res.ok, true);
  assert.equal(res.payloads.length, 3);
  assert.deepEqual(res.payloads.map((p) => p.manifestId).sort(),
    ["core-weapon-bonus", "core-weapon-feature", "core-weapon-type"]);
});

test("bundle: manifestId-stamped drafts match by exact identity", () => {
  const drafts = WB.children.map((c) => makeChildFor(c)); // carry manifestId
  const res = matchBundleTables(WB, drafts);
  assert.equal(res.ok, true);
  assert.equal(res.payloads.length, 3);
});

test("bundle: missing middle child → creates NOTHING", () => {
  const drafts = [makeUnstampedFor(WB.children[0]), makeUnstampedFor(WB.children[2])]; // no bonus
  const res = matchBundleTables(WB, drafts);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
  assert.ok(res.errors.some((e) => e.code === "missing"));
});

test("bundle: an invalid child → creates NOTHING", () => {
  const drafts = WB.children.map((c) => makeUnstampedFor(c));
  drafts[1].results = drafts[1].results.slice(0, 3); // bonus now 3 rows not 4
  const res = matchBundleTables(WB, drafts);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
  assert.ok(res.errors.some((e) => e.code === "invalid" || e.code === "missing"));
});

test("bundle: a duplicate-fitting child → creates NOTHING", () => {
  // two feature-shaped drafts (1d20×20) → feature ambiguous, type missing
  const drafts = [
    makeUnstampedFor(WB.children[2]),
    makeUnstampedFor(WB.children[2]),
    makeUnstampedFor(WB.children[1]),
  ];
  const res = matchBundleTables(WB, drafts);
  assert.equal(res.ok, false);
  assert.equal(res.payloads.length, 0);
});

test("bundle: an unrelated noise draft is ignored when the real children all match", () => {
  const noise = { manifestId: null, formula: "1d6", results: [
    { id: "n1", range: [1, 3], text: "noise a" }, { id: "n2", range: [4, 6], text: "noise b" },
  ] };
  const drafts = [...WB.children.map((c) => makeUnstampedFor(c)), noise];
  const res = matchBundleTables(WB, drafts);
  assert.equal(res.ok, true);
  assert.equal(res.payloads.length, 3);
});

test("bundle: each single table alone fails the set gate but validates individually", () => {
  for (const c of WB.children) {
    const only = matchBundleTables(WB, [makeUnstampedFor(c)]);
    assert.equal(only.ok, false, `${c.manifestId} alone should not satisfy the whole set`);
    const v = validateChildTable(makeChildFor(c), { expectedFormula: c.formula, domain: c.domain, expectedCount: c.expectedCount });
    assert.equal(v.valid, true);
  }
});

test("bundle: a perTable set (Virtue/Flaw share formula+count) is never bundle-matched", () => {
  const drafts = PERS.children.map((c) => makeUnstampedFor(c));
  const res = matchBundleTables(PERS, drafts);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "per-table"));
});

/* -- sanitization ---------------------------------------------------------- */

test("hostile HTML/entities normalize to safe plain text + escaped feature HTML", () => {
  const hostile = `<img src=x onerror=alert(1)>Bites <b>hard</b> &amp; &lt;spikes&gt;`;
  const plain = toPlainText(hostile);
  assert.match(plain, /Bites hard & <spikes>/);
  const html = featureDescriptionHtml(hostile);
  assert.ok(!/<img|<script|<b>/i.test(html), `raw tag survived: ${html}`);
  assert.match(html, /^<p>/);
  assert.match(html, /&lt;spikes&gt;/);
});

test("empty/whitespace text yields empty feature description", () => {
  assert.equal(featureDescriptionHtml(""), "");
  assert.equal(featureDescriptionHtml("   "), "");
});

/* -- selection resolution + guard ------------------------------------------ */

test("resolveSelection separates live results from stale references", () => {
  const states = buildSetStates(readySet(WB));
  const good = states["magic-weapon-base"].requirements[2].results[3]; // feature, some row
  const staleRef = { manifestId: "core-weapon-type", tableUuid: "gone", resultId: "nope" };
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
  const before = buildSetStates(readySet(WB));
  const picked = before["magic-weapon-base"].requirements[0].results[0];
  const ref = { manifestId: picked.manifestId, tableUuid: picked.tableUuid, resultId: picked.resultId };
  const replaced = readySet(WB);
  replaced[0].uuid = "Compendium.world.sde-tables.RollTable.NEWID";
  const after = buildSetStates(replaced);
  const { live, stale } = resolveSelection(after, [ref]);
  assert.equal(live.length, 0);
  assert.equal(stale.length, 1);
});

test("assertResultRefs rejects strings + malformed refs before persistence", () => {
  assert.throws(() => assertResultRefs(["form-wings"]), /Invalid result reference/);
  assert.throws(() => assertResultRefs([]), /No imported results/);
  assert.throws(() => assertResultRefs([{ manifestId: "x" }]), /Invalid imported-result reference/);
  const ok = [{ manifestId: "a", tableUuid: "b", resultId: "c" }];
  assert.equal(assertResultRefs(ok), ok);
});

/* -- provenance ------------------------------------------------------------ */

test("buildForgeProvenance stores refs + automation only — no prose", () => {
  const results = [
    { manifestId: "core-weapon-bonus", tableUuid: "t1", resultId: "r1", range: [10, 11], role: "bonus", label: "Weapon Bonus", text: "SECRET PROSE" },
    { manifestId: "core-weapon-feature", tableUuid: "t2", resultId: "r2", range: [5, 5], role: "feature", label: "Weapon Feature", text: "MORE SECRET PROSE" },
  ];
  const prov = buildForgeProvenance({ recipe: "magic-weapon-base", results, automation: [{ kind: "weapon-bonus", value: 2 }], nonAutomated: true });
  assert.equal(prov.version, 2);
  assert.equal(prov.recipe, "magic-weapon-base");
  assert.equal(prov.nonAutomated, true);
  assert.deepEqual(prov.automation, [{ kind: "weapon-bonus", value: 2 }]);
  assert.deepEqual(prov.refs, [
    { manifestId: "core-weapon-bonus", tableUuid: "t1", resultId: "r1", range: [10, 11] },
    { manifestId: "core-weapon-feature", tableUuid: "t2", resultId: "r2", range: [5, 5] },
  ]);
  assert.ok(!JSON.stringify(prov).includes("PROSE"), "provenance must not carry result prose");
});

test("forgeRef drops everything but the four structural fields", () => {
  const r = forgeRef({ manifestId: "m", tableUuid: "t", resultId: "x", range: [1, 2], role: "curse", label: "L", text: "prose" });
  assert.deepEqual(r, { manifestId: "m", tableUuid: "t", resultId: "x", range: [1, 2] });
});
