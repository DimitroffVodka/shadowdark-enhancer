// The rumor generator's rules (#190), and the Session Recap's rumors section.
// Table rows here are invented.
import test from "node:test";
import assert from "node:assert/strict";

import {
  rumorTableRegion, isRumorTable, planDraws, pickRows, rowsLeft, plainRow, troubleRumorText,
  heardList, ledgerHtml, questName,
} from "../scripts/rumors/rumor-core.mjs";

const f = (k, d) => k + JSON.stringify(d ?? {});
globalThis.game = { i18n: { localize: (k) => k, format: f } };
const { DEFAULT_DATA, formatForDiscordFromData } = await import("../scripts/session-recap/session-recap-core.mjs");

test("rumor tables: the general one, a region's, with or without the book's prefix", () => {
  assert.equal(rumorTableRegion("Sablewood Rumors"), "Sablewood");
  assert.equal(rumorTableRegion("Western Reaches GM Guide - The Last Sea Rumors"), "The Last Sea");
  assert.equal(rumorTableRegion("Rumors in the Reaches"), null);
  assert.equal(isRumorTable("Western Reaches GM Guide - Rumors in the Reaches"), true);
  assert.equal(isRumorTable("Rumors"), false, "a bare Rumors table names no region");
  assert.equal(isRumorTable("The Lost Citadel: Rumors"), false, "a site's table");
  assert.equal(isRumorTable("Sablewood Encounters: Beast"), false);
});

test("N rumors alternate between the region's table and the general one, the region's first", () => {
  assert.deepEqual(planDraws(3, { regional: 5, general: 5 }), ["regional", "general", "regional"]);
  assert.deepEqual(planDraws(4, { regional: 1, general: 5 }), ["regional", "general", "general", "general"], "the region's ran out");
  assert.deepEqual(planDraws(2, { regional: 0, general: 5 }), ["general", "general"], "no regional table");
  assert.deepEqual(planDraws(5, { regional: 1, general: 1 }), ["regional", "general"], "both ran out: fewer");
  assert.deepEqual(planDraws(0, { regional: 5, general: 5 }), []);
});

test("rows are picked without repeats, weighted by the faces they cover", () => {
  const rows = [{ id: "a", range: [1, 1] }, { id: "b", range: [2, 10] }];
  assert.deepEqual(pickRows(rows, 1, () => 0.05).map((r) => r.id), ["a"], "0.05 of 10 faces lands on face 1");
  assert.deepEqual(pickRows(rows, 1, () => 0.5).map((r) => r.id), ["b"]);
  assert.deepEqual(pickRows(rows, 5, () => 0.5).map((r) => r.id).sort(), ["a", "b"], "never more than there are");
  assert.deepEqual(pickRows([], 2), []);
});

test("rows left: drawn rows are out, and a re-import's new rows already given stay out", () => {
  const results = [
    { id: "n1", range: [1, 1], drawn: false }, { id: "n2", range: [2, 2], drawn: false }, { id: "n3", range: [3, 3], drawn: true },
  ];
  const given = [{ resultId: "old2", range: [2, 2] }, { resultId: "n3", range: [3, 3] }];
  const { available, stale } = rowsLeft(results, given);
  assert.deepEqual(available.map((r) => r.id), ["n1"]);
  assert.deepEqual(stale.map((r) => r.id), ["n2"], "row 2 was given before the re-import");
});

test("a row's links and markup become plain text", () => {
  assert.equal(plainRow("<p>A @UUID[Actor.x]{wyvern} nests near @Compendium[p.y]{the falls}.</p>"), "A wyvern nests near the falls.");
});

test("a trouble as a rumor: plain text with its type, detail and current symptoms", () => {
  const text = troubleRumorText({
    settlement: { name: "Oakmere" }, region: "Sablewood", type: "Omen", detail: "Red sky", stage: "days", symptoms: { days: "Whispers" },
  }, f);
  assert.equal(text, 'SDE.rumors.troubleText{"settlement":"Oakmere","region":"Sablewood","what":"SDE.troubles.typeDetail{\\"type\\":\\"Omen\\",\\"detail\\":\\"Red sky\\"}","symptoms":"Whispers"}');
});

test("heard: newest first, one region's or the general page's, and [] for anything malformed", () => {
  const pages = [
    { region: null, rumors: [{ text: "g", real: 2, worldTime: 50, heardBy: ["A"] }] },
    { region: "Sablewood", rumors: [{ text: "s1", region: "Sablewood", real: 1 }, { text: "s2", region: "Sablewood", real: 3, worldTime: null }] },
  ];
  assert.deepEqual(heardList(pages).map((r) => r.text), ["s2", "g", "s1"]);
  assert.deepEqual(heardList(pages, { region: "sablewood", sameRegion: (a, b) => a.toLowerCase() === b.toLowerCase() }).map((r) => r.text), ["s2", "s1"]);
  assert.deepEqual(heardList(pages, { region: null }).map((r) => r.text), ["g"]);
  assert.deepEqual(heardList(pages)[1], { text: "g", region: null, heardAt: { world: 50, real: 2 }, heardBy: ["A"] });
  assert.equal(heardList(pages)[0].heardAt.world, null);
  assert.deepEqual(heardList(null), []);
  assert.deepEqual(heardList([{ rumors: "x" }, null]), []);
});

test("the ledger page: newest first, escaped, each row tagged with its id, and the GM's note", () => {
  const html = ledgerHtml([
    { id: "r1", text: "old <b>", real: 1, gameTime: "Monday", heardBy: [] },
    { id: "r2", text: "new", real: 2, gameTime: null, heardBy: ["Aria", "Bram"] },
  ], f, (ms) => `day${ms}`, (names) => names.join(" and "));
  assert.ok(html.indexOf('data-sde-rumor="r2"') < html.indexOf('data-sde-rumor="r1"'));
  assert.ok(html.includes("old &lt;b&gt;"));
  assert.ok(html.includes('<section class="secret">'));
  assert.ok(html.includes('SDE.rumors.ledger.when{&quot;game&quot;:&quot;Monday&quot;,&quot;real&quot;:&quot;day1&quot;}'));
  assert.ok(html.includes("SDE.rumors.ledger.meta{&quot;when&quot;:&quot;day2&quot;,&quot;names&quot;:&quot;Aria and Bram&quot;}"));
});

test("a quest name from a long rumor stops at a word", () => {
  assert.equal(questName("Short one.", f), "Short one.");
  const long = "The miller of Oakmere swears the millpond sings at night, and three children have gone missing since";
  assert.equal(questName(long, f), 'SDE.rumors.questName{"start":"The miller of Oakmere swears the millpond sings at night"}');
});

test("the Session Recap lists the rumors heard, and a recap from before them still exports", () => {
  const md = formatForDiscordFromData({ ...structuredClone(DEFAULT_DATA), rumors: [{ text: "g" }, { text: "s", region: "Sablewood" }] }, 0, 1000);
  assert.ok(md.includes("## SDE.sessionRecap.discord.rumors"));
  assert.ok(md.includes("- g\n"));
  assert.ok(md.includes('- SDE.sessionRecap.discord.rumorIn{"text":"s","region":"Sablewood"}'));
  const legacy = structuredClone(DEFAULT_DATA);
  delete legacy.rumors;
  assert.doesNotThrow(() => formatForDiscordFromData(legacy, 0, 1000));
  assert.ok(Array.isArray(DEFAULT_DATA.rumors));
});
