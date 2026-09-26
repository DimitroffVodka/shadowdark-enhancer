// The Character Builder's Random ancestry from a population table (#187).
// Foundry is stubbed: game.settings, fromUuid and a RollTable whose roll walks
// every d100 face in turn, so the counts are exact rather than statistical.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { itemNamedBy, rollAncestryFromTable } from "../scripts/char-builder/data.mjs";

const ANCESTRIES = ["Dwarf", "Elf", "Goblin", "Half-Elf", "Half-Orc", "Halfling", "Human", "Kobold"]
  .map((name) => ({ name, uuid: `Compendium.shadowdark.ancestries.Item.${name}` }));

// The Western Reaches odds (PGWR p.14), spelled the way the book spells them.
const BANDS = [[1, 54, "Human"], [55, 64, "Elf"], [65, 74, "Dwarf"], [75, 84, "Halfling"],
  [85, 89, "Goblin"], [90, 94, "Half-elf"], [95, 99, "Half-orc"], [100, 100, "Kobold"]];

function populationTable(bands = BANDS) {
  let face = 0;
  return {
    name: "Ancestry (Population)",
    async roll() {
      face = (face % 100) + 1;
      const [, , text] = bands.find(([lo, hi]) => face >= lo && face <= hi);
      return { results: [{ name: text, description: "" }] };
    },
  };
}

let setting, tables, warnings;
beforeEach(() => {
  setting = null; tables = new Map(); warnings = [];
  globalThis.game = {
    settings: { get: (ns, key) => (key === "charBuilderAncestryTable" ? setting : undefined) },
    i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
  };
  globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
  globalThis.fromUuid = async (uuid) => tables.get(uuid) ?? null;
});

test("a result finds its ancestry whatever its case and punctuation", () => {
  assert.equal(itemNamedBy("Half-elf", ANCESTRIES)?.name, "Half-Elf");
  assert.equal(itemNamedBy("  HUMAN ", ANCESTRIES)?.name, "Human");
  assert.equal(itemNamedBy("Elf", ANCESTRIES)?.name, "Elf", "Elf is not Half-Elf");
  assert.equal(itemNamedBy("Dragonborn", ANCESTRIES), null);
  assert.equal(itemNamedBy("", ANCESTRIES), null);
});

test("with no table set, Random keeps the weighted pick", async () => {
  assert.equal(await rollAncestryFromTable(ANCESTRIES), null);
  assert.deepEqual(warnings, []);
});

test("1,000 Randoms follow the table: 54% human, 1% kobold", async () => {
  setting = "Compendium.world.tables.RollTable.pop";
  tables.set(setting, populationTable());
  const counts = new Map();
  for (let i = 0; i < 1000; i++) {
    const pick = await rollAncestryFromTable(ANCESTRIES);
    counts.set(pick.name, (counts.get(pick.name) ?? 0) + 1);
  }
  assert.equal(counts.get("Human"), 540);
  assert.equal(counts.get("Kobold"), 10);
  assert.equal(counts.get("Half-Elf"), 50, "the book's Half-elf lands on Half-Elf");
  assert.deepEqual(warnings, []);
});

test("a result naming no installed ancestry falls back and says which", async () => {
  setting = "Compendium.world.tables.RollTable.odd";
  tables.set(setting, populationTable([[1, 100, "Dragonborn"]]));
  assert.equal(await rollAncestryFromTable(ANCESTRIES), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tableNoMatch/);
  assert.match(warnings[0], /Dragonborn/);
});

test("a table that no longer exists falls back and says so", async () => {
  setting = "Compendium.world.tables.RollTable.gone";
  assert.equal(await rollAncestryFromTable(ANCESTRIES), null);
  assert.match(warnings[0] ?? "", /tableMissing/);
});

test("the Player's Guide population d100 imports under its ANCESTRY caption", async () => {
  const { parseByShape, computeBlockers } = await import("../scripts/importer/tables/table-importer.mjs");
  const { resolveShape, contentIdForName } = await import("../scripts/importer/tables/table-shapes.mjs");
  // Invented bands in the page's layout: prose, then the caption and a d100
  // whose last band is "00", then the page number.
  const text = [
    "ANCESTRIES",
    "Placeholder prose about who lives where.",
    "ANCESTRY",
    "d100 Ancestry",
    "01-60 Alpha",
    "61-90 Beta",
    "91-99 Gamma",
    "00 Delta",
    "14",
  ].join("\n");
  const name = "Ancestry (Population)";
  const shape = resolveShape({ contentId: contentIdForName(name, "WR"), name, src: "WR" });
  assert.equal(shape?.kind, "section");
  const pt = parseByShape(text, shape, { name }).tables[0];
  assert.equal(pt.formula, "1d100");
  assert.deepEqual(pt.rows.map((r) => [r.min, r.max, r.text]),
    [[1, 60, "Alpha"], [61, 90, "Beta"], [91, 99, "Gamma"], [100, 100, "Delta"]]);
  assert.deepEqual(computeBlockers(pt), []);
});
