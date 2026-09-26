// The Character Builder's Random ancestry from a population table (#187).
// Foundry is stubbed: game.settings, fromUuid and a RollTable whose roll walks
// every d100 face in turn, so the counts are exact rather than statistical.
// Every ancestry and band here is INVENTED; no book's table is in this repo.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rollAncestryFromTable } from "../scripts/char-builder/data.mjs";

const ANCESTRIES = ["Ashling", "Brine-Folk", "Cragborn", "Dunewalker", "Folk"]
  .map((name) => ({ name, uuid: `Compendium.world.ancestries.Item.${name}` }));

// Invented odds, with a result spelled differently from the item it names.
const BANDS = [[1, 50, "Ashling"], [51, 80, "brine-folk"], [81, 99, "CRAGBORN"], [100, 100, "Dunewalker"]];

function populationTable(bands = BANDS) {
  let face = 0;
  return {
    name: "Invented Population",
    async roll() {
      face = (face % 100) + 1;
      const [, , text, documentUuid] = bands.find(([lo, hi]) => face >= lo && face <= hi);
      return { results: text === null ? [] : [{ name: text, description: "", documentUuid }] };
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

test("with no table set, Random keeps the weighted pick", async () => {
  assert.equal(await rollAncestryFromTable(ANCESTRIES), null);
  assert.deepEqual(warnings, []);
});

test("1,000 Randoms follow the table's odds, whatever case the results are in", async () => {
  setting = "Compendium.world.tables.RollTable.pop";
  tables.set(setting, populationTable());
  const counts = new Map();
  for (let i = 0; i < 1000; i++) {
    const pick = await rollAncestryFromTable(ANCESTRIES);
    counts.set(pick.name, (counts.get(pick.name) ?? 0) + 1);
  }
  assert.equal(counts.get("Ashling"), 500);
  assert.equal(counts.get("Brine-Folk"), 300, "\"brine-folk\" lands on Brine-Folk");
  assert.equal(counts.get("Cragborn"), 190);
  assert.equal(counts.get("Dunewalker"), 10);
  assert.equal(counts.get("Folk"), undefined, "a longer name is never read as the shorter one");
  assert.deepEqual(warnings, []);
});

test("a row that links an ancestry picks it through the link", async () => {
  setting = "Compendium.world.tables.RollTable.linked";
  tables.set(setting, populationTable([[1, 100, "Someone odd", "Compendium.world.ancestries.Item.Cragborn"]]));
  assert.equal((await rollAncestryFromTable(ANCESTRIES))?.name, "Cragborn");
  assert.deepEqual(warnings, []);
});

test("a result naming no installed ancestry falls back and says which", async () => {
  setting = "Compendium.world.tables.RollTable.odd";
  tables.set(setting, populationTable([[1, 100, "Moonkin"]]));
  assert.equal(await rollAncestryFromTable(ANCESTRIES), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tableNoMatch/);
  assert.match(warnings[0], /Moonkin/);
});

test("a table that gives nothing says so, not that it rolled \"\"", async () => {
  setting = "Compendium.world.tables.RollTable.empty";
  tables.set(setting, populationTable([[1, 100, null]]));
  assert.equal(await rollAncestryFromTable(ANCESTRIES), null);
  assert.match(warnings[0] ?? "", /tableEmpty/);
  assert.doesNotMatch(warnings[0] ?? "", /tableNoMatch/);
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
