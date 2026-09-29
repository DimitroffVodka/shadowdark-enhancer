import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The Character Builder on an existing character (#168 P4b): open({ actor }),
 * Finish (diff, before-image, applyPlan, start over from the live actor).
 * Real hydration, planner, executor and before-image against a stub actor that
 * follows Foundry 14.368's measured write behaviour (it mutates the options object
 * a write is handed, and a stale one makes a later actor.update reject).
 */

const MOD = "shadowdark-enhancer";
const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));

const notes = { info: [], warn: [], error: [] };
const dialogs = [];
let answer = true;
const TORCH = "Compendium.shadowdark.gear.Item.torch";
const SHOP_TORCH = {
  uuid: TORCH, name: "Torch", img: "t.webp", type: "Basic",
  system: { cost: { gp: 0, sp: 0, cp: 5 }, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } },
};

class ApplicationV2 {
  constructor(options) { this.options = options; this.renders = 0; }
  async render() { this.rendered = true; this.renders++; return this; }
  async close() { this.rendered = false; }
  bringToFront() { this.fronted = true; }
}
globalThis._replace = (v) => v;
globalThis.Hooks = { on: () => 1, off: () => {} };
globalThis.CONFIG = { SHADOWDARK: { ALIGNMENTS: { neutral: "Neutral", lawful: "Lawful" } } };
globalThis.Actor = { implementation: { DEFAULT_ICON: "mystery.svg" } };
globalThis.CONST = { DEFAULT_TOKEN: "default-token.webp" };
globalThis.foundry = {
  utils: { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") },
  applications: {
    api: {
      ApplicationV2, HandlebarsApplicationMixin: (B) => B,
      DialogV2: { confirm: async (cfg) => { dialogs.push(cfg); return answer; } },
    },
  },
};
const fmt = (k, d = {}) => (en[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => d[x]);
globalThis.game = {
  modules: new Map([[MOD, { version: "9.9.9" }]]),
  i18n: { localize: (k) => en[k] ?? k, format: fmt },
  settings: { get: () => { throw new Error("not registered"); } },
  user: { isGM: false },
};
globalThis.ui = { notifications: { info: (m) => notes.info.push(m), warn: (m) => notes.warn.push(m), error: (m) => notes.error.push(m) } };
globalThis.fromUuid = async (u) => (u === TORCH
  ? { uuid: TORCH, name: "Torch", toObject: () => ({ name: "Torch", type: "Basic", img: "t.webp", system: { quantity: 1, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } } }) }
  : null);
globalThis.shadowdark = { compendiums: { spells: async () => [] } };

const { ShadowdarkCharBuilder } = await import("../scripts/char-builder/char-builder-app.mjs");
const { restoreBeforeImage, hasBeforeImage, ACTOR_KEYS } = await import("../scripts/char-builder/before-image.mjs");
const { planCommit } = await import("../scripts/char-builder/commit-plan.mjs");
const { rowKey } = await import("../scripts/char-builder/steps/gear-step.mjs");
const { hydrateActor } = await import("../scripts/char-builder/existing-finish.mjs");

// --- a stub actor -------------------------------------------------------------------------------
class Coll extends Map { [Symbol.iterator]() { return this.values(); } }
const setPath = (o, p, v) => {
  const ks = p.split(".");
  const last = ks.pop();
  ks.reduce((a, k) => (a[k] ??= {}), o)[last] = structuredClone(v);
};

function makeActor({ items = [], owner = true, source = {} } = {}) {
  let n = 0;
  const actor = {
    id: "hero", uuid: "Actor.hero", isOwner: owner, faults: {}, calls: [], flags: {},
    prototypeToken: { texture: { src: "tok.webp" } },
    _source: {
      name: "Hero", img: "hero.webp",
      system: {
        abilities: { str: { value: 7 }, dex: { value: 10 }, con: { value: 10 }, int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 } },
        level: { value: 1, xp: 7 }, alignment: "neutral",
        ancestry: "Compendium.shadowdark.ancestries.Item.human", class: "Compendium.shadowdark.classes.Item.fighter",
        background: "", deity: "", patron: null,
        attributes: { hp: { max: 5, value: 2 } }, coins: { gp: 5, sp: 0, cp: 0 },
        languages: ["Compendium.shadowdark.languages.Item.common"], luck: { available: true, remaining: 1 },
      },
      flags: {}, ...source,
    },
    items: new Coll(),
    get name() { return actor._source.name; },
    toObject: () => ({ items: [...actor.items].map((i) => structuredClone(i._source)) }),
    // v14.368: an embedded write assigns parentUuid on the caller's own options object
    _touch(op) { actor.calls.push(op && structuredClone(op)); if (op) op.parentUuid = actor.uuid; },
    async update(changes, options) {
      actor.calls.push({ method: "update", keys: Object.keys(changes), options: options && structuredClone(options) });
      if (options?.parentUuid) throw new Error("stale options object");
      for (const [k, v] of Object.entries(changes)) setPath(actor._source, k, v);
      if (actor._source.flags?.[MOD]) actor.flags[MOD] = actor._source.flags[MOD];
      if (actor.faults.update === "veto") return;
    },
    async createEmbeddedDocuments(_t, data, options) {
      actor.calls.push({ method: "create", names: data.map((d) => d.name), options: structuredClone(options) });
      if (options?.parentUuid) throw new Error("stale options object");
      if (options) options.parentUuid = actor.uuid;
      await actor.gate;
      if (actor.faults.create === "before") throw new Error("boom");
      for (const d of data) {
        const id = options?.keepId ? d._id : `n${++n}`;
        if (actor.items.has(id)) throw new Error("duplicate id");
        actor._add({ ...structuredClone(d), _id: id });
      }
    },
    async updateEmbeddedDocuments(_t, updates, options) {
      actor.calls.push({ method: "updateItems", n: updates.length, options: structuredClone(options) });
      if (options) options.parentUuid = actor.uuid;
      for (const u of updates) for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(actor.items.get(u._id), k, v);
    },
    async deleteEmbeddedDocuments(_t, ids, options) {
      actor.calls.push({ method: "delete", ids, options: structuredClone(options) });
      if (options) options.parentUuid = actor.uuid;
      for (const id of ids) actor.items.delete(id);
    },
    _add(d) { Object.defineProperty(d, "_source", { value: d }); actor.items.set(d._id, d); },
  };
  for (const i of items) actor._add(structuredClone(i));
  return actor;
}

const mk = (id, name, extra = {}) => ({
  _id: id, type: "Basic", name, img: "i.webp", flags: {}, _stats: {},
  system: { quantity: 1, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } }, ...extra,
});
const ITEMS = () => [
  mk("torch1", "Torch", { _stats: { compendiumSource: TORCH }, system: { quantity: 2, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } } }),
  mk("rope1", "Rope"),
  mk("amulet1", "Homebrew Amulet"),
  mk("tal1", "Stout", { type: "Talent", system: {} }),
  mk("abil1", "Backstab", { type: "Class Ability", system: {} }),
  mk("eff1", "Damage: STR (-1)", { type: "Effect", system: {} }),
];

const reset = () => { notes.info.length = notes.warn.length = notes.error.length = 0; dialogs.length = 0; answer = true; ShadowdarkCharBuilder._instance = null; };
const methods = (a) => a.calls.map((c) => c?.method).filter(Boolean);
const ids = (a) => [...a.items].map((i) => i._id).sort();
const named = (a, name) => [...a.items].filter((i) => i.name === name);

async function openOn(actor) {
  reset();
  const app = await ShadowdarkCharBuilder.open({ actor });
  return app;
}
// the shop without a compendium (a rebase makes new steps, so set it each time)
const gear = (app) => { app.steps[5]._items = [SHOP_TORCH]; return app.steps[5]; };
const rowKeyOf = (app, name) => rowKey(app.builderState.gear.find((x) => x.name === name));
const finish = (app) => ShadowdarkCharBuilder._onFinish.call(app);

// ------------------------------------------------------------------------------------------------

test("open({ actor }) hydrates the character and freezes the baseline; the app edits that actor", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  const st = app.builderState;
  assert.equal(app.actor, actor);
  assert.equal(st.existing.baseline.abilities.str, 7);
  assert.equal(st.stats.method, "manual");
  assert.deepEqual(st.gear.map((g) => g.name).sort(), ["Homebrew Amulet", "Rope", "Torch"]);
  assert.deepEqual(st.existing.kept.map((k) => k.name).sort(), ["Backstab", "Damage: STR (-1)", "Stout"]);
  assert.equal(st.existing.baseline.coinsCp, 500);
  assert.equal(ShadowdarkCharBuilder._instance, app);
  assert.equal((await app._prepareContext()).nav.existing, true);
  assert.deepEqual(actor.calls, [], "opening writes nothing");
});

test("a blank actor still starts the fresh build onto it", async () => {
  const actor = makeActor({ source: { system: { level: { value: 0 }, abilities: {}, coins: {} } } });
  const app = await openOn(actor);
  assert.equal(app.builderState.existing, null);
  assert.equal(app.actor, actor);
  assert.equal((await app._prepareContext()).nav.existing, false);
});

test("someone who does not own the character is refused with the existing message", async () => {
  const app = await openOn(makeActor({ items: ITEMS(), owner: false }));
  assert.equal(app, null);
  assert.deepEqual(notes.error, [en["SDE.charBuilder.commit.notOwner"]]);
  assert.equal(ShadowdarkCharBuilder._instance, null);
});

test("a non-owner is refused even while a builder is already open", async () => {
  const open = await openOn(makeActor({ items: ITEMS() }));
  notes.error.length = 0;
  assert.equal(await ShadowdarkCharBuilder.open({ actor: makeActor({ owner: false }) }), null);
  assert.deepEqual(notes.error, [en["SDE.charBuilder.commit.notOwner"]]);
  assert.equal(ShadowdarkCharBuilder._instance, open);
});

test("open() with no actor is the fresh build, unchanged: no baseline, the required-steps gate still applies", async () => {
  reset();
  const app = await ShadowdarkCharBuilder.open();
  assert.equal(app.builderState.existing, null);
  const ctx = await app._prepareContext();
  assert.equal(ctx.nav.existing, false);
  assert.equal(ctx.nav.finishing, false);
  await finish(app);
  assert.equal(notes.warn.length, 1, "incomplete build is refused before any dialog");
  assert.equal(dialogs.length, 0);
});

test("an empty plan says so in one line, opens no dialog, writes nothing and keeps the builder", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  const before = app.builderState;
  await finish(app);
  assert.deepEqual(notes.info, [en["SDE.charBuilder.existing.nothing"]]);
  assert.equal(dialogs.length, 0);
  assert.deepEqual(actor.calls, []);
  assert.equal(app.builderState, before);
  assert.equal(hasBeforeImage(actor), false);
});

/** The main edit: STR 7 to 15, a bought Torch, the Rope removed. */
function edit(app) {
  app.builderState.stats.values.str = 15;
  gear(app).addToCart(TORCH);
  gear(app).removeFromCart(rowKeyOf(app, "Rope"));
}

test("Finish shows the diff in words, saves a before-image, writes exactly the changes and starts a fresh baseline", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  const oldState = app.builderState;
  edit(app);
  await finish(app);

  // the dialog: plain words, old and new values, no ids
  assert.equal(dialogs.length, 1);
  const html = dialogs[0].content;
  assert.match(html, /STR<\/span><b>7 → 15/);
  assert.match(html, /Gold<\/span><b>5 gp → 4 gp 9 sp 5 cp/);
  assert.match(html, /Added<\/span><b>Torch/);
  assert.match(html, /Removed<\/span><b>Rope/);
  assert.match(html, /Kept as-is: 3/);
  assert.doesNotMatch(html, /torch1|rope1|amulet1|Actor\.hero|Compendium/);
  assert.equal(dialogs[0].yes.label, "Save changes");

  // the writes: the image first, then creates, the actor, deletes last
  assert.deepEqual(methods(actor), ["update", "create", "update", "delete"]);
  assert.deepEqual(actor.calls[0].keys, [`flags.${MOD}.builderBefore`]);
  assert.deepEqual(actor.calls[2].keys.sort(), ["system.abilities.str.value", "system.coins.cp", "system.coins.gp", "system.coins.sp"]);
  assert.deepEqual(actor.calls[3].ids, ["rope1"]);
  assert.equal(actor._source.system.abilities.str.value, 15);
  assert.deepEqual(actor._source.system.coins, { gp: 4, sp: 9, cp: 5 });
  assert.deepEqual(ids(actor).filter((i) => i.startsWith("n")).length, 1);
  assert.equal(named(actor, "Torch").length, 2, "the owned torch and the bought one stay two");
  assert.equal(named(actor, "Torch").find((t) => t._id === "torch1").system.quantity, 2);
  // everything the builder does not model is untouched
  for (const id of ["amulet1", "tal1", "abil1", "eff1"]) assert.ok(actor.items.has(id), id);
  assert.deepEqual([actor._source.system.level, actor._source.system.attributes.hp, actor._source.system.luck],
    [{ value: 1, xp: 7 }, { max: 5, value: 2 }, { available: true, remaining: 1 }]);
  // every write carried the builder tag, on a fresh options object
  assert.ok(actor.calls.filter((c) => c.options).every((c) => c.options[MOD]?.builder), "tagged");

  // the result line, then a fresh baseline from the live actor
  assert.equal(notes.info.length, 1);
  assert.match(notes.info[0], /Saved changes to Hero: 2 field\(s\) changed, 1 item\(s\) added, 1 item\(s\) removed/);
  assert.match(notes.info[0], /Undo last save/);
  assert.notEqual(app.builderState, oldState);
  assert.equal(app.builderState.existing.baseline.abilities.str, 15);
  assert.notEqual(app.builderState.existing.sessionId, oldState.existing.sessionId);
  assert.equal(app.builderState.gear.filter((g) => g.name === "Torch").length, 2);
  assert.ok(app.builderState.gear.every((g) => g.owned), "the bought torch is owned now");
  assert.equal(app._finishing, false);
});

test("a second Finish right after has nothing to save, then only plans what changed since", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  edit(app);
  await finish(app);
  actor.calls.length = 0; notes.info.length = 0;

  await finish(app);
  assert.deepEqual(notes.info, [en["SDE.charBuilder.existing.nothing"]]);
  assert.deepEqual(actor.calls, []);

  app.builderState.stats.values.cha = 12;
  await finish(app);
  assert.deepEqual(methods(actor), ["update", "update"], "the image, then the one ability; no creates, no deletes");
  assert.deepEqual(actor.calls[1].keys, ["system.abilities.cha.value"]);
  assert.equal(named(actor, "Torch").length, 2);
});

test("cancelling the dialog writes nothing and keeps the builder as it was", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  edit(app);
  const st = app.builderState;
  answer = false;
  await finish(app);
  assert.deepEqual(actor.calls, []);
  assert.equal(app.builderState, st);
  assert.equal(st.stats.values.str, 15);
});

test("a write that does not land is reported in words, the builder reloads, and doing it again completes", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  edit(app);
  actor.faults.create = "before";
  const stale = app.builderState;
  await finish(app);
  assert.equal(notes.error.length, 1);
  assert.match(notes.error[0], /did not save: could not add Torch/);
  assert.notEqual(app.builderState, stale);
  assert.equal(named(actor, "Torch").length, 1, "nothing was added");
  assert.equal(actor._source.system.abilities.str.value, 7);
  assert.equal(app.builderState.existing.baseline.abilities.str, 7, "a fresh baseline from the live actor");
  assert.equal(app._finishing, false);

  actor.faults = {}; notes.info.length = 0; notes.error.length = 0;
  edit(app);
  await finish(app);
  assert.equal(notes.error.length, 0);
  assert.equal(named(actor, "Torch").length, 2);
  assert.equal(actor._source.system.abilities.str.value, 15);
  assert.ok(!actor.items.has("rope1"));
});

test("the Finish button is disabled while a save runs, and a second click does nothing", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  edit(app);
  let release;
  actor.gate = new Promise((r) => { release = r; });
  const first = finish(app);
  while (!actor.calls.some((c) => c?.method === "create")) await new Promise((r) => setImmediate(r));
  assert.equal((await app._prepareContext()).nav.finishing, true);
  const dialogsSoFar = dialogs.length;
  await finish(app);
  assert.equal(dialogs.length, dialogsSoFar, "the second click opened nothing");
  release();
  await first;
  assert.equal((await app._prepareContext()).nav.finishing, false);
  assert.equal(named(actor, "Torch").length, 2);
});

test("Restore puts the character back exactly after a Finish", async () => {
  const actor = makeActor({ items: ITEMS() });
  const snap = () => JSON.stringify([[...actor.items].map((i) => i._source).sort((a, b) => a._id.localeCompare(b._id)), actor._source.system, actor._source.name]);
  const before = snap();
  const app = await openOn(actor);
  edit(app);
  await finish(app);
  assert.notEqual(snap(), before);
  const r = await restoreBeforeImage(actor);
  assert.equal(r.restored, true);
  assert.equal(snap(), before);
});

test("the template and the strings are wired: a save-changes label for an existing character, the button can be disabled", () => {
  const hbs = readFileSync(new URL("../templates/char-builder/char-builder.hbs", import.meta.url), "utf8");
  assert.match(hbs, /data-action="cb-finish" \{\{#if nav\.finishing\}\}disabled\{\{\/if\}\}/);
  assert.match(hbs, /nav\.existing\}\}\{\{localize "SDE\.charBuilder\.existing\.finish"/);
});

test("every actor field the planner can write is in the before-image's ACTOR_KEYS", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  const st = app.builderState;
  for (const k of Object.keys(st.stats.values)) st.stats.values[k] += 1;
  st.alignment = "lawful";
  st.background = { uuid: "Compendium.x.Item.bg" };
  st.deity = { uuid: "Compendium.x.Item.god" };
  st.coins = { gp: 1, sp: 1, cp: 1 };
  st.languages = ["Compendium.x.Item.elvish"];
  st.name = "Renamed";
  st.art = { portrait: "p.webp", token: "t2.webp" };
  const plan = planCommit(st.existing, st, { source: { name: "Hero", system: actor._source.system }, items: [] });
  const written = [...Object.keys(plan.system), "name", "img", "prototypeToken.texture.src"];
  assert.ok(written.length > 12);
  for (const k of written) assert.ok(ACTOR_KEYS.includes(k), `${k} is written by Finish but not in the before-image`);
  assert.ok(await hydrateActor(actor));
});

// --- Undo last save (#168 P6) --------------------------------------------------------------------
const undo = (app) => ShadowdarkCharBuilder._onUndo.call(app);
const snapOf = (actor) => JSON.stringify([[...actor.items].map((i) => i._source).sort((a, b) => a._id.localeCompare(b._id)), actor._source.system, actor._source.name]);

test("Undo last save shows only while a before-image exists, and only for a GM or an owner", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  assert.equal((await app._prepareContext()).nav.canUndo, false, "no image yet");
  edit(app);
  await finish(app);
  assert.equal((await app._prepareContext()).nav.canUndo, true);
  actor.isOwner = false;
  assert.equal((await app._prepareContext()).nav.canUndo, false, "not an owner");
  const fresh = await ShadowdarkCharBuilder.open({ actor: makeActor({ items: ITEMS() }) });
  assert.equal((await fresh._prepareContext()).nav.canUndo, false);
  const hbs = readFileSync(new URL("../templates/char-builder/char-builder.hbs", import.meta.url), "utf8");
  assert.match(hbs, /\{\{#if nav\.canUndo\}\}[\s\S]*?data-action="cb-undo"[\s\S]*?existing\.undo"/);
  assert.equal(en["SDE.charBuilder.existing.undo"], "Undo last save");
});

test("Undo last save asks once (when, how many items), restores exactly, reloads the builder and says what came back", async () => {
  const actor = makeActor({ items: ITEMS() });
  const before = snapOf(actor);
  const app = await openOn(actor);
  edit(app);
  await finish(app);
  const image = actor.flags[MOD].builderBefore;
  dialogs.length = 0; notes.info.length = 0;
  const oldState = app.builderState;
  await undo(app);

  assert.equal(dialogs.length, 1);
  assert.ok(dialogs[0].content.includes(new Date(image.at).toLocaleString()));
  assert.ok(dialogs[0].content.includes(`${image.items.length} item(s)`));
  assert.equal(snapOf(actor), before, "the character is back exactly");
  assert.notEqual(app.builderState, oldState, "the builder was rehydrated from the live actor");
  assert.equal(app.builderState.stats.values.str, 7);
  assert.equal(notes.info.length, 1);
  assert.match(notes.info[0], /^Put Hero back as it was before the last save: 1 item\(s\) put back, 1 item\(s\) removed, 1 thing\(s\) changed\.$/);
  assert.equal(notes.error.length, 0);
});

test("cancelling the undo confirm writes nothing and keeps the builder", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  edit(app);
  await finish(app);
  const after = snapOf(actor);
  const state = app.builderState;
  dialogs.length = 0; notes.info.length = 0; actor.calls.length = 0;
  answer = false;
  await undo(app);
  assert.equal(dialogs.length, 1);
  assert.deepEqual(actor.calls, []);
  assert.equal(snapOf(actor), after);
  assert.equal(app.builderState, state);
  assert.deepEqual(notes.info, []);
});

test("Undo last save does nothing without an image or for a non-owner: no dialog, no write", async () => {
  const actor = makeActor({ items: ITEMS() });
  const app = await openOn(actor);
  await undo(app);
  assert.equal(dialogs.length, 0);
  edit(app);
  await finish(app);
  dialogs.length = 0; actor.calls.length = 0;
  actor.isOwner = false;
  await undo(app);
  assert.equal(dialogs.length, 0);
  assert.deepEqual(actor.calls, []);
});
