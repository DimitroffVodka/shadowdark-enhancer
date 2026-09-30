import test from "node:test";
import assert from "node:assert/strict";

/**
 * The review sheet's unconfirmed answers must survive every re-render that is not the sheet's own
 * Apply: changing the map's terrain palette, a tag painted from outside the window, and the rest.
 * The DOM is a stand-in with just enough selector support for the controls the tagger reads.
 */

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class { _onRender() {} },
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: {},
    },
  },
  utils: { escapeHTML: (s) => s },
};
class Replacement { constructor(value) { this.value = value; } }
globalThis._replace = (value) => new Replacement(value);
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.canvas = { scene: null };
const { HexTaggerApp } = await import("../scripts/hex-map/hex-tagger-app.mjs");
const { decodeTags } = await import("../scripts/hex-map/tag-store.mjs");

// ── a DOM with attribute selectors, :checked, and comma lists ─────────────────────────────────
function el(tag, attrs = {}) {
  const listeners = {};
  return {
    tag, attrs, dataset: {}, listeners, hidden: false, value: "", checked: false,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type) { for (const fn of listeners[type] ?? []) fn({ currentTarget: this, key: undefined, preventDefault() {} }); },
    hasAttribute(name) { return name in attrs; },
    focus() {},
  };
}
function matcher(selector) {
  return selector.split(",").map((s) => s.trim()).map((part) => {
    const tag = /^[a-z]+/.exec(part)?.[0];
    const attrs = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1], m[2]]);
    return (e) => (!tag || e.tag === tag) && attrs.every(([k, v]) => k in e.attrs && (v === undefined || e.attrs[k] === v))
      && (!part.endsWith(":checked") || e.checked);
  });
}
function fakeRoot(elements) {
  return {
    querySelectorAll: (sel) => { const ms = matcher(sel); return elements.filter((e) => ms.some((m) => m(e))); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
  };
}

/** What the template makes of one prepared context: the controls of the sheet and the palette. */
function domFrom(context) {
  const els = [];
  for (const term of context.palette.terms) {
    const box = el("input", { "data-hxt-palette": "", value: term.value });
    box.value = term.value; box.checked = term.checked; els.push(box);
  }
  els.push(el("input", { "data-hxt-palette-own": "" }));
  const mode = el("select", { "data-hxt-mode": "" });
  mode.value = context.modes.find((m) => m.selected)?.value ?? "";
  els.push(mode);
  for (const c of context.sheet) {
    const sel = el("select", { "data-hxt-terrain": "", "data-num": String(c.num) });
    sel.dataset.num = String(c.num);
    sel.value = c.terrainOptions.find((o) => o.selected)?.value ?? c.terrainOptions[0].value;
    els.push(sel);
    const other = el("input", { "data-hxt-terrain-other": "", "data-num": String(c.num) });
    other.dataset.num = String(c.num); other.value = c.terrainOther; other.hidden = !c.terrainOther;
    els.push(other);
    for (const f of ["river", "path", "coast"]) {
      const box = el("input", { "data-hxt-feature": "", "data-num": String(c.num), value: f });
      box.dataset.num = String(c.num); box.value = f; box.checked = !!c.features[f];
      els.push(box);
    }
  }
  return els;
}

const cellOf = (n) => ({ num: n, i: n, j: 0, cube: { q: n, r: 0 } });

function newApp({ palette = null } = {}) {
  const flags = {};
  const scene = {
    id: "s1",
    getFlag: (_m, k) => flags[k],
    update: async (data) => {
      for (const [path, v] of Object.entries(data)) flags[path.split(".").pop()] = v instanceof Replacement ? structuredClone(v.value) : v;
    },
  };
  globalThis.canvas = { scene };
  const app = Object.create(HexTaggerApp.prototype);
  app._entries = [{ uuid: "x", name: "x", doc: null }];
  app._entryUuid = "x";
  app._loadState();
  app._state.origin = { i: 0, j: 0, q: 0, r: 0, num: "0101", shifted: "odd", bounds: null };
  app._state.palette = palette;
  for (const [num, terrain] of [[101, "forest"], [102, "forest"]]) app._state.cells.set(String(num), { terrain, features: [], source: "auto", margin: 0.1, review: true });
  app._cells = [cellOf(101), cellOf(102)];
  app._numbered = new Map([[101, cellOf(101)], [102, cellOf(102)]]);
  app._sheet = [101, 102];
  app._mode = "review";
  app._selectedEntries = () => [];
  app._thumb = () => "";
  app._legend = null;
  app.element = fakeRoot([]);
  /** A render the way Foundry does it: prepare, replace the DOM, then hook the new controls. */
  app.render = () => {
    app.rendered = app._prepareContext().then((context) => {
      app.context = context;
      app.element = fakeRoot(domFrom(context));
      app._onRender(context, {});
      return context;
    });
    return app.rendered;
  };
  return { app, flags };
}

const sel = (app, num) => app.element.querySelector(`select[data-hxt-terrain][data-num="${num}"]`);
const other = (app, num) => app.element.querySelector(`input[data-hxt-terrain-other][data-num="${num}"]`);
const feat = (app, num, f) => app.element.querySelector(`input[data-hxt-feature][data-num="${num}"][value="${f}"]`);
const shownTerrain = (app, num) => sel(app, num).value;

test("a forest hex changed to lake and a ticked river survive a palette change, and are not saved by it", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  sel(app, 101).value = "lake"; sel(app, 101).fire("change");
  feat(app, 102, "river").checked = true; feat(app, 102, "river").fire("change");

  const swamp = app.element.querySelector('input[data-hxt-palette][value="swamp"]');
  swamp.checked = true;
  await app._setPalette(app._paletteFromBoxes());
  await app.rendered;

  assert.equal(shownTerrain(app, 101), "lake", "the unconfirmed correction is still on the sheet");
  assert.equal(feat(app, 102, "river").checked, true, "so is the ticked river");
  assert.equal(feat(app, 101, "river").checked, false);
  assert.equal(app._state.cells.get("101").terrain, "forest", "and nothing was confirmed on the GM's behalf");
  assert.deepEqual(app._state.cells.get("102").features, []);
  assert.equal(app._state.cells.get("101").source, "auto");
  assert.ok(app._state.palette.includes("swamp"), "the palette did change");
});

test("a word typed into 'other' survives, including one the new palette does not list", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  sel(app, 101).value = "__other"; sel(app, 101).fire("change");
  other(app, 101).value = "salt flat"; other(app, 101).fire("input");

  await app._setPalette(["forest"]);
  await app.rendered;

  assert.equal(shownTerrain(app, 101), "__other");
  assert.equal(other(app, 101).value, "salt flat");
  assert.equal(other(app, 101).hidden, false, "the box for it is showing");
});

test("a draft terrain the palette just dropped stays as a typed word instead of falling to the first option", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  sel(app, 101).value = "lake"; sel(app, 101).fire("change");

  await app._setPalette(["forest", "swamp"]);   // lake is no longer a printed choice
  await app.rendered;

  assert.equal(shownTerrain(app, 101), "__other");
  assert.equal(other(app, 101).value, "lake");
});

test("an untouched cell follows the tags: a hex painted from outside is not shadowed by a stale sheet copy", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  feat(app, 101, "path").checked = true; feat(app, 101, "path").fire("change");
  app._state.cells.set("102", { terrain: "lake", features: [], source: "gm" });   // brushed on the map

  await app.render();

  assert.equal(shownTerrain(app, 102), "lake", "the painted hex shows what was painted");
  assert.equal(feat(app, 101, "path").checked, true, "the touched hex keeps its draft");
});

test("Apply confirms the drafts, and they are gone afterwards", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  app._recordVerdicts = async () => {};
  await app.render();
  sel(app, 101).value = "lake"; sel(app, 101).fire("change");
  await app._onApplySheet();
  await app.rendered;
  assert.equal(app._state.cells.get("101").terrain, "lake");
  assert.equal(decodeTags(app._scene().getFlag("shadowdark-enhancer", "hexTags")).cells.get("101").terrain, "lake");

  // The same cells on the next sheet (a keyed sheet keeps tagged hexes) start from what is stored.
  app._sheet = [101, 102];
  app._state.cells.set("101", { terrain: "forest", features: [], source: "gm" });
  await app.render();
  assert.equal(shownTerrain(app, 101), "forest", "no draft outlives its Apply");
});

test("Next sheet is a fresh look: drafts on the old sheet do not carry onto it", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  sel(app, 101).value = "lake"; sel(app, 101).fire("change");
  await app._onNextSheet();
  await app.rendered;
  assert.equal(shownTerrain(app, 101), "forest");
});

test("a different sheet takes no draft from the last one", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  sel(app, 101).value = "lake"; sel(app, 101).fire("change");
  app._sheet = [101];   // the sheet was rebuilt by some other route
  await app.render();
  assert.equal(shownTerrain(app, 101), "forest");
});

test("a tag written from outside the window redraws with the sheet's drafts kept", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  sel(app, 102).value = "lake"; sel(app, 102).fire("change");
  await app.render();   // what the updateScene hook does after _loadState and _renumber
  assert.equal(shownTerrain(app, 102), "lake");
});

test("the header's Show mode is kept across a palette change", async () => {
  const { app } = newApp({ palette: ["forest", "lake"] });
  await app.render();
  assert.equal(app.element.querySelector("select[data-hxt-mode]").value, "review");
  app.element.querySelector("select[data-hxt-mode]").value = "keyed";   // chosen, not yet acted on

  await app._setPalette(["forest"]);
  await app.rendered;

  assert.equal(app.element.querySelector("select[data-hxt-mode]").value, "keyed");
});
