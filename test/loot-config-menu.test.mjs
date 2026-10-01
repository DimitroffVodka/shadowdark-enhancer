// The per-NPC Loot config is an Actors directory context entry (GM only, NPCs only), not a sheet header button.
import test from "node:test";
import assert from "node:assert/strict";

const hooks = {};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); return 1; } };
globalThis.foundry = { applications: { handlebars: {} } };
globalThis.game = { user: { isGM: true } };

const { LootDrops } = await import("../scripts/loot/loot-drops.mjs");
LootDrops.init();

test("Loot shows for a GM on an NPC only, and clicking opens that NPC's config", () => {
  const actors = { npc: { type: "NPC" }, pc: { type: "Player" } };
  const items = [];
  for (const fn of hooks.getActorContextOptions) fn({ collection: { get: (id) => actors[id] } }, items);
  const li = (id) => ({ closest: () => ({ dataset: { entryId: id } }) });
  assert.equal(hooks.getActorSheetHeaderButtons, undefined);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "SDE.loot.label");
  assert.deepEqual(["npc", "pc"].map((id) => items[0].visible(li(id))), [true, false]);
  let opened;
  LootDrops.openConfig = (actor) => { opened = actor; };
  items[0].onClick({}, li("npc"));
  assert.equal(opened, actors.npc);
  globalThis.game.user.isGM = false;
  assert.equal(items[0].visible(li("npc")), false);
});
