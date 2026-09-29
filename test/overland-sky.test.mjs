// The sky on scenes (#235, Overland O9): darkness by the sun and moon, the
// weather effect, the Isles of Andrik, and who may write a scene's darkness.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FAIR_DAY_EFFECT, HEX_MAP_CAP, darknessAt, darknessMoved, followsSky, nightWithOverride, skyOverride, skyScenes, weatherEffect, weatherPlan,
} from "../scripts/overland/sky-core.mjs";

const SUN = { sunrise: 6, sunset: 18 };

test("darkness: 0 by day, a one-hour twilight each way, and the moon lightens the night", () => {
  assert.equal(darknessAt({ hour: 12, ...SUN, illumination: 1 }), 0);
  assert.equal(darknessAt({ hour: 18, ...SUN, illumination: 1 }), 0, "at sunset");
  assert.equal(darknessAt({ hour: 18.5, ...SUN, illumination: 1 }), 0.4, "halfway through twilight, full moon");
  assert.equal(darknessAt({ hour: 21, ...SUN, illumination: 1 }), 0.8, "a full-moon night");
  assert.equal(darknessAt({ hour: 21, ...SUN, illumination: 0 }), 1, "a new-moon night");
  assert.equal(darknessAt({ hour: 5.5, ...SUN, illumination: 0 }), 0.5, "half an hour before sunrise");
  assert.equal(darknessAt({ hour: 21, ...SUN, illumination: 0, cap: HEX_MAP_CAP }), 0.6, "the hex map stops at its cap");
});

test("the Isles of Andrik: the Midnight Sun in spring and summer, the Long Dark in winter", () => {
  assert.equal(skyOverride("Isles of Andrik", "summer"), "midnightSun");
  assert.equal(skyOverride("The Isles of Andrik", "spring"), "midnightSun");
  assert.equal(skyOverride("isles of andrik", "winter"), "longDark");
  assert.equal(skyOverride("Isles of Andrik", "autumn"), null);
  assert.equal(skyOverride("Lowland Moor", "winter"), null);
  assert.equal(darknessAt({ hour: 23, ...SUN, illumination: 0, override: "midnightSun" }), 0.3, "never above 0.3");
  assert.equal(darknessAt({ hour: 12, ...SUN, illumination: 1, override: "longDark" }), 0.8, "night all day");
  assert.equal(nightWithOverride(true, "midnightSun"), false);
  assert.equal(nightWithOverride(false, "longDark"), true);
  assert.equal(nightWithOverride(true, null), true);
});

test("the weather effect: a rain storm, a blizzard in the cold, else none", () => {
  assert.equal(weatherEffect({ kind: "stormy", climate: "Scorching" }), "rainStorm");
  assert.equal(weatherEffect({ kind: "stormy", climate: "Freezing" }), "blizzard");
  assert.equal(weatherEffect({ kind: "stormy", climate: "Cold" }), "blizzard");
  assert.equal(weatherEffect({ kind: "stormy" }), "rainStorm", "no climate known");
  assert.equal(weatherEffect({ kind: null, climate: "Freezing" }), "", "no weather today");
  assert.equal(weatherEffect({ climate: "Freezing" }), "");
});

test("fair days show the season: snow in winter, leaves in autumn, nothing else (#294)", () => {
  assert.deepEqual(FAIR_DAY_EFFECT, { winter: "snow", autumn: "leaves", spring: "", summer: "" }, "the table, one line per season");
  for (const [season, effect] of Object.entries(FAIR_DAY_EFFECT)) {
    assert.equal(weatherEffect({ kind: "fair", season }), effect, `fair ${season}`);
    assert.equal(weatherEffect({ kind: "excellent", season }), "", `excellent ${season} shows nothing`);
  }
  assert.equal(weatherEffect({ kind: "fair", season: null }), "", "no season known");
  assert.equal(weatherEffect({ kind: "fair", season: "monsoon" }), "", "a season the table lacks");
  assert.equal(weatherEffect({ kind: "fair", season: "toString" }), "", "nothing inherited from Object");
  assert.equal(weatherEffect({ kind: "fair", season: "winter", climate: "Freezing" }), "snow", "a fair day is never a blizzard");
  assert.equal(weatherEffect({ kind: "stormy", season: "summer", climate: "Cold" }), "blizzard", "a storm ignores the season");
  assert.equal(weatherEffect({ kind: "stormy", season: "winter" }), "rainStorm");
});

test("weather ownership: Overland changes only what it put there, takes an empty slot, and lets go when someone else changes it (#251 review)", () => {
  assert.deepEqual(weatherPlan({ current: "", owned: null, effect: "rainStorm" }), { weather: "rainStorm", own: "rainStorm" }, "an empty slot");
  assert.deepEqual(weatherPlan({ current: "rainStorm", owned: "rainStorm", effect: "" }), { weather: "", own: null }, "its own storm passes");
  assert.deepEqual(weatherPlan({ current: "blizzard", owned: "blizzard", effect: "rainStorm" }), { weather: "rainStorm", own: "rainStorm" });
  assert.deepEqual(weatherPlan({ current: "rainStorm", owned: "rainStorm", effect: "rainStorm" }), {}, "no change");
  assert.deepEqual(weatherPlan({ current: "rainStorm", owned: null, effect: "" }), {}, "a GM's rain storm stays");
  assert.deepEqual(weatherPlan({ current: "blizzard", owned: null, effect: "rainStorm" }), {}, "a GM's blizzard stays through our storm");
  assert.deepEqual(weatherPlan({ current: "fog", owned: "rainStorm", effect: "" }), { own: null }, "someone changed it: let go");
  assert.deepEqual(weatherPlan({ current: "", owned: "rainStorm", effect: "rainStorm" }), { own: null }, "someone cleared it: let go");
  assert.deepEqual(weatherPlan({ current: "", owned: null, effect: "" }), {});
});

test("which scenes follow the sky", () => {
  assert.equal(followsSky(undefined, true), true, "a hex map by default");
  assert.equal(followsSky("default", false), false, "a dungeon by default");
  assert.equal(followsSky("on", false), true);
  assert.equal(followsSky("off", true), false);
  assert.equal(darknessMoved(0.4, 0.41), false);
  assert.equal(darknessMoved(0.4, 0.42), true);
});

test("skyScenes: the active scene and the party's scene, once each, only those that follow the sky", () => {
  const dungeon = { id: "d", follows: false };
  const hexMap = { id: "h", follows: true };
  const follows = (s) => s.follows;
  assert.deepEqual(skyScenes({ active: dungeon, travel: hexMap, follows }), [hexMap], "the party's map, not the dungeon");
  assert.deepEqual(skyScenes({ active: hexMap, travel: hexMap, follows }), [hexMap], "the same scene once");
  assert.equal(skyScenes({ active: hexMap, travel: { id: "h", follows: true }, follows }).length, 1, "the same id once");
  assert.deepEqual(skyScenes({ active: hexMap, travel: dungeon, follows }), [hexMap], "a travel scene that does not follow is left out");
  assert.deepEqual(skyScenes({ active: null, travel: null, follows }), [], "no scenes");
  assert.deepEqual(skyScenes({ active: null, travel: hexMap, follows }), [hexMap], "nothing active");
});

// ── The writes, against a stubbed scene ───────────────────────────────────────

const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const { gregorian, at } = await import("./gregorian-calendar.mjs");
const stored = {};
// Foundry 14's forced-deletion operator, a global in the client.
const DEL = Symbol("_del");
globalThis._del = DEL;
const gm = { id: "gm", isGM: true };
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {} } },
  game: {
    user: gm, users: { activeGM: gm },
    // Foundry throws for a setting nobody registered; so does this stub (#255).
    settings: {
      get: (ns, key) => {
        if (ns !== "shadowdark-enhancer") throw new Error(`"${ns}.${key}" is not a registered game setting`);
        return stored[key];
      },
      set: async () => {},
    },
    socket: { emit() {}, on() {} },
    time: { worldTime: at(1301, 6, 21, 21), calendar: gregorian },
    i18n: { localize: (k) => k, format: (k) => k },
    modules: { get: () => null },
    actors: { get: () => null, filter: () => [] },
  },
});
const { applySky, applySkies, applyWeatherVisuals, onDrawWeatherEffects, registerSky, registerWeatherVisuals } = await import("../scripts/overland/sky.mjs");
const { registerOverland, OVERLAND_CHANGED } = await import("../scripts/overland/overland.mjs");

/** A stubbed Scene that keeps its flags and applies its updates, so a reload is a fresh stub with the same data. */
function scene({ hex = true, follows, darkness = 0, locked = false, weather = "", owned, id = "s" } = {}) {
  const writes = [];
  const flags = { hexTags: hex ? { origin: {} } : null, followsSky: follows, skyWeather: owned };
  const doc = {
    writes, weather, flags, id,
    grid: { isHexagonal: hex },
    environment: { darknessLevel: darkness, darknessLock: locked },
    // Foundry 14 throws for a scope that isn't an active module; so does this stub (#255).
    getFlag: (ns, key) => {
      if (ns !== "shadowdark-enhancer") throw new Error(`Flag scope "${ns}" is not valid or not currently active`);
      return flags[key];
    },
    async update(changes, options) {
      writes.push({ changes, options });
      if ("weather" in changes) doc.weather = changes.weather;
      if ("environment.darknessLevel" in changes) doc.environment.darknessLevel = changes["environment.darknessLevel"];
      if ("flags.shadowdark-enhancer.skyWeather" in changes) flags.skyWeather = changes["flags.shadowdark-enhancer.skyWeather"];
      if (changes["flags.shadowdark-enhancer.skyWeather"] === DEL) delete flags.skyWeather;
    },
  };
  return doc;
}
function sky({ season = "summer", region = "Lowland Moor", weather = null, climate = null } = {}) {
  stored.overlandState = { hex: { num: 1, terrain: "forest", region, features: [] }, weather };
  registerOverland();
  globalThis.game.shadowdarkEnhancer = {
    time: { season: () => ({ key: season }), sun: () => SUN, moonPhase: () => ({ illumination: 1 }), isNight: () => false },
    rules: { climate: () => (climate ? { label: climate, harsh: "" } : null) },
  };
}

test("the active GM darkens a hex map at night to its cap, animated for a short step", async () => {
  sky();
  const s = scene();
  await applySky(s, { dt: 60 });
  assert.deepEqual(s.writes, [{ changes: { "environment.darknessLevel": 0.6 }, options: { animateDarkness: 2000 } }]);
  const again = scene({ darkness: 0.6 });
  await applySky(again, { dt: 60 });
  assert.deepEqual(again.writes, [], "no change, no write");
  const jump = scene();
  await applySky(jump, { dt: 86400 });
  assert.deepEqual(jump.writes[0].options, {}, "a long jump isn't animated");
});

test("a dungeon, a locked scene and another GM are left alone; no other module is consulted", async () => {
  sky();
  const dungeon = scene({ hex: false });
  await applySky(dungeon);
  assert.deepEqual(dungeon.writes, []);
  const outdoors = scene({ hex: false, follows: "on" });
  await applySky(outdoors);
  assert.equal(outdoors.writes[0].changes["environment.darknessLevel"], 0.8, "marked outdoors: no cap");
  const locked = scene({ locked: true });
  await applySky(locked);
  assert.deepEqual(locked.writes, []);
  try {
    globalThis.game.modules = { get: (id) => (id === "calendaria" ? { active: true } : null) };
    const other = scene();
    await applySky(other);
    assert.equal(other.writes.length, 1, "another calendar module, on or off, changes nothing");
    globalThis.game.modules = { get: () => null };
    globalThis.game.users.activeGM = { id: "other" };
    const notMine = scene();
    await applySky(notMine);
    assert.deepEqual(notMine.writes, []);
  } finally {
    globalThis.game.modules = { get: () => null };
    globalThis.game.users.activeGM = gm;
  }
});

const STORMY = { kind: "stormy", roll: 1, rule: "western", until: at(1301, 6, 22, 5), advantageNext: false, advantage: false, days: null };

test("Overland's own storm: it takes an empty slot, records it, changes it with the cold, and clears it after", async () => {
  sky({ weather: STORMY, climate: "Temperate" });
  const s = scene({ darkness: 0.6 });
  await applySky(s);
  assert.deepEqual(s.writes[0].changes, { weather: "rainStorm", "flags.shadowdark-enhancer.skyWeather": "rainStorm" },
    "the effect and its record in one update");
  sky({ weather: STORMY, climate: "Freezing" });
  await applySky(s);
  assert.deepEqual(s.writes[1].changes, { weather: "blizzard", "flags.shadowdark-enhancer.skyWeather": "blizzard" });
  sky();
  await applySky(s);
  assert.deepEqual(s.writes[2].changes, { weather: "", "flags.shadowdark-enhancer.skyWeather": DEL }, "the storm passed");
  assert.equal(s.flags.skyWeather, undefined);
});

test("the record survives a reload: a fresh load still clears Overland's own storm (#251 review)", async () => {
  sky();
  const reloaded = scene({ darkness: 0.6, weather: "rainStorm", owned: "rainStorm" });
  await applySky(reloaded);
  assert.deepEqual(reloaded.writes[0].changes, { weather: "", "flags.shadowdark-enhancer.skyWeather": DEL });
});

test("a GM's own rain storm, blizzard or fog is never touched, on load or during Overland's storm (#251 review)", async () => {
  sky();
  for (const weather of ["rainStorm", "blizzard", "fog"]) {
    const s = scene({ darkness: 0.6, weather });
    await applySky(s);
    assert.deepEqual(s.writes, [], `${weather}, no Overland storm`);
  }
  sky({ weather: STORMY, climate: "Temperate" });
  const gmBlizzard = scene({ darkness: 0.6, weather: "blizzard" });
  await applySky(gmBlizzard);
  assert.deepEqual(gmBlizzard.writes, [], "a GM's blizzard through Overland's rain storm");
});

test("when someone else changes Overland's effect, Overland lets it go and leaves theirs (#251 review)", async () => {
  sky({ weather: STORMY, climate: "Temperate" });
  const s = scene({ darkness: 0.6, weather: "fog", owned: "rainStorm" });
  await applySky(s);
  assert.deepEqual(s.writes[0].changes, { "flags.shadowdark-enhancer.skyWeather": DEL });
  assert.equal(s.weather, "fog");
  sky();
  await applySky(s);
  assert.equal(s.writes.length, 1, "and never touches it again");
});

test("twilight follows the calendar's own hours: a 100-minute hour (#251 review)", async () => {
  sky();
  const saved = globalThis.game.time.calendar;
  globalThis.game.time.calendar = { days: { hoursPerDay: 24, minutesPerHour: 100, secondsPerMinute: 60 } };
  globalThis.game.time.worldTime = 18.5 * 100 * 60;             // 18:50 on this clock, halfway through twilight
  const s = scene({ hex: false, follows: "on" });
  await applySky(s);
  globalThis.game.time.calendar = saved;
  assert.equal(s.writes[0].changes["environment.darknessLevel"], 0.4);
});

test("on the Isles of Andrik the winter noon is night, and the summer night stays light", async () => {
  sky({ season: "winter", region: "Isles of Andrik" });
  globalThis.game.time.worldTime = at(1301, 6, 21, 12);
  const noon = scene({ hex: false, follows: "on" });
  await applySky(noon);
  assert.equal(noon.writes[0].changes["environment.darknessLevel"], 0.8, "the Long Dark");
  sky({ season: "summer", region: "Isles of Andrik" });
  globalThis.game.time.worldTime = at(1301, 6, 21, 23);
  const night = scene({ hex: false, follows: "on" });
  await applySky(night);
  assert.equal(night.writes[0].changes["environment.darknessLevel"], 0.3, "the Midnight Sun");
});

test("Show weather effects: off clears this client's effects, also after a redraw; on puts them back with no redraw (#294)", () => {
  const RAIN = { id: "rainStorm" };
  const calls = [];
  const layer = {
    initializeEffects: (config) => calls.push(["init", config]),
    clearEffects: () => calls.push(["clear"]),
  };
  const savedEffects = globalThis.CONFIG.weatherEffects;
  globalThis.CONFIG.weatherEffects = { rainStorm: RAIN };
  globalThis.canvas = { ready: true, scene: { weather: "rainStorm" }, weather: layer, draw: () => calls.push(["draw"]) };
  try {
    stored.weatherVisuals = false;
    applyWeatherVisuals();
    assert.deepEqual(calls.splice(0), [["clear"]], "turned off: cleared, no redraw");
    onDrawWeatherEffects(layer);                                  // a weather change redrew the scene
    assert.deepEqual(calls.splice(0), [["clear"]], "still cleared after the redraw");
    assert.equal(globalThis.canvas.scene.weather, "rainStorm", "the scene's own weather is untouched");
    stored.weatherVisuals = true;
    onDrawWeatherEffects(layer);
    assert.deepEqual(calls.splice(0), [], "on: the drawn effect stays");
    applyWeatherVisuals();
    assert.deepEqual(calls.splice(0), [["init", RAIN]], "turned on: the scene's effect returns, no redraw");
    globalThis.canvas.scene.weather = "";
    applyWeatherVisuals();
    assert.deepEqual(calls.splice(0), [["init", undefined]], "no weather on the scene: nothing to draw");
    globalThis.canvas.ready = false;
    applyWeatherVisuals();
    assert.deepEqual(calls, [], "no canvas yet: nothing to do");
    delete stored.weatherVisuals;
    onDrawWeatherEffects(layer);
    assert.deepEqual(calls, [], "never set: on");
  } finally {
    globalThis.CONFIG.weatherEffects = savedEffects;
    delete globalThis.canvas;
    delete stored.weatherVisuals;
  }
});

test("Show weather effects is a client setting, on by default, and hooks drawWeatherEffects (#294)", () => {
  const registered = [];
  const hooks = [];
  const { settings, } = globalThis.game;
  const { on } = globalThis.Hooks;
  globalThis.game.settings = { ...settings, register: (ns, key, data) => registered.push([ns, key, data]) };
  globalThis.Hooks.on = (name, fn) => hooks.push([name, fn]);
  try {
    registerWeatherVisuals();
  } finally {
    globalThis.game.settings = settings;
    globalThis.Hooks.on = on;
  }
  assert.equal(registered.length, 1);
  const [ns, key, data] = registered[0];
  assert.deepEqual([ns, key, data.scope, data.config, data.type, data.default], ["shadowdark-enhancer", "weatherVisuals", "client", true, Boolean, true]);
  assert.equal(data.onChange, applyWeatherVisuals);
  assert.deepEqual(hooks.map(([name, fn]) => [name, fn]), [["drawWeatherEffects", onDrawWeatherEffects]]);
});

const FAIR = { ...STORMY, kind: "fair", roll: 3 };
const EXCELLENT = { ...STORMY, kind: "excellent", roll: 6 };

test("a fair day writes the season's effect and its record; a change of season is one write (#294)", async () => {
  sky({ season: "winter", weather: FAIR });
  const s = scene({ darkness: 0.6 });
  await applySky(s);
  assert.deepEqual(s.writes[0].changes, { weather: "snow", "flags.shadowdark-enhancer.skyWeather": "snow" });
  sky({ season: "autumn", weather: FAIR });
  await applySky(s);
  assert.equal(s.writes.length, 2, "snow to leaves is one write");
  assert.deepEqual(s.writes[1].changes, { weather: "leaves", "flags.shadowdark-enhancer.skyWeather": "leaves" });
  sky({ season: "autumn", weather: STORMY, climate: "Temperate" });
  await applySky(s);
  assert.deepEqual(s.writes[2].changes, { weather: "rainStorm", "flags.shadowdark-enhancer.skyWeather": "rainStorm" }, "leaves to a storm, one write");
  sky({ season: "autumn", weather: EXCELLENT });
  await applySky(s);
  assert.deepEqual(s.writes[3].changes, { weather: "", "flags.shadowdark-enhancer.skyWeather": DEL }, "an excellent day clears Overland's effect");
  sky({ season: "summer", weather: FAIR });
  const summer = scene({ darkness: 0.6 });
  await applySky(summer);
  assert.deepEqual(summer.writes, [], "a fair summer day shows nothing");
});

test("a GM's own effect is left alone on a fair day, and Overland's fair-day effect is cleared when the day ends (#294)", async () => {
  sky({ season: "winter", weather: FAIR });
  const gmRain = scene({ darkness: 0.6, weather: "rainStorm" });
  await applySky(gmRain);
  assert.deepEqual(gmRain.writes, [], "a GM's rain storm stays through Overland's snow");
  const gmSnow = scene({ darkness: 0.6, weather: "snow" });
  await applySky(gmSnow);
  assert.deepEqual(gmSnow.writes, [], "a GM's snow is not taken over or recorded");
  sky({ season: "winter" });
  const ours = scene({ darkness: 0.6, weather: "snow", owned: "snow" });
  await applySky(ours);
  assert.deepEqual(ours.writes[0].changes, { weather: "", "flags.shadowdark-enhancer.skyWeather": DEL }, "the day's weather is over");
});

test("the sky follows the party's scene: a storm on the hex map with a dungeon active (#294)", async () => {
  sky({ weather: STORMY, climate: "Temperate" });
  stored.overlandState.tokenUuid = "Scene.hex.Token.t";
  registerOverland();                                            // reads the state again, token included
  const dungeon = scene({ hex: false, id: "dungeon" });
  const hexMap = scene({ id: "hex" });
  globalThis.game.scenes = { active: dungeon };
  globalThis.fromUuidSync = (uuid) => (uuid === "Scene.hex.Token.t" ? { parent: hexMap } : null);
  try {
    await applySkies();
    assert.deepEqual(dungeon.writes, [], "the dungeon is untouched");
    assert.deepEqual(hexMap.writes.map((w) => w.changes), [{
      "environment.darknessLevel": 0.6, weather: "rainStorm", "flags.shadowdark-enhancer.skyWeather": "rainStorm",
    }], "darkness, the storm and its record in one write");
    globalThis.game.scenes = { active: hexMap };
    await applySkies();
    assert.equal(hexMap.writes.length, 1, "a travel scene that is also active is not written twice");
    const marked = scene({ hex: false, follows: "off", id: "off" });
    globalThis.fromUuidSync = () => ({ parent: marked });
    await applySkies();
    assert.deepEqual(marked.writes, [], "a travel scene that does not follow the sky is untouched");
    globalThis.fromUuidSync = () => null;
    globalThis.game.scenes = { active: dungeon };
    await applySkies();
    assert.equal(hexMap.writes.length, 1, "a token that cannot be found gives no travel scene");
  } finally {
    delete globalThis.game.scenes;
    delete globalThis.fromUuidSync;
  }
});

test("a scene whose update rejects does not stop the party's scene; the next pass converges (#295 review)", async () => {
  sky({ weather: STORMY, climate: "Temperate" });
  stored.overlandState.tokenUuid = "Scene.hex.Token.t";
  registerOverland();
  const log = console.error;
  console.error = () => {};
  try {
    for (const applied of [false, true]) {                       // rejected before saving, and after saving
      const hexMap = scene({ id: "hex" });
      globalThis.fromUuidSync = (uuid) => (uuid === "Scene.hex.Token.t" ? { parent: hexMap } : null);
      const active = scene({ id: "active" });
      const update = active.update;
      let failing = true;
      active.update = async (changes, options) => {
        if (!failing) return update(changes, options);
        if (applied) await update(changes, options);
        else active.writes.push({ changes, options });
        throw new Error("update rejected");
      };
      globalThis.game.scenes = { active };
      const first = await applySkies();
      assert.equal(active.writes.length, 1, "the active scene was tried once");
      assert.equal(first[0], null, "and reported nothing written");
      assert.equal(hexMap.writes.length, 1, "the party's scene was still written");
      failing = false;
      await applySkies();
      assert.equal(active.writes.length, applied ? 1 : 2, applied ? "already saved: nothing written again" : "the retry writes it once");
      assert.equal(hexMap.writes.length, 1, "the party's scene is not written twice");
    }
  } finally {
    console.error = log;
    delete globalThis.game.scenes;
    delete globalThis.fromUuidSync;
  }
});

test("a weather roll that lands while a sky pass is writing still reaches the scene (#295 review)", async () => {
  sky();
  const s = scene();
  let release;
  const gate = new Promise((r) => { release = r; });
  const update = s.update;
  s.update = async (changes, options) => { await update(changes, options); await gate; };
  globalThis.game.scenes = { active: s };
  const handlers = {};
  const { on } = globalThis.Hooks;
  globalThis.Hooks.on = (name, fn) => { handlers[name] = fn; };
  try {
    registerSky();                                               // the ready pass writes darkness and waits
    assert.equal(s.writes.length, 1);
    stored.overlandState.weather = STORMY;
    registerOverland();                                          // the committed roll, read again
    handlers[OVERLAND_CHANGED]();            // OVERLAND_CHANGED, no options
    release();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(s.writes.map((w) => w.changes), [
      { "environment.darknessLevel": 0.6 },
      { weather: "rainStorm", "flags.shadowdark-enhancer.skyWeather": "rainStorm" },
    ], "the second pass writes the storm");
  } finally {
    globalThis.Hooks.on = on;
    delete globalThis.game.scenes;
  }
});
