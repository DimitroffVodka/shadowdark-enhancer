// The Bastion panel: which bastions a user sees, the card each shows, and the Actors directory entry
// that opens it for a party (the GM always, a player only when the party owns a bastion they can see).
import test from "node:test";
import assert from "node:assert/strict";
import { visibleBastions, bastionCard } from "../scripts/bastion/bastion-panel-core.mjs";
import { registerBastionEntryPoints } from "../scripts/bastion/bastion-entry-points.mjs";
import { BASTION_TYPE } from "../scripts/bastion/bastion-art.mjs";
import { build, advanceWeek, newBastion, damage } from "../scripts/bastion/bastion-core.mjs";

const T = "shadowdark-enhancer";
const bastion = (name, { party = "", observer = true, state } = {}) => ({
  id: name.toLowerCase(), name, type: BASTION_TYPE, img: `art/${name}.svg`,
  system: { toObject: () => state ?? { ...newBastion("keep"), weeksLeft: 0 }, party },
  testUserPermission: (_user, level) => level === "OBSERVER" && observer,
});
const party = (uuid, flags = { [T]: { party: true } }) => ({ uuid, name: uuid, type: "NPC", flags });
const gm = { isGM: true }, player = { isGM: false };

test("a user sees the bastions they can observe, by name; the GM sees all", () => {
  const actors = [bastion("Zed", { observer: false }), bastion("Ash"), { type: "NPC", name: "Not a bastion", testUserPermission: () => true }, bastion("Bay")];
  assert.deepEqual(visibleBastions(actors, { user: player }).map((a) => a.name), ["Ash", "Bay"]);
  assert.deepEqual(visibleBastions(actors, { user: gm }).map((a) => a.name), ["Ash", "Bay", "Zed"]);
});

test("a party's panel shows only the bastions that name it", () => {
  const co = party("Actor.co"), other = party("Actor.other");
  const actors = [bastion("Ash", { party: "Actor.co" }), bastion("Bay", { party: "Actor.other" }), bastion("Cove")];
  assert.deepEqual(visibleBastions(actors, { user: gm, party: co }).map((a) => a.name), ["Ash"]);
  assert.deepEqual(visibleBastions(actors, { user: gm, party: other }).map((a) => a.name), ["Bay"]);
  assert.deepEqual(visibleBastions(actors, { user: gm }).map((a) => a.name), ["Ash", "Bay", "Cove"]);
});

const words = { t: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` };

test("a card carries the numbers a glance needs", () => {
  let s = { ...newBastion("keep"), weeksLeft: 0, treasury: 800, week: 6 };
  s = build(build(s, "library").state, "stable").state;
  s = advanceWeek(s);
  s = build(s, "vault").state;                 // vault is still going up
  s = damage(s, 25);
  const card = bastionCard(bastion("Hold", { state: s }), words);
  assert.equal(card.name, "Hold");
  assert.equal(card.img, "art/Hold.svg");
  assert.equal(card.typeName, "SDE.bastion.type.keep.name");
  assert.deepEqual([card.hp, card.maxHp, card.hpPct, card.breached], [75, 100, 75, false]);
  assert.deepEqual([card.used, card.slots, card.treasury], [3, 10, 800 - 400 - 100 - 200]);
  assert.deepEqual(card.built.map((u) => u.id), ["library", "stable"]);
  assert.deepEqual(card.building.map((u) => u.id), ["vault"]);
  assert.equal(card.built[0].name, "SDE.bastion.upgrade.library.name");
  assert.match(card.line, /SDE\.bastion\.panel\.standing .*"week":7/);
});

test("a bastion not yet raised says so, and a breached one is marked", () => {
  const raising = bastionCard(bastion("New", { state: newBastion("castle") }), words);
  assert.match(raising.line, /SDE\.bastion\.panel\.raising .*"weeks":8/);
  const broken = bastionCard(bastion("Ruin", { state: damage({ ...newBastion("house"), weeksLeft: 0 }, 99) }), words);
  assert.deepEqual([broken.hp, broken.hpPct, broken.breached], [0, 0, true]);
});

test("the directory entry shows on a party for the GM, and for a player only when a bastion of theirs is visible", () => {
  const hooks = [];
  globalThis.Hooks = { on: (name, fn) => hooks.push([name, fn]) };
  const co = party("Actor.co"), pc = { uuid: "Actor.pc", flags: {}, type: "Player" }, extras = party("Actor.ex", { "shadowdark-extras": { isParty: true } });
  const world = new Map([["co", co], ["pc", pc], ["ex", extras]]);
  globalThis.game = { user: gm, actors: { contents: [bastion("Ash", { party: "Actor.co" })], } };
  registerBastionEntryPoints();
  const [name, fn] = hooks[0];
  assert.equal(name, "getActorContextOptions");
  const items = [];
  fn({ collection: { get: (id) => world.get(id) } }, items);
  const [entry] = items;
  assert.equal(entry.label, "SDE.bastion.panel.menu");
  const li = (id) => ({ closest: () => ({ dataset: { entryId: id } }) });
  assert.equal(entry.visible(li("co")), true);        // GM, a party
  assert.equal(entry.visible(li("ex")), true);        // an Extras party too
  assert.equal(entry.visible(li("pc")), false);       // not a party
  globalThis.game.user = player;
  assert.equal(entry.visible(li("co")), true);        // a player, with a bastion they can see
  assert.equal(entry.visible(li("ex")), false);       // ...but not for a party with none
  globalThis.game.actors.contents = [bastion("Ash", { party: "Actor.co", observer: false })];
  assert.equal(entry.visible(li("co")), false);       // ...and not one they can't see
});
