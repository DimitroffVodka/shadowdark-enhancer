/**
 * Stat damage (#182) — one Active Effect per damaged ability, summed however
 * many there are, healed whole or one point per ability, and CON 0 kills.
 *
 * The modifier following the score is the system's doing, not ours: its
 * ability `mod` is a getter on `value` (attributeModel, shadowdark-compiled.mjs),
 * so an ADD on `system.abilities.<key>.value` moves both. Checked against the
 * system source; not re-asserted here.
 *
 * The Foundry-bound half runs against a fake actor that keeps effects in a Map
 * and throws when asked to delete one that is already gone, as the server does.
 *
 * #183: monster attacks apply their riders on a hit, a save first when the
 * rider has one. Rider wording in the fixtures is invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ABILITIES, abilityKey, afterHeal, attackRiders, cardMayApply, damageOf, effectAmount,
  parseStatRiders, statDamageEffect,
} from "../scripts/stat-damage/stat-damage-core.mjs";
import { StatDamage } from "../scripts/stat-damage/stat-damage.mjs";
import { StatRiders } from "../scripts/stat-damage/stat-riders.mjs";

const FLAG = (ability) => ({ "shadowdark-enhancer": { statDamage: { ability } } });

/** The Effects-library entry, exactly as shadowdark-extras#148 builds it. */
const libraryDrop = (ability) => ({
  name: `${ability.toUpperCase()} damage`,
  changes: [{ key: `system.abilities.${ability}.value`, mode: 2, value: "-1" }],
  flags: FLAG(ability),
});

// ─── The pure half ─────────────────────────────────────────────────────────

test("ability keys: abbreviation, any case, or the full name", () => {
  assert.equal(abilityKey("STR"), "str");
  assert.equal(abilityKey("con"), "con");
  assert.equal(abilityKey("Charisma"), "cha");
  assert.equal(abilityKey("luck"), null);
  assert.equal(abilityKey(undefined), null);
});

test("a word that merely starts like an ability is not one", () => {
  for (const word of ["strike", "control", "charm", "intent", "wise", "dexter", "st"]) {
    assert.equal(abilityKey(word), null, word);
  }
  assert.equal(abilityKey(" Dexterity "), "dex");
});

test("a character never damaged reads zero in all six", () => {
  assert.deepEqual(damageOf([]), Object.fromEntries(ABILITIES.map((a) => [a, 0])));
  // An unrelated effect is not stat damage, even one that lowers a score.
  const curse = { changes: [{ key: "system.abilities.str.value", mode: 2, value: "-3" }], flags: {} };
  assert.equal(damageOf([curse]).str, 0);
});

test("two one-point STR effects read the same as one two-point effect", () => {
  const two = statDamageEffect("str", 2, "2 STR damage");
  assert.deepEqual(damageOf([libraryDrop("str"), libraryDrop("str")]), damageOf([two]));
  assert.equal(damageOf([two]).str, 2);
});

test("v14's system.changes with a parsed number reads the same as v13's string", () => {
  const v14 = {
    system: { changes: [{ key: "system.abilities.con.value", type: "add", value: -3 }] },
    flags: FLAG("con"),
  };
  assert.equal(effectAmount(v14), 3);
});

test("the effect is the contract shape: a negative ADD on the score, flagged", () => {
  const e = statDamageEffect("wis", 3, "3 WIS damage");
  assert.deepEqual(e.changes, [{ key: "system.abilities.wis.value", mode: 2, value: "-3" }]);
  assert.deepEqual(e.flags, FLAG("wis"));
  assert.ok(!("duration" in e), "lasts until healed");
});

test("a rest heals all; Grinder heals one per damaged ability", () => {
  const hurt = { ...damageOf([]), str: 2, con: 1 };
  assert.deepEqual(afterHeal(hurt), damageOf([]));
  assert.deepEqual(afterHeal(hurt, { all: true }), damageOf([]));
  assert.deepEqual(afterHeal(hurt, { perAbility: 1 }), { ...damageOf([]), str: 1 });
  assert.deepEqual(afterHeal(hurt, { perAbility: 0 }), hurt, "0 heals nothing, not everything");
  assert.deepEqual(afterHeal(hurt, { perAbility: 1, all: true }), damageOf([]));
});

// ─── The Foundry-bound half ────────────────────────────────────────────────

function fakeActor({ type = "Player", con = 10 } = {}) {
  const store = new Map();
  let next = 0;
  const actor = {
    type, id: "a1", uuid: "Actor.a1", isToken: false, documentName: "Actor",
    statuses: new Set(),
    system: { abilities: { con: { value: con } } },
    get effects() { return [...store.values()]; },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) if (!store.delete(id)) throw new Error(`${id} does not exist`);
    },
    async createEmbeddedDocuments(_type, data) {
      for (const d of data) {
        const id = `e${++next}`;
        store.set(id, { ...structuredClone(d), id, parent: actor });
      }
    },
    async toggleStatusEffect(id, { active }) { if (active) actor.statuses.add(id); },
  };
  return actor;
}

globalThis.game = {
  i18n: {
    localize: (k) => ({ "SHADOWDARK.ability_str": "Str", "SHADOWDARK.ability_con": "Con" })[k] ?? k,
    // Stat damage's effect name, or any other string (dying's `{name}` lines).
    format: (k, d = {}) => ("ability" in d ? `${d.amount} ${d.ability} damage` : k),
  },
  user: { id: "gm", isGM: true },
  users: { activeGM: { id: "gm" } },
  combats: [],
};

test("2 STR damage is one effect, named for what it does", async () => {
  const actor = fakeActor();
  assert.equal(await StatDamage.apply(actor, "STR", 2), 2);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].name, "2 STR damage");
  assert.equal(StatDamage.of(actor).str, 2);
});

test("more damage to the same ability stays one effect, even from library drops", async () => {
  const actor = fakeActor();
  await actor.createEmbeddedDocuments("ActiveEffect", [libraryDrop("str"), libraryDrop("str")]);
  assert.equal(await StatDamage.apply(actor, "str", 1), 3);
  assert.equal(actor.effects.length, 1);
  assert.equal(StatDamage.of(actor).str, 3);
});

test("two hits landing together both count, and neither deletes the other's effect", async () => {
  const actor = fakeActor();
  await StatDamage.apply(actor, "str", 1);
  await Promise.all([StatDamage.apply(actor, "str", 1), StatDamage.apply(actor, "str", 1)]);
  assert.equal(StatDamage.of(actor).str, 3);
  assert.equal(actor.effects.length, 1);
});

test("a rest removes it; Grinder takes one off each and leaves the rest", async () => {
  const actor = fakeActor();
  await StatDamage.apply(actor, "str", 2);
  await StatDamage.apply(actor, "con", 1);
  assert.deepEqual(await StatDamage.heal(actor, { perAbility: 1 }), { ...damageOf([]), str: 1 });
  assert.deepEqual(actor.effects.map((e) => e.name), ["1 STR damage"]);
  await StatDamage.heal(actor);
  assert.equal(actor.effects.length, 0);
});

test("nothing touches a character with no stat damage, or an NPC", async () => {
  const actor = fakeActor();
  actor.deleteEmbeddedDocuments = () => assert.fail("nothing to delete");
  actor.createEmbeddedDocuments = () => assert.fail("nothing to create");
  await StatDamage.heal(actor);
  assert.equal(await StatDamage.apply(fakeActor({ type: "NPC" }), "str", 1), null);
  assert.equal(await StatDamage.apply(actor, "luck", 1), null);
  assert.equal(await StatDamage.apply(actor, "str", 0), null);
});

test("CON reaching 0 kills; above 0, or another ability, does not", async () => {
  const dying = fakeActor({ con: 0 });
  await StatDamage._checkCon({ ...statDamageEffect("con", 10, ""), parent: dying });
  assert.ok(dying.statuses.has("dead"));

  const alive = fakeActor({ con: 1 });
  await StatDamage._checkCon({ ...statDamageEffect("con", 9, ""), parent: alive });
  assert.ok(!alive.statuses.has("dead"));

  const weak = fakeActor({ con: 0 });
  await StatDamage._checkCon({ ...statDamageEffect("str", 10, ""), parent: weak });
  assert.ok(!weak.statuses.has("dead"));
});

test("CON 0 spares a character with no death at 0 CON (River of Death, #181)", async () => {
  const actor = fakeActor({ con: 0 });
  actor.flags = { "shadowdark-enhancer": { noDeathAtZeroCon: true } };
  await StatDamage._checkCon({ ...statDamageEffect("con", 10, ""), parent: actor });
  assert.ok(!actor.statuses.has("dead"));
});

test("two CON effects created in one batch mark the character dead once", async () => {
  const actor = fakeActor({ con: 0 });
  let toggles = 0;
  actor.toggleStatusEffect = async (id, { active } = {}) => {
    if (id === "dead") toggles++; // dying's death also clears its own status
    await null; // the status lands after a server round trip, not at once
    if (active) actor.statuses.add(id);
  };
  const effect = { ...statDamageEffect("con", 5, ""), parent: actor };
  await Promise.all([StatDamage._checkCon(effect), StatDamage._checkCon(effect)]);
  assert.equal(toggles, 1);
});

test("only the active GM kills, so every client seeing the effect does not race", async () => {
  const actor = fakeActor({ con: 0 });
  globalThis.game.user = { id: "player", isGM: false };
  try {
    await StatDamage._checkCon({ ...statDamageEffect("con", 10, ""), parent: actor });
  } finally {
    globalThis.game.user = { id: "gm", isGM: true };
  }
  assert.ok(!actor.statuses.has("dead"));
});

// ─── #183: reading riders out of monster text ──────────────────────────────

const rider = (ability, amount, save = null) => ({ ability, amount, save });

test("a plain rider, fixed or rolled", () => {
  assert.deepEqual(parseStatRiders("1 STR damage"), [rider("str", "1")]);
  assert.deepEqual(parseStatRiders("Target takes 1d4 Constitution damage."), [rider("con", "1d4")]);
});

test("a rider behind a save carries the save", () => {
  assert.deepEqual(parseStatRiders("DC 12 CON or 1d4 STR damage"),
    [rider("str", "1d4", { ability: "con", dc: 12 })]);
  assert.deepEqual(parseStatRiders("DC 15 WIS check or takes 2 CHA damage"),
    [rider("cha", "2", { ability: "wis", dc: 15 })]);
});

test("the importer's enriched markup and HTML read the same as the prose", () => {
  assert.deepEqual(parseStatRiders("[[request 12 con]] or [[/r 1d4]] STR damage"),
    parseStatRiders("DC 12 CON or 1d4 STR damage"));
  assert.deepEqual(parseStatRiders("<p><strong>Wither.</strong> 1&nbsp;DEX damage.</p>"),
    [rider("dex", "1")]);
});

test("hit-point damage and saves against anything else are not stat damage", () => {
  assert.deepEqual(parseStatRiders("1d6 damage"), []);
  assert.deepEqual(parseStatRiders("DC 12 CON or be poisoned"), []);
  assert.deepEqual(parseStatRiders(""), []);
});

test("a rider can live in the NPC feature the attack names", () => {
  const attack = { name: "Touch", system: { damage: { special: "wither" }, description: "wither" } };
  const items = [
    { type: "NPC Feature", name: "Wither", system: { description: "<p>1 STR damage.</p>" } },
    { type: "NPC Feature", name: "Aura", system: { description: "<p>1 WIS damage.</p>" } },
  ];
  assert.deepEqual(attackRiders(attack, items), [rider("str", "1")], "only the named feature");
});

test("an attack with no rider of its own takes the feature of the same name", () => {
  // The system bestiary's Wight: a bare "Life Drain" attack, the rider on a feature.
  const lifeDrain = { type: "NPC Feature", name: "Life Drain", system: { description: "<p>1d4 CON damage.</p>" } };
  const bare = { name: "Life Drain", system: { damage: { special: "" }, description: "" } };
  assert.deepEqual(attackRiders(bare, [lifeDrain]), [rider("con", "1d4")]);
  // An attack that names its own rider does not also pick up a namesake.
  const named = { name: "Life Drain", system: { damage: { special: "chill" }, description: "" } };
  assert.deepEqual(attackRiders(named, [lifeDrain]), []);
});

test("a rider mirrored into the description, enriched or not, counts once", () => {
  const attack = { system: { damage: { special: "[[/r 1d4]] STR damage" }, description: "1d4 STR damage" } };
  assert.deepEqual(attackRiders(attack, []), [rider("str", "1d4")]);
});

// ─── #183: the hit ─────────────────────────────────────────────────────────

const docs = new Map();
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
// `create` is dying's death line, posted when CON 0 kills (#181).
globalThis.ChatMessage = { getSpeaker: ({ actor }) => ({ alias: actor.name }), create: async (data) => data };
const chat = [];
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() { this.total = /d/.test(this.formula) ? 3 : Number(this.formula); return this; }
  async toMessage(data) { chat.push({ ...data, total: this.total }); }
};

/** A character to hit, whose own client would roll `save` as the check's success. */
function hitTarget(save) {
  const target = fakeActor();
  Object.assign(target, {
    uuid: "Actor.pc", name: "Brin", isOwner: true,
    testUserPermission: () => true,
    checks: [],
  });
  target.system.rollStatCheck = async (ability, config) => {
    target.checks.push({ ability, ...config });
    return { success: save };
  };
  docs.set("Actor.pc", target);
  return target;
}

/** A GM, and a player who owns nothing but what `owns` lists. */
const GM = { isGM: true };
const player = (owns = []) => ({ isGM: false, owns });

function monsterCard({
  special, hit = true, attackerType = "NPC", features = [], author = GM, borrowed = false,
}) {
  const attacker = {
    documentName: "Actor", uuid: "Actor.npc", type: attackerType, name: "Barrow Wight", items: features,
    testUserPermission: (user, level) => level === "OWNER" && !!user.owns?.includes("Actor.npc"),
  };
  docs.set("Actor.npc", attacker);
  // `borrowed`: a Ghost's attack named by uuid on a card that says the wight swung.
  const parent = borrowed ? { uuid: "Actor.ghost" } : attacker;
  docs.set("Item.atk", { name: "Touch", parent, system: { damage: { special } } });
  return {
    author,
    flags: { shadowdark: { rollConfig: {
      type: "attack", targetUuid: "Actor.pc", actorUuid: "Actor.npc", itemUuid: "Item.atk",
    } } },
    rolls: [{ success: hit }],
  };
}

/** Every connected player, as `globalThis.game.users.filter` sees them. None unless a test adds one. */
const withPlayers = async (players, fn) => {
  globalThis.game.users.filter = (pred) => players.filter(pred);
  try { await fn(); } finally { globalThis.game.users.filter = () => []; }
};
globalThis.game.users.filter = () => [];

test("a hit from an attack that says 1 STR damage lowers STR by 1", async () => {
  chat.length = 0;
  const target = hitTarget(false);
  await StatRiders._onAttackCard(monsterCard({ special: "1 STR damage" }));
  assert.equal(StatDamage.of(target).str, 1);
  assert.equal(chat.length, 1, "the amount is rolled in chat");
});

test("only a GM's card, or one from the attacker's owner, naming the attacker's own attack", async () => {
  const cases = [
    [{ authorIsGM: true, attackOwnerUuid: "Actor.npc", attackerUuid: "Actor.npc" }, true],
    [{ authorOwnsAttacker: true, attackOwnerUuid: "Actor.npc", attackerUuid: "Actor.npc" }, true],
    [{ attackOwnerUuid: "Actor.npc", attackerUuid: "Actor.npc" }, false],
    [{ authorIsGM: true, attackOwnerUuid: "Actor.ghost", attackerUuid: "Actor.npc" }, false],
    [{ authorIsGM: true, attackOwnerUuid: undefined, attackerUuid: undefined }, false],
  ];
  for (const [facts, verdict] of cases) assert.equal(cardMayApply(facts), verdict, JSON.stringify(facts));

  const forged = hitTarget(false);
  await StatRiders._onAttackCard(monsterCard({ special: "1 STR damage", author: player() }));
  await StatRiders._onAttackCard(monsterCard({ special: "1 STR damage", borrowed: true }));
  assert.equal(StatDamage.of(forged).str, 0, "a player's forged card, or a borrowed attack");

  const ally = hitTarget(false);
  await StatRiders._onAttackCard(monsterCard({ special: "1 STR damage", author: player(["Actor.npc"]) }));
  assert.equal(StatDamage.of(ally).str, 1, "the player who owns the attacker");
});

test("a miss applies nothing", async () => {
  const target = hitTarget(false);
  await StatRiders._onAttackCard(monsterCard({ special: "1 STR damage", hit: false }));
  assert.equal(StatDamage.of(target).str, 0);
});

test("a character's own weapon is not a monster attack", async () => {
  const target = hitTarget(false);
  await StatRiders._onAttackCard(monsterCard({ special: "1 STR damage", attackerType: "Player" }));
  assert.equal(StatDamage.of(target).str, 0);
});

test("the target's player makes the save; the damage lands only when it fails", async () => {
  for (const saved of [true, false]) {
    const target = hitTarget(null);
    const asked = [];
    await withPlayers([{
      active: true, isGM: false, character: { id: target.id },
      query: async (name, data) => { asked.push({ name, data }); return { ok: true, saved }; },
    }], () => StatRiders._onAttackCard(monsterCard({ special: "DC 12 CON or 1d4 STR damage" })));
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].data, { actorUuid: "Actor.pc", ability: "con", dc: 12, source: "Touch", title: "SDE.statDamage.saveTitle" });
    assert.equal(target.checks.length, 0, "the GM did not roll it too");
    assert.equal(StatDamage.of(target).str, saved ? 0 : 3);
  }
});

test("with no player to ask, or one who does not answer, the GM rolls the save", async () => {
  const passes = hitTarget(true);
  await StatRiders._onAttackCard(monsterCard({ special: "DC 12 CON or 1d4 STR damage" }));
  assert.deepEqual(passes.checks.map((c) => [c.ability, c.mainRoll.dc, c.skipPrompt]), [["con", 12, true]]);
  assert.equal(StatDamage.of(passes).str, 0);

  const fails = hitTarget(false);
  await withPlayers([{
    active: true, isGM: false, character: null,
    query: async () => { throw new Error("timed out"); },
  }], () => StatRiders._onAttackCard(monsterCard({ special: "DC 12 CON or 1d4 STR damage" })));
  assert.equal(fails.checks.length, 1);
  assert.equal(StatDamage.of(fails).str, 3);
});

test("the player's client rolls the save only when a GM asks, for a character it owns", async () => {
  const target = hitTarget(false);
  const ask = { actorUuid: "Actor.pc", ability: "con", dc: 12, source: "Touch" };
  assert.deepEqual(await StatRiders.handleSaveQuery(ask, { isGM: false }), { ok: false });
  assert.equal(target.checks.length, 0);

  assert.deepEqual(await StatRiders.handleSaveQuery(ask, { isGM: true }), { ok: true, saved: false });
  assert.deepEqual(target.checks.map((c) => [c.ability, c.mainRoll.dc, c.skipPrompt]), [["con", 12, false]]);

  target.isOwner = false;
  assert.deepEqual(await StatRiders.handleSaveQuery(ask, { isGM: true }), { ok: false });
});

test("a save asked with its own title shows it; without one it reads \"Save against {source}\" (#233)", async () => {
  const target = hitTarget(false);
  const ask = { actorUuid: "Actor.pc", ability: "int", dc: 12, source: "Forage" };
  await StatRiders.handleSaveQuery({ ...ask, title: "Mine forages (INT, DC 12)" }, { isGM: true });
  await StatRiders.handleSaveQuery(ask, { isGM: true });
  assert.deepEqual(target.checks.map((c) => c.title), ["Mine forages (INT, DC 12)", "SDE.statDamage.saveTitle"]);
});
