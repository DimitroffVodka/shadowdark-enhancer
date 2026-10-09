import test from "node:test";
import assert from "node:assert/strict";
import { handleCamp, refreshCampFires } from "../scripts/camping/camping.mjs";
const M = "shadowdark-enhancer";
test("begin anchors the camp at committed coordinates during token animation", async () => {
  const pc = { id: "pc", uuid: "Actor.pc", type: "Player", system: { isPC: true } };
  const flags = { [M]: { party: true, partyData: { version: 1, members: [pc.uuid] }, sentinel: true } };
  globalThis._replace = value => value;
  const party = { id: "party", type: "NPC", flags, testUserPermission: () => true, update: async data => { flags[M].camping = data[`flags.${M}.camping`]; } };
  const user = { id: "gm", isGM: true };
  globalThis.foundry = { utils: { randomID: () => "camp" } };
  globalThis.game = { user, users: { activeGM: user }, actors: { contents: [party, pc], get: id => id === party.id ? party : pc }, settings: { settings: new Map() } };
  const token = { actorId: "pc", x: 500, y: 500, width: 1, height: 2, _source: { x: 3000, y: 2500 } };
  globalThis.canvas = { scene: { id: "scene", grid: { size: 100 }, tokens: { contents: [token] } } };
  const reply = await handleCamp({ partyId: party.id, action: "begin" }, user);
  assert.equal(reply.ok, true);
  assert.deepEqual(flags[M].camping.anchor, { sceneId: "scene", x: 3050, y: 2600 });
  assert.equal(flags[M].sentinel, true);
});
test("fire proximity follows committed movement even while token animation is still near", async () => {
  const pc = { id: "pc", uuid: "Actor.pc" }, camp = { id: "camp", anchor: { sceneId: "scene", x: 550, y: 550 }, participants: [{ uuid: pc.uuid, participate: true }], fire: { lit: true, started: 0, lightId: "fire" } };
  const flags = { [M]: { party: true, camping: camp, sentinel: true }, other: { retained: true } };
  globalThis._replace = value => value;
  const party = { id: "party", type: "NPC", flags, update: async data => { flags[M].camping = data[`flags.${M}.camping`]; } };
  let deleted = 0;
  const light = { flags: { [M]: { campFire: { campId: "camp" } } }, delete: async () => { deleted++; } };
  const token = { actorId: "pc", x: 500, y: 500, width: 1, height: 1, _source: { x: 3000, y: 3000 } };
  const scene = { grid: { size: 100, distance: 5 }, tokens: { contents: [token] }, lights: new Map([["fire", light]]) };
  const user = { id: "gm", isGM: true };
  globalThis.game = { user, users: { activeGM: user }, time: { worldTime: 1 }, actors: { contents: [party, pc] }, scenes: new Map([["scene", scene]]) };
  await refreshCampFires();
  assert.equal(deleted, 1);
  assert.equal(flags[M].camping.fire.lit, false);
  assert.equal(flags[M].sentinel, true);
  assert.equal(flags.other.retained, true);
});
test("resolving a camp without a canvas declines the fire instead of blocking the camp", async () => {
  const pc = { id: "pc", uuid: "Actor.pc", type: "Player", system: { isPC: true, abilities: { str: { mod: 2 } } }, testUserPermission: () => true, items: { contents: [] } };
  const flags = { [M]: { party: true, partyData: { version: 1, members: [pc.uuid] }, sentinel: true } };
  globalThis._replace = value => value;
  const party = { id: "party", uuid: "Actor.party", type: "NPC", flags, testUserPermission: () => true, items: { contents: [] }, update: async data => { flags[M].camping = data[`flags.${M}.camping`]; } };
  const user = { id: "gm", isGM: true };
  globalThis.foundry = { utils: { randomID: () => "camp" } };
  globalThis.game = { user, users: { activeGM: user }, actors: { contents: [party, pc], get: id => id === party.id ? party : pc }, settings: { settings: new Map() }, scenes: { get: () => null }, i18n: { localize: k => k, format: k => k } };
  delete globalThis.canvas;
  globalThis.Roll = class { async evaluate() { this.total = 20; return this; } async toMessage() { return {}; } };
  globalThis.ChatMessage = { getSpeaker: () => ({}) };
  const begun = await handleCamp({ partyId: party.id, action: "begin" }, user);
  assert.equal(begun.ok, true);
  assert.equal(flags[M].camping.anchor, null);
  assert.equal((await handleCamp({ partyId: party.id, action: "select", uuid: pc.uuid, patch: { task: "firewood", participate: true } }, user)).ok, true);
  const resolved = await handleCamp({ partyId: party.id, action: "resolve" }, user);
  assert.equal(resolved.ok, true, "no canvas must not block the camp");
  assert.equal(flags[M].camping.phase, "awaitingRest");
  assert.equal(flags[M].camping.fire, undefined, "the fire is declined, not lit");
});
test("a recalled or never-split party counts as at the fire through its token, a deployed one or one with nobody packed does not", async () => {
  for (const [movement, lit] of [[{ packed: [{ actorId: "pc" }], deployed: false }, true], [{ packed: [{ actorId: "pc" }], deployed: true }, false], [{ packed: [], deployed: false }, false], [undefined, true]]) {
    const pc = { id: "pc", uuid: "Actor.pc" }, camp = { id: "camp", anchor: { sceneId: "scene", x: 550, y: 550 }, participants: [{ uuid: pc.uuid, participate: true }], fire: { lit: true, started: 0, lightId: "fire" } };
    const flags = { [M]: { party: true, camping: camp } };
    globalThis._replace = value => value;
    const party = { id: "party", type: "NPC", flags, update: async data => { flags[M].camping = data[`flags.${M}.camping`]; } };
    let deleted = 0;
    const light = { flags: { [M]: { campFire: { campId: "camp" } } }, delete: async () => { deleted++; } };
    const far = { actorId: "pc", x: 3000, y: 3000, width: 1, height: 1 };
    const partyToken = { actorId: "party", x: 500, y: 500, width: 1, height: 1, flags: { [M]: { partyMovement: movement } } };
    const scene = { grid: { size: 100, distance: 5 }, tokens: { contents: [far, partyToken] }, lights: new Map([["fire", light]]) };
    const user = { id: "gm", isGM: true };
    globalThis.game = { user, users: { activeGM: user }, time: { worldTime: 1 }, actors: { contents: [party, pc] }, scenes: new Map([["scene", scene]]) };
    await refreshCampFires();
    assert.equal(flags[M].camping.fire.lit, lit, JSON.stringify(movement));
    assert.equal(deleted, lit ? 0 : 1);
  }
});
function torchCamp(torches) {
  const pc = { id: "pc", uuid: "Actor.pc", type: "Player", system: { isPC: true, abilities: { dex: { mod: 2 } } }, testUserPermission: () => true, items: Object.assign([], { get: () => undefined }), createEmbeddedDocuments: async () => [] };
  const camp = { id: "camp", phase: "setup", fuel: "torches", anchor: { sceneId: "scene", x: 550, y: 550 }, results: {}, effects: {}, tasks: [{ key: "craft", abilities: ["dex"], dc: 12, label: "x" }],
    participants: [{ uuid: pc.uuid, actorId: pc.id, confirmed: true, task: "craft", ability: "dex", craft: "torch", torchConsent: false }] };
  const flags = { [M]: { party: true, camping: camp } };
  const item = { id: "t1", type: "Basic", flags: {}, system: { quantity: torches, light: { isSource: true, template: "torch", active: false, hasBeenUsed: false } }, update: async function (d) { this.system.quantity = d["system.quantity"] ?? this.system.quantity; this.flags[M] = { campFuel: d[`flags.${M}.campFuel`] }; } };
  const party = { id: "party", uuid: "Actor.party", type: "NPC", flags, testUserPermission: () => true, items: Object.assign([item], { get: id => id === item.id ? item : undefined }), update: async data => { flags[M].camping = data[`flags.${M}.camping`]; } };
  const lights = new Map(), user = { id: "gm", isGM: true };
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, lights, tokens: { contents: [{ actorId: "party", x: 500, y: 500, width: 1, height: 1 }] }, createEmbeddedDocuments: async (_t, docs) => { for (const d of docs) lights.set(d._id, d); } };
  globalThis._replace = value => value;
  globalThis.foundry = { utils: { randomID: () => "id" } };
  globalThis.Roll = class { async evaluate() { this.total = 20; return this; } async toMessage() { return {}; } };
  globalThis.ChatMessage = { getSpeaker: () => ({}) };
  globalThis.game = { user, users: { activeGM: user }, time: { worldTime: 1 }, actors: { contents: [party, pc], get: id => id === party.id ? party : pc }, settings: { settings: new Map() }, scenes: { get: () => scene }, i18n: { localize: k => k } };
  return { party, flags, user, item, lights };
}
test("Existing torches is spent and lights the fire at Lock, with no second confirmation", async () => {
  const { party, flags, user, item, lights } = torchCamp(3);
  const reply = await handleCamp({ partyId: party.id, action: "resolve" }, user);
  assert.equal(reply.ok, true, reply.error);
  assert.equal(flags[M].camping.phase, "awaitingRest");
  assert.equal(flags[M].camping.fire.lit, true);
  assert.equal(item.system.quantity, 0);
  assert.equal(lights.size, 1);
  assert.equal(flags[M].camping.fuelShort, undefined, "no warning when the torches were there");
});
test("Existing torches with fewer than three goes on without a fire at Lock", async () => {
  const { party, flags, user, item } = torchCamp(2);
  const reply = await handleCamp({ partyId: party.id, action: "resolve" }, user);
  assert.equal(reply.ok, true, reply.error);
  assert.equal(flags[M].camping.phase, "awaitingRest");
  assert.equal(flags[M].camping.fire, undefined);
  assert.equal(item.system.quantity, 2);
  assert.equal(flags[M].camping.fuelShort, 2, "the shortage is kept for the window to say");
});
