import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Level up an existing character inside the builder, one level at a time (#168 P7).
 * The real steps, planner, executor and before-image against a stub actor that
 * follows Foundry 14.368's write behaviour, and stub compendium documents. The
 * rules mirrored are the Shadowdark system 4.0.6 LevelUpSD: offered at XP >= level x 10
 * (a GM always), one hit die added to the BASE maximum, a talent roll at odd target
 * levels, the spells-known delta, the surplus XP carried over. Only talents and spells
 * are created; Class Abilities never.
 */

const MOD = "shadowdark-enhancer";
const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));

const notes = { info: [], warn: [], error: [] };
const dialogs = [];
let answer = true;
let nextDie = 4;
let talentTotal = 9;

const FIGHTER = "Compendium.shadowdark.classes.Item.fighter";
const WIZARD = "Compendium.shadowdark.classes.Item.wizard";
const TABLE = "Compendium.shadowdark.rolltables.RollTable.talents";
const TALENT = "Compendium.shadowdark.talents.Item.gladiator";
const CHOICE_TALENT = "Compendium.shadowdark.talents.Item.mastery";
const SPELL = (n) => `Compendium.shadowdark.spells.Item.s${n}`;

const spellDoc = (n, tier) => ({
  uuid: SPELL(n), name: `Spell ${n}`, documentName: "Item", flags: {}, system: { tier, class: [WIZARD] },
  toObject: () => ({ name: `Spell ${n}`, type: "Spell", img: "s.webp", system: { tier, class: [WIZARD] }, effects: [] }),
});
const SPELLS = [spellDoc(1, 1), spellDoc(2, 1), spellDoc(3, 1), spellDoc(4, 2), spellDoc(5, 2)];
const talentDoc = (uuid, name, effects = []) => ({
  uuid, name, documentName: "Item", effects,
  toObject: () => ({ name, type: "Talent", img: "t.webp", system: { level: 0 }, effects: structuredClone(effects) }),
});
const DOCS = {
  [FIGHTER]: { uuid: FIGHTER, name: "Fighter", documentName: "Item", system: {
    hitPoints: "d8", classTalentTable: TABLE, spellcasting: { class: "__not_spellcaster__", ability: "", spellsknown: {} },
  } },
  [WIZARD]: { uuid: WIZARD, name: "Wizard", documentName: "Item", system: {
    hitPoints: "d4", classTalentTable: TABLE,
    spellcasting: { class: WIZARD, ability: "int", spellsknown: { 1: { 1: 2 }, 2: { 1: 3 }, 3: { 1: 3, 2: 1 }, 4: { 1: 3, 2: 2 } } },
  } },
  [TABLE]: {
    uuid: TABLE, name: "Talents", documentName: "RollTable",
    roll: async () => ({ roll: { total: talentTotal } }),
    results: { contents: [{ range: [2, 12], documentUuid: TALENT }] },
  },
  [TALENT]: talentDoc(TALENT, "Gladiator"),
  [CHOICE_TALENT]: talentDoc(CHOICE_TALENT, "Weapon Mastery", [{ name: "Weapon Mastery", changes: [{ key: "system.bonuses.REPLACEME", value: "1" }] }]),
  ...Object.fromEntries(SPELLS.map((s) => [s.uuid, s])),
};

class ApplicationV2 {
  constructor(options) { this.options = options; }
  async render() { this.rendered = true; return this; }
  async close() { this.rendered = false; }
  bringToFront() {}
}
globalThis.Hooks = { on: () => 1, off: () => {} };
globalThis.CONFIG = { SHADOWDARK: { ALIGNMENTS: { neutral: "Neutral" } } };
globalThis.Actor = { implementation: { DEFAULT_ICON: "mystery.svg" } };
globalThis.CONST = { DEFAULT_TOKEN: "default-token.webp" };
globalThis.foundry = {
  utils: { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") },
  applications: {
    api: { ApplicationV2, HandlebarsApplicationMixin: (B) => B, DialogV2: { confirm: async (cfg) => { dialogs.push(cfg); return answer; } } },
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
globalThis._replace = (v) => v;
globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
globalThis.Roll = class { evaluate() { this.dice = [{ total: nextDie }]; return Promise.resolve(this); } };
globalThis.fromUuid = async (u) => DOCS[u] ?? null;
globalThis.shadowdark = {
  compendiums: { classes: async () => [DOCS[FIGHTER], DOCS[WIZARD]], spells: async () => SPELLS.map((s) => ({ uuid: s.uuid, name: s.name, system: s.system })) },
  effects: { createItemWithEffect: async (doc) => doc.toObject() },
};

const { ShadowdarkCharBuilder } = await import("../scripts/char-builder/char-builder-app.mjs");
const { ACTOR_KEYS } = await import("../scripts/char-builder/before-image.mjs");
const { planCommit } = await import("../scripts/char-builder/commit-plan.mjs");
const { canLevelUp, startLevelUp, cancelLevelUp, talentDue, spellsDue, xpToLevelUp } = await import("../scripts/char-builder/level-up.mjs");
const { resolveCreate } = await import("../scripts/char-builder/commit-apply.mjs");
const { hydrateActor } = await import("../scripts/char-builder/existing-finish.mjs");

// --- a stub actor (as in char-builder-open-existing.test.mjs) ----------------------------------
class Coll extends Map { [Symbol.iterator]() { return this.values(); } }
const setPath = (o, p, v) => {
  const ks = p.split(".");
  const last = ks.pop();
  ks.reduce((a, k) => (a[k] ??= {}), o)[last] = structuredClone(v);
};

function makeActor({ items = [], cls = FIGHTER, level = 1, xp = 10, hp = { max: 5, value: 2 } } = {}) {
  let n = 0;
  const actor = {
    id: "hero", uuid: "Actor.hero", isOwner: true, calls: [], flags: {},
    prototypeToken: { texture: { src: "tok.webp" } },
    _source: {
      name: "Hero", img: "hero.webp",
      system: {
        abilities: { str: { value: 10 }, dex: { value: 10 }, con: { value: 10 }, int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 } },
        level: { value: level, xp }, alignment: "neutral",
        ancestry: "Compendium.shadowdark.ancestries.Item.human", class: cls,
        background: "", deity: "", patron: null,
        attributes: { hp }, coins: { gp: 5, sp: 0, cp: 0 },
        languages: ["Compendium.shadowdark.languages.Item.common"], luck: { available: true, remaining: 1 },
      },
      flags: {},
    },
    items: new Coll(),
    get name() { return actor._source.name; },
    toObject: () => ({ items: [...actor.items].map((i) => structuredClone(i._source)) }),
    async update(changes, options) {
      actor.calls.push({ method: "update", keys: Object.keys(changes), options: options && structuredClone(options) });
      if (options?.parentUuid) throw new Error("stale options object");
      if (options) options.parentUuid = actor.uuid;
      for (const [k, v] of Object.entries(changes)) setPath(actor._source, k, v);
      if (actor._source.flags?.[MOD]) actor.flags[MOD] = actor._source.flags[MOD];
    },
    async createEmbeddedDocuments(_t, data, options) {
      actor.calls.push({ method: "create", names: data.map((d) => d.name) });
      if (options?.parentUuid) throw new Error("stale options object");
      if (options) options.parentUuid = actor.uuid;
      for (const d of data) actor._add({ ...structuredClone(d), _id: options?.keepId ? d._id : `n${++n}` });
    },
    async updateEmbeddedDocuments(_t, updates, options) {
      actor.calls.push({ method: "updateItems" });
      if (options) options.parentUuid = actor.uuid;
      for (const u of updates) for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(actor.items.get(u._id), k, v);
    },
    async deleteEmbeddedDocuments(_t, ids, options) {
      actor.calls.push({ method: "delete", ids });
      if (options) options.parentUuid = actor.uuid;
      for (const id of ids) actor.items.delete(id);
    },
    _add(d) { Object.defineProperty(d, "_source", { value: d }); actor.items.set(d._id, d); },
  };
  for (const i of items) actor._add(structuredClone(i));
  return actor;
}
const mk = (id, name, extra = {}) => ({ _id: id, type: "Basic", name, img: "i.webp", flags: {}, _stats: {}, system: { quantity: 1, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } }, ...extra });
const held = (id, n, tier) => mk(id, `Spell ${n}`, { type: "Spell", _stats: { compendiumSource: SPELL(n) }, system: { tier, class: [WIZARD] } });
const CARRIED = () => [mk("rope1", "Rope"), mk("amulet1", "Homebrew Amulet"), mk("abil1", "Backstab", { type: "Class Ability", system: {} })];
const WIZ_ITEMS = () => [...CARRIED(), held("h1", 1, 1), held("h2", 2, 1)];

const reset = () => { notes.info.length = notes.warn.length = notes.error.length = 0; dialogs.length = 0; answer = true; ShadowdarkCharBuilder._instance = null; globalThis.game.user.isGM = false; };
async function openOn(actor) {
  reset();
  return ShadowdarkCharBuilder.open({ actor });
}
const finish = (app) => ShadowdarkCharBuilder._onFinish.call(app);
const levelUp = (app) => ShadowdarkCharBuilder._onLevelUp.call(app);
const cancel = (app) => ShadowdarkCharBuilder._onLevelUpCancel.call(app);
const undo = (app) => ShadowdarkCharBuilder._onUndo.call(app);
const classStep = (app) => app.steps.find((s) => s.id === "class");
const hpStep = (app) => app.steps.find((s) => s.id === "hp").sub.hp;
const snapOf = (actor) => JSON.stringify([[...actor.items].map((i) => i._source).sort((a, b) => a._id.localeCompare(b._id)), actor._source.system, actor._source.name]);
const offer = async (app) => (await app._prepareContext()).nav.levelUpOffer;
const stateOf = (cls, level, xp, over = {}) => ({
  existing: { baseline: { level, xp, hp: { max: 5 } }, sessionId: "s1" }, level0: false, levelUp: null, class: { item: DOCS[cls] }, ...over,
});

// --- the rules, pure -------------------------------------------------------------------------

test("Level up is offered only to an existing character below the maximum level with the XP, or to a GM", () => {
  assert.equal(xpToLevelUp(3), 30);
  assert.equal(canLevelUp(stateOf(FIGHTER, 1, 10)), true, "xp 10 at level 1 is enough");
  assert.equal(canLevelUp(stateOf(FIGHTER, 1, 9)), false, "one short");
  assert.equal(canLevelUp(stateOf(FIGHTER, 3, 30)), true);
  assert.equal(canLevelUp(stateOf(FIGHTER, 3, 29)), false);
  assert.equal(canLevelUp(stateOf(FIGHTER, 1, 0), { isGM: true }), true, "a GM always");
  assert.equal(canLevelUp(stateOf(FIGHTER, 10, 999), { isGM: true }), false, "never above the maximum");
  assert.equal(canLevelUp(stateOf(FIGHTER, 0, 5, { level0: true }), { isGM: true }), false, "a Funnel character is out of scope");
  assert.equal(canLevelUp(stateOf(FIGHTER, 0, 5), { isGM: true }), false, "level 0");
  assert.equal(canLevelUp({ existing: null, level0: false, class: { item: DOCS[FIGHTER] } }, { isGM: true }), false, "a fresh build");
  assert.equal(canLevelUp(stateOf(FIGHTER, 1, 10, { class: { item: null } })), false, "an unresolved class has no hit die");
  assert.equal(canLevelUp(stateOf(FIGHTER, 1, 10, { levelUp: { from: 1, to: 2, dice: [] } })), false, "already levelling");
});

test("a talent roll follows the system: odd target levels only; spells are the table's delta", () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7].map(talentDue), [false, true, false, true, false, true]);
  assert.deepEqual(spellsDue(DOCS[WIZARD], 2, 3), { 2: 1 }, "tier 1 stays at 3, tier 2 gains one");
  assert.deepEqual(spellsDue(DOCS[WIZARD], 1, 2), { 1: 1 });
  assert.deepEqual(spellsDue(DOCS[FIGHTER], 1, 2), {}, "a non-caster gains none");
});

// --- the plan ---------------------------------------------------------------------------------

async function plannedLevelUp(actor, mutate) {
  const app = await openOn(actor);
  const st = app.builderState;
  startLevelUp(st);
  mutate?.(st);
  const plan = planCommit(st.existing, st, { source: { name: "Hero", system: actor._source.system }, items: [...actor.items].map((i) => i._source) });
  return { app, st, plan };
}

test("planning a level-up writes exactly the level, the HP maximum, the XP and the talent and spells, and nothing else", async () => {
  const actor = makeActor({ cls: WIZARD, level: 2, xp: 25, hp: { max: 6, value: 3 }, items: WIZ_ITEMS() });
  const { plan } = await plannedLevelUp(actor, (st) => {
    st.levelUp.dice = [3];
    st.bonusRolls = [{ key: "level-talent-3", chosenUuid: TALENT, chosenName: "Gladiator", options: [] }];
    st.spells.push({ uuid: SPELL(3), name: "Spell 3", tier: 1 }, { uuid: SPELL(4), name: "Spell 4", tier: 2 });
  });
  assert.deepEqual(plan.system, { "system.level.value": 3, "system.attributes.hp.max": 9, "system.level.xp": 5 });
  assert.deepEqual(plan.creates.map((c) => [c.kind, c.name]).sort(), [["spell", "Spell 3"], ["spell", "Spell 4"], ["talent", "Gladiator"]]);
  assert.equal(plan.creates.find((c) => c.kind === "talent").level, 3);
  assert.deepEqual([plan.updates, plan.deletes, plan.name, plan.art], [[], [], null, {}]);
  for (const k of Object.keys(plan.system)) assert.ok(ACTOR_KEYS.includes(k), `${k} is written by a level-up but not in the before-image`);
  assert.equal(plan.system["system.attributes.hp.value"], undefined, "current hit points are never written");
  assert.equal(plan.summary.lines.some((l) => l.kind === "set" && l.key === "level" && l.from === 2 && l.to === 3), true);
});

test("hit points never go down, and a non-caster's level-up creates no spells", async () => {
  const actor = makeActor({ level: 1, xp: 10, items: CARRIED() });
  const none = await plannedLevelUp(actor);
  assert.equal(none.plan.system["system.attributes.hp.max"], undefined, "no die rolled, no HP change");
  assert.equal(none.plan.system["system.level.value"], 2);
  const negative = await plannedLevelUp(actor, (st) => { st.levelUp.dice = [-2]; });
  assert.equal(negative.plan.system["system.attributes.hp.max"], undefined);
  const rolled = await plannedLevelUp(actor, (st) => { st.levelUp.dice = [6]; });
  assert.equal(rolled.plan.system["system.attributes.hp.max"], 11);
  assert.equal(rolled.plan.creates.filter((c) => c.kind === "spell").length, 0);
});

test("the XP that is left carries over, and a GM level-up with no XP writes no XP", async () => {
  const carry = await plannedLevelUp(makeActor({ level: 1, xp: 14 }), (st) => { st.levelUp.dice = [2]; });
  assert.equal(carry.plan.system["system.level.xp"], 4);
  const gm = await plannedLevelUp(makeActor({ level: 1, xp: 0 }), (st) => { st.levelUp.dice = [2]; });
  assert.equal(gm.plan.system["system.level.xp"], undefined);
});

test("a character whose level moved since the builder opened is not levelled twice", async () => {
  const actor = makeActor({ cls: WIZARD, level: 1, xp: 10, items: WIZ_ITEMS() });
  const app = await openOn(actor);
  const st = app.builderState;
  startLevelUp(st);
  st.levelUp.dice = [3];
  st.spells.push({ uuid: SPELL(3), name: "Spell 3", tier: 1 });
  actor._source.system.level.value = 2;
  const plan = planCommit(st.existing, st, { source: { name: "Hero", system: actor._source.system }, items: [...actor.items].map((i) => i._source) });
  assert.deepEqual(plan.system, {});
  assert.deepEqual(plan.creates, []);
  assert.equal(plan.drift[0].key, "level");
});

// --- the builder, end to end ------------------------------------------------------------------

test("a fresh build and a level-0 character never see Level up", async () => {
  reset();
  const fresh = await ShadowdarkCharBuilder.open();
  globalThis.game.user.isGM = true;
  assert.equal(await offer(fresh), null);
  const funnel = await openOn(makeActor({ level: 0, xp: 5, cls: "" }));
  globalThis.game.user.isGM = true;
  assert.equal(await offer(funnel), null);
});

test("Level up needs the XP; a GM is offered it anyway; nothing is offered while a save runs", async () => {
  const short = await openOn(makeActor({ xp: 9 }));
  assert.equal(await offer(short), null);
  await levelUp(short);
  assert.equal(short.builderState.levelUp, null, "the action refuses without the XP");
  globalThis.game.user.isGM = true;
  assert.deepEqual(await offer(short), { to: 2 });
  const enough = await openOn(makeActor({ xp: 10 }));
  assert.deepEqual(await offer(enough), { to: 2 });
});

test("a non-caster levels 1 to 2 through the builder: one die, no talent, no spells, saved whole and undone exactly", async () => {
  const actor = makeActor({ level: 1, xp: 14, items: CARRIED() });
  const before = snapOf(actor);
  const app = await openOn(actor);
  await levelUp(app);
  assert.equal(app.builderState.levelUp.to, 2);
  assert.equal(app.stepIndex, app.steps.findIndex((s) => s.id === "class"));
  assert.equal((await app._prepareContext()).nav.levelUpActive.to, 2);

  // nothing rolled yet: Save changes is refused, no dialog
  await finish(app);
  assert.equal(notes.warn.length, 1);
  assert.equal(dialogs.length, 0);
  assert.deepEqual(actor.calls, []);

  // level 2 gains no talent (even level): the class step asks for nothing else
  assert.deepEqual(await classStep(app)._bonusSources(DOCS[FIGHTER]), []);
  nextDie = 6;
  assert.equal(hpStep(app).readOnly, false);
  await hpStep(app).handleAction("cb-roll-hp");
  assert.deepEqual(app.builderState.levelUp.dice, [6]);
  assert.equal((await hpStep(app).prepareContext()).conModLabel, null, "no CON on a level-up die");

  await finish(app);
  const html = dialogs[0].content;
  assert.match(html, /Level<\/span><b>1 → 2/);
  assert.match(html, /Hit points \(maximum\)<\/span><b>5 → 11 \(\+6\)/);
  assert.match(html, /XP<\/span><b>14 → 4/);
  assert.equal(actor._source.system.level.value, 2);
  assert.deepEqual(actor._source.system.attributes.hp, { max: 11, value: 2 }, "current hit points stay");
  assert.equal(actor._source.system.level.xp, 4);
  assert.deepEqual(actor._source.system.luck, { available: true, remaining: 1 });
  assert.equal([...actor.items].length, 3, "no item was created");
  for (const c of actor.calls.filter((x) => x.method === "update" && !x.keys[0].startsWith("flags."))) assert.ok(c.options[MOD]?.builder, "tagged");
  // the builder reloads from the character: one Finish per baseline
  assert.equal(app.builderState.existing.baseline.level, 2);
  assert.equal(app.builderState.levelUp, null);

  // Undo puts the level, the maximum and the XP back
  await undo(app);
  assert.match(dialogs.at(-1).content, /level, hit points maximum and XP go back too/);
  assert.equal(snapOf(actor), before);
});

test("a caster levels 2 to 3: the level-3 talent is rolled, only the new spells are picked, and all of it is created", async () => {
  const actor = makeActor({ cls: WIZARD, level: 2, xp: 20, hp: { max: 6, value: 6 }, items: WIZ_ITEMS() });
  const before = snapOf(actor);
  const app = await openOn(actor);
  await levelUp(app);
  const cls = classStep(app);
  const st = app.builderState;

  const ctx = await cls.extraContext(st.class.item);
  assert.deepEqual(ctx.bonusRolls.map((b) => b.key), ["level-talent-3"], "the one new talent, not the earlier levels'");
  assert.equal(ctx.spells.caster, true);
  assert.deepEqual(ctx.spells.tiers.map((t) => [t.tier, t.count, t.chosen]), [[2, 1, 0]], "tier 1 gains none, tier 2 gains one");
  assert.equal(cls.isComplete(), false);

  await cls.rollBonus("level-talent-3");
  assert.equal(st.bonusRolls[0].chosenUuid, TALENT);
  assert.equal(cls.isComplete(), false, "the tier 2 spell is still due");
  cls.toggleSpell(SPELL(4));
  cls.toggleSpell(SPELL(5));
  assert.deepEqual(st.spells.filter((s) => !s.itemId).map((s) => s.uuid), [SPELL(4)], "the tier is full");
  cls.toggleSpell(SPELL(1));
  assert.equal(st.spells.filter((s) => s.itemId).length, 2, "a held spell is not taken back");
  assert.equal(cls.isComplete(), true);

  nextDie = 3;
  await hpStep(app).handleAction("cb-roll-hp");
  await finish(app);

  const html = dialogs[0].content;
  assert.match(html, /Level<\/span><b>2 → 3/);
  assert.match(html, /Hit points \(maximum\)<\/span><b>6 → 9 \(\+3\)/);
  assert.match(html, /Added<\/span><b>Gladiator/);
  assert.match(html, /Added<\/span><b>Spell 4/);
  const made = [...actor.items].filter((i) => i._id.startsWith("n"));
  assert.deepEqual(made.map((i) => i.name).sort(), ["Gladiator", "Spell 4"]);
  const talent = made.find((i) => i.type === "Talent");
  assert.equal(talent.system.level, 3, "the talent records the level it came at, like the system's");
  assert.equal(talent._stats.compendiumSource, TALENT);
  assert.equal(made.find((i) => i.type === "Spell")._stats.compendiumSource, SPELL(4));
  assert.equal(actor._source.system.level.value, 3);
  assert.equal(actor._source.system.level.xp, 0);
  assert.equal(actor._source.system.attributes.hp.max, 9);
  assert.equal(actor._source.system.attributes.hp.value, 6);
  assert.ok(actor.items.has("amulet1") && actor.items.has("abil1"), "everything else is kept");
  assert.equal([...actor.items].filter((i) => i.type === "Class Ability").length, 1, "no Class Ability is created");

  await undo(app);
  assert.equal(snapOf(actor), before, "the level, the HP maximum, the XP and the new items all go back");
});

test("an odd level's talent blocks Save until it is rolled and, if it offers a choice, chosen", async () => {
  const actor = makeActor({ level: 2, xp: 20, items: CARRIED() });
  const app = await openOn(actor);
  await levelUp(app);
  nextDie = 5;
  await hpStep(app).handleAction("cb-roll-hp");
  await finish(app);
  assert.equal(dialogs.length, 0, "the level-3 talent is still due");
  assert.match(notes.warn[0], /Class/);
  await classStep(app).rollBonus("level-talent-3");
  await finish(app);
  assert.equal(dialogs.length, 1);
});

test("Cancel level up drops the die, the talent and the new spells, and keeps other edits", async () => {
  const app = await openOn(makeActor({ cls: WIZARD, level: 2, xp: 20, items: WIZ_ITEMS() }));
  const st = app.builderState;
  st.stats.values.str = 15;
  await levelUp(app);
  await classStep(app).rollBonus("level-talent-3");
  classStep(app).toggleSpell(SPELL(4));
  st.levelUp.dice = [3];
  await cancel(app);
  assert.equal(st.levelUp, null);
  assert.deepEqual(st.spells.filter((s) => !s.itemId), []);
  assert.deepEqual(st.bonusRolls, []);
  assert.equal(st.stats.values.str, 15);
  const plan = planCommit(st.existing, st, { source: { name: "Hero", system: makeActor({ cls: WIZARD, level: 2, xp: 20 })._source.system }, items: [] });
  assert.equal(plan.system["system.level.value"], undefined);
});

test("the level-up talent is built like a new build's: a choice pre-fills its effect, the level and the compendium link are stamped", async () => {
  const [plain] = await resolveCreate({ kind: "talent", uuid: TALENT, name: "Gladiator", choice: null, level: 3 });
  assert.equal(plain.system.level, 3);
  assert.equal(plain._stats.compendiumSource, TALENT);
  const [picked] = await resolveCreate({ kind: "talent", uuid: CHOICE_TALENT, name: "Weapon Mastery", choice: { slug: "longsword", label: "Longsword" }, level: 5 });
  assert.equal(picked.name, "Weapon Mastery (Longsword)");
  assert.equal(picked.effects[0].changes[0].key, "system.bonuses.longsword");
  assert.deepEqual(await resolveCreate({ kind: "talent", uuid: "Compendium.gone", name: "Gone", level: 3 }), []);
});

test("a level-up plan is idempotent inside one attempt: creates already on the actor are not made twice", async () => {
  const actor = makeActor({ level: 2, xp: 20, items: CARRIED() });
  const { st, plan } = await plannedLevelUp(actor, (s) => {
    s.levelUp.dice = [4];
    s.bonusRolls = [{ key: "level-talent-3", chosenUuid: TALENT, chosenName: "Gladiator", options: [] }];
  });
  const marker = plan.creates[0].rowId;
  const live = [...actor.items].map((i) => i._source);
  live.push({ _id: "made", type: "Talent", name: "Gladiator", flags: { [MOD]: { builderRow: marker } }, system: {} });
  const again = planCommit(st.existing, st, { source: { name: "Hero", system: actor._source.system }, items: live });
  assert.deepEqual(again.creates, []);
});

test("the strings, template and hydration are wired", async () => {
  const hbs = readFileSync(new URL("../templates/char-builder/char-builder.hbs", import.meta.url), "utf8");
  assert.match(hbs, /\{\{#if nav\.levelUpOffer\}\}[\s\S]*?data-action="cb-level-up"/);
  assert.match(hbs, /data-action="cb-level-up-cancel"/);
  assert.equal(en["SDE.charBuilder.levelUp.button"], "Level up");
  assert.match(en["SDE.charBuilder.existing.undoConfirm"], /level, hit points maximum and XP go back too/);
  assert.ok(await hydrateActor(makeActor({ level: 1 })));
  assert.equal(typeof cancelLevelUp, "function");
});
