import test from "node:test";
import assert from "node:assert/strict";

import { gatherCharContentEntries } from "../scripts/importer/char-content/char-content-manifest.mjs";
import { buildTableData, parseByShape } from "../scripts/importer/tables/table-importer.mjs";
import {
  CONTENT,
  contentIdForName,
  resolveShape,
} from "../scripts/importer/tables/table-shapes.mjs";

// This is the shape produced by the real one-column PDF extraction: a caption,
// a single-spaced four-column header, then one numbered row per line. The cell
// boundaries are intentionally not marked with pipes; the registered reflow
// recipe must recover them from the known column order.
const NORD_PAGE = [
  "Cursed Scroll 3 p16: Nord Names",
  "NORD NAMES",
  "d20 Male Female Surname Title",
  "1 Frey Freya Erling Sun-Born",
  ...Array.from({ length: 19 }, (_, i) => {
    const n = i + 2;
    return `${n} Male${n} Female${n} Surname${n} Title${n}`;
  }),
].join("\n");

const STANDALONE_IDS = [
  "cs3/nord-male-names",
  "cs3/nord-female-names",
  "cs3/nord-surnames",
  "cs3/nord-titles",
];
const GENERATOR_IDS = [
  "cs3/nord-male-name-generator",
  "cs3/nord-female-name-generator",
];

test("Nord registry exposes four source tables and two selected-column generators", () => {
  for (const id of [...STANDALONE_IDS, ...GENERATOR_IDS]) {
    assert.ok(CONTENT[id], `${id} has a stable content id`);
    assert.equal(contentIdForName(CONTENT[id].names[0], "CS3"), id);
    assert.equal(resolveShape({ contentId: id }), CONTENT[id].shape);
  }
  assert.deepEqual(
    GENERATOR_IDS.map((id) => CONTENT[id].shape.columns),
    [["Male", "Surname", "Title"], ["Female", "Surname", "Title"]],
  );
});

test("Nord standalone shapes each retain their source column as a complete d20 table", () => {
  const tables = STANDALONE_IDS.map((id) => {
    const shape = CONTENT[id].shape;
    const bucket = parseByShape(NORD_PAGE, shape, { name: CONTENT[id].names[0] });
    assert.equal(bucket?.tables?.length, 1, `${id} produces one table`);
    return bucket.tables[0];
  });
  assert.deepEqual(tables.map((table) => table.name), [
    "Nord Male Names", "Nord Female Names", "Nord Surnames", "Nord Titles",
  ]);
  assert.deepEqual(tables.map((table) => [table.formula, table.rows.length]), [
    ["1d20", 20], ["1d20", 20], ["1d20", 20], ["1d20", 20],
  ]);
  assert.deepEqual(tables.map((table) => table.rows[0].text), [
    "Frey", "Freya", "Erling", "Sun-Born",
  ]);
});

test("Nord legacy shape emits exactly four standalone tables and two three-column generators", () => {
  const bucket = parseByShape(NORD_PAGE, CONTENT["cs3/nord-names"].shape, { name: "Nord Names" });
  assert.equal(bucket?.missing?.length, 0);
  assert.deepEqual(bucket?.tables?.map((table) => table.name), [
    "Nord Male Names", "Nord Female Names", "Nord Surnames", "Nord Titles",
  ]);
  assert.deepEqual(bucket?.generators?.map((generator) => generator.name), [
    "Nord Male Name Generator", "Nord Female Name Generator",
  ]);

  const [male, female] = bucket.generators;
  for (const [generator, given, first] of [
    [male, "Male", "Frey"],
    [female, "Female", "Freya"],
  ]) {
    assert.equal(generator.formula, "3d20");
    assert.equal(generator.compound.separator, " ");
    assert.deepEqual(generator.columns.map((column) => column.label), [given, "Surname", "Title"]);
    assert.deepEqual(generator.columns.map((column) => column.rows.filter((row) => row.text).length), [20, 20, 20]);
    assert.equal(generator.columns[0].rows[0].text, first);
    assert.equal(generator.columns[1].rows[0].text, "Erling");
    assert.equal(generator.columns[2].rows[0].text, "Sun-Born");

    // The persisted compound flag is the existing builder's source of truth;
    // only the selected three columns may reach it.
    const data = buildTableData(generator);
    const compound = data.flags?.["shadowdark-enhancer"]?.compound;
    assert.deepEqual(compound?.columns?.map((column) => column.label), [given, "Surname", "Title"]);
    assert.equal(compound?.separator, " ");
    assert.equal(
      generator.columns.map((column) => column.rows[0].text).join(generator.compound.separator),
      `${first} Erling Sun-Born`,
    );
  }
});

test("CS3 character manifest tracks the six new Nord identities, not the legacy compound", async () => {
  const presence = { present: new Set(), tablesPresent: new Set(), tablesBySource: new Set() };
  const cs3Tables = (await gatherCharContentEntries(presence))
    .filter((entry) => entry.src === "CS3" && entry.type === "Table")
    .map((entry) => entry.name)
    .filter((name) => /Cursed Scroll 3 p16: Nord /.test(name));
  assert.deepEqual(cs3Tables, [
    "Cursed Scroll 3 p16: Nord Male Names",
    "Cursed Scroll 3 p16: Nord Female Names",
    "Cursed Scroll 3 p16: Nord Surnames",
    "Cursed Scroll 3 p16: Nord Titles",
    "Cursed Scroll 3 p16: Nord Male Name Generator",
    "Cursed Scroll 3 p16: Nord Female Name Generator",
  ]);
});
