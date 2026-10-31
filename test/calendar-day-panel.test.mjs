// A day of the month view opens like a normal calendar's: it stays open, a GM adds to it
// in its panel and clicks what they added to edit it, and a player only reads it.
import test from "node:test";
import assert from "node:assert/strict";

// overland-bar.mjs pulls in crawl-state.mjs and the vehicle sheets, which touch Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const mine = { id: "w", at: 86400, kind: "note", title: "Mine", text: "Details", gm: false, auto: false };
const logged = { id: "l", at: 86400, kind: "travel", title: "Travel began", text: "", gm: false, auto: true };
const stored = { calendarEntries: [mine, logged], clockBar: "all" };
const game = {
  user: { isGM: true, id: "gm" },
  i18n: { localize: (k) => k, format: (k) => k },
  settings: { get: (ns, key) => stored[key], set: async () => {} },
  time: { worldTime: 0, calendar: {} },
  combat: null, combats: { get: () => undefined }, scenes: { get: () => undefined },
};
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {}, time: {} }, Hooks: { on() {}, once() {}, callAll() {} },
  ui: { notifications: { warn() {}, error() {} } }, canvas: { tokens: { placeables: [] }, grid: { isHexagonal: false } },
  game, document: { body: { classList: { toggle() {} } }, activeElement: null, getElementById: () => null },
  window: { addEventListener() {} },
});
const { TravelBar } = await import("../scripts/overland/overland-bar.mjs");

let renders = 0, focused = 0;
Object.assign(TravelBar, {
  render() { renders++; }, _holidays: [],
  _el: { contains: () => true, querySelector: () => ({ focus() { focused++; }, scrollIntoView() {} }) },
});
const click = (action, id, dataset = {}) => TravelBar._onClick({ target: { closest: () => ({ dataset: { action, id, ...dataset }, matches: () => false }) } });
const g = { year: 1348, monthNumber: 3, month: "March", cells: [{ at: 86400, day: 2 }] };
const panel = (gm = true) => {
  game.user.isGM = gm;
  const events = [[...[mine, logged].map((entry) => ({ kind: "entry", entry }))]];
  const html = TravelBar._detail(g, events, {}, gm);
  game.user.isGM = true;
  return html;
};

test("a second click on a day leaves it open and comes back to the title box", async () => {
  const typed = focused;
  await click("pickDay", "86400");
  assert.deepEqual(TravelBar._info, { at: 86400, entry: undefined });
  assert.equal(focused, typed, "the first click must not scroll the day from under the second");
  const drawn = renders;
  TravelBar._draft = { title: "half typed" };
  await click("pickDay", "86400");
  assert.ok(TravelBar._info, "still open");
  assert.equal(renders, drawn, "not redrawn under the double-click");
  assert.equal(focused, typed + 1);
  assert.equal(TravelBar._draft.title, "half typed");
  await click("closeInfo");
  assert.equal(TravelBar._info, null, "the × closes it");
});

test("a GM's panel adds to that day; a click on what they added edits it, a logged line does not", async () => {
  await click("pickDay", "86400");
  let html = panel();
  assert.match(html, /data-action="saveEntry"/);
  assert.doesNotMatch(html, /id="sde-hud-e-date"/, "a new entry is on the panel's day");
  assert.match(html, /<div class="sde-hud-dblock" data-action="pickDay" data-id="86400" data-entry="w"/);
  assert.doesNotMatch(html, /data-entry="l"/);

  await click("pickDay", "86400", { entry: "w" });
  html = panel();
  assert.match(html, /id="sde-hud-e-date"[^>]*value="1348-03-02"/);
  assert.match(html, /id="sde-hud-e-title"[^>]*value="Mine"/);
  assert.match(html, /data-action="delEntry" data-id="w"/);

  await click("pickDay", "86400");
  assert.equal(TravelBar._info.entry, "w", "a click on the day does not throw the edit away");
  await click("cancelEdit");
  assert.deepEqual(TravelBar._info, { at: 86400 });
  await click("closeInfo");
});

test("a logged line can't be opened to edit, even by asking for it", async () => {
  await click("pickDay", "86400", { entry: "l" });
  assert.doesNotMatch(panel(), /id="sde-hud-e-date"/);
  await click("closeInfo");
});

test("a player's panel has no form and nothing to click", async () => {
  await click("pickDay", "86400");
  const html = panel(false);
  assert.match(html, /Mine/);
  assert.doesNotMatch(html, /sde-hud-e-|saveEntry|data-entry/);
  await click("closeInfo");
});
