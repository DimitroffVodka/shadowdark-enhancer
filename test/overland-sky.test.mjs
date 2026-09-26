// The sky on scenes (#235, Overland O9): darkness by the sun and moon, the
// weather effect, the Isles of Andrik, and who may write a scene's darkness.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HEX_MAP_CAP, calendariaDrives, darknessAt, darknessMoved, followsSky, nightWithOverride, skyOverride, weatherEffect,
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
  assert.equal(weatherEffect({ stormy: true, climate: "Scorching" }), "rainStorm");
  assert.equal(weatherEffect({ stormy: true, climate: "Freezing" }), "blizzard");
  assert.equal(weatherEffect({ stormy: true, climate: "Cold" }), "blizzard");
  assert.equal(weatherEffect({ stormy: true }), "rainStorm", "no climate known");
  assert.equal(weatherEffect({ stormy: false, climate: "Freezing" }), "");
});

test("which scenes follow the sky, and when Calendaria owns the darkness", () => {
  assert.equal(followsSky(undefined, true), true, "a hex map by default");
  assert.equal(followsSky("default", false), false, "a dungeon by default");
  assert.equal(followsSky("on", false), true);
  assert.equal(followsSky("off", true), false);
  assert.equal(calendariaDrives({ active: false, sceneFlag: "enabled", worldSetting: true }), false);
  assert.equal(calendariaDrives({ active: true, sceneFlag: "enabled", worldSetting: false }), true);
  assert.equal(calendariaDrives({ active: true, sceneFlag: "disabled", worldSetting: true }), false);
  assert.equal(calendariaDrives({ active: true, sceneFlag: "default", worldSetting: true }), true);
  assert.equal(darknessMoved(0.4, 0.41), false);
  assert.equal(darknessMoved(0.4, 0.42), true);
});

// ── The writes, against a stubbed scene ───────────────────────────────────────

const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const { gregorian, at } = await import("./gregorian-calendar.mjs");
const stored = {};
const settings = {};
const gm = { id: "gm", isGM: true };
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {} } },
  game: {
    user: gm, users: { activeGM: gm },
    settings: { get: (ns, key) => (ns === "shadowdark-enhancer" ? stored[key] : settings[`${ns}.${key}`]), set: async () => {} },
    socket: { emit() {}, on() {} },
    time: { worldTime: at(1301, 6, 21, 21), calendar: gregorian },
    i18n: { localize: (k) => k, format: (k) => k },
    modules: { get: () => null },
    actors: { get: () => null, filter: () => [] },
  },
});
const { applySky } = await import("../scripts/overland/sky.mjs");
const { registerOverland } = await import("../scripts/overland/overland.mjs");

function scene({ hex = true, follows, darkness = 0, locked = false, weather = "", calendaria } = {}) {
  const writes = [];
  return {
    writes, weather,
    grid: { isHexagonal: hex },
    environment: { darknessLevel: darkness, darknessLock: locked },
    getFlag: (ns, key) => (ns === "shadowdark-enhancer" ? { hexTags: hex ? { origin: {} } : null, followsSky: follows }[key]
      : ns === "calendaria" && key === "darknessSync" ? calendaria : undefined),
    async update(changes, options) { writes.push({ changes, options }); },
  };
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

test("a dungeon, a locked scene, another GM, and Calendaria's scenes are left alone", async () => {
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
  globalThis.game.modules = { get: (id) => (id === "calendaria" ? { active: true } : null) };
  settings["calendaria.darknessSync"] = true;
  const cal = scene();
  await applySky(cal);
  assert.deepEqual(cal.writes, [], "Calendaria owns the darkness");
  const opted = scene({ calendaria: "disabled" });
  await applySky(opted);
  assert.equal(opted.writes.length, 1, "unless the scene opts out of Calendaria's sync");
  globalThis.game.modules = { get: () => null };
  globalThis.game.users.activeGM = { id: "other" };
  const notMine = scene();
  await applySky(notMine);
  assert.deepEqual(notMine.writes, []);
  globalThis.game.users.activeGM = gm;
});

test("a storm rains on an outdoor scene, snows in the cold, and a GM's own weather stays", async () => {
  const stormy = { kind: "stormy", roll: 1, rule: "western", until: at(1301, 6, 22, 5), advantageNext: false, advantage: false, days: null };
  sky({ weather: stormy, climate: "Temperate" });
  const s = scene({ darkness: 0.6 });
  await applySky(s);
  assert.deepEqual(s.writes[0].changes, { weather: "rainStorm" });
  sky({ weather: stormy, climate: "Freezing" });
  const cold = scene({ darkness: 0.6 });
  await applySky(cold);
  assert.deepEqual(cold.writes[0].changes, { weather: "blizzard" });
  const fog = scene({ darkness: 0.6, weather: "fog" });
  await applySky(fog);
  assert.deepEqual(fog.writes, [], "fog is the GM's");
  sky();
  const clearing = scene({ darkness: 0.6, weather: "rainStorm" });
  await applySky(clearing);
  assert.deepEqual(clearing.writes[0].changes, { weather: "" }, "the storm passed");
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
