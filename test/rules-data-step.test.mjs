import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filledTables } from "../scripts/rules-data/rules-data-core.mjs";
import { RULES_TABLES } from "../scripts/importer/tables/table-shapes.mjs";

// The Importer Hub's Rules Data step and the messages that point at it (#299).
// Every table value here is invented; no book ships.

const EN = JSON.parse(readFileSync("languages/en.json", "utf8"));
const format = (key, data = {}) => String(EN[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));

const stored = {};
const notes = { info: [], warn: [], error: [] };
const cards = [];
const player = { id: "p", isGM: false };
const gm = { id: "gm", isGM: true };
Object.assign(globalThis, {
  game: {
    user: gm, journal: null,
    i18n: { localize: (k) => EN[k] ?? k, format },
    settings: { get: (ns, key) => stored[key] },
  },
  ui: { notifications: { info: (m) => notes.info.push(m), warn: (m) => notes.warn.push(m), error: (m) => notes.error.push(m) } },
  ChatMessage: { create: async (data) => { cards.push(data); }, getWhisperRecipients: () => [{ id: "gm" }] },
  Hooks: { on() {} },
});
const { installHubRules } = await import("../scripts/importer/importer-hub-rules.mjs");
const { installHubBatch } = await import("../scripts/importer/importer-hub-batch.mjs");
const { tellMissing } = await import("../scripts/rules-data/rules-data-notice.mjs");

/** A hub with the batch and Rules Data method packs and no Foundry app under it. */
function hub(over = {}) {
  class FakeHub {}
  installHubBatch(FakeHub);
  installHubRules(FakeHub);
  const h = Object.assign(new FakeHub(), { renders: 0, render: async () => { h.renders++; } }, over);
  return h;
}

test("a table is filled when any cell of it is, and Mountain's default elevation doesn't count", () => {
  assert.deepEqual(Object.values(filledTables({})), Array(7).fill(false));
  assert.deepEqual(Object.keys(filledTables({})), RULES_TABLES.map((t) => t.id), "the same tables, in the book's order");
  assert.equal(filledTables({ travel: { walking: 7 } }).travel, true);
  assert.equal(filledTables({ terrain: { forest: { type: "difficult" } } }).terrain, true);
  assert.equal(filledTables({ terrain: { forest: { elevation: "high" } } }).terrain, false);
  assert.equal(filledTables({ climate: [{ region: "Somewhere" }] }).climate, true);
  assert.equal(filledTables({ carousing: { village: null, town: null } }).carousing, false, "every settlement empty is not filled in");
  assert.equal(filledTables({ recruiting: { city: 3 } }).recruiting, true);
});

test("the hub step lists every table with its book and page, and whether it is filled or empty", () => {
  for (const k of Object.keys(stored)) delete stored[k];
  const empty = hub()._rulesStep();
  assert.deepEqual(empty.rows.map((r) => [r.name, r.cite, r.filled]), [
    ["Hexes per day", "GM Guide p.40", false],
    ["Terrain types", "GM Guide p.40", false],
    ["Hex visibility", "GM Guide p.41", false],
    ["Terrain", "GM Guide p.41", false],
    ["Climate", "GM Guide p.43", false],
    ["Carousing limits (gp)", "GM Guide p.30", false],
    ["Recruiting limits (warband level)", "Player's Guide p.249", false],
  ]);
  assert.deepEqual([empty.n, empty.total, empty.complete], [0, 7, false]);

  stored.rulesData = { travel: { walking: 7 }, recruiting: { town: 2 } };
  const some = hub()._rulesStep();
  assert.deepEqual(some.rows.filter((r) => r.filled).map((r) => r.id), ["travel", "recruiting"]);
  assert.equal(some.n, 2);
});

test("the step says which feature waits on which table, in plain words", () => {
  const needs = Object.fromEntries(hub()._rulesStep().rows.map((r) => [r.id, r.needs]));
  assert.match(needs.travel, /^Travel needs it/);
  assert.match(needs.terrain, /^Travel needs it/);
  assert.match(needs.terrainTypes, /^Travel needs it/);
  assert.match(needs.climate, /^Cold storms need it/);
  assert.match(needs.carousing, /^Carousing needs it/);
  assert.match(needs.recruiting, /^Recruiting needs it/);
});

test("the step's button runs the one import, only for a GM, and shows the result", async () => {
  const runs = [];
  const h = hub({ _rulesImport: async () => { runs.push("import"); return true; } });
  await h._onHubRulesImport();
  assert.deepEqual(runs, ["import"]);
  assert.equal(h.renders, 1);

  globalThis.game.user = player;
  notes.warn.length = 0;
  await h._onHubRulesImport();
  globalThis.game.user = gm;
  assert.deepEqual(runs, ["import"], "a player's press does nothing");
  assert.deepEqual(notes.warn, [EN["SDE.importer.notify.gmOnly"]]);
});

test("Import everything ends with the Rules Data when a book is linked, and a folder's Import all does not", async () => {
  const runs = [];
  const h = hub({
    _manageTreeCache: [], _rulesBooksLinked: () => true,
    _rulesImport: async () => { runs.push("rules"); return true; },
  });
  await h._onBatchImport(null, { dataset: {} });
  assert.deepEqual(runs, ["rules"]);

  await h._onBatchImport(null, { dataset: { nodeId: "some-folder", label: "A folder" } });
  assert.deepEqual(runs, ["rules"], "one folder is not everything");
});

test("Import everything says so in one plain line when no book is linked, and imports nothing", async () => {
  const runs = [];
  notes.info.length = 0;
  const h = hub({ _manageTreeCache: [], _rulesBooksLinked: () => false, _rulesImport: async () => { runs.push("rules"); } });
  await h._onBatchImport(null, { dataset: {} });
  assert.deepEqual(runs, []);
  const line = notes.info.at(-1);
  assert.equal(line, EN["SDE.rulesData.batch.notLinked"]);
  assert.match(line, /^Rules Data was not imported: no Game Master's Guide or Player's Guide PDF is linked\./);
  assert.match(line, /Tools > Source PDFs/);
  assert.doesNotMatch(line, /\n/);
});

test("Import everything survives a failing Rules Data import and says why", async () => {
  notes.error.length = 0;
  const h = hub({ _rulesBooksLinked: () => true, _rulesImport: async () => { throw new Error("no pdf.js"); } });
  await h._batchRulesData();
  assert.deepEqual(notes.error, ["Could not read the rules tables: no pdf.js"]);
});

test("the step's button and Import everything press the settings window's own import, not a copy", () => {
  const app = readFileSync("scripts/rules-data/rules-data-app.mjs", "utf8");
  const step = readFileSync("scripts/importer/importer-hub-rules.mjs", "utf8");
  assert.match(step, /\)\.importAndSave\(\)/, "the hub runs importAndSave");
  assert.match(app, /export async function importAndSave\(\)[\s\S]*?importFromBooks\(current\)/, "which is importFromBooks over the saved data");
  assert.match(app, /static async _onImport[\s\S]*?importFromBooks\(current\)/, "and so is the window's button");
  assert.doesNotMatch(step, /readBooks|importOverwrites|applyImport/, "no second copy of the reader or the preview");
});

test("the hub template shows the step and wires both buttons", () => {
  const tpl = readFileSync("templates/importer-hub.hbs", "utf8");
  const app = readFileSync("scripts/importer/importer-hub-app.mjs", "utf8");
  assert.match(tpl, /data-rules-step/);
  assert.match(tpl, /data-action="hubRulesImport"/);
  assert.match(tpl, /data-action="hubRulesEdit"/);
  assert.match(app, /hubRulesImport:\s+function[\s\S]*?_onHubRulesImport/);
  assert.match(app, /hubRulesEdit:\s+function[\s\S]*?_onHubRulesEdit/);
  assert.match(app, /rulesStep: this\._rulesStep\(\)/);
});

test("the step sits inside the Manage strip, out of the paste view (#311)", () => {
  const tpl = readFileSync("templates/importer-hub.hbs", "utf8");
  const manageAt = tpl.indexOf('class="sde-hub-manage"');
  const manageEnd = tpl.indexOf("</details>", manageAt);
  const stepAt = tpl.indexOf("data-rules-step");
  assert.ok(manageAt !== -1 && manageEnd !== -1 && stepAt !== -1, "the whole strip and the step are still in the template");
  assert.ok(stepAt > manageAt && stepAt < manageEnd, "the step is inside the Manage details, not between the paste box and Manage");
  assert.ok(!tpl.slice(0, manageAt).includes("data-rules-step"), "the paste view no longer carries the step");
});

test("Open Rules Data expands the Manage strip before scrolling to the step (#311)", () => {
  const src = readFileSync("scripts/importer/importer-hub-rules.mjs", "utf8");
  const body = src.slice(src.indexOf("static async openRulesData"));
  const expand = body.indexOf("_manageExpanded = true");
  const open = body.indexOf("this.open()");
  const scroll = body.indexOf("scrollIntoView");
  assert.ok(expand !== -1, "the strip is expanded");
  assert.ok(expand < open && open < scroll, "expansion comes before the hub opens, and the scroll comes last");
});

test("the Settings menu entry stays: two doors to one window", () => {
  const settings = readFileSync("scripts/shared/settings.mjs", "utf8");
  assert.match(settings, /registerMenu\(MODULE_ID, "rulesData"[\s\S]*?type: RulesDataApp/);
});

test("a player is never told, and neither is a GM whose table is filled", async () => {
  cards.length = 0;
  for (const k of Object.keys(stored)) delete stored[k];
  globalThis.game.user = player;
  assert.equal(await tellMissing("terrain"), false);
  globalThis.game.user = gm;
  stored.rulesData = { terrain: { forest: { type: "normal", cost: 2 } } };
  assert.equal(await tellMissing("terrain"), false);
  assert.equal(cards.length, 0);
  delete stored.rulesData;
});

test("the notice names the button to press and has a button, whispered to GMs only", async () => {
  cards.length = 0;
  assert.equal(await tellMissing("terrain"), true, "a player's visit and a filled table used none of the one telling");
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.deepEqual(card.whisper, [{ id: "gm" }]);
  assert.match(card.content, /Terrain costs aren&#39;t set/);
  assert.match(card.content, /Importer Hub &gt; Rules Data &gt; Import from GM Guide/);
  assert.match(card.content, /<button type="button" class="ui-btn">[\s\S]*Open Rules Data/);
  assert.equal(card.flags["shadowdark-enhancer"].rulesNotice, "terrain");
});

test("a table is told about once per session, and each table has its own", async () => {
  cards.length = 0;
  assert.equal(await tellMissing("terrain"), false, "already told");
  assert.equal(await tellMissing("climate"), true, "another table has its own notice");
  assert.equal(await tellMissing("climate"), false);
  assert.equal(cards.length, 1);
  assert.match(cards[0].content, /Climate isn&#39;t set/);
});
