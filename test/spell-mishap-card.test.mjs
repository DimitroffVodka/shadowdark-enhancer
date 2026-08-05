/**
 * Spell mishap roll — ONE card for the draw + flavor, never two.
 *
 * Regression for the sibling bug of #16 (prayer roll): `rollMishapTable()` used
 * to draw with `displayChat: true` (card 1 — the table's own native card) and
 * then post a second flavor card (card 2), gated on the actor. With the draw
 * silenced, the rewrite must post exactly one card on EVERY path — and the
 * no-actor path must still carry the drawn result.
 *
 * That no-actor path is unreachable in production: `detectMishap()` returns
 * null whenever the actor is missing, so `init()` never hands `rollMishapTable`
 * a null actor. The branch is defensive totality for the now-exported function
 * — its contract must hold on its own — not a fix for an observed defect. The
 * test still pins it, because a regression there would hide silently.
 *
 * Also pins the #16-style hardening: escaped interpolation into the card's
 * HTML, `name || description` (never `.text`, whose v15 deprecation shim is
 * removed on this Foundry version), and the attached draw roll so Dice So
 * Nice still animates.
 *
 * No book text: actor/table/result names are invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { rollMishapTable } from "../scripts/spell-mishap/spell-mishap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The real strings, so this suite fails if the i18n keys drift. */
const en = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));

/** Minimal i18n.format: substitute {placeholders} from the template. */
function format(template, data = {}) {
  return template.replace(/\{(\w+)\}/g, (_m, k) => String(data[k] ?? ""));
}

const XSS = "<img src=x onerror=alert(1)>";

/** The name the wizard lookup actually matches against (see MISHAP_SETS). */
const WIZARD_TIER_1_2 = "Wizard Mishap Tier 1-2";

/**
 * Stub the Foundry surface `rollMishapTable` touches, then call it.
 * `findMishapTable` resolves through the real path: game.packs →
 * pack.getIndex → pack.getDocument. The index entry name is the canonical
 * tier name (that is what resolution matches); `tableName` is the DOC's
 * display name — they differ on purpose, so hostile names can be tested for
 * escaping without breaking resolution.
 */
function harness({ drawResults = [], roll = null, rollMode = "roll", tableName = WIZARD_TIER_1_2, innerTable = null } = {}) {
  const cards = [];
  const draws = [];

  const tableDoc = {
    name: tableName,
    async draw(opts) {
      draws.push(opts);
      // Simulate Foundry's draw() result assembly: a nested result is a
      // document-typed result whose documentUuid parseUuid() resolves to a
      // RollTable. Foundry resolves it by rolling the inner table
      // (innerTable.roll() — which never posts a card) and folding its
      // results into the returned array.
      const isTableLink = (r) =>
        r.type === "document" && String(r.documentUuid ?? "").includes("RollTable.");
      const results = [];
      for (const r of drawResults) {
        if (innerTable && isTableLink(r)) {
          const inner = await innerTable.roll();
          results.push(...(inner.results ?? []));
        } else {
          results.push(r);
        }
      }
      return { roll, results };
    },
  };

  globalThis.game = {
    i18n: { format: (key, data) => format(en[key], data) },
    settings: { get: (_ns, key) => (key === "rollMode" ? rollMode : undefined) },
    packs: {
      get(id) {
        if (id !== "shadowdark.rollable-tables") return null;
        return {
          async getIndex() {
            return [{ _id: "t1", name: WIZARD_TIER_1_2 }];
          },
          async getDocument() {
            return tableDoc;
          },
        };
      },
    },
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

  return { cards, draws };
}

const VELLA = { id: "a1", name: "Vella" };

test("draws silently and posts exactly one card with flavor, result, roll and speaker", async () => {
  const roll = { formula: "1d20" };
  const { cards, draws } = harness({ drawResults: [{ name: "The spell backfires.", description: "" }], roll });

  await rollMishapTable(1, VELLA, "wizard");

  assert.equal(draws.length, 1, "table drawn exactly once");
  assert.deepEqual(draws[0], { displayChat: false }, "draw must be silent — the single card replaces the table's own card");
  assert.equal(cards.length, 1, "exactly one card, never two");

  const content = cards[0].content;
  assert.ok(content.includes("<p>Vella rolled a mishap on a Tier 1 spell — Wizard Mishap Tier 1-2:</p>"), content);
  assert.ok(content.includes("<p>The spell backfires.</p>"), content);
  assert.equal(cards[0].speaker.actor, "a1");
  assert.equal(cards[0].speaker.alias, "Vella");
  assert.deepEqual(cards[0].rolls, [roll], "draw roll attached so Dice So Nice animates");
  assert.equal(cards[0].rollMode, "roll");
});

test("no-actor path still posts exactly one card carrying the drawn result", async () => {
  const roll = { formula: "1d20" };
  const { cards, draws } = harness({ drawResults: [{ name: "The staff shatters.", description: "" }], roll });

  await rollMishapTable(1, null, "wizard");

  assert.equal(draws.length, 1);
  assert.equal(cards.length, 1, "no-actor path must not post zero cards");
  assert.ok(cards[0].content.includes("<p>A mishap occurred on a Tier 1 spell — Wizard Mishap Tier 1-2:</p>"), cards[0].content);
  assert.ok(cards[0].content.includes("<p>The staff shatters.</p>"), "drawn result must survive the no-actor path");
  assert.equal(cards[0].speaker, undefined, "no actor → no actor speaker");
  assert.deepEqual(cards[0].rolls, [roll], "roll still attached without an actor");
});

test("zero-results draw still posts exactly one card with the flavor line", async () => {
  const roll = { formula: "1d20" };
  const { cards, draws } = harness({ drawResults: [], roll });

  await rollMishapTable(1, VELLA, "wizard");

  assert.equal(draws.length, 1);
  assert.equal(cards.length, 1, "empty draw results must not suppress the card");
  // The flavor-only card is the right outcome: an empty mishap table is a
  // table-content problem the GM should see flagged, not silently swallowed.
  assert.equal(
    cards[0].content,
    "<p>Vella rolled a mishap on a Tier 1 spell — Wizard Mishap Tier 1-2:</p>",
  );
  assert.deepEqual(cards[0].rolls, [roll]);
});

test("nested table result folds into the single card", async () => {
  const roll = { formula: "1d20" };
  const inner = {
    name: "Wizard Mishap Inner",
    rolls: 0,
    draws: 0,
    async roll() {
      this.rolls += 1;
      return { results: [{ name: "Inner mishap text", description: "" }] };
    },
    async draw() {
      this.draws += 1;
      return { results: [{ name: "Inner mishap text", description: "" }] };
    },
  };
  const { cards, draws } = harness({
    roll,
    innerTable: inner,
    drawResults: [
      { name: "Outer result", description: "" },
      // Table link, real v14 schema: string TABLE_RESULT_TYPES — a nested
      // table is `type: "document"` with a documentUuid parseUuid() resolves
      // to a RollTable. Foundry resolves these through the inner table's
      // roll(), which never emits a chat card of its own.
      { name: "", description: "", type: "document", documentUuid: "RollTable.inner1" },
    ],
  });

  await rollMishapTable(1, VELLA, "wizard");

  assert.equal(draws.length, 1, "outer table drawn exactly once");
  assert.deepEqual(draws[0], { displayChat: false }, "the single outer draw is silent");
  // inner.rolls is fixture-driven: only the stub's draw() touches the inner
  // table (resolving the link via roll(), never draw()). The genuine "no
  // inner card" guarantee lives in Foundry core — roll-table.mjs:318
  // recursion through roll(), :133 displayChat guard — and rests on source
  // verification, not a unit assertion.
  assert.equal(inner.rolls, 1, "fixture resolves the table link exactly once");
  assert.equal(cards.length, 1, "exactly one card even with a nested result");
  assert.ok(cards[0].content.includes("<p>Outer result</p>"), cards[0].content);
  assert.ok(cards[0].content.includes("<p>Inner mishap text</p>"), "inner result folded into the single card");
  assert.deepEqual(cards[0].rolls, [roll]);
});

test("interpolated values are escaped (actor name, table name, drawn text)", async () => {
  const { cards } = harness({
    tableName: XSS,
    drawResults: [{ name: XSS, description: "" }],
  });

  await rollMishapTable(1, { id: "a2", name: XSS }, "wizard");

  const content = cards[0].content;
  // Same two-clause check as test/html-safety.test.mjs: no literal tag, and no
  // onerror handler riding on a real tag (escaped text may still contain the
  // inert string "onerror=").
  assert.ok(!/<img|<script/i.test(content), `raw tag survived: ${content}`);
  assert.ok(!/onerror\s*=[^&]/i.test(content) || !/<[a-z]+[^>]*onerror/i.test(content), `handler survived: ${content}`);
  assert.ok(content.includes("&lt;img src=x onerror=alert(1)&gt;"), content);
  assert.equal(cards.length, 1);
});

test("reads display text from name || description, never .text", async () => {
  const { cards } = harness({
    drawResults: [
      { name: "Named result", text: "TEXT MUST NOT WIN", description: "description ignored" },
      { name: "", text: "TEXT MUST NOT WIN 2", description: "Description-only result" },
      { name: "", text: "TEXT MUST NOT WIN 3", description: "" },
    ],
  });

  await rollMishapTable(1, VELLA, "wizard");

  const content = cards[0].content;
  assert.ok(content.includes("<p>Named result</p>"), content);
  assert.ok(content.includes("<p>Description-only result</p>"), content);
  assert.ok(!content.includes("TEXT MUST NOT WIN"), `.text must never be read: ${content}`);
  assert.equal(cards.length, 1);
});

test("missing table posts nothing", async () => {
  const { cards, draws } = harness();

  await rollMishapTable(1, VELLA, "barbarian"); // no MISHAP_SETS entry

  assert.equal(draws.length, 0);
  assert.equal(cards.length, 0);
});

test("missing draw roll leaves the rolls key off", async () => {
  const { cards } = harness({ drawResults: [{ name: "Arcane whiplash.", description: "" }], roll: null });

  await rollMishapTable(1, VELLA, "wizard");

  assert.equal(cards.length, 1);
  assert.equal("rolls" in cards[0], false, "no roll → no rolls key");
});

test("applies the current core roll mode", async () => {
  const { cards } = harness({ drawResults: [{ name: "Arcane whiplash.", description: "" }], rollMode: "gmroll" });

  await rollMishapTable(1, VELLA, "wizard");

  assert.equal(cards[0].rollMode, "gmroll");
});

test("i18n keys exist in en.json with the expected placeholders", () => {
  assert.match(en["SDE.mishap.rolled"], /\{name\}.*\{tier\}.*\{tableName\}/);
  assert.match(en["SDE.mishap.rolledNoActor"], /\{tier\}.*\{tableName\}/);
  assert.ok(!en["SDE.mishap.rolledNoActor"].includes("{name}"), "no-actor flavor must not require a name");
});
