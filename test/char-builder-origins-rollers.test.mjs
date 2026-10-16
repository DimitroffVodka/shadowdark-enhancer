import test from "node:test";
import assert from "node:assert/strict";
import { CharBuilderState } from "../scripts/char-builder/state.mjs";
import { OriginsStep } from "../scripts/char-builder/steps/origins-step.mjs";

/**
 * Origins: Alignment, Background and Deity each have their own dice button
 * (data-cb-roll-origin). A click re-rolls only that section.
 */

const prev = { game: globalThis.game, CONFIG: globalThis.CONFIG, shadowdark: globalThis.shadowdark };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k },
  user: { isGM: false },
  settings: { get: () => false },
};
globalThis.CONFIG = { SHADOWDARK: {} };
globalThis.shadowdark = { compendiums: { backgrounds: async () => [], deities: async () => [] } };
test.after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
});

const makeApp = (state) => ({ builderState: state, steps: [], render: async () => { makeApp.renders += 1; }, _lockedCensus: null });
makeApp.renders = 0;

/** A root whose [data-cb-roll-origin] nodes record their click handlers. */
function fakeRoot(keys) {
  const buttons = keys.map((key) => {
    const handlers = [];
    return { dataset: { cbRollOrigin: key }, addEventListener: (_t, fn) => handlers.push(fn), click: () => Promise.all(handlers.map((fn) => fn())) };
  });
  return {
    buttons,
    root: {
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === "[data-cb-roll-origin]" ? buttons : []),
    },
  };
}

test("each origin's dice button rolls only its own section, then re-renders", async () => {
  const step = new OriginsStep(makeApp(new CharBuilderState()));
  const rolled = [];
  for (const key of Object.keys(step.sub)) step.sub[key].randomize = async () => { rolled.push(key); };

  const { root, buttons } = fakeRoot(["alignment", "background", "deity"]);
  step.onRender(root);

  makeApp.renders = 0;
  for (const btn of buttons) await btn.click();
  assert.deepEqual(rolled, ["alignment", "background", "deity"]);
  assert.equal(makeApp.renders, 3);
});

test("rollers are offered for a new build and hidden for an existing character", async () => {
  const fresh = new OriginsStep(makeApp(new CharBuilderState()));
  assert.equal((await fresh.prepareContext()).canRoll, true);

  const st = new CharBuilderState();
  st.existing = { actorId: "a1" };
  const edited = new OriginsStep(makeApp(st));
  assert.equal((await edited.prepareContext()).canRoll, false);
});
