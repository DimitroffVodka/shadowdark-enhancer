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
  user: { isGM: true }, i18n: { lang: "en", localize: (k) => k, format: (k) => k },
  settings: { get: () => false, register() {} }, journal: { find: () => null },
  time: { worldTime: 0, calendar: { timeToComponents: () => ({ dayOfWeek: 0, dayOfMonth: 0, month: 0, year: 1300, hour: 8, minute: 0 }) } }, packs: [], tables: [], actors: [], users: [],
};

const { Rumors } = await import("../scripts/rumors/rumors.mjs");
const { Troubles } = await import("../scripts/troubles/troubles.mjs");
const { SessionRecap } = await import("../scripts/session-recap/session-recap.mjs");

/** A world ledger that keeps what is written to it: `game.journal` finds it once created. */
function freshLedger() {
  const pages = [];
  const entry = {
    getFlag: (_s, k) => (k === "rumorLedger" ? true : undefined),
    pages: Object.assign(pages, {
      contents: pages,
      get: (id) => pages.find((p) => p.id === id),
    }),
    async createEmbeddedDocuments(_type, data) {
      for (const d of data) {
        const page = { id: `p${pages.length}`, uuid: `JournalEntry.l.JournalEntryPage.p${pages.length}`, sort: d.sort, name: d.name, flags: structuredClone(d.flags) };
        page.getFlag = (s, k) => page.flags[s]?.[k];
        pages.push(page);
      }
    },
    async updateEmbeddedDocuments(_type, data) {
      for (const d of data) pages.find((p) => p.id === d._id).flags[M].rumorPage = d[`flags.${M}.rumorPage`];
    },
  };
  let made = false;
  globalThis.game.journal = { find: (fn) => (made && fn(entry) ? entry : null) };
  globalThis.JournalEntry = { create: async () => { made = true; return entry; } };
  return entry;
}

const rumorsOn = (entry) => entry.pages.flatMap((p) => p.flags[M].rumorPage.rumors);

/** A rumor table in the world: `rows` are [id, text, drawn?]; records the rows marked drawn. */
function table(name, rows, { pack = null, locked = false } = {}) {
  const tb = { name, pack, compendium: pack ? { locked } : null, marked: [] };
  const results = rows.map(([id, text, drawn = false], i) => ({
    id, uuid: `RollTable.${name}.TableResult.${id}`, documentName: "TableResult", parent: tb, name: text, range: [i + 1, i + 1], drawn,
  }));
  tb.results = { contents: results };
  tb.updateEmbeddedDocuments = async (_type, data) => {
    for (const { _id } of data) { tb.marked.push(_id); results.find((r) => r.id === _id).drawn = true; }
  };
  return tb;
}

const chats = [], discovered = [], recaps = [];
beforeEach(() => {
  chats.length = 0; discovered.length = 0; recaps.length = 0; warnings.length = 0;
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
  const rows = { [regional.results.contents[1].uuid]: regional.results.contents[1], [general.results.contents[0].uuid]: general.results.contents[0] };
  globalThis.fromUuid = async (u) => rows[u] ?? null;
  const out = await Rumors.pick({ results: Object.keys(rows), heardBy: ["Bram"], announce: false });
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
  const all = [...regional.results.contents, ...other.results.contents];
  globalThis.fromUuid = async (u) => all.find((r) => r.uuid === u) ?? null;
  const out = await Rumors.pick({ results: [...all.map((r) => r.uuid), "RollTable.gone.TableResult.z"], heardBy: [] });
  assert.deepEqual(out.map((r) => r.text), ["The ford is cursed."]);
  assert.deepEqual(regional.marked, ["b"]);
  assert.deepEqual(other.marked, []);
  assert.deepEqual(warnings, ["SDE.rumors.notify.skipped"]);
});

test("pick refuses a row in a locked compendium, and an empty choice", async () => {
  const entry = freshLedger();
  globalThis.game.packs = [{ collection: `world.sde-tables`, metadata: { packageType: "world", label: "x" } }];
  const locked = table("Rumors in the Reaches", [["g", "A comet was seen."]], { pack: "world.sde-tables", locked: true });
  globalThis.fromUuid = async () => locked.results.contents[0];
  try {
    assert.equal(await Rumors.pick({ results: [locked.results.contents[0].uuid], heardBy: [] }), null);
  } finally { globalThis.game.packs = []; }
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
  globalThis.game.tables = [general];
  try {
    const out = await Rumors.give({ count: 2, region: null, heardBy: [], announce: false });
    assert.equal(out.length, 2);
  } finally { globalThis.game.tables = []; }
  assert.deepEqual(discovered, ["tr1"]);
  assert.deepEqual(general.marked, ["g"]);
  assert.equal(rumorsOn(entry).length, 2);
  assert.equal(chats.length, 0);
});

test("give still announces by default", async () => {
  freshLedger();
  Troubles.undiscovered = async () => [];
  const general = table("Rumors in the Reaches", [["g", "A comet was seen."]]);
  globalThis.game.tables = [general];
  try { await Rumors.give({ count: 1, region: null, heardBy: [] }); } finally { globalThis.game.tables = []; }
  assert.equal(chats.length, 1);
});
