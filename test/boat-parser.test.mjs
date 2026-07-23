import test from "node:test";
import assert from "node:assert/strict";
import { parseBoats, boatDraftToActorData, BOAT_MANIFEST } from "../scripts/importer/boats/boat-parser.mjs";

// Synthetic table: the eight real boat NAMES (already in the manifest) with
// made-up stats — the parser is exercised without reproducing the WR data table.
const SAMPLE = `
Passengers. A boat can carry a number of passengers equal to its HP.
BOATS
Name Cost Speed AC HP Gear Slots Properties
Canoe 111 gp 3 8 5 15 -
Galleon 2,222 gp 9 16 90 400 C, R, W
Longboat 555 gp 7 14 44 222 C, F, R
Raft 99 gp 1 5 7 13 U
Crew (C). This boat can't move without 4+ trained crew aboard.
Fast (F). This boat has a speed of double near in combat.
`;

test("parseBoats reads only boat rows, skipping prose + the property legend", () => {
  const boats = parseBoats(SAMPLE);
  assert.equal(boats.length, 4);
  assert.deepEqual(boats.map((b) => b.name), ["Canoe", "Galleon", "Longboat", "Raft"]);
});

test("parseBoats maps every column", () => {
  const [canoe, galleon] = parseBoats(SAMPLE);
  assert.deepEqual(
    { cost: canoe.cost, speed: canoe.speed, ac: canoe.ac, hp: canoe.hp, gearSlots: canoe.gearSlots },
    { cost: 111, speed: 3, ac: 8, hp: 5, gearSlots: 15 },
  );
  assert.equal(galleon.cost, 2222, "commas stripped from cost");
});

test("parseBoats decodes property letters into flags ('-' = none)", () => {
  const boats = parseBoats(SAMPLE);
  const by = Object.fromEntries(boats.map((b) => [b.name, b.props]));
  assert.deepEqual(by.Canoe, {});
  assert.deepEqual(by.Galleon, { crew: true, rowGalley: true, weapons: true });
  assert.deepEqual(by.Longboat, { crew: true, fast: true, rowGalley: true });
  assert.deepEqual(by.Raft, { unseaworthy: true });
});

test("parseBoats is idempotent on duplicate rows", () => {
  assert.equal(parseBoats(SAMPLE + "\nCanoe 111 gp 3 8 5 15 -").length, 4);
});

test("boatDraftToActorData maps to the boat data model", () => {
  const [, galleon] = parseBoats(SAMPLE);
  const data = boatDraftToActorData(galleon);
  assert.equal(data.type, "shadowdark-enhancer.boat");
  assert.equal(data.system.boatType, "Galleon");
  assert.equal(data.system.cost, 2222);
  assert.deepEqual(data.system.hp, { value: 90, max: 90 });
  assert.equal(data.system.ac, 16);
  assert.equal(data.system.speed, 9);
  assert.equal(data.system.gearSlots.max, 400);
  assert.equal(data.system.crew.required, 4, "the Crew property sets a 4-crew requirement");
  assert.equal(data.system.properties.weapons, true);
  assert.equal(data.system.properties.fast, false);
  assert.equal(data.system.properties.rowGalley, true, "R maps to the Row Galley flag");
  assert.ok(!("portage" in data.system.properties), "WR dropped CS3's Portage");
  assert.ok(!("oars" in data.system.properties), "the oars flag was renamed to rowGalley");
  assert.match(data.system.notes, /Cost: 2,222 gp/);
});

test("parseBoats handles the column-per-line layout a PDF grab produces", () => {
  // Each cell on its own line, with header + prose around it (synthetic stats).
  const COLS = `
BOATS
Name
 Cost
 Speed
 AC
 HP
 Gear Slots
 Properties
Sloop
 321 gp
 6
 13
 33
 111
 C
Sailboat
 654 gp
 7
 14
 55
 222
 C, F, W
`;
  const boats = parseBoats(COLS);
  assert.deepEqual(boats.map((b) => b.name), ["Sloop", "Sailboat"]);
  assert.equal(boats[0].cost, 321);
  assert.equal(boats[0].hp, 33);
  assert.deepEqual(boats[0].props, { crew: true });
  assert.deepEqual(boats[1].props, { crew: true, fast: true, weapons: true });
});

test("parseBoats zips the split table a two-column PDF grab produces", () => {
  // Gutter splits the table: Name/Cost/Speed half, then the AC/HP/Slots/Props
  // half, each in row order, with prose in between (synthetic stats).
  const SPLIT = `
Name Cost Speed
Canoe 111 gp 3
Galleon 222 gp 9
Repair. Repairs take one week.
BOATS
AC HP Gear Slots Properties
8 5 15 -
16 90 400 C, R, W
Unseaworthy (U). ...
`;
  const boats = parseBoats(SPLIT);
  assert.deepEqual(boats.map((b) => b.name), ["Canoe", "Galleon"]);
  assert.deepEqual(
    { cost: boats[0].cost, speed: boats[0].speed, ac: boats[0].ac, hp: boats[0].hp, gearSlots: boats[0].gearSlots },
    { cost: 111, speed: 3, ac: 8, hp: 5, gearSlots: 15 },
  );
  assert.deepEqual(boats[0].props, {});
  assert.deepEqual(boats[1].props, { crew: true, rowGalley: true, weapons: true });
  assert.equal(boats[1].hp, 90);
});

test("BOAT_MANIFEST is names + source only (no bundled stats)", () => {
  assert.equal(BOAT_MANIFEST.length, 8);
  for (const b of BOAT_MANIFEST) {
    assert.deepEqual(Object.keys(b).sort(), ["name", "page", "src"]);
    assert.equal(b.src, "WR");
  }
});
