/**
 * Ready places (Tavern, Town, Market): the shipped list, how the stage accepts them, the window that shows them
 * first with only Show and Hide, and that every shipped picture is credited. No Foundry needed except the window stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { READY_PLACES, normalizePlaces, placeById, readyById, reshowTarget } from "../scripts/stage/places-core.mjs";
import { campTransition, normalizeStage } from "../scripts/stage/stage-core.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("languages/en.json"));
const ART = "modules/shadowdark-enhancer/assets/scenes/places/";
const onDisk = (p) => new URL(`../${p.replace("modules/shadowdark-enhancer/", "")}`, import.meta.url);

test("the ready places: three, fixed ids, kinds, named by en.json, pictures that exist and are small", () => {
  assert.deepEqual(READY_PLACES.map((p) => [p.id, p.kind]), [["ready-tavern", "tavern"], ["ready-town", "town"], ["ready-market", "custom"]]);
  for (const p of READY_PLACES) {
    assert.ok(en[p.nameKey], p.nameKey);
    assert.ok(p.image.startsWith(ART) && p.image.endsWith(".webp"));
    assert.ok(p.thumb.startsWith(`${ART}thumbs/`));
    assert.ok(statSync(onDisk(p.image)).size < 2.5 * 1024 * 1024, p.image);
    assert.ok(statSync(onDisk(p.thumb)).size < 100 * 1024, p.thumb);
  }
  assert.ok(Object.isFrozen(READY_PLACES) && Object.isFrozen(READY_PLACES[0]));
});

test("a ready place is found by id, and a stored place can neither take nor shadow a ready id", () => {
  assert.equal(readyById("ready-town").kind, "town");
  assert.equal(readyById("ready-x"), null);
  assert.equal(placeById(null, "ready-tavern").image, READY_PLACES[0].image);
  const out = normalizePlaces({ places: [{ id: "ready-town", kind: "custom", name: "Fake", image: "x.webp" }, { id: "own", kind: "town", name: "Own", image: "y.webp" }] });
  assert.deepEqual(out.places.map((p) => p.id), ["own"]);
  assert.equal(placeById(out, "ready-town").image, READY_PLACES[1].image);
});

test("normalizeStage accepts a ready place id, and a shown ready Town or Tavern place blocks a camp", () => {
  const t = READY_PLACES[1];
  const stage = normalizeStage({ shown: true, place: t.id, image: t.image, kind: t.kind });
  assert.deepEqual([stage.shown, stage.place, stage.image, stage.kind], [true, "ready-town", t.image, "town"]);
  const camp = { id: "c1", phase: "setup" }, st = { partyId: "p", image: "camp.webp", partyTokenOnMap: false };
  assert.equal(campTransition(stage, camp, st), null);
  const tav = READY_PLACES[0];
  assert.equal(campTransition({ shown: true, place: tav.id, image: tav.image, kind: tav.kind }, camp, st), null);
  // Market is a custom place: a camp may replace it, as it replaces any other custom place.
  assert.equal(campTransition({ shown: true, place: "ready-market", image: "m.webp", kind: "custom" }, camp, st)?.place, "camp");
});

test("a hidden ready place can be shown again by the stage's reshow rule", () => {
  const r = reshowTarget({ shown: false, place: "ready-tavern" }, null);
  assert.equal(r.id, "ready-tavern");
});

test("every shipped place picture and preview is a credited file, and nothing else is in the folder", () => {
  const dir = new URL("../assets/scenes/places/", import.meta.url);
  const credits = read("CREDITS.md");
  const ready = READY_PLACES.map((p) => p.image.slice(ART.length)).sort();
  const files = readdirSync(dir).filter((f) => f !== "thumbs").sort();
  assert.deepEqual(files, ready, "a stray or missing picture in assets/scenes/places");
  assert.deepEqual(readdirSync(new URL("thumbs/", dir)).sort(), ready, "a stray or missing preview");
  for (const f of ready) assert.ok(credits.includes(`\`${f}\``), `${f} is not credited in CREDITS.md`);
  assert.match(credits, /CC BY-NC 4\.0/);
  for (const url of ["twilight-tavern", "town-center", "market-festival"]) assert.ok(credits.includes(`https://2minutetabletop.com/product/${url}/`), url);
});

test("the ready part lists the ready places with Show and Hide only, and no edit control", () => {
  const tpl = read("templates/stage/places-ready.hbs");
  assert.match(tpl, /data-action="showPlace"/);
  assert.match(tpl, /data-action="hidePlace"/);
  assert.doesNotMatch(tpl, /replacePicture|deletePlace|data-place-field|<input|<select/);
  const keys = [...tpl.matchAll(/SDE\.stage\.places\.\w+/g)].map((m) => m[0]);
  for (const k of keys) assert.ok(en[k], k);
});

test("the window context has the ready places first, thumbs routed, and only the one on show marked shown", async () => {
  class ApplicationV2 { constructor(o = {}) { this.options = o; } }
  globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (B) => class extends B {} } }, utils: { getRoute: (p) => `/r/${p}` } };
  const { StagePlacesApp } = await import("../scripts/stage/places-app.mjs");
  const ctxFor = (stage) => {
    globalThis.game = { user: { isGM: true }, scenes: { contents: [] }, settings: { get: (m, k) => (k === "stage" ? stage : { places: [] }) } };
    return new StagePlacesApp()._prepareContext();
  };
  const c = ctxFor({ shown: true, place: "ready-town", image: "x", partyId: "", campId: "" });
  assert.deepEqual(c.ready.map((p) => [p.id, p.shown]), [["ready-tavern", false], ["ready-town", true], ["ready-market", false]]);
  assert.equal(c.ready[0].image, `/r/${READY_PLACES[0].thumb}`);
  assert.deepEqual(c.places, []);
  assert.equal(Object.keys(StagePlacesApp.PARTS)[0], "ready");
  assert.deepEqual(ctxFor(null).ready.map((p) => p.shown), [false, false, false]);
});
