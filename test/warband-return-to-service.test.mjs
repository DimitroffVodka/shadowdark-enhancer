// Return to Service undoes a rout (#285 review): the rout defeats the warband's combatant and puts
// `dead` on its token (ActorSD._setDefeated), so the button has to take both back, or the unit
// stays off the strip and skipped in combat at full HP. A 0-HP unit stays defeated.
import test from "node:test";
import assert from "node:assert/strict";

const TYPE = "shadowdark-enhancer.warband";
const MOD = "shadowdark-enhancer";
const later = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const hooks = new Map();
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once() {}, callAll() {} };
globalThis._replace = (value) => ({ __replace: value });
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONFIG = { queries: {} };
globalThis.foundry = { data: { fields: { NumberField: class {} } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.ChatMessage = { create: async () => {}, getWhisperRecipients: () => [], getSpeaker: () => ({}) };
let rollTotal = 1;
globalThis.Roll = class { constructor(formula) { this.formula = formula; } async evaluate() { this.total = rollTotal; return this; } async toMessage() {} };
const gm = { id: "gm", isGM: true };
globalThis.game = {
  actors: [], combats: [], user: gm, users: Object.assign([], { activeGM: gm }),
  i18n: { format: (k) => k, localize: (k) => k, lang: "en" }, time: { worldTime: 0 },
  settings: { register() {}, get: () => null, set: async () => {} },
};
globalThis.fromUuid = async () => ({ system: { abilities: { cha: { mod: 0 } } } });

const { registerWarbandCombat } = await import("../scripts/actors/warband-combat.mjs");
const { upkeepWrite } = await import("../scripts/actors/warband-upkeep.mjs");
const { combatantEntry, isHiddenFromStrip } = await import("../scripts/crawl-strip/turn-skip-core.mjs");
registerWarbandCombat(TYPE);

/** A warband at `hp` (from full), with the system's `_setDefeated` as shipped: combatants defeated, `dead` on the token. */
function band(id, hp) {
  const a = {
    id, uuid: `Actor.${id}`, type: TYPE, name: id, isToken: false, statuses: new Set(),
    system: { attributes: { hp: { value: hp, max: 20 } } },
    flags: { [MOD]: { warband: { commander: "Actor.pc", upgrades: [] } } },
    getFlag: (scope, key) => a.flags[scope]?.[key],
    async update(data) { const v = Object.values(data)[0]; if (v?.__replace) a.flags[MOD].warband = v.__replace; },
    async toggleStatusEffect(s, { active }) { if (active) a.statuses.add(s); else a.statuses.delete(s); },
    async _setDefeated() {
      for (const combat of globalThis.game.combats) for (const c of combat.combatants) {
        if (c.actorId !== a.id) continue;
        c.update({ defeated: true });   // not awaited, as the system does
        a.toggleStatusEffect("dead", { active: true, overlay: true });
      }
    },
  };
  return a;
}
const combatantOf = (a, extra = {}) => {
  const c = {
    id: `c-${a.id}`, actorId: a.id, defeated: false, actor: a, token: { actor: a },
    update: async (d) => { await later(); Object.assign(c, d); }, ...extra,
  };
  return c;
};
/** The warband takes a hit to its current HP from full, in one started combat and one not started; returns every combatant. */
const routed = async (a) => {
  globalThis.game.combats = [{ active: true, combatants: [combatantOf(a)] }, { active: false, combatants: [combatantOf(a)] }];
  hooks.get("createActor")({ type: TYPE, uuid: a.uuid, system: { attributes: { hp: { value: 20, max: 20 } } } });
  rollTotal = 1;                                       // morale fails and so does the rout stand
  hooks.get("updateActor")(a, { system: { attributes: { hp: { value: a.system.attributes.hp.value } } } });
  await later(30);
  return globalThis.game.combats.flatMap((k) => k.combatants);
};
const hidden = (c) => isHiddenFromStrip(combatantEntry(c));

test("Return to Service brings a routed warband's combatants and token back, in every combat, and twice changes nothing", async () => {
  const a = band("rout", 5);
  const cs = await routed(a);
  assert.equal(a.flags[MOD].warband.routed, true);
  assert.ok(cs.every((c) => c.defeated) && a.statuses.has("dead"), "the rout defeated them");
  assert.ok(hidden(cs[0]), "and hid the unit from the strip");

  assert.deepEqual(await upkeepWrite("returnToService", a, TYPE), { ok: true });
  await later(10);
  assert.equal(a.flags[MOD].warband.routed, false);
  assert.ok(cs.every((c) => c.defeated === false), "no combatant is defeated any more");
  assert.equal(a.statuses.has("dead"), false, "the dead status is gone");
  assert.equal(hidden(cs[0]), false, "the unit is back on the strip");

  const writes = [];
  for (const c of cs) { const u = c.update; c.update = (d) => { writes.push(d); return u(d); }; }
  const toggles = [];
  const t = a.toggleStatusEffect;
  a.toggleStatusEffect = (...args) => { toggles.push(args); return t(...args); };
  assert.deepEqual(await upkeepWrite("returnToService", a, TYPE), { ok: true });
  assert.deepEqual([writes, toggles], [[], []], "pressed again it writes nothing more");
});

test("a warband defeated for another reason, never routed, is left alone", async () => {
  const a = band("slain", 5);
  const c = combatantOf(a, { defeated: true });
  globalThis.game.combats = [{ active: true, combatants: [c] }];
  a.statuses.add("dead");
  await upkeepWrite("returnToService", a, TYPE);
  assert.equal(c.defeated, true);
  assert.ok(a.statuses.has("dead"));
});

test("a routed warband at 0 HP stays defeated: it is dead, not merely routed", async () => {
  const a = band("dead", 5);
  const cs = await routed(a);
  a.system.attributes.hp.value = 0;
  await upkeepWrite("returnToService", a, TYPE);
  assert.equal(a.flags[MOD].warband.routed, false, "the flag is cleared as before");
  assert.ok(cs.every((c) => c.defeated === true) && a.statuses.has("dead"), "combatants and token stay as they were");
});

test("a restore that fails part way leaves the routed flag set, so pressing again finishes it", async () => {
  const a = band("retry", 5);
  const cs = await routed(a);
  const real = cs[1].update;
  cs[1].update = async () => { throw new Error("vetoed"); };
  await assert.rejects(upkeepWrite("returnToService", a, TYPE));
  assert.equal(a.flags[MOD].warband.routed, true, "still routed: nothing claims it is undone");
  cs[1].update = real;
  await upkeepWrite("returnToService", a, TYPE);
  await later(10);
  assert.ok(cs.every((c) => c.defeated === false) && !a.statuses.has("dead"));
  assert.equal(a.flags[MOD].warband.routed, false);
});
