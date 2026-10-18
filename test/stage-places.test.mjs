import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePlaces } from "../scripts/stage/places-core.mjs";
import { registerPlaces, readPlaces, writePlaces, showPlace, removePlaceAndHide, uploadPlacePicture, updatePlaceInList, addPlaceToList } from "../scripts/stage/places.mjs";
import { registerStage } from "../scripts/stage/stage.mjs";

const M = "shadowdark-enhancer";
const PL = { id: "p1", kind: "tavern", name: "Boar", image: "worlds/w/stage/boar.webp" };

function setup({ gm = true, places = { places: [PL] }, stage = null, canUpload = true, dirs = [] } = {}) {
  const store = { stage, stagePlaces: places }, sets = [], registered = {}, notes = [], hooks = {};
  const calls = { create: [], upload: [], resize: [] };
  globalThis.Hooks = { once() {}, on: (n, f) => { hooks[n] = f; } };
  globalThis.document = { body: { append() {} }, createElement: () => ({ setAttribute() {}, style: {} }), querySelector: () => null };
  globalThis.canvas = null;
  globalThis.ui = { notifications: { warn: (m) => notes.push(m) }, controls: { render() {} } };
  globalThis.foundry = { utils: { randomID: (n) => "ABCDEFGHIJKLMNOP".slice(0, n) },
    applications: { apps: { FilePicker: { implementation: {
      createDirectory: async (src, d) => { if (dirs.includes(d)) throw new Error("EEXIST"); dirs.push(d); calls.create.push(d); },
      upload: async (src, d, file) => { calls.upload.push({ src, d, file }); return { path: `${d}/${file.name}` }; },
    } } } } };
  globalThis.game = { user: { isGM: gm, can: (p) => p === "FILES_UPLOAD" && canUpload }, world: { id: "w" }, actors: { contents: [] },
    i18n: { localize: (k) => k },
    settings: { register: (m, k, d) => { registered[k] = { m, d }; },
      get: (m, k) => store[k], set: async (m, k, v) => { store[k] = v; sets.push({ k, v }); } } };
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.w = w; this.h = h; calls.canvas = [w, h]; }
    getContext() { return { drawImage() {} }; } async convertToBlob({ type }) { return { type }; } };
  globalThis.File = class { constructor(parts, name, o) { this.name = name; this.type = o?.type; } };
  globalThis.createImageBitmap = async (src, opts) => {
    if (src.bad) throw new Error("decode");
    if (opts) { calls.resize.push([opts.resizeWidth, opts.resizeHeight]); return { width: opts.resizeWidth, height: opts.resizeHeight, close() {} }; }
    return { width: src.w, height: src.h, close() {} };
  };
  return { store, sets, registered, notes, calls, hooks };
}
const img = (w, h, extra) => ({ type: "image/png", name: "a.png", w, h, ...extra });

test("the setting registers by a literal call: world scope, hidden, normalized default", () => {
  const e = setup();
  registerPlaces();
  const r = e.registered.stagePlaces;
  assert.equal(r.m, M);
  assert.equal(r.d.scope, "world");
  assert.equal(r.d.config, false);
  assert.deepEqual(r.d.default, normalizePlaces(null));
  const src = readFileSync(new URL("../scripts/stage/places.mjs", import.meta.url), "utf8");
  assert.match(src, /game\.settings\.register\(MODULE_ID, "stagePlaces", \{/);
});
test("registerStage registers the places setting too", () => {
  const e = setup();
  registerStage();
  assert.ok(e.registered.stagePlaces && e.registered.stage);
});
test("showPlace writes exactly the stage value and never stagePlaces", async () => {
  const e = setup();
  await showPlace("p1");
  assert.deepEqual(e.sets, [{ k: "stage", v: { shown: true, place: "p1", image: PL.image, partyId: "", campId: "", kind: "tavern", pageSceneId: "" } }]);
  await showPlace("gone");
  assert.equal(e.sets.length, 1);
});
test("writing the list never writes the stage; removing a non-shown place leaves the stage alone", async () => {
  const e = setup({ stage: { shown: true, place: "camp", image: "c.webp", partyId: "", campId: "" } });
  await writePlaces({ places: [PL, { ...PL, id: "p2" }] });
  await removePlaceAndHide("p2");
  assert.deepEqual(e.sets.map((s) => s.k), ["stagePlaces", "stagePlaces"]);
  assert.deepEqual(readPlaces().places.map((p) => p.id), ["p1"]);
});
test("removing the shown place hides the stage and keeps the rest of it", async () => {
  const shown = { shown: true, place: "p1", image: PL.image, partyId: "", campId: "", kind: "tavern", pageSceneId: "" };
  const e = setup({ stage: shown });
  await removePlaceAndHide("p1");
  assert.deepEqual(e.sets.map((s) => s.k), ["stagePlaces", "stage"]);
  assert.deepEqual(e.store.stage, { ...shown, shown: false });
  assert.deepEqual(e.store.stagePlaces, { places: [] });
});
test("non-GM calls do nothing", async () => {
  const e = setup({ gm: false });
  assert.equal(await writePlaces({ places: [] }), null);
  await showPlace("p1");
  await removePlaceAndHide("p1");
  assert.deepEqual(e.sets, []);
});
test("upload without FILES_UPLOAD: null, a notice, no upload and no folder", async () => {
  const e = setup({ canUpload: false });
  assert.equal(await uploadPlacePicture(img(10, 10)), null);
  assert.deepEqual(e.notes, ["SDE.stage.uploadDenied"]);
  assert.equal(e.calls.upload.length + e.calls.create.length, 0);
});
test("a non-image or undecodable file is refused before anything is uploaded", async () => {
  const e = setup();
  assert.equal(await uploadPlacePicture({ type: "text/plain", name: "a.txt" }), null);
  assert.equal(await uploadPlacePicture(img(1, 1, { bad: true })), null);
  assert.deepEqual(e.notes, ["SDE.stage.uploadNotImage", "SDE.stage.uploadNotImage"]);
  assert.equal(e.calls.upload.length + e.calls.create.length, 0);
});
test("first time: the folder is created once, then uploaded; an existing folder is fine", async () => {
  const dirs = [];
  const e = setup({ dirs });
  const path = await uploadPlacePicture(img(100, 80), "The Boar");
  assert.deepEqual(e.calls.create, ["worlds/w/stage"]);
  assert.equal(e.calls.upload.length, 1);
  assert.equal(e.calls.upload[0].src, "data");
  assert.equal(e.calls.upload[0].d, "worlds/w/stage");
  assert.equal(path, "worlds/w/stage/the-boar-abcdef.webp");
  assert.equal(await uploadPlacePicture(img(100, 80), "Two"), "worlds/w/stage/two-abcdef.webp"); // directory now exists: createDirectory throws, upload still goes
  assert.equal(e.calls.create.length, 1);
  assert.deepEqual(e.notes, []);
});
test("a big picture is downscaled to 2560 on the long edge; a small one is not touched", async () => {
  const e = setup();
  await uploadPlacePicture(img(5000, 3000));
  assert.deepEqual(e.calls.resize, [[2560, 1536]]);
  assert.deepEqual(e.calls.canvas, [2560, 1536]);
  await uploadPlacePicture(img(800, 600));
  assert.equal(e.calls.resize.length, 1);
  assert.deepEqual(e.calls.canvas, [800, 600]);
});
test("a browser that cannot encode WebP gets a JPEG", async () => {
  const e = setup();
  globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {} }; } async convertToBlob({ type }) { return { type: type === "image/webp" ? "image/png" : type }; } };
  assert.match(await uploadPlacePicture(img(10, 10), "x"), /x-abcdef\.jpg$/);
  assert.equal(e.calls.upload[0].file.type, "image/jpeg");
});
test("an upload that reports no path fails with a notice and null", async () => {
  const e = setup();
  globalThis.foundry.applications.apps.FilePicker.implementation.upload = async () => ({});
  const quiet = console.error; console.error = () => {};
  try { assert.equal(await uploadPlacePicture(img(10, 10)), null); } finally { console.error = quiet; }
  assert.deepEqual(e.notes, ["SDE.stage.uploadFailed"]);
});
test("the toolbar toggle re-shows the last custom place, else raises the camp", async () => {
  const hiddenCustom = { shown: false, place: "p1", image: PL.image, partyId: "", campId: "", kind: "tavern", pageSceneId: "" };
  let e = setup({ stage: hiddenCustom });
  registerStage();
  const controls = { tokens: { tools: {} } };
  e.hooks.getSceneControlButtons(controls);
  await controls.tokens.tools.sdeStage.onChange();
  assert.deepEqual(e.sets.at(-1).v, { shown: true, place: "p1", image: PL.image, partyId: "", campId: "", kind: "tavern", pageSceneId: "" });
  e = setup({ stage: { ...hiddenCustom, image: "old.webp" }, places: { places: [{ ...PL, image: "worlds/w/stage/new.webp" }] } });
  registerStage();
  e.hooks.getSceneControlButtons(controls);
  await controls.tokens.tools.sdeStage.onChange();
  assert.equal(e.sets.at(-1).v.image, "worlds/w/stage/new.webp", "after Replace picture the toggle shows the new picture");
  e = setup({ stage: { ...hiddenCustom, place: "camp", image: "old.webp" } });
  registerStage();
  e.hooks.getSceneControlButtons(controls);
  await controls.tokens.tools.sdeStage.onChange();
  assert.equal(e.sets.at(-1).v.place, "camp");
});
test("a picture change of the place on show also writes the stage; other edits and other places do not", async () => {
  const shown = { shown: true, place: "p1", image: PL.image, partyId: "", campId: "", kind: "tavern", pageSceneId: "" };
  const other = { id: "p2", kind: "custom", name: "Other", image: "o.webp" };
  let e = setup({ stage: shown, places: { places: [PL, other] } });
  await updatePlaceInList("p1", { image: "worlds/w/stage/new.webp" });
  assert.deepEqual(e.sets.map((s) => s.k), ["stagePlaces", "stage"]);
  assert.deepEqual(e.sets[1].v, { ...shown, image: "worlds/w/stage/new.webp" });
  e = setup({ stage: shown, places: { places: [PL, other] } });
  await updatePlaceInList("p1", { name: "New" });
  await updatePlaceInList("p2", { image: "z.webp" });
  assert.deepEqual(e.sets.map((s) => s.k), ["stagePlaces", "stagePlaces"]);
});
test("showPlace copies kind and pageSceneId (empty when none) into the stage", async () => {
  let e = setup({ places: { places: [{ ...PL, kind: "town", pageSceneId: "sc1" }] } });
  await showPlace("p1");
  assert.deepEqual(e.store.stage, { shown: true, place: "p1", image: PL.image, partyId: "", campId: "", kind: "town", pageSceneId: "sc1" });
  e = setup({ places: { places: [{ ...PL, kind: "custom" }] } });
  await showPlace("p1");
  assert.equal(e.store.stage.pageSceneId, "");
  assert.equal(e.store.stage.kind, "custom");
});
test("an edit to the shown place's kind or page scene refreshes the stage, so the camp guard follows", async () => {
  const shown = { shown: true, place: "p1", image: PL.image, partyId: "", campId: "", kind: "tavern", pageSceneId: "" };
  let e = setup({ stage: shown });
  await updatePlaceInList("p1", { kind: "custom" });
  assert.deepEqual(e.sets.map((s) => s.k), ["stagePlaces", "stage"]);
  assert.equal(e.store.stage.kind, "custom");
  e = setup({ stage: shown });
  await updatePlaceInList("p1", { pageSceneId: "sc9" });
  assert.equal(e.store.stage.pageSceneId, "sc9");
  e = setup({ stage: { ...shown, place: "p2" } });
  await updatePlaceInList("p1", { kind: "town" });
  assert.deepEqual(e.sets.map((s) => s.k), ["stagePlaces"]);
});
test("a failing resize closes the decoded bitmap, warns uploadFailed and uploads nothing", async () => {
  const e = setup();
  const closed = [];
  globalThis.createImageBitmap = async (src, opts) => {
    if (opts) throw new Error("resize");
    return { width: 5000, height: 3000, close: () => closed.push("full") };
  };
  const quiet = console.error; console.error = () => {};
  try { assert.equal(await uploadPlacePicture(img(5000, 3000)), null); } finally { console.error = quiet; }
  assert.deepEqual(closed, ["full"]);
  assert.deepEqual(e.notes, ["SDE.stage.uploadFailed"]);
  assert.equal(e.calls.upload.length, 0);
});
test("the downscaled bitmap is closed before the network upload", async () => {
  setup();
  const order = [];
  globalThis.createImageBitmap = async (src, opts) => ({ width: opts ? opts.resizeWidth : 5000, height: opts ? opts.resizeHeight : 3000, close: () => order.push(opts ? "small" : "full") });
  const up = globalThis.foundry.applications.apps.FilePicker.implementation.upload;
  globalThis.foundry.applications.apps.FilePicker.implementation.upload = async (...a) => { order.push("upload"); return up(...a); };
  await uploadPlacePicture(img(5000, 3000));
  assert.ok(order.indexOf("small") < order.indexOf("upload"));
  assert.ok(order.includes("full"));
});

/** The store write takes a tick, as a real setting write does. */
const slowWrites = () => {
  const set = globalThis.game.settings.set;
  globalThis.game.settings.set = async (m, k, v) => { await new Promise((r) => setImmediate(r)); return set(m, k, v); };
};

test("parallel adds on one client all survive, up to the cap", async () => {
  const e = setup({ places: { places: [] } });
  slowWrites(e);
  const mk = (i) => ({ id: `n${i}`, kind: "custom", name: `N${i}`, image: `worlds/w/stage/n${i}.webp` });
  await Promise.all(Array.from({ length: 10 }, (_, i) => addPlaceToList(mk(i))));
  assert.equal(readPlaces().places.length, 10);
  const { MAX_PLACES } = await import("../scripts/stage/places-core.mjs");
  await Promise.all(Array.from({ length: MAX_PLACES }, (_, i) => addPlaceToList(mk(100 + i))));
  assert.equal(readPlaces().places.length, MAX_PLACES);
});

test("a rename and an add in parallel both survive", async () => {
  const e = setup();
  slowWrites(e);
  await Promise.all([updatePlaceInList("p1", { name: "Renamed" }), addPlaceToList({ id: "p2", kind: "camp", name: "Camp", image: "worlds/w/stage/c.webp" })]);
  const list = readPlaces().places;
  assert.deepEqual(list.map((p) => [p.id, p.name]), [["p1", "Renamed"], ["p2", "Camp"]]);
});

test("a failing mutation rejects to its caller and does not block the next one", async () => {
  setup();
  const set = globalThis.game.settings.set;
  let fail = true;
  globalThis.game.settings.set = async (...a) => { if (fail) { fail = false; throw new Error("write failed"); } return set(...a); };
  const bad = updatePlaceInList("p1", { name: "X" });
  const good = addPlaceToList({ id: "p2", kind: "camp", name: "Camp", image: "worlds/w/stage/c.webp" });
  await assert.rejects(bad, /write failed/);
  await good;
  assert.deepEqual(readPlaces().places.map((p) => p.id), ["p1", "p2"]);
});
