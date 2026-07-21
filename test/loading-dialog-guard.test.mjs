/**
 * Loading-dialog ("Searching Distant Lands…") resilience guard
 * (AI-Council correction #8).
 *
 * The system opens a LoadingSD spinner at the top of ItemSheetSD.getData() and
 * only closes it on the success path (un-awaited); a transient throw orphans
 * the spinner and cascades. The guard: (1) bound LoadingSD.close() so it can
 * never spin forever, (2) wrap getData to dismiss any orphaned spinner on the
 * failure path and rethrow. These tests use mocks/seams to pin: idempotent
 * install, bounded close, rejection propagation, and cleanup behaviour —
 * including that a rejected fire-and-forget close is swallowed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installLoadingDialogGuard, dismissLoadingDialogs } from "../scripts/shared/loading-dialog-guard.mjs";

function setup({ getDataImpl } = {}) {
  const appCloseCalls = [];
  const baseClose = function (options) { appCloseCalls.push({ self: this, options }); return "closed"; };
  class LoadingSD { async close() { return "orig-close"; } }
  class ItemSheetSD {
    async getData(options) { return getDataImpl ? getDataImpl.call(this, options) : { ok: true }; }
  }
  const prev = {
    shadowdark: globalThis.shadowdark, foundry: globalThis.foundry,
    ui: globalThis.ui, setTimeout: globalThis.setTimeout,
  };
  globalThis.shadowdark = { apps: { LoadingSD }, sheets: { ItemSheetSD } };
  globalThis.foundry = { appv1: { api: { Application: { prototype: { close: baseClose } } } } };
  globalThis.ui = { windows: {} };
  const restore = () => Object.assign(globalThis, prev);
  return { LoadingSD, ItemSheetSD, appCloseCalls, restore };
}

/** Make setTimeout fire immediately so the bounded-wait loop runs instantly. */
function withImmediateTimers(fn) {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (cb) => { cb(); return 0; };
  return Promise.resolve().then(fn).finally(() => { globalThis.setTimeout = real; });
}

test("returns false and patches nothing when the system classes are absent", () => {
  const prev = globalThis.shadowdark;
  globalThis.shadowdark = {};
  try {
    assert.equal(installLoadingDialogGuard(), false);
  } finally { globalThis.shadowdark = prev; }
});

test("install is idempotent — patches applied once, not re-wrapped", () => {
  const { LoadingSD, ItemSheetSD, restore } = setup();
  try {
    assert.equal(installLoadingDialogGuard(), true);
    const close1 = LoadingSD.prototype.close;
    const getData1 = ItemSheetSD.prototype.getData;
    assert.equal(LoadingSD.prototype._sdeCloseGuarded, true);
    assert.equal(ItemSheetSD.prototype._sdeLoadingGuarded, true);

    assert.equal(installLoadingDialogGuard(), true);
    assert.equal(LoadingSD.prototype.close, close1, "close() not re-wrapped on second install");
    assert.equal(ItemSheetSD.prototype.getData, getData1, "getData not re-wrapped on second install");
  } finally { restore(); }
});

test("bounded close(): resolves and delegates even when the dialog never renders", async () => {
  const { LoadingSD, appCloseCalls, restore } = setup();
  try {
    installLoadingDialogGuard();
    const dialog = Object.create(LoadingSD.prototype);
    dialog.rendered = false;   // torn down mid-render — the unbounded-loop hazard
    await withImmediateTimers(async () => {
      const result = await dialog.close({ force: true });
      assert.equal(result, "closed");
    });
    assert.equal(appCloseCalls.length, 1, "delegated to the base Application.close exactly once");
    assert.equal(appCloseCalls[0].self, dialog);
    assert.deepEqual(appCloseCalls[0].options, { force: true });
  } finally { restore(); }
});

test("bounded close(): the already-rendered happy path delegates immediately", async () => {
  const { LoadingSD, appCloseCalls, restore } = setup();
  try {
    installLoadingDialogGuard();
    const dialog = Object.create(LoadingSD.prototype);
    dialog.rendered = true;
    const result = await dialog.close();
    assert.equal(result, "closed");
    assert.equal(appCloseCalls.length, 1);
  } finally { restore(); }
});

test("getData wrapper: rethrows the original error and dismisses orphaned spinners", async () => {
  const boom = new Error("transient compendium-scan failure");
  const { ItemSheetSD, restore } = setup({ getDataImpl() { throw boom; } });
  const closeSpy = [];
  try {
    installLoadingDialogGuard();
    // Orphaned spinner in the window registry (constructor name is what the
    // guard matches on) with a spy close().
    globalThis.ui.windows = { 5: { constructor: { name: "LoadingSD" }, close: (o) => { closeSpy.push(o); } } };
    const sheet = Object.create(ItemSheetSD.prototype);
    sheet.item = { type: "Class", name: "Green Knight" };
    await assert.rejects(() => sheet.getData({}), (err) => err === boom);
    assert.equal(closeSpy.length, 1, "orphaned spinner dismissed");
    assert.deepEqual(closeSpy[0], { force: true });
  } finally { restore(); }
});

test("getData wrapper: success path is transparent (returns the real context)", async () => {
  const ctx = { rows: 3 };
  const { ItemSheetSD, restore } = setup({ getDataImpl() { return ctx; } });
  try {
    installLoadingDialogGuard();
    const sheet = Object.create(ItemSheetSD.prototype);
    assert.equal(await sheet.getData(), ctx);
  } finally { restore(); }
});

test("dismissLoadingDialogs: closes only LoadingSD windows and returns the count", () => {
  const { restore } = setup();
  const closed = [];
  try {
    globalThis.ui.windows = {
      1: { constructor: { name: "LoadingSD" }, close: () => closed.push("a") },
      2: { constructor: { name: "ItemSheetSD" }, close: () => closed.push("nope") },
      3: { constructor: { name: "LoadingSD" }, close: () => closed.push("b") },
    };
    const n = dismissLoadingDialogs();
    assert.equal(n, 2);
    assert.deepEqual(closed.sort(), ["a", "b"]);
  } finally { restore(); }
});

test("dismissLoadingDialogs: a rejected fire-and-forget close is swallowed (no throw)", async () => {
  const { restore } = setup();
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandled);
  try {
    globalThis.ui.windows = {
      1: { constructor: { name: "LoadingSD" }, close: () => Promise.reject(new Error("torn down")) },
    };
    assert.doesNotThrow(() => dismissLoadingDialogs());
    // give any (swallowed) rejection a tick to surface
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(unhandled, null, "rejected close() did not surface as an unhandled rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    restore();
  }
});
