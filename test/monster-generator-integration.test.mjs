/**
 * Monster Generator/Mutator wiring seams — SOURCE CONTRACT tests.
 *
 * encounter-creator.mjs and monster-mutator.mjs bind Foundry globals at module
 * scope and cannot be imported under node:test, so their integration with the
 * pure effect runtime is asserted structurally (the file text). Pure behavior is
 * covered by monster-effect-runtime / monster-mechanical-adapters test suites.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), "utf8");

/* -- action map + handlers ------------------------------------------------- */

test("creator wires the three separate remove-generated actions to handlers", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  for (const action of ["creatorMutRemoveGenerator", "creatorMutRemoveMutations", "creatorMutRemoveAll"]) {
    assert.match(src, new RegExp(`${action}:\\s*MonsterCreatorApp\\.prototype\\._on\\w+`), `${action} mapped`);
  }
  assert.match(src, /_onMutRemoveGenerator\(\)\s*\{[^}]*setKey:\s*"generator"/s);
  assert.match(src, /_onMutRemoveMutations\(\)\s*\{[^}]*setKey:\s*"mutations"/s);
  assert.match(src, /_onMutRemoveAll\(\)\s*\{[^}]*all:\s*true/s);
});

test("bulk removal goes through removeGeneratedEffects and reports removed/detached/conflicts", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(src, /_removeGenerated\(filter, label\)\s*\{[\s\S]*removeGeneratedEffects\(this\._draft, filter\)/);
  assert.match(src, /report\.removedApplications\.length/);
  assert.match(src, /report\.detached\.length/);
  assert.match(src, /report\.conflicts\.length/);
});

test("apply-to-draft runs through the shared effect runtime (applyResult)", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(src, /_onMutApply\(\)\s*\{[\s\S]*applyResult\(this\._draft, result,/);
  // The legacy append-only path is gone.
  assert.doesNotMatch(src, /appendResultFeatures/);
});

test("Clear selection handlers remain selection-only (non-destructive)", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(src, /_onMutClearSet\(event, target\)\s*\{[^}]*_mutSelection\s*=\s*this\._mutSelection\.filter/s);
  assert.match(src, /_onMutClear\(\)\s*\{\s*this\._mutSelection\s*=\s*\[\];/);
});

/* -- draft + persistence flags --------------------------------------------- */

test("_defaultDraft seeds the generatedEffects ledger", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(src, /generatedEffects:\s*\{\s*version:\s*1,\s*applications:\s*\[\]\s*\}/);
});

test("draftToActorData writes actor v3 flag + per-item generation flags", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  // Actor-level prose-free v3 flag, only when something was generated.
  assert.match(src, /d\.generatedEffects\?\.applications/);
  assert.match(src, /mutation:\s*buildProvenanceV3\(d/);
  // Per-item flag via itemGenerationFlag for both actions and features.
  assert.match(src, /itemGenerationFlag\(a,\s*\{\s*name:\s*base\.name\s*\}\)/);
  assert.match(src, /itemGenerationFlag\(f\)/);
  assert.match(src, /monsterGeneration:\s*gen/);
});

test("draft persistence always escapes textarea HTML instead of trusting a leading tag", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(src, /featureDescriptionHtml/);
  assert.match(src, /function _descHtml\(text\)\s*\{\s*return featureDescriptionHtml\(text\);\s*\}/s);
  assert.doesNotMatch(src, /if\s*\(s\.startsWith\("<"\)\)\s*return s/);
});

test("actorToDraft reconstructs the ledger and reads item generation flags", async () => {
  const src = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(src, /_readItemGeneration\(item\)/);
  assert.match(src, /getFlag\(MODULE_ID,\s*"monsterGeneration"\)/);
  assert.match(src, /draft\.generatedEffects\s*=\s*reconstructGeneratedEffects\(actorMutFlag, draft\.features, draft\.actions\)/);
  // v2 safety comes from reconstructGeneratedEffects (version !== 3 → empty).
});

/* -- variant copy parity --------------------------------------------------- */

test("Create Variant Copy uses the SAME runtime + v3 provenance (no divergent path)", async () => {
  const src = await read("scripts/monster-creator/monster-mutator.mjs");
  assert.match(src, /applyResult\(draft, result, \{ idFn: foundry\.utils\.randomID \}\)/);
  assert.match(src, /draftToActorData\(draft\)/);
  assert.match(src, /_provenanceMeta\s*=\s*\{/);
  // Legacy append/v2 path removed.
  assert.doesNotMatch(src, /appendResultFeatures/);
  assert.doesNotMatch(src, /buildProvenanceV2/);
});

/* -- template labels + badges ---------------------------------------------- */

test("template exposes the exact visible labels and badge classes", async () => {
  const tpl = await read("templates/encounter-creator.hbs");
  for (const label of [
    "Clear selection",
    "Clear all selections",
    "Remove Generator changes",
    "Remove Make It Weird changes",
    "Remove all generated changes",
  ]) {
    assert.ok(tpl.includes(label), `template missing label: ${label}`);
  }
  for (const action of ["creatorMutRemoveGenerator", "creatorMutRemoveMutations", "creatorMutRemoveAll"]) {
    assert.match(tpl, new RegExp(`data-action="${action}"`), `template missing action: ${action}`);
  }
  for (const cls of ["sde-mut-mode-automated", "sde-mut-mode-mixed", "sde-mut-mode-gm"]) {
    assert.ok(tpl.includes(cls), `template missing badge class: ${cls}`);
  }
  // Automated / Mixed / GM adjudication summary labels.
  assert.match(tpl, /Automated/);
  assert.match(tpl, /Mixed/);
  assert.match(tpl, /GM adjudication/);
  assert.match(
    tpl,
    /sde-mut-selected[\s\S]*sde-mut-mode-\{\{this\.mode\}\}/,
    "selected results preview their automation mode before Apply",
  );
  const creator = await read("scripts/monster-creator/encounter-creator.mjs");
  assert.match(creator, /selection\s*=\s*live\.map[\s\S]*planResultEffects\(r,/);
  assert.match(tpl, /sde-mut-applied-set">\{\{this\.setLabel\}\}\s*·\s*\{\{this\.columnLabel\}\}/);
  assert.match(creator, /columnLabel:\s*columnLabelByManifest\.get\(a\.slotKey\)/);
});

test("badge/remove CSS classes exist in the stylesheet", async () => {
  const css = await read("styles/shadowdark-enhancer.css");
  for (const rule of [".sde-mut-applied", ".sde-mut-badge-mode", ".sde-mut-mode-automated", ".sde-mut-mode-gm", ".sde-mut-remove-actions"]) {
    assert.ok(css.includes(rule), `CSS missing rule: ${rule}`);
  }
});

/* -- provenance hygiene: no deprecated ids / no ported source prose -------- */

test("adapters registry carries generic mechanics only — no deprecated ids or ported prose", async () => {
  const src = await read("scripts/monster-creator/monster-mechanical-adapters.mjs");
  // No deprecated static string ids (form-/combat-/mind-/str-/weak- keys).
  assert.doesNotMatch(src, /"(form|combat|mind|str|weak)-[a-z0-9-]+"/i);
  // No ported apply() constructors or name-prefix machinery.
  assert.doesNotMatch(src, /namePrefix|nameSuffix|apply\(d\)/);
  // No sample of the historical prose descriptions.
  for (const prose of [
    "Squeezes through any gap",
    "Takes double damage from",
    "Regains 1d4 HP at the start",
    "Makes one additional attack on its turn",
  ]) {
    assert.ok(!src.includes(prose), `adapter leaked source prose: ${prose}`);
  }
  assert.doesNotMatch(
    src,
    /\]\),?\s*\/\/\s*\d+\s+\S/,
    "per-face comments must not embed source-owned result labels",
  );
});
