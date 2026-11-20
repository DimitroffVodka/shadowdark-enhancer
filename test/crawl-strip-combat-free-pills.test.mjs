import test from "node:test";
import assert from "node:assert/strict";

// Render the real strip in combat with Free movement combat off and on, and look for the feet pill.
// Stubs as in crawl-strip-zone-clone.test.mjs.
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

const FEET = /ft<\/div>/;

test("in combat the strip shows feet on PC and NPC cards while Free movement combat is off", () => {
  settings.combatFreeMovement = false;
  assert.match(draw([cbOf(pc)], true), FEET, "PC card");
  assert.match(draw([cbOf(plain)], true), FEET, "NPC card");
});

test("with Free movement combat on, no card shows feet and the rest of the card stays", () => {
  settings.combatFreeMovement = true;
  const pcCard = draw([cbOf(pc)], true), npcCard = draw([cbOf(plain)], true);
  assert.doesNotMatch(pcCard, FEET, "PC card");
  assert.doesNotMatch(npcCard, FEET, "NPC card");
  assert.match(pcCard, /3\/6/, "HP still drawn");
  settings.combatFreeMovement = false;
});
