import test from "node:test";
import assert from "node:assert/strict";
globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
globalThis._replace = (value) => value;
const { partyActor, joinExtras, extrasParties } = await import("../scripts/overland/hex-rules.mjs");
const MOD = "shadowdark-enhancer", SDX = "shadowdark-extras";
function actor(id, flags = {}, extra = {}) {
  const a = { id, uuid: `Actor.${id}`, type: "NPC", flags, updates: [],
    getFlag: (mod, key) => a.flags[mod]?.[key], testUserPermission: () => true,
    update: async (data) => { for (const [key, value] of Object.entries(data)) { const [, mod, flag] = key.split("."); (a.flags[mod] ??= {})[flag] = value; } a.updates.push(data); return a; }, ...extra };
  return a;
}
function world(actors = [], extras = null) {
  const created = [];
  globalThis.canvas = null;
  globalThis.game = { actors: { contents: actors, get: (id) => actors.find((a) => a.id === id) },
    modules: { get: () => extras }, user: { isGM: true }, i18n: { localize: (key) => key } };
  globalThis.Actor = { create: async (data) => { created.push(data); const a = actor("new", data.flags); actors.push(a); return a; } };
  return created;
}
test.afterEach(() => { delete globalThis.game; delete globalThis.Actor; delete globalThis.canvas; });
test("native creation never auto-enrolls owned PCs or writes SDX flags", async () => {
  for (const extras of [null, { active: true, api: { party: { list: () => [] } } }]) {
    const created = world([actor("pc", {}, { type: "Player", hasPlayerOwner: true })], extras);
    await partyActor();
    assert.equal(created[0].type, "NPC");
    assert.equal(created[0].flags[SDX], undefined);
    assert.deepEqual(created[0].flags[MOD].partyData.members, []);
    assert.equal(created[0].flags[MOD].party, true);
  }
});
test("legacy NPC adopts in place, preserving missing references and SDX flags", async () => {
  const saved = { isParty: true, members: ["pc", "gone", "Compendium.a.b.Actor.x"] };
  const mine = actor("party", { [MOD]: { party: true, sibling: 9 }, [SDX]: saved });
  world([mine, actor("pc", {}, { type: "Player" })]);
  assert.equal(await partyActor(), mine);
  assert.deepEqual(mine.flags[MOD].partyData.members, ["Actor.pc", "Actor.gone", "Compendium.a.b.Actor.x"]);
  assert.equal(mine.flags[SDX], saved);
  assert.equal(mine.flags[MOD].sibling, 9);
  const count = mine.updates.length;
  await joinExtras(mine);
  assert.equal(mine.updates.length, count);
});
test("unrelated NPCs and ambiguous multiple parties are untouched", async () => {
  const npc = actor("npc"), a = actor("a", { [MOD]: { party: true } }), b = actor("b", { [MOD]: { party: true } });
  world([a,b,npc]);
  await joinExtras(npc);
  assert.equal(await partyActor(), null);
  assert.equal(npc.updates.length + a.updates.length + b.updates.length, 0);
});
test("failed legacy roster read is unknown and never writes an empty roster", async () => {
  const mine = actor("party", { [MOD]: { party: true }, [SDX]: { members: "broken" } });
  world([mine]);
  await assert.rejects(joinExtras(mine), /unknownRoster/);
  assert.equal(mine.updates.length, 0);
});
test("extrasParties remains optional and read-only", () => {
  const p = actor("sdx", { [SDX]: { isParty: true } });
  world([], { active: true, api: { party: { list: () => [p] } } });
  assert.deepEqual(extrasParties(), [p]);
  world([], { active: false }); assert.deepEqual(extrasParties(), []);
  world([], { active: true, api: { party: { list: () => { throw new Error("failed"); } } } });
  assert.deepEqual(extrasParties(), []);
});