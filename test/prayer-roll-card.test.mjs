/**
 * Prayer roll — ONE card for the draw + flavor, never two.
 *
 * Regression for issue #16: `rollPrayerTable()` used to draw with
 * `displayChat: true` (card 1 — the table's own native card) and then post a
 * second flavor card (card 2). With the draw silenced, the rewrite must post
 * exactly one card on EVERY path. The suite also pins the hardening: escaped
 * actor/deity interpolation (the card content is an HTMLField), `name ||
 * description` result reading (never `.text`, whose v15 deprecation shim is
 * removed on this Foundry version), the actor speaker, the attached draw roll
 * so Dice So Nice still animates, and the user's core roll mode.
 *
 * No book text: actor/table/result names are invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { rollPrayerTable } from "../scripts/character-sheet/prayer-roll.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The real strings, so this suite fails if the i18n keys drift. */
const en = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));

/** Minimal i18n.format: substitute {placeholders} from the template. */
function format(template, data = {}) {
  return template.replace(/\{(\w+)\}/g, (_m, k) => String(data[k] ?? ""));
}

const XSS = "<img src=x onerror=alert(1)>";

/**
 * Stub the Foundry surface `rollPrayerTable` touches, then call it. A plain
 * world table (no pack) draws directly; a compendium-backed table resolves
 * through `table.pack.getDocument` first (see the pack tests below).
 */
function harness({ drawResults = [], roll = null, rollMode = "roll" } = {}) {
  const cards = [];
  const draws = [];

  const tableDoc = {
    name: "Sol Prayers",
    async draw(opts) {
      draws.push(opts);
      return { roll, results: drawResults };
    },
  };

  globalThis.game = {
    i18n: { format: (key, data) => format(en[key], data) },
    settings: { get: (_ns, key) => (key === "rollMode" ? rollMode : undefined) },
  };

  globalThis.ChatMessage = {
    getSpeaker({ actor }) {
      return { actor: actor?.id, alias: actor?.name ?? "Game Master" };
    },
    applyRollMode(data, mode) {
      data.rollMode = mode;
    },
    async create(data) {
      cards.push(data);
      return data;
    },
  };

  return { cards, draws, tableDoc };
}

const VELLA = { id: "a1", name: "Vella" };
const EVALUATED_ROLL = { formula: "1d100", evaluated: true };

test("draws silently and posts exactly one card with flavor, result, roll and speaker", async () => {
  const { cards, draws, tableDoc } = harness({
    drawResults: [{ name: "The sky darkens.", description: "" }],
    roll: EVALUATED_ROLL,
  });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  assert.equal(draws.length, 1, "table drawn exactly once");
  assert.deepEqual(draws[0], { displayChat: false },
    "draw must be silent — the single card replaces the table's own card");
  assert.equal(cards.length, 1, "exactly one card, never two");

  const content = cards[0].content;
  assert.ok(content.includes("<p>Vella prayed to Sol:</p>"), content);
  assert.ok(content.includes("<p>The sky darkens.</p>"), content);
  assert.equal(cards[0].speaker.actor, "a1");
  assert.equal(cards[0].speaker.alias, "Vella");
  assert.deepEqual(cards[0].rolls, [EVALUATED_ROLL], "draw roll attached so Dice So Nice animates");
  assert.equal(cards[0].rollMode, "roll");
});

test("zero-result draw still posts exactly one flavor-only card", async () => {
  const { cards, draws, tableDoc } = harness({ drawResults: [], roll: EVALUATED_ROLL });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  assert.equal(draws.length, 1);
  assert.equal(cards.length, 1, "an empty draw must not drop the card");
  assert.ok(cards[0].content.includes("<p>Vella prayed to Sol:</p>"), cards[0].content);
  assert.ok(!/<p>[\s]*<\/p>/.test(cards[0].content), "no empty result paragraph");
});

test("nested-table draw flattens into one card — no inner draw emits its own", async () => {
  const { cards, draws, tableDoc } = harness({
    drawResults: [
      { name: "Outer table row", description: "" },
      { name: "Inner table row", description: "" },
    ],
    roll: EVALUATED_ROLL,
  });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  assert.equal(draws.length, 1, "exactly one silent draw — recursion happens inside RollTable.draw");
  assert.equal(cards.length, 1);
  const content = cards[0].content;
  assert.ok(content.includes("<p>Outer table row</p>"), content);
  assert.ok(content.includes("<p>Inner table row</p>"), content);
});

test("hostile actor name and deity are escaped in the produced content", async () => {
  const { cards, tableDoc } = harness({ drawResults: [{ name: "The sky darkens.", description: "" }] });

  await rollPrayerTable(tableDoc, { id: "a2", name: XSS }, XSS);

  const content = cards[0].content;
  // Same two-clause check as test/html-safety.test.mjs: no literal tag, and no
  // onerror handler riding on a real tag (escaped text may still contain the
  // inert string "onerror=").
  assert.ok(!/<img|<script/i.test(content), `raw tag survived: ${content}`);
  assert.ok(!/onerror\s*=[^&]/i.test(content) || !/<[a-z]+[^>]*onerror/i.test(content), `handler survived: ${content}`);
  assert.ok(content.includes("&lt;img src=x onerror=alert(1)&gt;"), content);
  assert.equal(cards.length, 1);
});

test("speaker is the praying actor, not the GM", async () => {
  const { cards, tableDoc } = harness({ drawResults: [{ name: "The sky darkens.", description: "" }] });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  assert.equal(cards[0].speaker.actor, "a1");
  assert.equal(cards[0].speaker.alias, "Vella");
  assert.notEqual(cards[0].speaker.alias, "Game Master");
});

test("attaches the evaluated draw roll when present", async () => {
  const { cards, tableDoc } = harness({
    drawResults: [{ name: "The sky darkens.", description: "" }],
    roll: EVALUATED_ROLL,
  });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  assert.deepEqual(cards[0].rolls, [EVALUATED_ROLL]);
  assert.equal(cards[0].rolls[0].evaluated, true, "Foundry rejects unevaluated rolls on ChatMessage");
});

test("missing draw roll leaves the card well-formed with no rolls key", async () => {
  const { cards, tableDoc } = harness({
    drawResults: [{ name: "The sky darkens.", description: "" }],
    roll: null,
  });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  assert.equal(cards.length, 1);
  assert.equal("rolls" in cards[0], false, "no roll → no rolls key");
  assert.ok(cards[0].content.includes("<p>The sky darkens.</p>"), "result still rendered");
  assert.equal(cards[0].speaker.actor, "a1");
});

test("applies the current core roll mode", async () => {
  const { cards, tableDoc } = harness({
    drawResults: [{ name: "The sky darkens.", description: "" }],
    rollMode: "gmroll",
  });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  assert.equal(cards[0].rollMode, "gmroll");
});

test("reads display text from name || description, never .text", async () => {
  const { cards, tableDoc } = harness({
    drawResults: [
      { name: "Named result", text: "TEXT MUST NOT WIN", description: "description ignored" },
      { name: "", text: "TEXT MUST NOT WIN 2", description: "Description-only result" },
      { name: "", text: "TEXT MUST NOT WIN 3", description: "" },
    ],
  });

  await rollPrayerTable(tableDoc, VELLA, "Sol");

  const content = cards[0].content;
  assert.ok(content.includes("<p>Named result</p>"), content);
  assert.ok(content.includes("<p>Description-only result</p>"), content);
  assert.ok(!content.includes("TEXT MUST NOT WIN"), `.text must never be read: ${content}`);
  assert.equal(cards.length, 1);
});

test("compendium-backed table resolves through the pack and posts one card", async () => {
  const { cards, draws, tableDoc } = harness({
    drawResults: [{ name: "The sky darkens.", description: "" }],
    roll: EVALUATED_ROLL,
  });
  const packTable = {
    id: "t1",
    name: "Sol Prayers",
    pack: {
      async getDocument(id) {
        assert.equal(id, "t1");
        return tableDoc;
      },
    },
  };

  await rollPrayerTable(packTable, VELLA, "Sol");

  assert.equal(draws.length, 1);
  assert.equal(cards.length, 1);
  assert.ok(cards[0].content.includes("<p>Vella prayed to Sol:</p>"), cards[0].content);
});

test("missing pack document → no draw, no card", async () => {
  const { cards, draws } = harness();
  const packTable = {
    id: "t1",
    name: "Sol Prayers",
    pack: { async getDocument() { return null; } },
  };

  await rollPrayerTable(packTable, VELLA, "Sol");

  assert.equal(draws.length, 0);
  assert.equal(cards.length, 0);
});

test("i18n keys exist in en.json with the expected placeholders", () => {
  assert.match(en["SDE.prayerRoll.rolled"], /\{name\}.*\{deity\}/);
});
