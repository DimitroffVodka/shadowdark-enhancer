import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";

/** The tagger with a scene whose only stored data is `flags` (key -> value), and a Renumber dialog that counts and answers. */
async function harness(flags, answer) {
  const previous = { foundry: globalThis.foundry, canvas: globalThis.canvas, ui: globalThis.ui };
  const asked = [];
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {},
        DialogV2: { confirm: async () => { asked.push(1); return answer; } },
      },
    },
    utils: { escapeHTML: (s) => s },
  };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  const scene = { id: "s1", getFlag: (m, k) => (m === MOD ? flags[k] : undefined) };
  globalThis.canvas = { scene };
  const { HexTaggerApp } = await import("../scripts/hex-map/hex-tagger-app.mjs");
  const app = Object.create(HexTaggerApp.prototype);
  const origin = { q: 0, r: 0, num: "0000", shifted: "odd", bounds: { cols: 2, rows: 2 } };
  const field = { "input[data-hxt-cols]": { value: "2" }, "input[data-hxt-rows]": { value: "2" }, "input[data-hxt-skip-top]": { checked: false }, "input[data-hxt-anchor]": { value: "0001" } };
  Object.assign(app, {
    _state: { origin, cells: new Map() }, _stateSceneId: "s1", _cells: [], _numbered: new Map(), _sheet: [],
    element: { querySelector: (sel) => field[sel] ?? null },
    render() {},
  });
  let saved = 0;
  app._saveState = async () => { saved++; };
  return { app, origin, asked, saved: () => saved, restore: () => Object.assign(globalThis, previous) };
}

// Each is filed by hex number, so moving the first hex moves it onto another hex.
const FILED = {
  "a region the GM assigned before any enclosure scan": { hexRegions: { v: 1, comp: {}, fix: { 101: "Myre" } } },
  "a scanned region": { hexRegions: { v: 1, comp: { 101: 1 } } },
  "a terrain correction": { hexTagFixes: { fixes: { 101: "forest>swamp|0.2" } } },
  "the GM's tile art": { hexArt: { 101: { art: "modules/x/a.webp" } } },
};

for (const [what, flags] of Object.entries(FILED)) {
  test(`renumbering asks first when the map holds ${what}, and declining changes nothing`, async () => {
    const h = await harness(flags, false);
    try {
      await h.app._onSetBounds();
      assert.equal(h.asked.length, 1, "the confirmation is shown");
      assert.equal(h.app._state.origin, h.origin, "the anchor is untouched");
      assert.equal(h.origin.num, "0000");
      assert.equal(h.saved(), 0, "nothing was written");
    } finally { h.restore(); }
  });
}

test("renumbering an empty map asks nothing", async () => {
  const h = await harness({}, false);
  try {
    await h.app._onSetBounds();
    assert.equal(h.asked.length, 0);
    assert.equal(h.app._state.origin.num, "0001");
  } finally { h.restore(); }
});
