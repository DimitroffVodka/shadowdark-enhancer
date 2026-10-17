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
test("a marching party draws as a free crawl: no feet, no order, the leader marked, the 3x3 grid and the switch shown", () => {
  const html = marching();
  assert.doesNotMatch(html, /ft<\/div>/, "no movement pill");
  assert.doesNotMatch(html, /nextOocTurn|prevOocTurn|rollAllOocInit|resetOocInit|rollOocInit|sde-strip-init-badge/);
  assert.match(html, /nextCrawlTurn/, "the GM still ends the round");
  assert.match(html, /sde-strip-leads\b/);
  assert.match(html, /sde-strip-leads-badge/);
  assert.match(html, /data-march-grid/, "the 3x3 marching order is the marker");
  assert.equal(html.match(/data-march-slot/g).length, 9);
  assert.match(html, /sde-strip-march-cell leader/);
  assert.match(html, /data-action="toggleMarch"[^>]*aria-pressed="true"/);
  assert.match(html, /sde-strip-march-btn on active/);
});
test("a party that is not marching keeps feet and turns: switch off, or nobody out to follow", () => {
  for (const options of [{ followLeader: false }, { followersOut: false }]) {
    const html = marching(options);
    assert.match(html, /ft<\/div>/, JSON.stringify(options));
    assert.match(html, /nextOocTurn/, JSON.stringify(options));
    assert.doesNotMatch(html, /sde-strip-leads-badge|data-march-grid/, "no grid until it marches");
    assert.match(html, /SDE\.crawlStrip\.partyLabel/);
    assert.match(html, /data-action="toggleMarch"/, "but the switch is there to turn it on or off");
  }
  assert.match(marching({ followLeader: false }), /aria-pressed="false"/);
  assert.doesNotMatch(marching({ followersOut: false }), /sde-strip-march-btn on active/, "on, but waiting for members on the map, is not active");
  assert.match(marching({ followersOut: false }), /class="sde-strip-march-btn on "/);
});
test("no party for the crawl, or a viewer who cannot manage it, gets no switch", () => {
  marching();
  globalThis.game.actors.contents = [pc];
  assert.doesNotMatch(draw(false), /toggleMarch|data-march-grid/, "no party holds a crawl member");
  marching();
  globalThis.game.user.isGM = false;
  globalThis.game.actors.contents[0].testUserPermission = (_user, level) => level !== "OWNER";   // may see it, owns nothing
  try { assert.doesNotMatch(draw(false), /toggleMarch/, "a player who owns nothing cannot flip it"); assert.match(draw(false), /data-march-grid/, "but still sees the grid"); }
  finally { globalThis.game.user.isGM = true; }
});

test("a type Party actor in the world does not stop the strip drawing", () => {
  marching();
  globalThis.game.actors.contents.unshift({ id: "odd", uuid: "Actor.odd", type: "Party", name: "Extras party", flags: {}, testUserPermission: () => true });
  let html;
  assert.doesNotThrow(() => { html = draw(false); });
  assert.match(html, /data-march-grid/, "the real party's march still draws");
});
