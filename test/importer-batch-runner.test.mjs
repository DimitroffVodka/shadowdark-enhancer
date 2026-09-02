import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE } from "../scripts/importer/batch-import.mjs";

// The runner reads game.journal (via the source-PDF registry) at plan time.
// No journal → the registry's static per-book fallback paths apply, which is
// exactly the state a fresh world is in.
globalThis.game = { journal: null, user: { isGM: true } };
const { installHubBatch } = await import("../scripts/importer/importer-hub-batch.mjs");

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

async function runBatchForToast(job, result, blocked = []) {
  const previousUi = globalThis.ui;
  const messages = [];
  const reports = [];
  globalThis.ui = { notifications: { info: (message) => messages.push(message) } };
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
  }
}

test("a row with no page citation can't run unattended", () => {
  const h = hub();
  assert.match(
    h._batchCanRun({ name: "Torch", src: "WR", pages: "" }, ROUTE.HUB),
    /page citation/i);
});

test("gear only runs where the Item Builder has a verified page cite", () => {
  const h = hub();
  assert.equal(h._batchCanRun({ type: "Basic", src: "WR" }, ROUTE.GEAR), true);
  // CS4 gear has no verified table/description pages — say so rather than
  // grabbing the wrong pages and minting garbage items.
  assert.match(h._batchCanRun({ type: "Basic", src: "CS4" }, ROUTE.GEAR), /no verified page cite/i);
});

test("a downtime row resolves its book through the slug, not its blank src", () => {
  // The tree deliberately blanks src on downtime rows so the page chip reads
  // "pg 26-27" — resolving the PDF off src would block every downtime unlock.
  const h = hub();
  assert.equal(h._batchCanRun({ src: "", pages: "26-27", listKey: "cs6" }, ROUTE.DOWNTIME), true);
  assert.match(
    h._batchCanRun({ src: "", pages: "26-27", listKey: "nonesuch" }, ROUTE.DOWNTIME),
    /no source book mapped/i);
});

test("a spell list without a list key can't be preset", () => {
  const h = hub();
  assert.match(h._batchCanRun({ src: "WR", pages: "138" }, ROUTE.SPELLS), /no spell list to preset/i);
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
    { name: "Donkey", status: "created", created: 1, note: "created" },
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
    [{ status: "blocked", name: "Missing Mount", note: "PDF isn't linked" }],
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
