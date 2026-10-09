/**
 * The manual, the changelog and the API notes against what the code does.
 *
 * Each claim here was once wrong, or is one a reviewer checked against the code:
 * that Change map works only until the table is brought, where Choose map… is,
 * what the readout can say, what Keep this battle does on a scene the GM brought,
 * and the order Return to travel works in. Prose cannot be proved, so the test
 * holds two things: the page says the right thing and not the old thing, and the
 * code still has the shape the sentence depends on, so a change to the code that
 * would make the sentence false fails here and not in a player's session.
 *
 * Other parts' files are read as text, never imported, so this passes whatever
 * state they are in.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Prose with its line breaks and runs of spaces made one space, so a sentence wrapped in the source still matches. */
const flat = (text) => text.replace(/\s+/g, " ");

const wiki = flat(read("docs/wiki/Encounter-Battle-Maps.md"));
const api = flat(read("docs/API.md").match(/## `encounterMaps`[\s\S]*?\n## `loot`/)?.[0] ?? "");
const unreleased = read("CHANGELOG.md").split(/\n## \[/)[1] ?? "";
const entry = flat(unreleased.match(/- \*\*A battle map for a travel encounter, one click away\.\*\*[^\n]*/)?.[0] ?? "");

test("the pages are there to be read", () => {
  assert.ok(wiki.length > 1000, "the wiki page");
  assert.ok(api.length > 500, "the API section");
  assert.ok(entry.length > 500, "the changelog entry");
});

describe("Change map", () => {
  test("is offered until the table is brought, and the pages say so, not 'until the combat starts'", () => {
    assert.match(wiki, /Until you bring the table, \*\*Change map…\*\*/);
    assert.match(entry, /\*\*Change map…\*\* moves the tokens to another map until you bring the table/);
    for (const prose of [wiki, entry]) assert.doesNotMatch(prose, /until the (combat|fight) starts/i);
  });

  test("the panel does offer it only while the battle is staged, and the battle refuses it after", () => {
    assert.match(read("scripts/encounter/battle-maps/battle-actions-core.mjs"), /change: staged\b/);
    assert.match(read("scripts/encounter/battle-maps/encounter-battle.mjs"), /status !== BATTLE_STATUS\.staged\) \{ notify\("warn", "SDE\.encounterMaps\.notify\.notStaged"\)/);
  });
});

describe("where Choose map… is", () => {
  test("the Encounter panel has it beside Battle map; the posted card has Battle map only", () => {
    assert.match(wiki, /the \*\*Encounter\*\* panel that drops from the clock bar[\s\S]*?\*\*Choose map…\*\* sits beside it/);
    assert.match(wiki, /The card has \*\*Battle map\*\* only/);
    assert.match(entry, /Encounter panel\) gets a GM-only \*\*Battle map\*\* button with \*\*Choose map…\*\* beside it, and its posted chat card gets a \*\*Battle map\*\* button/);
    assert.doesNotMatch(entry, /chat card get a GM-only \*\*Battle map\*\* button, with \*\*Choose map…\*\*/);
  });

  test("the card's template carries Battle map and not Choose map…, and the panel carries both", () => {
    const card = read("templates/chat/encounter-result.hbs");
    assert.match(card, /data-sde-battle-map/);
    assert.doesNotMatch(card, /chooseMap|chooseBattleMap|Choose map/);
    const panel = read("scripts/overland/encounter-panel.mjs");
    assert.match(panel, /key\("battleMap"/);
    assert.match(panel, /key\("chooseBattleMap"/);
  });
});

describe("the preload readout", () => {
  test("the wiki names every state a row can be in, and what happens to a player who leaves or joins", () => {
    for (const word of ["Waiting", "Loading", "Ready", "Failed", "Stalled"]) assert.match(wiki, new RegExp(`\\b${word}\\b`), word);
    assert.match(wiki, /Stalled when a player's loading has made no progress for a minute and a half/);
    assert.match(wiki, /A player who leaves is not counted, and a player who joins while the art is loading is asked to load it too/);
    assert.match(entry, /a player who leaves is not waited on, and one who joins is asked to load/);
  });

  test("the readout has those states, and the stall is the 90 seconds the page says", () => {
    const core = read("scripts/encounter/battle-maps/encounter-preload-core.mjs");
    const states = core.match(/PRELOAD_STATE_KEYS = \{([^}]*)\}/)?.[1] ?? "";
    for (const state of ["waiting", "loading", "ready", "failed", "stalled"]) assert.match(states, new RegExp(`\\b${state}:`), state);
    assert.match(core, /DEFAULT_STALL_MS = 90000/);
    assert.match(core, /const join = /);
    assert.match(core, /const leave = /);
  });
});

describe("Keep this battle", () => {
  test("on a scene the GM brought nothing is copied and the tokens stay, in the manual and the changelog", () => {
    assert.match(wiki, /On a scene you brought yourself \(one from your world, not a map from the module\) nothing is copied\. Its tokens stay on it where they are, and the combat still ends/);
    assert.match(entry, /on a scene you brought yourself nothing is copied and its tokens stay where they are/);
    assert.match(api, /a scene from the world is not copied and keeps its tokens/);
  });

  test("a copy that cannot be made takes nothing down, in the manual and the API notes", () => {
    assert.match(wiki, /If the copy cannot be made, nothing is taken down and you are told/);
    assert.match(api, /nothing is taken down if the copy fails/);
  });

  test("the battle does leave a world scene's tokens alone, and does stop when a copy fails", () => {
    const code = read("scripts/encounter/battle-maps/encounter-battle.mjs");
    assert.match(code, /takeTokens: !\(keep && !library\)/);
    assert.match(code, /if \(!saved\) \{ notify\("warn", "SDE\.encounterMaps\.notify\.keepFailed"\); return null; \}/);
  });
});

describe("Return to travel and Set up", () => {
  test("the combat ends first, then the tokens, and a stop keeps the battle so Return can be pressed again", () => {
    assert.match(wiki, /It ends this battle's combat first, then takes down the tokens this battle placed/);
    assert.match(wiki, /If the combat cannot be ended, or some of the tokens cannot be taken down, it stops there, tells you, and keeps the battle/);
    assert.match(wiki, /so you can press \*\*Return to travel\*\* again/);
    assert.match(entry, /it ends the battle's combat and then takes down only the tokens the battle placed \(if the combat cannot be ended, or some tokens cannot be taken down, it stops and keeps the battle, so you press it again\)/);
    assert.match(api, /If the combat cannot be ended, or some tokens cannot be taken down, it stops and keeps the battle, so the call can be made again/);
  });

  test("the battle does end the combat before it touches a token, and stops when either will not go", () => {
    const code = read("scripts/encounter/battle-maps/encounter-battle.mjs");
    const finish = code.slice(code.indexOf("async function finishReturn("));
    const combat = finish.indexOf("combat.delete()");
    const tokens = finish.indexOf("removeTokens(scene, tokensToRemove(battle");
    assert.ok(combat > 0 && tokens > combat, "the combat is deleted before the tokens");
    assert.match(finish, /notify\("error", "SDE\.encounterMaps\.notify\.combatStays"\);\s*return null;/);
    assert.match(finish, /await keepStuck\(scene, battle, stuck, \{ combatId: null \}\);\s*return null;/);
  });

  test("a map holds one battle at a time, and a second set-up opens the one there is", () => {
    assert.match(wiki, /A map holds one battle at a time\. Setting up on a map that already has a battle tells you so, opens that battle again and places nothing more/);
    assert.match(entry, /setting up on a map that has one gives you that battle back/);
    const code = read("scripts/encounter/battle-maps/encounter-battle.mjs");
    assert.match(code, /existing: true/);
    assert.match(code, /notify\("warn", "SDE\.encounterMaps\.notify\.alreadyThere"/);
  });

  test("a character already on the map keeps their token, which is put in the combat and not taken down", () => {
    assert.match(wiki, /A character who already has a token on the map keeps it: it joins the combat and is not taken down when you return/);
    const code = read("scripts/encounter/battle-maps/encounter-battle.mjs");
    assert.match(code, /presentTokenIds/);
  });
});

describe("what a macro is told", () => {
  test("open() says the picker opens when the terrain is unknown or every map for it is off, and that one battle runs at a time", () => {
    assert.match(api, /the picker opens anyway when (\/\/ )?the terrain is unknown or every map for it is switched off/);
    assert.match(api, /one battle runs at a time/);
    assert.match(read("scripts/encounter/battle-maps/battle-actions-core.mjs"), /needsPick = .*!terrain \|\| !hasDefault/);
  });
});

describe("the words", () => {
  const mine = Object.entries(JSON.parse(read("languages/en.json")))
    .filter(([key]) => key.startsWith("SDE.encounterMaps.picker.") || key.startsWith("SDE.settings.encounterMapPreload."));

  test("no emoji in the manual, the changelog entry, the API notes or the picker's strings", () => {
    const pictograph = /\p{Extended_Pictographic}/u;
    assert.doesNotMatch(wiki, pictograph);
    assert.doesNotMatch(entry, pictograph);
    assert.doesNotMatch(api, pictograph);
    assert.deepEqual(mine.filter(([, text]) => pictograph.test(text)).map(([key]) => key), []);
    assert.ok(mine.length > 50, `${mine.length} strings checked`);
  });
});
