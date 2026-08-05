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
function harness({ enrich = (html) => html, drawResults = [], roll = null, rollMode = "roll", tableName = WIZARD_TIER_1_2, innerTable = null } = {}) {
  const cards = [];
  const enriched = [];
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

  // Core enriches result text rather than escaping it; the identity stub keeps
  // the input verbatim so the assertions below show exactly what reaches chat.
  globalThis.foundry = {
    applications: { ux: { TextEditor: { implementation: {
      async enrichHTML(html) { enriched.push(html); return enrich(html); },
    } } } },
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

  return { cards, draws, enriched };
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
  assert.ok(content.includes('<div class="sde-mishap-result">The spell backfires.</div>'), content);
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
  assert.ok(cards[0].content.includes('<div class="sde-mishap-result">The staff shatters.</div>'), "drawn result must survive the no-actor path");
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
  assert.ok(cards[0].content.includes('<div class="sde-mishap-result">Outer result</div>'), cards[0].content);
  assert.ok(cards[0].content.includes('<div class="sde-mishap-result">Inner mishap text</div>'), "inner result folded into the single card");
  assert.deepEqual(cards[0].rolls, [roll]);
});

test("interpolated names are escaped (actor name, table name)", async () => {
  const { cards } = harness({ tableName: XSS, drawResults: [] });

  await rollMishapTable(1, { id: "a2", name: XSS }, "wizard");

  // The flavor line is the part built from untrusted input, so it stays escaped.
  const flavor = cards[0].content.split("</p>")[0];
  assert.ok(!/<img|<script/i.test(flavor), `raw tag survived: ${flavor}`);
  assert.ok(flavor.includes("&lt;img src=x onerror=alert(1)&gt;"), flavor);
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
  assert.ok(content.includes('<div class="sde-mishap-result">Named result</div>'), content);
  assert.ok(content.includes('<div class="sde-mishap-result">Description-only result</div>'), content);
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

/* --------------------------------------------------------------------- *
 * Result markup must reach chat intact.
 *
 * The system's own mishap tables put real HTML in `description` with an empty
 * `name` — `<b>Explosion!</b> You take [[/r 1d8]] damage`. Escaping it printed
 * `<b>Explosion!</b>` at the player verbatim (reported 2026-08-05). Core's own
 * table card enriches instead (TableResult#getHTML → enrichHTML), so bold
 * survives and [[/r ...]] stays a clickable inline roll.
 * --------------------------------------------------------------------- */

const SYSTEM_SHAPED = [
  { name: "", description: "<p><strong>Devastation!</strong> Roll twice and combine both effects.</p>" },
  { name: "", description: "<b>Explosion!</b> You take [[/r 1d8]] damage" },
];

test("description markup reaches the enricher and is NOT escaped", async () => {
  const { cards, enriched } = harness({ drawResults: SYSTEM_SHAPED });

  await rollMishapTable(1, VELLA, "wizard");

  // What this suite can actually prove with a stubbed enricher:
  //  (a) every description was handed to the enricher VERBATIM, and
  //  (b) nothing was escaped on the way into the card.
  // It deliberately does NOT assert that `[[/r 1d8]]` survives in the card —
  // real enrichHTML REPLACES it with an <a class="inline-roll roll"> anchor,
  // so asserting the raw syntax would pin behaviour that production never has.
  assert.deepEqual(enriched, SYSTEM_SHAPED.map(r => r.description),
    "each description is enriched verbatim, in order");
  assert.ok(!cards[0].content.includes("&lt;b&gt;"), `tags were escaped: ${cards[0].content}`);
  assert.ok(!cards[0].content.includes("&lt;strong&gt;"), cards[0].content);
});

test("a name-bearing result is ESCAPED, matching core's own template", async () => {
  // core renders {{result.name}} (escaped) and {{{result.description}}} (raw),
  // so markup in a name must not become live HTML.
  const { cards, enriched } = harness({ drawResults: [{ name: XSS, description: "" }] });

  await rollMishapTable(1, VELLA, "wizard");

  assert.ok(!/<img|<script/i.test(cards[0].content), `raw tag survived: ${cards[0].content}`);
  assert.ok(cards[0].content.includes("&lt;img src=x onerror=alert(1)&gt;"), cards[0].content);
  assert.deepEqual(enriched, [], "a name is escaped, never enriched");
});

test("a result that enriches to nothing leaves no blank row", async () => {
  // v14 REMOVES secret sections under `secrets:false`, so such a row comes
  // back empty — it must vanish, not render as an empty styled div.
  const { cards } = harness({ drawResults: [
    { name: "", description: "<section class=\"secret\">gm only</section>" },
    { name: "", description: "<b>Visible</b> effect" },
  ], enrich: html => (html.includes("secret") ? "" : html) });

  await rollMishapTable(1, VELLA, "wizard");

  const blocks = [...cards[0].content.matchAll(/<div class="sde-mishap-result">/g)];
  assert.equal(blocks.length, 1, `one visible row expected: ${cards[0].content}`);
  assert.ok(cards[0].content.includes("<b>Visible</b> effect"), cards[0].content);
});

test("one unenrichable row degrades to nothing and the card still posts", async () => {
  // core wraps per-result enrichment in Promise.allSettled for exactly this.
  const { cards } = harness({ drawResults: [
    { name: "", description: "BOOM" },
    { name: "", description: "<b>Survivor</b>" },
  ], enrich: html => { if (html === "BOOM") throw new Error("bad @UUID"); return html; } });

  await rollMishapTable(1, VELLA, "wizard");

  assert.equal(cards.length, 1, "a broken row must not take the card down");
  assert.ok(cards[0].content.includes("<b>Survivor</b>"), cards[0].content);
  assert.ok(!cards[0].content.includes("BOOM"), cards[0].content);
});

test("an already-<p>-wrapped description is not nested inside another <p>", async () => {
  const { cards } = harness({ drawResults: [SYSTEM_SHAPED[0]] });

  await rollMishapTable(1, VELLA, "wizard");

  // <div> may legally contain <p>; <p> may not. Nesting them silently splits
  // the paragraph in the browser and breaks the card's spacing.
  assert.ok(!/<p>\s*<p>/.test(cards[0].content), `nested paragraphs: ${cards[0].content}`);
  assert.ok(cards[0].content.includes('<div class="sde-mishap-result"><p>'), cards[0].content);
});
