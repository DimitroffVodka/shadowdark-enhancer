import test from "node:test";
import assert from "node:assert/strict";

// The party actor the Enhancer makes on a hex map: an NPC, and with Extras there an Extras party too.
globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
const { partyActor, joinExtras, extrasParties, PARTY_FLAG } = await import("../scripts/overland/hex-rules.mjs");

const EXTRAS = "shadowdark-extras", ENHANCER = "shadowdark-enhancer";

/** A stand-in actor that keeps its flags. */
function actor(id, flags = {}, extra = {}) {
  const a = {
    id, type: "NPC", flags, updates: [],
    getFlag: (mod, key) => a.flags[mod]?.[key],
    setFlag: async (mod, key, value) => { (a.flags[mod] ??= {})[key] = value; a.updates.push([mod, key, value]); return a; },
    ...extra,
  };
  return a;
}
const player = (id, owned = true) => actor(id, {}, { type: "Player", hasPlayerOwner: owned });

/** A world: its actors, and Extras with or without a party API and parties of its own. */
function world({ actors = [], extras = "absent", parties = [] } = {}) {
  const created = [];
  const extrasModule = extras === "absent" ? undefined
    : { active: extras !== "off", api: extras === "noApi" ? {} : { party: { list: () => (typeof parties === "function" ? parties() : parties) } } };
  globalThis.game = {
    modules: { get: (id) => (id === EXTRAS ? extrasModule : undefined) },
    actors: { find: (fn) => actors.find(fn), filter: (fn) => actors.filter(fn), get: (id) => actors.find((a) => a.id === id), contents: actors },
    i18n: { localize: (k) => k },
    user: { isGM: true },
  };
  // Foundry's synchronous resolver: a world uuid is the actor; a compendium uuid is an unloaded index entry (an _id, no id).
  globalThis.fromUuidSync = (uuid) => (uuid.startsWith("Actor.") ? actors.find((a) => a.id === uuid.slice(6)) : { _id: "x", uuid });
  globalThis.Actor = { create: async (data) => { created.push(data); const a = actor("new", data.flags); actors.push(a); return a; } };
  return { created, actors };
}
test.afterEach(() => { delete globalThis.game; delete globalThis.Actor; delete globalThis.fromUuidSync; });

test("without Extras the party is a plain NPC of the Enhancer's, as it always was", async () => {
  const { created } = world({ actors: [player("p1")] });
  await partyActor();
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "NPC");
  assert.deepEqual(created[0].flags, { [ENHANCER]: { [PARTY_FLAG]: true } });
});

test("with Extras and no party of its own, the party is made an Extras party, so Extras' Party sheet opens", async () => {
  // Extras' own definition of a party (its Developer API): an NPC flagged isParty. The flag decides the sheet,
  // the members and the light tracker; without it the actor gets the NPC sheet and Extras never lists it.
  const { created } = world({ actors: [player("p1"), player("p2"), player("npc-owned", false)], extras: "on", parties: [] });
  await partyActor();
  assert.equal(created[0].flags[EXTRAS].isParty, true);
  assert.equal(created[0].flags[ENHANCER][PARTY_FLAG], true);
  assert.deepEqual(created[0].flags[EXTRAS].members, ["p1", "p2"], "the player characters travel until the GM picks members: what the NPC-sheet party did");
});

test("an Extras that is off, or has no party API, leaves the party a plain NPC", async () => {
  for (const extras of ["off", "noApi"]) {
    const { created } = world({ extras });
    await partyActor();
    assert.equal(created[0].flags[EXTRAS], undefined, extras);
  }
});

test("the party made before Extras took part is joined to it, once, keeping members it already has", async () => {
  const mine = actor("mine", { [ENHANCER]: { [PARTY_FLAG]: true } });
  const { created } = world({ actors: [mine, player("p1")], extras: "on", parties: [] });
  assert.equal(await partyActor(), mine, "the existing party is the one used");
  assert.equal(created.length, 0);
  assert.equal(mine.flags[EXTRAS].isParty, true);
  assert.deepEqual(mine.flags[EXTRAS].members, ["p1"]);

  const withMembers = actor("kept", { [ENHANCER]: { [PARTY_FLAG]: true }, [EXTRAS]: { members: ["p1", "Actor.p2"] } });
  world({ actors: [withMembers, player("p1"), player("p2")], extras: "on", parties: [] });
  await joinExtras(withMembers);
  assert.equal(withMembers.flags[EXTRAS].isParty, true);
  assert.deepEqual(withMembers.flags[EXTRAS].members, ["p1", "Actor.p2"], "an Extras sheet's own members are not replaced");

  const before = withMembers.updates.length;
  await joinExtras(withMembers);
  assert.equal(withMembers.updates.length, before, "already an Extras party: nothing more is written");
});

test("an Extras party of its own is never joined by ours, and no other actor is turned into one", async () => {
  const theirs = actor("theirs", { [EXTRAS]: { isParty: true } });
  const mine = actor("mine", { [ENHANCER]: { [PARTY_FLAG]: true } });
  world({ actors: [theirs, mine], extras: "on", parties: [theirs] });
  await joinExtras(mine);
  assert.equal(mine.flags[EXTRAS], undefined, "Extras has one already: Start travel uses that, two would make it ambiguous");

  const bystander = actor("npc", {});
  world({ actors: [bystander], extras: "on", parties: [] });
  await joinExtras(bystander);
  assert.equal(bystander.flags[EXTRAS], undefined, "only the Enhancer's own party actor is ever joined");
});

test("extrasParties is what Extras lists, and nothing when it is absent, off or throws", () => {
  const p = actor("p", { [EXTRAS]: { isParty: true } });
  world({ extras: "on", parties: [p] });
  assert.deepEqual(extrasParties(), [p]);
  world({ extras: "absent" });
  assert.deepEqual(extrasParties(), []);
  world({ extras: "off", parties: [p] });
  assert.deepEqual(extrasParties(), []);
  world({ extras: "on" });
  globalThis.game.modules.get(EXTRAS).api.party.list = () => { throw new Error("boom"); };
  assert.deepEqual(extrasParties(), []);
});

/** Extras' own list: every actor flagged isParty. */
const flagged = (actors) => () => actors.filter((a) => a.flags[EXTRAS]?.isParty === true);

test("a party whose saved members are not world characters is not joined: its travellers stay the player characters (#320 review)", async () => {
  // Extras keeps a compendium uuid as is; the synchronous lookup gives an index entry with no id, so
  // travel would take no one. Joining would also swap who travels; the saved list is left as it was.
  for (const members of [["Compendium.a.b.Actor.x"], ["p1", "Compendium.a.b.Actor.x"], ["gone"]]) {
    const mine = actor("mine", { [ENHANCER]: { [PARTY_FLAG]: true }, [EXTRAS]: { members } });
    const actors = [mine, player("p1")];
    world({ actors, extras: "on", parties: flagged(actors) });
    assert.equal(await partyActor(), mine);
    assert.equal(mine.flags[EXTRAS].isParty, undefined, JSON.stringify(members));
    assert.deepEqual(mine.flags[EXTRAS].members, members, "the saved list is not erased");
    assert.deepEqual(extrasParties(), [], "Extras does not list it, so Start travel takes the player characters");
  }
});

test("a failed list of Extras' parties is not an empty one: nothing is enrolled (#320 review)", async () => {
  const boom = () => { throw new Error("boom"); };
  // creating
  const { created } = world({ actors: [player("p1")], extras: "on", parties: boom });
  await partyActor();
  assert.equal(created[0].flags[EXTRAS], undefined, "no second Extras party made on a failed read");
  // joining
  const mine = actor("mine", { [ENHANCER]: { [PARTY_FLAG]: true } });
  world({ actors: [mine, player("p1")], extras: "on", parties: boom });
  await joinExtras(mine);
  assert.equal(mine.flags[EXTRAS], undefined);
  // a list that is not a list
  const other = actor("other", { [ENHANCER]: { [PARTY_FLAG]: true } });
  world({ actors: [other], extras: "on", parties: () => undefined });
  await joinExtras(other);
  assert.equal(other.flags[EXTRAS], undefined);
  // control: a list that read fine and is empty enrolls
  const ok = actor("ok", { [ENHANCER]: { [PARTY_FLAG]: true } });
  world({ actors: [ok, player("p1")], extras: "on", parties: [] });
  await joinExtras(ok);
  assert.equal(ok.flags[EXTRAS].isParty, true);
});
