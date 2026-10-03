// The Bastion sheet follows the world clock: an open sheet records the day its context was built for
// and is redrawn when — and only when — the day turns. The system's real-time light tracking advances
// the clock every second by default, so a per-tick redraw would rebuild the sheet (and the plan SVG)
// once a second and lose what the user is typing (#352 review).
import test from "node:test";
import assert from "node:assert/strict";
import { gregorian } from "./gregorian-calendar.mjs";

const DAY = 86400;
const fieldStub = new Proxy({}, { get: () => class { constructor() {} } });
// The placer-style stub: the application classes only need bare bases at import time.
globalThis.foundry = {
  applications: {
    api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: class {} },
    sheets: { ActorSheetV2: class { async _prepareContext() { return {}; } } },
    apps: { DocumentSheetConfig: { registerSheet() {} } },
    instances: new Map(),
    ux: { TextEditor: { implementation: { enrichHTML: async () => "" } } },
  },
  data: { fields: fieldStub },
  abstract: { TypeDataModel: class {} },
  utils: { randomID: () => "r1", getRoute: (p) => p },
};
globalThis.CONFIG = { Actor: { dataModels: {}, typeIcons: {} } };
globalThis.Actor = class {};
globalThis.document = { getElementById: () => ({}) };   // the sprites holder reads as already loaded
const hooks = new Map();
globalThis.Hooks = { on: (n, fn) => { const l = hooks.get(n) ?? []; l.push(fn); hooks.set(n, l); } };
globalThis.game = { user: { isGM: true }, actors: [], time: { worldTime: 0, calendar: gregorian }, i18n: { format: (k) => k, localize: (k) => k }, settings: { get: () => null } };
globalThis.CONST = { DEFAULT_TOKEN: "icons/svg/mystery-man.svg" };

const { registerBastion } = await import("../scripts/bastion/register-bastion.mjs");
const { BastionSheet } = await import("../scripts/bastion/bastion-sheet.mjs");
const { newBastion } = await import("../scripts/bastion/bastion-core.mjs");
registerBastion();
const onWorldTime = hooks.get("updateWorldTime").at(-1);

const worldAt = (day) => { globalThis.game.time.worldTime = day * DAY; };
const dayNow = () => Math.floor(globalThis.game.time.worldTime / DAY);

/** An open sheet as `foundry.applications.instances` holds it: rendered for `day`, its render recording the day. */
function openSheet(shown) {
  const app = new BastionSheet();
  app._shownDay = shown;
  app.renders = 0;
  app.render = () => { app.renders += 1; app._shownDay = dayNow(); };   // what _prepareContext records in the real sheet
  return app;
}

test("ticks inside the day a sheet was rendered for redraw nothing; a turned day redraws it once", () => {
  globalThis.foundry.applications.instances.clear();
  const open = openSheet(100);
  const foreign = { render: () => { throw new Error("not a BastionSheet"); } };
  globalThis.foundry.applications.instances.set("sheet", open);
  globalThis.foundry.applications.instances.set("other", foreign);
  worldAt(100);
  onWorldTime();
  globalThis.game.time.worldTime += 3600;
  onWorldTime();
  assert.equal(open.renders, 0, "the per-second real-time ticks redraw nothing");
  worldAt(101);
  onWorldTime();
  assert.equal(open.renders, 1, "a new day redraws the open sheet");
  onWorldTime();
  assert.equal(open.renders, 1, "and the next tick leaves the now-current sheet alone");
  worldAt(103);
  onWorldTime();
  assert.equal(open.renders, 2, "a move over two days redraws once, for the day it now shows");
});

test("a sheet behind the day catches up on the next tick", () => {
  globalThis.foundry.applications.instances.clear();
  const stale = openSheet(99);
  globalThis.foundry.applications.instances.set("stale", stale);
  worldAt(100);
  onWorldTime();
  assert.equal(stale.renders, 1);
  assert.equal(stale._shownDay, 100);
});

test("the sheet records the world-clock day its context was built for, and the aviary reads that same day", async () => {
  globalThis.foundry.applications.instances.clear();
  worldAt(100);
  const state = { ...newBastion("keep"), weeksLeft: 0, pigeonDay: 100 };
  const app = new BastionSheet();
  app.document = { name: "Hold", isOwner: true, items: [], system: { party: "", notes: "", toObject: () => structuredClone(state) } };
  const context = await app._prepareContext({});
  assert.equal(app._shownDay, 100, "the day the context was built for is recorded on the sheet");
  assert.equal(context.aviary.flown, true, "the pigeon flew today, on the same day");
  worldAt(101);
  await app._prepareContext({});
  assert.equal(app._shownDay, 101, "a later render records the later day");
});
