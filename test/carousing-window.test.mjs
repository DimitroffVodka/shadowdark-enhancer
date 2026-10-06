import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const M = "shadowdark-enhancer";
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base } }, utils: { randomID: () => "id" } };
const { CarousingApp } = await import("../scripts/carousing/carousing-app.mjs");
const read = path => readFile(new URL(path, import.meta.url), "utf8");

const pc = id => ({ id, uuid: `Actor.${id}`, name: id, type: "Player", flags: {}, testUserPermission: () => false });
function world(participants, tierCost) {
  const actors = ["a", "b", "c"].map(pc), party = { id: "party", uuid: "Actor.party", name: "Crew", type: "NPC", flags: { [M]: { party: true, partyData: { version: 1, members: actors.map(a => a.uuid) }, carousing: { history: [], current: { phase: "setup", tierId: "t1", tiers: [{ id: "t0", description: "Poor", cost: 1, bonus: 0 }, { id: "t1", description: "Comfortable", cost: tierCost, bonus: 1 }], outcomes: [{}], config: {}, results: {},
    participants: actors.map((a, i) => ({ uuid: a.uuid, actorId: a.id, participate: participants[i], confirmed: false })) } } } }, testUserPermission: () => true };
  globalThis.game = { user: { isGM: true, id: "gm", hasPermission: () => true }, actors: { contents: [...actors, party], get: id => [...actors, party].find(a => a.id === id) }, tables: { contents: [] }, packs: [], modules: new Map(), settings: { get: () => false },
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
