import test from "node:test";
import assert from "node:assert/strict";
import { registerMapNetwork, refreshMapNetwork } from "../scripts/hex-map/map-network.mjs";

// Just enough of PIXI, the primary group and Hooks to see what the overlay adds, when, and what it removes.
let made = 0;
class Graphics {
  constructor() { made++; this.ops = []; }
  lineStyle(options) { this.ops.push(["lineStyle", options]); return this; }
  moveTo(x, y) { this.ops.push(["moveTo", x, y]); return this; }
  lineTo(x, y) { this.ops.push(["lineTo", x, y]); return this; }
  of(name) { return this.ops.filter((op) => op[0] === name); }
}
class Container {
  constructor() { this.children = []; this.destroyed = false; this.parent = null; }
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  destroy() { this.destroyed = true; const at = this.parent?.children.indexOf(this) ?? -1; if (at >= 0) this.parent.children.splice(at, 1); }
}
const handlers = {};
globalThis.PIXI = { Graphics, LINE_CAP: { ROUND: "round" }, LINE_JOIN: { ROUND: "round" } };
globalThis.foundry = { canvas: { primary: { PrimaryCanvasContainer: Container } } };
globalThis.Hooks = { on: (name, fn) => (handlers[name] ??= []).push(fn) };
registerMapNetwork();

const network = {
  drawingId: "n", type: "mapNetwork", strokeWidth: 38.4, roadColor: "#D8C6A8", riverColor: "#2D9CDB", opacity: 1,
  networkPaths: { road: [[[0, 0], [100, 0]]], river: [[[0, 50], [200, 50]], [[10, 10], [20, 20]]] },
};
function world({ extrasActive = false, hex = true, flag = [network], ready = true, isGM = false } = {}) {
  const scene = { id: "s", grid: { isHexagonal: hex }, flags: { "shadowdark-extras": { permanentDrawings: flag } } };
  const primary = new Container();
  globalThis.canvas = { ready, scene, primary };
  globalThis.game = { user: { isGM }, modules: { get: (id) => (id === "shadowdark-extras" && extrasActive !== null ? { active: extrasActive } : undefined) } };
  made = 0;
  return { scene, primary };
}
const fire = (name, ...args) => (handlers[name] ?? []).forEach((fn) => fn(...args));

test("registers the three hooks the overlay lives on", () => {
  assert.equal(handlers.canvasReady?.length, 1);
  assert.equal(handlers.canvasTearDown?.length, 1);
  assert.equal(handlers.updateScene?.length, 1);
});

test("Extras off: the viewed hex map gets one layer, above tiles and below tokens, rivers before roads", () => {
  const { primary } = world();
  fire("canvasReady");
  assert.equal(primary.children.length, 1);
  const layer = primary.children[0];
  assert.equal(layer.name, "sde-map-network");
  assert.equal(layer.sortLayer, 600, "core Drawings' sort layer: Tiles are 500, Tokens 700");
  assert.equal(layer.eventMode, "none");
  const graphics = layer.children[0];
  const styles = graphics.of("lineStyle");
  assert.deepEqual(styles.map(([, o]) => o.color), [0x2d9cdb, 0x2d9cdb, 0xd8c6a8]);
  assert.ok(styles.every(([, o]) => o.width === 38.4 && o.cap === "round" && o.join === "round"));
  assert.equal(graphics.of("moveTo").length, 3);
});

test("Extras active draws nothing of its own, and removes a layer drawn while it was off", () => {
  const { primary } = world({ extrasActive: false });
  fire("canvasReady");
  const layer = primary.children[0];
  globalThis.game.modules.get = () => ({ active: true });
  fire("canvasReady");
  assert.equal(layer.destroyed, true);
  assert.equal(primary.children.length, 0);
  assert.equal(made, 1, "no second graphics was built");
});

test("a scene tears its layer down with the canvas", () => {
  const { primary } = world();
  fire("canvasReady");
  const layer = primary.children[0];
  fire("canvasTearDown");
  assert.equal(layer.destroyed, true);
  assert.equal(primary.children.length, 0);
});

test("a redraw replaces the layer instead of stacking another", () => {
  const { primary } = world();
  fire("canvasReady");
  const first = primary.children[0];
  refreshMapNetwork();
  assert.equal(first.destroyed, true);
  assert.equal(primary.children.length, 1);
});

test("updateScene redraws only for a flags change on the viewed scene", () => {
  const { scene } = world();
  fire("canvasReady");
  made = 0;
  fire("updateScene", { id: "other" }, { flags: { x: 1 } });
  fire("updateScene", scene, { name: "renamed" });
  fire("updateScene", scene, { flags: { "shadowdark-extras": { permanentDrawings: [network] } } });
  assert.equal(made, 1, "only the viewed scene's flags change redrew");
});

test("nothing is drawn on a square grid, with no overlay flag, or before the canvas is ready", () => {
  for (const options of [{ hex: false }, { flag: null }, { flag: [] }, { ready: false }]) {
    const { primary } = world(options);
    fire("canvasReady");
    assert.equal(primary.children.length, 0, JSON.stringify(options));
  }
});

test("a map with Extras not installed at all draws the lines too", () => {
  const { primary } = world({ extrasActive: null });
  fire("canvasReady");
  assert.equal(primary.children.length, 1);
});

test("a hidden network is drawn for the GM and not for a player", () => {
  const hidden = { ...network, hidden: true };
  const player = world({ flag: [hidden], isGM: false });
  fire("canvasReady");
  assert.equal(player.primary.children.length, 0);
  const gm = world({ flag: [hidden], isGM: true });
  fire("canvasReady");
  assert.equal(gm.primary.children.length, 1);
});
