// The automatic camp (autoCampNight) with a camp left over from an earlier stop: it never throws and never
// blocks later camps, and a torch fire already part paid goes on from its plan instead of planning again.
import test from "node:test";
import assert from "node:assert/strict";

const M = "shadowdark-enhancer";
const setPath = (obj, path, v) => { const ks = path.split("."); let o = obj; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; o[ks.at(-1)] = v; };
const mkDoc = (d) => Object.assign(d, { update: async (data) => { for (const [k, v] of Object.entries(data)) setPath(d, k, structuredClone(v)); return d; } });
const torch = (id, q) => mkDoc({ id, type: "Basic", name: "Torch", flags: {}, system: { quantity: q, light: { isSource: true, template: "torch", active: false, hasBeenUsed: false }, magicItem: false } });
const list = (items) => { const byId = new Map(items.map((i) => [i.id, i])); return Object.assign([...items], { get: (id) => byId.get(id), filter: (f) => [...items].filter(f) }); };

/** One PC and a native party, the PC's token beside the camp's anchor so a fire can be lit. */
function world({ camp, partyItems = [], pcItems = [] }) {
  globalThis._replace = (v) => v;
  let n = 0;
  globalThis.foundry = { utils: { randomID: () => `new${++n}` } };
  const pc = mkDoc({ id: "pc", uuid: "Actor.pc", type: "Player", name: "Pip", flags: {}, statuses: new Set(),
    system: { isPC: true, abilities: { con: { mod: 0, value: 10 } }, attributes: { hp: { value: 1, max: 5 } } },
    items: list([...pcItems, mkDoc({ id: "r", type: "Basic", name: "Rations", flags: {}, system: { quantity: 5 } })]), effects: Object.assign([], { has: () => false, filter: () => [] }), testUserPermission: () => true });
  const party = mkDoc({ id: "party", uuid: "Actor.party", type: "NPC", name: "Band",
    flags: { [M]: { party: true, partyData: { version: 1, members: [pc.uuid] }, camping: camp } },
    items: list(partyItems), testUserPermission: () => true });
  const user = { id: "gm", isGM: true };
  globalThis.game = { user, users: { activeGM: user }, time: { worldTime: 0 }, actors: { contents: [party, pc], get: (id) => (id === "party" ? party : pc) },
    settings: { settings: new Map(), get: () => { throw new Error("unset"); } }, messages: { has: () => true }, i18n: { localize: (k) => k, format: (k) => k } };
  const token = { actorId: "pc", x: 500, y: 500, width: 1, height: 1, _source: { x: 500, y: 500 } };
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: { contents: [token] }, lights: new Map(), createEmbeddedDocuments: async () => [{ id: "L" }] };
  globalThis.canvas = { scene };
  globalThis.game.scenes = new Map([["scene", scene]]);
  return { party, pc, user, camp: () => party.flags[M].camping };
}
const { autoCampNight, prepareCampNight } = await import("../scripts/camping/camping.mjs");
const tonight = { day: 200, each: 1, stormy: false, harsh: false };
const base = { participants: [{ uuid: "Actor.pc", actorId: "pc", task: "", participate: true, confirmed: true }], mounts: [], tasks: [], results: {}, effects: {} };

test("a camp with no day yet, left at its Night, is tonight's camp, as before Auto travel", async () => {
  const w = world({ camp: { ...base, id: "old", phase: "awaitingRest", fuel: "none", day: null } });
  const r = await autoCampNight(w.party, tonight, w.user);
  assert.equal(r.ready, true);
  assert.deepEqual([w.camp().id, w.camp().day], ["old", 200]);
});

for (const [label, phase] of [["at its Night", "awaitingRest"], ["at its fire", "fuel"]]) {
  test(`a camp left ${label} by an earlier day with no meal eaten becomes tonight's camp`, async () => {
    const w = world({ camp: { ...base, id: "old", phase, fuel: "none", day: 199 } });
    const r = await autoCampNight(w.party, tonight, w.user);
    assert.equal(r.ready, true);
    assert.deepEqual([w.camp().id, w.camp().day], ["old", 200]);
    // and the next night is not blocked by it either
    const again = await autoCampNight(w.party, { ...tonight, day: 201 }, w.user);
    assert.equal(again.ready, true);
  });
}

for (const fuel of ["torches", "wood"]) {
  test(`a torch fire part paid before a failure (fuel ${fuel}) is finished from its plan, never planned or paid again`, async () => {
    const pt = torch("pt", 0); pt.flags[M] = { campFuel: "c1" };
    const ct = torch("ct", 1);
    const w = world({
      camp: { ...base, id: "c1", phase: "fuel", fuel, anchor: { sceneId: "scene", x: 550, y: 550 }, day: 200,
        fuelPlan: [{ actorUuid: "Actor.party", id: "pt", quantity: 2 }, { actorUuid: "Actor.pc", id: "ct", quantity: 1 }] },
      partyItems: [pt], pcItems: [ct],
    });
    const r = await autoCampNight(w.party, tonight, w.user);
    assert.equal(r.ready, true);
    assert.deepEqual([pt.system.quantity, ct.system.quantity], [0, 0], "only the stack not yet charged is charged");
    assert.equal(w.camp().fire?.lit, true);
    assert.equal(w.camp().fuelShort, undefined);
  });
}

test("an auto camp that stopped for rations, then a day the GM started by hand: the next night's auto camp goes ahead", async () => {
  const w = world({ camp: null });
  const food = w.pc.items.get("r");
  food.system.quantity = 0;
  const stopped = await autoCampNight(w.party, tonight, w.user);
  assert.deepEqual([stopped.ready, stopped.reason, w.camp().phase, w.camp().day], [false, "rations", "awaitingRest", 200]);
  // Nobody answered the camp window; the GM opened day 201 from the bar and the party found food.
  food.system.quantity = 5;
  const next = await autoCampNight(w.party, { ...tonight, day: 201 }, w.user);
  assert.equal(next.ready, true);
  assert.equal(w.camp().day, 201);
  assert.equal(food.system.quantity, 4, "tonight's meal only");
});

// Auto off: Make camp and Night go through prepareCampNight, which must not be stuck on the same leftover camp.
test("Auto off: a camp left at its Night on an earlier day with no meal eaten becomes tonight's camp", async () => {
  const w = world({ camp: { ...base, id: "old", phase: "awaitingRest", fuel: "none", day: 199, shortageWarning: true } });
  const r = await prepareCampNight(w.party, tonight, w.user, true);
  assert.equal(r.ready, true);
  assert.deepEqual([w.camp().id, w.camp().day], ["old", 200]);
});

test("Auto off: a camp whose meal was eaten on an earlier day rests once and the window gets a fresh camp", async () => {
  const w = world({ camp: { ...base, id: "old", phase: "awaitingRest", fuel: "none", day: 199, foodCommitted: true } });
  w.pc.flags[M] = { campNutrition: { days: { 199: { foodDone: true, fed: true, campId: "old" } } } };
  const r = await prepareCampNight(w.party, tonight, w.user, true);
  assert.equal(r.ready, false);
  assert.notEqual(w.camp().id, "old");
  assert.equal(w.camp().phase, "setup");
  assert.equal(w.pc.system.attributes.hp.value, 5, "the old night's rest ran");
  const again = await prepareCampNight(w.party, tonight, w.user, true);
  assert.equal(again.ready, false, "the fresh camp is set up in the window, never an error");
});

test("a camp left at its fire on an earlier day with torches part paid keeps them paid and lights the fire tonight", async () => {
  const pt = torch("pt", 0); pt.flags[M] = { campFuel: "c1" };
  const ct = torch("ct", 1);
  const w = world({
    camp: { ...base, id: "c1", phase: "fuel", fuel: "torches", anchor: { sceneId: "scene", x: 550, y: 550 }, day: 199,
      fuelPlan: [{ actorUuid: "Actor.party", id: "pt", quantity: 2 }, { actorUuid: "Actor.pc", id: "ct", quantity: 1 }] },
    partyItems: [pt], pcItems: [ct],
  });
  const r = await autoCampNight(w.party, tonight, w.user);
  assert.equal(r.ready, true);
  assert.deepEqual([w.camp().id, w.camp().day], ["c1", 200]);
  assert.deepEqual([pt.system.quantity, ct.system.quantity], [0, 0]);
  assert.equal(w.camp().fire?.lit, true);
  assert.equal(w.camp().fuelShort, undefined);
});

test("a part-paid torch fire with nobody by its spot goes on without the light, never charging again", async () => {
  const pt = torch("pt", 0); pt.flags[M] = { campFuel: "c2" };
  const ct = torch("ct", 1);
  const w = world({
    camp: { ...base, id: "c2", phase: "fuel", fuel: "torches", anchor: { sceneId: "scene", x: 5500, y: 5500 }, day: 200,
      fuelPlan: [{ actorUuid: "Actor.party", id: "pt", quantity: 2 }, { actorUuid: "Actor.pc", id: "ct", quantity: 1 }] },
    partyItems: [pt], pcItems: [ct],
  });
  globalThis.canvas.scene.tokens.contents.length = 0;
  const r = await autoCampNight(w.party, tonight, w.user);
  assert.equal(r.ready, true);
  assert.equal(ct.system.quantity, 1, "no second charge");
  assert.notEqual(w.camp().phase, "fuel");
});
