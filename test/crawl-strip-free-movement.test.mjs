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
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {}, call: () => true, events: {} };
globalThis.ui = { notifications: { warn: () => {} } };
const classList = { add() {}, remove() {}, toggle() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.document = { body: { classList } };

const pc = { id: "pc1", type: "Player", name: "Ayla", img: "a.png", isOwner: true, effects: [], items: [], statuses: new Set(),
  system: { attributes: { hp: { value: 5, max: 5 }, ac: { value: 12 } }, luck: { remaining: 1 } }, flags: {} };
const settings = {};
globalThis.game = {
  user: { isGM: true }, users: { activeGM: null }, combat: null,
  i18n: { localize: (k) => k, format: (k) => k },
  actors: { get: (id) => (id === pc.id ? pc : null) },
  settings: { get: (_m, key) => settings[key] ?? null, set: () => {} },
};
globalThis.canvas = { scene: null, tokens: { get: () => null } };

const { CrawlStrip } = await import("../scripts/crawl-strip/crawl-strip.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
const { normalizeCrawlState } = await import("../scripts/crawl-strip/crawl-state-core.mjs");

function draw(free) {
  settings.crawlFreeMovement = free;
  CrawlState._state = normalizeCrawlState({ mode: "crawl", active: true, crawlTurn: 3, members: [pc.id], oocInitiative: { [pc.id]: { roll: 12 } }, oocTurn: pc.id });
  CrawlStrip._el = { innerHTML: "", classList, querySelectorAll: () => [], querySelector: () => null };
  CrawlStrip._bindEvents = () => {}; CrawlStrip._sizeCards = () => {};
  CrawlStrip.render();
  return CrawlStrip._el.innerHTML;
}

test("free movement crawl: no feet pill, no order controls, Next Round stays", () => {
  const normal = draw(false), free = draw(true);
  assert.match(normal, /ft<\/div>/, "baseline draws the movement pill");
  assert.match(normal, /nextOocTurn/);
  assert.doesNotMatch(free, /ft<\/div>/);
  assert.doesNotMatch(free, /nextOocTurn|prevOocTurn|rollAllOocInit|resetOocInit|rollOocInit|sde-strip-init-badge/);
  assert.match(free, /nextCrawlTurn/);
  assert.match(free, /sde-strip-pill/, "luck pill remains");
});
