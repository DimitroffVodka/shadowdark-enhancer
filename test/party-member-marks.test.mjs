import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = {
  applications: { handlebars: { renderTemplate: async () => "" }, api: { ApplicationV2: class { render() {} }, HandlebarsApplicationMixin: (B) => B, DialogV2: {} }, apps: {}, ux: {}, instances: new Map(), sheets: { ActorSheetV2: class {} } },
  utils: { deepClone: (o) => structuredClone(o) },
  canvas: { placeables: { tokens: { TokenRuler: class {} } } },
};
globalThis.CONFIG = { queries: {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {}, call: () => true, events: {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.document = { body: { classList: { add() {}, remove() {}, toggle() {} } } };
const warnings = [];
globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
let gm = false;
globalThis.game = { user: { get isGM() { return gm; } }, users: { activeGM: null }, combat: null, settings: { get: () => null, set() {} }, i18n: { localize: (k) => k, format: (k) => k }, actors: { get: () => null, contents: [] } };
globalThis.canvas = { scene: null, tokens: { get: () => null } };

const { PartyApp } = await import("../scripts/party/party-app.mjs");
const { Party } = await import("../scripts/party/party.mjs");
const { CrawlStrip } = await import("../scripts/crawl-strip/crawl-strip.mjs");

const torch = (active) => ({ id: "t", name: "Torch", type: "Basic", system: { light: { isSource: true, active } } });
function pc(isOwner, items = [torch(false)]) {
  const spent = [];
  const a = { id: "pc", uuid: "Actor.pc", isOwner, items: { contents: items, get: (id) => items.find((i) => i.id === id) }, system: { useLuckToken: async (v) => spent.push(v) }, sheet: { toggled: [], _toggleLightSource: async (i) => a.sheet.toggled.push(i.id) } };
  a.spent = spent;
  return a;
}
function app(actor) {
  const self = { actor: {}, rendered: 0, render() { this.rendered++; }, _memberCrawl: PartyApp.prototype._memberCrawl };
  const original = Party.rows;
  Party.rows = () => [{ uuid: actor.uuid, actor }];
  return { self, restore: () => { Party.rows = original; } };
}
const el = { dataset: { actorId: "Actor.pc" } };

test("a member card's Luck mark spends through the crawl strip for the owner", async () => {
  const a = pc(true), { self, restore } = app(a);
  gm = false; warnings.length = 0;
  await PartyApp.DEFAULT_OPTIONS.actions.spendLuck.call(self, null, el);
  restore();
  assert.deepEqual(a.spent, [true]);
  assert.equal(self.rendered, 1);
  assert.equal(warnings.length, 0);
});

test("a member card's Light mark lights the carried torch through the crawl strip, and snuffs a burning one", async () => {
  for (const [active, expected] of [[false, "t"], [true, "t"]]) {
    const a = pc(true, [torch(active)]), { self, restore } = app(a);
    CrawlStrip.queueRender = () => {};
    await PartyApp.DEFAULT_OPTIONS.actions.toggleLight.call(self, null, el);
    restore();
    assert.deepEqual(a.sheet.toggled, [expected], `active=${active}`);
  }
});

test("a player who neither owns the character nor is a GM is refused politely", async () => {
  const a = pc(false), { self, restore } = app(a);
  gm = false; warnings.length = 0;
  await PartyApp.DEFAULT_OPTIONS.actions.spendLuck.call(self, null, el);
  await PartyApp.DEFAULT_OPTIONS.actions.toggleLight.call(self, null, el);
  restore();
  assert.deepEqual(a.spent, []);
  assert.deepEqual(a.sheet.toggled, []);
  assert.deepEqual(warnings, ["SDE.party.sheet.notOwner", "SDE.party.sheet.notOwner"]);
});

test("a GM may use any member's marks", async () => {
  const a = pc(false), { self, restore } = app(a);
  gm = true;
  await PartyApp.DEFAULT_OPTIONS.actions.spendLuck.call(self, null, el);
  restore();
  assert.deepEqual(a.spent, [true]);
});

test("the member card marks are anchors with the actions and aria-pressed", async () => {
  const template = await readFile(new URL("../templates/party/party.hbs", import.meta.url), "utf8");
  assert.match(template, /<a class="sdp-luck[^>]*data-action="spendLuck"/);
  assert.match(template, /<a class="sdp-light[^>]*data-action="toggleLight"[^>]*aria-pressed=/);
  assert.doesNotMatch(template, /<button[^>]*data-action="(spendLuck|toggleLight)"/);
});
