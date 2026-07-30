/**
 * Pit Fighting foe resolver — reading a drawn encounter row as creatures.
 *
 * The cells asserted here are the REAL ones, read out of the six CS2 pit-fight
 * tables as committed by the importer in a live world (58 distinct creature
 * cells across the solo and group matrices). They are structural strings — a
 * count, a name and sometimes a stage direction — not the book's prose.
 *
 * The suite that matters most is the last one: it walks every distinct cell and
 * asserts the parse is total. A parser that silently drops a shape would leave
 * the window offering to place fewer foes than the row named, which reads as a
 * missing monster rather than a parsing bug.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  nameCandidates,
  parseFoeCell,
  parseFoeRow,
} from "../scripts/pit-fighting/foe-resolver-core.mjs";
import { TABLE_MANIFEST } from "../scripts/importer/tables/table-manifest-data.mjs";

/**
 * Every distinct creature cell across the six CS2 pit-fight tables, as the
 * importer commits them. Lower-case mid-row spellings are the book's own.
 */
const REAL_CELLS = [
  "2 ankheg", "2 basilisk", "2 berserker", "2 canyon ape*", "2 gt. frog",
  "2 hero*", "2 lion", "2 rookie", "2 rookie*", "2 roper", "2 rust monster",
  "2d4 rival crawlers", "3 gladiator", "3 lion", "3 reaver", "4 cobra snake",
  "4 gladiator", "4 gt. scorpion", "4 mage", "4 rookie*", "4 rust monster",
  "6 bandit", "6 hero*", "6 thug", "Ankheg", "Archmage", "Bandit", "Basilisk",
  "Berserker", "Bulette", "Canyon ape*", "Cobra snake", "Cultist", "Cyclops",
  "Elephant", "Gladiator", "Gt. centipede", "Gt. crab", "Gt. scorpion",
  "Gt. snake", "Hero*", "Hippopotamus", "Hydra (6 heads)", "Knight", "Lion",
  "Mage", "Manticore (chained)", "Minotaur", "Ogre", "Reaver", "Rhinoceros",
  "Rival crawler", "Rookie*", "Soldier", "Stone golem", "Thug",
  "Tyrannosaurus", "Wyvern (chained)",
];

describe("counts", () => {
  test("a leading integer becomes the count and leaves the name", () => {
    const c = parseFoeCell("4 gladiator");
    assert.equal(c.count, "4");
    assert.equal(c.countIsDice, false);
    assert.equal(c.name, "gladiator");
  });

  test("a dice count is kept as an expression, not resolved", () => {
    const c = parseFoeCell("2d4 rival crawlers");
    assert.equal(c.count, "2d4");
    assert.equal(c.countIsDice, true);
    // Rolling is the caller's job — a pure function must not invent a number.
    assert.equal(typeof c.count, "string");
  });

  test("no count means one", () => {
    assert.equal(parseFoeCell("Minotaur").count, "1");
    assert.equal(parseFoeCell("Minotaur").countIsDice, false);
  });

  test("a count singularises the name", () => {
    assert.equal(parseFoeCell("2d4 rival crawlers").name, "rival crawler");
  });

  test("an uncounted name keeps its trailing s", () => {
    // No count, so the s is part of the name and must survive.
    assert.equal(parseFoeCell("Tyrannosaurus").name, "Tyrannosaurus");
    assert.equal(parseFoeCell("Hippopotamus").name, "Hippopotamus");
  });

  test("a double-s plural is left alone even with a count", () => {
    assert.equal(parseFoeCell("3 cuirass").name, "cuirass");
  });
});

describe("the pg. 39 footnote star", () => {
  test("the star is stripped and reported", () => {
    const c = parseFoeCell("Rookie*");
    assert.equal(c.name, "Rookie");
    assert.equal(c.starred, true);
  });

  test("starred and unstarred spellings of one creature agree", () => {
    // CS2 itself drops the star on the low-stakes group table's "2 rookie".
    assert.equal(parseFoeCell("2 rookie*").name, parseFoeCell("2 rookie").name);
    assert.equal(parseFoeCell("2 rookie*").starred, true);
    assert.equal(parseFoeCell("2 rookie").starred, false);
  });

  test("a starred, counted, two-word name survives all three rules", () => {
    const c = parseFoeCell("2 canyon ape*");
    assert.equal(c.count, "2");
    assert.equal(c.name, "canyon ape");
    assert.equal(c.starred, true);
  });
});

describe("parentheticals", () => {
  test("a stage direction is kept as a note, out of the name", () => {
    const c = parseFoeCell("Wyvern (chained)");
    assert.equal(c.name, "Wyvern");
    assert.equal(c.note, "chained");
  });

  test("a parenthetical carrying a number is still a note", () => {
    const c = parseFoeCell("Hydra (6 heads)");
    assert.equal(c.name, "Hydra");
    assert.equal(c.note, "6 heads");
  });

  test("no parenthetical means no note", () => {
    assert.equal(parseFoeCell("Ogre").note, null);
  });
});

describe("the Gt. abbreviation", () => {
  test("Gt. expands to Giant and takes its period with it", () => {
    // Regression: a single /\bgt\.?\b/ leaves the period behind, giving
    // "Giant. centipede", which resolves to nothing.
    assert.equal(parseFoeCell("Gt. centipede").name, "Giant centipede");
    assert.equal(parseFoeCell("2 gt. frog").name, "Giant frog");
  });

  test("no stray period survives any Gt. cell", () => {
    for (const cell of REAL_CELLS.filter((c) => /gt\.?\s/i.test(c))) {
      assert.ok(!parseFoeCell(cell).name.includes("."),
        `stranded period in ${cell} -> ${parseFoeCell(cell).name}`);
    }
  });
});

describe("name candidates", () => {
  test("the natural name is tried first", () => {
    assert.equal(nameCandidates("Minotaur")[0], "Minotaur");
  });

  test("a two-word name also offers the system's inverted form", () => {
    // Shadowdark files variants under their family: "Centipede, Giant".
    assert.deepEqual(nameCandidates("Giant centipede"),
      ["Giant centipede", "centipede, Giant"]);
    assert.deepEqual(nameCandidates("Stone golem"),
      ["Stone golem", "golem, Stone"]);
  });

  test("a one-word name offers only itself", () => {
    assert.deepEqual(nameCandidates("Ogre"), ["Ogre"]);
  });

  test("a name of three or more words is not inverted", () => {
    // Several plausible splits; a wrong guess resolves to the wrong monster,
    // which is worse than not resolving at all.
    assert.deepEqual(nameCandidates("Big angry ogre"), ["Big angry ogre"]);
  });

  test("an already-inverted name is not inverted again", () => {
    assert.deepEqual(nameCandidates("Snake, Cobra"), ["Snake, Cobra"]);
  });

  test("blank input yields no candidates", () => {
    assert.deepEqual(nameCandidates(""), []);
    assert.deepEqual(nameCandidates(null), []);
  });
});

describe("rows", () => {
  test("a full matrix row splits into two creatures and a complication", () => {
    const r = parseFoeRow("2 hero* | 2 lion | 30' deep pits");
    assert.equal(r.creatures.length, 2);
    assert.equal(r.creatures[0].name, "hero");
    assert.equal(r.creatures[0].count, "2");
    assert.equal(r.creatures[1].name, "lion");
    assert.equal(r.complication, "30' deep pits");
  });

  test("em-dash columns are absent, not creatures named dash", () => {
    const r = parseFoeRow("4 rookie* | — | —");
    assert.equal(r.creatures.length, 1);
    assert.equal(r.creatures[0].name, "rookie");
    assert.equal(r.complication, null);
  });

  test("the complication is never read as a creature", () => {
    // "Spiked nets" is a two-word capitalised phrase — exactly what a name
    // looks like — so column position, not shape, has to decide.
    const r = parseFoeRow("Rookie* | Bandit | Spiked nets");
    assert.deepEqual(r.creatures.map((c) => c.name), ["Rookie", "Bandit"]);
    assert.equal(r.complication, "Spiked nets");
  });

  test("a bare name with no separators is a single creature", () => {
    const r = parseFoeRow("Minotaur");
    assert.equal(r.creatures.length, 1);
    assert.equal(r.creatures[0].name, "Minotaur");
    assert.equal(r.complication, null);
  });

  test("an empty row yields nothing rather than throwing", () => {
    assert.deepEqual(parseFoeRow(""), { creatures: [], complication: null });
    assert.deepEqual(parseFoeRow(null), { creatures: [], complication: null });
  });
});

describe("the manifest contract the monster census relies on", () => {
  /*
   * The census finds creature matrices by asking TABLE_MANIFEST which entries
   * are `matrix: true` with a column named "Creature" — that is the ONLY thing
   * letting CS2's arena monsters be reported as gaps, since the committed
   * tables are typed "other" and never say "encounter". Drop the flag or rename
   * the column and the census silently stops looking, with every unit test here
   * still green and a GM told nothing about the monsters they are missing.
   */
  const matrices = TABLE_MANIFEST.filter(
    (e) => e.matrix && Array.isArray(e.columns) && e.columns.some((c) => /creature/i.test(c)),
  );

  test("the six pit-fight encounter tables are declared as creature matrices", () => {
    const names = matrices.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "High/epic Stakes Pit Fight (group)",
      "High/epic Stakes Pit Fight (solo)",
      "Low Stakes Pit Fight (group)",
      "Low Stakes Pit Fight (solo)",
      "Mid Stakes Pit Fight (group)",
      "Mid Stakes Pit Fight (solo)",
    ]);
  });

  test("each declares two creature columns and a complication", () => {
    for (const entry of matrices) {
      assert.deepEqual(entry.columns, ["Creature 1", "Creature 2", "Complication"],
        `${entry.name} has unexpected columns`);
    }
  });

  test("the complication is the LAST column, which is how rows are read", () => {
    // parseFoeRow treats the final column as the complication by position.
    for (const entry of matrices) {
      assert.match(entry.columns.at(-1), /complication/i, `${entry.name}`);
      assert.ok(entry.columns.slice(0, -1).every((c) => /creature/i.test(c)), `${entry.name}`);
    }
  });
});

describe("every real CS2 cell", () => {
  test("parses to a non-empty name", () => {
    for (const cell of REAL_CELLS) {
      const parsed = parseFoeCell(cell);
      assert.ok(parsed, `${cell} parsed to nothing`);
      assert.ok(parsed.name.length > 0, `${cell} produced an empty name`);
    }
  });

  test("never leaves a count, star or bracket inside the name", () => {
    for (const cell of REAL_CELLS) {
      const { name } = parseFoeCell(cell);
      assert.ok(!/^\d/.test(name), `count left in ${cell} -> ${name}`);
      assert.ok(!name.includes("*"), `star left in ${cell} -> ${name}`);
      assert.ok(!/[()]/.test(name), `bracket left in ${cell} -> ${name}`);
    }
  });

  test("yields at least one candidate for every cell", () => {
    for (const cell of REAL_CELLS) {
      const { name } = parseFoeCell(cell);
      assert.ok(nameCandidates(name).length >= 1, `no candidate for ${cell}`);
    }
  });
});
