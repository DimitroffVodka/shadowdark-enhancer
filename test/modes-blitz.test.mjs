import test from "node:test";
import assert from "node:assert/strict";
import { blitzLightPatch, blitzEffectPatch, BLITZ_LIGHT_SECS } from "../scripts/modes-of-play/blitz.mjs";

const torch = (light = {}, flags = {}) => ({
  type: "Basic", flags,
  system: { light: { isSource: true, active: false, remainingSecs: 3600, longevityMins: 60, hasBeenUsed: false, ...light } },
});
// The system's own seconds per unit (CONFIG.SHADOWDARK.DURATION_UNITS).
const UNITS = { seconds: 1, rounds: 6, minutes: 60, turns: 600, hours: 3600, days: 86400 };

test("a fresh torch lights with 30 minutes, and is marked used so its sheet cannot reset it", () => {
  assert.deepEqual(blitzLightPatch(torch(), { system: { light: { active: true } } }),
    { "system.light.remainingSecs": BLITZ_LIGHT_SECS, "system.light.hasBeenUsed": true });
  assert.deepEqual(blitzLightPatch(torch(), { "system.light.active": true }),
    { "system.light.remainingSecs": 1800, "system.light.hasBeenUsed": true }, "flat changes too");
});

test("a torch with 45 minutes left relights with 30; one with 10 keeps its 10", () => {
  assert.equal(blitzLightPatch(torch({ remainingSecs: 2700 }), { system: { light: { active: true } } })["system.light.remainingSecs"], 1800);
  assert.equal(blitzLightPatch(torch({ remainingSecs: 600 }), { system: { light: { active: true } } })["system.light.remainingSecs"], 600);
  assert.equal(blitzLightPatch(torch(), { system: { light: { active: true, remainingSecs: 900 } } })["system.light.remainingSecs"], 900,
    "a remaining time in the same update is respected");
});

test("only lighting is touched: putting out, ticking, other items and the camping campfire are left alone", () => {
  assert.equal(blitzLightPatch(torch({ active: true }), { system: { light: { active: false } } }), null);
  assert.equal(blitzLightPatch(torch({ active: true }), { system: { light: { remainingSecs: 1700 } } }), null, "the tracker's tick");
  assert.equal(blitzLightPatch(torch({ active: true }), { system: { light: { active: true } } }), null, "already lit");
  assert.equal(blitzLightPatch({ ...torch(), type: "Weapon" }, { system: { light: { active: true } } }), null);
  assert.equal(blitzLightPatch(torch({ isSource: false }), { system: { light: { active: true } } }), null);
  assert.equal(blitzLightPatch(torch({}, { "shadowdark-extras": { campingCampfire: true } }), { system: { light: { active: true } } }), null);
});

test("a light spell's effect lasts 30 minutes; shorter or untimed ones are left", () => {
  const effect = (duration, light = { isSource: true }) => ({ type: "Effect", system: { duration, light } });
  assert.deepEqual(blitzEffectPatch(effect({ type: "hours", value: 1 }), UNITS), {
    "system.duration.type": "minutes", "system.duration.value": 30,
    "system.light.longevitySecs": 1800, "system.light.remainingSecs": 1800, "system.light.longevityMins": 30,
  });
  assert.equal(blitzEffectPatch(effect({ type: "minutes", value: 10 }), UNITS), null);
  assert.equal(blitzEffectPatch(effect({ type: "rounds", value: 5 }), UNITS), null);
  assert.equal(blitzEffectPatch(effect({ type: "focus", value: 0 }), UNITS), null, "focus has no clock to clamp");
  assert.equal(blitzEffectPatch(effect({ type: "hours", value: 1 }, { isSource: false }), UNITS), null, "not a light");
  assert.equal(blitzEffectPatch({ ...effect({ type: "hours", value: 8 }), flags: { "shadowdark-extras": { campingCampfire: true } } }, UNITS), null);
});
