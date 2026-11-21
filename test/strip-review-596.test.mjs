// Regressions from PR 596's review (6008383946, 6008421049), driven through the
// real registered hooks with small Foundry stand-ins.
import test from "node:test";
import assert from "node:assert/strict";

const hooks = new Map();
globalThis.Hooks = {
  on(ev, fn) { if (!hooks.has(ev)) hooks.set(ev, []); hooks.get(ev).push(fn); return hooks.get(ev).length; },
  callAll(ev, ...args) { for (const fn of hooks.get(ev) ?? []) fn(...args); },
};
globalThis.foundry = {
  utils: {
    debounce: (fn) => fn,
    setProperty: (obj, key, value) => { obj[key] = value; },
  },
};
globalThis.CONFIG = { queries: {} };
const settings = {
  combatHideUntilSeen: true, combatFocusMode: false, combatAutoRollNpcInit: false,
  combatUpNext: true, crawlStripPanToTurn: "off", combatVsScreen: false,
};
let canvasReadyReads = 0;
globalThis.canvas = { get ready() { canvasReadyReads++; return false; }, scene: null };
globalThis.ui = { sidebar: null };
let splashUp = false;
const banners = [];
globalThis.document = {
  body: { classList: { toggle() {} }, append(el) { banners.push(el); } },
  querySelector(sel) { return sel === ".sde-vs" && splashUp ? {} : null; },
  createElement() { return { setAttribute() {}, addEventListener() {}, remove() {}, innerHTML: "", className: "" }; },
};
const scene = { id: "s1", tokens: new Map() };
globalThis.game = {
  settings: { get: (_m, key) => settings[key] },
  user: { isGM: true, hasPermission: () => true },
  users: { activeGM: null },
  scenes: { get: () => scene },
  combat: null,
  combats: { get: () => null },
  i18n: { localize: (k) => k, format: (k, data) => `${k} ${JSON.stringify(data)}` },
};

const { registerCombatTableOptions } = await import("../scripts/crawl-strip/combat-table-options.mjs");
const { registerTurnCallouts } = await import("../scripts/crawl-strip/turn-callouts.mjs");
registerCombatTableOptions();
registerTurnCallouts();

const settle = () => new Promise((r) => setTimeout(r, 0));
const MODULE = "shadowdark-enhancer";

// Foundry 14.370's token HUD: TokenDocument.createCombatants sends `hidden: token.hidden`.
const hudPayload = (token) => ({ tokenId: token.id, sceneId: "s1", actorId: "a1", hidden: token.hidden });
const newMonster = (sourceHidden) => ({
  _source: { hidden: sourceHidden }, hasPlayerOwner: false, actor: { type: "NPC" }, parent: { scene },
  updateSource(u) { this.applied = { ...this.applied, ...u }; },
});

test("Add to Combat from the token HUD (hidden: false) still auto-hides the monster", () => {
  const token = { id: "t-visible", hidden: false };
  scene.tokens.set(token.id, token);
  const combatant = newMonster(false);
  globalThis.Hooks.callAll("preCreateCombatant", combatant, hudPayload(token));
  assert.equal(combatant.applied?.hidden, true);
  assert.equal(combatant.applied?.[`flags.${MODULE}.autoHidden`], true);
});

test("Add to Combat from the token HUD keeps a hand-hidden monster unflagged", () => {
  const token = { id: "t-hidden", hidden: true };
  scene.tokens.set(token.id, token);
  const combatant = newMonster(true);
  globalThis.Hooks.callAll("preCreateCombatant", combatant, hudPayload(token));
  assert.equal(combatant.applied, undefined);
});

test("a failed reveal report is retried; an accepted one is not repeated", async () => {
  globalThis.game.user = { isGM: false, hasPermission: () => true };
  const monster = { id: "m1", hidden: true, getFlag: (m, k) => m === MODULE && k === "autoHidden", token: { object: { isVisible: true } } };
  globalThis.game.combat = { id: "c-reveal", combatants: [monster] };
  const replies = [{ ok: false, error: "GM tab went away" }, { ok: true }];
  const sent = [];
  globalThis.game.users.activeGM = { query: async (name, data) => { sent.push(data); return replies.shift(); } };
  globalThis.Hooks.callAll("sightRefresh");
  await settle();
  globalThis.Hooks.callAll("sightRefresh");
  await settle();
  assert.equal(sent.length, 2, "the failed report was sent again");
  globalThis.Hooks.callAll("sightRefresh");
  await settle();
  assert.equal(sent.length, 2, "the accepted report was not repeated");
  globalThis.game.users.activeGM = null;
  globalThis.game.combat = null;
});

const owned = (id, isOwner, type = "NPC") => ({
  id, isOwner, hasPlayerOwner: isOwner, hidden: false, defeated: false, name: id, img: "",
  actor: { type, system: { attributes: { hp: { value: 5 } } }, statuses: new Set() }, token: { hidden: false },
});

test("an Up next banner held back by the splash is dropped once the turn has moved on", async () => {
  globalThis.game.user = { isGM: false, hasPermission: () => true };
  const combat = { id: "c-banner", started: true, round: 1, turn: 0, turns: [owned("Goblin", false), owned("Klaruun", true, "Player"), owned("Bat", false)] };
  Object.defineProperty(combat, "combatant", { get() { return this.turns[this.turn]; } });
  combat.combatants = combat.turns;
  globalThis.game.combat = combat;
  banners.length = 0;
  splashUp = true;
  globalThis.Hooks.callAll("combatTurnChange", combat);
  await settle();
  combat.turn = 1;
  globalThis.Hooks.callAll("combatTurnChange", combat);
  await settle();
  splashUp = false;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(banners.length, 0, `stale banner shown: ${banners.map((b) => b.innerHTML.replace(/\s+/g, " ")).join(" | ")}`);
  globalThis.game.combat = null;
});

test("switching Up next alert redraws the tag at once", () => {
  const before = canvasReadyReads;
  globalThis.Hooks.callAll("updateSetting", { key: `${MODULE}.combatUpNext` });
  globalThis.Hooks.callAll("createSetting", { key: `${MODULE}.combatUpNext` });
  assert.equal(canvasReadyReads - before, 2, "the tag is redrawn on each change of the setting");
});
