// The clock HUD's Encounter panel (#257): a quiet travel check's hit as the GM
// sees it. The encounter here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";

import { gregorian } from "./gregorian-calendar.mjs";

globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` } };
const { encounterPanel, encounterCard, encounterStrip } = await import("../scripts/overland/encounter-panel.mjs");

const wolves = {
  at: 36000, half: "day", chance: 1, kind: "monster", poi: false, uuid: "Actor.wolf", name: "Wolf", img: "wolf.webp",
  text: null, via: "Beast: rolled on Sablewood Beasts", count: 3, countFormula: "1d6",
  distanceRoll: 1, activityRoll: 12, reactionRoll: 2,
  chain: [{ name: "Sablewood Encounter Zone: Forest", formula: "1d8", roll: 5 }, { category: "Beast" }, { name: "Sablewood Beasts", formula: "1d12", roll: 7 }],
  also: [{ name: "Sablewood Horrors", formula: "1d8", roll: 2, text: "A lone ghoul" }],
};

test("a creature: the check, the chain of tables, how many, and the facets in words", () => {
  const html = encounterPanel({ enc: wolves, cal: gregorian });
  assert.ok(html.includes('SDE.clock.enc.header{&quot;step&quot;:6'), "step 6 for a day check");
  assert.ok(html.includes("Sablewood Encounter Zone: Forest\u00a0· 1d8\u00a0") && html.includes("Beast") && html.includes("Sablewood Beasts\u00a0· 1d12"));
  assert.ok(html.includes(">Wolf<") && html.includes('<span class="sde-hud-gold">3</span>'));
  assert.ok(html.includes("SDE.encounter.distance.close") && html.includes("SDE.encounter.activity.sleeping"));
  // Double 1s on the reaction: hostile, and said so.
  assert.ok(html.includes("sde-reaction-Hostile") && html.includes("SDE.encounter.reaction.hostile") && html.includes("SDE.encounter.chat.doubleOnes"));
  assert.ok(html.includes("SDE.clock.enc.also") && html.includes('data-action="postEncounter"') && html.includes('data-action="resume"'));
});

test("the card posted is the chat card's: facets at CHA +0", () => {
  const card = encounterCard({ ...wolves, reactionRoll: 10 });
  assert.deepEqual([card.chaMod, card.reactionTotal, card.reactionBand, card.reactionDoubleOnes], [0, 10, "Curious", false]);
  assert.equal(card.distanceText, "SDE.encounter.distance.close");
});

test("a point of interest shows its text; a night check is step 8; an empty draw offers only Continue", () => {
  const poi = encounterPanel({ enc: { ...wolves, half: "night", kind: "flavor", poi: true, text: "A ruined watchtower", chain: [], also: [] }, cal: gregorian });
  assert.ok(poi.includes("step&quot;:8") && poi.includes("SDE.clock.enc.poi") && poi.includes("A ruined watchtower"));
  assert.ok(!poi.includes("sde-hud-facets"));
  const empty = encounterPanel({ enc: { ...wolves, kind: "empty", chain: [], also: [] }, cal: gregorian });
  assert.ok(empty.includes("SDE.clock.enc.empty") && !empty.includes('data-action="postEncounter"') && empty.includes('data-action="resume"'));
  assert.ok(empty.includes('data-action="openRoller"'), "the roller, to roll by hand");
  const none = encounterPanel({ enc: { ...wolves, kind: "empty", noTable: true, chain: [], also: [] }, cal: gregorian });
  assert.ok(none.includes("SDE.clock.enc.noTable"));
});

/** The chevron that toggles the panel: the HUD's own "open" of the encounter. */
const chevron = (html) => html.match(/<button[^>]*data-action="open" data-id="encounter"[^>]*>.*?<\/button>/)?.[0] ?? "";

test("the panel's header folds it: a chevron that closes the panel (#257)", () => {
  const fold = chevron(encounterPanel({ enc: wolves, cal: gregorian }));
  assert.ok(fold.includes('aria-expanded="true"') && fold.includes("fa-chevron-up") && fold.includes("SDE.clock.enc.fold"));
});

test("folded, the strip: Encounter, the check's hour, how many and what; the chevron back and Continue (#257)", () => {
  const html = encounterStrip({ enc: wolves, cal: gregorian });
  assert.ok(html.startsWith('<div class="sde-hud-strip">'));
  assert.ok(html.includes(">SDE.encounter.chat.heading<"), "Encounter");
  assert.ok(html.includes("10:00 · <b>3</b> Wolf"), "the check's hour, then 3 Wolf");
  const unfold = chevron(html);
  assert.ok(unfold.includes('aria-expanded="false"') && unfold.includes("fa-chevron-down") && unfold.includes("SDE.clock.enc.unfold"));
  assert.ok(/class="sde-hud-key sde-hud-sm" data-action="resume"/.test(html), "a small Continue");
  assert.ok(!html.includes('data-action="postEncounter"'), "the rest stays in the panel");

  // A point of interest's text is shortened, whole in the tooltip; an empty draw says so.
  const text = "A ruined watchtower leans over the road, its door long gone and a cold hearth inside";
  const poi = encounterStrip({ enc: { ...wolves, kind: "flavor", count: null, text }, cal: gregorian });
  assert.ok(poi.includes("10:00 · A ruined watchtower leans over the road, its…"), "cut at a word");
  assert.ok(poi.includes(`data-tooltip="${text}"`));
  assert.ok(encounterStrip({ enc: { ...wolves, kind: "empty", noTable: true }, cal: gregorian }).includes("SDE.clock.enc.stripNoTable"));
  assert.ok(encounterStrip({ enc: { ...wolves, kind: "empty" }, cal: gregorian }).includes("SDE.clock.enc.stripEmpty"));
  assert.ok(encounterStrip({ enc: { ...wolves, count: null }, cal: gregorian }).includes("10:00 · Wolf"), "no count: the name alone");
});

// ─── The battle map (docs/plans/encounter-battle-maps.md) ───────────────────

const { battlePanel, battleSection } = await import("../scripts/overland/encounter-panel.mjs");

/** A battle as describeBattle hands it over, and a preload snapshot as preloadSnapshot does. */
const battle = (over = {}) => ({ id: "b1", status: "staged", sceneId: "s1", mapId: "forest-woods", label: "Forest Woods", combat: null, ...over });
const row = (name, state, pct = 0, loaded = 0, total = 0) => ({ userId: name, name, state, loaded, total, failed: 0, pct });
const snapshot = (...rows) => ({
  sceneId: "s1", rows, ready: rows.filter((r) => r.state === "ready").length, expected: rows.length,
  allReady: rows.length > 0 && rows.every((r) => r.state === "ready"), startedAt: 0,
});
/** The data-action names of every button in some markup, in order. */
const actions = (html) => [...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1]);

test("before a battle is set up, a creature offers Battle map and Choose map beside Post to chat", () => {
  const html = encounterPanel({ enc: wolves, cal: gregorian });
  assert.deepEqual(actions(html).filter((a) => a !== "open"), ["postEncounter", "battleMap", "chooseBattleMap", "openRoller", "resume"]);
  assert.ok(!html.includes("sde-hud-battle"), "no section until there is a battle");
});

test("only a creature gets battle buttons: a point of interest, an empty draw, or the maps unavailable get none", () => {
  const flavor = { ...wolves, kind: "flavor", poi: true, text: "A ruined watchtower", chain: [], also: [] };
  const empty = { ...wolves, kind: "empty", chain: [], also: [] };
  for (const enc of [flavor, empty]) {
    for (const withBattle of [null, battle()]) {
      const html = encounterPanel({ enc, cal: gregorian, battle: withBattle, preload: snapshot(row("Ann", "ready")) });
      assert.ok(!/data-action="(battleMap|chooseBattleMap|bringTable|changeBattleMap|returnToTravel)"/.test(html) && !html.includes("sde-hud-battle"), enc.kind);
    }
  }
  const off = encounterPanel({ enc: wolves, cal: gregorian, battleMaps: false, battle: battle() });
  assert.ok(!off.includes("sde-hud-battle") && !off.includes('data-action="battleMap"'), "the maps could not be loaded");
});

test("staged, not everyone ready: the map, a row each with its state and bar, and Bring the table says how many", () => {
  const preload = snapshot(row("Ann", "ready", 1, 40, 40), row("Bob", "loading", 0.5, 12, 40), row("Cy", "waiting"), row("Di", "failed", 1, 40, 40));
  const html = encounterPanel({ enc: wolves, cal: gregorian, battle: battle(), preload });
  assert.ok(html.includes('data-status="staged"') && html.includes('SDE.encounterMaps.hud.mapLine{&quot;name&quot;:&quot;Forest Woods&quot;}'));
  assert.ok(html.includes(">Ann<") && html.includes("sde-hud-pr-ready") && html.includes("sde-hud-pr-loading") && html.includes("sde-hud-pr-waiting") && html.includes("sde-hud-pr-failed"));
  assert.ok(html.includes('SDE.encounterMaps.preload.row.loading{&quot;loaded&quot;:12,&quot;total&quot;:40}'), "n of N while loading");
  assert.ok(html.includes('<span style="width:50%">') && html.includes('<span style="width:100%">') && html.includes('<span style="width:0%">'), "the bars");
  const bring = html.match(/<button[^>]*data-action="bringTable"[^>]*>.*?<\/button>/)?.[0] ?? "";
  assert.ok(bring.includes('SDE.encounterMaps.preload.readyLabel{&quot;ready&quot;:1,&quot;expected&quot;:4}'), "Ready 1/4");
  assert.ok(!bring.includes("sde-hud-ready"), "not green yet");
  assert.ok(html.includes("SDE.encounterMaps.preload.summary.pending") && html.includes("Bob, Cy, Di"), "who is being waited on, failed included");
  assert.deepEqual(actions(html).filter((a) => a !== "open"),
    ["bringTable", "changeBattleMap", "keepBattle", "returnToTravel", "postEncounter", "openRoller", "resume"], "the section sits above the footer");
  assert.ok(!html.includes('data-action="battleMap"') && !html.includes('data-action="chooseBattleMap"'), "one battle at a time");
});

test("staged, everyone ready: Bring the table turns green and the summary says so", () => {
  const green = encounterPanel({ enc: wolves, cal: gregorian, battle: battle(), preload: snapshot(row("Ann", "ready", 1), row("Bob", "ready", 1)) });
  assert.ok(/<button[^>]*sde-hud-ready[^>]*data-action="bringTable"/.test(green) && green.includes('{&quot;ready&quot;:2,&quot;expected&quot;:2}'));
  assert.ok(green.includes("SDE.encounterMaps.preload.summary.allReady"));
});

test("staged with no readout, or nobody to wait for: Bring the table is plain, no badge, nothing to confirm", () => {
  const off = encounterPanel({ enc: wolves, cal: gregorian, battle: battle(), preload: null });
  assert.ok(!off.includes("sde-hud-readout"), "the preload is off: no rows, no summary");
  const alone = encounterPanel({ enc: wolves, cal: gregorian, battle: battle(), preload: snapshot() });
  assert.ok(alone.includes("SDE.encounterMaps.preload.summary.nobody") && !alone.includes("sde-hud-pr "), "no players connected, and it says so");
  for (const plain of [off, alone]) {
    const bring = plain.match(/<button[^>]*data-action="bringTable"[^>]*>.*?<\/button>/)?.[0] ?? "";
    assert.ok(bring && !bring.includes("sde-hud-badge") && !bring.includes("sde-hud-ready"));
  }
});

test("a player who has left reads as left, with no bar, and is neither counted nor waited on", () => {
  const rows = [row("Ann", "ready", 1), row("Bob", "left", 0.6, 24, 40), row("Cy", "loading", 0.5, 2, 4)];
  const preload = { sceneId: "s1", rows, ready: 1, expected: 2, allReady: false, startedAt: 0 };   // as the ledger counts it: Bob is not expected
  const html = encounterPanel({ enc: wolves, cal: gregorian, battle: battle(), preload });
  assert.ok(html.includes("sde-hud-pr-left") && html.includes(">SDE.encounterMaps.preload.state.left<"), "worded by the ledger's own word for it");
  const bobsRow = html.match(/<div class="sde-hud-pr sde-hud-pr-left">.*?<\/div>/)?.[0] ?? "";
  assert.ok(bobsRow.includes('<span style="width:0%">'), "the progress he made is not drawn");
  assert.ok(html.includes('SDE.encounterMaps.preload.readyLabel{&quot;ready&quot;:1,&quot;expected&quot;:2}'), "Ready 1/2, not 1/3");
  assert.ok(html.includes("Cy") && !/Waiting on[^<]*Bob|summary\.pending[^<]*Bob/.test(html), "the summary does not wait on him");
  const everyoneHere = { ...preload, rows: [row("Ann", "ready", 1), row("Bob", "left", 0.6), row("Cy", "ready", 1)], ready: 2, expected: 2, allReady: true };
  const done = encounterPanel({ enc: wolves, cal: gregorian, battle: battle(), preload: everyoneHere });
  assert.ok(/sde-hud-ready[^>]*data-action="bringTable"/.test(done) && done.includes("summary.allReady"), "everyone still here is ready: green");
});

test("a player who has gone quiet reads as stalled, with where they got to", () => {
  const html = encounterPanel({ enc: wolves, cal: gregorian, battle: battle(), preload: snapshot(row("Ann", "stalled", 0.3, 3, 10), row("Bob", "stalled", 0, 0, 0)) });
  assert.ok(html.includes("sde-hud-pr-stalled") && html.includes('SDE.encounterMaps.preload.row.stalled{&quot;loaded&quot;:3,&quot;total&quot;:10}'));
  assert.ok(html.includes(">SDE.encounterMaps.preload.state.stalled<"), "with no totals yet, just the word");
});

test("live: the one-line status, Return to travel with Keep this battle, and nothing to bring or change", () => {
  const html = encounterPanel({ enc: wolves, cal: gregorian, battle: battle({ status: "live" }), preload: snapshot(row("Ann", "ready", 1)) });
  assert.ok(html.includes('data-status="live"') && html.includes("SDE.encounterMaps.hud.live{&quot;name&quot;:&quot;Forest Woods&quot;}"));
  assert.ok(!html.includes('data-action="bringTable"') && !html.includes('data-action="changeBattleMap"') && !html.includes("sde-hud-readout"));
  assert.ok(html.includes('data-action="returnToTravel"') && html.includes('type="checkbox" data-action="keepBattle">'), "unticked");
  assert.ok(encounterPanel({ enc: wolves, cal: gregorian, battle: battle({ status: "live" }), keep: true }).includes('data-action="keepBattle" checked>'), "kept across the bar's redraws");
  const round = encounterPanel({ enc: wolves, cal: gregorian, battle: battle({ status: "live", combat: { started: true, round: 3 } }) });
  assert.ok(round.includes("SDE.encounterMaps.hud.liveRound{&quot;name&quot;:&quot;Forest Woods&quot;,&quot;round&quot;:3}"));
});

test("live with its combat ended from the tracker: the line says it is over, not that it waits to be started", () => {
  const ended = encounterPanel({ enc: wolves, cal: gregorian, battle: battle({ status: "live", combatEnded: true }) });
  assert.ok(ended.includes("SDE.encounterMaps.hud.liveEnded{&quot;name&quot;:&quot;Forest Woods&quot;}"));
  assert.ok(!ended.includes("SDE.encounterMaps.hud.live{") && !ended.includes("hud.liveRound"));
  assert.ok(ended.includes('data-action="returnToTravel"'), "Return to travel is still the way out");
  const waiting = encounterPanel({ enc: wolves, cal: gregorian, battle: battle({ status: "live", combatEnded: false, combat: { started: false, round: 0 } }) });
  assert.ok(waiting.includes("SDE.encounterMaps.hud.live{") && !waiting.includes("liveEnded"), "made and waiting reads as before");
  assert.ok(battlePanel({ battle: battle({ status: "live", combatEnded: true }) }).includes("hud.liveEnded"), "the battle's own panel says it too");
});

test("a player's name and a scene's name are text, never markup; a state the ledger does not know reads as waiting", () => {
  const hostile = battle({ label: "<img src=x onerror=boom()>" });
  const html = encounterPanel({ enc: wolves, cal: gregorian, battle: hostile, preload: snapshot(row("<b>Ann</b>", "ready", 1), row("Bob", "unheard-of", 0)) });
  assert.ok(!html.includes("<img src=x") && !html.includes("<b>Ann</b>"));
  assert.ok(html.includes("&lt;b&gt;Ann&lt;/b&gt;") && html.includes("&lt;img src=x onerror=boom()&gt;"));
  assert.ok(html.includes("sde-hud-pr-waiting"));
});

test("the battle's own panel is the same section, titled, for where the clock is hidden", () => {
  const html = battlePanel({ battle: battle(), preload: snapshot(row("Ann", "loading", 0.25, 5, 20)) });
  assert.ok(html.startsWith('<div class="sde-hud-panel sde-hud-battle-panel">'));
  assert.ok(html.includes("SDE.encounterMaps.hud.panel") && html.includes("SDE.encounterMaps.hud.status.staged"));
  assert.deepEqual(actions(html), ["bringTable", "changeBattleMap", "keepBattle", "returnToTravel"]);
  assert.equal(battleSection({ battle: battle({ status: "live" }) }).includes("sde-hud-brow"), true);
  assert.ok(battlePanel({ battle: battle({ status: "live" }) }).includes("SDE.encounterMaps.hud.status.live"));
});

test("folded, the strip carries a small Battle marker while a battle runs", () => {
  assert.ok(!encounterStrip({ enc: wolves, cal: gregorian }).includes("sde-hud-tag"));
  const html = encounterStrip({ enc: wolves, cal: gregorian, battle: battle() });
  assert.ok(html.includes('<span class="sde-hud-tag">SDE.encounterMaps.hud.marker</span>'));
  assert.ok(/class="sde-hud-key sde-hud-sm" data-action="resume"/.test(html), "Continue is still there");
});
