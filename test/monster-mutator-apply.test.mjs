/**
 * Apply / Create-Copy / API contract for the imported-table Generator &
 * Mutator — SYNTHETIC fixtures only (never Core book content).
 *
 * The Monster Creator app (encounter-creator.mjs) and monster-mutator.mjs bind
 * Foundry globals at module scope and cannot be imported under node:test, so
 * this suite exercises the shared, pure runtime backing their Apply / Create
 * Variant Copy / API paths (appendResultFeatures, buildProvenanceV2,
 * resolveResultRefs, assertResultRefs) with the exact semantics the app relies
 * on. The Foundry-bound `draftToActorData` mapping is asserted at its
 * feature-item boundary by replicating the tiny mapping it performs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SET_DEFS,
  buildSetStates,
  appendResultFeatures,
  featureFromResult,
  buildProvenanceV2,
  resolveResultRefs,
  resolveSelection,
} from "../scripts/encounter/monster-table-runtime.mjs";

/* -- synthetic ready catalog ----------------------------------------------- */

function makeChild(def, colIdx, uuidSuffix = "") {
  const ident = def.identities[colIdx];
  const results = [];
  for (let i = 1; i <= def.cardinality; i++) {
    results.push({ id: `r${colIdx}-${i}`, range: [i, i], text: `${ident.columnKey} effect ${i}` });
  }
  return {
    uuid: `Compendium.world.sde-tables.RollTable.${ident.columnKey}${uuidSuffix}`,
    manifestId: ident.manifestId,
    formula: def.formula,
    results,
  };
}
function readyCatalog() {
  const descriptors = [
    ...SET_DEFS.generator.identities.map((_, i) => makeChild(SET_DEFS.generator, i)),
    ...SET_DEFS.mutations.identities.map((_, i) => makeChild(SET_DEFS.mutations, i)),
  ];
  return { descriptors, states: buildSetStates(descriptors) };
}

// Replicate _descHtml (the draftToActorData persistence boundary): wrap bare
// PLAIN-TEXT draft descriptions in exactly one safe, escaped <p>.
function descHtml(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (s.startsWith("<")) return s;
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>${esc}</p>`;
}

// Replicate draftToActorData's NPC Feature mapping (Foundry-bound in the app).
// The draft carries PLAIN text; the HTML wrapper is added HERE, at persistence.
function toFeatureItems(features) {
  return features
    .filter((f) => !f.isSpell)
    .map((f) => ({
      name: (f.name || "").trim() || "New Feature",
      type: "NPC Feature",
      system: { description: descHtml(f.description) },
    }));
}

/* -- apply: one Feature per result, safe, non-destructive ------------------ */

test("apply adds exactly one Feature per selected result, generic names, escaped text", () => {
  const { states } = readyCatalog();
  const picks = [
    states.generator.columns[0].results[2], // Combat
    states.generator.columns[2].results[5], // Strength
    states.mutations.columns[1].results[0], // Mutation 2
  ];
  const { features, added } = appendResultFeatures([], picks, { idFn: () => "id" });
  assert.equal(added.length, 3);
  assert.deepEqual(features.map((f) => f.name), ["Combat", "Strength", "Mutation 2"]);
  for (const f of features) {
    // Draft-plain-text contract: no literal HTML in the editable draft field.
    assert.ok(!/[<>]/.test(f.description), `draft description must be plain text: ${f.description}`);
    assert.ok(!/<script|<img/i.test(f.description));
  }
  // Persistence boundary wraps each once in a safe <p>.
  for (const item of toFeatureItems(features)) {
    assert.match(item.system.description, /^<p>/);
  }
});

test("apply preserves existing features and never mutates the input array", () => {
  const { states } = readyCatalog();
  const original = [{ id: "x", name: "Pack Tactics", description: "<p>keep me</p>" }];
  const frozen = JSON.parse(JSON.stringify(original));
  const picks = [states.generator.columns[0].results[0]];
  const { features } = appendResultFeatures(original, picks, { idFn: () => "id" });
  assert.deepEqual(original, frozen, "input features array unchanged (Create Copy safety)");
  assert.equal(features.length, 2);
  assert.equal(features[0].name, "Pack Tactics");
  assert.equal(features[1].name, "Combat");
});

test("re-applying the same column does not stack duplicate features", () => {
  const { states } = readyCatalog();
  const pick = states.generator.columns[0].results[0];
  let { features } = appendResultFeatures([], [pick], { idFn: () => "id" });
  ({ features } = appendResultFeatures(features, [pick], { idFn: () => "id" }));
  assert.equal(features.filter((f) => f.name === "Combat").length, 1);
});

/* -- final actor payload / embedded Feature items -------------------------- */

test("selected results map to correct NPC Feature item payloads", () => {
  const { states } = readyCatalog();
  const picks = [states.mutations.columns[0].results[3]];
  const { features } = appendResultFeatures([], picks, { idFn: () => "id" });
  const items = toFeatureItems(features);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "NPC Feature");
  assert.equal(items[0].name, "Mutation 1");
  // The draft field itself is plain text …
  assert.ok(!/[<>]/.test(features[0].description));
  // … and draftToActorData's _descHtml wraps it in exactly one safe <p>.
  assert.match(items[0].system.description, /^<p>/);
  assert.equal((items[0].system.description.match(/<p>/g) || []).length, 1);
});

test("hostile result text cannot inject markup into the feature item", () => {
  const hostile = {
    manifestId: "core-monster-mutations:mutation-1", tableUuid: "T", resultId: "R",
    range: [1, 1], columnKey: "mutation-1", columnLabel: "Mutation 1",
    text: "</p><img src=x onerror=alert(1)><script>steal()</script>",
  };
  const f = featureFromResult(hostile);
  // Draft: plain text, no markup at all (not even a <p> wrapper).
  assert.ok(!/[<>]/.test(f.description), `draft leaked markup: ${f.description}`);
  // Persistence: exactly one safe <p>, hostile markup neutralized.
  const persisted = toFeatureItems([{ name: f.name, description: f.description }])[0].system.description;
  assert.ok(!/<img|<script|onerror/i.test(persisted));
  assert.match(persisted, /^<p>/);
  assert.equal((persisted.match(/<p>/g) || []).length, 1);
});

/* -- provenance v2 --------------------------------------------------------- */

test("Create Variant Copy provenance is v2 references with no source prose", () => {
  const { states } = readyCatalog();
  const picks = [states.generator.columns[3].results[9]]; // Weakness
  const prov = buildProvenanceV2(picks, { baseUuid: "Actor.base", baseName: "Rat", createdAt: 999 });
  assert.equal(prov.version, 2);
  assert.deepEqual(Object.keys(prov.refs[0]).sort(), ["manifestId", "range", "resultId", "tableUuid"]);
  assert.ok(!JSON.stringify(prov).includes("effect"), "no result text stored");
});

/* -- API: deprecation + stale-before-persistence --------------------------- */

test("API rejects deprecated static string ids before any persistence", async () => {
  await assert.rejects(resolveResultRefs(["form-wings", "combat-plus-ac"]), /Deprecated mutation id/);
});

test("API rejects malformed references", async () => {
  await assert.rejects(resolveResultRefs([{ manifestId: "x", resultId: "y" }]), /Invalid imported-result reference/);
  await assert.rejects(resolveResultRefs([]), /No imported results/);
});

test("API rejects stale references (table gone) before persistence", async () => {
  const savedGame = globalThis.game;
  globalThis.game = { packs: [] }; // findSuitePack → undefined → empty catalog
  try {
    const ref = { manifestId: "core-monster-generator:combat", tableUuid: "gone", resultId: "r0-1" };
    await assert.rejects(resolveResultRefs([ref]), /no longer available/);
  } finally {
    if (savedGame === undefined) delete globalThis.game; else globalThis.game = savedGame;
  }
});

/* -- selection lifecycle: stale removed after table replacement ------------ */

test("selection made against a table is invalidated after that table is replaced", () => {
  const { states } = readyCatalog();
  const pick = states.generator.columns[0].results[0];
  const ref = { manifestId: pick.manifestId, tableUuid: pick.tableUuid, resultId: pick.resultId };
  assert.equal(resolveSelection(states, [ref]).live.length, 1);

  // Re-import Combat under a new uuid.
  const replaced = [
    makeChild(SET_DEFS.generator, 0, "-v2"),
    ...SET_DEFS.generator.identities.slice(1).map((_, i) => makeChild(SET_DEFS.generator, i + 1)),
    ...SET_DEFS.mutations.identities.map((_, i) => makeChild(SET_DEFS.mutations, i)),
  ];
  const after = buildSetStates(replaced);
  const res = resolveSelection(after, [ref]);
  assert.equal(res.live.length, 0);
  assert.equal(res.stale.length, 1);
});
