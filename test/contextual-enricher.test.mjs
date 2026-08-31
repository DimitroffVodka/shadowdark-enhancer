/**
 * A5 (#56/#61) — the contextual check/request/roll enricher.
 *
 * Three things are pinned here, because A5 exists to be the ONE place they are
 * decided:
 *
 *   1. SYNTAX — the emitted markup matches the Shadowdark system's own enricher
 *      pattern, `\[\[(check|request)\s(\d+)\s(\w{3})\]\]` (see
 *      `systems/shadowdark/src/enrichers.mjs`). Exactly one space between
 *      tokens, a three-letter ability key. The suite re-declares that pattern
 *      and runs every emitted string through it, so a spacing or spelling
 *      change that would render as literal text fails here rather than in a
 *      GM's world.
 *   2. CONTEXT — the same characters emit `[[check …]]` from a table and
 *      `[[request …]]` from a monster. Nothing is inferred from the text, and
 *      an unstated context throws instead of picking a default.
 *   3. IDEMPOTENCE — enrichment is a fixed point. Every fixture is asserted
 *      byte-stable on a second and third pass, and the mixed fixtures below
 *      deliberately hand the enricher output it already produced, next to prose
 *      it has not seen yet, in one string.
 *
 * Foundry-free: `node --test`, no globals, no live world.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ENRICH_CONTEXTS,
  enrichContextualText,
  enrichDice,
} from "../scripts/shared/contextual-enricher.mjs";
import { convertDice, enrichEncounterText, MonsterLinker } from "../scripts/importer/monsters/monster-linker.mjs";
import { isArcticSeaEncounterTable, TableEnricher } from "../scripts/importer/tables/table-enrich.mjs";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

/** The system's own enricher pattern — copied, not imported (it lives in the system). */
const SYSTEM_ENRICHER = /\[\[(?<command>check|request)\s(?<dc>\d+)\s(?<stat>\w{3})\]\]/g;

/** Assert `enrich(input)` is `expected` AND that re-running it changes nothing. */
function stable(input, expected, context) {
  const once = enrichContextualText(input, { context });
  assert.equal(once, expected, `first pass (${context})`);
  const twice = enrichContextualText(once, { context });
  assert.equal(twice, once, `second pass must be byte-identical (${context})`);
  const thrice = enrichContextualText(twice, { context });
  assert.equal(thrice, once, `third pass must be byte-identical (${context})`);
  return once;
}

describe("A5 — syntax the system can actually enrich", () => {
  test("emitted check/request markup matches the system's enricher pattern", () => {
    for (const context of Object.keys(ENRICH_CONTEXTS)) {
      const out = enrichContextualText("DC 15 DEX and DC 9 Charisma", { context });
      const found = [...out.matchAll(SYSTEM_ENRICHER)];
      assert.equal(found.length, 2, `${context}: both expressions must be enrichable`);
      assert.deepEqual(
        found.map((m) => [m.groups.command, m.groups.dc, m.groups.stat]),
        [[ENRICH_CONTEXTS[context], "15", "dex"], [ENRICH_CONTEXTS[context], "9", "cha"]]
      );
    }
  });

  test("full ability names are emitted as the three-letter key", () => {
    const pairs = [
      ["strength", "str"], ["dexterity", "dex"], ["constitution", "con"],
      ["intelligence", "int"], ["wisdom", "wis"], ["charisma", "cha"],
      ["STR", "str"], ["Dex", "dex"], ["CON", "con"],
      ["Int", "int"], ["WIS", "wis"], ["Cha", "cha"],
    ];
    for (const [spelling, key] of pairs) {
      assert.equal(
        enrichContextualText(`DC 12 ${spelling}`, { context: "table" }),
        `[[check 12 ${key}]]`,
        spelling
      );
    }
  });

  test("the context map is the contract, and it is frozen", () => {
    assert.deepEqual(ENRICH_CONTEXTS, { table: "check", environment: "check", monster: "request" });
    assert.ok(Object.isFrozen(ENRICH_CONTEXTS));
  });
});

describe("A5 — context selects the syntax, the text never does", () => {
  const source = "A sudden storm hails frozen ice; DC 15 DEX or 2d4 damage";

  test("table context emits [[check]] (issue #56's worked row)", () => {
    stable(source, "A sudden storm hails frozen ice; [[check 15 dex]] or [[/r 2d4]] damage", "table");
  });

  test("environment context emits [[check]]", () => {
    stable(source, "A sudden storm hails frozen ice; [[check 15 dex]] or [[/r 2d4]] damage", "environment");
  });

  test("monster context emits [[request]] for the same characters", () => {
    stable(source, "A sudden storm hails frozen ice; [[request 15 dex]] or [[/r 2d4]] damage", "monster");
  });

  test("a monster-imposed save becomes a request, not a check", () => {
    stable(
      "On a hit, the target must make a DC 12 CON save or take 1d6 damage each round.",
      "On a hit, the target must make a [[request 12 con]] save or take [[/r 1d6]] damage each round.",
      "monster"
    );
  });

  test("an unstated or unknown context throws rather than defaulting", () => {
    for (const bad of [undefined, null, "", "checks", "actor", "TABLE", 0]) {
      assert.throws(
        () => enrichContextualText("DC 15 DEX", { context: bad }),
        TypeError,
        `context ${JSON.stringify(bad)} must be refused`
      );
    }
    assert.throws(() => enrichContextualText("DC 15 DEX"), TypeError);
    // Inherited Object keys are not contexts.
    assert.throws(() => enrichContextualText("DC 15 DEX", { context: "toString" }), TypeError);
  });
});

describe("A5 — mixed prose, punctuation, and multiple expressions", () => {
  test("punctuation around an expression survives verbatim", () => {
    const cases = [
      ["(DC 12 CON)", "([[check 12 con]])"],
      ["DC 12 CON.", "[[check 12 con]]."],
      ["DC 12 CON, then flee", "[[check 12 con]], then flee"],
      ["…DC 12 CON!", "…[[check 12 con]]!"],
      ["\"DC 12 CON\"", "\"[[check 12 con]]\""],
      ["DC 12 CON; 2d6 cold damage.", "[[check 12 con]]; [[/r 2d6]] cold damage."],
    ];
    for (const [input, expected] of cases) stable(input, expected, "table");
  });

  test("several expressions in one row all convert, in place", () => {
    stable(
      "DC 15 DEX to dodge, DC 12 CON to endure; failure costs 2d4 hp and 1d4*10 gp.",
      "[[check 15 dex]] to dodge, [[check 12 con]] to endure; failure costs [[/r 2d4]] hp and [[/r 1d4*10]] gp.",
      "table"
    );
  });

  test("an under-determined check stays prose — nothing is deleted or guessed", () => {
    for (const input of [
      "Make a DC 15 check.",
      "DC 15 damage",
      "DC 15 or be swept away",
      "Roll a Wisdom check.",
      "The ice is DC unknown",
    ]) {
      stable(input, input, "table");
      stable(input, input, "monster");
    }
  });

  test("a lone die size is not a roll, but a counted one is", () => {
    stable("Deal d6 damage", "Deal d6 damage", "table");
    stable("Deal 1d6 damage", "Deal [[/r 1d6]] damage", "table");
    stable("Treasure: 1d4*10 gp and 2d6x100 sp", "Treasure: [[/r 1d4*10]] gp and [[/r 2d6x100]] sp", "table");
  });

  test("text with nothing to enrich is returned unchanged", () => {
    stable("A quiet stretch of pack ice.", "A quiet stretch of pack ice.", "table");
  });

  test("empty and non-string inputs are coerced, never thrown on", () => {
    for (const context of Object.keys(ENRICH_CONTEXTS)) {
      assert.equal(enrichContextualText(undefined, { context }), "");
      assert.equal(enrichContextualText(null, { context }), "");
      assert.equal(enrichContextualText("", { context }), "");
      assert.equal(enrichContextualText(0, { context }), "0");
    }
  });
});

describe("A5 — already-enriched markup is byte-stable", () => {
  test("enriched output re-enriched is the same bytes, in every context", () => {
    for (const context of Object.keys(ENRICH_CONTEXTS)) {
      const command = ENRICH_CONTEXTS[context];
      stable(
        `A sudden storm; [[${command} 15 dex]] or [[/r 2d4]] damage`,
        `A sudden storm; [[${command} 15 dex]] or [[/r 2d4]] damage`,
        context
      );
    }
  });

  test("markup from ANOTHER context is left alone, not rewritten", () => {
    // Out of scope for A5: changing already-enriched markup. A monster pass
    // over text a table pass already enriched must not flip check -> request.
    stable("[[check 15 dex]] or 2d4 damage", "[[check 15 dex]] or [[/r 2d4]] damage", "monster");
    stable("[[request 12 con]] or 1d6", "[[request 12 con]] or [[/r 1d6]]", "table");
  });

  test("MIXED: enriched and un-enriched expressions collide in one string", () => {
    // The collision case: output this helper already produced, sitting beside
    // prose it has never seen, plus a monster link whose LABEL contains both a
    // DC and a dice token that must not be touched.
    stable(
      "Storm: [[check 15 dex]] or 2d4 cold; then DC 12 CON or [[/r 1d6]] more; " +
        "@UUID[Compendium.shadowdark.monsters.abc123]{DC 20 STR 3d6 Ice Troll} attacks.",
      "Storm: [[check 15 dex]] or [[/r 2d4]] cold; then [[check 12 con]] or [[/r 1d6]] more; " +
        "@UUID[Compendium.shadowdark.monsters.abc123]{DC 20 STR 3d6 Ice Troll} attacks.",
      "table"
    );
  });

  test("adjacent markup with no separating prose stays intact", () => {
    stable("[[check 15 dex]][[/r 2d4]]", "[[check 15 dex]][[/r 2d4]]", "table");
    stable("[[check 15 dex]]2d4[[/r 1d6]]", "[[check 15 dex]][[/r 2d4]][[/r 1d6]]", "table");
  });

  test("dice inside an existing inline roll are never re-wrapped", () => {
    // The old local convertDice guarded only the exact `[[/r ` prefix, so the
    // SECOND term here grew a nested roll. The shared mask covers the span.
    stable("[[/r 2d4+1d6]] damage", "[[/r 2d4+1d6]] damage", "table");
    stable("[[/r 2d4 + 1d6]] damage", "[[/r 2d4 + 1d6]] damage", "table");
    stable("[[/gmr 1d20]] secretly", "[[/gmr 1d20]] secretly", "table");
  });

  test("HTML rows are enriched in their text, never inside a tag", () => {
    stable(
      "<p class=\"row-2d6\">DC 15 DEX or 2d4 damage</p>",
      "<p class=\"row-2d6\">[[check 15 dex]] or [[/r 2d4]] damage</p>",
      "table"
    );
    stable("<img src=\"icons/x-2d6.webp\">", "<img src=\"icons/x-2d6.webp\">", "table");
  });

  test("an unterminated inline roll is left exactly as found", () => {
    stable("[[/r 2d4", "[[/r 2d4", "table");
  });
});

describe("A5 — enrichDice is the dice half alone", () => {
  test("it wraps dice and never touches a DC expression", () => {
    assert.equal(enrichDice("DC 15 DEX or 2d4 damage"), "DC 15 DEX or [[/r 2d4]] damage");
    assert.equal(enrichDice(enrichDice("DC 15 DEX or 2d4 damage")), "DC 15 DEX or [[/r 2d4]] damage");
  });

  test("it matches the pre-A5 convertDice rule on ordinary encounter text", () => {
    // The behaviour the table enricher already shipped, pinned so delegating
    // convertDice to A5 cannot quietly change what a GM's tables look like.
    const legacy = (text) =>
      String(text ?? "").replace(/(?<!\[\[\/r\s)\b(\d+d\d+(?:[*x]\d+)?)\b/gi, "[[/r $1]]");
    for (const input of [
      "2d4 goblins",
      "1d6+1 wolves and 2d8 rats",
      "Treasure: 1d4*10 gp",
      "2d6x100 sp",
      "d6 alone",
      "[[/r 2d4]] goblins",
      "[[/r 2d4",
      "no dice here",
      "",
    ]) {
      assert.equal(enrichDice(input), legacy(input), JSON.stringify(input));
    }
  });

  test("monster-linker's convertDice IS the shared rule (one owner)", () => {
    assert.equal(convertDice, enrichDice);
  });
});

describe("A5 — the composed encounter enrichment still holds", () => {
  const index = [{ name: "Ice Troll", uuid: "Compendium.shadowdark.monsters.troll" }];

  test("dice + monster links compose and stay byte-stable on a rerun", () => {
    const once = enrichEncounterText("2d4 Ice Trolls", index);
    assert.equal(once, "[[/r 2d4]] @UUID[Compendium.shadowdark.monsters.troll]{Ice Trolls}");
    assert.equal(enrichEncounterText(once, index), once);
  });

  test("a link label containing dice survives the composition", () => {
    const labelled = "@UUID[Compendium.shadowdark.monsters.troll]{2d4 Ice Trolls} appear";
    assert.equal(enrichEncounterText(labelled, index), labelled);
  });

  test("an explicitly supplied context remains A5-validated", () => {
    assert.throws(
      () => enrichEncounterText("DC 15 DEX", index, { context: "not-a-context" }),
      TypeError,
    );
  });
});

describe("E1 — Arctic Sea table enrichment", () => {
  const monsterIndex = [{ name: "Ice Troll", uuid: "Compendium.shadowdark.monsters.troll" }];

  test("the table selector is narrow and recognizes seeded and legacy copies", () => {
    assert.equal(isArcticSeaEncounterTable({
      name: "Anything GM-named",
      flags: { [MODULE_ID]: { manifestId: "cs3-arctic-sea-encounters" } },
    }), true);
    assert.equal(isArcticSeaEncounterTable({
      name: "Cursed Scroll 3 p26: Arctic Sea Encounters",
      flags: { [MODULE_ID]: { source: "CS3" } },
    }), true);
    assert.equal(isArcticSeaEncounterTable({ name: "Arctic Sea Encounters" }), true);
    assert.equal(isArcticSeaEncounterTable({
      name: "Core - Arctic Sea Encounters",
      flags: { [MODULE_ID]: { source: "core" } },
    }), false);
    assert.equal(isArcticSeaEncounterTable({
      name: "Cursed Scroll 3 p26: Arctic Sea Encounters",
      flags: { [MODULE_ID]: { source: "CS6" } },
    }), false);
    assert.equal(isArcticSeaEncounterTable({ name: "Arctic Encounters" }), false);
  });

  test("the complete 50-row source fixture preserves prose, links, and markup at a fixed point", async () => {
    const sourceRows = Array.from({ length: 50 }, (_, i) => ({
      id: `row-${i + 1}`,
      name: i === 31
        ? "A sudden storm hails frozen ice; DC 15 DEX or 2d4 damage"
        : i === 7
          ? "An existing @UUID[Compendium.shadowdark.monsters.troll]{Ice Troll} watches; DC 12 CON or 1d6 damage."
          : i === 15
            ? '<p class="encounter-row">A frozen wake; DC 10 WIS or 1d4 damage.</p>'
            : i === 23
              ? "A warded floe; [[check 11 str]] or [[/r 1d8]] damage."
              : `Complete source row ${i + 1}: drifting ice and ${i % 2 ? "1d6" : "2d4"} cold damage.`,
      description: "",
    }));
    assert.equal(sourceRows.length, 50, "the fixture must cover every source row");

    const updates = [];
    const rows = sourceRows.map((row) => ({
      id: row.id,
      toObject() { return { name: row.name, description: row.description }; },
    }));
    const table = {
      name: "Cursed Scroll 3 p26: Arctic Sea Encounters",
      flags: { [MODULE_ID]: { manifestId: "cs3-arctic-sea-encounters", source: "cs3" } },
      results: { contents: rows, size: rows.length },
      async updateEmbeddedDocuments(type, batch) {
        assert.equal(type, "TableResult");
        updates.push(batch);
        for (const patch of batch) {
          const row = sourceRows.find((candidate) => candidate.id === patch._id);
          row.name = patch.name;
          row.description = patch.description;
        }
      },
    };

    const oldGame = globalThis.game;
    const originalBuildIndex = MonsterLinker.buildIndex;
    globalThis.game = { user: { isGM: true } };
    MonsterLinker.buildIndex = async () => monsterIndex;
    try {
      const first = await TableEnricher.enrichEncounters(table);
      assert.equal(first.rows, 50);
      assert.equal(first.updated, 50);
      assert.equal(updates.length, 1);
      assert.match(sourceRows[31].description, /\[\[check 15 dex\]\] or \[\[\/r 2d4\]\]/);
      assert.match(sourceRows[7].description, /@UUID\[Compendium\.shadowdark\.monsters\.troll\]\{Ice Troll\}/);
      assert.match(sourceRows[15].description, /^<p class="encounter-row">/);
      assert.equal(sourceRows[23].description, "A warded floe; [[check 11 str]] or [[/r 1d8]] damage.");
      for (const [i, row] of sourceRows.entries()) {
        assert.match(row.description, new RegExp(`(?:Complete source row ${i + 1}|sudden storm|existing|frozen wake|warded floe|encounter-row)`));
      }

      const firstBytes = sourceRows.map((row) => row.description);
      const second = await TableEnricher.enrichEncounters(table);
      assert.equal(second.updated, 0, "a rerun must not write any row");
      assert.equal(updates.length, 1, "a fixed-point rerun must not call updateEmbeddedDocuments");
      assert.deepEqual(sourceRows.map((row) => row.description), firstBytes);
    } finally {
      MonsterLinker.buildIndex = originalBuildIndex;
      if (oldGame === undefined) delete globalThis.game;
      else globalThis.game = oldGame;
    }
  });

  test("an unrelated encounter table keeps the legacy dice-only route", async () => {
    const row = { id: "core-row", name: "Core encounter: DC 15 DEX or 2d4 damage", description: "" };
    const updates = [];
    const table = {
      name: "Arctic Encounters",
      flags: { [MODULE_ID]: { manifestId: "core-arctic-encounters", source: "core" } },
      results: { contents: [{ id: row.id, toObject: () => ({ ...row }) }], size: 1 },
      async updateEmbeddedDocuments(_type, batch) {
        updates.push(batch);
        Object.assign(row, batch[0]);
      },
    };
    const oldGame = globalThis.game;
    const originalBuildIndex = MonsterLinker.buildIndex;
    globalThis.game = { user: { isGM: true } };
    MonsterLinker.buildIndex = async () => [];
    try {
      await TableEnricher.enrichEncounters(table);
      assert.equal(row.description, "Core encounter: DC 15 DEX or [[/r 2d4]] damage");
      assert.equal(updates.length, 1);
    } finally {
      MonsterLinker.buildIndex = originalBuildIndex;
      if (oldGame === undefined) delete globalThis.game;
      else globalThis.game = oldGame;
    }
  });
});
