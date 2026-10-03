import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Party } from "../scripts/party/party.mjs";
const MOD = "shadowdark-enhancer";
globalThis._replace = (v) => v;
globalThis.foundry = { applications: { api: { ApplicationV2: class {
  constructor(options) { this.options = options; this.id = options?.id; }
  render() { if (this.id) globalThis.foundry.applications.instances.set(this.id, this); }
  bringToFront() {}
  _onRender() {}
}, HandlebarsApplicationMixin: (base) => base }, sheets: { ActorSheetV2: class { _onRender() {} } }, instances: new Map() } };
const { PartyApp, PartySheet, registerParty } = await import("../scripts/party/party-app.mjs");
function actor(id, type = "NPC", flags = {}, permissions = 3) {
  const a = { id, uuid: `Actor.${id}`, name: id, type, flags, items: { contents: [] }, testUserPermission: (_user, level) => permissions >= ({ OBSERVER: 2, OWNER: 3 })[level],
    getFlag: (mod,key) => a.flags[mod]?.[key], writes: [], update: async (data) => { a.writes.push(data); for (const [key,value] of Object.entries(data)) { const [,mod,flag] = key.split("."); (a.flags[mod] ??= {})[flag] = value; } return a; } };
  return a;
}
function world(actors, isGM = false, journal = []) {
  globalThis.foundry.applications.instances.clear();
  globalThis.canvas = null;
  globalThis.game = { actors: { contents: actors, get: (id) => actors.find((a) => a.id === id) }, user: { id: "player", isGM }, modules: new Map(), journal: { contents: journal }, i18n: { localize: (k) => k, format: (k, data = {}) => `${k} ${Object.values(data).join(" ")}`.trim() } };
}
test("owner writes roster through safe replacement without touching second party, PC or items", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true } }), second = actor("second", "NPC", { [MOD]: { party: true } }), pc = actor("pc", "Player"), other = actor("other", "Player", {}, 2);
  world([p, second, pc, other]);
  await Party.add(p, pc.uuid);
  assert.deepEqual(Party.members(p), [pc.uuid]);
  await assert.rejects(Party.add(p, other.uuid), /noPermission/);
  await Party.remove(p, pc.uuid);
  assert.deepEqual(Party.members(p), []);
  assert.equal(second.writes.length + pc.writes.length + other.writes.length, 0);
  assert.equal(p.flags[MOD].party, true);
});
test("a world whose party still stores includeMounts opens and reads back without it", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { version: 1, members: ["Actor.pc"], leaderUuid: "Actor.pc", includeMounts: true } } });
  world([p, actor("pc", "Player")], true);
  assert.deepEqual(Party.data(p).members, ["Actor.pc"]);
  assert.equal("includeMounts" in Party.data(p), false);
  const context = await new PartyApp(p)._prepareContext();
  assert.equal(context.unknown, undefined);
  assert.equal(context.includeMounts, undefined);
});
test("legacy adoption reads saved SDX flags while getFlag rejects inactive scopes", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true }, "shadowdark-extras": { members: ["pc"] } });
  p.getFlag = () => { throw new Error("inactive scope"); };
  world([p,actor("pc","Player")]);
  await Party.adopt(p);
  assert.deepEqual(Party.members(p), ["Actor.pc"]);
});
test("observer sees roster and real embedded items but cannot edit", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { version: 1, members: ["Actor.deleted"] } } }, 2);
  p.items.contents.push({ id: "i", name: "Real Item", system: { quantity: 2 } });
  world([p]);
  const context = await new PartyApp(p)._prepareContext();
  assert.equal(context.canEdit, false);
  assert.equal(context.groups[3].rows[0].uuid, "Actor.deleted");
  assert.equal(context.items[0].name, "Real Item");
  await assert.rejects(Party.remove(p, "Actor.deleted"), /noPermission/);
});
test("SDX Party types and unrelated NPCs are never adopted or given a sheet override", async () => {
  const sdx = actor("sdx", "Party"), npc = actor("npc");
  world([sdx,npc], true);
  await assert.rejects(Party.adopt(sdx)); await assert.rejects(Party.adopt(npc));
  assert.equal((await new PartyApp(sdx)._prepareContext()).unsupported, true);
  assert.equal(sdx.writes.length + npc.writes.length, 0);
});
test("no-canvas context groups only explicit roster; missing refs retained", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { version: 1, members: ["Actor.pc", "Actor.npc", "Actor.mount", "Actor.deleted"] } } });
  const pc = actor("pc", "Player"); pc.system = { isPC: true };
  world([p, pc, actor("npc"), actor("mount", "shadowdark-enhancer.mount"), actor("unrelated", "Player")]);
  const context = await new PartyApp(p)._prepareContext();
  assert.deepEqual(context.groups.map((g) => g.rows.length), [1,1,1,1]);
  assert.deepEqual(Party.members(p, { charactersOnly: true }), ["Actor.pc"]);
});
test("v14 actor entry uses visible/onClick and remains scoped", async () => {
  const handlers = new Map(); globalThis.Hooks = { on: (name, fn) => handlers.set(name,fn) };
  registerParty();
  const p = actor("p", "NPC", { [MOD]: { party: true } }), npc = actor("npc"); world([p,npc]);
  const entries=[]; handlers.get("getActorContextOptions")({ collection: globalThis.game.actors }, entries);
  const el = (id) => ({ closest: () => ({ dataset: { entryId:id } }) });
  assert.equal(entries[0].visible(el("p")), true); assert.equal(entries[0].visible(el("npc")), false);
  assert.equal((await entries[0].onClick(null, el("p"))).actor, p);
});
test("Party tab action avoids core's reserved tab handler", () => {
  assert.equal(PartyApp.DEFAULT_OPTIONS.actions.tab, undefined);
  const app = new PartyApp();
  PartyApp.DEFAULT_OPTIONS.actions.partyTab.call(app, null, { dataset: { tab: "quests" } });
  assert.equal(app.tab, "quests");
});
test("explicit open retargets the Party window after a picker switch", async () => {
  const one = actor("one", "NPC", { [MOD]: { party: true } }), two = actor("two", "NPC", { [MOD]: { party: true } });
  world([one, two], true);
  const app = await PartyApp.open(one), id = app.id;
  let change;
  app.element = { querySelector: selector => selector === "[data-party-choice]" ? ({ addEventListener: (_name, fn) => { change = fn; } }) : null, querySelectorAll: () => [] };
  app._onRender({}, {});
  change({ target: { value: two.uuid } });
  assert.equal(app.actor, two);
  assert.equal(await PartyApp.open(one), app);
  assert.equal(app.actor, one);
  assert.equal(app.id, id);
  assert.equal(await PartyApp.open(two), app);
  assert.equal(app.actor, two);
  assert.equal(globalThis.foundry.applications.instances.size, 1);
});
test("open on a native Party sheet waits for the window before bringing it to front", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true } });
  world([p], true);
  const sheet = new PartySheet();
  let element = null;
  sheet.actor = p;
  sheet.render = async () => { await Promise.resolve(); element = {}; };
  sheet.bringToFront = () => { if (!element) throw new TypeError("this[#element] is undefined"); };
  p.sheet = sheet;
  assert.equal(await PartyApp.open(p, "camping"), sheet);
  assert.equal(sheet.tab, "travel");
});
test("create from an existing window keeps identity coherent on subsequent opens", async () => {
  const one = actor("one", "NPC", { [MOD]: { party: true } }), created = actor("created", "NPC", { [MOD]: { party: true } });
  world([one], true);
  globalThis.Actor = { create: async () => { globalThis.game.actors.contents.push(created); return created; } };
  try {
    const app = await PartyApp.open(one), id = app.id;
    await PartyApp.DEFAULT_OPTIONS.actions.create.call(app);
    assert.equal(app.actor, created);
    assert.equal(await PartyApp.open(created), app);
    assert.equal(await PartyApp.open(one), app);
    assert.equal(app.actor, one);
    assert.equal(app.id, id);
    assert.equal(globalThis.foundry.applications.instances.size, 1);
  } finally { delete globalThis.Actor; }
});

test("Party member cards keep the portrait, HP, AC, level, slots, XP, ability mods and effects", async () => {
  const pc = actor("pc", "Player");
  pc.system = { attributes: { hp: { value: 5, max: 3 }, ac: { value: 14 } }, level: { value: 2, xp: 7 }, abilities: { str: { mod: 2 }, con: { mod: -1 } }, slots: 12 };
  pc.effects = [{ name: "Blessed", img: "icons/svg/aura.svg", disabled: false }];
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { members: [pc.uuid] } } });
  world([p, pc], true);
  const context = await new PartyApp(p)._prepareContext();
  assert.deepEqual(context.players[0].hp, { value: 5, max: 3 });
  assert.equal(context.players[0].ac, 14);
  assert.equal(context.players[0].abilities.str, 2);
  assert.equal(context.players[0].xp.next, 20);
  assert.equal(context.players[0].effects[0].name, "Blessed");
  assert.deepEqual(context.tabs.map(tab => tab.key), ["members", "items", "travel", "quests", "description"], "the GM sees Travel");
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  for (const marker of ["sdp-head", "sdp-stats", "sdp-face", "sdp-hp", "sdp-chips", "sdp-abil", "sdp-fx", "tab-inventory", "tab-travel", "tab-description"]) assert.ok(template.includes(marker), marker);
  assert.ok(!template.includes("SDE.party.comingSoon"));
  assert.ok(!template.includes("hp-wave"), "the HP wave over the portrait is replaced by the HP bar");
  assert.ok(!template.includes("data-member-choice"), "no all-world actor dropdown in the approved sheet");
  assert.equal(context.choices, undefined, "world actors are not enumerated as suggested members");
  assert.equal(PartyApp.DEFAULT_OPTIONS.actions.add, undefined);
  const css = await readFile(new URL("../styles/party-sheet.css", import.meta.url), "utf8");
  assert.ok(css.includes('font-family: "Old Newspaper Font"'));
  assert.ok(css.includes(".sde-party .sdp-head"));
});

test("Party activity buttons stay in the sheet instead of opening applications", async () => {
  const app = new PartyApp();
  PartyApp.DEFAULT_OPTIONS.actions.camp.call(app);
  assert.equal(app.tab, "travel");
  assert.equal(app.activity, "camping");
  PartyApp.DEFAULT_OPTIONS.actions.carouse.call(app);
  assert.equal(app.tab, "travel");
  assert.equal(app.activity, "carousing");
  assert.equal(globalThis.foundry.applications.instances.has("sde-camping-undefined"), false);
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  assert.ok(template.includes("activityHTML"));
  assert.ok(template.includes("questHTML"));
  assert.ok(!template.includes("sde-party-task-grid"), "no inert task catalogue masquerading as the Travel workflow");
  const entrypoint = await readFile(new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url), "utf8");
  assert.ok(entrypoint.includes('camping: { open: (ref) => PartyApp.open(ref, "camping") }'));
  assert.ok(entrypoint.includes('carousing: { open: (ref) => PartyApp.open(ref, "carousing")'));
  const camping = await readFile(new URL("../templates/camping/camping.hbs", import.meta.url), "utf8");
  assert.ok(camping.indexOf("{{#if hasResults}}") < camping.indexOf('{{#each rows}}<fieldset'), "saved results come before the task setup, not below it");
});

test("Party inline controllers reuse activity actions and redraw their host only", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true } });
  world([p], true);
  const app = new PartyApp(p);
  let renders = 0;
  app.render = () => { renders++; };
  const camp = app._activityController();
  camp.change = (action, data) => ({ action, data });
  assert.deepEqual(PartyApp.DEFAULT_OPTIONS.actions.activityAction.call(app, null, { dataset: { activityAction: "confirmChoice", uuid: "Actor.pc" } }), { action: "select", data: { uuid: "Actor.pc", patch: {} } });
  assert.equal(camp.host, app);
  PartyApp.DEFAULT_OPTIONS.actions.carouse.call(app);
  const carouse = app._activityController();
  assert.notEqual(carouse, camp);
  assert.equal(carouse.host, app);
  const quests = app._questController();
  assert.equal(quests.partyScope, p.uuid);
  quests.render();
  assert.equal(renders, 2);
  assert.equal(globalThis.foundry.applications.instances.size, 0);
});

test("Party header carries a Marching order switch, a leader/status line and a grid caption", async () => {
  const pc = actor("pc", "Player");
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { members: [pc.uuid], leaderUuid: pc.uuid } } });
  world([p, pc], true);
  const context = await new PartyApp(p)._prepareContext();
  assert.equal(context.hasLeader, true);
  assert.equal(context.leaderName, "pc");
  assert.equal(context.march.mode, "notice", "a GM with no party token on the scene is told to place one");
  const empty = actor("n", "NPC", { [MOD]: { party: true, partyData: { members: [] } } });
  world([empty, pc], true);
  const bare = await new PartyApp(empty)._prepareContext();
  assert.equal(bare.hasLeader, false, "an empty roster has no leader to name");
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  for (const marker of ['data-movement-setting="followLeader"', "SDE.party.movement.marchingOrder", "SDE.party.movement.dragHint", "SDE.party.movement.leadHint", "{{march.text}}", 'data-action="resumeFollow"', 'data-action="placeRecall"']) assert.ok(template.includes(marker), marker);
  assert.ok(!template.includes("Marching formation") && !template.includes("includeMounts"), "no boxed formation block, no mounts switch");
});

test("Carousing labels unavailable tiers and disables commitment until tables are usable", async () => {
  const template = await readFile(new URL("../templates/carousing/carousing.hbs", import.meta.url), "utf8");
  assert.ok(template.includes('{{localize "SDE.carousing.tierChoice"}} <select data-choice="tierId"'));
  assert.ok(template.includes('{{localize "SDE.carousing.tiersUnavailable"}}'));
  assert.ok(template.includes('data-action="start" {{#if missingTables}}disabled{{/if}}'));
  assert.ok(template.includes('data-action="confirm" data-uuid="{{uuid}}" {{#if ../missingTables}}disabled{{/if}}'));
});

test("Party description edits inline and movement has no actionable dead ends without a token", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true, partyDescription: "Old" } });
  p.isOwner = true;
  world([p], true);
  const app = new PartyApp(p);
  app.element = { querySelector: () => ({ value: "New notes" }) };
  PartyApp.DEFAULT_OPTIONS.actions.editDescription.call(app);
  assert.equal(app.editingDescription, true);
  await PartyApp.DEFAULT_OPTIONS.actions.saveDescription.call(app);
  assert.equal(p.flags[MOD].partyDescription, "New notes");
  assert.equal(p.flags[MOD].party, true);
  assert.equal(app.editingDescription, false);
  const context = await app._prepareContext();
  assert.equal(context.canResume, false);
  assert.equal(context.movementDisabled, true);
  assert.equal(context.movementReason, "SDE.party.movement.noToken");
  assert.equal(context.march.text, "SDE.party.movement.noToken");
});

test("Party and standalone quests do not replace an action button between blur and click", async () => {
  const { QuestLogApp } = await import("../scripts/quests/quest-log-app.mjs");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    for (const [app, method] of [[new PartyApp(), "_onStateChanged"], [new QuestLogApp(), "_onQuestsChanged"]]) {
      let blur, renders = 0;
      const field = { matches: () => true, addEventListener: (event, callback) => { assert.equal(event, "blur"); blur = callback; } };
      globalThis.document = { activeElement: field };
      app.element = { contains: element => element === field };
      app.render = () => { renders++; };
      app[method]();
      app[method]();
      assert.equal(renders, 0, "typing keeps unsaved text intact");
      blur({ relatedTarget: { closest: selector => selector === "[data-action]" ? {} : null } });
      assert.equal(renders, 0, "the existing action button must receive its click");
      assert.equal(app._heldFor, null);
      app[method]();
      blur({ relatedTarget: null });
      assert.equal(renders, 1, "leaving the sheet still refreshes saved changes");
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete globalThis.document;
  }
});
test("a drag rebuilds a legacy oversized formation instead of deadlocking the grid", async () => {
  const pc = actor("pc", "Player");
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { version: 1, members: [pc.uuid], leaderUuid: pc.uuid, formation: { slots: [{ memberUuid: pc.uuid, col: 2, row: 2 }] } } } });
  world([p, pc], true);
  const app = new PartyApp(p);
  const drops = [];
  const slotEl = { dataset: { row: "1", col: "1" }, addEventListener: (name, fn) => { if (name === "drop") drops.push(fn); } };
  app.element = { querySelector: () => null, querySelectorAll: selector => selector === "[data-formation-slot]" ? [slotEl] : [] };
  app.render = () => {};
  app._bindControls();
  assert.equal(drops.length, 1);
  drops[0]({ preventDefault() {}, dataTransfer: { getData: () => pc.uuid } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(p.flags[MOD].partyData.formation.slots, [{ memberUuid: pc.uuid, col: 1, row: 1 }]);
  assert.equal(p.flags[MOD].partyData.formation.needsReview, undefined);
});
test("treasury coin labels localize through the system keys, not literal field names", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true } });
  world([p], true);
  const context = await new PartyApp(p)._prepareContext();
  assert.deepEqual(context.coinList.map(c => [c.key, c.labelKey, c.value]), [["gp", "SHADOWDARK.coins.gp", 0], ["sp", "SHADOWDARK.coins.sp", 0], ["cp", "SHADOWDARK.coins.cp", 0]]);
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  assert.ok(!template.includes('aria-label="{{key}}"'), "coin inputs do not carry a literal field name as their aria-label");
  assert.ok(template.includes('aria-label="{{localize labelKey}}"'));
});
test("Items lists the party's own items with Gems apart in their own box, and treasury from the flag", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true, partyCoins: { gp: 7, sp: 3 } } });
  p.items.contents.push(
    { id: "r", name: "Rope", type: "Basic", img: "r.webp", system: { quantity: 2, isPhysical: true, slots: { slots_used: 1, per_slot: 1 } } },
    { id: "g", name: "Jade", type: "Gem", img: "g.webp", system: { quantity: 2, isPhysical: true, cost: { gp: 50 } } });
  world([p], true);
  const context = await new PartyApp(p)._prepareContext();
  assert.deepEqual(context.items.map(i => i.name), ["Rope"], "a gem is not also an item row");
  assert.deepEqual(context.gems.map(g => [g.name, g.quantity, g.value]), [["Jade", 2, "50"]]);
  assert.equal(context.gemTotal, "100");
  assert.deepEqual(context.coinList.map(c => c.value), [7, 3, 0]);
  assert.equal(context.inventorySlots.used, 2, "gems do not take party slots, as in the system's own count");
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  for (const marker of ["SHADOWDARK.inventory.gems", "{{gemTotal}}", "sdp-coins", 'data-action="createItem"']) assert.ok(template.includes(marker), marker);
});
test("a party with no members shows a drop zone and a grid hint, and an Actor dropped on either adds it", async () => {
  const pc = actor("pc", "Player");
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { version: 1, members: [] } } });
  world([p, pc], true);
  const app = new PartyApp(p);
  const context = await app._prepareContext();
  assert.equal(context.unknown, undefined);
  assert.deepEqual(context.members, []);
  assert.equal(context.slots.length, 9);
  assert.ok(context.slots.every(slot => slot.disabled), "nothing to arrange yet");
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  for (const marker of ["sdp-empty", "SDE.party.movement.dropHint", "SDE.party.sheet.dropMembers", "SDE.party.noMembers", "data-drop-members"]) assert.ok(template.includes(marker), marker);
  const targets = [];
  app.element = { querySelector: () => null, querySelectorAll: selector => selector === ".tab-members, [data-drop-members]" ? [{ addEventListener: (name, fn) => targets.push([name, fn]) }] : [] };
  app.render = () => {};
  app._bindControls();
  const drop = targets.find(([name]) => name === "drop")[1];
  drop({ preventDefault() {}, dataTransfer: { getData: () => JSON.stringify({ type: "Actor", uuid: pc.uuid }) } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(Party.members(p), [pc.uuid]);
});
test("a player's sheet drops Travel and every control that changes the party", async () => {
  const pc = actor("pc", "Player");
  pc.system = { attributes: { hp: { value: 5, max: 8 }, ac: { value: 12 } }, level: { value: 1, xp: 2 }, abilities: { str: { mod: 1 } } };
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { version: 1, members: [pc.uuid], leaderUuid: pc.uuid } } }, 2);
  world([p, pc], false);
  const app = new PartyApp(p);
  app.tab = "travel";
  const context = await app._prepareContext();
  assert.equal(context.isGM, false);
  assert.equal(context.canEdit, false);
  assert.deepEqual(context.tabs.map(tab => tab.key), ["members", "items", "quests", "description"]);
  assert.equal(context.travelTab, false, "a player who was on Travel lands on Members");
  assert.equal(context.membersTab, true);
  assert.equal(context.players[0].canEdit, false, "no remove (x) on a card");
  assert.equal(context.players[0].hp.value, 5, "players still see a member's full stats");
  assert.ok(context.slots.every(slot => slot.disabled), "the grid is read-only");
  assert.equal(context.activityHTML, "");
});
test("the Bastion tab shows only when a bastion the viewer may see is linked to this party", async () => {
  const p = actor("p", "NPC", { [MOD]: { party: true } }, 2);
  const bastion = actor("b", "shadowdark-enhancer.bastion", {}, 2);
  bastion.system = { type: "keep", party: p.uuid, hp: { value: 80 }, treasury: 12, weeksLeft: 0, upgrades: [{ id: "stable", slot: 0, weeksLeft: 0 }, { id: "library", slot: 1, weeksLeft: 2 }], log: [{ week: 1, key: "SDE.bastion.log.quietMonth", data: { d6: 3 } }, { week: 2, key: "SDE.bastion.log.deposited", data: {} }] };
  bastion.img = "keep.svg";
  world([p, bastion], false);
  let rendered = 0; bastion.sheet = { render: () => { rendered++; } };
  const app = new PartyApp(p);
  let context = await app._prepareContext();
  assert.deepEqual(context.tabs.map(tab => tab.key), ["members", "items", "quests", "bastion", "description"]);
  assert.deepEqual([context.bastion.ac, context.bastion.hp, context.bastion.maxHp, context.bastion.used, context.bastion.slots, context.bastion.treasury], [18, 80, 100, 2, 10, 12]);
  assert.deepEqual(context.bastion.rooms.map(r => [r.name, r.building]), [["SDE.bastion.upgrade.stable.name", false], ["SDE.bastion.upgrade.library.name", true]]);
  assert.match(context.bastion.lastMonth, /quietMonth/, "the newest month result, not the later deposit");
  app.tab = "bastion"; context = await app._prepareContext();
  assert.equal(context.bastionTab, true);
  PartyApp.DEFAULT_OPTIONS.actions.openBastion.call(app);
  assert.equal(rendered, 1);
  // Not linked to this party: no tab, and a stale selection falls back to Members.
  bastion.system.party = "Actor.other";
  context = await app._prepareContext();
  assert.equal(context.bastion, null);
  assert.equal(context.bastionTab, false);
  assert.equal(context.membersTab, true);
  // Linked but the viewer cannot observe it: not offered.
  bastion.system.party = p.uuid; bastion.testUserPermission = () => false;
  assert.equal((await app._prepareContext()).bastion, null);
  // A GM sees it regardless of permission and gets the manage wording.
  world([p, bastion], true);
  context = await new PartyApp(p)._prepareContext();
  assert.equal(context.isGM, true);
  assert.ok(context.bastion);
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  assert.ok(!/<button[^>]*openBastion/.test(template), "core disables every form control of a sheet the viewer cannot edit, so the player's View bastion is not a button");
  for (const marker of ["tab-bastion", 'data-action="openBastion"', "SDE.party.bastion.open", "SDE.party.bastion.view", "SDE.party.bastion.lastMonth"]) assert.ok(template.includes(marker), marker);
});
