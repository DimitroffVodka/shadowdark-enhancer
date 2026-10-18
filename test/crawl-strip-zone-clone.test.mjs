import test from "node:test";
import assert from "node:assert/strict";

// Render the real strip for one rolled PC and read the HTML it draws.
const OWNER = 3;
globalThis.foundry = {
  applications: { handlebars: { renderTemplate: async () => "" }, api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: {} }, apps: {}, ux: {} },
  utils: { deepClone: (o) => structuredClone(o) },
  canvas: { placeables: { tokens: { TokenRuler: class {} } } },
};
globalThis.CONFIG = { queries: {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER }, TOKEN_DISPOSITIONS: { NEUTRAL: 0, HOSTILE: -1 } };
globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {}, call: () => true, events: {} };
globalThis.ui = { notifications: { warn: () => {} } };
const classList = { add() {}, remove() {}, toggle() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.document = { body: { classList } };

const M = "shadowdark-enhancer";
const mk = (id, type, flags, disp) => ({ id, type, name: id, img: id + ".png", isOwner: false, effects: [], items: [], statuses: new Set(),
  prototypeToken: { disposition: disp }, flags, system: { attributes: { hp: { value: 3, max: 6 }, ac: { value: 13 } }, luck: { remaining: 1 } } });
const clone = mk("clone", "NPC", { [M]: { zoneClone: "f1" } }, 1);   // friendly prototype: still concealed
const plain = mk("plain", "NPC", {}, 1);                              // not a clone, friendly
const pc = mk("pc", "Player", {}, -1);                                // hostile Player prototype
const actors = { clone, plain, pc };
const settings = {};
const cbOf = (a, token = null) => ({ id: "c-" + a.id, actor: a, token, tokenId: token?.id ?? null, hidden: false, defeated: false, initiative: 5, isDefeated: false, flags: {} });
globalThis.game = {
  user: { isGM: false }, users: { activeGM: null }, combat: null, time: { worldTime: 0 },
  i18n: { localize: (k) => k, format: (k) => k },
  actors: { get: (id) => actors[id] ?? null },
  settings: { get: (_m, key) => settings[key] ?? null, set: () => {} },
};
globalThis.canvas = { scene: null, tokens: { get: () => null } };

const { CrawlStrip } = await import("../scripts/crawl-strip/crawl-strip.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
const { normalizeCrawlState } = await import("../scripts/crawl-strip/crawl-state-core.mjs");

function draw(combatants, gm) {
  globalThis.game.user.isGM = gm;
  const turns = combatants;
  globalThis.game.combat = { turns, combatants: { get: (id) => turns.find((c) => c.id === id), [Symbol.iterator]: () => turns[Symbol.iterator](), map: (f) => turns.map(f) }, combatant: null };
  CrawlState._state = normalizeCrawlState({ mode: "combat", active: true, members: [] });
  CrawlStrip._el = { innerHTML: "", classList, querySelectorAll: () => [], querySelector: () => null };
  CrawlStrip._bindEvents = () => {}; CrawlStrip._sizeCards = () => {};
  CrawlStrip.render();
  return CrawlStrip._el.innerHTML;
}
const NUMBERS = /3\/6|sde-strip-ac-line|ft<\/div>/;

test("a tokenless zone clone is a bar only for a player, whatever its prototype disposition", () => {
  const html = draw([cbOf(clone)], false);
  assert.match(html, /sde-strip-hp-bar/, "the card is drawn with its bar");
  assert.doesNotMatch(html, NUMBERS);
});

test("the GM sees a zone clone in full", () => {
  assert.match(draw([cbOf(clone)], true), /3\/6/);
  assert.match(draw([cbOf(clone)], true), /sde-strip-ac-line/);
  assert.match(draw([cbOf(clone)], true), /ft<\/div>/);
});

test("a tokenless Player-type actor is not concealed, nor a tokenless friendly non-clone", () => {
  assert.match(draw([cbOf(pc)], false), /3\/6/);
  assert.match(draw([cbOf(plain)], false), /3\/6/);
});

test("a tokened combatant still follows its token disposition", () => {
  const hostile = cbOf(plain, { id: "t1", disposition: -1, hidden: false, name: "t", texture: { src: "t.png" } });
  const friendly = cbOf(plain, { id: "t2", disposition: 1, hidden: false, name: "t", texture: { src: "t.png" } });
  assert.doesNotMatch(draw([hostile], false), NUMBERS);
  assert.match(draw([friendly], false), /3\/6/);
});
