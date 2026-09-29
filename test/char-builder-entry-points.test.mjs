import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The ways into the Character Builder on an existing character (#168 P6): the
 * Player sheet's header button and the Actor directory's context entry. Stub
 * sheets, hooks and actors. (Undo last save is tested with the builder, in
 * char-builder-open-existing.test.mjs.)
 */

const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
const hooks = {};
const opened = [];
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); return 1; } };
globalThis.game = {
  user: { isGM: false },
  shadowdarkEnhancer: { charBuilder: { open: (o) => { opened.push(o); } } },
};

const { registerBuilderEntryPoints } = await import("../scripts/char-builder/entry-points.mjs");
registerBuilderEntryPoints();

const actorOf = (type, isOwner = true) => ({ id: `${type}-${isOwner}`, type, isOwner });
const sheetButtons = (actor) => {
  const buttons = [{ class: "other" }];
  for (const fn of hooks.getActorSheetHeaderButtons) fn({ actor }, buttons);
  return buttons.filter((b) => b.class === "sde-char-builder-launch");
};
/** Run the directory hook; returns the entry and a `li` that points at `entryId`. */
const contextEntry = (actors, entryId) => {
  const items = [];
  for (const fn of hooks.getActorContextOptions) fn({ collection: { get: (id) => actors[id] } }, items);
  return { item: items[0], count: items.length, li: { closest: () => ({ dataset: { entryId } }) } };
};

test("the sheet header control is added for a Player the user owns (a GM owns everything), and clicking opens the builder on it", () => {
  for (const isGM of [true, false]) {
    globalThis.game.user.isGM = isGM;
    const actor = actorOf("Player");
    const found = sheetButtons(actor);
    assert.equal(found.length, 1);
    // Icon only, so the sheet header stays short; the name shows as the tooltip.
    assert.equal(found[0].label, "");
    assert.equal(found[0].tooltip, "SDE.charBuilder.title");
    assert.ok(en[found[0].tooltip]);
    opened.length = 0;
    found[0].onclick();
    assert.deepEqual(opened, [{ actor }]);
  }
});

test("no header control for a non-owner, an NPC, a mount, a boat, a warband or a light", () => {
  for (const actor of [actorOf("Player", false), actorOf("NPC"), actorOf("Mount"), actorOf("Boat"), actorOf("Warband"), actorOf("Light")]) {
    assert.equal(sheetButtons(actor).length, 0, `${actor.type} owner=${actor.isOwner}`);
  }
});

test("the header control is not added twice to the same list", () => {
  const buttons = [];
  const sheet = { actor: actorOf("Player") };
  for (const fn of hooks.getActorSheetHeaderButtons) { fn(sheet, buttons); fn(sheet, buttons); }
  assert.equal(buttons.length, 1);
});

test("the directory context entry has the same visibility and opens the builder on that actor", () => {
  const actors = {
    mine: actorOf("Player"), theirs: actorOf("Player", false),
    npc: actorOf("NPC"), mount: actorOf("Mount"), warband: actorOf("Warband"),
  };
  const { item, count, li } = contextEntry(actors, "mine");
  assert.equal(count, 1);
  assert.equal(en[item.label], "Edit in Character Builder");
  assert.equal(item.visible(li), true);
  opened.length = 0;
  item.onClick({}, li);
  assert.deepEqual(opened, [{ actor: actors.mine }]);
  for (const id of ["theirs", "npc", "mount", "warband", "gone"]) {
    assert.equal(contextEntry(actors, id).item.visible(contextEntry(actors, id).li), false, id);
  }
});

test("the directory context entry is not offered on an actor in a compendium", () => {
  const actors = { packed: { ...actorOf("Player"), pack: "world.heroes" } };
  const { item, li } = contextEntry(actors, "packed");
  assert.equal(item.visible(li), false);
});
