import test from "node:test";
import assert from "node:assert/strict";

// The placer needs Foundry's ApplicationV2 at import time; a bare base class is enough to drive _place.
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => Base } } };
globalThis._replace = (v) => v;
globalThis.ui = { notifications: { error() {}, info() {}, warn() {} } };
const { AdventurePlacer } = await import("../scripts/importer/adventure/adventure-placer.mjs");

/** A placer whose Note write is held open until the test lets it go. */
function placer() {
  const writes = [];
  const scene = {
    grid: { size: 100 },
    getFlag: () => ({ entryId: "E", skipped: [] }),
    createEmbeddedDocuments: (_type, docs) => new Promise((resolve, reject) => writes.push({ docs, resolve, reject })),
    updateEmbeddedDocuments: async () => [],
  };
  const app = new AdventurePlacer(scene);
  const rows = [1, 2, 3].map((num) => ({ num, pageId: `p${num}`, noteId: null, state: "pending" }));
  const armed = [];
  app._rows = () => rows;
  app.arm = (num) => { app._gate.cancel(); app.armed = num; armed.push(num); };
  app.disarm = () => { app._gate.cancel(); app.armed = null; };
  app.armed = 1;
  return { app, writes, armed, rows };
}

test("two clicks before the write returns make one Note", async () => {
  const { app, writes } = placer();
  const a = app._place(1, { x: 10, y: 10 });
  const b = app._place(1, { x: 12, y: 12 });
  assert.equal(writes.length, 1);
  writes[0].resolve([]);
  await Promise.all([a, b]);
  assert.equal(writes.length, 1);
});

test("a write that finishes after Stop leaves the target down", async () => {
  const { app, writes, armed } = placer();
  const p = app._place(1, { x: 1, y: 1 });
  app.disarm();
  writes[0].resolve([]);
  await p;
  assert.equal(app.armed, null);
  assert.deepEqual(armed, []);
});

test("a write that finishes after another Place does not overwrite it", async () => {
  const { app, writes, armed } = placer();
  const p = app._place(1, { x: 1, y: 1 });
  app.arm(3);
  writes[0].resolve([]);
  await p;
  assert.equal(app.armed, 3);
  assert.deepEqual(armed, [3]);
});

test("an uncancelled write arms the next location", async () => {
  const { app, writes, armed } = placer();
  const p = app._place(1, { x: 1, y: 1 });
  writes[0].resolve([]);
  await p;
  assert.deepEqual(armed, [2]);
});

test("a failed write keeps the location armed and frees the slot for a retry", async () => {
  const { app, writes, armed } = placer();
  const log = console.error;
  console.error = () => {};   // the failure is logged on purpose
  const p = app._place(1, { x: 1, y: 1 });
  writes[0].reject(new Error("denied"));
  await p;
  console.error = log;
  assert.equal(app.armed, 1);
  assert.deepEqual(armed, []);
  const retry = app._place(1, { x: 1, y: 1 });
  assert.equal(writes.length, 2);
  writes[1].resolve([]);
  await retry;
});

// `open()` re-aims the ONE placer at another scene while a write for the first is
// still in the air, so anything read from `this.scene` after an await belongs to
// the wrong scene: a skipped location on A being placed would un-skip it on B.
function twoScenes() {
  const mk = (id) => {
    const scene = {
      id, grid: { size: 100 }, flags: { skipped: [1] }, updates: [], deletes: [],
      getFlag: () => ({ entryId: "E", skipped: scene.flags.skipped }),
      createEmbeddedDocuments: () => scene.hold(),
      deleteEmbeddedDocuments: () => scene.hold(),
      update: async (data) => { scene.updates.push(data); },
    };
    scene.hold = () => new Promise((resolve) => { scene.release = () => resolve([]); });
    return scene;
  };
  const [A, B] = [mk("A"), mk("B")];
  const app = new AdventurePlacer(A);
  app.render = () => {};
  globalThis.game = { user: { isGM: true }, journal: { get: () => ({}) } };
  globalThis.canvas = { scene: { id: "B" } };
  globalThis.foundry.applications.instances = new Map([["sde-adventure-placer", app]]);
  return { A, B, app };
}

test("a skipped location placed on A does not un-skip it on B after the placer is reopened for B", async () => {
  const { A, B, app } = twoScenes();
  app._rows = () => [{ num: 1, pageId: "p1", noteId: null, state: "skipped" }];
  const p = app._place(1, { x: 1, y: 1 });
  await AdventurePlacer.open(B);
  assert.equal(app.scene, B);
  A.release();
  await p;
  assert.equal(B.updates.length, 0, "B was written to");
  assert.equal(A.updates.length, 1, "A's skip flag was not cleared");
});

test("clearing a pin on A does not touch B's skip list after the placer is reopened for B", async () => {
  const { A, B, app } = twoScenes();
  app._rows = () => [{ num: 1, pageId: "p1", noteId: "N", state: "placed" }];
  const p = app._onClear(null, { dataset: { num: "1" } });
  await AdventurePlacer.open(B);
  A.release();
  await p;
  assert.equal(B.updates.length, 0, "B was written to");
  assert.equal(A.updates.length, 1, "A's skip flag was not cleared");
});
