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
