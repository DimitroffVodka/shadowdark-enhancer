import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const EN = JSON.parse(readFileSync("languages/en.json", "utf8"));
globalThis.game = {
  i18n: { format: (key, data) => String(EN[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)) },
};

import { parseByShape } from "../scripts/importer/tables/table-importer.mjs";

// Invented text in the layouts the Cursed Scroll pages print. Nothing here is book text.

const rowsOf = (bucket, i = 0) => (bucket?.tables?.[i]?.rows ?? []).map((r) => r.text);

test("nth: a caption printed twice reads the one asked for (CS5 p3 prints ENCOUNTER ZONE twice, the second is the encounters)", () => {
  const page = [
    "ENCOUNTER ZONE", "d4 Caves Tunnels", "1 Horror Horror", "2 Beast Beast", "3 People People", "4 People Beast",
    "RUMORS", "1 First", "2 Second",
    "ENCOUNTER ZONE", "d4 Horror Beast", "1 Aboleth 2d8 bats", "2 Ghasts 1d4 wendels", "3 Ropers 1d6 gricks", "4 Bezelak Gorgon",
  ].join("\n");
  const shape = (nth) => ({ kind: "gridcol", caption: "ENCOUNTER ZONE", col: 0, ncols: 2, cols: "layout", ...(nth ? { nth } : {}) });
  assert.deepEqual(rowsOf(parseByShape(page, shape())), ["Horror", "Beast", "People", "People"], "the first, as before");
  assert.deepEqual(rowsOf(parseByShape(page, shape(1))), ["Aboleth", "Ghasts", "Ropers", "Bezelak"], "the second");
  assert.equal(parseByShape(page, shape(2)), null, "there is no third");
});

test("nth reaches a section, a banded block and a labeled section as well", () => {
  const page = ["RANDOM ENCOUNTERS", "d2 Details", "1 First list one", "2 First list two",
    "RANDOM ENCOUNTERS", "d2 Details", "1 Second list one", "2 Second list two"].join("\n");
  assert.deepEqual(rowsOf(parseByShape(page, { kind: "section", cols: "1", caption: "RANDOM ENCOUNTERS", size: 2, nth: 1 })), ["Second list one", "Second list two"]);
  assert.deepEqual(rowsOf(parseByShape(page, { kind: "banded", cols: "auto", caption: "RANDOM ENCOUNTERS", size: 2, nth: 1 })), ["Second list one", "Second list two"]);
});

test("banded: faces run 1, 2, 3, 4 in order, so a row that opens with a number is not a face (CS4's Black Ziggurat)", () => {
  // The first row's text begins "2 void beings", above its own centred face "1". Read as face 2 it swallowed the
  // real row 1 and left three rows of four.
  const page = [
    "RANDOM ENCOUNTERS",
    "d4 Details",
    "2 void beings drag a wayward",
    "1",
    "explorer (soldier) toward Area 9",
    "A pulse of purple energy from",
    "2",
    "The Nexus extinguishes all light",
    "3 1d6 roosting void bats stir",
    "4 1d4 death slugs fall from above",
    "The Nexus. Living creatures who touch",
  ].join("\n");
  const rows = rowsOf(parseByShape(page, { kind: "banded", cols: "auto", caption: "RANDOM ENCOUNTERS", size: 4 }));
  assert.equal(rows.length, 4);
  assert.equal(rows[0], "2 void beings drag a wayward explorer (soldier) toward Area 9");
  assert.equal(rows[1], "A pulse of purple energy from The Nexus extinguishes all light");
  assert.equal(rows[2], "1d6 roosting void bats stir");
  assert.equal(rows[3], "1d4 death slugs fall from above");
});

test("banded: a table whose faces do not start at 1 still reads as before", () => {
  // The old rule (a face that steps backwards is a wrapped line) stays the fallback.
  const page = ["TRAINING", "d6 Details", "2-3 Gain a favour", "4-5 Lose a favour", "6 Nothing happens"].join("\n");
  const rows = rowsOf(parseByShape(page, { kind: "banded", cols: "auto", caption: "TRAINING", size: 6 }));
  assert.equal(rows.length, 3);
});

test("banded noise:map drops the map's area numbers and key letters printed over a table, and only when the recipe asks", () => {
  // CS4's site pages print the adventure map over the encounter table: area numbers doubled ("33"), the key's
  // letters ("S", "P"). Left in, a row reads "1d4 skandrill scuffling over a 33 twisted scrap of metal".
  const page = [
    "RANDOM ENCOUNTERS", "d4 Details",
    "33 1d4 skandrill scuffling over a",
    "1",
    "22 twisted scrap of metal",
    "2 A sneaking salamander thief",
    "3 A cobra basking on a hot rock S",
    "4 P Three roving warriors creep in",
  ].join("\n");
  const shape = (extra) => ({ kind: "banded", cols: "auto", caption: "RANDOM ENCOUNTERS", size: 4, ...extra });
  assert.deepEqual(rowsOf(parseByShape(page, shape({ noise: "map" }))), [
    "1d4 skandrill scuffling over a twisted scrap of metal",
    "A sneaking salamander thief",
    "A cobra basking on a hot rock",
    "Three roving warriors creep in",
  ]);
  assert.match(rowsOf(parseByShape(page, shape()))[0], /33/, "without the option nothing is touched");
});

test("banded noise:map keeps words that are not noise: a leading A or I, counts like 1d4, and numbers that are not doubled", () => {
  const page = ["RANDOM ENCOUNTERS", "d3 Details", "1 A fearful peasant from Area 8", "2 I am the walrus, 2d4 of them", "3 1d4 skeletons in Area 12"].join("\n");
  const rows = rowsOf(parseByShape(page, { kind: "banded", cols: "auto", caption: "RANDOM ENCOUNTERS", size: 3, noise: "map" }));
  assert.deepEqual(rows, ["A fearful peasant from Area 8", "I am the walrus, 2d4 of them", "1d4 skeletons in Area 12"]);
});

test("list: a page that is one numbered list under a plain heading, with no die line", () => {
  const page = [
    "Salamander NPCs",
    "1. Aliz. Glittering orange, zealous, militant.",
    "2. Baltazir. Glorious frills of blue-white. Regal,",
    "proud, haughty. Insufferable.",
    "3. Boaba. Deep purple scales. Ambitious.",
    "63",
  ].join("\n");
  const bucket = parseByShape(page, { kind: "list", size: 3 }, { name: "Salamander NPCs" });
  assert.equal(bucket.tables[0].formula, "1d3");
  assert.deepEqual(rowsOf(bucket), [
    "Aliz. Glittering orange, zealous, militant.",
    "Baltazir. Glorious frills of blue-white. Regal, proud, haughty. Insufferable.",
    "Boaba. Deep purple scales. Ambitious.",
  ]);
});

test("list: printed keys that do not run from 1 (the City of Masks' d40 prints 10 to 49) become 1 to N in order", () => {
  const page = ["d40 NPCs in the City of Masks", "10: Ratvort Bingle, short and greasy", "11: Mistress Savoy, elderly", "12: Amril Tovin, a baker", "3"].join("\n");
  const bucket = parseByShape(page, { kind: "list", size: 3 }, { name: "NPCs" });
  assert.deepEqual(rowsOf(bucket), ["Ratvort Bingle, short and greasy", "Mistress Savoy, elderly", "Amril Tovin, a baker"]);
  assert.deepEqual(bucket.tables[0].rows.map((r) => [r.min, r.max]), [[1, 1], [2, 2], [3, 3]]);
});

test("list: a count that is not the die's size is said, not hidden", () => {
  const page = ["Duergar NPCs", "1. Bolgrim. Jolly.", "2. Borg. Quiet."].join("\n");
  const bucket = parseByShape(page, { kind: "list", size: 20 }, { name: "Duergar NPCs" });
  assert.equal(bucket.tables[0].rows.length, 2);
  const said = EN["SDE.importer.tables.listCount"].replace("{read}", "2").replace("{faces}", "20");
  assert.ok(bucket.tables[0].warnings.includes(said), "the warning comes from the language file and names both numbers");
  assert.match(said, /2 entries for a d20/);
});

test("list: no numbered rows means no table", () => {
  assert.equal(parseByShape("Just some prose\nwith no rows", { kind: "list", size: 4 }, { name: "x" }), null);
});
