/**
 * Draft effect runtime — SYNTHETIC fixtures only (never Core book content).
 * Exercises the provenance-backed apply/reconcile/remove/summary engine that
 * backs both "Apply to Draft" and "Create Variant Copy".
 *
 * Results below use the REAL structural manifestIds/ranges (so the port is
 * smoke-tested) but INVENTED result text — no protected source prose.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureGeneratedEffects,
  setKeyForManifest,
  planResultEffects,
  applyEffectPlan,
  applyResult,
  removeGeneratedEffects,
  reconcileResultForColumn,
  summarizeGeneratedEffects,
  buildProvenanceV3,
  reconstructGeneratedEffects,
  itemGenerationFlag,
} from "../scripts/monster-creator/monster-effect-runtime.mjs";

/* -- helpers --------------------------------------------------------------- */

let _seq = 0;
const idFn = () => `id${++_seq}`;
function freshDraft(over = {}) {
  _seq = 0;
  return {
    name: "Goblin", level: 3, ac: 12,
    abilities: { str: 0, dex: 1, con: 0, int: -1, wis: 0, cha: 0 },
    move: "near", moveNote: "",
    spellcasting: { ability: "", bonus: 0, attacks: 0 },
    actions: [], features: [], spells: [],
    ...over,
  };
}
function result(manifestId, resultId, range, text, columnLabel = "Slot") {
  return { manifestId, tableUuid: `T:${manifestId}`, resultId, range, columnKey: "c", columnLabel, text };
}

// Real structural refs with invented text.
const R_INT = result("core-monster-mutations:mutation-3", "m3-8", [8, 8], "Genius intellect; a cunning planner.", "Mutation 3"); // setMin int 4 + feature → mixed
const R_FLY = result("core-monster-mutations:mutation-1", "m1-12", [12, 12], "Sprouts wings and takes to the air.", "Mutation 1"); // movement fly
const R_ATK = result("core-monster-generator:strength", "s4", [4, 4], "Slams for a heavy blow.", "Strength"); // 1d10 attack
const R_PL2 = result("core-monster-generator:combat", "c1", [3, 3], "Elite brute: +2 to level.", "Combat"); // PL +2
const R_GM  = result("core-monster-generator:quality", "q1", [1, 1], "Plantlike and strange.", "Quality"); // unmapped → gm

/* -- init & plan ----------------------------------------------------------- */

test("ensureGeneratedEffects seeds a v1 ledger and is idempotent", () => {
  const d = freshDraft();
  const led = ensureGeneratedEffects(d);
  assert.equal(led.version, 1);
  assert.deepEqual(led.applications, []);
  assert.equal(ensureGeneratedEffects(d), d.generatedEffects);
});

test("setKeyForManifest maps child ids to their owning set", () => {
  assert.equal(setKeyForManifest("core-monster-generator:strength"), "generator");
  assert.equal(setKeyForManifest("core-monster-mutations:mutation-1"), "mutations");
});

test("planResultEffects carries setKey, slotKey, exact ref, and mode", () => {
  const plan = planResultEffects(R_ATK, freshDraft());
  assert.equal(plan.setKey, "generator");
  assert.equal(plan.slotKey, "core-monster-generator:strength");
  assert.deepEqual(plan.ref, { manifestId: "core-monster-generator:strength", tableUuid: "T:core-monster-generator:strength", resultId: "s4", range: [4, 4] });
  assert.equal(plan.mode, "automated");
});

test("applyEffectPlan (plan → apply) records an application and dedupes exact ref", () => {
  const d = freshDraft();
  const plan = planResultEffects(R_ATK, d);
  const first = applyEffectPlan(d, plan, { idFn });
  assert.equal(first.noop, false);
  assert.equal(d.generatedEffects.applications.length, 1);
  const again = applyEffectPlan(d, planResultEffects(R_ATK, d), { idFn });
  assert.equal(again.noop, true, "same ref re-applied is a no-op");
  assert.equal(d.actions.length, 1);
});

/* -- plain-text contract --------------------------------------------------- */

test("generated draft items carry PLAIN text — never literal HTML", () => {
  const d = freshDraft();
  const hostile = result("core-monster-generator:weakness", "w1", [1, 1], "<img src=x onerror=alert(1)>Weak to <b>fire</b>.", "Weakness");
  applyResult(d, hostile, { idFn });
  const feat = d.features[0];
  assert.ok(!/<p>|<img|<b>|<script/i.test(feat.description), `HTML leaked into draft: ${feat.description}`);
  assert.match(feat.description, /Weak to fire\./);
});

/* -- apply: real mechanics ------------------------------------------------- */

test("apply changes scalars, adds attacks, movement, spellcasting as real mechanics", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn });  // 1d10 NPC Attack
  applyResult(d, R_PL2, { idFn });  // level +2
  applyResult(d, R_FLY, { idFn });  // fly token + feature
  applyResult(d, R_INT, { idFn });  // int → 4 + feature

  const atk = d.actions.find((a) => a.type === "NPC Attack");
  assert.ok(atk, "an NPC Attack was created");
  assert.equal(atk.damage, "1d10");
  assert.equal(d.level, 5, "level 3 + 2");
  assert.match(d.moveNote, /fly/);
  assert.equal(d.abilities.int, 4, "int raised to minimum 4");
  assert.equal(d.generatedEffects.applications.length, 4);
});

/* -- identity / idempotency / reconcile ------------------------------------ */

test("reapplying the exact ref is a no-op (no stacking)", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn });
  const r = applyResult(d, R_ATK, { idFn });
  assert.equal(r.noop, true);
  assert.equal(d.actions.length, 1);
  assert.equal(d.generatedEffects.applications.length, 1);
});

test("a manual item with the same name never blocks generation", () => {
  const d = freshDraft({ features: [{ id: "manual", name: "Strength", description: "a manual note" }] });
  applyResult(d, result("core-monster-generator:strength", "s3", [3, 3], "Swarms as many bodies.", "Strength"), { idFn });
  assert.equal(d.features.length, 2, "generation not blocked by same-named manual feature");
});

test("a different result in the same slot reconciles/replaces the prior application", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn }); // strength face 4 → 1d10
  const other = result("core-monster-generator:strength", "s18", [18, 18], "A brutal two-handed blow.", "Strength"); // 2d6
  applyResult(d, other, { idFn });
  assert.equal(d.generatedEffects.applications.length, 1, "only one application per slot");
  const attacks = d.actions.filter((a) => a.type === "NPC Attack");
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].damage, "2d6", "replaced with the new result's mechanic");
});

test("same table/result ids with a changed exact range reconcile instead of reusing stale mechanics", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn }); // strength range 4 → 1d10
  const moved = result(
    "core-monster-generator:strength", R_ATK.resultId, [18, 18],
    "A synthetic heavy strike.", "Strength",
  );
  const out = applyResult(d, moved, { idFn });
  assert.equal(out.noop, false);
  assert.equal(d.actions.length, 1);
  assert.equal(d.actions[0].damage, "2d6");
  assert.deepEqual(d.generatedEffects.applications[0].ref.range, [18, 18]);
});

test("reconcileResultForColumn removes a prior slot application", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn });
  const report = reconcileResultForColumn(d, R_ATK);
  assert.ok(report);
  assert.equal(d.generatedEffects.applications.length, 0);
  assert.equal(d.actions.length, 0);
});

/* -- bulk removal, manual preservation ------------------------------------- */

test("per-set and all removal preserve manual entries", () => {
  const d = freshDraft({
    features: [{ id: "mf", name: "Pack Tactics", description: "manual" }],
    actions:  [{ id: "ma", name: "Bite", type: "NPC Attack", damage: "1d4", ranges: ["close"], description: "manual" }],
  });
  applyResult(d, R_ATK, { idFn });  // generator
  applyResult(d, R_INT, { idFn });  // mutations (int + feature)
  applyResult(d, R_FLY, { idFn });  // mutations (fly + feature)

  const rmGen = removeGeneratedEffects(d, { setKey: "generator" });
  assert.equal(rmGen.removedApplications.length, 1);
  assert.equal(d.generatedEffects.applications.length, 2, "mutations remain");
  assert.ok(d.actions.some((a) => a.id === "ma"), "manual action preserved");
  assert.ok(d.features.some((f) => f.id === "mf"), "manual feature preserved");

  removeGeneratedEffects(d, { all: true });
  assert.equal(d.generatedEffects.applications.length, 0);
  assert.equal(d.abilities.int, -1, "int restored");
  assert.equal(d.moveNote, "", "fly token removed");
  // Only the two manual items survive.
  assert.deepEqual(d.features.map((f) => f.id), ["mf"]);
  assert.deepEqual(d.actions.map((a) => a.id), ["ma"]);
});

/* -- edited generated item detach ------------------------------------------ */

test("editing a generated item detaches it as manual on removal (not deleted)", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn });
  const atk = d.actions.find((a) => a.type === "NPC Attack");
  atk.damage = "3d12"; // GM edits the generated attack

  const report = removeGeneratedEffects(d, { all: true });
  assert.equal(d.actions.length, 1, "edited attack retained");
  assert.equal(d.actions[0].damage, "3d12");
  assert.equal(d.actions[0].generation, undefined, "generation ownership stripped → manual");
  assert.equal(report.detached.length, 1);
  assert.equal(report.removedActions.length, 0);
});

/* -- additive scalar undo -------------------------------------------------- */

test("additive scalar undo removes only the generated delta", () => {
  const d = freshDraft(); // level 3
  applyResult(d, R_PL2, { idFn }); // +2 → 5
  d.level = 6;                      // GM adds +1
  removeGeneratedEffects(d, { all: true });
  assert.equal(d.level, 4, "generated +2 removed, GM +1 preserved");
});

/* -- set-style conflict ---------------------------------------------------- */

test("set-style reversion is skipped and reported when the value changed", () => {
  const d = freshDraft(); // int -1
  applyResult(d, R_INT, { idFn }); // int → 4
  d.abilities.int = 6;             // GM changes it
  const report = removeGeneratedEffects(d, { all: true });
  assert.equal(d.abilities.int, 6, "current value preserved");
  assert.equal(report.conflicts.length, 1);
  assert.match(report.conflicts[0].path, /int/);
});

/* -- movement token conflict ----------------------------------------------- */

test("movement token removal is exact and conflict-safe", () => {
  const d = freshDraft();
  applyResult(d, R_FLY, { idFn }); // moveNote "fly"
  d.moveNote = "burrow (rewritten)";
  const report = removeGeneratedEffects(d, { all: true });
  assert.equal(d.moveNote, "burrow (rewritten)", "GM-rewritten note preserved");
  assert.ok(report.conflicts.some((c) => /move/i.test(c.path)));
});

/* -- badges / summary ------------------------------------------------------ */

test("summarizeGeneratedEffects reports automated / mixed / gm and edited", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn }); // automated
  applyResult(d, R_INT, { idFn }); // mixed
  applyResult(d, R_GM, { idFn });  // gm
  const sum = summarizeGeneratedEffects(d);
  const modes = sum.applications.map((a) => a.mode).sort();
  assert.deepEqual(modes, ["automated", "gm", "mixed"]);
  assert.equal(sum.counts.total, 3);

  // Edit a generated item → edited badge.
  d.features.find((f) => f.generation?.mode === "gm").description = "edited by GM";
  const sum2 = summarizeGeneratedEffects(d);
  assert.ok(sum2.applications.find((a) => a.mode === "gm").edited, "edited flag set");
});

test("summary flags edited spellcasting but not a no-op setMin the engine never changed", () => {
  const caster = freshDraft();
  const cast = result(
    "core-monster-mutations:mutation-3", "m3-2", [2, 2],
    "Synthetic spellcasting result.", "Mutation 3",
  );
  applyResult(caster, cast, { idFn });
  caster.spellcasting.bonus += 1;
  assert.equal(
    summarizeGeneratedEffects(caster).applications[0].conflict,
    true,
    "manually changed generated spellcasting is visibly conflicted before removal",
  );

  const smart = freshDraft({
    abilities: { str: 0, dex: 1, con: 0, int: 5, wis: 0, cha: 0 },
  });
  applyResult(smart, R_INT, { idFn }); // setMin(4) is a no-op at INT 5
  smart.abilities.int = 6;             // unrelated later manual edit
  assert.equal(
    summarizeGeneratedEffects(smart).applications[0].conflict,
    false,
    "a setMin that changed nothing does not claim ownership of later edits",
  );
});

/* -- provenance round-trip (pure) ------------------------------------------ */

test("buildProvenanceV3 is prose-free and reconstructs the ledger", () => {
  const d = freshDraft();
  applyResult(d, R_ATK, { idFn }); // adds an action + scalar-free op
  applyResult(d, R_PL2, { idFn }); // scalar level delta
  const actorFlag = buildProvenanceV3(d);
  assert.equal(actorFlag.version, 3);
  const json = JSON.stringify(actorFlag);
  assert.ok(!/heavy blow|Elite brute|Slams/i.test(json), "no imported prose in actor flag");
  assert.ok(actorFlag.refs.length >= 2);

  // Simulate actorToDraft: items carry their generation flag; rebuild ledger.
  const draftFeatures = d.features.map((f) => ({ ...f }));
  const draftActions = d.actions.map((a) => ({ ...a }));
  const rebuilt = reconstructGeneratedEffects(actorFlag, draftFeatures, draftActions);
  assert.equal(rebuilt.applications.length, 2);
  const scalarApp = rebuilt.applications.find((a) => a.slotKey === "core-monster-generator:combat");
  assert.ok(scalarApp.operations.some((o) => o.kind === "delta-number" && o.applied === 2));
});

test("v2 / missing actor flag → no ledger reconstruction (all manual)", () => {
  const rebuilt = reconstructGeneratedEffects({ version: 2, refs: [] }, [{ id: "x", name: "Combat" }], []);
  assert.deepEqual(rebuilt.applications, []);
});

test("persisted action-name normalization keeps an unedited generated attack removable", () => {
  const d = freshDraft();
  const lower = result(
    "core-monster-generator:strength", "s4", [4, 4], "crushing blow", "Strength",
  );
  applyResult(d, lower, { idFn });
  const original = d.actions[0];
  const persistedName = "Crushing Blow";
  const persistedFlag = itemGenerationFlag(original, { name: persistedName });
  const loadedAction = {
    ...original,
    id: "loaded-action",
    name: persistedName,
    generation: persistedFlag,
  };
  const actorFlag = buildProvenanceV3(d);
  const loaded = freshDraft({
    actions: [loadedAction],
    generatedEffects: reconstructGeneratedEffects(actorFlag, [], [loadedAction]),
  });

  const report = removeGeneratedEffects(loaded, { all: true });
  assert.equal(report.detached.length, 0, "normal persistence formatting is not mistaken for a GM edit");
  assert.equal(loaded.actions.length, 0, "the unchanged generated attack is removed after round-trip");
});
