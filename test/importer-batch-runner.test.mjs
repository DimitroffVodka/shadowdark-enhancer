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
    _importText: "", _importMonsters: [], _importItems: [], _importSpells: [],
    _importTables: [], _importGenerators: [], _importChar: [], _importBoats: [],
    _batchNotices: null, ...state,
  });
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
