// A copy of a warband (Duplicate, an import) starts clean: no commander, no debt, no desertion (#284 review).
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
const TYPE = `${MOD}.warband`;
const hooks = {};
// Every hook registered under a name runs, as in Foundry (the Bastion registers a preCreateActor of its own).
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: () => {} };
globalThis.CONFIG = { Actor: { dataModels: { NPC: class {} }, sheetClasses: {} }, queries: {} };
// Any foundry.* the module reaches for at import answers with itself (as in overland-relay.test.mjs).
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
globalThis.foundry = deep;
globalThis.Actor = class {};
globalThis.game = { system: { sheets: { NpcSheetSD: class { activateListeners() {} } } }, i18n: { localize: (k) => k, format: (k) => k } };
const { registerActorTypes } = await import("../scripts/actors/register-actors.mjs");
registerActorTypes();

/** What the hook writes into a copy's creation data. */
function created(warband) {
  const doc = { type: TYPE, updateSource(update) { this.update = update; } };
  for (const hook of hooks.preCreateActor) hook(doc, { type: TYPE, flags: { [MOD]: { warband, other: 1 } } });
  return doc.update;
}
const at = (update, key) => update[`flags.${MOD}.warband.${key}`];

test("a copy of a warband in debt and deserted starts clean, and keeps its upgrades", () => {
  const update = created({ commander: "Actor.pc", upgrades: ["fast"], arrears: 30, deserted: true, settledMonths: [1, 2], moraleWeeks: [5], retrainingUntil: 900, payment: { id: "x" } });
  assert.equal(at(update, "commander"), null);
  assert.equal(at(update, "arrears"), 0);
  assert.equal(at(update, "deserted"), false);
  assert.deepEqual(at(update, "settledMonths"), []);
  assert.deepEqual(at(update, "moraleWeeks"), []);
  assert.equal(at(update, "retrainingUntil"), null);
  assert.equal(at(update, "payment"), null);
  assert.equal(`flags.${MOD}.warband.upgrades` in update, false);
  assert.equal(update["prototypeToken.actorLink"], true);
});

test("a warband made with no flag gets no flag written, only its linked token", () => {
  const doc = { type: TYPE, updateSource(u) { this.u = u; } };
  for (const hook of hooks.preCreateActor) hook(doc, { type: TYPE });
  assert.deepEqual(doc.u, { "prototypeToken.actorLink": true });
});
