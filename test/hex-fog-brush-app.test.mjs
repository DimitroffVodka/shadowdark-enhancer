/* global canvas, Hooks */
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
const handlers = new Map();
let nextHook = 0;
globalThis.Hooks = {
  on(name, fn) { const id = ++nextHook; handlers.set(id, { name, fn }); return id; },
  off(_name, id) { handlers.delete(id); },
  callAll(name, ...args) { for (const hook of [...handlers.values()]) if (hook.name === name) hook.fn(...args); },
};
class App {
  constructor() { this.element = { querySelector: () => null }; this.renders = 0; }
  _onRender() {}
  _onClose() {}
  async render() { this.renders++; this.context = await this._prepareContext(); }
}
class Container {
  constructor() { this.children = []; this.events = {}; this.zIndex = 0; }
  addChild(child) { this.children.push(child); return child; }
  on(name, fn) { this.events[name] = fn; }
  sortChildren() { this.children.sort((a, b) => a.zIndex - b.zIndex); }
  destroy() { this.destroyed = true; for (const child of this.children) child.destroy(); }
}
class Graphics extends Container {
  clear() { assert.ok(!this.destroyed, "never clear a destroyed graphic"); }
  lineStyle() {}
  drawPolygon() {}
  beginFill() {}
  endFill() {}
}
globalThis.foundry = { applications: { api: { ApplicationV2: App, HandlebarsApplicationMixin: Base => Base } } };
globalThis.PIXI = { Container, Graphics };
globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } };
globalThis._replace = value => value;
globalThis.ui = { notifications: { error: assert.fail } };
const { HexFogBrushApp } = await import("../scripts/hex-map/hex-fog-brush-app.mjs");
const { cacheHexJournal } = await import("../scripts/hex-map/hex-records.mjs");

function setup(id) {
  const actors = ["a", "b"].map(key => ({ id: key, uuid: `Actor.${key}`, name: `Party ${key}`, type: "NPC",
    flags: { [MOD]: { party: true, partyData: { members: [] } } } }));
  let hold;
  const journal = { id: `j-${id}`, ownership: { default: 0 },
    flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: `Scene.${id}`, fogImported: true, cells: {} } } },
    async update(data) { await hold; for (const [key, value] of Object.entries(data)) {
      const [, mod, flag] = key.split("."); (this.flags[mod] ??= {})[flag] = value;
    } } };
  cacheHexJournal(journal);
  const projection = { id: `p-${id}`, flags: { [MOD]: { hexRecordProjection: { sceneUuid: `Scene.${id}`, cells: {} } } }, update: async () => {} };
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: actors, get: key => actors.find(a => a.id === key) },
    packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [journal] }) },
    journal: { contents: [projection] }, modules: new Map(), settings: { get: () => undefined }, time: { worldTime: 0 },
    i18n: { localize: key => key, format: (key, values) => `${key}:${JSON.stringify(values)}` } };
  const grid = { isHexagonal: true, getOffset: () => ({ i: 0, j: 0 }), getCenterPoint: () => ({ x: 50, y: 50 }),
    getVertices: () => [{ x: 0, y: 0 }], getAdjacentOffsets: () => [] };
  const scene = { id, uuid: `Scene.${id}`, grid,
    flags: { [MOD]: { hexFog: { enabled: true }, hexRecords: { adopted: true } } },
    getFlag(mod, key) { return this.flags[mod]?.[key]; },
    dimensions: { sceneRect: { x: 0, y: 0, width: 0, height: 0, contains: () => true } } };
  globalThis.canvas = { scene, grid, interface: new Container(), dimensions: { rect: {} }, tokens: { controlled: [] } };
  const app = new HexFogBrushApp();
  return { app, actors, journal, holdWrite() { let release; hold = new Promise(resolve => { release = resolve; }); return release; } };
}
function start(app) {
  app.container.events.pointerdown({ button: 0, shiftKey: false, stopPropagation() {}, getLocalPosition: () => ({ x: 50, y: 50 }) });
}

test("the fog brush input surface stays above tokens and notes", () => {
  const { app } = setup("input");
  canvas.interface.addChild(Object.assign(new Container(), { zIndex: 200 }));
  canvas.interface.addChild(Object.assign(new Container(), { zIndex: 800 }));
  app._onRender({}, {});
  try { assert.equal(canvas.interface.children.at(-1), app.container); }
  finally { app._onClose({}); }
});

test("the fog brush caption follows token-derived parties and the everyone fallback", async () => {
  const { app, actors } = setup("caption");
  canvas.tokens.controlled = [{ actor: actors[0] }];
  app._onRender({}, {});
  try {
    canvas.tokens.controlled = [{ actor: actors[1] }];
    Hooks.callAll("controlToken", canvas.tokens.controlled[0], true);
    await Promise.resolve();
    assert.ok(app.renders > 0, "token selection refreshes the caption");
    assert.match(app.context.whose, /Party b/);
    canvas.tokens.controlled = [];
    Hooks.callAll("controlToken", { actor: actors[1] }, false);
    await Promise.resolve();
    assert.equal(app.context.whose, "SDE.hexFog.brush.everyoneMap");
  } finally { app._onClose({}); }
  assert.equal([...handlers.values()].some(hook => hook.name === "controlToken"), false, "close removes the listener");
});

test("closing the fog brush during a save leaves the write successful without touching destroyed graphics", async () => {
  const { app, journal, holdWrite } = setup("closing");
  app._onRender({}, {});
  start(app);
  const release = holdWrite();
  const saving = app.endStroke();
  app._onClose({});
  release();
  await saving;
  assert.equal(journal.flags[MOD].hexRecords.cells["0_0"].discovery.revealed, true);
});
