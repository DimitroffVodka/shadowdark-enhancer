// Encounter battle maps, part D2: what the HUD's buttons and the posted card decide and do. The parts they reach
// (the battle, the library, the picker, the preload readout) are faked here, so this passes whatever state those
// files are in; the encounters are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  allReady, barPercent, battleControls, canBattle, cardEncounter, cardStash, makePreloadWatch, needsConfirm, needsPick, panelAfter,
  panelOnScene, pickAnswer, pickerArgs, readStash, readoutKey, readoutShown, readoutSummary, readyArgs, recordOf, setUpArgs, stillLoading,
  touchesBattle, withVariant,
} from "../scripts/encounter/battle-maps/battle-actions-core.mjs";

const game = {
  user: { isGM: true, id: "gm1" },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
  settings: { get: () => false },
  shadowdarkEnhancer: { overland: { isActive: () => false, state: () => ({}) } },
};
globalThis.game = game;
const warned = [];
const errored = [];
globalThis.ui = { notifications: { warn: (m) => warned.push(m), error: (m) => errored.push(m), info() {} } };
globalThis.canvas = { scene: { id: "viewed" } };
// encounter-draw.mjs reads the template renderer at import.
globalThis.foundry = { applications: { handlebars: { renderTemplate: async (template, data) => JSON.stringify({ template, battleMap: !!data.battleMap }) } } };

const actions = await import("../scripts/encounter/battle-maps/battle-actions.mjs");
const { openBattleMap, changeBattleMap, bringTheTable, returnToTravel, describeBattle, loadBattleParts, partyContext, wireBattleCard, registerBattleChatButtons } = actions;
const { postEncounter } = await import("../scripts/encounter/encounter-draw.mjs");

const wolves = { kind: "monster", uuid: "Actor.wolf", name: "Wolf", count: 3, distanceRoll: 4, img: "wolf.webp", chain: [{ name: "x" }] };

// ─── The pure half ──────────────────────────────────────────────────────────

test("a battle record comes out of either answer of BattleMaps; a promise, a stranger or nothing is no battle", () => {
  const record = { id: "b1", status: "staged" };
  assert.equal(recordOf(record), record);
  assert.equal(recordOf({ battle: record, scene: {} }), record);
  for (const none of [null, undefined, {}, { battle: {} }, Promise.resolve(record), "b1"]) assert.equal(recordOf(none), null);
});

test("only a creature with something to put on the map can be fought", () => {
  assert.equal(canBattle(wolves), true);
  assert.equal(canBattle({ uuid: "Actor.wolf" }), true, "a macro's bare creature counts");
  for (const enc of [null, { kind: "flavor", text: "x" }, { kind: "empty" }, { kind: "monster" }, { kind: "flavor", uuid: "Actor.wolf" }]) assert.equal(canBattle(enc), false);
});

test("the picker opens when the GM asks, when the terrain is unknown, or when the library has no default for it", () => {
  assert.equal(needsPick({ terrain: "forest", hasDefault: true }), false);
  assert.equal(needsPick({ choose: true, terrain: "forest", hasDefault: true }), true);
  assert.equal(needsPick({ terrain: null, hasDefault: true }), true);
  assert.equal(needsPick({ terrain: "forest", hasDefault: false }), true);
  assert.equal(needsPick(), true);
});

test("the picker's day, night or camp lays over the clock; a camp keeps the night's dark", () => {
  assert.deepEqual(withVariant("day", { night: true, camping: true }), { night: false, camping: false });
  assert.deepEqual(withVariant("night", { night: false, camping: true }), { night: true, camping: false });
  assert.deepEqual(withVariant("camp", { night: true, camping: false }), { night: true, camping: true });
  assert.deepEqual(withVariant("camp", { night: false }), { night: false, camping: true });
  assert.deepEqual(withVariant(null, { night: true, camping: true }), { night: true, camping: true }, "nothing chosen: the table's own state");
  assert.deepEqual(withVariant("something else", { night: true }), { night: true, camping: false });
});

test("a pick becomes what setUp and changeMap take; the picker's own word on night beats the clock's", () => {
  assert.deepEqual(pickAnswer({ mapId: "forest-woods", variant: "camp", night: false }, { night: true, camping: false }),
    { mapId: "forest-woods", sceneId: null, variant: "camp", night: false, camping: true });
  assert.deepEqual(pickAnswer({ mapId: "forest-woods", variant: "camp" }, { night: true }), { mapId: "forest-woods", sceneId: null, variant: "camp", night: true, camping: true });
  assert.deepEqual(pickAnswer({ sceneId: "Scene1" }, { night: true, camping: true }), { mapId: null, sceneId: "Scene1", variant: null, night: true, camping: true },
    "a world scene says nothing of the look");
});

test("setUp's arguments: the trimmed encounter, the terrain and the table's look; no scene to return to leaves setUp's default", () => {
  const args = setUpArgs({ enc: wolves, terrain: "forest", hex: 1203, originSceneId: "hexes", night: true, camping: false });
  assert.deepEqual(args, {
    encounter: { kind: "monster", uuid: "Actor.wolf", name: "Wolf", count: 3, distanceRoll: 4 },
    terrain: "forest", hex: 1203, night: true, camping: false, originSceneId: "hexes",
  });
  const noScene = setUpArgs({ enc: wolves, terrain: null, originSceneId: null });
  assert.ok(!("originSceneId" in noScene) && noScene.hex === null && noScene.terrain === null);
  const picked = setUpArgs({ enc: wolves, terrain: "forest", pick: { mapId: "forest-woods", variant: "night", night: true } });
  assert.deepEqual([picked.mapId, picked.variant, picked.night, picked.camping], ["forest-woods", "night", true, false]);
  assert.deepEqual(cardEncounter({ uuid: "Actor.rat", name: "Rat" }), { kind: "monster", uuid: "Actor.rat", name: "Rat", count: 1, distanceRoll: null }, "one, when no count was rolled");
});

test("Change map opens the picker on the battle's terrain and the look it has", () => {
  assert.deepEqual(pickerArgs({ terrain: "swamp", variant: "camp" }, { night: false, camping: false }), { terrain: "swamp", night: false, camping: true });
  assert.deepEqual(pickerArgs({ terrain: "swamp", variant: "day" }, { night: true, camping: true }), { terrain: "swamp", night: false, camping: false });
  assert.deepEqual(pickerArgs({ terrain: null }, { night: true }), { terrain: null, night: true, camping: false }, "no look on record: the table's");
});

test("a card keeps only what its button needs, and an older or creature-less card yields nothing", () => {
  const stash = cardStash({ res: { ...wolves, extra: "no" }, terrain: "forest", hexNum: 1203, originSceneId: "hexes" });
  assert.deepEqual(stash, { encounter: { kind: "monster", uuid: "Actor.wolf", name: "Wolf", count: 3, distanceRoll: 4 }, terrain: "forest", hexNum: 1203, originSceneId: "hexes" });
  assert.deepEqual(readStash(stash), stash);
  assert.deepEqual(readStash({ ...stash, hexNum: "12", terrain: undefined }), { ...stash, hexNum: null, terrain: null });
  for (const bad of [undefined, null, {}, { encounter: { kind: "flavor" } }, { encounter: { kind: "monster" } }]) assert.equal(readStash(bad), null);
});

test("which controls a battle offers: none yet, staged, live", () => {
  assert.deepEqual(battleControls(null), { start: true, bring: false, change: false, back: false });
  assert.deepEqual(battleControls({ status: "staged" }), { start: false, bring: true, change: true, back: true });
  assert.deepEqual(battleControls({ status: "live" }), { start: false, bring: false, change: false, back: true });
});

const row = (name, state, pct = 0, loaded = 0, total = 0) => ({ userId: name, name, state, loaded, total, pct });
const snapshot = (...rows) => ({ rows, ready: rows.filter((r) => r.state === "ready").length, expected: rows.length, allReady: rows.length > 0 && rows.every((r) => r.state === "ready") });

test("Ready n/N, who is still loading, and when Bring the table asks first", () => {
  const some = snapshot(row("Ann", "ready"), row("Bob", "loading", 0.4), row("Cy", "failed"), row("Di", "stalled"));
  assert.deepEqual(readyArgs(some), { ready: 1, expected: 4 });
  assert.deepEqual(stillLoading(some), ["Bob", "Cy", "Di"], "failed and stalled players are waited on too");
  assert.equal(needsConfirm(some), true);
  const all = snapshot(row("Ann", "ready"), row("Bob", "ready"));
  assert.deepEqual([readyArgs(all), stillLoading(all), needsConfirm(all)], [{ ready: 2, expected: 2 }, [], false]);
  for (const nobody of [null, undefined, snapshot()]) assert.deepEqual([readyArgs(nobody), stillLoading(nobody), needsConfirm(nobody)], [null, [], false], "nobody to wait for: no label, no confirm");
  assert.deepEqual([allReady(all), allReady(some), allReady(snapshot()), allReady(null)], [true, false, false, false]);
});

test("a player who has left is not counted in Ready n/N, not named as loading, and does not hold Bring the table back", () => {
  const left = snapshot(row("Ann", "ready"), row("Bob", "left", 0.4), row("Cy", "ready"));
  assert.deepEqual(readyArgs(left), { ready: 2, expected: 2 }, "2 of 2 still here, not 2 of 3");
  assert.deepEqual(stillLoading(left), [], "nobody to wait on");
  assert.equal(allReady(left), true);
  assert.equal(needsConfirm(left), false, "no confirm for a table that is all here and ready");
  assert.deepEqual(readoutSummary(left), { kind: "allReady" });
  const midway = snapshot(row("Ann", "ready"), row("Bob", "left"), row("Cy", "loading", 0.5));
  assert.deepEqual([readyArgs(midway), stillLoading(midway), needsConfirm(midway)], [{ ready: 1, expected: 2 }, ["Cy"], true], "the one who left is not among those named");
  assert.deepEqual(readoutSummary(midway), { kind: "pending", names: "Cy" });
  const gone = snapshot(row("Bob", "left"));
  assert.deepEqual([readyArgs(gone), allReady(gone), needsConfirm(gone), readoutSummary(gone)], [null, false, false, { kind: "nobody" }], "everyone left: nobody connected");
});

test("the readout's one line: none when no preload ran, then nobody connected, everyone ready, or who is being waited on", () => {
  assert.equal(readoutSummary(null), null);
  assert.deepEqual(readoutSummary(snapshot()), { kind: "nobody" });
  assert.deepEqual(readoutSummary(snapshot(row("Ann", "ready"), row("Bob", "ready"))), { kind: "allReady" });
  assert.deepEqual(readoutSummary(snapshot(row("Ann", "ready"), row("Bob", "loading"), row("Cy", "waiting"))), { kind: "pending", names: "Bob, Cy" });
});

test("a bar is whole percent of the ledger's fraction, full when ready, and never outside the box", () => {
  assert.deepEqual([row("a", "loading", 0.456), row("a", "loading", 7), row("a", "loading", -1), row("a", "waiting"), row("a", "ready", 0), row("a", "left", 0.6)].map(barPercent),
    [46, 100, 0, 0, 100, 0], "a player who left shows no bar");
  assert.equal(barPercent({ state: "loading", pct: "x" }), 0);
});

test("the readout's stamp changes with what the GM would see, and not with what they would not", () => {
  const a = snapshot(row("Ann", "loading", 0.4, 4, 10));
  const sameBar = snapshot(row("Ann", "loading", 0.4, 4, 10));
  assert.equal(readoutKey(a), readoutKey(sameBar));
  assert.notEqual(readoutKey(a), readoutKey(snapshot(row("Ann", "loading", 0.5, 5, 10))));
  assert.notEqual(readoutKey(a), readoutKey(snapshot(row("Ann", "ready", 1, 10, 10))));
  assert.equal(readoutKey(null), "");
});

test("the bar's panel follows the battle's stage: staged opens it, live folds it, gone closes it, the GM's own panels stay", () => {
  const next = (open, last, stage) => panelAfter({ open, stage: last }, stage);
  assert.deepEqual(next(null, null, "staged"), { open: "battle", stage: "staged" }, "a battle appears staged: its readout is in view");
  assert.deepEqual(next("battle", "staged", "live"), { open: null, stage: "live" }, "the table is brought: the combat's cards must not be covered");
  assert.deepEqual(next("time", "staged", "live"), { open: "time", stage: "live" }, "a panel the GM opened is not the battle's to fold");
  assert.deepEqual(next(null, null, "live"), { open: null, stage: "live" }, "first seen live (a reload): left folded");
  assert.deepEqual(next("battle", "live", null), { open: null, stage: null }, "gone: closed");
  assert.deepEqual(next("encounter", "live", null), { open: "encounter", stage: null });
  assert.deepEqual(next(null, "staged", "staged"), { open: null, stage: "staged" }, "unchanged: what the GM folded stays folded");
  assert.deepEqual(next("battle", "live", "live"), { open: "battle", stage: "live" }, "and what they opened by hand stays open");
  assert.deepEqual(panelAfter(), { open: null, stage: null });
  assert.deepEqual([panelOnScene("staged"), panelOnScene("live"), panelOnScene(undefined), panelOnScene(null)], ["battle", null, null, null]);
});

test("a change in the preload readout is shown only in the panels that carry it, and not while the date is typed", () => {
  assert.equal(readoutShown({ open: "battle" }), true);
  assert.equal(readoutShown({ open: "encounter" }), true);
  for (const open of [null, "time", "month", "travel"]) assert.equal(readoutShown({ open }), false, String(open));
  assert.equal(readoutShown({ open: "battle", typing: true }), false);
  assert.equal(readoutShown(), false);
});

test("a scene update touches the battle only when it writes or deletes the battle record", () => {
  assert.equal(touchesBattle({ flags: { [MODULE_ID]: { battle: {} } } }), true);
  assert.equal(touchesBattle({ flags: { [MODULE_ID]: { "-=battle": null } } }), true);
  assert.equal(touchesBattle({ flags: { [MODULE_ID]: { hexTags: {} } } }), false, "the hex fog and tags write all day");
  assert.equal(touchesBattle({ darkness: 0.5 }), false);
  assert.equal(touchesBattle(undefined), false);
});

test("the readout's listener is made once while a battle is staged, undone when it is not, and never left behind", () => {
  const listeners = [];
  const timers = new Map();
  let unsubscribed = 0, redraws = 0, next = 0;
  const watch = makePreloadWatch({
    subscribe: (fn) => { listeners.push(fn); return () => { unsubscribed++; }; },
    redraw: () => { redraws++; },
    setTimer: (fn) => { timers.set(++next, fn); return next; },
    clearTimer: (id) => { timers.delete(id); },
  });
  watch.sync(false);
  assert.deepEqual([listeners.length, watch.listening], [0, false], "nothing staged: not listening");
  watch.sync(true); watch.sync(true); watch.sync(true);
  assert.deepEqual([listeners.length, watch.listening], [1, true], "every redraw syncs, and it subscribes once");
  listeners[0](); listeners[0](); listeners[0]();
  assert.equal(timers.size, 1, "a burst of progress is one redraw");
  const [id, fire] = [...timers][0];
  timers.delete(id);
  fire();
  assert.equal(redraws, 1);
  listeners[0]();
  assert.equal(timers.size, 1, "the next burst queues again");
  watch.sync(false);
  assert.deepEqual([unsubscribed, watch.listening, timers.size], [1, false, 0], "undone, and its pending redraw with it");
  watch.sync(false);
  assert.equal(unsubscribed, 1, "not twice");
  watch.sync(true);
  assert.equal(listeners.length, 2, "a later battle listens again");
});

test("a redraw that falls due while the pointer is down on the bar waits for the release, so the press is not lost", () => {
  const timers = [];
  let redraws = 0, progress;
  const watch = makePreloadWatch({
    subscribe: (fn) => { progress = fn; return () => {}; },
    redraw: () => { redraws++; },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer() {},
  });
  watch.sync(true);
  watch.hold(true);
  progress();
  timers.shift().fn();
  assert.equal(redraws, 0, "its delay is up, but a button is being pressed");
  watch.hold(false);
  assert.deepEqual(timers.map((t) => t.ms), [0], "queued for after the click that follows the release");
  timers.shift().fn();
  assert.equal(redraws, 1);
  watch.hold(true); watch.hold(false);
  assert.equal(timers.length, 0, "nothing owed: a release draws nothing");
  watch.hold(true); progress(); timers.shift().fn();
  watch.sync(false);
  watch.hold(false);
  assert.equal(timers.length, 0, "a redraw owed when the battle ends is dropped with it");
});

test("a subscription that returns nothing to undo is still only made once", () => {
  let subscribed = 0;
  const watch = makePreloadWatch({ subscribe: () => { subscribed++; }, redraw() {} });
  watch.sync(true); watch.sync(true);
  assert.equal(subscribed, 1);
  assert.doesNotThrow(() => watch.sync(false));
});

// ─── The flows, against fakes ───────────────────────────────────────────────

/** Fakes for the parts the flows reach; `calls` is what they were asked, in order. */
function fakes({ current = null, hasDefault = true, pick = null, night = false, camping = false, confirm = true } = {}) {
  const calls = [];
  const note = (name) => async (...args) => { calls.push([name, ...args]); return { ok: name }; };
  const BattleMaps = {
    current: () => current,
    setUp: note("setUp"), changeMap: note("changeMap"), bringTable: note("bringTable"), returnToTravel: note("returnToTravel"),
  };
  const io = {
    battle: async () => BattleMaps,
    picker: async () => ({ pick: async (args) => { calls.push(["pick", args]); return pick; } }),
    maps: async () => ({ normalizePrefs: (raw) => raw, resolveDefaultMap: (terrain) => { calls.push(["default", terrain]); return hasDefault ? { id: "forest-woods" } : null; } }),
    conditions: () => ({ night, camping }),
    prefs: () => ({}),
    confirm: async (names) => { calls.push(["confirm", names]); return confirm; },
  };
  return { calls, io };
}
const names = (calls) => calls.map((c) => c[0]);

test("Battle map on a terrain with a default map: no picker, one setUp with the table's night and camp", async () => {
  const { calls, io } = fakes({ night: true, camping: true });
  const done = await openBattleMap({ enc: wolves, terrain: "Salt Flat", hex: 1203, originSceneId: "hexes" }, io);
  assert.deepEqual(names(calls), ["default", "setUp"]);
  assert.equal(calls[0][1], "salt_flat", "the terrain as the library keys it");
  assert.deepEqual(calls[1][1], {
    encounter: { kind: "monster", uuid: "Actor.wolf", name: "Wolf", count: 3, distanceRoll: 4 },
    terrain: "salt_flat", hex: 1203, night: true, camping: true, originSceneId: "hexes",
  });
  assert.deepEqual(done, { ok: "setUp" });
});

test("Choose map: the picker opens on the table's night and camp, and its answer is what is set up", async () => {
  const { calls, io } = fakes({ night: true, pick: { mapId: "forest-road", variant: "camp", night: false } });
  await openBattleMap({ enc: wolves, terrain: "forest", choose: true }, io);
  assert.deepEqual(names(calls), ["default", "pick", "setUp"]);
  assert.deepEqual(calls[1][1], { terrain: "forest", night: true, camping: false });
  const sent = calls[2][1];
  assert.deepEqual([sent.mapId, sent.sceneId, sent.variant, sent.night, sent.camping], ["forest-road", null, "camp", false, true]);
});

test("a picker closed ends quietly: no battle, no message", async () => {
  const { calls, io } = fakes({ pick: null });
  warned.length = 0; errored.length = 0;
  assert.equal(await openBattleMap({ enc: wolves, terrain: "forest", choose: true }, io), null);
  assert.ok(!names(calls).includes("setUp") && !warned.length && !errored.length);
});

test("no terrain, or no default map for it, goes to the picker; a world scene it returns is set up as it is", async () => {
  for (const [terrain, hasDefault] of [[null, true], ["", true], ["forest", false]]) {
    const { calls, io } = fakes({ hasDefault, pick: { sceneId: "Scene1" } });
    await openBattleMap({ enc: wolves, terrain }, io);
    assert.ok(names(calls).includes("pick"), `terrain ${JSON.stringify(terrain)}, default ${hasDefault}`);
    const sent = calls.at(-1)[1];
    assert.deepEqual([calls.at(-1)[0], sent.sceneId, sent.mapId], ["setUp", "Scene1", null]);
  }
  const { calls, io } = fakes({ pick: { mapId: "lake-calm", variant: "day", night: false } });
  await openBattleMap({ enc: wolves, terrain: null }, io);
  assert.equal(calls.find((c) => c[0] === "default"), undefined, "no terrain to look a default up for");
});

test("only a GM, only a creature, and only one battle at a time", async () => {
  const { calls, io } = fakes();
  assert.equal(await openBattleMap({ enc: { kind: "flavor", text: "x" }, terrain: "forest" }, io), null);
  assert.equal(await openBattleMap({ enc: undefined }, io), null);
  game.user.isGM = false;
  assert.equal(await openBattleMap({ enc: wolves, terrain: "forest" }, io), null);
  game.user.isGM = true;
  assert.deepEqual(calls, [], "nothing was asked of any part");
  const busy = fakes({ current: { id: "b1", status: "staged" } });
  warned.length = 0;
  assert.equal(await openBattleMap({ enc: wolves, terrain: "forest" }, busy.io), null);
  assert.deepEqual([names(busy.calls), warned], [[], ["SDE.encounterMaps.hud.running"]]);
});

test("a Battle map pressed while another setup runs, from the HUD or the card, is that setup's answer and sets nothing up", async () => {
  const { calls, io } = fakes();
  let release;
  (await io.battle()).setUp = (args) => new Promise((resolve) => { calls.push(["setUp", args]); release = resolve; });
  const fromHud = openBattleMap({ enc: wolves, terrain: "forest", originSceneId: "hexes" }, io);
  const fromCard = openBattleMap({ enc: wolves, terrain: "forest", originSceneId: "hexes" }, io);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((c) => c[0] === "setUp").length, 1, "the check for a battle already there ran once, not twice");
  release({ battle: { id: "b1" }, existing: true });
  const [first, second] = await Promise.all([fromHud, fromCard]);
  assert.equal(second, first);
  assert.deepEqual(first, { battle: { id: "b1" }, existing: true }, "whichever shape setUp answers in comes back as it is");
  // Done: the next press is a setup of its own again.
  const later = fakes();
  await openBattleMap({ enc: wolves, terrain: "forest" }, later.io);
  assert.deepEqual(names(later.calls), ["default", "setUp"]);
  // And one that fails frees the way too.
  const quiet = console.error;
  console.error = () => {};
  try {
    const broken = fakes();
    (await broken.io.battle()).setUp = async () => { throw new Error("refused"); };
    assert.equal(await openBattleMap({ enc: wolves, terrain: "forest" }, broken.io), null);
  } finally {
    console.error = quiet;
  }
  const after = fakes();
  await openBattleMap({ enc: wolves, terrain: "forest" }, after.io);
  assert.deepEqual(names(after.calls), ["default", "setUp"]);
});

test("a part that is missing or throws is told to the GM once and the click ends", async () => {
  const quiet = console.error;
  console.error = () => {};
  errored.length = 0;
  try {
    const { io } = fakes();
    assert.equal(await openBattleMap({ enc: wolves, terrain: "forest" }, { ...io, battle: async () => { throw new Error("no such file"); } }), null);
    const setUpFails = fakes();
    const battle = await setUpFails.io.battle();
    battle.setUp = async () => { throw new Error("refused"); };
    assert.equal(await openBattleMap({ enc: wolves, terrain: "forest" }, setUpFails.io), null);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(errored, ["SDE.encounterMaps.hud.failed", "SDE.encounterMaps.hud.failed"]);
});

test("Change map: the picker opens on the battle's terrain and look, and the battle is moved to the answer", async () => {
  const battle = { id: "b1", status: "staged", terrain: "swamp", variant: "night" };
  const { calls, io } = fakes({ pick: { mapId: "swamp-bog", variant: "night", night: true } });
  await changeBattleMap({ battle }, io);
  assert.deepEqual(calls[0], ["pick", { terrain: "swamp", night: true, camping: false }]);
  assert.deepEqual(calls[1], ["changeMap", "b1", { mapId: "swamp-bog", sceneId: null, variant: "night", night: true, camping: false }]);
  const closed = fakes({ pick: null });
  assert.equal(await changeBattleMap({ battle }, closed.io), null);
  assert.ok(!names(closed.calls).includes("changeMap"));
  assert.equal(await changeBattleMap({ battle: null }, closed.io), null);
});

test("Bring the table: straight through when everyone is ready; early, it names who is loading and waits for a yes", async () => {
  const battle = { id: "b1", status: "staged" };
  const ready = fakes();
  await bringTheTable({ battle, preload: snapshot(row("Ann", "ready")) }, ready.io);
  assert.deepEqual(names(ready.calls), ["bringTable"]);
  const none = fakes();
  await bringTheTable({ battle, preload: null }, none.io);
  assert.deepEqual(names(none.calls), ["bringTable"], "no readout, no confirm");
  const late = snapshot(row("Ann", "ready"), row("Bob", "loading", 0.3), row("Cy", "waiting"));
  const yes = fakes({ confirm: true });
  await bringTheTable({ battle, preload: late }, yes.io);
  assert.deepEqual(yes.calls, [["confirm", ["Bob", "Cy"]], ["bringTable", "b1"]]);
  const no = fakes({ confirm: false });
  assert.equal(await bringTheTable({ battle, preload: late }, no.io), null);
  assert.deepEqual(names(no.calls), ["confirm"], "declined: nothing moves");
});

test("Return to travel: from staged or live, with Keep it saves under a name, without it asks for no copy", async () => {
  const battle = { id: "b1", status: "live", label: "Forest Woods", encounter: { name: "Wolf", count: 3 } };
  const plain = fakes();
  await returnToTravel({ battle }, plain.io);
  assert.deepEqual(plain.calls, [["returnToTravel", "b1", { keep: false, label: undefined }]]);
  const kept = fakes();
  await returnToTravel({ battle, keep: true }, kept.io);
  assert.deepEqual(kept.calls[0][2], { keep: true, label: 'SDE.encounterMaps.hud.savedLabel{"count":3,"name":"Wolf","map":"Forest Woods"}' });
  await returnToTravel({ battle: { ...battle, status: "staged" }, keep: false }, plain.io);
  assert.equal(plain.calls.length, 2);
  assert.equal(await returnToTravel({ battle: null }, plain.io), null);
});

test("the HUD's battle: the record with its map's name or its world scene's, and its combat; done is none", () => {
  const getEncounterMap = (id) => (id === "forest-woods" ? { labelKey: "SDE.encounterMaps.map.forest-woods" } : null);
  const scenes = { get: (id) => (id === "Scene1" ? { name: "The Old Mill" } : undefined) };
  const combats = { get: (id) => (id === "c1" ? { started: true, round: 2 } : undefined) };
  const view = (record) => describeBattle(record, { getEncounterMap, scenes, combats });
  assert.equal(view({ id: "b1", status: "staged", mapId: "forest-woods", sceneId: "S" }).label, "SDE.encounterMaps.map.forest-woods");
  assert.equal(view({ id: "b1", status: "staged", mapId: null, sceneId: "Scene1" }).label, "The Old Mill");
  assert.equal(view({ id: "b1", status: "staged", mapId: "gone-from-library", sceneId: "nowhere" }).label, "", "a map the library lost reads blank, not undefined");
  const live = view({ battle: { id: "b1", status: "live", mapId: "forest-woods", combatId: "c1" }, scene: {} });
  assert.deepEqual(live.combat, { started: true, round: 2 });
  assert.equal(view({ id: "b1", status: "live", combatId: "gone" }).combat, null);
  assert.equal(view({ id: "b1", status: "done" }), null);
  assert.equal(view(null), null);
});

test("a battle whose combat is gone says so; one whose combat is waiting, running, or never made does not", () => {
  const combats = { get: (id) => ({ c1: { started: false, round: 0 }, c2: { started: true, round: 4 } })[id] };
  const view = (record, opts = { combats }) => describeBattle(record, { getEncounterMap: () => null, scenes: { get: () => undefined }, ...opts });
  assert.equal(view({ id: "b1", status: "live", combatId: "c1" }).combatEnded, false, "made and waiting");
  assert.equal(view({ id: "b1", status: "live", combatId: "c2" }).combatEnded, false, "running");
  assert.equal(view({ id: "b1", status: "live", combatId: "gone" }).combatEnded, true, "ended from the tracker or the crawl bar");
  assert.equal(view({ id: "b1", status: "staged", combatId: null }).combatEnded, false, "never made: staged");
  assert.equal(view({ id: "b1", status: "live" }).combatEnded, false, "no combat recorded");
  assert.equal(view({ id: "b1", status: "live", combatId: "c1" }, { combats: undefined }).combatEnded, false, "no way to know is not 'ended'");
});

test("the HUD loads the parts once; the readout may be missing, the battle may not", async () => {
  const BattleMaps = { current: () => null };
  const maps = { getEncounterMap: () => null };
  const ok = await loadBattleParts({ battle: async () => BattleMaps, maps: async () => maps, preload: async () => ({ preloadSnapshot: () => "snap", onPreloadChange: () => "off" }) });
  assert.equal(ok.BattleMaps, BattleMaps);
  assert.deepEqual([ok.preloadSnapshot(), ok.onPreloadChange()], ["snap", "off"]);
  const noReadout = await loadBattleParts({ battle: async () => BattleMaps, maps: async () => maps, preload: async () => { throw new Error("gone"); } });
  assert.deepEqual([noReadout.preloadSnapshot("s"), typeof noReadout.onPreloadChange(() => {})], [null, "function"]);
  const quiet = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loadBattleParts({ battle: async () => { throw new Error("gone"); }, maps: async () => maps, preload: async () => ({}) }), null);
  } finally {
    console.warn = quiet;
  }
});

test("where the party stands: Overland's hex and its token's scene while travelling, else the viewed map's", () => {
  const overland = game.shadowdarkEnhancer.overland;
  overland.isActive = () => true;
  overland.state = () => ({ hex: { num: 1203, terrain: "Salt Flat" }, tokenUuid: "Scene.hexes.Token.party" });
  globalThis.fromUuidSync = () => ({ parent: { id: "hexes" } });
  assert.deepEqual(partyContext(), { terrain: "salt_flat", hexNum: 1203, originSceneId: "hexes" });
  overland.state = () => ({ hex: { num: null, terrain: "forest" }, tokenUuid: null });
  assert.deepEqual(partyContext(), { terrain: "forest", hexNum: null, originSceneId: "viewed" }, "a map with no numbering has a terrain and no number");
  overland.state = () => { throw new Error("not ready"); };
  assert.deepEqual(partyContext(), { terrain: null, hexNum: null, originSceneId: "viewed" }, "Overland unreadable and no hex map in view: the picker asks");
  overland.isActive = () => false;
  assert.deepEqual(partyContext(), { terrain: null, hexNum: null, originSceneId: "viewed" }, "not travelling and not on a hex map");
});

// ─── The posted card ────────────────────────────────────────────────────────

test("a GM's creature card keeps what the Battle map button needs, and says to draw the button", async () => {
  const overland = game.shadowdarkEnhancer.overland;
  overland.isActive = () => true;
  overland.state = () => ({ hex: { num: 1203, terrain: "forest" }, tokenUuid: "Scene.hexes.Token.party" });
  globalThis.fromUuidSync = () => ({ parent: { id: "hexes" } });
  const posted = [];
  globalThis.ChatMessage = { create: async (data) => { posted.push(data); }, getWhisperRecipients: () => ["gm1"] };
  await postEncounter({ ...wolves, chaMod: 0, reactionTotal: 7 }, { gmOnly: false });
  const [card] = posted;
  assert.equal(JSON.parse(card.content).battleMap, true);
  assert.equal(JSON.parse(card.content).template, "modules/shadowdark-enhancer/templates/chat/encounter-result.hbs");
  assert.deepEqual(card.flags[MODULE_ID].encounterCard, {
    encounter: { kind: "monster", uuid: "Actor.wolf", name: "Wolf", count: 3, distanceRoll: 4 },
    terrain: "forest", hexNum: 1203, originSceneId: "hexes",
  });
  assert.deepEqual([card.whisper, card.user], [[], "gm1"], "who sees it is unchanged");
});

test("a point of interest, an empty draw and a player's post carry no battle button and no flags", async () => {
  const posted = [];
  globalThis.ChatMessage = { create: async (data) => { posted.push(data); }, getWhisperRecipients: () => ["gm1"] };
  await postEncounter({ kind: "flavor", text: "A ruined watchtower" }, { gmOnly: true });
  await postEncounter({ kind: "empty" }, { gmOnly: true });
  game.user.isGM = false;
  await postEncounter(wolves, { gmOnly: true });
  game.user.isGM = true;
  assert.equal(posted.length, 2, "an empty draw posts nothing");
  for (const card of posted) {
    assert.equal(JSON.parse(card.content).battleMap, false);
    assert.equal(card.flags, undefined);
  }
  assert.deepEqual(posted[0].whisper, ["gm1"]);
});

test("a creature with nothing to put on a map gets no button and no flags: every client would only take the button out", async () => {
  const posted = [];
  globalThis.ChatMessage = { create: async (data) => { posted.push(data); }, getWhisperRecipients: () => ["gm1"] };
  await postEncounter({ kind: "monster", name: "A shape in the dark", count: 1, uuid: null }, { gmOnly: false });
  await postEncounter({ kind: "monster", name: "A shape in the dark", count: 1 }, { gmOnly: false });
  assert.equal(posted.length, 2, "the card itself still posts");
  for (const card of posted) {
    assert.equal(JSON.parse(card.content).template, "modules/shadowdark-enhancer/templates/chat/encounter-result.hbs");
    assert.equal(JSON.parse(card.content).battleMap, false);
    assert.equal(card.flags, undefined);
  }
});

/** A button as the chat card renders it, with just what the wiring uses. */
function buttonOn() {
  const button = { disabled: false, removed: false, click: null, closest: () => null };
  button.addEventListener = (name, fn) => { if (name === "click") button.click = fn; };
  button.remove = () => { button.removed = true; };
  return button;
}
const cardHtml = (...buttons) => ({ querySelectorAll: (selector) => (selector === "[data-sde-battle-map]" ? buttons : []) });
const stashed = { flags: { [MODULE_ID]: { encounterCard: cardStash({ res: wolves, terrain: "forest", hexNum: 1203, originSceneId: "hexes" }) } } };

test("on a GM's client the card's button sets the battle up from what the card kept, and a double click is one", async () => {
  const { calls, io } = fakes();
  let release;
  const battle = await io.battle();
  battle.setUp = (args) => new Promise((resolve) => { calls.push(["setUp", args]); release = resolve; });
  const button = buttonOn();
  wireBattleCard(stashed, cardHtml(button), io);
  assert.equal(button.removed, false);
  const event = { preventDefault() {} };
  const first = button.click(event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(button.disabled, true, "busy while the scene is set up");
  await button.click(event);
  assert.equal(calls.filter((c) => c[0] === "setUp").length, 1, "the second click found it busy");
  release({ ok: true });
  await first;
  assert.equal(button.disabled, false);
  const sent = calls.find((c) => c[0] === "setUp")[1];
  assert.deepEqual([sent.terrain, sent.hex, sent.originSceneId, sent.encounter.uuid], ["forest", 1203, "hexes", "Actor.wolf"]);
});

test("everywhere else the card's button is taken out: a player's client, an older card, a card with no creature", () => {
  const players = buttonOn();
  game.user.isGM = false;
  wireBattleCard(stashed, cardHtml(players));
  game.user.isGM = true;
  const old = buttonOn();
  wireBattleCard({ flags: {} }, cardHtml(old));
  const empty = buttonOn();
  wireBattleCard({ flags: { [MODULE_ID]: { encounterCard: { encounter: { kind: "monster" } } } } }, cardHtml(empty));
  assert.deepEqual([players.removed, old.removed, empty.removed], [true, true, true]);
  assert.ok([players, old, empty].every((b) => b.click === null), "no listener on a button that is gone");
  const footed = buttonOn();
  const foot = { removed: false, remove() { this.removed = true; } };
  footed.closest = (selector) => (selector === ".cc-foot" ? foot : null);
  wireBattleCard({ flags: {} }, cardHtml(footed));
  assert.deepEqual([foot.removed, footed.removed], [true, false], "the empty footer goes with it");
  assert.doesNotThrow(() => wireBattleCard(stashed, { querySelectorAll: () => [] }), "a card with no button");
  assert.doesNotThrow(() => wireBattleCard(stashed, undefined));
});

test("the card hook is registered once", () => {
  const hooks = [];
  globalThis.Hooks = { on: (name, fn) => hooks.push([name, fn]) };
  registerBattleChatButtons();
  registerBattleChatButtons();
  assert.deepEqual(hooks.map((h) => h[0]), ["renderChatMessageHTML"]);
  const button = buttonOn();
  hooks[0][1](stashed, cardHtml(button));
  assert.equal(typeof button.click, "function", "the hook wires the card it is handed");
});

test("the chat template draws the button only for a GM's creature card, in the card's own footer, beside its old markup", () => {
  const hbs = readFileSync(new URL("../templates/chat/encounter-result.hbs", import.meta.url), "utf8");
  assert.match(hbs, /\{\{#if battleMap\}\}\s*<footer class="cc-foot">\s*<button type="button" class="ui-btn" data-sde-battle-map /);
  assert.ok(hbs.includes('localize "SDE.encounter.chat.heading"') && hbs.includes('<span class="cc-name">{{name}}</span>') && hbs.includes("{{reactionText}}"), "the card itself is as it was");
  assert.ok(!/data-action="[^"]*[bB]attle/.test(hbs), "its own marker, not a data-action the chat log might claim");
});

// ─── The readout's colours ──────────────────────────────────────────────────

/** WCAG contrast of two #rgb or #rrggbb colours. */
function contrast(a, b) {
  const luminance = (hex) => {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
    const n = Number.parseInt(full.slice(1), 16);
    const [r, g, bl] = [n >> 16, (n >> 8) & 0xff, n & 0xff].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the readout uses the HUD's own green, red and amber, and every word and the Ready button read at 4.5:1 on its black", () => {
  const css = readFileSync(new URL("../styles/shadowdark-enhancer.css", import.meta.url), "utf8");
  // Every custom property the rules for the HUD's wrapper declare: its status colours, and the book palette it borrows.
  const declared = Object.fromEntries([...css.matchAll(/#shadowdark-enhancer-travel\s*\{([^}]*)\}/g)]
    .flatMap((m) => [...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)].map((p) => [p[1], p[2]])));
  const { "sde-hud-ok": ok, "sde-hud-bad": bad, "sde-hud-warn": warn, "sd-page": page, "sd-text-muted": muted } = declared;
  assert.ok(ok && bad && warn && page && muted, "the HUD declares its own --sde-hud-ok, -bad and -warn beside its black page");
  // The bar's --sde-bar-hit and --sde-bar-miss turn darker under body.theme-light for a light page; this HUD is black in every theme.
  const rules = css.split("\n").filter((line) => /\.sde-hud-pr-|\.sde-hud-key\.sde-hud-ready/.test(line));
  assert.ok(rules.length >= 8, "the battle rules are there");
  for (const line of rules) assert.ok(!/--sde-bar-/.test(line), `not the bar's theme-dependent colour: ${line.trim()}`);
  assert.ok(rules.some((l) => /pr-ready \.sde-hud-cap/.test(l) && /var\(--sde-hud-ok\)/.test(l)));
  assert.ok(rules.some((l) => /pr-failed \.sde-hud-cap/.test(l) && /var\(--sde-hud-bad\)/.test(l)));
  assert.ok(rules.some((l) => /pr-stalled \.sde-hud-cap/.test(l) && /var\(--sde-hud-warn\)/.test(l)));
  assert.ok(rules.some((l) => /\.sde-hud-key\.sde-hud-ready \{/.test(l) && /background: var\(--sde-hud-ok\)/.test(l) && /color: var\(--sd-page\)/.test(l)));
  assert.ok(!rules.some((l) => /pr-waiting/.test(l) && /opacity/.test(l)), "the waiting word is not dimmed below the muted ink it already is");
  for (const [name, ink] of [["ready", ok], ["failed", bad], ["stalled", warn], ["waiting", muted]]) {
    assert.ok(contrast(ink, page) >= 4.5, `${name}: ${ink} on ${page} is ${contrast(ink, page).toFixed(2)}:1`);
  }
  assert.ok(contrast(page, ok) >= 4.5, `the Ready button's label (${page}) on its green (${ok}) is ${contrast(page, ok).toFixed(2)}:1`);
});
