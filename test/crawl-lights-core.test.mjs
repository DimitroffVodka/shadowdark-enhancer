import test from "node:test";
import assert from "node:assert/strict";
import {
  isLightItem,
  lifeClass,
  computeLightState,
} from "../scripts/crawl-lights-core.mjs";

// Minimal ItemSD-shaped factory.
const light = (id, name, { type = "Basic", isSource = true, active = false,
  remainingSecs = 3600, longevityMins = 60 } = {}) => ({
  id, name, type,
  system: { light: { isSource, active, remainingSecs, longevityMins } },
});

// ── isLightItem ─────────────────────────────────────────────────────────────

test("isLightItem: Basic/Effect with isSource true", () => {
  assert.equal(isLightItem(light("t", "Torch")), true);
  assert.equal(isLightItem(light("e", "Light Spell", { type: "Effect" })), true);
});

test("isLightItem: rejects non-source and wrong types", () => {
  assert.equal(isLightItem(light("g", "Rock", { isSource: false })), false);
  assert.equal(isLightItem({ type: "Weapon", system: { light: { isSource: true } } }), false);
  assert.equal(isLightItem({ type: "Basic", system: {} }), false);
  assert.equal(isLightItem(null), false);
});

// ── lifeClass ───────────────────────────────────────────────────────────────

test("lifeClass: buckets by remaining fraction", () => {
  assert.equal(lifeClass(1), "");
  assert.equal(lifeClass(0.5), "");
  assert.equal(lifeClass(0.40), "sde-strip-light-mid");
  assert.equal(lifeClass(0.2), "sde-strip-light-mid");
  assert.equal(lifeClass(0.15), "sde-strip-light-low");
  assert.equal(lifeClass(0), "sde-strip-light-low");
  assert.equal(lifeClass(null), "");
  assert.equal(lifeClass(Infinity), "");
});

// ── computeLightState ───────────────────────────────────────────────────────

test("computeLightState: no items → none", () => {
  assert.equal(computeLightState([]).state, "none");
  assert.equal(computeLightState().state, "none");
});

test("computeLightState: carries a non-light → none", () => {
  const s = computeLightState([{ type: "Weapon", system: {} }]);
  assert.equal(s.state, "none");
});

test("computeLightState: one carried unlit torch → available, direct toggle", () => {
  const s = computeLightState([light("t1", "Torch")]);
  assert.equal(s.state, "available");
  assert.equal(s.toggleId, "t1");
  assert.deepEqual(s.choices, [{ id: "t1", name: "Torch" }]);
});

test("computeLightState: several carried unlit → available, no direct toggle (chooser)", () => {
  const s = computeLightState([light("t1", "Torch"), light("l1", "Lantern")]);
  assert.equal(s.state, "available");
  assert.equal(s.toggleId, null);
  assert.equal(s.choices.length, 2);
});

test("computeLightState: active torch → lit with life + extinguish target", () => {
  const s = computeLightState([
    light("t1", "Torch", { active: true, remainingSecs: 3600, longevityMins: 60 }),
    light("l1", "Lantern"),
  ]);
  assert.equal(s.state, "lit");
  assert.equal(s.activeName, "Torch");
  assert.equal(s.remainingMins, 60);
  assert.equal(s.lifeClass, "");
  assert.equal(s.toggleId, "t1");
});

test("computeLightState: nearly-spent torch → low life bucket + minutes floor", () => {
  const s = computeLightState([
    light("t1", "Torch", { active: true, remainingSecs: 300, longevityMins: 60 }),
  ]);
  assert.equal(s.state, "lit");
  assert.equal(s.lifeClass, "sde-strip-light-low");
  assert.equal(s.remainingMins, 5);
});

test("computeLightState: effect-only active light → lit but read-only (no toggle target)", () => {
  const s = computeLightState([
    light("e1", "Light Spell", { type: "Effect", active: true, longevityMins: 0, remainingSecs: 600 }),
  ]);
  assert.equal(s.state, "lit");
  assert.equal(s.activeName, "Light Spell");
  assert.equal(s.toggleId, null);   // effect lights are managed by the system
  assert.equal(s.lifeClass, "");    // unknown longevity → no life bucket
});

test("computeLightState: prefers a Basic active source over an Effect one", () => {
  const s = computeLightState([
    light("e1", "Light Spell", { type: "Effect", active: true }),
    light("t1", "Torch", { active: true, remainingSecs: 1200, longevityMins: 60 }),
  ]);
  assert.equal(s.activeName, "Torch");
  assert.equal(s.toggleId, "t1");
  assert.equal(s.lifeClass, "sde-strip-light-mid"); // 1200/3600 = 0.33 → mid bucket
});
