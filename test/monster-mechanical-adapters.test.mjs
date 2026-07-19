/**
 * Structural mechanical adapters — SYNTHETIC fixtures only (never Core book
 * content). Exercises the strict parameter parsers, the prose-free registry
 * lookup keyed by manifestId + exact result range, and the fail-closed
 * adapter-authorization policy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseExactlyOneDice,
  parsePowerLevelDelta,
  getAdapterSpec,
  resolveAdapterOps,
  deriveDisplayName,
  MECH_ADAPTERS,
} from "../scripts/encounter/monster-mechanical-adapters.mjs";

/* -- strict dice parser ---------------------------------------------------- */

test("parseExactlyOneDice returns the single dice expression, else null", () => {
  assert.equal(parseExactlyOneDice("deals 2d6 fire damage"), "2d6");
  assert.equal(parseExactlyOneDice("a 1D8 strike"), "1d8");
  assert.equal(parseExactlyOneDice("no dice here"), null);
  // Multiple dice → fail closed (null).
  assert.equal(parseExactlyOneDice("1d6 then another 1d4"), null);
});

/* -- anchored power-level parser ------------------------------------------- */

test("parsePowerLevelDelta extracts an anchored signed level delta, else null", () => {
  assert.equal(parsePowerLevelDelta("Tougher: +2 to level"), 2);
  assert.equal(parsePowerLevelDelta("Weakened, level -1"), -1);
  assert.equal(parsePowerLevelDelta("PL +3 brute"), 3);
  // Unicode minus.
  assert.equal(parsePowerLevelDelta("level –2"), -2);
  // A bare number with no level/PL anchor must fail closed.
  assert.equal(parsePowerLevelDelta("it has 3 heads"), null);
  assert.equal(parsePowerLevelDelta("nothing numeric"), null);
});

/* -- registry: keyed by manifestId + exact result range -------------------- */

test("real registry covers the historical mechanical slots", () => {
  // Make It Weird 3×12 and Generator Strength/Weakness 2×20 carry entries.
  assert.ok(MECH_ADAPTERS["core-monster-mutations:mutation-1"]);
  assert.ok(MECH_ADAPTERS["core-monster-mutations:mutation-2"]);
  assert.ok(MECH_ADAPTERS["core-monster-mutations:mutation-3"]);
  assert.ok(MECH_ADAPTERS["core-monster-generator:strength"]);
  assert.ok(MECH_ADAPTERS["core-monster-generator:weakness"]);
  // Combat is handled by the anchored PL parser (a slot entry, not row data).
  assert.ok(MECH_ADAPTERS["core-monster-generator:combat"]);
  // Quality is explicitly GM-adjudicated → no registry entry.
  assert.equal(MECH_ADAPTERS["core-monster-generator:quality"], undefined);
});

test("getAdapterSpec requires the exact registered range", () => {
  const spec = getAdapterSpec("core-monster-generator:strength", [1, 1]);
  assert.ok(spec, "strength face 1 has a spec");
  assert.ok(Array.isArray(spec.ops));
  assert.equal(getAdapterSpec("core-monster-generator:strength", [1, 2]), null);
  assert.equal(getAdapterSpec("core-monster-generator:strength", [0, 1]), null);
  assert.equal(getAdapterSpec("core-monster-generator:quality", [1, 1]), null);
  assert.equal(getAdapterSpec("nonexistent:slot", [1, 1]), null);
});

/* -- resolveAdapterOps: authorization + fail-closed ------------------------ */

const SYNTH = {
  "synth:attack-fixed": { rows: [{ range: [1, 1], ops: [{ op: "attack", attackType: "NPC Attack", damage: "1d6", ranges: ["close"] }] }] },
  "synth:attack-parse": { rows: [{ range: [1, 1], ops: [{ op: "attack", attackType: "NPC Attack", damage: "parse", ranges: ["near"] }] }] },
  "synth:delta":        { rows: [{ range: [1, 1], ops: [{ op: "delta", path: "ac", delta: 2 }] }] },
  "synth:mixed":        { rows: [{ range: [1, 1], ops: [{ op: "setMin", path: "abilities.int", min: 4 }, { op: "feature" }] }] },
  "synth:feature":      { rows: [{ range: [1, 1], ops: [{ op: "feature" }] }] },
};

function result(manifestId, text, range = [1, 1]) {
  return { manifestId, tableUuid: "T", resultId: "R", range, columnKey: "c", columnLabel: "Slot", text };
}

test("adapter-authorized parse slot with 2d6 prose produces an attack", () => {
  const { mode, ops } = resolveAdapterOps(result("synth:attack-parse", "spits acid for 2d6"), { adapters: SYNTH });
  assert.equal(mode, "automated");
  const attack = ops.find((o) => o.kind === "add-action");
  assert.ok(attack);
  assert.equal(attack.item.damage, "2d6");
  assert.equal(attack.item.type, "NPC Attack");
  assert.deepEqual(attack.item.ranges, ["near"]);
});

test("identical 2d6 prose in an UNREGISTERED slot produces no mechanics (GM)", () => {
  const { mode, ops } = resolveAdapterOps(result("synth:unmapped", "spits acid for 2d6"), { adapters: SYNTH });
  assert.equal(mode, "gm");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "gm-adjudicated");
});

test("a parse slot with multiple dice fails closed to GM adjudication", () => {
  const { mode, ops } = resolveAdapterOps(result("synth:attack-parse", "1d6 then 1d4 more"), { adapters: SYNTH });
  assert.equal(mode, "gm");
  assert.equal(ops[0].kind, "gm-adjudicated");
});

test("a fixed-damage attack slot never parses the prose", () => {
  const { ops } = resolveAdapterOps(result("synth:attack-fixed", "no dice in this prose at all"), { adapters: SYNTH });
  const attack = ops.find((o) => o.kind === "add-action");
  assert.equal(attack.item.damage, "1d6");
});

test("mechanical + feature spec is classified Mixed; feature-only is Automated", () => {
  assert.equal(resolveAdapterOps(result("synth:mixed", "brilliant tactician"), { adapters: SYNTH }).mode, "mixed");
  assert.equal(resolveAdapterOps(result("synth:feature", "immune to cold"), { adapters: SYNTH }).mode, "automated");
  assert.equal(resolveAdapterOps(result("synth:delta", "tough hide"), { adapters: SYNTH }).mode, "automated");
});

test("world-local result text — not registry prose — drives display name/description", () => {
  const { ops } = resolveAdapterOps(result("synth:feature", "Plantlike. It is immune to charm and sleep."), { adapters: SYNTH });
  const feat = ops.find((o) => o.kind === "add-feature");
  assert.equal(feat.item.name, "Plantlike");
  assert.match(feat.item.description, /immune to charm and sleep/);
});

test("Combat PL slot uses the anchored parser to emit a level delta", () => {
  const { mode, ops } = resolveAdapterOps(result("core-monster-generator:combat", "Elite: +2 to level"));
  assert.equal(mode, "automated");
  const delta = ops.find((o) => o.kind === "delta-number");
  assert.equal(delta.path, "level");
  assert.equal(delta.delta, 2);
});

test("Combat PL slot fails closed to GM when no anchored delta is present", () => {
  const { mode } = resolveAdapterOps(result("core-monster-generator:combat", "no discernible power change"));
  assert.equal(mode, "gm");
});

test("deriveDisplayName takes the leading clause, capped, with a fallback", () => {
  assert.equal(deriveDisplayName("Tentacles. It grabs foes.", "Slot"), "Tentacles");
  assert.equal(deriveDisplayName("   ", "Slot"), "Slot");
});
