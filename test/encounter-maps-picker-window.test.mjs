/**
 * The battle map picker window, its template, its settings and its wiring.
 *
 * The window is imported against a stub ApplicationV2 and handed a made-up map
 * library, so this passes whatever state the other parts of the feature are in.
 * What the picker lists and means is encounter-maps-picker-core.test.mjs.
 *
 * What this pins:
 *   1. THE PROMISE. pick() answers with the choice, or null when the window was
 *      closed without one, and never hangs.
 *   2. THE CLICKS. The map the picker starts on goes ahead on its first click, any
 *      other is chosen first and goes ahead on the second.
 *   3. THE GM'S SWITCHES. They write the whole saved value, and only a GM writes it.
 *   4. THE MARKUP. Every action in the template has a handler and every handler a
 *      button; no English is written into the template (#169).
 *   5. THE WIRING. The settings, the stylesheet and the API namespace are where
 *      the rest of the module looks for them.
 */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { SETTINGS } from "../scripts/encounter/battle-maps/constants.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const en = JSON.parse(read("languages/en.json"));
const MODULE = "shadowdark-enhancer";

// ── a stand-in for Foundry ───────────────────────────────────────────────────
class ApplicationV2 {
  constructor(options = {}) { this.options = options; this.renders = 0; this.closed = false; }
  render() { this.renders++; return Promise.resolve(this); }
  async close() { this.closed = true; return this; }
}
globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (B) => class extends B {} } } };

let store;
let writes;
let errors;
let scenes;
const user = { isGM: true };
globalThis.game = {
  user,
  i18n: { localize: (k) => k, format: (k) => k },
  settings: {
    get: (ns, key) => store[`${ns}.${key}`],
    // Like v14's: the new value is in place only once the server has answered (`latency` ms), not when set() is called.
    set: async (ns, key, value) => {
      const settings = globalThis.game.settings;
      if (settings.fail || settings.failTimes-- > 0) throw new Error("refused");
      writes.push([ns, key, value]);
      settings.mostInFlight = Math.max(settings.mostInFlight, ++settings.inFlight);
      if (settings.latency) await new Promise((resolve) => setTimeout(resolve, settings.latency));
      store[`${ns}.${key}`] = value;
      settings.inFlight--;
      return value;
    },
  },
  get scenes() { return scenes; },
};
globalThis.ui = { notifications: { error: (m) => errors.push(m) } };

const { BattleMapPicker } = await import("../scripts/encounter/battle-maps/battle-map-picker.mjs");

// ── a made-up library ────────────────────────────────────────────────────────
const map = (id, terrains) => ({ id, labelKey: `label.${id}`, terrains, image: `modules/${MODULE}/assets/scenes/encounter/${id}.webp`, sources: [] });
const woods = map("forest-woods", ["forest"]);
const road = map("forest-road", ["forest", "path"]);
const glade = map("forest-glade", ["forest"]);
const dunes = map("desert-dunes", ["desert"]);
const lib = {
  mapsForTerrain: (t) => (t === "forest" ? [woods, road, glade] : []),
  otherMaps: (t) => [woods, road, glade, dunes].filter((m) => !m.terrains.includes(t)),
  campVariantOf: (m) => (m.id === "forest-woods" ? { ...map("forest-woods-camp", ["forest"]), variant: "camp" } : null),
};

const tick = () => new Promise((resolve) => setImmediate(resolve));
const PREFS = `${MODULE}.${SETTINGS.prefs}`;

/** A picker that has drawn once: the library is in, and the promise it would answer is the `resolved` list. */
const open = (args = {}) => {
  const resolved = [];
  const app = new BattleMapPicker({ terrain: "forest", resolve: (v) => resolved.push(v), ...args });
  app._lib = lib;
  return { app, resolved };
};

before(() => { BattleMapPicker._current = null; });
beforeEach(() => {
  store = { [PREFS]: {} };
  writes = [];
  errors = [];
  scenes = [{ id: "s1", name: "The Keep", getFlag: () => undefined, thumb: null }, { id: "lib", name: "Encounter: Forest woods", getFlag: () => "forest-woods" }];
  user.isGM = true;
  Object.assign(globalThis.game.settings, { fail: false, failTimes: 0, latency: 0, inFlight: 0, mostInFlight: 0 });
});

describe("pick() is a promise for the choice", () => {
  test("closing the window without a choice answers null, and the picker is no longer the open one", async () => {
    const answer = BattleMapPicker.pick({ terrain: "forest" });
    await tick();
    const app = BattleMapPicker._current;
    assert.ok(app);
    assert.equal(app.renders, 1, "the window was drawn");
    await app.close();
    assert.equal(await answer, null);
    assert.equal(BattleMapPicker._current, null);
  });

  test("a second pick retires the first, which hears null", async () => {
    const first = BattleMapPicker.pick({ terrain: "forest" });
    await tick();
    const a = BattleMapPicker._current;
    const second = BattleMapPicker.pick({ terrain: "lake" });
    assert.equal(await first, null);
    await tick();
    assert.equal(a.closed, true);
    const b = BattleMapPicker._current;
    assert.notEqual(b, a);
    assert.equal(b._terrain, "lake");
    await b.close();
    assert.equal(await second, null);
  });

  test("a window that cannot draw answers null instead of leaving the caller waiting", async () => {
    const draw = ApplicationV2.prototype.render;
    const log = console.error;
    console.error = () => {};
    ApplicationV2.prototype.render = () => Promise.reject(new Error("no template"));
    try {
      assert.equal(await BattleMapPicker.pick({ terrain: "forest" }), null);
      assert.deepEqual(errors, ["SDE.encounterMaps.picker.openFailed"], "and says so");
    } finally {
      ApplicationV2.prototype.render = draw;
      console.error = log;
    }
  });

  test("a terrain handed over as the legend spells it is keyed like the module's own", () => {
    assert.equal(open({ terrain: "Arctic Sea" }).app._terrain, "arctic_sea");
  });

  test("the toggles start as the encounter says", () => {
    const { app } = open({ night: true, camping: true });
    assert.deepEqual([app._night, app._camp], [true, true]);
    assert.deepEqual([open().app._night, open().app._camp], [false, false]);
  });
});

describe("what a click does", () => {
  test("the starting map goes ahead on its first click, with the look the encounter seeded", async () => {
    const { app, resolved } = open({ night: true, camping: true });
    await app._onSelectMap(null, { dataset: { mapId: "forest-woods" } });
    assert.deepEqual(resolved, [{ mapId: "forest-woods", variant: "camp", night: true }]);
    assert.equal(app.closed, true);
    assert.equal(app.renders, 0, "nothing was redrawn on the way out");
  });

  test("any other map is chosen first and goes ahead on the second click, or the Use button", async () => {
    const { app, resolved } = open();
    await app._onSelectMap(null, { dataset: { mapId: "forest-road" } });
    assert.deepEqual(resolved, []);
    assert.equal(app.renders, 1);
    assert.deepEqual(app._selected, { mapId: "forest-road" });
    await app._onSelectMap(null, { dataset: { mapId: "forest-road" } });
    assert.deepEqual(resolved, [{ mapId: "forest-road", variant: "day", night: false }]);

    const again = open();
    await again.app._onSelectMap(null, { dataset: { mapId: "desert-dunes" } });
    await again.app._onConfirm();
    assert.deepEqual(again.resolved, [{ mapId: "desert-dunes", variant: "day", night: false }]);
  });

  test("a click right on the heels of another still counts: the choice is held before the window redraws", async () => {
    const { app, resolved } = open();
    app._onSelectMap(null, { dataset: { mapId: "forest-glade" } });
    await app._onSelectMap(null, { dataset: { mapId: "forest-glade" } });
    assert.deepEqual(resolved, [{ mapId: "forest-glade", variant: "day", night: false }]);
  });

  test("a scene answers {sceneId}; the library's own scenes are not offered", async () => {
    const { app, resolved } = open();
    assert.deepEqual(app._worldScenes().map((s) => s.id), ["s1"]);
    await app._onSelectScene(null, { dataset: { sceneId: "s1" } });
    assert.equal(resolved.length, 0);
    await app._onConfirm();
    assert.deepEqual(resolved, [{ sceneId: "s1" }]);
  });

  test("Day, Night, Camp and the terrain chip redraw and change what comes back", async () => {
    const { app, resolved } = open();
    await app._onSetNight(null, { dataset: { night: "true" } });
    await app._onToggleCamp();
    await app._onFilterTerrain(null, { dataset: { terrain: "desert" } });
    assert.equal(app.renders, 3);
    assert.equal(app._filter, "desert");
    await app._onConfirm();
    assert.deepEqual(resolved, [{ mapId: "forest-woods", variant: "camp", night: true }]);
    await app._onFilterTerrain(null, { dataset: {} });
    assert.equal(app._filter, "", "the All chip");
  });

  test("with nothing to confirm, Use does nothing", async () => {
    const { app, resolved } = open({ terrain: "volcano" });
    await app._onConfirm();
    assert.deepEqual(resolved, []);
    assert.equal(app.closed, false);
  });

  test("Cancel answers null", async () => {
    const { app, resolved } = open();
    await app._onCancel();
    assert.deepEqual(resolved, [null]);
    assert.equal(app.closed, true);
  });

  test("the first answer is the only one: closing after a choice does not take it back", async () => {
    const { app, resolved } = open();
    await app._onConfirm();
    await app.close();
    assert.deepEqual(resolved, [{ mapId: "forest-woods", variant: "day", night: false }]);
  });

  test("typing in the search hides the scenes that do not match, in place", () => {
    const rows = ["Black Mine", "The Keep"].map((name) => ({ dataset: { name }, hidden: false }));
    const none = { hidden: true };
    const { app } = open();
    app.element = { querySelectorAll: () => rows, querySelector: () => none };
    app._query = "keep";
    app._filterScenes();
    assert.deepEqual(rows.map((r) => r.hidden), [true, false]);
    assert.equal(none.hidden, true, "something matches, so no 'no match' line");
    app._query = "zzz";
    app._filterScenes();
    assert.deepEqual(rows.map((r) => r.hidden), [true, true]);
    assert.equal(none.hidden, false);
    app._query = "";
    app._filterScenes();
    assert.deepEqual(rows.map((r) => r.hidden), [false, false]);
  });
});

describe("the GM's switches", () => {
  test("pinning writes the whole saved value; the pin on the pinned map takes the pin off, which is random", async () => {
    store[PREFS] = { lake: { pinned: null, disabled: ["lake-calm"] } };
    const { app } = open();
    await app._onPinMap(null, { dataset: { mapId: "forest-road" } });
    assert.deepEqual(writes, [[MODULE, "encounterMapPrefs", {
      lake: { pinned: null, disabled: ["lake-calm"] },
      forest: { pinned: "forest-road", disabled: [] },
    }]]);
    assert.equal(app.renders, 1);
    await app._onPinMap(null, { dataset: { mapId: "forest-road" } });
    // The entry stays: no pin that is saved is how the library knows the GM chose random.
    assert.deepEqual(writes[1][2], { lake: { pinned: null, disabled: ["lake-calm"] }, forest: { pinned: null, disabled: [] } });
  });

  test("the key it writes is the one the rest of the feature reads", async () => {
    const { app } = open();
    await app._onToggleMap(null, { dataset: { mapId: "forest-glade" } });
    assert.equal(writes[0][1], SETTINGS.prefs);
  });

  test("switching a map off, and on again; switching off the pinned one moves the pin to the first map still on", async () => {
    store[PREFS] = { forest: { pinned: "forest-woods", disabled: ["forest-glade"] } };
    const { app } = open();
    await app._onToggleMap(null, { dataset: { mapId: "forest-glade" } });
    assert.deepEqual(writes[0][2], { forest: { pinned: "forest-woods", disabled: [] } });
    await app._onToggleMap(null, { dataset: { mapId: "forest-woods" } });
    assert.deepEqual(writes[1][2], { forest: { pinned: "forest-road", disabled: ["forest-woods"] } });
  });

  test("switching a map off with nothing saved writes the default the GM sees, so it does not turn random", async () => {
    const { app } = open();
    await app._onToggleMap(null, { dataset: { mapId: "forest-road" } });
    assert.deepEqual(writes[0][2], { forest: { pinned: "forest-woods", disabled: ["forest-road"] } });
  });

  test("pinning a map that is off switches it on", async () => {
    store[PREFS] = { forest: { pinned: null, disabled: ["forest-glade"] } };
    const { app } = open();
    await app._onPinMap(null, { dataset: { mapId: "forest-glade" } });
    assert.deepEqual(writes[0][2], { forest: { pinned: "forest-glade", disabled: [] } });
  });

  test("Pick at random saves no pin on purpose, and turning it off pins the first map that is on", async () => {
    const { app } = open();
    await app._onToggleRandom();
    assert.deepEqual(writes[0][2], { forest: { pinned: null, disabled: [] } });
    assert.equal(app.renders, 1);
    await app._onToggleRandom();
    assert.deepEqual(writes[1][2], { forest: { pinned: "forest-woods", disabled: [] } });
    // From a pin, it goes to random; the off list is kept.
    store[PREFS] = { forest: { pinned: "forest-road", disabled: ["forest-glade"] } };
    await app._onToggleRandom();
    assert.deepEqual(writes[2][2], { forest: { pinned: null, disabled: ["forest-glade"] } });
  });

  test("two switches made inside one round trip are both kept: each is worked out when its turn comes", async () => {
    globalThis.game.settings.latency = 5;
    const { app } = open();
    // Neither has been answered when the other is pressed, so a read made at press time would be the old value for both.
    await Promise.all([
      app._onToggleMap(null, { dataset: { mapId: "forest-road" } }),
      app._onToggleMap(null, { dataset: { mapId: "forest-glade" } }),
    ]);
    assert.deepEqual(store[PREFS], { forest: { pinned: "forest-woods", disabled: ["forest-road", "forest-glade"] } });
    assert.equal(writes.length, 2);
    // The second write is built on the first, not on the value that was there before it.
    assert.deepEqual(writes[1][2].forest.disabled, ["forest-road", "forest-glade"]);
  });

  test("a pin and a switch made together keep each other", async () => {
    globalThis.game.settings.latency = 5;
    const { app } = open();
    await Promise.all([
      app._onPinMap(null, { dataset: { mapId: "forest-glade" } }),
      app._onToggleMap(null, { dataset: { mapId: "forest-road" } }),
      app._onToggleRandom(),
    ]);
    // Pinned the glade, switched the road off, then asked for random.
    assert.deepEqual(store[PREFS], { forest: { pinned: null, disabled: ["forest-road"] } });
    assert.equal(app.renders, 3, "each change drew what was saved when its turn was over");
  });

  test("saves go one after another, never two at once", async () => {
    globalThis.game.settings.latency = 3;
    const { app } = open();
    await Promise.all(["forest-woods", "forest-road", "forest-glade", "forest-road"]
      .map((mapId) => app._onToggleMap(null, { dataset: { mapId } })));
    assert.equal(globalThis.game.settings.mostInFlight, 1);
    assert.equal(writes.length, 4);
    // Road off, then on again by the last press: a second press is a toggle from what the first left.
    assert.deepEqual(store[PREFS].forest.disabled, ["forest-woods", "forest-glade"]);
  });

  test("the line is shared by every picker, so a window opened over another cannot cross its writes", async () => {
    globalThis.game.settings.latency = 5;
    const a = open().app;
    const b = open().app;
    await Promise.all([
      a._onToggleMap(null, { dataset: { mapId: "forest-road" } }),
      b._onToggleMap(null, { dataset: { mapId: "forest-glade" } }),
    ]);
    assert.deepEqual(store[PREFS].forest.disabled, ["forest-road", "forest-glade"]);
  });

  test("a save that is refused does not hold up the one behind it", async () => {
    globalThis.game.settings.latency = 1;
    globalThis.game.settings.failTimes = 1;
    const log = console.error;
    console.error = () => {};
    try {
      const { app } = open();
      await Promise.all([
        app._onToggleMap(null, { dataset: { mapId: "forest-road" } }),
        app._onToggleMap(null, { dataset: { mapId: "forest-glade" } }),
      ]);
      assert.deepEqual(errors, ["SDE.encounterMaps.picker.saveFailed"], "the refused one said so");
      assert.deepEqual(store[PREFS], { forest: { pinned: "forest-woods", disabled: ["forest-glade"] } }, "and the next went through");
      // The line still works afterwards.
      await app._onToggleMap(null, { dataset: { mapId: "forest-woods" } });
      assert.equal(writes.length, 2);
    } finally {
      console.error = log;
    }
  });

  test("turning a map back on after every map was off pins it: random is only ever asked for", async () => {
    store[PREFS] = { forest: { pinned: null, disabled: ["forest-woods", "forest-road", "forest-glade"] } };
    const { app } = open();
    await app._onToggleMap(null, { dataset: { mapId: "forest-road" } });
    assert.deepEqual(writes[0][2], { forest: { pinned: "forest-road", disabled: ["forest-woods", "forest-glade"] } });
    // With another map still off, the pin stays where it is when a second map comes back.
    await app._onToggleMap(null, { dataset: { mapId: "forest-glade" } });
    assert.deepEqual(writes[1][2], { forest: { pinned: "forest-road", disabled: ["forest-woods"] } });
  });

  test("a player writes nothing", async () => {
    user.isGM = false;
    const { app } = open();
    await app._onPinMap(null, { dataset: { mapId: "forest-road" } });
    await app._onToggleMap(null, { dataset: { mapId: "forest-road" } });
    await app._onToggleRandom();
    assert.deepEqual(writes, []);
  });

  test("with no terrain there is nothing to pin for", async () => {
    const { app } = open({ terrain: "" });
    await app._onPinMap(null, { dataset: { mapId: "forest-road" } });
    await app._onToggleRandom();
    assert.deepEqual(writes, []);
  });

  test("with random chosen the picker starts on nothing; one click picks a map and a second goes ahead", async () => {
    store[PREFS] = { forest: { pinned: null, disabled: [] } };
    const { app, resolved } = open();
    await app._onConfirm();
    assert.deepEqual(resolved, [], "nothing is chosen yet");
    await app._onSelectMap(null, { dataset: { mapId: "forest-road" } });
    assert.deepEqual(resolved, []);
    await app._onConfirm();
    assert.deepEqual(resolved, [{ mapId: "forest-road", variant: "day", night: false }]);
  });

  test("a save that is refused says so and still shows what is saved", async () => {
    globalThis.game.settings.fail = true;
    const log = console.error;
    console.error = () => {};
    try {
      const { app } = open();
      await app._onPinMap(null, { dataset: { mapId: "forest-road" } });
      assert.deepEqual(errors, ["SDE.encounterMaps.picker.saveFailed"]);
      assert.ok(en["SDE.encounterMaps.picker.saveFailed"]);
      assert.equal(app.renders, 1);
    } finally {
      console.error = log;
    }
  });
});

describe("the window's options", () => {
  const options = BattleMapPicker.DEFAULT_OPTIONS;

  test("it wears the kit, names its title from en.json and points at a template that exists", () => {
    assert.ok(options.classes.includes("sde-ui"));
    assert.ok(en[options.window.title], options.window.title);
    const template = BattleMapPicker.PARTS.body.template.replace(`modules/${MODULE}/`, "");
    assert.ok(existsSync(new URL(`../${template}`, import.meta.url)), template);
    assert.deepEqual(BattleMapPicker.PARTS.body.scrollable, [".ui-body"]);
  });

  test("its stylesheet is in the manifest, after the kit it builds on", () => {
    const manifest = JSON.parse(read("module.json"));
    const sources = manifest.styles.map((s) => s.src);
    assert.ok(sources.includes("styles/encounter-maps.css"));
    assert.ok(sources.indexOf("styles/encounter-maps.css") > sources.indexOf("styles/sde-ui.css"));
    assert.ok(existsSync(new URL("../styles/encounter-maps.css", import.meta.url)));
    assert.ok(read("styles/encounter-maps.css").includes(".sde-battle-map-picker"), "scoped to the window's own class");
    assert.ok(options.classes.includes("sde-battle-map-picker"));
  });

  test("the stylesheet writes no colour of its own", () => {
    const css = read("styles/encounter-maps.css").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});

describe("the template", () => {
  const template = read("templates/encounter-maps/picker.hbs");

  test("every action in it has a handler, and every handler a button", () => {
    const used = new Set([...template.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), Object.keys(BattleMapPicker.DEFAULT_OPTIONS.actions).sort());
    for (const handler of Object.values(BattleMapPicker.DEFAULT_OPTIONS.actions)) assert.equal(typeof handler, "function");
  });

  test("no English is written into it: text and labels come from en.json", () => {
    const bare = template.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
    const text = bare.replace(/\{\{[\s\S]*?\}\}/g, "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, "");
    assert.doesNotMatch(text, /[A-Za-z]/, "text outside {{ }}");
    for (const [, attr, value] of bare.matchAll(/\b(aria-label|placeholder|title|alt|data-tooltip)="([^"]*)"/g)) {
      assert.equal(value.replace(/\{\{[\s\S]*?\}\}/g, "").trim(), "", `${attr}="${value}"`);
    }
  });

  test("one primary button, and the picture lists load lazily", () => {
    assert.equal(template.match(/class="ui-btn primary"/g)?.length, 1);
    for (const img of template.match(/<img [^>]*>/g)) assert.match(img, /loading="lazy"/);
  });

  test("every key it asks for by name is in en.json", () => {
    const keys = [...template.matchAll(/['"](SDE\.[A-Za-z0-9_.]+)['"]/g)].map((m) => m[1]);
    assert.ok(keys.length > 10);
    assert.deepEqual(keys.filter((k) => !(k in en)), []);
  });
});

describe("the settings", () => {
  const source = read("scripts/shared/settings.mjs");
  const registration = (key) => source.match(new RegExp(`game\\.settings\\.register\\(MODULE_ID, "${key}", \\{([\\s\\S]*?)\\n  \\}\\);`))?.[1];

  test("they are registered under the keys the rest of the feature reads", () => {
    assert.ok(registration(SETTINGS.prefs), `${SETTINGS.prefs} is registered`);
    assert.ok(registration(SETTINGS.preload), `${SETTINGS.preload} is registered`);
  });

  test("the saved choices are a hidden world object, empty to begin with", () => {
    const body = registration(SETTINGS.prefs);
    assert.match(body, /scope: "world"/);
    assert.match(body, /config: false/);
    assert.match(body, /type: Object/);
    assert.match(body, /default: \{\}/);
  });

  test("the preload switch is a world setting in Configure Settings, on by default, with words", () => {
    const body = registration(SETTINGS.preload);
    assert.match(body, /scope: "world"/);
    assert.match(body, /config: true/);
    assert.match(body, /type: Boolean/);
    assert.match(body, /default: true/);
    assert.ok(en[`SDE.settings.${SETTINGS.preload}.name`]);
    assert.ok(en[`SDE.settings.${SETTINGS.preload}.hint`]);
  });
});

describe("the module's wiring", () => {
  const entry = read("scripts/shadowdark-enhancer.mjs");

  test("the API has an encounterMaps namespace of five calls, each loading its part on first use", () => {
    const body = entry.match(/\n {4}encounterMaps: \{([\s\S]*?)\n {4}\},\n/)?.[1];
    assert.ok(body, "encounterMaps is a top-level key of the API");
    for (const call of ["open", "pick", "current", "bringTable", "returnToTravel"]) {
      assert.match(body, new RegExp(`\\n {6}${call}: async`), call);
    }
    assert.match(body, /battle-actions\.mjs"\)\)\.openBattleMap\(opts\)/);
    assert.match(body, /battle-map-picker\.mjs"\)\)\.BattleMapPicker\.pick\(opts\)/);
    assert.match(body, /encounter-battle\.mjs"\)\)\.BattleMaps\.current\(\)/);
    assert.ok(!/^import .*battle-maps/m.test(entry), "nothing from the feature is loaded with the module");
  });

  test("the wiring says exactly what it guards, and does not claim a missing file cannot break load", () => {
    const lines = entry.match(/\/\/ Encounter battle maps\. Each of the two registrations[\s\S]*?\nasync function wireBattleMaps/)?.[0];
    assert.ok(lines, "the wiring is commented");
    const comment = lines.replace(/\s*\/\/\s*/g, " ");
    assert.doesNotMatch(comment, /cannot break|can't break|must not break/i);
    assert.match(comment, /dynamic import in a try of its own/);
    assert.match(comment, /overland-bar\.mjs and encounter-draw\.mjs import battle-actions\.mjs and its core statically/);
  });

  test("those two files do import battle-actions statically, so what the comment says is still so", () => {
    for (const file of ["scripts/overland/overland-bar.mjs", "scripts/encounter/encounter-draw.mjs"]) {
      assert.match(read(file), /from "\.\.?\/(?:encounter\/)?battle-maps\/battle-actions\.mjs";/, file);
    }
  });

  test("the picker file the API loads exists", () => {
    assert.ok(existsSync(new URL("../scripts/encounter/battle-maps/battle-map-picker.mjs", import.meta.url)));
  });

  test("each registration is a dynamic import in a try of its own that logs", () => {
    const body = entry.match(/\nasync function wireBattleMaps\(name, load\) \{([\s\S]*?)\n\}\n/)?.[1];
    assert.ok(body, "wireBattleMaps is a function of the module, not of a hook");
    assert.match(body, /try \{[\s\S]*\(await load\(\)\)\[name\]\(\)[\s\S]*\} catch \(err\) \{[\s\S]*console\.error\(`\$\{MODULE_ID\} \| /);
  });

  test("the preload socket is wired at setup, and its file's import starts at module load", () => {
    assert.match(entry, /\nconst preloadSocket = import\("\.\/encounter\/battle-maps\/encounter-preload\.mjs"\);\n/);
    // A rejection nobody has awaited yet is not an unhandled one: wireBattleMaps logs it when setup reaches it.
    assert.match(entry, /\npreloadSocket\.catch\(\(\) => \{\}\);/);
    assert.match(entry, /\nHooks\.once\("setup", \(\) => wireBattleMaps\("registerPreloadSocket", \(\) => preloadSocket\)\);\n/);
  });

  test("and only there: the ready hook does not wire it again, and it wires the chat buttons", () => {
    const ready = entry.slice(entry.indexOf('Hooks.once("ready", () => {\n  console.log(`${MODULE_ID} | ready`);'));
    assert.ok(ready.length > 1000, "the module's ready hook");
    assert.doesNotMatch(ready, /registerPreloadSocket|encounter-preload\.mjs/);
    assert.match(ready, /\n {2}wireBattleMaps\("registerBattleChatButtons", \(\) => import\("\.\/encounter\/battle-maps\/battle-actions\.mjs"\)\);/);
    assert.ok(entry.indexOf('Hooks.once("setup"') < entry.indexOf('Hooks.once("ready", () => {\n  console.log'), "setup comes first");
  });

  test("the comment gives the reason it is early, and what makes it safe", () => {
    const lines = entry.match(/\/\/ The preload readout answers on EVERY client[\s\S]*?\nconst preloadSocket/)?.[0];
    assert.ok(lines, "the setup wiring is commented");
    const comment = lines.replace(/\s*\/\/\s*/g, " ");
    assert.match(comment, /replays the socket events it buffered while the game loaded/);
    assert.match(comment, /Game#activateSocketListeners/);
    assert.match(comment, /the server announces a user the moment their socket opens/);
    assert.match(comment, /A listener added at `ready` would miss it/);
    assert.match(comment, /Registering reads no setting and no user/);
    assert.match(comment, /delivered twice \(live, then replayed\)/);
  });

  test("registering the preload socket reads no setting and no user, only a message that arrives does", () => {
    // What makes setup safe: at setup the game's settings and users are not all there, and nothing here needs them.
    const code = read("scripts/encounter/battle-maps/encounter-preload.mjs");
    const body = code.match(/\nexport function registerPreloadSocket\(\) \{([\s\S]*?)\n\}\n/)?.[1];
    assert.ok(body, "registerPreloadSocket");
    assert.deepEqual(body.match(/\bgame\.\w+/g)?.filter((ref) => ref !== "game.socket"), [], "nothing but the socket");
    assert.match(body, /game\.socket\.on\(SOCKET, /);
  });
});
