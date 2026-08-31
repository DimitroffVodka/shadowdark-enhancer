/**
 * G4 — Forge & Loot preview/approve boundary.
 *
 * These tests intentionally use fake planner/source/commit adapters.  The
 * generator rules and Foundry document writes belong to G5/G7; this suite
 * proves that the shared shell cannot accidentally move either concern across
 * the immutable preview boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FORGE_LOOT_EVENTS,
  FORGE_LOOT_PHASES,
  GENERATOR_IDS,
  ForgeLootController,
  buildPreviewDisplay,
  canApprovePreview,
  createForgeLootState,
  createGeneratorRegistry,
  createSeededRng,
  normalizePlanResult,
  pickSeeded,
  randomInt,
  sourceSnapshotsEqual,
  transitionForgeLootState,
} from "../scripts/forge-loot/forge-loot-core.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

const STUB_TABLE_SNAPSHOT = Object.freeze([
  Object.freeze({ id: "row-a", label: "Ashen" }),
  Object.freeze({ id: "row-b", label: "Bronze" }),
  Object.freeze({ id: "row-c", label: "Cobalt" }),
]);

const PREVIEW_FIXTURE = {
  generator: GENERATOR_IDS.NPC,
  seed: "fixture-seed",
  preview: { id: "proposal-1", rolled: [{ name: "Ashen" }] },
  sourceSnapshot: { tables: [{ id: "names", version: 1 }] },
  view: { title: "Fixture proposal", sections: [] },
  missing: [],
  exclusions: [{ code: "unsupported", message: "Excluded fixture row" }],
  warnings: [{ code: "warning", message: "Fixture warning" }],
  blocked: false,
  disabled: false,
};

function adapter({
  id = GENERATOR_IDS.NPC,
  plan = async ({ seed, rng }) => ({
    preview: {
      name: `Preview ${seed}`,
      tableRow: pickSeeded(rng, STUB_TABLE_SNAPSHOT),
      roll: randomInt(rng, 20) + 1,
      display: { title: `Preview ${seed}` },
    },
    sourceSnapshot: { revision: 1 },
  }),
  readSourceSnapshot = async () => ({ revision: 1 }),
  commit = async ({ preview }) => ({ id: "created-1", name: preview.name }),
  fields = [],
} = {}) {
  return { id, label: id, description: `${id} fixture`, fields, plan, readSourceSnapshot, commit };
}

function harness(options = {}) {
  const registry = createGeneratorRegistry([
    adapter({ id: GENERATOR_IDS.NPC, ...options }),
    adapter({ id: GENERATOR_IDS.RIVAL }),
  ]);
  let active = true;
  const controller = new ForgeLootController({
    registry,
    generator: options.generator ?? GENERATOR_IDS.NPC,
    seed: options.seed ?? "fixed-seed",
    input: options.input ?? {},
    isActiveGM: () => active,
  });
  return { controller, registry, setActive: (value) => { active = value; } };
}

test("the owned seeded PRNG is repeatable, bounded, and independent per lifecycle", () => {
  const first = createSeededRng("same-seed");
  const second = createSeededRng("same-seed");
  const other = createSeededRng("other-seed");
  const a = [first(), first(), first(), first()];
  const b = [second(), second(), second(), second()];
  const c = [other(), other(), other(), other()];
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.every((value) => value >= 0 && value < 1));
});

test("the normalized preview fixture locks the generator/preview/diagnostic seam", () => {
  const normalized = normalizePlanResult(PREVIEW_FIXTURE);
  assert.deepEqual(Object.keys(normalized).sort(), [
    "blocked", "disabled", "exclusions", "generator", "missing", "preview", "seed", "sourceSnapshot", "statusMessage", "view", "warnings",
  ]);
  assert.equal(normalized.generator, GENERATOR_IDS.NPC);
  assert.equal(normalized.seed, "fixture-seed");
  assert.deepEqual(normalized.preview, PREVIEW_FIXTURE.preview);
  assert.deepEqual(normalized.sourceSnapshot, PREVIEW_FIXTURE.sourceSnapshot);
  assert.equal(normalized.warnings[0].code, "warning");
});

test("initial and selection transitions are immutable and clear old preview state", () => {
  const initial = createForgeLootState({ seed: "s" });
  assert.equal(initial.phase, "idle");
  assert.equal(initial.phase, FORGE_LOOT_PHASES.IDLE);
  assert.equal(initial.phase, FORGE_LOOT_PHASES.SELECT);
  const selected = transitionForgeLootState(initial, {
    type: FORGE_LOOT_EVENTS.SELECT_GENERATOR,
    generator: GENERATOR_IDS.NPC,
  });
  assert.equal(selected.phase, FORGE_LOOT_PHASES.INPUT);
  assert.equal(selected.generator, GENERATOR_IDS.NPC);
  assert.notEqual(selected, initial);
  assert.equal(initial.generator, null);
  assert.ok(Object.isFrozen(selected));
});

test("input changes invalidate a prior preview without mutating the input object", () => {
  const state = transitionForgeLootState(createForgeLootState({ generator: "npc", input: { level: 2 } }), {
    type: FORGE_LOOT_EVENTS.PREVIEW_READY,
    preview: { name: "before" },
    sourceSnapshot: { revision: 1 },
  });
  const next = transitionForgeLootState(state, { type: FORGE_LOOT_EVENTS.SET_INPUT, key: "level", value: 3 });
  assert.equal(next.phase, FORGE_LOOT_PHASES.INPUT);
  assert.equal(next.preview, null);
  assert.equal(next.input.level, 3);
  assert.equal(state.input.level, 2);
  assert.equal(state.preview.name, "before");
});

test("planner produces a cloned, frozen preview and never commits", async () => {
  let plans = 0;
  let commits = 0;
  const { controller } = harness({
    plan: async () => {
      plans++;
      return {
        preview: { name: "Exact", nested: { value: 7 } },
        sourceSnapshot: { revision: 4 },
      };
    },
    commit: async () => { commits++; },
  });
  const result = await controller.preview();
  assert.equal(result.ok, true);
  assert.equal(plans, 1);
  assert.equal(commits, 0);
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.PREVIEW);
  assert.equal(Object.isFrozen(controller.state.preview), true);
  assert.equal(Object.isFrozen(controller.state.preview.nested), true);
  assert.throws(() => { controller.state.preview.nested.value = 9; }, TypeError);
  assert.equal(controller.state.preview.nested.value, 7);
});

test("same seed and source snapshot gives the same complete preview", async () => {
  const make = () => harness({
    plan: async ({ seed, rng }) => ({
      preview: {
        seed,
        tableRow: pickSeeded(rng, STUB_TABLE_SNAPSHOT),
        result: randomInt(rng, 1000),
        nested: { stable: true },
      },
      sourceSnapshot: { source: "fixture", version: 1, rows: STUB_TABLE_SNAPSHOT },
    }),
    readSourceSnapshot: async () => ({ source: "fixture", version: 1, rows: STUB_TABLE_SNAPSHOT }),
  }).controller;
  const first = make();
  const second = make();
  await first.preview();
  await second.preview();
  assert.equal(JSON.stringify(first.state.preview), JSON.stringify(second.state.preview));
  assert.equal(JSON.stringify(first.state.sourceSnapshot), JSON.stringify(second.state.sourceSnapshot));
  assert.equal(Object.isFrozen(first.state.preview), true);
});

test("each preview gets a fresh seeded RNG, while approve receives none", async () => {
  const calls = [];
  const { controller } = harness({
    plan: async ({ seed, rng }) => {
      calls.push({ seed, samples: [rng(), rng()] });
      return { preview: { seed, sample: rng() }, sourceSnapshot: { revision: 1 } };
    },
  });
  await controller.preview();
  const firstSamples = calls[0].samples;
  await controller.reroll();
  assert.equal(calls.length, 2);
  assert.notDeepEqual(firstSamples, calls[1].samples);
  let committed;
  controller.registry.register(adapter({
    id: GENERATOR_IDS.NPC,
    plan: async ({ seed, rng }) => ({ preview: { seed, sample: rng() }, sourceSnapshot: { revision: 1 } }),
    commit: async (request) => { committed = request; },
  }));
  controller.setSeed("commit-seed");
  await controller.preview();
  await controller.approve();
  assert.equal(Object.hasOwn(committed, "rng"), false);
});

test("reroll deliberately changes the seed and replaces the preview", async () => {
  const seen = [];
  const { controller } = harness({
    plan: async ({ seed }) => {
      seen.push(seed);
      return { preview: { seed }, sourceSnapshot: { revision: seed } };
    },
    readSourceSnapshot: async ({ sourceSnapshot }) => sourceSnapshot,
  });
  await controller.preview();
  const old = controller.state.preview;
  const result = await controller.reroll();
  assert.equal(result.ok, true);
  assert.equal(controller.state.rerollCount, 1);
  assert.notEqual(seen[0], seen[1]);
  assert.notDeepEqual(controller.state.preview, old);
  assert.match(controller.state.seed, /:reroll:1$/);
});

test("cancel aborts planning, clears the proposal, and performs no write", async () => {
  let resolvePlan;
  let commits = 0;
  const { controller } = harness({
    plan: () => new Promise((resolve) => { resolvePlan = resolve; }),
    commit: async () => { commits++; },
  });
  const planning = controller.preview();
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.PLANNING);
  const cancelled = controller.cancel();
  assert.equal(cancelled.ok, true);
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.CANCELLED);
  assert.equal(controller.state.preview, null);
  resolvePlan({ preview: { name: "late" }, sourceSnapshot: { revision: 1 } });
  const late = await planning;
  assert.equal(late.reason, "stale-preview");
  assert.equal(commits, 0);
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.CANCELLED);
});

test("missing inputs block approval and retain visible diagnostics", async () => {
  let commits = 0;
  const { controller } = harness({
    plan: async () => ({
      preview: { name: "incomplete" },
      sourceSnapshot: { revision: 1 },
      missing: ["Ancestry is required", { code: "class-missing", message: "No eligible class" }],
      exclusions: ["Unsupported modal class"],
      warnings: ["Thin idiom fallback"],
    }),
    commit: async () => { commits++; },
  });
  const planned = await controller.preview();
  assert.equal(planned.ok, false);
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.BLOCKED);
  assert.equal(controller.state.blocked, true);
  assert.equal(controller.state.missing[0].code, "missing-input");
  assert.equal(controller.state.missing[1].code, "class-missing");
  assert.equal(controller.state.exclusions[0].code, "excluded");
  assert.equal(controller.state.warnings[0].code, "warning");
  assert.equal(canApprovePreview(controller.state), false);
  const approval = await controller.approve();
  assert.equal(approval.reason, "preview-not-ready");
  assert.equal(commits, 0);
});

test("disabled readiness reports remain explicit and cannot be approved", () => {
  const state = transitionForgeLootState(createForgeLootState({ generator: GENERATOR_IDS.RIVAL }), {
    type: FORGE_LOOT_EVENTS.PREVIEW_READY,
    preview: { proposal: "not-ready" },
    disabled: true,
    exclusions: [{ code: "no-eligible-class", message: "No eligible class" }],
  });
  assert.equal(state.phase, FORGE_LOOT_PHASES.DISABLED);
  assert.equal(state.disabled, true);
  assert.equal(state.blocked, true);
  assert.equal(canApprovePreview(state), false);
});

test("planner errors become visible error state without a write", async () => {
  const { controller } = harness({ plan: async () => { throw new Error("table unavailable"); } });
  const result = await controller.preview();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "preview-failed");
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.ERROR);
  assert.equal(controller.state.error.code, "preview-failed");
  assert.match(controller.state.error.message, /table unavailable/);
});

test("a planner cannot silently change the selected generator or seed", async () => {
  let commits = 0;
  const { controller } = harness({
    plan: async () => ({ generator: GENERATOR_IDS.RIVAL, seed: "different", preview: { name: "wrong" } }),
    commit: async () => { commits++; },
  });
  const result = await controller.preview();
  assert.equal(result.reason, "preview-metadata-mismatch");
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.ERROR);
  assert.equal(controller.state.preview, null);
  assert.equal(commits, 0);
});

test("approve rechecks source drift before entering the commit adapter", async () => {
  let commits = 0;
  const { controller } = harness({
    plan: async () => ({ preview: { name: "proposal" }, sourceSnapshot: { revision: 1 } }),
    readSourceSnapshot: async () => ({ revision: 2 }),
    commit: async () => { commits++; },
  });
  await controller.preview();
  const result = await controller.approve();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "source-drift");
  assert.equal(commits, 0);
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.ERROR);
  assert.equal(controller.state.commit.consumed, false);
  assert.ok(controller.state.preview, "drift leaves the proposal visible for a fresh preview");
});

test("approve rechecks the active GM and performs no commit when the role changes", async () => {
  let commits = 0;
  const { controller, setActive } = harness({ commit: async () => { commits++; } });
  await controller.preview();
  setActive(false);
  const result = await controller.approve();
  assert.equal(result.reason, "not-active-gm");
  assert.equal(commits, 0);
  assert.equal(controller.state.error.code, "not-active-gm");
});

test("approve passes the exact planned values once and consumes the preview", async () => {
  let planned;
  let committed;
  let plans = 0;
  let commits = 0;
  const { controller } = harness({
    plan: async ({ seed, input }) => {
      plans++;
      planned = { seed, input: { ...input }, nested: { answer: 42 } };
      return { preview: planned, sourceSnapshot: { revision: 1 } };
    },
    commit: async (request) => {
      commits++;
      committed = request;
      return { actorId: "a1" };
    },
  });
  controller.setInput("name", "A");
  await controller.preview();
  const previewRef = controller.state.preview;
  const before = structuredClone(controller.state.preview);
  const result = await controller.approve();
  assert.equal(result.ok, true);
  assert.equal(plans, 1, "approval never rerolls");
  assert.equal(commits, 1);
  assert.deepEqual(committed.preview, before);
  assert.equal(committed.preview, previewRef, "commit receives the exact frozen preview reference");
  assert.deepEqual(Object.keys(committed).sort(), ["generator", "input", "preview", "seed", "sourceSnapshot"]);
  assert.equal(committed.seed, "fixed-seed");
  assert.equal(committed.input.name, "A");
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.COMMITTED);
  assert.equal(controller.state.preview, null);
  assert.equal(controller.state.commit.consumed, true);
  const second = await controller.approve();
  assert.equal(second.reason, "preview-consumed");
  assert.equal(commits, 1);
});

test("rapid double approval is serialized by the synchronous in-flight guard", async () => {
  let release;
  let commits = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const { controller } = harness({ commit: async () => { commits++; await gate; return { ok: true }; } });
  await controller.preview();
  const first = controller.approve();
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.COMMITTING);
  const second = await controller.approve();
  assert.equal(second.reason, "commit-in-progress");
  assert.equal(commits, 0, "the synchronous guard wins before the async source check reaches the adapter");
  release();
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(commits, 1);
});

test("reset and cancel cannot clear an approval while its commit is in flight", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { controller } = harness({ commit: async () => { await gate; return { ok: true }; } });
  await controller.preview();
  const approval = controller.approve();
  const duringCommit = controller.state;
  assert.equal(duringCommit.phase, FORGE_LOOT_PHASES.COMMITTING);
  assert.equal(controller.dispatch({ type: FORGE_LOOT_EVENTS.RESET }), duringCommit);
  assert.equal(controller.cancel().reason, "commit-in-progress");
  release();
  const result = await approval;
  assert.equal(result.ok, true);
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.COMMITTED);
});

test("a consumed preview cannot be cancelled back into an approval state", async () => {
  const { controller } = harness();
  await controller.preview();
  await controller.approve();
  const committed = controller.state;
  const cancelled = controller.cancel();
  assert.equal(cancelled.reason, "preview-consumed");
  assert.equal(controller.state, committed);
  assert.equal(canApprovePreview(controller.state), false);
});

test("commit errors are displayed and do not pretend to consume a preview", async () => {
  let commits = 0;
  const { controller } = harness({
    commit: async () => { commits++; throw new Error("forced adapter failure"); },
  });
  await controller.preview();
  const result = await controller.approve();
  assert.equal(result.reason, "commit-failed");
  assert.equal(commits, 1);
  assert.equal(controller.state.phase, FORGE_LOOT_PHASES.ERROR);
  assert.equal(controller.state.commit.consumed, false);
  assert.match(controller.state.error.message, /forced adapter failure/);
  assert.ok(controller.state.preview, "the exact proposal remains available for a deliberate retry");
});

test("a source snapshot requires a recheck adapter", async () => {
  const { controller } = harness({ readSourceSnapshot: undefined });
  // `harness`'s default object supplies the reader, so explicitly replace the
  // adapter with a valid no-reader adapter to exercise this contract.
  controller.registry.register(adapter({
    id: GENERATOR_IDS.NPC,
    plan: async () => ({ preview: { name: "p" }, sourceSnapshot: { revision: 1 } }),
    commit: async () => ({ ok: true }),
    readSourceSnapshot: null,
  }));
  await controller.preview();
  const result = await controller.approve();
  assert.equal(result.reason, "source-check-unavailable");
});

test("source comparison ignores object-key order but preserves array order", () => {
  assert.equal(sourceSnapshotsEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }), true);
  assert.equal(sourceSnapshotsEqual({ rows: [1, 2] }, { rows: [2, 1] }), false);
});

test("generic display projection keeps generator rules out of the UI", () => {
  const display = buildPreviewDisplay({
    preview: { name: "Lysa", level: 3, members: [{ name: "not rendered as a rule" }] },
    generator: GENERATOR_IDS.NPC,
    seed: "x",
  });
  assert.equal(display.title, "Ordinary NPC");
  assert.ok(display.sections[0].rows.some((row) => row.label === "name" && row.value === "Lysa"));
});

test("G4 app/template expose only shared boundary actions and no generator rules", async () => {
  const [app, template, entry] = await Promise.all([
    read("scripts/forge-loot/forge-loot-app.mjs"),
    read("templates/forge-loot.hbs"),
    read("scripts/shadowdark-enhancer.mjs"),
  ]);
  for (const action of ["selectGenerator", "generatePreview", "reroll", "cancel", "approve"]) {
    assert.match(template, new RegExp(`data-action="${action}"`), `${action} action missing`);
  }
  assert.match(app, /ForgeLootController/);
  const core = await read("scripts/forge-loot/forge-loot-core.mjs");
  assert.match(core, /source drift|source snapshot/i);
  assert.doesNotMatch(app, /Actor\.create|Folder\.create|NPC Generator rules|Rival Crawler rules/);
  assert.doesNotMatch(template, /Actor\.create|Folder\.create/);
  assert.match(entry, /forgeLoot:\s*\{[\s\S]*?open:\s*async/);
  assert.match(entry, /apiVersion:\s*["']1\.4\.0["']/);
  assert.match(app, /import\s*\{\s*isActiveGM\s*\}\s*from\s*["']\.\.\/shared\/gm-relay\.mjs/);
  const executableCore = core.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(executableCore, /new\s+Roll\b|\.draw\s*\(/, "seeded planners cannot invoke Foundry table rolls");
});
