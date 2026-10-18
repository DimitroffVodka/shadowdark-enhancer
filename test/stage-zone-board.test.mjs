import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// loot-delivery reads `foundry` while it loads.
globalThis.foundry = { applications: { handlebars: {} }, utils: {} };
const { boardContext } = await import("../scripts/stage/zone-board-core.mjs");
const board = await import("../scripts/stage/zone-board.mjs");

const M = "shadowdark-enhancer";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("languages/en.json"));
const tick = () => new Promise((r) => setTimeout(r, 0));

class Col extends Map {
  [Symbol.iterator]() { return this.values(); }
}

// --- the stylesheet and the template ---------------------------------------------------------------

test("the stylesheet is registered after stage.css, at z 0, clickable, colourless and motion-safe", () => {
  const sources = JSON.parse(read("module.json")).styles.map((s) => s.src);
  assert.equal(sources.indexOf("styles/stage-zone.css"), sources.indexOf("styles/stage.css") + 1);
  const css = read("styles/stage-zone.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/#sde-zone-board\s*{[^}]*}/)[0];
  assert.match(rule, /z-index:\s*var\(--z-index-canvas, 0\)/);
  assert.match(rule, /pointer-events:\s*auto/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.ok(css.split("}").every((r) => !r.trim() || /^\s*(@[^{]*{\s*)?#sde-zone-board/.test(r) || /^\s*}?\s*$/.test(r)), "every rule is scoped to the layer");
});

test("the template has no literal text; every key it uses exists; aria-labels name the person", () => {
  const tpl = read("templates/stage/zone-board.hbs");
  const text = tpl.replace(/{{[\s\S]*?}}/g, "").replace(/\//g, "").replace(/<[^>]*>/g, "").trim();
  assert.equal(text, "", "visible text comes only from localize");
  const keys = [...tpl.matchAll(/localize\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(keys.length > 10);
  assert.deepEqual(keys.filter((k) => !(k in en)), []);
  // A button's aria-label includes the combatant's name.
  for (const m of tpl.matchAll(/<button[^>]*aria-label="{{localize '([^']+)' name=name}}"/g)) assert.match(en[m[1]], /\{name\}/);
  for (const b of tpl.matchAll(/<button[^>]*data-action="[^"]+"[^>]*>/g)) assert.match(b[0], /aria-label="{{localize '[^']+' name=name}}"/);
  assert.match(tpl, /<button type="button"/);
  assert.doesNotMatch(tpl, /aria-hidden="true"[^>]*data-action/);
});

// --- boardContext -----------------------------------------------------------------------------------

const unit = (id, name, zone, hp, max, o = {}) => ({
  id, name, actorId: "a" + id, flags: { [M]: { zone } }, defeated: !!o.defeated, hidden: !!o.hidden, visible: o.visible,
  actor: {
    id: "a" + id, name, img: `${id}.webp`, isOwner: !!o.own, flags: o.clone ? { [M]: { zoneClone: "fight1" } } : {},
    prototypeToken: { disposition: o.hostile ? -1 : 1 }, system: { attributes: { hp: { value: hp, max } } },
    effects: o.fx ?? [],
  },
});
const fightOf = (combatants, turns = combatants, current = null) => ({
  id: "c1", flags: { [M]: { zoneFight: { id: "fight1", clones: [] } } },
  combatants: new Col(combatants.map((c) => [c.id, c])), turns, combatant: current,
});
globalThis.CONST = { TOKEN_DISPOSITIONS: { HOSTILE: -1, FRIENDLY: 1 } };
const all = (ctx) => ctx.bands.flatMap((b) => b.chips);
const chip = (ctx, id) => all(ctx).find((c) => c.id === id);

const PC = unit("pc", "Creeg", "close", 7, 14, { own: true });
const OTHER = unit("pc2", "Elbin", "near", 3, 11);
const FOE = unit("f1", "Goblin 1", "near", 2, 4, { clone: true });
const GHOST = unit("f2", "Goblin 2", "far", 4, 4, { clone: true, hidden: true, visible: false });
const DEAD = unit("f3", "Ogre 1", "far", 0, 30, { hostile: true, defeated: true });

test("boardContext: bands run Far, Near, Close; chips follow the turn order inside a band", () => {
  const a = unit("a", "A", "near", 1, 4), b = unit("b", "B", "near", 1, 4), c = unit("c", "C", "far", 1, 4);
  const ctx = boardContext({ combat: fightOf([a, b, c], [b, a, c]), user: { isGM: true } });
  assert.deepEqual(ctx.bands.map((x) => x.zone), ["far", "near", "close"]);
  assert.deepEqual(ctx.bands.map((x) => x.title), ["SDE.stage.zone.bandFar", "SDE.stage.zone.bandNear", "SDE.stage.zone.bandClose"]);
  assert.deepEqual(ctx.bands[1].chips.map((x) => x.id), ["b", "a"]);
  assert.deepEqual(ctx.bands.map((x) => x.count), [1, 2, 0]);
  const none = boardContext({ combat: fightOf([a, b], []), user: { isGM: true } });
  assert.deepEqual(none.bands[1].chips.map((x) => x.id), ["a", "b"], "no turns: creation order");
  assert.equal(boardContext({ combat: fightOf([unit("z", "Z", "bogus", 1, 1)]), user: { isGM: true } }).bands[2].count, 1, "a bad zone reads as close");
});

test("boardContext: a combatant the viewer cannot see is not in a player's context at all, but is in the GM's", () => {
  const combat = fightOf([PC, FOE, GHOST]);
  assert.equal(chip(boardContext({ combat, user: { isGM: false } }), "f2"), undefined);
  const gm = boardContext({ combat, user: { isGM: true } });
  assert.equal(chip(gm, "f2").hidden, true);
  assert.equal(boardContext({ combat: fightOf([unit("h", "H", "far", 1, 1, { hidden: true })]), user: { isGM: false } }).bands[0].count, 1, "visible is what decides, not hidden");
});

test("boardContext: foe HP is a bar only for a player, numbers for the GM; a PC's numbers show to everyone", () => {
  const combat = fightOf([PC, OTHER, FOE]);
  const p = boardContext({ combat, user: { isGM: false } }), g = boardContext({ combat, user: { isGM: true } });
  assert.equal(chip(p, "f1").hp.numbers, false);
  assert.equal(chip(g, "f1").hp.numbers, true);
  assert.equal(chip(p, "pc2").hp.numbers, true, "someone else's PC too");
  assert.equal(chip(p, "pc").hp.numbers, true);
  assert.deepEqual([chip(p, "f1").hp.tone, chip(p, "f1").hp.pct, chip(p, "f1").hp.word], ["low", 50, "SDE.stage.zone.hpLow"]);
  assert.equal(chip(boardContext({ combat: fightOf([DEAD]), user: { isGM: false } }), "f3").hp.numbers, false, "a hostile prototype is a foe too");
});

test("boardContext: turn, defeated and hidden marks; status icons carry their names", () => {
  const fx = unit("e", "E", "close", 4, 4, { fx: [{ name: "Poisoned", img: "p.svg" }, { name: "Gone", img: "g.svg", disabled: true }] });
  const combat = fightOf([fx, DEAD, GHOST], [fx, DEAD, GHOST], fx);
  const ctx = boardContext({ combat, user: { isGM: true } });
  assert.equal(chip(ctx, "e").turn, true);
  assert.equal(chip(ctx, "f3").turn, false);
  assert.equal(chip(ctx, "f3").defeated, true);
  assert.equal(chip(ctx, "f2").hidden, true);
  assert.deepEqual(chip(ctx, "e").statuses, [{ img: "p.svg", name: "Poisoned" }]);
  assert.equal(chip(boardContext({ combat: fightOf([unit("v", "V", "close", 1, 1, { hidden: true })]), user: { isGM: false } }), "v").hidden, false, "players never see the hidden mark");
});

test("boardContext: controls only where canMoveZone allows; the ends are disabled", () => {
  const combat = fightOf([PC, OTHER, FOE, DEAD]);
  const p = boardContext({ combat, user: { isGM: false } }), g = boardContext({ combat, user: { isGM: true } });
  assert.deepEqual(all(p).filter((c) => c.canAct).map((c) => c.id), ["pc"], "a player: their own PC only");
  assert.deepEqual(all(g).filter((c) => c.canAct).map((c) => c.id).sort(), ["f1", "f3", "pc", "pc2"].sort(), "the GM: everyone");
  assert.equal(all(p).some((c) => c.canDefeat), false);
  assert.equal(all(g).every((c) => c.canDefeat), true);
  assert.deepEqual([chip(g, "pc").atClose, chip(g, "pc").atFar], [true, false]);
  assert.deepEqual([chip(g, "f3").atClose, chip(g, "f3").atFar], [false, true]);
  const owned = unit("mine", "Mine", "near", 1, 1, { own: true, hostile: true });
  assert.equal(chip(boardContext({ combat: fightOf([owned]), user: { isGM: false } }), "mine").canAct, false, "owning a foe does not allow moving it");
});

test("boardContext: the backing is opaque unless a Stage picture is up", () => {
  const combat = fightOf([PC]);
  const up = { shown: true, place: "camp", image: "a.webp" };
  assert.equal(boardContext({ combat, user: { isGM: true }, stage: up }).backed, false);
  assert.equal(boardContext({ combat, user: { isGM: true }, stage: { ...up, shown: false } }).backed, true);
  assert.equal(boardContext({ combat, user: { isGM: true }, stage: { ...up, image: "" } }).backed, true);
  assert.equal(boardContext({ combat, user: { isGM: true } }).backed, true);
});

// --- the layer ---------------------------------------------------------------------------------------

function setup({ gm = true, stage = null, combats = [] } = {}) {
  const body = [], hooks = {}, once = {}, log = { renders: [], notes: [], warn: [], damage: [], updates: [] };
  const mk = (tag) => {
    const el = {
      tag, attrs: {}, classes: new Set(), listeners: {}, innerHTML: "", id: "", className: "",
      setAttribute(k, v) { el.attrs[k] = v; },
      addEventListener(t, f) { el.listeners[t] = f; },
      classList: { toggle: (c, on) => { on ? el.classes.add(c) : el.classes.delete(c); } },
      querySelector: () => null, contains: () => false,
      remove() { const i = body.indexOf(el); if (i >= 0) body.splice(i, 1); },
      after(o) { const i = body.indexOf(o); if (i >= 0) body.splice(i, 1); body.splice(body.indexOf(el) + 1, 0, o); },
      get nextElementSibling() { return body[body.indexOf(el) + 1] ?? null; },
    };
    return el;
  };
  const fake = { activeElement: null };
  globalThis.document = {
    ...fake,
    body: { append: (e) => body.push(e) },
    createElement: mk,
    querySelector: (sel) => body.find((e) => `#${e.id}` === sel) ?? null,
  };
  const picture = (...ids) => ids.forEach((id) => { const e = mk("div"); e.id = id; body.push(e); });
  const user = { isGM: gm };
  const store = { stage };
  const fights = new Col(combats.map((c) => [c.id, c]));
  const updates = log.updates;
  globalThis._replace = (v) => v;
  globalThis.ui = { notifications: { warn: (m) => log.warn.push(m) } };
  globalThis.foundry = { utils: {}, applications: { handlebars: { renderTemplate: async (path, ctx) => { log.renders.push([path, ctx]); return "<p>board</p>"; } } } };
  globalThis.Hooks = { once: (n, f) => { once[n] = f; }, on: (n, f) => { (hooks[n] ??= []).push(f); } };
  globalThis.game = {
    user, combats: fights, i18n: { localize: (k) => k, format: (k) => k },
    settings: { get: (_m, k) => store[k] },
  };
  board.registerZoneBoard();
  return { body, hooks, once, log, store, fights, picture, user, updates };
}

const stageUp = { shown: true, place: "camp", image: "a.webp", partyId: "", campId: "" };
const fire = (e, name, ...a) => (e.hooks[name] ?? []).forEach((f) => f(...a));

test("the layer exists only while a zone fight does; region role, not aria-hidden, after #sde-stage", async () => {
  const e = setup({ stage: stageUp, combats: [fightOf([PC])] });
  e.picture("sde-stage");
  e.once.ready();
  await tick();
  assert.equal(e.body.length, 2);
  const layer = e.body[1];
  assert.equal(layer.id, "sde-zone-board");
  assert.equal(layer.attrs.role, "region");
  assert.equal(layer.attrs["aria-label"], "SDE.stage.zone.boardLabel");
  assert.equal("aria-hidden" in layer.attrs, false);
  assert.equal(layer.innerHTML, "<p>board</p>");
  assert.equal(typeof layer.listeners.click, "function", "one delegated listener");
  assert.equal(layer.classes.has("zb-backed"), false, "picture up: transparent");
  // The fight ends: the layer goes.
  e.fights.clear();
  fire(e, "deleteCombat", {});
  await tick();
  assert.equal(e.body.length, 1);
  assert.equal(e.body[0].id, "sde-stage");
  // No fight at ready: nothing is drawn.
  const none = setup({ stage: stageUp });
  none.once.ready();
  await tick();
  assert.equal(none.body.length, 0);
  assert.equal(none.log.renders.length, 0);
});

test("the layer goes after the picture even when the picture was drawn later; the backing follows stage.shown", async () => {
  const e = setup({ stage: null, combats: [fightOf([PC])] });
  e.once.ready();
  await tick();
  const layer = e.body[0];
  assert.equal(layer.classes.has("zb-backed"), true, "no picture: opaque backing");
  e.picture("sde-stage"); // the picture raised after the board
  e.store.stage = stageUp;
  fire(e, "updateSetting", { key: `${M}.stage` });
  await tick();
  assert.deepEqual(e.body.map((x) => x.id), ["sde-stage", "sde-zone-board"]);
  assert.equal(layer.classes.has("zb-backed"), false);
  e.store.stage = { ...stageUp, shown: false };
  fire(e, "updateSetting", { key: `${M}.stage` });
  await tick();
  assert.equal(layer.classes.has("zb-backed"), true);
  const n = e.log.renders.length;
  fire(e, "updateSetting", { key: "other.setting" });
  await tick();
  assert.equal(e.log.renders.length, n, "other settings do not redraw");
});

test("redraws are coalesced to one render per tick; actor and effect hooks redraw only for actors in the fight", async () => {
  const e = setup({ stage: stageUp, combats: [fightOf([PC, OTHER])] });
  e.once.ready();
  await tick();
  const base = e.log.renders.length;
  for (const h of ["createCombat", "updateCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) fire(e, h, {});
  fire(e, "updateActor", { id: "apc" });
  await tick();
  assert.equal(e.log.renders.length, base + 1);
  fire(e, "updateActor", { id: "stranger" });
  fire(e, "createActiveEffect", { parent: { id: "stranger" } });
  fire(e, "deleteActiveEffect", { parent: null });
  await tick();
  assert.equal(e.log.renders.length, base + 1, "an actor with no combatant here changes nothing");
  fire(e, "updateActiveEffect", { parent: { id: "apc2" } });
  await tick();
  assert.equal(e.log.renders.length, base + 2);
});

// --- the click listener -------------------------------------------------------------------------------

async function clickSetup({ gm = true } = {}) {
  const writes = [], damage = [];
  const actor = { id: "apc", name: "Creeg", isOwner: true, flags: {}, prototypeToken: { disposition: 1 }, system: { attributes: { hp: { value: 5, max: 9 } } }, applyDamage: async (n) => { damage.push(n); } };
  const cb = { id: "pc", name: "Creeg", flags: { [M]: { zone: "near" } }, defeated: false, actor, update: async (d) => { writes.push(d); } };
  const fight = fightOf([cb]);
  const e = setup({ gm, stage: stageUp, combats: [fight] });
  e.once.ready();
  await tick();
  const layer = e.body[0];
  const input = { value: "", focus() { this.focused = true; } };
  const pop = { open: true };
  const mkChip = () => ({ dataset: { combatantId: "pc" }, querySelector: (s) => (s === ".zb-amount" ? input : s === "details" ? pop : null) });
  const click = (action, disabled = false) => {
    const c = mkChip();
    const btn = { dataset: { action }, disabled, closest: (s) => (s === "[data-combatant-id]" ? c : null) };
    return layer.listeners.click({ target: { closest: (s) => (s === "[data-action]" ? btn : null) } });
  };
  return { e, click, writes, damage, input, pop, cb };
}

test("the click listener: closer and farther move one band, damage and heal go through applyZoneDamage, defeat toggles", async () => {
  const k = await clickSetup();
  await k.click("closer");
  assert.deepEqual(k.writes.pop(), { [`flags.${M}.zone`]: "close" });
  await k.click("farther");
  assert.deepEqual(k.writes.pop(), { [`flags.${M}.zone`]: "far" });
  k.input.value = "3";
  await k.click("damage");
  assert.deepEqual(k.damage, [3]);
  assert.equal(k.pop.open, false, "the popover closes after applying");
  assert.equal(k.input.value, "");
  k.input.value = "4";
  await k.click("heal");
  assert.deepEqual(k.damage, [3, -4], "heal is a negative amount");
  await k.click("defeated");
  assert.deepEqual(k.writes.pop(), { defeated: true });
});

test("the click listener: an empty or bad amount does nothing; a disabled button does nothing; a failing service warns, never throws", async () => {
  const k = await clickSetup();
  for (const v of ["", "0", "-2", "abc"]) { k.input.value = v; await k.click("damage"); }
  assert.deepEqual(k.damage, []);
  assert.equal(k.input.focused, true);
  await k.click("closer", true);
  assert.deepEqual(k.writes, []);
  k.cb.update = async () => { throw new Error("boom"); };
  const errors = [], orig = console.error;
  console.error = (...a) => errors.push(a);
  try { await k.click("closer"); } finally { console.error = orig; }
  assert.deepEqual(k.e.log.warn, ["SDE.stage.zone.boardFailed"]);
  assert.match(String(errors[0][0]), /shadowdark-enhancer/);
});
