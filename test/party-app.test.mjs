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
const { PartyApp, registerParty } = await import("../scripts/party/party-app.mjs");
function actor(id, type = "NPC", flags = {}, permissions = 3) {
  const a = { id, uuid: `Actor.${id}`, name: id, type, flags, items: { contents: [] }, testUserPermission: (_user, level) => permissions >= ({ OBSERVER: 2, OWNER: 3 })[level],
    getFlag: (mod,key) => a.flags[mod]?.[key], writes: [], update: async (data) => { a.writes.push(data); for (const [key,value] of Object.entries(data)) { const [,mod,flag] = key.split("."); (a.flags[mod] ??= {})[flag] = value; } return a; } };
  return a;
}
function world(actors, isGM = false, journal = []) {
  globalThis.foundry.applications.instances.clear();
  globalThis.canvas = null;
  globalThis.game = { actors: { contents: actors, get: (id) => actors.find((a) => a.id === id) }, user: { id: "player", isGM }, modules: new Map(), journal: { contents: journal }, i18n: { localize: (k) => k } };
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
  world([p, actor("pc", "Player"), actor("npc"), actor("mount", "shadowdark-enhancer.mount"), actor("unrelated", "Player")]);
  const context = await new PartyApp(p)._prepareContext();
  assert.deepEqual(context.groups.map((g) => g.rows.length), [1,1,1,1]);
  assert.deepEqual(Party.members(p, { charactersOnly: true }), ["Actor.pc"]);
});
test("v14 actor entry uses visible/onClick and remains scoped", () => {
  const handlers = new Map(); globalThis.Hooks = { on: (name, fn) => handlers.set(name,fn) };
  registerParty();
  const p = actor("p", "NPC", { [MOD]: { party: true } }), npc = actor("npc"); world([p,npc]);
  const entries=[]; handlers.get("getActorContextOptions")({ collection: globalThis.game.actors }, entries);
  const el = (id) => ({ closest: () => ({ dataset: { entryId:id } }) });
  assert.equal(entries[0].visible(el("p")), true); assert.equal(entries[0].visible(el("npc")), false);
  assert.equal(entries[0].onClick(null, el("p")).actor, p);
});
test("Party tab action avoids core's reserved tab handler", () => {
  assert.equal(PartyApp.DEFAULT_OPTIONS.actions.tab, undefined);
  const app = new PartyApp();
  PartyApp.DEFAULT_OPTIONS.actions.partyTab.call(app, null, { dataset: { tab: "quests" } });
  assert.equal(app.tab, "quests");
});
test("explicit open retargets the Party window after a picker switch", () => {
  const one = actor("one", "NPC", { [MOD]: { party: true } }), two = actor("two", "NPC", { [MOD]: { party: true } });
  world([one, two], true);
  const app = PartyApp.open(one), id = app.id;
  let change;
  app.element = { querySelector: selector => selector === "[data-party-choice]" ? ({ addEventListener: (_name, fn) => { change = fn; } }) : null, querySelectorAll: () => [] };
  app._onRender({}, {});
  change({ target: { value: two.uuid } });
  assert.equal(app.actor, two);
  assert.equal(PartyApp.open(one), app);
  assert.equal(app.actor, one);
  assert.equal(app.id, id);
  assert.equal(PartyApp.open(two), app);
  assert.equal(app.actor, two);
  assert.equal(globalThis.foundry.applications.instances.size, 1);
});
test("create from an existing window keeps identity coherent on subsequent opens", async () => {
  const one = actor("one", "NPC", { [MOD]: { party: true } }), created = actor("created", "NPC", { [MOD]: { party: true } });
  world([one], true);
  globalThis.Actor = { create: async () => { globalThis.game.actors.contents.push(created); return created; } };
  try {
    const app = PartyApp.open(one), id = app.id;
    await PartyApp.DEFAULT_OPTIONS.actions.create.call(app);
    assert.equal(app.actor, created);
    assert.equal(PartyApp.open(created), app);
    assert.equal(PartyApp.open(one), app);
    assert.equal(app.actor, one);
    assert.equal(app.id, id);
    assert.equal(globalThis.foundry.applications.instances.size, 1);
  } finally { delete globalThis.Actor; }
});

test("Party preserves the original detailed member cards and five-tab sheet", async () => {
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
  assert.deepEqual(context.tabs.map(tab => tab.key), ["members", "items", "travel", "quests", "description"]);
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  for (const marker of ["party-portrait", "party-summary", "member-portrait", "member-stats", "member-abilities", "member-effects", "tab-inventory", "tab-travel", "tab-description"]) assert.ok(template.includes(marker), marker);
  assert.ok(!template.includes("SDE.party.comingSoon"));
  assert.ok(!template.includes("data-member-choice"), "no all-world actor dropdown in the approved sheet");
  assert.equal(context.choices, undefined, "world actors are not enumerated as suggested members");
  assert.equal(PartyApp.DEFAULT_OPTIONS.actions.add, undefined);
  const css = await readFile(new URL("../styles/party-sheet.css", import.meta.url), "utf8");
  assert.ok(css.includes('font-family: "Old Newspaper Font"'));
  assert.ok(css.includes("grid-template-columns: 76px minmax(0, 1fr) 160px"));
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

test("Party header names its formation, leader and follow status instead of leaking debug text", async () => {
  const pc = actor("pc", "Player");
  const p = actor("p", "NPC", { [MOD]: { party: true, partyData: { members: [pc.uuid], leaderUuid: pc.uuid } } });
  world([p, pc], true);
  const context = await new PartyApp(p)._prepareContext();
  assert.equal(context.hasLeader, true);
  assert.equal(context.leaderName, "pc");
  const empty = actor("n", "NPC", { [MOD]: { party: true, partyData: { members: [] } } });
  world([empty, pc], true);
  const bare = await new PartyApp(empty)._prepareContext();
  assert.equal(bare.hasLeader, false, "an empty roster has no leader to name");
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  for (const marker of ["sde-party-formation-title", 'SDE.party.movement.leaderLabel', 'SDE.party.movement.statusLabel', 'SDE.party.movement.noLeader']) assert.ok(template.includes(marker), marker);
  assert.ok(!template.includes("{{leaderName}} — "), "the header no longer dumps leader and status as one unlabelled debug line");
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
  assert.equal(context.followStatus, "SDE.party.movement.noToken");
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
