import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { normalizeStage } from "../scripts/stage/stage-core.mjs";
import { registerStage, hideStage, raiseByHand } from "../scripts/stage/stage.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the stylesheet is in the manifest after the kit, scoped, at z 0, reduced-motion safe, colourless", () => {
  const sources = JSON.parse(read("module.json")).styles.map((s) => s.src);
  assert.ok(sources.indexOf("styles/stage.css") > sources.indexOf("styles/sde-ui.css"));
  assert.ok(existsSync(new URL("../styles/stage.css", import.meta.url)));
  const css = read("styles/stage.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /#sde-stage\s*{[^}]*z-index:\s*var\(--z-index-canvas, 0\)/); // foundry2.css: --z-index-canvas: 0
  const rule = css.match(/#sde-stage\s*{[^}]*}/)[0];
  assert.match(rule, /position:\s*fixed/);
  assert.match(rule, /inset:\s*0/);
  assert.match(rule, /pointer-events:\s*auto/);
  assert.match(rule, /background:[^;]*;\s*background-color:\s*var\(--color-cool-5\)/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*{\s*#sde-stage\s*{\s*animation: none/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
});

function setup({ gm = true, stage = null, actors = [] } = {}) {
  const store = { stage }, hooks = {}, registered = {}, written = [], body = [];
  const released = { n: 0 }, apps = new Map();
  const mk = () => ({ attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { body.splice(body.indexOf(this), 1); } });
  globalThis.document = { body: { append: (e) => body.push(e) }, createElement: mk, querySelector: () => body[0] ?? null };
  globalThis.foundry = { utils: { getRoute: (p) => `/route/${p}` }, applications: { instances: apps } };
  globalThis.canvas = { tokens: { releaseAll: () => { released.n++; } } };
  globalThis.ui = {};
  globalThis.Hooks = { once: (n, f) => { hooks[n] = f; }, on: (n, f) => { hooks[n] = f; } };
  globalThis.game = {
    user: { isGM: gm },
    actors: { contents: actors },
    settings: {
      register: (m, k, d) => { registered[k] = d; },
      get: (m, k) => store[k],
      set: async (m, k, v) => { store[k] = v; written.push(v); registered[k]?.onChange?.(); },
    },
  };
  registerStage();
  return { store, hooks, registered, written, body, released, apps };
}

test("the setting registers world-scoped, hidden from config, with the normalized defaults", () => {
  const { registered } = setup();
  const s = registered.stage;
  assert.equal(s.scope, "world");
  assert.equal(s.config, false);
  assert.deepEqual(s.default, normalizeStage(null));
});

test("drawStage keeps exactly one aria-hidden layer, updates it, removes it, releases tokens only on raise", async () => {
  const e = setup({ stage: { shown: true, place: "camp", image: "a.webp" } });
  e.hooks.ready();
  assert.equal(e.body.length, 1);
  assert.equal(e.body[0].id, "sde-stage");
  assert.equal(e.body[0].attrs["aria-hidden"], "true");
  assert.match(e.body[0].style.backgroundImage, /a\.webp/);
  assert.equal(e.released.n, 1);
  const first = e.body[0];
  e.store.stage = { shown: true, place: "camp", image: "b.webp" };
  e.registered.stage.onChange();
  assert.equal(e.body.length, 1);
  assert.equal(e.body[0], first);
  assert.match(first.style.backgroundImage, /b\.webp/);
  assert.equal(e.released.n, 1, "no release when already shown");
  e.store.stage = { shown: false };
  e.registered.stage.onChange();
  assert.equal(e.body.length, 0);
  e.store.stage = { shown: true, place: "camp", image: "b.webp" };
  e.registered.stage.onChange();
  assert.equal(e.released.n, 2, "released again on hidden to shown");
});

test("canvasReady releases tokens only while the layer is up", () => {
  const e = setup({ stage: { shown: true, place: "camp", image: "a.webp" } });
  assert.equal(typeof e.hooks.canvasReady, "function");
  e.hooks.ready();
  const before = e.released.n;
  e.hooks.canvasReady();
  assert.equal(e.released.n, before + 1);
  e.body.length = 0;
  e.hooks.canvasReady();
  assert.equal(e.released.n, before + 1, "no layer, no release");
});

test("no toolbar tool and no places: registerStage adds no scene control, and an old Backdrop place in the setting draws nothing", () => {
  const e = setup({ stage: { shown: true, place: "ready-tavern", image: "modules/shadowdark-enhancer/assets/scenes/places/tavern.webp", kind: "tavern" } });
  assert.equal(e.hooks.getSceneControlButtons, undefined);
  assert.equal(e.registered.stagePlaces, undefined);
  e.hooks.ready();
  assert.equal(e.body.length, 0);
  assert.equal(e.released.n, 0);
});

test("a change of the setting re-renders the open windows that carry the camp picture button, and no others", () => {
  const e = setup();
  const app = (sel) => ({ rendered: true, n: 0, render() { this.n++; }, element: { querySelector: (q) => (sel && q.includes(sel) ? {} : null) } });
  const camping = app('data-action="campPicture"'), sheet = app('data-activity-action="campPicture"'), other = app(null);
  const closed = { ...app('data-action="campPicture"'), rendered: false };
  for (const [k, v] of Object.entries({ camping, sheet, other, closed })) e.apps.set(k, v);
  e.registered.stage.onChange();
  assert.deepEqual([camping.n, sheet.n, other.n, closed.n], [1, 1, 0, 0]);
});

test("hideStage is a no-op for players and when hidden, and keeps campId", async () => {
  const shown = { shown: true, place: "camp", image: "a.webp", campId: "c1", partyId: "p" };
  const p = setup({ gm: false, stage: shown });
  await hideStage();
  assert.equal(p.written.length, 0);
  const h = setup({ stage: { ...shown, shown: false } });
  await hideStage();
  assert.equal(h.written.length, 0);
  const g = setup({ stage: shown });
  assert.equal(await hideStage(), "camp", "answers the place it hid");
  assert.deepEqual(g.written, [{ ...shown, shown: false }]);
});

test("a hand raise with no party and no map still writes a camp picture", async () => {
  const e = setup();
  await raiseByHand(null);
  assert.ok(e.written.at(-1).image);
});

test("the layer draws the picture through fileRoute: module path routed, absolute URL as is", () => {
  const draw = (image) => { const e = setup({ stage: { shown: true, place: "camp", image } }); e.hooks.ready(); return e.body[0].style.backgroundImage; };
    assert.equal(draw("modules/shadowdark-enhancer/assets/scenes/encounter/forest-woods-camp.webp"), 'url("/route/modules/shadowdark-enhancer/assets/scenes/encounter/forest-woods-camp.webp")');
  assert.equal(draw("https://assets.example/x.webp"), 'url("https://assets.example/x.webp")');
});
