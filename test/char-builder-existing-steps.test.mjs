import test from "node:test";
import assert from "node:assert/strict";
import { CharBuilderState } from "../scripts/char-builder/state.mjs";
import { hydrateState } from "../scripts/char-builder/hydrate.mjs";
import { planCommit } from "../scripts/char-builder/commit-plan.mjs";
import { coinsAfterGear } from "../scripts/char-builder/commit.mjs";
import { STAT_METHODS } from "../scripts/char-builder/constants.mjs";
import { StatsStep } from "../scripts/char-builder/steps/stats-step.mjs";
import { ClassStep } from "../scripts/char-builder/steps/class-step.mjs";
import { AncestryStep } from "../scripts/char-builder/steps/ancestry-step.mjs";
import { ListStep } from "../scripts/char-builder/steps/list-step.mjs";
import { LanguagesStep } from "../scripts/char-builder/steps/languages-step.mjs";
import { GearStep } from "../scripts/char-builder/steps/gear-step.mjs";
import { HpStep } from "../scripts/char-builder/steps/hp-step.mjs";
import { GoldStep } from "../scripts/char-builder/steps/gold-step.mjs";
import { PreviewStep } from "../scripts/char-builder/steps/preview-step.mjs";

/**
 * The builder's steps for an EXISTING actor (#168 P4a): every branch keys on
 * state.existing, which only hydration sets.
 */

const prev = { game: globalThis.game, CONFIG: globalThis.CONFIG, fromUuid: globalThis.fromUuid, shadowdark: globalThis.shadowdark };
let fixedGold = 0;
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k },
  user: { isGM: false, can: () => false },
  settings: { get: (_m, key) => (key === "charBuilderStartingGold" ? fixedGold : false) },
};
globalThis.CONFIG = { SHADOWDARK: {} };
globalThis.shadowdark = { compendiums: { spells: async () => [] } };
globalThis.fromUuid = async (u) => (u.endsWith(".common") ? { name: "Common" } : null);
test.after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
});

const CLASS_UUID = "Compendium.shadowdark.classes.Item.wizard";
const item = (id, type, name, extra = {}) => ({ _id: id, type, name, img: "i.webp", system: {}, flags: {}, _stats: {}, ...extra });
const torch = (id) => item(id, "Basic", "Torch", {
  system: { quantity: 1, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } },
  _stats: { compendiumSource: "Compendium.shadowdark.gear.Item.torch" },
});

function snap(over = {}, items = []) {
  return {
    actorId: "a1", sessionId: "s1", name: "Zed", img: "x.webp", tokenImg: null, defaultArt: [],
    system: {
      abilities: { str: { value: 17 }, dex: { value: 17 }, con: { value: 17 }, int: { value: 17 }, wis: { value: 17 }, cha: { value: 17 } },
      level: { value: 3, xp: 0 }, alignment: "neutral",
      ancestry: "Compendium.shadowdark.ancestries.Item.human", class: CLASS_UUID,
      background: "", deity: "", patron: null,
      attributes: { hp: { max: 9, value: 9 } }, coins: { gp: 5, sp: 0, cp: 0 },
      languages: ["Compendium.shadowdark.languages.Item.common", "Compendium.shadowdark.languages.Item.lost"],
      ...over,
    },
    items,
  };
}
const wizardDoc = (over = {}) => ({
  uuid: CLASS_UUID, name: "Wizard",
  system: {
    classTalentTable: "Compendium.x.table", hitPoints: "d4",
    spellcasting: { ability: "int", class: CLASS_UUID, spellsknown: { 3: { 1: 3, 2: 1 } } },
    ...over,
  },
});
const spells = () => [
  ...[1, 2, 3].map((n) => item(`s${n}`, "Spell", `Spell ${n}`, { system: { tier: 1 } })),
  item("s4", "Spell", "Spell 4", { system: { tier: 2 } }),
];
const hydrated = (over, items, resolved = { class: wizardDoc(), spellPool: [] }) => hydrateState(snap(over, items), resolved);

const app = (state) => ({ builderState: state, steps: [], render: async () => {}, _lockedCensus: null });

// --- Stats ---------------------------------------------------------------------

test("manual is a stat method with typed integers, not a roll or a spread", () => {
  assert.equal(STAT_METHODS.manual.manual, true);
  assert.ok(!STAT_METHODS.manual.pointBuy && !STAT_METHODS.manual.fixed && !STAT_METHODS.manual.formula);
});

for (const method of ["point-buy", "standard-array", "3d6-reroll"]) {
  test(`hydrated 17s survive the stats step even when the state carries ${method}`, async () => {
    const st = hydrated({}, []);
    st.stats.method = method;   // the trap: a GM method must never reset a hydrated spread
    const step = new StatsStep(app(st));
    const ctx = await step.prepareContext();
    assert.deepEqual(Object.values(st.stats.values), [17, 17, 17, 17, 17, 17]);
    assert.equal(ctx.isManual, true);
    assert.equal(step.isComplete(), true);
    assert.equal(step.supportsRandom(), false);
    assert.equal(await step.handleAction("cb-reset-stats"), false);
    assert.deepEqual(Object.values(st.stats.values), [17, 17, 17, 17, 17, 17]);
  });
}

test("a typed ability is rounded and floored at 0; zero leaves the step incomplete", () => {
  const st = hydrated({}, []);
  const step = new StatsStep(app(st));
  step.setManual("str", "12.5");
  assert.equal(st.stats.values.str, 13);
  step.setManual("dex", "-3");
  assert.equal(st.stats.values.dex, 0);
  assert.equal(step.isComplete(), false);
  step.setManual("dex", "abc");
  assert.equal(st.stats.values.dex, 0);
});

test("planCommit writes an integer of 0 or more, so Finish converges", () => {
  const st = hydrated({}, []);
  st.stats.values.str = 12.5;
  st.stats.values.dex = -1;
  const live = { source: { name: "Zed", system: snap().system }, items: [] };
  const plan = planCommit(st.existing, st, live);
  assert.equal(plan.system["system.abilities.str.value"], 13);
  assert.equal(plan.system["system.abilities.dex.value"], 0);
});

// --- Ancestry and class are read-only ----------------------------------------------

test("ancestry and class picks cannot change for an existing actor", async () => {
  const st = hydrated({}, []);
  const anc = new AncestryStep(app(st));
  const cls = new ClassStep(app(st));
  const before = { anc: st.ancestry, cls: st.class };
  anc._items = [{ uuid: "other", name: "Elf", system: {} }];
  cls._items = [{ uuid: "other", name: "Fighter", system: {} }];
  await anc.select("other");
  await cls.select("other");
  await anc.randomize();
  await cls.randomize();
  assert.equal(st.ancestry, before.anc);
  assert.equal(st.class, before.cls);
  assert.equal(anc.isComplete(), true);
});

test("an unresolved ancestry UUID keeps its string and never blocks", async () => {
  const st = hydrated({}, [], { class: null, spellPool: [] });
  assert.equal(st.ancestry.unresolved, true);
  const anc = new AncestryStep(app(st));
  anc._items = [];
  const ctx = await anc.prepareContext();
  assert.equal(ctx.readOnly, true);
  assert.deepEqual(ctx.list.entries.map((e) => e.name), ["human"]);
  assert.equal(anc.isComplete(), true);
});

// --- Class completeness ---------------------------------------------------------------

test("a hydrated level-3 caster with no bonus rolls is complete", () => {
  const st = hydrated({}, spells());
  const step = new ClassStep(app(st));
  // a fresh build would block on the level-3 talent roll, the level-1 roll and the language slots
  step._bonusCache = { key: "k", sources: [{ key: "level-talent-3" }] };
  step._pendingChoiceKeys = ["fixed:x"];
  assert.equal(step.isComplete(), true);
  const fresh = hydrated({}, spells());
  fresh.existing = null;
  const freshStep = new ClassStep(app(fresh));
  freshStep._bonusCache = { key: "k", sources: [{ key: "level-talent-3" }] };
  assert.equal(freshStep.isComplete(), false, "the same state as a new build still blocks");
});

test("a hydrated caster still needs its spells, and a patron class its patron", () => {
  const short = new ClassStep(app(hydrated({}, spells().slice(0, 2))));
  assert.equal(short.isComplete(), false);
  const patron = new ClassStep(app(hydrated({}, [], {
    class: wizardDoc({ spellcasting: { class: "__not_spellcaster__" }, patron: { required: true, startingBoons: 1 } }),
    spellPool: [],
  })));
  assert.equal(patron.isComplete(), false);
  patron.state.patron = { uuid: "Compendium.x.patron", name: "Kytheros" };
  assert.equal(patron.isComplete(), true);
});

test("an unresolved class and a level-0 build with no class both complete", () => {
  const unresolved = new ClassStep(app(hydrated({}, spells(), { spellPool: [] })));
  assert.equal(unresolved.state.class.unresolved, true);
  assert.equal(unresolved.isComplete(), true);
  const funnel = hydrated({ class: "", ancestry: "", level: { value: 0, xp: 0 } }, [torch("g1")], { spellPool: [] });
  assert.equal(funnel.level0, true);
  assert.equal(new ClassStep(app(funnel)).isComplete(), true);
});

test("the existing class step offers no talent roll, bonus roll or language choice", async () => {
  const st = hydrated({}, spells());
  const ctx = await new ClassStep(app(st)).extraContext(st.class.item);
  assert.equal(ctx.talent.hasTable, false);
  assert.deepEqual(ctx.bonusRolls, []);
  assert.deepEqual(ctx.choices, []);
  assert.equal(ctx.spells.caster, true);
});

// --- Languages -------------------------------------------------------------------------

test("the languages step lists what the actor knows and never touches the state", async () => {
  const st = hydrated({}, []);
  st.languageChoices = { common: ["keep"], rare: [], select: [] };
  const before = [...st.languages];
  const step = new LanguagesStep(app(st));
  await step._data();
  const ctx = await step.prepareContext();
  await step.randomize();
  step.toggle("common", "x");
  assert.deepEqual(st.languages, before);
  assert.deepEqual(st.languageChoices, { common: ["keep"], rare: [], select: [] });
  assert.deepEqual(ctx.known.map((l) => l.name), ["Common", "lost"]);
  assert.equal(ctx.readOnly, true);
  assert.equal(step.isComplete(), true);
});

// --- HP and gold ---------------------------------------------------------------------------

test("HP is the stored base for an existing actor: no dice, never blocks", async () => {
  const st = hydrated({}, []);
  const step = new HpStep(app(st));
  const ctx = await step.prepareContext();
  assert.equal(ctx.existing, true);
  assert.equal(ctx.hp, 9);
  assert.equal(step.supportsRandom(), false);
  assert.equal(await step.handleAction("cb-roll-hp"), false);
  await step.randomize();
  assert.deepEqual(st.hp, { max: 9, bonus: 0, hydrated: true });
  st.hp.max = 0;
  assert.equal(step.isComplete(), true);
});

test("gold keeps the actor's coins: the GM's starting gold is not applied", async () => {
  fixedGold = 50;
  try {
    const st = hydrated({ coins: { gp: 5, sp: 3, cp: 1 } }, []);
    const step = new GoldStep(app(st));
    const ctx = await step.prepareContext();
    await step.randomize();
    assert.deepEqual(st.coins, { gp: 5, sp: 3, cp: 1 });
    assert.equal(ctx.existing, true);
    assert.equal(step.supportsRandom(), false);
    assert.equal(step.isComplete(), true);
    // a new build still takes the fixed amount
    const fresh = new GoldStep(app({ coins: { gp: 0, sp: 0, cp: 0 }, goldRolled: false, existing: null }));
    await fresh.prepareContext();
    assert.equal(fresh.state.coins.gp, 50);
  } finally { fixedGold = 0; }
});

// --- Gear ---------------------------------------------------------------------------------------

const SHOP_TORCH = {
  uuid: "Compendium.shadowdark.gear.Item.torch", name: "Torch", img: "t.webp", type: "Basic",
  system: { cost: { gp: 0, sp: 0, cp: 5 }, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } },
};
const gearStep = (st) => { const s = new GearStep(app(st)); s._items = [SHOP_TORCH]; return s; };

test("addToCart never merges into an owned row: two owned torches stay two", () => {
  const st = hydrated({}, [torch("t1"), torch("t2")]);
  const step = gearStep(st);
  step.addToCart(SHOP_TORCH.uuid);
  assert.deepEqual(st.gear.map((g) => [g.rowId ?? "new", g.qty]), [["t1", 1], ["t2", 1], ["new", 1]]);
  step.addToCart(SHOP_TORCH.uuid);
  assert.deepEqual(st.gear.map((g) => g.qty), [1, 1, 2], "a second purchase merges into the new row only");
  assert.equal(st.gear[0].owned && st.gear[1].owned, true);
});

test("the cart charges only new rows, and only they cost coins", () => {
  const st = hydrated({ coins: { gp: 1, sp: 0, cp: 0 } }, [torch("t1")]);
  st.gear[0].costCp = 500;   // even a row that somehow carries a price is not charged
  const step = gearStep(st);
  step.addToCart(SHOP_TORCH.uuid);
  step.addToCart(SHOP_TORCH.uuid);
  assert.equal(step.cartTotals().costCp, 10);
  assert.deepEqual(coinsAfterGear(st), { gp: 0, sp: 9, cp: 0 });
});

test("removeFromCart works by row: an owned row drops one, a new row is found by its key", () => {
  const st = hydrated({}, [torch("t1"), torch("t2")]);
  st.gear[0].qty = 2;
  const step = gearStep(st);
  step.removeFromCart("t1");
  assert.equal(st.gear[0].qty, 1);
  step.removeFromCart("t1");
  assert.deepEqual(st.gear.map((g) => g.rowId), ["t2"], "a row taken to 0 leaves the pack (the planner deletes it)");
  step.addToCart(SHOP_TORCH.uuid);
  step.removeFromCart(SHOP_TORCH.uuid);
  assert.deepEqual(st.gear.map((g) => g.rowId), ["t2"]);
});

test("the cart's plus on an owned row raises that row for free", () => {
  const st = hydrated({}, [torch("t1")]);
  const step = gearStep(st);
  step.addOne("t1");
  assert.equal(st.gear[0].qty, 2);
  assert.equal(st.gear[0].slots, 2);
  assert.equal(step.cartTotals().costCp, 0);
  assert.equal(st.gear.length, 1);
});

test("a fresh build's cart is exactly as before: keyed and merged by uuid", () => {
  const st = hydrated({}, []);
  st.existing = null;
  const step = gearStep(st);
  step.addToCart(SHOP_TORCH.uuid);
  step.addOne(SHOP_TORCH.uuid);
  assert.deepEqual(st.gear.map((g) => [g.uuid, g.qty, g.costCp, "rowId" in g]), [[SHOP_TORCH.uuid, 2, 5, false]]);
  step.removeFromCart(SHOP_TORCH.uuid);
  step.removeFromCart(SHOP_TORCH.uuid);
  assert.equal(st.gear.length, 0);
});

// --- Preview ---------------------------------------------------------------------------------------

test("the preview lists what the builder keeps as-is and never writes", async () => {
  const st = hydrated({}, [item("e1", "Effect", "Damage: STR (-1)"), item("t1", "Talent", "Stout"), torch("g1")]);
  const step = new PreviewStep({ ...app(st), steps: [] });
  const ctx = await step.prepareContext();
  assert.deepEqual(ctx.kept.map((k) => k.name), ["Damage: STR (-1)", "Stout"]);
  const fresh = hydrated({}, []);
  fresh.existing = null;
  assert.equal((await new PreviewStep({ ...app(fresh), steps: [] }).prepareContext()).kept, null);
});

// --- The step heading's summary field -------------------------------------------------------

test("each step heading's summary is supplied by its step context", async () => {
  const st = hydrated({}, []);
  const stats = await new StatsStep(app(st)).prepareContext();
  assert.equal(stats.summary, "SDE.charBuilder.stats.method.label: SDE.charBuilder.stats.method.manual");
  class Pick extends ListStep {
    get stateKey() { return "ancestry"; }
    async loadItems() { return [{ uuid: "Compendium.shadowdark.ancestries.Item.human", name: "Human", img: "i.webp", system: { description: "" } }]; }
  }
  st.ancestry = null;
  const pick = new Pick(app(st));
  assert.equal((await pick.prepareContext()).summary, "", "nothing chosen yet: no summary");
  st.ancestry = { uuid: "Compendium.shadowdark.ancestries.Item.human", name: "Human" };
  assert.equal((await pick.prepareContext()).summary, "Human");
  const fresh = new StatsStep(app(new CharBuilderState({ statMethod: "3d6-down" })));
  assert.equal((await fresh.prepareContext()).summary,
    "SDE.charBuilder.stats.method.label: SDE.charBuilder.stats.method.3d6Down (SDE.charBuilder.stats.methodGm)");
});

test("every step.summary a Character Builder template reads has a step that supplies it", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../templates/char-builder/steps/", import.meta.url);
  const reading = readdirSync(dir).filter((f) => /step\.summary/.test(readFileSync(new URL(f, dir), "utf8"))).map((f) => f.replace(".hbs", ""));
  assert.deepEqual(reading.sort(), ["ancestry", "class", "gear", "preview", "stats"]);
  const supplied = ["list-step", "stats-step", "gear-step", "preview-step"]
    .filter((f) => /\bsummary:/.test(readFileSync(new URL(`../scripts/char-builder/steps/${f}.mjs`, import.meta.url), "utf8")));
  assert.equal(supplied.length, 4);
});
