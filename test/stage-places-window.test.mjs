/**
 * The Stage Places window, its toolbar button, template, strings and stylesheet.
 * Services run for real against a stubbed game (the setting store, the file picker); the window is the
 * real class on a stub ApplicationV2.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MAX_PLACES } from "../scripts/stage/places-core.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("languages/en.json"));
const tplAdd = read("templates/stage/places-add.hbs");
const tplList = read("templates/stage/places-list.hbs");
const tpl = `${tplAdd}\n${tplList}`;
const css = read("styles/stage.css").replace(/\/\*[\s\S]*?\*\//g, "");

class ApplicationV2 {
  constructor(options = {}) { this.options = options; this.renders = 0; this.fronted = 0; }
  render(o) { this.renders++; (this.renderArgs ??= []).push(o); this.lastRender = o; if (o?.force) this.rendered = true; return Promise.resolve(this); }
  bringToFront() { this.fronted++; }
  async close() { return this; }
}
let confirmAsk, confirmAnswer;
const api = { ApplicationV2, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: { confirm: async (o) => { confirmAsk.push(o); return confirmAnswer; } } };
globalThis.foundry = { applications: { api } };
const { StagePlacesApp } = await import("../scripts/stage/places-app.mjs");
const { registerStage } = await import("../scripts/stage/stage.mjs");

const PL = (id, name = id) => ({ id, kind: "town", name, image: `worlds/w/stage/${id}.webp` });

function setup({ gm = true, places = [], stage = null, canUpload = true } = {}) {
  const store = { stage, stagePlaces: { places } }, registered = {}, sets = [], notes = [], tools = {}, uploads = [];
  confirmAsk = []; confirmAnswer = true;
  globalThis.document = { body: { append() {} }, createElement: () => ({ setAttribute() {}, style: {} }), querySelector: () => null };
  globalThis.canvas = null;
  globalThis.ui = { notifications: { warn: (m) => notes.push(m) }, controls: { render() {} } };
  globalThis.foundry = { utils: { randomID: (n = 16) => "NEWID00000000000".slice(0, n), getRoute: (p) => `/r/${p}` },
    applications: { api, apps: { FilePicker: { implementation: {
      createDirectory: async () => {},
      upload: async (s, d, file) => { uploads.push(file.name); return { path: `${d}/${file.name}` }; },
    } } } } };
  globalThis.game = { user: { isGM: gm, can: (p) => p === "FILES_UPLOAD" && canUpload }, world: { id: "w" }, actors: { contents: [] },
    i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
    settings: { register: (m, k, o) => { registered[k] = o; }, get: (m, k) => store[k], set: async (m, k, v) => { store[k] = v; sets.push({ k, v }); } } };
  globalThis.Hooks = { once() {}, on: (n, f) => { if (n === "getSceneControlButtons") tools.fn = f; } };
  globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {} }; } async convertToBlob({ type }) { return { type }; } };
  globalThis.File = class { constructor(parts, name, o) { this.name = name; this.type = o?.type; } };
  globalThis.createImageBitmap = async (src) => ({ width: src.w, height: src.h, close() {} });
  registerStage();
  return { store, sets, notes, tools, uploads, registered };
}

/** A window with a fake DOM: just the elements the handlers read. */
function windowWith({ name = "", kind = "tavern", file = { type: "image/png", name: "a.png", w: 10, h: 10 } } = {}) {
  const el = { name: { value: name }, kind: { value: kind }, file: { files: file ? [file] : [], value: "x" }, add: { disabled: false }, note: { hidden: true } };
  const map = { "[data-add-name]": el.name, "[data-add-kind]": el.kind, "[data-add-file]": el.file, "[data-action=addPlace]": el.add, "[data-busy-note]": el.note };
  const app = new StagePlacesApp();
  app.element = { querySelector: (s) => map[s] ?? null, querySelectorAll: () => [] };
  return { app, el };
}

test("window options: id, classes, title and icon, one template that exists, GM-sized and resizable", () => {
  const o = StagePlacesApp.DEFAULT_OPTIONS;
  assert.equal(o.id, "sde-stage-places");
  assert.deepEqual(o.classes, ["sde-ui", "sde-stage-places"]);
  assert.ok(en[o.window.title]);
  assert.equal(o.window.resizable, true);
  assert.equal(o.position.width, 560);
  assert.deepEqual(Object.keys(StagePlacesApp.PARTS), ["add", "list"]); // the Add form comes first and is not redrawn with the list
  for (const part of Object.values(StagePlacesApp.PARTS)) assert.ok(existsSync(new URL(`../${part.template.replace(/^modules\/shadowdark-enhancer\//, "")}`, import.meta.url)));
  for (const fn of Object.values(o.actions)) assert.equal(typeof fn, "function");
});

test("the template has no literal text and every string key it uses exists", () => {
  const bare = tpl.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{[^}]*\}\}/g, "@@");
  const text = bare.replace(/<[^>]*>/g, "\n").split("\n").map((s) => s.replace(/@@/g, "").trim()).filter(Boolean);
  assert.deepEqual(text, [], "visible text outside {{localize}}");
  assert.doesNotMatch(bare.replace(/<!--[\s\S]*?-->/g, ""), /(?:placeholder|title|aria-label|alt)="[^"@]+"/);
  const keys = [...tpl.matchAll(/SDE\.stage\.places\.\w+/g)].map((m) => m[0]);
  assert.ok(keys.length >= 12);
  for (const k of keys) assert.ok(en[k], k);
  for (const k of ["tool", "title", "kindTown", "kindTavern", "kindCamp", "kindCustom", "capReached", "noPicture", "uploading", "confirmTitle", "confirmBody", "confirmYes"]) assert.ok(en[`SDE.stage.places.${k}`], k);
  assert.match(en["SDE.stage.places.confirmBody"], /\{name\}/);
  assert.match(en["SDE.stage.places.capReached"], /\{max\}/);
  assert.doesNotMatch(en["SDE.stage.places.capReached"], /\d/);
});

test("every row control has an accessible name with the place name, and a name input that keeps focus on redraw", () => {
  for (const k of ["Show", "Hide", "Replace", "Delete", "Name", "Kind"]) {
    assert.match(tplList, new RegExp(`aria-label="\\{\\{localize 'SDE\\.stage\\.places\\.aria${k}' name=p\\.name\\}\\}"`), k);
    assert.match(en[`SDE.stage.places.aria${k}`], /\{name\}/);
  }
  assert.match(tplList, /class="sp-name" id="sp-name-\{\{p\.id\}\}" name="sp-name-\{\{p\.id\}\}"/);
  assert.match(tplAdd, /data-busy-note/); // the upload note sits with the Add button, above the list
});

test("no SDE.stage key is a prefix of another", () => {
  const ks = Object.keys(en).filter((k) => k.startsWith("SDE.stage"));
  for (const a of ks) for (const b of ks) if (a !== b) assert.ok(!b.startsWith(a), `${a} is a prefix of ${b}`);
});

test("the stylesheet rules are scoped, colourless, with buttons at least 22 px, container queries not viewport", () => {
  const mine = css.split("\n").filter((l) => /\.sp-|\.sde-stage-places/.test(l)).join("\n");
  assert.ok(mine.length > 200);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.match(css, /@container \(max-width: \d+px\)/);
  assert.doesNotMatch(css, /@media \((?:max|min)-width/);
  assert.doesNotMatch(css, /border-radius:\s*(?:999|50%)/);
  const btn = css.match(/\.sp-actions \.ui-btn\s*{[^}]*}/)[0];
  assert.ok(Number(btn.match(/min-height:\s*(\d+)px/)[1]) >= 22);
  for (const line of css.split("\n").filter((l) => /\.sp-/.test(l))) assert.match(line, /\.sde-stage-places|^\s*\.sde-stage-places|^@container/, line); // every .sp- rule hangs off the window class
  assert.ok(read("module.json").includes("styles/stage.css"));
});

test("the Places tool exists only for a GM: Tokens group, order 92, a button, images icon, lazy import", async () => {
  const gm = setup();
  const controls = { tokens: { tools: {} } };
  gm.tools.fn(controls);
  const t = controls.tokens.tools.sdeStagePlaces;
  assert.deepEqual([t.name, t.order, t.button, t.icon, t.title], ["sdeStagePlaces", 92, true, "fa-solid fa-images", "SDE.stage.places.tool"]);
  assert.ok(en[t.title]);
  assert.equal(controls.tokens.tools.sdeStage.toggle, true);
  assert.match(read("scripts/stage/stage.mjs"), /import\("\.\/places-app\.mjs"\)/);
  const player = setup({ gm: false });
  const pc = { tokens: { tools: {} } };
  player.tools.fn(pc);
  assert.deepEqual(pc.tokens.tools, {});
});

test("open() is null for a non-GM; a GM gets one window, redrawn and raised each time", () => {
  setup({ gm: false });
  assert.equal(StagePlacesApp.open(), null);
  setup();
  const a = StagePlacesApp.open();
  const b = StagePlacesApp.open();
  assert.equal(a, b);
  assert.equal(a.renders, 2);
  assert.equal(a.fronted, 2);
  assert.deepEqual(a.renderArgs, [{ force: true }, { parts: ["list"] }]); // a second open keeps the Add form: only the list is redrawn
  StagePlacesApp._current = null;
});

test("Add refuses at the cap and uploads nothing", async () => {
  const e = setup({ places: Array.from({ length: MAX_PLACES }, (_, i) => PL(`p${i}`)) });
  const { app } = windowWith();
  await app._onAdd();
  assert.deepEqual(e.notes, [`SDE.stage.places.capReached|{"max":${MAX_PLACES}}`]);
  assert.deepEqual(e.uploads, []);
});

test("Add refuses with no picture chosen", async () => {
  const e = setup();
  const { app } = windowWith({ file: null });
  await app._onAdd();
  assert.deepEqual(e.notes, ["SDE.stage.places.noPicture"]);
  assert.deepEqual(e.sets, []);
});

test("Add defaults an empty name from the kind, uploads, then adds the place and ends busy", async () => {
  const e = setup();
  const { app, el } = windowWith({ name: "   ", kind: "camp" });
  await app._onAdd();
  const list = e.store.stagePlaces.places;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].kind, list[0].name, list[0].id], ["camp", "SDE.stage.places.kindCamp", "NEWID00000000000"]);
  assert.match(list[0].image, /^worlds\/w\/stage\/.+\.webp$/);
  assert.equal(e.uploads.length, 1);
  assert.equal(el.add.disabled, false);
  assert.equal(el.note.hidden, true);
  assert.equal(el.file.value, "");
});

test("Add shows the busy state during the upload", async () => {
  const e = setup();
  const { app, el } = windowWith({ name: "Inn" });
  let seen;
  globalThis.foundry.applications.apps.FilePicker.implementation.upload = async (s, d, f) => { seen = [el.add.disabled, el.note.hidden]; return { path: `${d}/${f.name}` }; };
  await app._onAdd();
  assert.deepEqual(seen, [true, false]);
  assert.equal(e.store.stagePlaces.places[0].name, "Inn");
});

test("Add adds nothing when the upload fails (not a picture, or denied)", async () => {
  const e = setup();
  const { app, el } = windowWith({ file: { type: "text/plain", name: "a.txt" } });
  await app._onAdd();
  assert.deepEqual(e.sets, []);
  assert.equal(el.add.disabled, false);
  const d = setup({ canUpload: false });
  await windowWith().app._onAdd();
  assert.deepEqual(d.sets, []);
  assert.deepEqual(d.notes, ["SDE.stage.uploadDenied"]);
});

test("Show raises the place, Hide hides the stage", async () => {
  const e = setup({ places: [PL("a")] });
  const { app } = windowWith();
  await app._onShow(null, { dataset: { placeId: "a" } });
  assert.deepEqual(e.sets.map((s) => [s.k, s.v.shown, s.v.place]), [["stage", true, "a"]]);
  await app._onHide();
  assert.equal(e.sets.at(-1).v.shown, false);
});

test("Delete asks first, names the place, and removes only on yes", async () => {
  const e = setup({ places: [PL("a", "Old Mill"), PL("b")] });
  const { app } = windowWith();
  confirmAnswer = false;
  await app._onDelete(null, { dataset: { placeId: "a" } });
  assert.equal(e.sets.length, 0);
  assert.match(confirmAsk[0].content, /Old Mill/);
  assert.deepEqual(confirmAsk[0].classes, ["sde-ui", "sde-dialog"]);
  assert.equal(confirmAsk[0].yes.label, "SDE.stage.places.confirmYes");
  confirmAnswer = true;
  await app._onDelete(null, { dataset: { placeId: "a" } });
  assert.deepEqual(e.store.stagePlaces.places.map((p) => p.id), ["b"]);
});

test("a name edit writes, an empty name keeps the old one, a kind edit writes the kind", async () => {
  const e = setup({ places: [PL("a", "Mill")] });
  const { app } = windowWith();
  const input = (v, field) => ({ value: v, defaultValue: "Mill", dataset: { placeId: "a", placeField: field } });
  await app._onField(input("  Barn ", "name"));
  assert.equal(e.store.stagePlaces.places[0].name, "Barn");
  const blank = input("   ", "name");
  const before = e.sets.length;
  await app._onField(blank);
  assert.equal(e.sets.length, before);
  assert.equal(blank.value, "Mill");
  await app._onField(input("tavern", "kind"));
  assert.equal(e.store.stagePlaces.places[0].kind, "tavern");
});

test("a second Add click while the upload is pending uploads once and adds one place", async () => {
  const e = setup();
  const { app } = windowWith({ name: "Inn" });
  const release = [];
  globalThis.foundry.applications.apps.FilePicker.implementation.upload = (s, d, f) => new Promise((res) => { e.uploads.push(f.name); release.push(() => res({ path: `${d}/${f.name}` })); });
  const first = app._onAdd();
  await new Promise((r) => setImmediate(r));
  const second = app._onAdd(); // the button is disabled, but a fast double click can still arrive
  await new Promise((r) => setImmediate(r));
  release.forEach((f) => f());
  await Promise.all([first, second]);
  assert.equal(e.uploads.length, 1);
  assert.equal(e.store.stagePlaces.places.length, 1);
});

test("Replace picture uploads, then writes the new image; a failed upload writes nothing", async () => {
  const e = setup({ places: [PL("a", "Mill")] });
  const { app } = windowWith();
  const input = (file) => ({ files: file ? [file] : [], value: "x", dataset: { replaceFile: "a" } });
  await app._onReplaceFile(input({ type: "image/png", name: "n.png", w: 10, h: 10 }));
  assert.equal(e.uploads.length, 1);
  assert.match(e.store.stagePlaces.places[0].image, /^worlds\/w\/stage\/mill-.+\.webp$/);
  const before = e.sets.length;
  await app._onReplaceFile(input({ type: "text/plain", name: "n.txt" }));
  assert.equal(e.sets.length, before);
  assert.deepEqual(e.notes, ["SDE.stage.uploadNotImage"]);
  const clicks = [];
  app.element = { querySelectorAll: () => [{ dataset: { replaceFile: "a" }, click: () => clicks.push("a") }, { dataset: { replaceFile: "b" }, click: () => clicks.push("b") }] };
  app._onReplace(null, { dataset: { placeId: "a" } });
  assert.deepEqual(clicks, ["a"]);
});

test("redraw wiring: both settings redraw only the list of the open window, and open() registers the window", async () => {
  const e = setup();
  const { refreshPlacesWindow } = await import("../scripts/stage/places.mjs");
  assert.equal(e.registered.stagePlaces.onChange, refreshPlacesWindow);
  const app = StagePlacesApp.open();
  app.renderArgs.length = 0;
  e.registered.stage.onChange(); // a camp raising the stage
  assert.deepEqual(app.renderArgs, [{ parts: ["list"] }]);
  app.renderArgs.length = 0;
  e.registered.stagePlaces.onChange(); // another GM renaming a place
  assert.deepEqual(app.renderArgs, [{ parts: ["list"] }]);
  await app.close();
  app.renderArgs.length = 0;
  e.registered.stagePlaces.onChange();
  assert.deepEqual(app.renderArgs, []); // closed: nothing to redraw
  StagePlacesApp._current = null;
});

test("listeners bind once per rendered list part and not at all for the Add part", async () => {
  const e = setup({ places: [PL("a", "Mill")] });
  const { app } = windowWith();
  const tree = () => {
    const field = { dataset: { placeId: "a", placeField: "name" }, value: "", defaultValue: "Mill", handlers: [], addEventListener(t, f) { this.handlers.push(f); } };
    return { field, root: { querySelector: () => null, querySelectorAll: (s) => (s === "[data-place-field]" ? [field] : []) } };
  };
  const fire = async (field, value) => { field.value = value; await Promise.all(field.handlers.map((h) => h())); };
  let t = tree();
  app.element = t.root;
  app._onRender({}, { parts: ["add", "list"] });
  app._onRender({}, { parts: ["add"] }); // the list was kept: nothing binds again
  assert.equal(t.field.handlers.length, 1);
  await fire(t.field, "Barn");
  assert.equal(e.sets.length, 1);
  t = tree(); // a new list part replaces the old elements
  app.element = t.root;
  app._onRender({}, { parts: ["list"] });
  assert.equal(t.field.handlers.length, 1);
  await fire(t.field, "Shed");
  assert.equal(e.sets.length, 2);
  const add = tree();
  app.element = add.root;
  app._onRender({}, { parts: ["add"] });
  assert.equal(add.field.handlers.length, 0);
});

test("the toolbar button warns instead of failing silently when the window cannot open", async () => {
  const gm = setup();
  const controls = { tokens: { tools: {} } };
  gm.tools.fn(controls);
  const open = StagePlacesApp.open, err = console.error;
  const logged = [];
  StagePlacesApp.open = () => { throw new Error("boom"); };
  console.error = (...a) => logged.push(a);
  try {
    await controls.tokens.tools.sdeStagePlaces.onChange();
  } finally {
    StagePlacesApp.open = open;
    console.error = err;
  }
  assert.deepEqual(gm.notes, ["SDE.stage.places.openFailed"]);
  assert.match(String(logged[0][0]), /^shadowdark-enhancer \| stage/);
  assert.ok(en["SDE.stage.places.openFailed"]);
});

test("the cap notice passes the real maximum", async () => {
  const e = setup({ places: Array.from({ length: MAX_PLACES }, (_, i) => PL(`p${i}`)) });
  const seen = [];
  globalThis.game.i18n.format = (k, d) => { seen.push([k, d]); return k; };
  await windowWith().app._onAdd();
  assert.deepEqual(seen, [["SDE.stage.places.capReached", { max: MAX_PLACES }]]);
  assert.equal(e.notes.length, 1);
});
