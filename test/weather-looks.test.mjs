// The extra weather looks: core's own effects with other settings, built from CONFIG.weatherEffects.
import test from "node:test";
import assert from "node:assert/strict";
import { WEATHER_LOOKS, buildLooks, registerWeatherLooks } from "../scripts/overland/weather-looks.mjs";

class FogShader {}
class RainShader {}
class SnowShader {}
const effectClass = class WeatherShaderEffect {};
/** A stand-in for core's rain, fog and snow entries: the same shape, none of the shaders. */
const core = () => ({
  rain: { id: "rain", label: "WEATHER.Rain", filter: { enabled: false }, effects: [{ id: "rainShader", effectClass, shaderClass: RainShader, config: { opacity: 0.25, intensity: 1, rotation: 0.26 } }] },
  fog: { id: "fog", label: "WEATHER.Fog", filter: { enabled: false }, effects: [{ id: "fogShader", effectClass, shaderClass: FogShader, config: { slope: 0.45, intensity: 0.4, speed: 0.4 } }] },
  snow: { id: "snow", label: "WEATHER.Snow", filter: { enabled: false }, effects: [{ id: "snowShader", effectClass, shaderClass: SnowShader, config: { tint: [0.85, 0.95, 1], direction: 0.5, speed: 2 } }] },
});

test("every look is built: its own id and label, core's shader class, core's config under ours", () => {
  const built = buildLooks(core());
  assert.deepEqual(Object.keys(built), WEATHER_LOOKS.map((l) => l.id));
  const mist = built.sdeMist;
  assert.equal(mist.id, "sdeMist");
  assert.equal(mist.label, "SDE.weather.mist");
  assert.deepEqual(mist.filter, { enabled: false }, "the filter comes from the core effect");
  assert.equal(mist.effects[0].shaderClass, FogShader, "core's shader, not a copy of it");
  assert.equal(mist.effects[0].effectClass, effectClass);
  assert.deepEqual(mist.effects[0].config, { slope: 0.35, intensity: 0.15, speed: 0.2 }, "ours over core's");
  assert.deepEqual(built.sdeDrizzle.effects[0].config, { opacity: 0.25, intensity: 1, strength: 0.8, rotation: 0.26 }, "what we leave alone stays core's");
});

test("a look with two parts runs both shaders, in order", () => {
  const sleet = buildLooks(core()).sdeSleet;
  assert.deepEqual(sleet.effects.map((e) => e.id), ["rainShader", "snowShader"]);
  assert.deepEqual(sleet.effects.map((e) => e.shaderClass), [RainShader, SnowShader]);
  assert.equal(sleet.effects[1].config.speed, 4);
});

test("core's entries are not changed, and the looks do not share a config object with them", () => {
  const c = core();
  const before = structuredClone(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, effects: v.effects.map(({ id, config }) => ({ id, config })) }])));
  const built = buildLooks(c);
  built.sdeMist.effects[0].config.intensity = 99;
  const after = structuredClone(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, effects: v.effects.map(({ id, config }) => ({ id, config })) }])));
  assert.deepEqual(after, before);
});

test("a look whose core effect is gone is skipped; the rest are built", () => {
  const c = core();
  delete c.snow;
  const built = buildLooks(c);
  assert.equal("sdeSleet" in built, false, "sleet needs the snow shader");
  assert.deepEqual(Object.keys(built), ["sdeDrizzle", "sdeMist", "sdeHeavyFog", "sdeDustStorm"]);
  c.fog.effects[0].id = "renamed";
  assert.deepEqual(Object.keys(buildLooks(c)), ["sdeDrizzle"], "a renamed shader entry skips every look that names it");
  assert.deepEqual(buildLooks(undefined), {}, "no list at all");
});

test("no look's id is one of core's, and every label is a language key", () => {
  const ids = WEATHER_LOOKS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith("sde"), `${id} cannot clash with core's or another module's`);
  for (const { label } of WEATHER_LOOKS) assert.match(label, /^SDE\.weather\./);
});

test("registering adds the looks to CONFIG.weatherEffects and leaves core's entries as they are", () => {
  const c = core();
  globalThis.CONFIG = { weatherEffects: c };
  try {
    registerWeatherLooks();
    assert.deepEqual(Object.keys(c), ["rain", "fog", "snow", ...WEATHER_LOOKS.map((l) => l.id)]);
    assert.equal(c.fog.effects[0].config.intensity, 0.4);
  } finally {
    delete globalThis.CONFIG;
  }
});
