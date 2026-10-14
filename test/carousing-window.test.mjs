import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const M = "shadowdark-enhancer";
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base } }, utils: { randomID: () => "id" } };
const { CarousingApp } = await import("../scripts/carousing/carousing-app.mjs");
const read = path => readFile(new URL(path, import.meta.url), "utf8");

const pc = id => ({ id, uuid: `Actor.${id}`, name: id, type: "Player", flags: {}, testUserPermission: () => false });
function world(participants, tierCost, { config = {}, limits = {} } = {}) {
  const actors = ["a", "b", "c"].map(pc), party = { id: "party", uuid: "Actor.party", name: "Crew", type: "NPC", flags: { [M]: { party: true, partyData: { version: 1, members: actors.map(a => a.uuid) }, carousing: { history: [], current: { phase: "setup", tierId: "t1", tiers: [{ id: "t0", description: "Poor", cost: 1, bonus: 0 }, { id: "t1", description: "Comfortable", cost: tierCost, bonus: 1 }], outcomes: [{}], config, results: {},
    participants: actors.map((a, i) => ({ uuid: a.uuid, actorId: a.id, participate: participants[i], confirmed: false })) } } } }, testUserPermission: () => true };
  globalThis.game = { user: { isGM: true, id: "gm", hasPermission: () => true }, actors: { contents: [...actors, party], get: id => [...actors, party].find(a => a.id === id) }, tables: { contents: [] }, packs: [], modules: new Map(), settings: { get: () => false },
    shadowdarkEnhancer: { rules: { carousingLimit: kind => limits[kind] ?? null } },
    i18n: { localize: k => k, format: (k, d) => `${k}:${JSON.stringify(d)}` } };
  globalThis.Hooks = { callAll() {} };
  return party;
}

test("the context carries one party tier, one shared cost and one share for the joining headcount", async () => {
  const party = world([true, true, false], 7);
  const context = await new CarousingApp(party)._prepareContext();
  assert.equal(context.tier.bonus, 1);
  assert.equal(context.count, 2);
  assert.equal(context.costText, 'SDE.carousing.gp:{"n":7}');
  assert.equal(context.shareText, 'SDE.carousing.gp:{"n":"3–4"}');
  assert.equal(context.eachLabel, 'SDE.carousing.eachPays:{"n":2}');
  assert.ok(context.rows.every(row => !("tiers" in row)), "no per-character tier lists");
});

test("the Carousing template has one tier select, a shared-cost line and a Joining switch per character", async () => {
  const hbs = await read("../templates/carousing/carousing.hbs");
  assert.match(hbs, /^<section class="sde-ui ui-body sde-carousing-body/);
  assert.equal((hbs.match(/<select[^>]*data-tier/g) ?? []).length, 1);
  assert.ok(!/data-choice="tierId"|<fieldset|<legend|garb|mask|lantern/i.test(hbs));
  for (const hook of ['data-choice="participate"', 'data-action="confirm"', 'data-action="start"', 'data-action="begin"', 'data-action="cancel"', 'data-action="resume"', "{{costText}}", "{{shareText}}", "{{eachLabel}}", 'class="ui-switch"']) assert.ok(hbs.includes(hook), hook);
});

test("every string the Carousing template localizes exists in en.json, and none of the dropped ones remain", async () => {
  const [hbs, lang] = await Promise.all([read("../templates/carousing/carousing.hbs"), read("../languages/en.json").then(JSON.parse)]);
  const keys = [...hbs.matchAll(/localize ['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(keys.length > 15);
  for (const key of keys) assert.ok(key in lang, key);
  assert.ok(!hbs.includes("SDE.proposed"));
  for (const gone of ["ownSpend", "tierChoice", "costLine", "costNobody", "participate"]) assert.ok(!(`SDE.carousing.${gone}` in lang), gone);
});

test("no old Carousing rules are left in the Party sheet stylesheet", async () => {
  assert.ok(!(await read("../styles/party-sheet.css")).includes(".sde-carousing-body"));
});

test("the setup asks one rulebook question, only when more than one book is imported or the world chose its own tables", async () => {
  const { registerCarousing } = await import("../scripts/carousing/carousing.mjs");
  const hooks = new Map(); globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), callAll() {} }; globalThis.CONFIG = { queries: {} };
  registerCarousing();
  const prepare = async (party, ids) => {
    globalThis.game.tables.contents = ids.map(id => ({ uuid: `RollTable.${id}`, name: `Table ${id}`, flags: id.includes("-") ? { [M]: { manifestId: id } } : {} }));
    hooks.get("updateRollTable")();
    return new CarousingApp(party)._prepareContext();
  };
  const imported = ["armor-benefit", "pgwr-carousing-outcome", "core-carousing-outcome", "Zebra"];
  let context = await prepare(world([true, false, false], 7), imported);
  assert.deepEqual(context.books.map(b => [b.label, b.value, b.selected]), [["SDE.carousing.book.core", "RollTable.core-carousing-outcome", true], ["SDE.carousing.book.pgwr", "RollTable.pgwr-carousing-outcome", false]]);
  assert.deepEqual([context.showBooks, context.ownBook], [true, null]);
  for (const list of ["events", "outcomes", "benefitTables", "mishapTables"]) assert.ok(!(list in context), `${list} is not offered any more`);
  context = await prepare(world([true, false, false], 7, { config: { outcome: "RollTable.pgwr-carousing-outcome" } }), imported);
  assert.deepEqual(context.books.map(b => b.selected), [false, true]);
  context = await prepare(world([true, false, false], 7), ["core-carousing-outcome", "Zebra"]);
  assert.deepEqual([context.showBooks, context.books.length], [false, 1], "one imported book is not a question");
  context = await prepare(world([true, false, false], 7, { config: { outcome: "RollTable.Zebra" } }), ["core-carousing-outcome", "Zebra"]);
  assert.deepEqual([context.showBooks, context.ownBook, context.books.some(b => b.selected)], [true, { value: "RollTable.Zebra", label: 'SDE.carousing.ownTables:{"name":"Table Zebra"}' }, false]);
  hooks.get("updateRollTable")();
});

test("each settlement says what it lets the party spend, and a tier above the chosen one is greyed out", async () => {
  const party = world([true, false, false], 7, { config: { settlement: "village" }, limits: { village: 5, town: Infinity, city: 300 } });
  const context = await new CarousingApp(party)._prepareContext();
  const name = kind => `SDE.rulesData.settlement.${kind}`;
  assert.deepEqual(context.settlements.map(s => [s.value, s.label, s.selected]), [
    ["none", "SDE.carousing.noSettlement", false],
    ["village", `SDE.carousing.settlementUpTo:${JSON.stringify({ name: name("village"), n: 5 })}`, true],
    ["town", `SDE.carousing.settlementNoLimit:${JSON.stringify({ name: name("town"), n: null })}`, false],
    ["city", `SDE.carousing.settlementUpTo:${JSON.stringify({ name: name("city"), n: 300 })}`, false],
    ["city_state", `SDE.carousing.settlementUnset:${JSON.stringify({ name: name("city_state"), n: null })}`, false]]);
  assert.deepEqual(context.tiers.map(tier => [tier.id, tier.disabled]), [["t0", false], ["t1", true]]);
  const roomy = await new CarousingApp(world([true, false, false], 7, { config: { settlement: "city" }, limits: { city: 300 } }))._prepareContext();
  assert.deepEqual(roomy.tiers.map(tier => tier.disabled), [false, false]);
  const none = await new CarousingApp(world([true, false, false], 7))._prepareContext();
  assert.deepEqual(none.tiers.map(tier => tier.disabled), [false, false], "no settlement: nothing is above the limit");
});

test("the setup form has the rulebook and settlement selects and no table pickers, and a result lists its benefits and mishaps", async () => {
  const hbs = await read("../templates/carousing/carousing.hbs");
  for (const hook of ['data-config="outcome"', 'data-config="settlement"', 'data-config="place"', "result.benefits", "result.mishaps", 'class="cr-mishap"', "{{#if disabled}}disabled{{/if}}"]) assert.ok(hbs.includes(hook), hook);
  for (const gone of ['data-config="event"', 'data-config="benefit"', 'data-config="mishap"']) assert.ok(!hbs.includes(gone), gone);
});
