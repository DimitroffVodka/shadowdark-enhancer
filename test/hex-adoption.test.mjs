import test from "node:test";
import assert from "node:assert/strict";
import { planHexAdoption, planHexFogImport, parseOffsetKey, printFor } from "../scripts/hex-map/hex-adoption.mjs";

const numberAt = ({ i, j }) => i === 0 && j === 0 ? 101 : null;
test("already adopted E3 records import revealed/near fog, preserving native conceal and arrival history", () => {
  const legacy = {
    "2_2": { terrain: "Mountain", name: "Old", rollTable: "RollTable.a", rollTableFirstOnly: true, custom: { untouched: true } },
    "3_2": { terrain: "Forest", name: "Near" },
    "4_2": { terrain: "Hill", name: "Authored conceal" },
    "5_2": { terrain: "Plain", discovery: { revealed: false, visited: false } },
  };
  // The predecessor plan is unchanged: these false defaults are real E3 output.
  const prior = planHexAdoption({ sceneUuid: "Scene.a", legacy }).cells;
  prior["4_2"] = { ...prior["4_2"], title: "GM edit", discovery: { revealed: false, visited: false, locationRevealed: false } };
  const before = structuredClone(prior);
  const flags = { hexFogRevealed: { "2-2": true, "4-2": true, "5-2": true }, hexFogDiscovery: { "3-2": "near" }, hexRolledCells: { "2_2": true }, unknown: { keep: true } };
  const fog = planHexFogImport(prior, flags);
  for (const key of ["2_2", "3_2"]) assert.deepEqual(fog.cells[key].discovery, { revealed: true, visited: false });
  assert.deepEqual(fog.cells["4_2"].discovery, prior["4_2"].discovery);
  assert.deepEqual(fog.cells["5_2"].discovery, prior["5_2"].discovery, "explicit legacy/native discovery is not synthesized");
  assert.equal(fog.cells["2_2"].arrivalRolled, true);
  assert.deepEqual(fog.cells["2_2"].custom, { untouched: true });
  assert.deepEqual(fog.legacy, flags);
  assert.deepEqual(prior, before);
  const concealed = structuredClone(fog.cells);
  concealed["2_2"].discovery.revealed = false;
  assert.equal(planHexFogImport(concealed, flags).cells["2_2"].discovery.revealed, false, "conceal after migration is retained");
});
test("pristine numbered E3 records migrate, but an edited predecessor record retains false disclosure", () => {
  const legacy = { "0_0": { terrain: "Forest", name: "Old" } };
  const prior = planHexAdoption({ sceneUuid: "Scene.a", legacy, tags: { origin: {}, cells: {} }, numberAt }).cells;
  const flags = { hexFogRevealed: { "0-0": true } };
  assert.equal(planHexFogImport(prior, flags).cells["0_0"].discovery.revealed, true);
  prior["0_0"].notes = [];
  assert.equal(planHexFogImport(prior, flags).cells["0_0"].discovery.revealed, false, "E3 editor writes must not be mistaken for pristine imports");
});
test("legacy offset parser keeps both negative axes, underscores and fog-style hyphens", () => {
  assert.deepEqual(parseOffsetKey("-2_-3"), { i: -2, j: -3 });
  assert.deepEqual(parseOffsetKey("-2--3"), { i: -2, j: -3 });
  assert.deepEqual(parseOffsetKey("2--3"), { i: 2, j: -3 });
  for (const key of ["1_2_3", "hex101", "1.2_3", "", "9007199254740992_0"]) assert.equal(parseOffsetKey(key), null);
});
test("adoption preserves rich and unknown fields and custom links without mutating legacy", () => {
  const legacy = { "-2_-3": { name: "Ford", terrain: "Forest", features: [{ id: "custom", type: "river", extra: { a: 1 } }], notes: [{ text: "Secret", visible: false }], links: [{ custom: "keep" }], unfamiliar: { list: [1, 2] } } };
  const before = structuredClone(legacy);
  const p = planHexAdoption({ sceneUuid: "Scene.a", legacy, numberAt });
  assert.deepEqual(p.cells["-2_-3"].legacy, before["-2_-3"]);
  assert.deepEqual(p.cells["-2_-3"].unfamiliar, { list: [1, 2] });
  assert.deepEqual(p.cells["-2_-3"].links, legacy["-2_-3"].links);
  assert.equal(p.cells["-2_-3"].title, "Ford");
  assert.deepEqual(legacy, before);
  assert.match(p.report.warningKey, /legacyPrivacy/);
});
test("existing Enhancer fields and tags win; original conflict is archived; rerun is idempotent", () => {
  const legacy = { "0_0": { name: "Old", terrain: "Forest", notes: [{ text: "legacy" }], features: [{ type: "river" }] } };
  const existing = { "0_0": { title: "New", notes: [], discovery: { revealed: false, visited: false } } };
  const tags = { version: 1, origin: { q: 0 }, cells: { 101: "swamp;path|auto:1.42?" } };
  const p = planHexAdoption({ sceneUuid: "Scene.a", legacy, existing, tags, numberAt });
  assert.equal(p.cells["0_0"].title, "New");
  assert.deepEqual(p.cells["0_0"].notes, []);
  assert.deepEqual(p.tags, tags);
  assert.ok(p.report.conflicts.some(c => c.field === "title"));
  assert.ok(p.report.conflicts.some(c => c.field === "tags"));
  const again = planHexAdoption({ sceneUuid: "Scene.a", legacy, existing: p.cells, tags: p.tags, numberAt });
  assert.deepEqual(again.cells, p.cells);
  assert.deepEqual(again.tags, p.tags);
});
test("missing numbered terrain goes into the existing tag store; river tile remains distinct", () => {
  for (const [terrain, features, expected] of [["River", [], "river|sdx"], ["Forest", [{ type: "river" }], "forest;river|sdx"]]) {
    const p = planHexAdoption({ sceneUuid: "Scene.a", legacy: { "0_0": { terrain, features } }, tags: { origin: {}, cells: {} }, numberAt });
    assert.equal(p.tags.cells[101], expected);
    assert.equal(p.cells["0_0"].terrain, undefined, "numbered terrain has one authority");
    assert.equal(p.cells["0_0"].legacy.terrain, terrain);
  }
});
test("malformed rows are reported, not silently adopted or silently erased", () => {
  const p = planHexAdoption({ sceneUuid: "Scene.a", legacy: { bad: { terrain: "Forest" }, "0_1": null, "0_2": [], "-1_2": { terrain: "Hill" } }, numberAt });
  assert.equal(p.report.skipped.length, 3);
  assert.equal(Object.keys(p.cells).length, 1);
  assert.deepEqual(p.report.skipped[0].input, { terrain: "Forest" });
  assert.throws(() => planHexAdoption({ legacy: [] }), /unreadable/);
});
test("a cell's own legacy field is archived whole and reported, not silently overwritten", () => {
  const legacy = { "0_0": { name: "Old", terrain: "Forest", legacy: "USER" } };
  const p = planHexAdoption({ sceneUuid: "Scene.a", legacy, numberAt });
  assert.deepEqual(p.cells["0_0"].legacy, { name: "Old", terrain: "Forest", legacy: "USER" }, "the archive keeps the original field nested");
  assert.equal(p.cells["0_0"].legacy.legacy, "USER");
  assert.ok(p.report.conflicts.some(c => c.key === "0_0" && c.field === "legacy"));
});

const MOD = "shadowdark-enhancer", XTRA = "shadowdark-extras";
const bounds = { cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 };
// `at` is the Foundry offset {i, j} of the print's first hex; {0, 0} is the top-left cell Extras numbers 0000 from.
const print = (extra = {}, { at = { i: 0, j: 0 }, num = "0000", shifted = "odd", bounds: b = bounds } = {}) => ({ grid: { type: 4 }, flags: { [MOD]: { hexTags: {
  origin: { q: at.j, r: at.i - (at.j - (at.j & 1)) / 2, num, shifted, bounds: b } } }, [XTRA]: { hexcrawl: {} } }, ...extra });
const painted = (grid = { ...bounds, origin: 0 }, type = 4) => ({ grid: { type }, flags: { [XTRA]: { hexScene: true, hexcrawl: { grid } } } });
test("a painted scene finds the one tagged print with its numbering bounds and grid type", () => {
  const a = print(), p = painted();
  assert.equal(printFor(p, [a, p, print({ grid: { type: 5 } })]), a);
  assert.equal(printFor(p, [a, print()]), null, "two prints fit: it cannot pick");
  assert.equal(printFor(p, [p]), null, "no print");
  assert.equal(printFor(painted({ ...bounds, cols: 40 }), [a]), null, "another map's size");
  assert.equal(printFor(painted({ ...bounds, flipX: true }), [a]), null, "mirrored numbering is not the print's");
  assert.equal(printFor(a, [a, print()]), null, "a print is not a painted scene");
});
test("a print whose top row is full hexes finds its painted scene: the layout leaves firstRow out when it is the origin", () => {
  const full = print({}, { bounds: { cols: 64, rows: 75, firstRow: 0 } });
  assert.equal(printFor(painted({ cols: 64, rows: 75, origin: 0 }), [full]), full, "0000, top row full");
  assert.equal(printFor(painted({ cols: 64, rows: 75, origin: 0, firstRow: 1 }), [full]), null, "the print has the row, Extras drops it");
  const framed = print({}, { bounds: { cols: 64, rows: 75, firstRow: 1 } });
  assert.equal(printFor(painted({ cols: 64, rows: 75, origin: 0 }), [framed]), null, "Extras has the row, the print drops it");
  assert.equal(printFor(painted({ cols: 64, rows: 75, origin: 0, firstRow: 1 }), [framed]), framed, "both drop it");
  const from1 = (firstRow) => print({}, { num: "0101", shifted: "even", bounds: { cols: 64, rows: 75, firstRow } });
  const frame1 = from1(1), full1 = from1(0);
  assert.equal(printFor(painted({ cols: 64, rows: 75, origin: 1 }), [frame1]), frame1, "0101: the stored 1 is the origin row, so the layout names none");
  assert.equal(printFor(painted({ cols: 64, rows: 75, origin: 1 }), [full1]), null, "0101: a stored 0 is not the origin row");
});
test("a print anchored off the top-left cell is not the painted scene's print: Extras numbers its hexes from another cell", () => {
  const p = painted();
  assert.equal(printFor(p, [print({}, { at: { i: 1, j: 0 } })]), null, "a row of margin above the first hex (topRows 1)");
  assert.equal(printFor(p, [print({}, { at: { i: 2, j: 3 } })]), null, "anchored by hand on another cell");
  assert.equal(printFor(p, [print({}, { at: { i: 0, j: 1 } })]), null, "anchored a column over");
  assert.equal(printFor(p, [print({}, { shifted: "even" })]), null, "the print lowers the other columns");
  const aligned = print({}, { num: "0101", shifted: "even" });
  assert.equal(printFor(painted({ ...bounds, origin: 1 }), [aligned]), aligned, "numbered from 0101, still the top-left cell");
  assert.equal(printFor(p, [{ grid: { type: 4 }, flags: { [MOD]: { hexTags: { origin: { bounds } } } } }]), null, "no anchor cell to place it by");
});
