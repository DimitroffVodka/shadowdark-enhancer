// Rumors given without a draw (#598): one the GM writes (tell), rows the GM picks (pick), and
// give/tell/pick's announce. Rumors, tables and names here are invented.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const M = "shadowdark-enhancer";
// Importing rumors.mjs loads half the module; every Foundry namespace it touches at load time is a stub.
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === "prototype" ? t.prototype : stub()), construct: () => ({}), apply: () => stub() });
const known = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } },
  utils: { randomID: () => `id${Math.random().toString(36).slice(2, 8)}`, debounce: (fn) => fn, escapeHTML: (s) => String(s) },
};
const withStubs = (o) => new Proxy(o, { get: (t, k) => (t[k] === undefined ? stub() : t[k]?.constructor === Object ? withStubs(t[k]) : t[k]) });
globalThis.foundry = withStubs(known);
globalThis._replace = (v) => v;
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
const warnings = [];
globalThis.ui = { notifications: { warn: (m) => warnings.push(m), info() {} } };
globalThis.CONFIG = { Dice: { randomUniform: () => 0.5 } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 }, SORT_INTEGER_DENSITY: 100000 };
globalThis.game = {
  user: { isGM: true }, i18n: { lang: "en", localize: (k) => ({ "SDE.rumors.ledger.general": "General" })[k] ?? k, format: (k) => k },
  settings: { get: () => false, register() {} }, journal: { find: () => null },
  scenes: { active: null }, time: { worldTime: 0, calendar: { timeToComponents: () => ({ dayOfWeek: 0, dayOfMonth: 0, month: 0, year: 1300, hour: 8, minute: 0 }) } }, packs: [], tables: [], actors: [], users: [],
};

const { Rumors, askAndGive } = await import("../scripts/rumors/rumors.mjs");
const { Troubles } = await import("../scripts/troubles/troubles.mjs");
const { SessionRecap } = await import("../scripts/session-recap/session-recap.mjs");
const { Quests } = await import("../scripts/quests/quests.mjs");

/** Every ledger and table write, in order. */
const writes = [];

/** A world ledger that keeps what is written to it: `game.journal` finds it once created; `seed` pages make it exist already. */
function freshLedger(seed = []) {
  const pages = [];
  const entry = {
    getFlag: (_s, k) => (k === "rumorLedger" ? true : undefined),
    pages: Object.assign(pages, {
      contents: pages,
      get: (id) => pages.find((p) => p.id === id),
    }),
    async createEmbeddedDocuments(_type, data) {
      writes.push("ledger");
      for (const d of data) {
        const page = { id: `p${pages.length}`, uuid: `JournalEntry.l.JournalEntryPage.p${pages.length}`, sort: d.sort, name: d.name, flags: structuredClone(d.flags) };
        page.getFlag = (s, k) => page.flags[s]?.[k];
        page.update = async (u) => { page.flags[M].rumorPage = u[`flags.${M}.rumorPage`]; };
        pages.push(page);
      }
    },
    async updateEmbeddedDocuments(_type, data) {
      writes.push("ledger");
      for (const d of data) pages.find((p) => p.id === d._id).flags[M].rumorPage = d[`flags.${M}.rumorPage`];
    },
  };
  let made = seed.length > 0;
  if (made) void entry.createEmbeddedDocuments("JournalEntryPage", seed.map(([region, rumors]) => ({ name: region ?? "General", flags: { [M]: { rumorPage: { region, rumors } } } })));
  writes.length = 0;
  globalThis.game.journal = { find: (fn) => (made && fn(entry) ? entry : null) };
  globalThis.JournalEntry = { create: async () => { made = true; return entry; } };
  return entry;
}

const rumorsOn = (entry) => entry.pages.flatMap((p) => p.flags[M].rumorPage.rumors);

/** A rumor table (the world's, or in `pack`): `rows` are [id, text, drawn?]; records the rows marked drawn. */
function table(name, rows, { pack = null, locked = false } = {}) {
  const tb = { name, uuid: `${pack ? `Compendium.${pack}.` : ""}RollTable.${name}`, pack, compendium: pack ? { locked } : null, marked: [] };
  const results = rows.map(([id, text, drawn = false], i) => ({
    id, uuid: `RollTable.${name}.TableResult.${id}`, documentName: "TableResult", parent: tb, name: text, range: [i + 1, i + 1], drawn,
  }));
  tb.results = { contents: results };
  tb.updateEmbeddedDocuments = async (_type, data) => {
    writes.push("drawn");
    for (const { _id } of data) { tb.marked.push(_id); results.find((r) => r.id === _id).drawn = true; }
  };
  return tb;
}

/** The tables a draw sees: `world` in the sidebar, `packed` in the module's sde-tables pack. */
function serve({ world = [], packed = [] } = {}) {
  globalThis.game.tables = world;
  globalThis.game.packs = packed.length ? [{
    collection: "world.sde-tables", metadata: { packageType: "world", label: "x" },
    index: Object.assign(packed.map((tb) => ({ _id: tb.name, name: tb.name })), { size: packed.length }),
    getDocument: async (id) => packed.find((tb) => tb.name === id),
  }] : [];
  const rows = [...world, ...packed].flatMap((tb) => tb.results.contents);
  globalThis.fromUuid = async (u) => rows.find((r) => r.uuid === u) ?? null;
  return rows;
}

const quests = [];

const chats = [], discovered = [], recaps = [];
beforeEach(() => {
  chats.length = 0; discovered.length = 0; recaps.length = 0; warnings.length = 0; quests.length = 0;
  serve();
  globalThis.game.settings = { get: () => false, register() {} };
  Quests.get = () => null;
  Quests.create = async (data) => { quests.push(data); return { uuid: `JournalEntry.q${quests.length}`, ...data }; };
  globalThis.ChatMessage = { create: async (d) => chats.push(d) };
  Troubles.discover = async (id) => discovered.push(id);
  Troubles.undiscovered = async () => [{ id: "tr1", uuid: "Trouble.tr1", region: "Sablewood", settlement: { name: "Hollowmere" }, type: "Plague", stage: "s", symptoms: {} }];
  SessionRecap.logRumors = async (r) => recaps.push(...r);
});

test("tell gives one rumor that is on no table, to the region's page, and touches no trouble", async () => {
  const entry = freshLedger();
  const out = await Rumors.tell({ text: "  The miller's well sings at night.  ", region: "Sablewood", heardBy: ["Aria"] });
  assert.deepEqual(out.map((r) => [r.text, r.region, r.heardBy]), [["The miller's well sings at night.", "Sablewood", ["Aria"]]]);
  const [rumor] = rumorsOn(entry);
  assert.deepEqual(rumor.source, { custom: true });
  assert.equal(entry.pages[0].name, "Sablewood");
  assert.equal(chats.length, 1, "announced by default");
  assert.deepEqual(recaps.map((r) => r.text), ["The miller's well sings at night."]);
  assert.deepEqual(discovered, [], "no trouble is given with it");
});

test("tell with no text gives nothing and says so", async () => {
  const entry = freshLedger();
  assert.equal(await Rumors.tell({ text: "   ", region: null }), null);
  assert.deepEqual(warnings, ["SDE.rumors.notify.noText"]);
  assert.equal(entry.pages.length, 0);
});

test("announce: false records the rumor everywhere but chat", async () => {
  const entry = freshLedger();
  await Rumors.tell({ text: "A bell under the lake.", region: null, heardBy: [], announce: false });
  assert.equal(rumorsOn(entry).length, 1);
  assert.equal(recaps.length, 1);
  assert.equal(chats.length, 0);
});

test("a rumor given by hand stays on the ledger when more are given after it", async () => {
  const entry = freshLedger();
  await Rumors.tell({ text: "First.", region: null, heardBy: [] });
  await Rumors.tell({ text: "Second.", region: null, heardBy: [] });
  assert.deepEqual(rumorsOn(entry).map((r) => r.text).sort(), ["First.", "Second."]);
  assert.equal(entry.pages.length, 1, "both on the General page");
});

test("pick gives the chosen rows, marks them drawn, and takes each rumor's region from its table", async () => {
  const entry = freshLedger();
  const regional = table("Sablewood Rumors", [["a", "Wolves walk upright."], ["b", "The ford is cursed."]]);
  const general = table("Rumors in the Reaches", [["g", "A comet was seen."]]);
  serve({ world: [regional, general] });
  const chosen = [regional.results.contents[1].uuid, general.results.contents[0].uuid];
  const out = await Rumors.pick({ results: chosen, heardBy: ["Bram"], announce: false });
  assert.deepEqual(out.map((r) => [r.text, r.region]), [["The ford is cursed.", "Sablewood"], ["A comet was seen.", null]]);
  assert.deepEqual(regional.marked, ["b"]);
  assert.deepEqual(general.marked, ["g"]);
  assert.deepEqual(rumorsOn(entry).find((r) => r.text === "The ford is cursed.").source, { table: "Sablewood Rumors", resultId: "b", range: [2, 2] });
  assert.deepEqual(discovered, [], "no trouble is given with them");
  assert.equal(chats.length, 0);
  assert.deepEqual(warnings, []);
});

test("pick skips a row already given and one off a rumor table, and says how many", async () => {
  freshLedger();
  const regional = table("Sablewood Rumors", [["a", "Wolves walk upright.", true], ["b", "The ford is cursed."]]);
  const other = table("Sablewood Encounters", [["x", "Two bears."]]);
  const all = serve({ world: [regional, other] });
  const out = await Rumors.pick({ results: [...all.map((r) => r.uuid), "RollTable.gone.TableResult.z"], heardBy: [] });
  assert.deepEqual(out.map((r) => r.text), ["The ford is cursed."]);
  assert.deepEqual(regional.marked, ["b"]);
  assert.deepEqual(other.marked, []);
  assert.deepEqual(warnings, ["SDE.rumors.notify.skipped"]);
});

test("pick refuses a row in a locked compendium, and an empty choice", async () => {
  const entry = freshLedger();
  const locked = table("Rumors in the Reaches", [["g", "A comet was seen."]], { pack: "world.sde-tables", locked: true });
  serve({ packed: [locked] });
  assert.equal(await Rumors.pick({ results: [locked.results.contents[0].uuid], heardBy: [] }), null);
  assert.deepEqual(locked.marked, []);
  assert.deepEqual(await Rumors.pick({ results: [], heardBy: [] }), []);
  assert.deepEqual(warnings, ["SDE.rumors.notify.locked", "SDE.rumors.notify.noneChosen"]);
  assert.equal(entry.pages.length, 0);
});

test("tell and pick are the GM's", async () => {
  freshLedger();
  globalThis.game.user.isGM = false;
  try {
    assert.equal(await Rumors.tell({ text: "x", region: null }), null);
    assert.equal(await Rumors.pick({ results: ["a"] }), null);
  } finally { globalThis.game.user.isGM = true; }
  assert.deepEqual(warnings, ["SDE.rumors.notify.gmOnly", "SDE.rumors.notify.gmOnly"]);
});

test("give with announce: false still gives the troubles and rows, without a chat card", async () => {
  const entry = freshLedger();
  const general = table("Rumors in the Reaches", [["g", "A comet was seen."]]);
  serve({ world: [general] });
  const out = await Rumors.give({ count: 2, region: null, heardBy: [], announce: false });
  assert.equal(out.length, 2);
  assert.deepEqual(discovered, ["tr1"]);
  assert.deepEqual(general.marked, ["g"]);
  assert.equal(rumorsOn(entry).length, 2);
  assert.equal(chats.length, 0);
});

test("give still announces by default", async () => {
  freshLedger();
  Troubles.undiscovered = async () => [];
  const general = table("Rumors in the Reaches", [["g", "A comet was seen."]]);
  serve({ world: [general] });
  await Rumors.give({ count: 1, region: null, heardBy: [] });
  assert.equal(chats.length, 1);
});

// A rumor already on the ledger from range 1 of the general table, whose row a re-import replaced.
const givenBefore = [[null, [{ id: "r0", text: "Old.", real: 1, source: { table: "Rumors in the Reaches", resultId: "old", range: [1, 1] } }]]];

test("give still marks the row a re-import recreated, after writing the ledger", async () => {
  freshLedger(givenBefore);
  Troubles.undiscovered = async () => [];
  const general = table("Rumors in the Reaches", [["new", "Old, again."], ["g2", "A comet was seen."]]);
  serve({ world: [general] });
  const out = await Rumors.give({ count: 1, region: null, heardBy: [] });
  assert.deepEqual(out.map((r) => r.text), ["A comet was seen."]);
  assert.deepEqual(general.marked, ["g2", "new"]);
  assert.deepEqual(writes, ["ledger", "drawn"], "the ledger first: a failure after it never loses a rumor");
});

test("pick skips the row a re-import recreated for a rumor already given", async () => {
  freshLedger(givenBefore);
  const general = table("Rumors in the Reaches", [["new", "Old, again."], ["g2", "A comet was seen."]]);
  serve({ world: [general] });
  const out = await Rumors.pick({ results: general.results.contents.map((r) => r.uuid), heardBy: [] });
  assert.deepEqual(out.map((r) => r.text), ["A comet was seen."]);
  assert.deepEqual(general.marked, ["g2"]);
  assert.deepEqual(warnings, ["SDE.rumors.notify.skipped"]);
});

test("pick takes only the table a draw gives from: not a world copy behind the pack's", async () => {
  freshLedger();
  const packed = table("Sablewood Rumors", [["p1", "Pack row 1."], ["p2", "Pack row 2."]], { pack: "world.sde-tables" });
  const copy = table("Sablewood Rumors", [["w1", "World row 1."]]);
  serve({ world: [copy], packed: [packed] });
  const out = await Rumors.pick({ results: [copy.results.contents[0].uuid, packed.results.contents[1].uuid], heardBy: [] });
  assert.deepEqual(out.map((r) => r.text), ["Pack row 2."]);
  assert.deepEqual(copy.marked, []);
  assert.deepEqual(packed.marked, ["p2"]);
  assert.deepEqual(warnings, ["SDE.rumors.notify.skipped"]);
  // The pack's row 1 is still there to give: the skipped copy left nothing on the ledger to shadow it.
  Troubles.undiscovered = async () => [];
  await Rumors.give({ count: 1, region: "Sablewood", heardBy: [] });
  assert.deepEqual(packed.marked, ["p2", "p1"]);
});

test("tell files the rumor under the region as its table spells it", async () => {
  const entry = freshLedger();
  serve({ world: [table("Sablewood Rumors", [["a", "Wolves walk upright."]])] });
  const [rumor] = await Rumors.tell({ text: "The tanner buys pelts.", region: "sablewood", heardBy: [] });
  assert.equal(rumor.region, "Sablewood");
  assert.equal(entry.pages[0].name, "Sablewood");
  const [elsewhere] = await Rumors.tell({ text: "A homebrew place.", region: "Gloomhollow", heardBy: [] });
  assert.equal(elsewhere.region, "Gloomhollow", "a region with no table keeps the GM's spelling");
});

test("with quest drafting on, a written and a picked rumor each get a Hidden quest", async () => {
  const entry = freshLedger();
  globalThis.game.settings = { get: () => true, register() {} };
  const general = table("Rumors in the Reaches", [["g", "A comet was seen."]]);
  serve({ world: [general] });
  await Rumors.tell({ text: "The tanner buys pelts.", region: null, heardBy: [] });
  await Rumors.pick({ results: [general.results.contents[0].uuid], heardBy: [] });
  assert.deepEqual(quests.map((q) => [q.description, q.status, q.source.kind]), [
    ["The tanner buys pelts.", "hidden", "rumor"], ["A comet was seen.", "hidden", "rumor"],
  ]);
  assert.deepEqual(entry.pages[0].flags[M].rumorPage.rumors.map((r) => r.questUuid), ["JournalEntry.q1", "JournalEntry.q2"]);
});

// ── Review round 2 (#600) ────────────────────────────────────────────────────

test("a pick whose second table refuses the drawn write still records both, and a retry adds nothing", async () => {
  const entry = freshLedger();
  globalThis.game.settings = { get: () => true, register() {} };
  Troubles.undiscovered = async () => [];
  const regional = table("Sablewood Rumors", [["a", "Wolves walk upright."]]);
  const general = table("Rumors in the Reaches", [["g", "A comet was seen."], ["g2", "The ferryman takes teeth."]]);
  serve({ world: [regional, general] });
  const refuse = general.updateEmbeddedDocuments;
  general.updateEmbeddedDocuments = async () => { throw new Error("the table refused"); };
  const chosen = [regional.results.contents[0].uuid, general.results.contents[0].uuid];
  const quiet = console.error;
  console.error = () => {};
  let out;
  try { out = await Rumors.pick({ results: chosen, heardBy: [] }); } finally { console.error = quiet; }
  assert.deepEqual(out.map((r) => r.text), ["Wolves walk upright.", "A comet was seen."], "both were heard");
  assert.deepEqual(recaps.map((r) => r.text), ["Wolves walk upright.", "A comet was seen."], "both reach the recap");
  assert.equal(quests.length, 2, "both get their Hidden quest");
  assert.deepEqual(regional.marked, ["a"]);
  assert.ok(warnings.includes("SDE.rumors.notify.unmarked"));
  // The same pick again: nothing new on the ledger.
  warnings.length = 0;
  assert.deepEqual(await Rumors.pick({ results: chosen, heardBy: [] }), []);
  assert.equal(rumorsOn(entry).length, 2);
  // Once the table takes writes again, a draw skips the row and marks it drawn.
  general.updateEmbeddedDocuments = refuse;
  const [drawn] = await Rumors.give({ count: 1, region: null, heardBy: [] });
  assert.equal(drawn.text, "The ferryman takes teeth.");
  assert.deepEqual(general.marked.sort(), ["g", "g2"]);
});

test("a blank region, or the General page's own name, files a written rumor on the General page", async () => {
  const entry = freshLedger();
  for (const region of ["   ", "General", "general"]) await Rumors.tell({ text: `Said with ${JSON.stringify(region)}.`, region, heardBy: [] });
  assert.equal(entry.pages.length, 1);
  assert.equal(entry.pages[0].flags[M].rumorPage.region, null);
  assert.equal(rumorsOn(entry).length, 3);
  assert.ok(rumorsOn(entry).every((r) => r.region === null), "heard({ region: null }) finds all three");
});

test("give with a blank region draws the general table once, not twice", async () => {
  freshLedger();
  Troubles.undiscovered = async () => [];
  const general = table("Rumors in the Reaches", [["g1", "Comet A."], ["g2", "Comet B."]]);
  serve({ world: [general] });
  const out = await Rumors.give({ count: 2, region: "   ", heardBy: [] });
  assert.deepEqual(out.map((r) => r.text).sort(), ["Comet A.", "Comet B."]);
});

/** Opens the dialog with DialogV2.prompt captured; returns its config. */
async function openDialog() {
  let config = null;
  globalThis.foundry.applications.api.DialogV2.prompt = async (c) => { config = c; return null; };
  globalThis.game.actors = Object.assign([], { filter: () => [] });
  await askAndGive();
  return config;
}

test("the dialog shows rows on a locked compendium as unavailable, with why", async () => {
  freshLedger();
  serve({ packed: [table("Rumors in the Reaches", [["g", "A comet was seen."]], { pack: "world.sde-tables", locked: true })] });
  const { content } = await openDialog();
  assert.match(content, /name="result"[^>]*disabled/);
  assert.match(content, /SDE\.rumors\.dialog\.locked/);
});

test("the dialog says the tables couldn't be listed, not that every rumor was given", async () => {
  freshLedger();
  const general = table("Rumors in the Reaches", [["g", "A comet was seen."]]);
  serve({ packed: [general] });
  globalThis.game.packs[0].getDocument = async () => { throw new Error("stale index"); };
  const quiet = console.warn;
  console.warn = () => {};
  let content;
  try { ({ content } = await openDialog()); } finally { console.warn = quiet; }
  assert.match(content, /SDE\.rumors\.dialog\.listFailed/);
  assert.doesNotMatch(content, /SDE\.rumors\.dialog\.noRows/);
});

test("a written rumor's region can be one with no rumor table", async () => {
  freshLedger();
  serve({ world: [table("Sablewood Rumors", [["a", "Wolves walk upright."]])] });
  const config = await openDialog();
  assert.match(config.content, /name="customRegion"[^>]*list=/);
  const field = (value) => ({ value });
  const form = {
    elements: { mode: field("custom"), text: field("A homebrew rumor."), customRegion: field("  Gloomhollow "), region: field("Sablewood"), count: field("2"), announce: { checked: true } },
    querySelectorAll: () => [],
  };
  const picked = config.ok.callback(null, { form });
  assert.equal(picked.mode, "custom");
  assert.equal(picked.region, "Gloomhollow");
  form.elements.customRegion = field("   ");
  assert.equal(config.ok.callback(null, { form }).region, null, "left empty: the General page");
});
