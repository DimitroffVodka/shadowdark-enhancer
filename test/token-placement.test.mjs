/** Click-to-place token queue — the scene write is async, so a second click
 * arriving before it settles must not consume another queue entry. */
import test from "node:test";
import assert from "node:assert/strict";
import { placeTokensByClick } from "../scripts/shared/token-placement.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeActor(id, name) {
  return {
    id,
    name,
    img: `art/${id}.webp`,
    prototypeToken: { texture: { src: `art/${id}.webp` } },
    async getTokenDocument() {
      return { toObject: () => ({ _id: `source-${id}` }) };
    },
  };
}

function makeDocument() {
  const listeners = new Map();
  return {
    addEventListener(type, listener, capture = false) {
      listeners.set(`${type}:${capture}`, listener);
    },
    removeEventListener(type, listener, capture = false) {
      if (listeners.get(`${type}:${capture}`) === listener) listeners.delete(`${type}:${capture}`);
    },
    has(type, capture = false) {
      return listeners.has(`${type}:${capture}`);
    },
    emit(type, event, capture = type === "pointerdown") {
      return listeners.get(`${type}:${capture}`)?.(event);
    },
  };
}

function canvasClick() {
  return {
    button: 0,
    target: { tagName: "CANVAS", closest: () => ({}) },
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
}

test("a canvas click that arrives during placement does not skip the next queue entry", async () => {
  const previous = {
    CONST: globalThis.CONST,
    canvas: globalThis.canvas,
    document: globalThis.document,
    ui: globalThis.ui,
  };
  const document = makeDocument();
  const firstWrite = deferred();
  const created = [];
  let createCalls = 0;

  globalThis.CONST = {
    DEFAULT_TOKEN: "icons/svg/mystery-man.svg",
    GRID_SNAPPING_MODES: { TOP_LEFT_VERTEX: 0 },
  };
  globalThis.ui = { notifications: { info() {}, warn() {} } };
  globalThis.document = document;
  globalThis.canvas = {
    ready: true,
    mousePosition: { x: 10, y: 20 },
    grid: { getSnappedPoint: ({ x, y }) => ({ x, y }) },
    scene: {
      async createEmbeddedDocuments(_type, docs) {
        createCalls++;
        created.push(...docs);
        if (createCalls === 1) await firstWrite.promise;
        return docs;
      },
    },
  };

  try {
    let placementDone = false;
    const placement = placeTokensByClick([
      { actor: makeActor("hero", "Hero"), count: 1, label: "Hero" },
      { actor: makeActor("goblin", "Goblin"), count: 1, label: "Goblin" },
    ]).then((result) => {
      placementDone = true;
      return result;
    });

    for (let i = 0; i < 20 && !document.has("pointerdown", true); i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(document.has("pointerdown", true), "placement should listen for canvas clicks");

    const firstClick = document.emit("pointerdown", canvasClick());
    await Promise.resolve();
    document.emit("pointerdown", canvasClick());
    await Promise.resolve();

    assert.equal(createCalls, 1, "a second click must be ignored while the first write is pending");

    firstWrite.resolve();
    await firstClick;
    assert.equal(placementDone, false, "the first click should leave the next queue entry pending");

    const nextClick = document.emit("pointerdown", canvasClick());
    await nextClick;
    const result = await placement;

    assert.deepEqual(created.map((token) => token.actorId), ["hero", "goblin"]);
    assert.deepEqual(result, { placed: 2, cancelled: false });
  } finally {
    globalThis.CONST = previous.CONST;
    globalThis.canvas = previous.canvas;
    globalThis.document = previous.document;
    globalThis.ui = previous.ui;
  }
});
