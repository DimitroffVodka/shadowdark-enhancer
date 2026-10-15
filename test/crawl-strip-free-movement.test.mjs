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
  user: { isGM: true }, users: { activeGM: null }, combat: null, time: { worldTime: 0 },
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

// A marching party: one person moves everyone, so the strip is a free crawl that says who leads.
function marching({ followLeader = true, followersOut = true } = {}) {
  const MOD = "shadowdark-enhancer";
  const mate = { ...pc, id: "pc2", uuid: "Actor.pc2", name: "Bran", testUserPermission: () => true };
  Object.assign(pc, { uuid: "Actor.pc1", testUserPermission: () => true });
  const party = { id: "p", uuid: "Actor.p", type: "NPC", name: "Party", flags: { [MOD]: { party: true, partyData: { members: [pc.uuid, mate.uuid], leaderUuid: pc.uuid, followLeader } } }, testUserPermission: () => true };
  globalThis.game.actors.contents = [party, pc, mate];
  const tok = (actor) => ({ id: `t-${actor.id}`, actorLink: true, actor, flags: {} });
  const tokens = [tok(pc), ...(followersOut ? [tok(mate)] : [])];
  tokens.contents = tokens;
  globalThis.canvas.scene = { id: "s", tokens };
  globalThis.game.combats = { contents: [] };
  return draw(false);
}
test("a marching party draws as a free crawl: no feet, no order, the leader marked and the label says MARCHING", () => {
  const html = marching();
  assert.doesNotMatch(html, /ft<\/div>/, "no movement pill");
  assert.doesNotMatch(html, /nextOocTurn|prevOocTurn|rollAllOocInit|resetOocInit|rollOocInit|sde-strip-init-badge/);
  assert.match(html, /nextCrawlTurn/, "the GM still ends the round");
  assert.match(html, /sde-strip-leads\b/);
  assert.match(html, /sde-strip-leads-badge/);
  assert.match(html, /SDE\.crawlStrip\.marchLabel/);
  assert.doesNotMatch(html, /SDE\.crawlStrip\.partyLabel/);
});
test("a party that is not marching keeps feet and turns: switch off, or nobody out to follow", () => {
  for (const options of [{ followLeader: false }, { followersOut: false }]) {
    const html = marching(options);
    assert.match(html, /ft<\/div>/, JSON.stringify(options));
    assert.match(html, /nextOocTurn/, JSON.stringify(options));
    assert.doesNotMatch(html, /sde-strip-leads-badge/);
    assert.match(html, /SDE\.crawlStrip\.partyLabel/);
  }
});
