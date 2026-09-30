import test from "node:test";
import assert from "node:assert/strict";

// The confirmation dialog's own handlers, run against DOM stand-ins: the window
// is DialogV2 content plus listeners, and what matters is what Create answers.
globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 }, GRID_MIN_SIZE: 20 };
globalThis.ui = { notifications: { warn() {} } };
globalThis.foundry = { utils: { escapeHTML: (s) => s }, applications: { api: { DialogV2: {} } } };
const { confirmLattice } = await import("../scripts/hex-map/hex-map-flow.mjs");
const { latticeCentre } = await import("../scripts/hex-map/lattice.mjs");

const noop = new Proxy(() => {}, { get: () => noop, set: () => true, apply: () => noop });

/** One dialog: returns the fake root, the fields and a way to press Create. */
function openDialog(lat, { imageW = 1000, imageH = 800 } = {}) {
  const canvases = [];
  globalThis.document = { createElement: () => { const c = { style: {}, listeners: {}, getContext: () => noop, append() {}, addEventListener(type, fn) { this.listeners[type] = fn; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: imageW, height: imageH }) }; canvases.push(c); return c; } };
  globalThis.window = { open() {} };
  const fields = {
    cols: { value: String(lat?.cols ?? ""), listeners: [], addEventListener(_t, fn) { this.listeners.push(fn); } },
    rows: { value: String(lat?.rows ?? ""), listeners: [], addEventListener(_t, fn) { this.listeners.push(fn); } },
    lowered: { value: lat?.lowered ?? "odd", listeners: [], addEventListener(_t, fn) { this.listeners.push(fn); } },
    short: { value: "on", checked: false, listeners: [], addEventListener(_t, fn) { this.listeners.push(fn); } },
    firstNum: { value: "0000" },
  };
  const info = { innerHTML: "" }, create = { disabled: false }, hand = { listeners: [], addEventListener(_t, fn) { this.listeners.push(fn); } };
  const slot = { replaceChildren(c) { slot.canvas = c; } };
  const root = { querySelector(sel) {
    if (sel === "#sde-hexmap-info") return info;
    if (sel === "[data-action='create']") return create;
    if (sel === "#sde-hexmap-preview") return slot;
    if (sel === "#sde-hexmap-corners") return { replaceChildren() {}, append() {} };
    if (sel === "#sde-hexmap-hand") return hand;
    const m = /^\[name='(\w+)'\]$/.exec(sel);
    return m ? fields[m[1]] : null;
  } };
  let config;
  globalThis.foundry.applications.api.DialogV2.wait = (cfg) => new Promise((resolve) => { config = cfg; cfg.render({}, { element: root }); config.resolve = resolve; });
  const preview = { width: imageW, height: imageH };
  const answered = confirmLattice({ preview, full: null, file: null, lat, imageW, corners: [] });
  const change = (name, value) => { fields[name][name === "short" ? "checked" : "value"] = value; for (const fn of fields[name].listeners) fn(); };
  const clickPrint = (u, v) => slot.canvas.listeners.click({ clientX: u, clientY: v });
  /** Set the corners by hand: the two clicks the GM makes on the print. */
  const setByHand = (tl, br) => { hand.listeners[0](); clickPrint(tl.u, tl.v); clickPrint(br.u, br.v); };
  const pressCreate = () => {
    const button = config.buttons.find((b) => b.action === "create");
    config.resolve(button.callback({}, {}, { element: root }));
    return answered;
  };
  return { fields, info, create, change, setByHand, pressCreate };
}

const truth = { x0: 100, y0: 90, pitchX: 60, pitchY: 68, cols: 11, rows: 10, rowsLowered: 10, lowered: "odd" };
const corners = () => ({ tl: latticeCentre(truth, 0, 0), br: latticeCentre(truth, 10, 9) });

test("a hand-set lattice submits exactly the lattice its counts describe", async () => {
  const d = openDialog(null);
  assert.equal(d.create.disabled, true, "no grid found: nothing to create yet");
  d.change("cols", "11"); d.change("rows", "10");
  const { tl, br } = corners();
  d.setByHand(tl, br);
  assert.equal(d.create.disabled, false);
  const answer = await d.pressCreate();
  assert.deepEqual([answer.cols, answer.rows, answer.lat.cols, answer.lat.rows], [11, 10, 11, 10]);
  assert.ok(Math.abs(answer.lat.pitchX - 60) < 1e-9 && Math.abs(answer.lat.pitchY - 68) < 1e-9);
});

test("counts that no longer fit the hand-set corners leave Create off, and nothing stale is submitted", async () => {
  // Reviewer's reproduction: a valid 11 x 10 lattice, then columns = 1 (the box allows it).
  const d = openDialog(null);
  d.change("cols", "11"); d.change("rows", "10");
  const { tl, br } = corners();
  d.setByHand(tl, br);
  d.change("cols", "1");
  assert.equal(d.create.disabled, true, "the fields no longer make a grid");
  assert.match(d.info.innerHTML, /handNoFit/, "and the window says why");
  const answer = await d.pressCreate();
  assert.equal(answer, null, "whatever gets through is refused, not created with the old lattice");
});

test("fixing the counts after a failed refit turns Create back on, with a coherent answer", async () => {
  const d = openDialog(null);
  d.change("cols", "11"); d.change("rows", "10");
  const { tl, br } = corners();
  d.setByHand(tl, br);
  d.change("cols", "1");
  d.change("cols", "11");
  assert.equal(d.create.disabled, false);
  assert.doesNotMatch(d.info.innerHTML, /handNoFit/);
  const answer = await d.pressCreate();
  assert.deepEqual([answer.cols, answer.lat.cols], [11, 11]);
});

test("a first hand placement that does not fit keeps Create off, and the counts re-fit from the same clicks", async () => {
  // Two clicks that cannot span a lattice (bottom-right left of the top-left), then a fix elsewhere.
  const d = openDialog(null);
  d.change("cols", "11"); d.change("rows", "10");
  const { tl, br } = corners();
  d.setByHand(br, tl);
  assert.equal(d.create.disabled, true);
  assert.match(d.info.innerHTML, /handNoFit/);
  d.setByHand(tl, br);
  assert.equal(d.create.disabled, false);
  assert.doesNotMatch(d.info.innerHTML, /handNoFit/);
});

test("Create pressed before the counts' change event fired still submits one coherent lattice", async () => {
  // Enter in a number box submits the form; the field may not have reported its change yet.
  const d = openDialog(null);
  d.change("cols", "11"); d.change("rows", "10");
  const { tl, br } = corners();
  d.setByHand(tl, br);
  d.fields.cols.value = "12";                     // typed, no change event
  const answer = await d.pressCreate();
  assert.deepEqual([answer.cols, answer.lat.cols], [12, 12], "the lattice is fitted to the counts submitted");
});

test("a detected lattice keeps the counts the GM corrects, as before", async () => {
  const d = openDialog({ ...truth });
  d.change("rows", "9");
  const answer = await d.pressCreate();
  assert.deepEqual([answer.cols, answer.rows, answer.lat.pitchY], [11, 9, 68], "detected pitches stay; only the counts move");
});
