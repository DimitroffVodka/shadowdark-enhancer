import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { normalizeStage } from "../scripts/stage/stage-core.mjs";
import { registerStage, hideStage, pickParty, raiseByHand } from "../scripts/stage/stage.mjs";

const M = "shadowdark-enhancer";
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
  const released = { n: 0 }, rendered = { n: 0, opts: [] };
  const mk = () => ({ attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { body.splice(body.indexOf(this), 1); } });
  globalThis.document = { body: { append: (e) => body.push(e) }, createElement: mk, querySelector: () => body[0] ?? null };
  globalThis.foundry = { utils: { getRoute: (p) => `/route/${p}` } };
  globalThis.canvas = { tokens: { releaseAll: () => { released.n++; } } };
  globalThis.ui = { controls: { render: (o) => { rendered.n++; rendered.opts.push(o); } } };
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
  return { store, hooks, registered, written, body, released, rendered };
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
  assert.equal(e.rendered.n, 3, "GM toolbar re-renders on each change");
  assert.ok(e.rendered.opts.every((o) => o?.reset === true), "toolbar render resets");
  const p = setup({ gm: false, stage: { shown: true, place: "camp", image: "a.webp" } });
  p.registered.stage.onChange();
  assert.equal(p.rendered.n, 0, "players do not render the toolbar");
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

test("the toolbar tool is for a GM only, in the Tokens group, and toggles hide / raise", async () => {
  const gm = setup({ stage: { shown: true, place: "camp", image: "a.webp", campId: "c1", partyId: "p" } });
  const controls = { tokens: { tools: {} } };
  gm.hooks.getSceneControlButtons(controls);
  const tool = controls.tokens.tools.sdeStage;
  assert.equal(tool.title, "SDE.stage.tool");
  assert.equal(tool.active, true);
  await tool.onChange();
  assert.equal(gm.written.at(-1).shown, false);
  assert.equal(gm.written.at(-1).campId, "c1");
  const player = setup({ gm: false });
  const pc = { tokens: { tools: {} } };
  player.hooks.getSceneControlButtons(pc);
  assert.equal(pc.tokens.tools.sdeStage, undefined);
  // hidden: raising writes a shown camp stage even with no party
  const g2 = setup();
  const c2 = { tokens: { tools: {} } };
  g2.hooks.getSceneControlButtons(c2);
  await c2.tokens.tools.sdeStage.onChange();
  assert.equal(g2.written.at(-1).shown, true);
  assert.equal(g2.written.at(-1).place, "camp");
  assert.equal(g2.written.at(-1).partyId, "");
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
  await hideStage();
  assert.deepEqual(g.written, [{ ...shown, shown: false }]);
});

test("pickParty prefers the party with a camp in progress, else the first native party", () => {
  const party = (id, camping) => ({ id, type: "NPC", flags: { [M]: { party: true, ...(camping ? { camping } : {}) } } });
  const a = party("a"), b = party("b", { id: "c", phase: "setup" }), d = party("d", { id: "x", phase: "complete" });
  setup({ actors: [{ id: "pc", type: "Player", flags: {} }, a, d, b] });
  assert.equal(pickParty(), b);
  setup({ actors: [d, a] });
  assert.equal(pickParty(), d);
  setup({ actors: [] });
  assert.equal(pickParty(), null);
});

test("a hand raise with no party and no map still writes a camp picture", async () => {
  const e = setup();
  await raiseByHand(null);
  assert.ok(e.written.at(-1).image);
});

test("the layer draws every picture through fileRoute: world path routed, camp path routed, absolute URL as is", () => {
  const draw = (image) => { const e = setup({ stage: { shown: true, place: "camp", image } }); e.hooks.ready(); return e.body[0].style.backgroundImage; };
  assert.equal(draw("worlds/w/stage/boar-abc.webp"), 'url("/route/worlds/w/stage/boar-abc.webp")');
  assert.equal(draw("modules/shadowdark-enhancer/assets/scenes/encounter/forest-woods-camp.webp"), 'url("/route/modules/shadowdark-enhancer/assets/scenes/encounter/forest-woods-camp.webp")');
  assert.equal(draw("https://assets.example/x.webp"), 'url("https://assets.example/x.webp")');
});
