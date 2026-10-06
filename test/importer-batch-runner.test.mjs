import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE } from "../scripts/importer/batch-import.mjs";

// The runner reads game.journal (via the source-PDF registry) at plan time.
// No journal → the registry's static per-book fallback paths apply, which is
// exactly the state a fresh world is in.
globalThis.game = { journal: null, user: { isGM: true } };
const { installHubBatch, WIZARD_BATCH_CLASS } = await import("../scripts/importer/importer-hub-batch.mjs");

/** A bare object carrying the installed batch methods, with no Foundry app. */
function hub(state = {}) {
  class FakeHub {}
  installHubBatch(FakeHub);
  return Object.assign(new FakeHub(), {
    // A rendered ApplicationV2 always has an element, and the batch loop now
    // stops when it does not — so the double has to carry one or every job
    // reads as "the window closed". Tests that care override it explicitly.
    element: { querySelector: () => null, querySelectorAll: () => [] },
    _importText: "", _importMonsters: [], _importItems: [], _importSpells: [],
    _importTables: [], _importGenerators: [], _importChar: [], _importBoats: [],
    _batchNotices: null, ...state,
  });
}

/**
 * The toasts are assembled from `languages/en.json`, so the stub resolves
 * against the real file: these tests are about the sentence the GM reads —
 * the singular/plural and the denominators — not about which key produced it.
 */
const EN = JSON.parse(readFileSync("languages/en.json", "utf8"));
const i18n = {
  localize: (key) => EN[key] ?? key,
  format: (key, data) => String(EN[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)),
};

async function runBatchForToast(job, result, blocked = []) {
  const previousUi = globalThis.ui;
  const previousGame = globalThis.game;
  const messages = [];
  const reports = [];
  globalThis.ui = { notifications: { info: (message) => messages.push(message) } };
  globalThis.game = { ...(previousGame ?? {}), i18n };
  const h = hub();
  h.render = async () => {};
  h._batchCaptureNotifications = () => () => {};
  h._runBatchJob = async () => result;
  h._batchReportDialog = async (summary) => { reports.push(summary); };
  h._invalidateManageTree = () => {};
  h._onHubClear = () => {};
  try {
    await h._runBatch({ jobs: [job], blocked }, "test scope");
    return { messages, reports };
  } finally {
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
  }
}

test("a row with no page citation can't run unattended", () => {
  const h = hub();
  // No i18n is mounted here, so the reason comes back as its en.json key.
  assert.equal(
    h._batchCanRun({ name: "Torch", src: "WR", pages: "" }, ROUTE.HUB),
    "SDE.importer.batchNote.noCite");
});

test("gear only runs where the Item Builder has a verified page cite", () => {
  const h = hub();
  assert.equal(h._batchCanRun({ type: "Basic", src: "WR" }, ROUTE.GEAR), true);
  // CS4 gear has no verified table/description pages — say so rather than
  // grabbing the wrong pages and minting garbage items.
  assert.equal(h._batchCanRun({ type: "Basic", src: "CS4" }, ROUTE.GEAR), "SDE.importer.batchNote.gearNoCite");
});

test("a downtime row resolves its book through the slug, not its blank src", () => {
  // The tree deliberately blanks src on downtime rows so the page chip reads
  // "pg 26-27" — resolving the PDF off src would block every downtime unlock.
  const h = hub();
  assert.equal(h._batchCanRun({ src: "", pages: "26-27", listKey: "cs6" }, ROUTE.DOWNTIME), true);
  assert.equal(
    h._batchCanRun({ src: "", pages: "26-27", listKey: "nonesuch" }, ROUTE.DOWNTIME),
    "SDE.importer.batchNote.noDowntimeBook");
});

test("a spell list without a list key can't be preset", () => {
  const h = hub();
  assert.equal(h._batchCanRun({ src: "WR", pages: "138" }, ROUTE.SPELLS), "SDE.importer.batchNote.noSpellList");
  assert.equal(h._batchCanRun({ src: "WR", pages: "138", listKey: "wr-priest-lawful" }, ROUTE.SPELLS), true);
});

test("a box holding only the seeded name counts as a failed grab", () => {
  // Every seed writes the entry name as a title line BEFORE the grab runs, so
  // "the box is empty" never fires — the batch would report "nothing
  // recognized" for what is really an unreadable PDF page.
  assert.equal(hub({ _importText: "Carousing Event\n" })._batchGrabbedBody("Carousing Event"), false);
  assert.equal(hub({ _importText: "  carousing event \n\n" })._batchGrabbedBody("Carousing Event"), false);
  assert.equal(hub({ _importText: "" })._batchGrabbedBody("Carousing Event"), false);
  assert.equal(
    hub({ _importText: "Carousing Event\nd6 Result\n1 You wake in a ditch\n" })._batchGrabbedBody("Carousing Event"),
    true);
});

test("the draft count spans every preview bucket a commit can empty", () => {
  const h = hub({
    _importMonsters: [1, 2], _importItems: [1], _importSpells: [1],
    _importTables: [1], _importGenerators: [1], _importChar: [1], _importBoats: [1],
  });
  assert.equal(h._batchDraftCount(), 8);
  assert.equal(hub()._batchDraftCount(), 0);
});

test("the reported problem prefers an error over a warning, and ignores info", () => {
  assert.equal(hub()._batchFirstProblem(), null);
  assert.equal(hub({ _batchNotices: [{ level: "info", message: "Pulled p.30" }] })._batchFirstProblem(), null);
  assert.equal(
    hub({ _batchNotices: [
      { level: "info", message: "Pulled p.30" },
      { level: "warn", message: "nothing matched" },
      { level: "error", message: "couldn't read the PDF" },
    ] })._batchFirstProblem(),
    "couldn't read the PDF");
});

test("capturing toasts leaves ui.notifications exactly as it was", () => {
  // The methods live on the prototype: overriding installs OWN properties, and
  // restoring by re-assignment would leave those behind forever. They must be
  // deleted, and a pre-existing own property must survive untouched.
  class Notifications {
    info() { return "proto-info"; }
    warn() { return "proto-warn"; }
    error() { return "proto-error"; }
    notify() { return "proto-notify"; }
  }
  const notes = new Notifications();
  const ownWarn = () => "own-warn";
  notes.warn = ownWarn;                       // a pre-existing own override
  globalThis.ui = { notifications: notes };

  const h = hub();
  const restore = h._batchCaptureNotifications();
  notes.info("grabbed a page");
  notes.warn("nothing matched");
  notes.error("couldn't read the PDF");
  notes.notify("also nothing matched", "warning");
  assert.deepEqual(h._batchNotices.map((n) => n.level), ["info", "warn", "error", "warn"]);
  assert.equal(h._batchFirstProblem(), "couldn't read the PDF");

  restore();
  assert.equal(h._batchNotices, null);
  assert.equal(notes.info(), "proto-info", "a prototype method must not be shadowed after the run");
  assert.equal(notes.error(), "proto-error");
  assert.equal(notes.notify(), "proto-notify");
  assert.equal(Object.prototype.hasOwnProperty.call(notes, "info"), false);
  assert.equal(notes.warn, ownWarn, "a pre-existing own override must survive");
});

test("capture is a no-op when there is no notifications object to wrap", () => {
  globalThis.ui = {};
  const h = hub();
  const restore = h._batchCaptureNotifications();
  assert.deepEqual(h._batchNotices, []);
  restore();
  assert.equal(h._batchNotices, null);
});

test("a bulk Mount job dispatches to the Mount-specific batch path", async () => {
  const h = hub();
  const job = {
    route: ROUTE.HUB,
    entry: { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" },
    covers: [
      { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" },
      { name: "Pony", type: "Mount", src: "WR", pages: "116-117" },
    ],
  };
  let dispatched = null;
  h._batchRunMounts = async (seen) => {
    dispatched = seen;
    return { status: "created", created: 2 };
  };

  const result = await h._batchRunHub(job);
  assert.strictEqual(dispatched, job);
  assert.deepEqual(result, { status: "created", created: 2 });
});

test("the Mount batch path reports each requested name when parsing is partial", async () => {
  const h = hub();
  const job = {
    entry: { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" },
    covers: [
      { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" },
      { name: "Pony", type: "Mount", src: "WR", pages: "116-117" },
      // A duplicate row must not make the same name parse or report twice.
      { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" },
    ],
  };
  h._onHubClear = () => {};
  h._seedGenericUnlock = async ({ name }) => {
    h._importSeed = { name, type: "Mount" };
    h._importText = `${name}\nAC 11, HP 5, ATK 1 kick +1 (1d4), MV near, LV 1`;
  };
  h.render = async () => {};
  h._onHubParse = async () => {
    h._importMonsters = [{ draft: { name: "Donkey" } }];
    h._importSkipped = [{ name: "Pony", reason: "not among the statblocks" }];
  };
  h._onHubCommitMonsters = async () => {
    h._importMonsters = [];
    return { created: ["Donkey"], skipped: [] };
  };

  const result = await h._batchRunMounts(job);
  assert.deepEqual(result.entries, [
    { name: "Donkey", status: "created", created: 1, note: "SDE.importer.batchNote.created" },
    { name: "Pony", status: "failed", created: 0, note: "not among the statblocks" },
  ]);
  assert.equal(result.status, "created");
  assert.equal(result.created, 1);
  assert.deepEqual(h._importSeed._batchMountNames, ["Donkey", "Pony"]);
});

test("a rerun reports every already-present Mount instead of a false batch success", async () => {
  const h = hub();
  const job = {
    entry: { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" },
    covers: [
      { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" },
      { name: "Pony", type: "Mount", src: "WR", pages: "116-117" },
    ],
  };
  h._onHubClear = () => {};
  h._seedGenericUnlock = async ({ name }) => {
    h._importSeed = { name, type: "Mount" };
    h._importText = `${name}\nAC 11, HP 5, ATK 1 kick +1 (1d4), MV near, LV 1`;
  };
  h.render = async () => {};
  h._onHubParse = async () => {
    h._importMonsters = [{ draft: { name: "Donkey" } }, { draft: { name: "Pony" } }];
    h._importSkipped = [];
  };
  h._onHubCommitMonsters = async () => {
    h._importMonsters = [];
    return { created: [], skipped: ["Donkey", "Pony"] };
  };

  const result = await h._batchRunMounts(job);
  assert.equal(result.status, "nothing");
  assert.equal(result.created, 0);
  assert.deepEqual(result.entries.map(({ name, status, created }) => ({ name, status, created })), [
    { name: "Donkey", status: "nothing", created: 0 },
    { name: "Pony", status: "nothing", created: 0 },
  ]);
});

test("Mount bulk toasts use the explicit per-name denominator", async () => {
  const { messages, reports } = await runBatchForToast(
    {
      route: ROUTE.HUB,
      entry: { name: "Donkey", type: "Mount" },
      label: "Mounts",
    },
    {
      status: "created", created: 1,
      entries: [
        { name: "Donkey", status: "created", created: 1 },
        { name: "Pony", status: "failed", created: 0 },
      ],
    },
  );
  assert.deepEqual(messages, ["Batch import: 1 document created across 1 of 2 entries, 1 failed."]);
  assert.equal(reports[0].entries, 2);
});

test("Mount bulk toasts exclude planner-blocked rows from the denominator", async () => {
  const { messages, reports } = await runBatchForToast(
    {
      route: ROUTE.HUB,
      entry: { name: "Donkey", type: "Mount" },
      label: "Mounts",
    },
    {
      status: "created", created: 1,
      entries: [
        { name: "Donkey", status: "created", created: 1 },
        { name: "Pony", status: "failed", created: 0 },
      ],
    },
    [{ entry: { name: "Missing Mount", type: "Mount" }, reason: "PDF isn't linked" }],
  );
  assert.deepEqual(messages, ["Batch import: 1 document created across 1 of 2 entries, 1 failed, 1 skipped."]);
  assert.equal(reports[0].entries, 3, "the report still includes the blocked row");
  assert.equal(reports[0].blocked, 1);
  assert.deepEqual(
    reports[0].lines.filter((line) => line.status === "blocked"),
    [{ status: "blocked", name: "Missing Mount", note: "PDF isn't linked", src: "" }],
  );
});

test("non-Mount batch toasts keep job denominators and separate blocked rows", async () => {
  const cases = [
    {
      route: ROUTE.HUB, type: "Boat", name: "Boats",
      result: { status: "created", created: 8 },
      blocked: [{ entry: { name: "Uncited Boat" }, reason: "no page citation" }],
      expected: "Batch import: 8 documents created across 1 of 1 entry, 1 skipped.",
    },
    {
      route: ROUTE.HUB, type: "Actor", name: "Monsters",
      result: { status: "created", created: 14 }, blocked: [],
      expected: "Batch import: 14 documents created across 1 of 1 entry.",
    },
    {
      route: ROUTE.SPELLS, type: "Spell", name: "Spell list",
      result: { status: "nothing", created: 0 }, blocked: [],
      expected: "Batch import: 0 documents created across 0 of 1 entry.",
    },
  ];
  for (const item of cases) {
    const { messages } = await runBatchForToast(
      { route: item.route, entry: { name: item.name, type: item.type }, label: item.name },
      item.result, item.blocked,
    );
    assert.deepEqual(messages, [item.expected], item.type);
  }
});

test("a null element ends the run cleanly instead of failing entries on a DOM error", async () => {
  // ApplicationV2 can report `rendered` true while `element` is already null.
  // Every route reads the element, so the batch must stop rather than let the
  // next entry die with "can't access property querySelector, this.element is
  // null" — which is exactly how a 6-entry CS3 Nord import lost its last table.
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { info() {}, warn() {} } };
  const h = hub();
  h.rendered = true;
  h.element = null;
  h.render = async () => {};
  h._batchCaptureNotifications = () => () => {};
  h._invalidateManageTree = () => {};
  h._onHubClear = () => {};
  let ran = 0;
  h._runBatchJob = async () => { ran++; return { status: "ok", created: 1 }; };
  const summaries = [];
  h._batchReportDialog = async (summary) => { summaries.push(summary); };
  try {
    await h._runBatch({ jobs: [{ label: "A" }, { label: "B" }], blocked: [] }, "scope");
  } finally {
    if (previousUi === undefined) delete globalThis.ui; else globalThis.ui = previousUi;
  }
  assert.equal(ran, 0, "no job may run without an element to read");
  const rows = summaries.flatMap(s => s?.rows ?? s?.results ?? []);
  assert.ok(rows.every(r => r.status !== "failed"),
    "a missing element is a clean stop, never a failed entry");
});

test("a helper workspace already up when the batch starts is closed at the end of the run", async () => {
  // #312: the routes reset and drive whichever window each singleton hands back
  // — including one the GM already had open — so "only close what THIS run
  // opened" left that window up, frozen on the batch's last entry. Every
  // workspace the run puts to work is closed; one it never touches is not.
  const closed = [];
  const alreadyOpen = { rendered: true, close: async () => closed.push("pre-opened") };
  const freshlyOpened = { rendered: true, close: async () => closed.push("fresh") };
  const untouched = { rendered: true, close: async () => closed.push("untouched") };
  class AlreadyOpenApp { static _instance = alreadyOpen; static open() { return alreadyOpen; } }
  class FreshApp { static _instance = null; static open() { FreshApp._instance = freshlyOpened; return freshlyOpened; } }
  const h = hub();
  h._batchOpen(AlreadyOpenApp);
  h._batchOpen(FreshApp);
  void untouched;   // up the whole time, never driven by this run
  await h._batchCloseApps();
  assert.deepEqual(closed.sort(), ["fresh", "pre-opened"],
    "the run closes every workspace it drove, a window it found already open included");
});

// A row re-run over a book the GM already owns: every statblock parses, the
// importer skips every one as a duplicate, and the commit empties the preview
// bucket regardless. Measuring "created" as the DROP in bucket size therefore
// reported the whole book as created — an "Import everything" pass over the GM
// Guide's 90 statblocks claimed 90 created and created nothing.
/** Run `fn` with an i18n that echoes the key and its data, so a note still
 *  shows which sentence was picked and the numbers that went into it. */
async function withKeyI18n(fn) {
  const previous = globalThis.game.i18n;
  globalThis.game.i18n = { localize: (k) => k, format: (k, d) => k + JSON.stringify(d) };
  try { return await fn(); } finally {
    if (previous === undefined) delete globalThis.game.i18n;
    else globalThis.game.i18n = previous;
  }
}

function bestiaryHub(drafts, skipped) {
  const h = hub();
  h._onHubClear = () => {};
  h.render = async () => {};
  h._onMonsterSeedPaste = async (_event, { dataset }) => {
    h._importSeed = { name: dataset.name, src: dataset.src };
    h._importText = `${dataset.name}\nADEPT\nAC 12, HP 9, ATK 1 club +1 (1d4), MV near, LV 3`;
  };
  h._onHubParse = async () => { h._importMonsters = drafts.map((name) => ({ draft: { name } })); };
  h._batchCommitPreview = async () => { h._importMonsters = []; return skipped; };
  return h;
}
const bestiaryJob = {
  route: ROUTE.HUB,
  entry: {
    name: "Import the GM Guide bestiary — 90 monsters (284-309)",
    seedAction: "monsterSeedPaste", type: "Actor", src: "GMWR", pages: "284-309",
  },
};

test("a batch row counts skipped duplicates as skipped, not as created", async () => {
  const result = await withKeyI18n(() => bestiaryHub(["Adept", "Bard", "Scout"], 3)._batchRunHub(bestiaryJob));
  assert.equal(result.created, 0);
  assert.equal(result.status, "nothing");
  assert.equal(result.note, 'SDE.importer.batchNote.inLibraryN{"n":3}');
});

test("a partly-reprinted bestiary reports both halves", async () => {
  const result = await withKeyI18n(() => bestiaryHub(["Adept", "Bard", "Scout"], 2)._batchRunHub(bestiaryJob));
  assert.equal(result.created, 1);
  assert.equal(result.status, "created");
  assert.equal(result.note, 'SDE.importer.count.created{"n":1}; SDE.importer.batchNote.inLibraryN{"n":2}');
});

/** Runs one job through _runBatch with a stand-in <body> and reports whether the wizard's hide class was up during the job and after it. */
async function bodyClassDuringBatch(opts) {
  const previous = { ui: globalThis.ui, document: globalThis.document };
  const classes = new Set();
  globalThis.document = { body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } } };
  globalThis.ui = { notifications: { info() {}, warn() {} } };
  const h = hub();
  h.render = async () => {};
  h._batchCaptureNotifications = () => () => {};
  h._invalidateManageTree = () => {};
  h._onHubClear = () => {};
  h._batchReportDialog = async () => {};
  let during;
  h._runBatchJob = async () => { during = classes.has(WIZARD_BATCH_CLASS); return { status: "ok", created: 1 }; };
  try {
    await h._runBatch({ jobs: [{ label: "A" }], blocked: [] }, "scope", opts);
    return { during, after: classes.has(WIZARD_BATCH_CLASS) };
  } finally {
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

test("the wizard's quiet batch hides the helper windows it opens, and puts them back when it ends", async () => {
  assert.deepEqual(await bodyClassDuringBatch({ quiet: true }), { during: true, after: false });
});

test("the normal batch (the advanced hub) leaves its helper windows visible", async () => {
  assert.deepEqual(await bodyClassDuringBatch({}), { during: false, after: false });
});
