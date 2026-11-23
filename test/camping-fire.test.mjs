import test from "node:test";
import assert from "node:assert/strict";
import { handleCamp, refreshCampFires, closeWaitingCamp } from "../scripts/camping/camping.mjs";
import { readFile } from "node:fs/promises";
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
test("concurrent begins by two parties each keep their own camp", async () => {
  const mk = id => {
    const pc = { id: `pc${id}`, uuid: `Actor.pc${id}`, type: "Player", system: { isPC: true }, testUserPermission: () => true, items: { contents: [] } };
    const flags = { [M]: { party: true, partyData: { version: 1, members: [pc.uuid] } } };
    const o = { pc, flags };
    o.party = { id: `party${id}`, uuid: `Actor.party${id}`, type: "NPC", flags, testUserPermission: () => true, items: { contents: [] }, update: async (data) => {
      await Promise.resolve();
      flags[M].camping = data[`flags.${M}.camping`];
    } };
    return o;
  };
  const a = mk("A"), b = mk("B"), all = [a, b].flatMap(x => [x.party, x.pc]);
  const user = { id: "gm", isGM: true };
  globalThis._replace = value => value;
  globalThis.foundry = { utils: { randomID: () => "camp" } };
  globalThis.game = { user, users: { activeGM: user }, actors: { contents: all, get: id => all.find(x => x.id === id) }, settings: { settings: new Map() } };
  delete globalThis.canvas;
  await Promise.all([handleCamp({ partyId: a.party.id, action: "begin" }, user), handleCamp({ partyId: b.party.id, action: "begin" }, user)]);
  assert.deepEqual([a.flags[M].camping?.participants[0].uuid, b.flags[M].camping?.participants[0].uuid], ["Actor.pcA", "Actor.pcB"]);
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
    participants: [{ uuid: pc.uuid, actorId: pc.id, confirmed: true, task: "craft", ability: "dex", craft: "torch" }] };
  // The camp follows the party's roster while it is set up, so the PC must be a member.
  const flags = { [M]: { party: true, partyData: { members: [pc.uuid] }, camping: camp } };
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
// #594: tasks rolled outside an Overland day had no night to pass, and the window offered no way back to setup.
test("a GM starts over a rolled camp whose night never came: same choices, rolls dropped, its fire out", async () => {
  const { party, flags, user, lights } = torchCamp(3);
  delete globalThis.canvas;
  assert.equal((await handleCamp({ partyId: party.id, action: "resolve" }, user)).ok, true);
  assert.equal(flags[M].camping.phase, "awaitingRest");
  for (const light of lights.values()) light.delete = async () => { lights.delete(light._id); };
  const owner = { id: "player", isGM: false };
  await handleCamp({ partyId: party.id, action: "begin" }, owner);
  assert.equal(flags[M].camping.phase, "awaitingRest", "a player owner cannot drop rolls to roll again");
  flags[M].camping = { ...flags[M].camping, foodCommitted: true };
  await handleCamp({ partyId: party.id, action: "begin" }, user);
  assert.equal(flags[M].camping.phase, "awaitingRest", "a camp that has eaten owes its rest");
  flags[M].camping = { ...flags[M].camping, foodCommitted: false };
  const reply = await handleCamp({ partyId: party.id, action: "begin" }, user);
  assert.equal(reply.ok, true, reply.error);
  assert.equal(flags[M].camping.phase, "setup");
  assert.deepEqual(flags[M].camping.results, {});
  assert.equal(flags[M].camping.participants[0].task, "craft", "the choices carry over");
  assert.equal(flags[M].camping.fuel, "torches");
  assert.equal(lights.size, 0, "the old camp's fire light is removed");
});
// #594: a night at an inn ends a camp still waiting for its night, the way Start over does; anything else is left alone.
test("Safe rest closes a camp waiting for its night back to setup, and leaves every other camp as it is", async () => {
  const { party, flags, user, lights } = torchCamp(3);
  delete globalThis.canvas;
  assert.equal((await handleCamp({ partyId: party.id, action: "resolve" }, user)).ok, true);
  for (const light of lights.values()) light.delete = async () => { lights.delete(light._id); };
  const rolled = flags[M].camping;
  for (const camp of [{ ...rolled, foodCommitted: true }, { ...rolled, phase: "setup" }, { ...rolled, phase: "complete" }, null]) {
    flags[M].camping = camp;
    await closeWaitingCamp(party, user);
    assert.deepEqual(flags[M].camping, camp, camp?.phase ?? "no camp");
  }
  flags[M].camping = rolled;
  await closeWaitingCamp(party, { id: "player", isGM: false });
  assert.equal(flags[M].camping.phase, "awaitingRest", "only a GM's Safe rest closes it");
  await closeWaitingCamp(party, user);
  assert.equal(flags[M].camping.phase, "setup");
  assert.deepEqual(flags[M].camping.results, {});
  assert.equal(flags[M].camping.participants[0].task, "craft", "the choices carry over to the next camp");
  assert.equal(lights.size, 0, "the camp's fire is out");
});
test("Safe rest calls closeWaitingCamp for the travel party after the rest", async () => {
  const src = await readFile(new URL("../scripts/overland/overland.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf('case "safeRest"'), src.indexOf('case "fastTravel"'));
  assert.ok(body.indexOf("closeWaitingCamp(") > body.indexOf("restSafely("), "the camp closes after the rest, not before");
});
test("Safe rest off the hex map closes the given party's waiting camp after the rest too (PR 597 review)", async () => {
  const src = await readFile(new URL("../scripts/overland/overland.mjs", import.meta.url), "utf8");
  const start = src.indexOf("export async function safeRestHere(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(start > 0 && body.includes("closeWaitingCamp(party"), "the party the HUD button was given is the one closed");
  assert.ok(body.indexOf("closeWaitingCamp(") > body.indexOf("restSafely("), "the camp closes after the rest, not before");
});
