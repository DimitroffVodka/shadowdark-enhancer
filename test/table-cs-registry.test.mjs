/**
 * The Cursed Scrolls' hexcrawl and adventure tables (cursed-scroll-tables.mjs).
 *
 * The catalogue always knew these rumors, encounters and rosters; nothing gave the
 * Manage tree a name, a page and a recipe for them, so "Import everything" never
 * imported them. These tests hold the three places that have to agree.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const EN = JSON.parse(readFileSync("languages/en.json", "utf8"));
globalThis.game = {
  journal: null,
  user: { isGM: true },
  i18n: {
    localize: (key) => EN[key] ?? key,
    format: (key, data) => String(EN[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)),
  },
};

const { CS_TABLES, CS_REGION } = await import("../scripts/importer/tables/cursed-scroll-tables.mjs");
const { importNameFor, findById, columnManifestId, isMatrix } = await import("../scripts/importer/tables/table-manifest.mjs");
const { contentIdForName, resolveShape } = await import("../scripts/importer/tables/table-shapes.mjs");
const { gatherCharContentEntries, CURSED_SCROLL_KEY_LOCATIONS, tablePagesFor } = await import("../scripts/importer/char-content/char-content-manifest.mjs");
const { _testBuildRollTables } = await import("../scripts/importer/manage-tree.mjs");
const { planBatch, ROUTE } = await import("../scripts/importer/batch-import.mjs");
const { parseZoneTableName, pickZoneTable, hexTableUuid } = await import("../scripts/encounter/encounter-terrain.mjs");
const { suiteMembersOf, suiteStatusOf, normalizeName } = await import("../scripts/importer/tables/table-hub.mjs");

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const presenceWith = (names) => ({
  present: new Set(), tablesPresent: new Set(names.map(norm)), tablesBySource: new Set(), tablesByManifestId: new Set(),
});
const facesOf = (die) => { const m = /^(\d*)d(\d+)/i.exec(die ?? ""); return m ? Number(m[1] || 1) * Number(m[2]) : null; };

test("every table answers for a catalogue row of its own book and page, with the count and die the page prints", () => {
  assert.equal(CS_TABLES.length, 48);
  for (const t of CS_TABLES) {
    const row = findById(t.id);
    assert.ok(row, `${t.id} is in the catalogue`);
    assert.equal(row.source.toUpperCase(), t.src, `${t.id}: book`);
    assert.equal(String(row.page), t.pages.split("-")[0], `${t.id}: first page`);
    // Read off the printed page, row by row. The catalogue's own numbers were wrong for nine of these
    // (the region rumors, the fortress d6s, the two rosters) and were corrected; this pins them.
    assert.equal(row.rows, t.rows, `${t.id}: rows`);
    if (["section", "banded", "list"].includes(t.shape.kind)) assert.equal(t.shape.size, facesOf(row.die), `${t.id}: die ${row.die}`);
  }
});

test("a grid names one table per catalogued column, so the per-column manifest ids line up", () => {
  const grids = CS_TABLES.filter((t) => t.shape.kind === "suite");
  assert.equal(grids.length, 17);
  for (const t of grids) {
    const row = findById(t.id);
    assert.ok(isMatrix(row), `${t.id} is a grid in the catalogue`);
    // The Black River prints "Encounter Type by Terrain" but files its columns "Encounter Type: <col>",
    // the name zone discovery reads (Tal-Yool's grid does the same).
    const prefix = t.name.replace(/ Encounter Type by Terrain$/, " Encounter Type");
    assert.deepEqual(t.shape.members.map((m) => m.name), row.columns.map((c) => `${prefix}: ${c}`), t.id);
    assert.equal(t.rows, row.rows, `${t.id}: rows in each column`);
    assert.deepEqual(row.columns.map((c) => columnManifestId(row.id, c)).length, row.columns.length);
  }
});

test("names are unique in their book, and the catalogue creates each table under exactly its name", () => {
  const seen = new Set();
  for (const t of CS_TABLES) {
    const key = `${t.src}|${norm(t.name)}`;
    assert.ok(!seen.has(key), `${t.src} names ${t.name} twice`);
    seen.add(key);
    assert.equal(importNameFor(findById(t.id)), t.name, `${t.id} is created under its own name`);
  }
});

test("each name resolves to its own recipe in its own book, and every recipe pins its extraction mode", () => {
  for (const t of CS_TABLES) {
    const id = contentIdForName(t.name, t.src);
    assert.ok(id, `${t.name} has a content id`);
    assert.equal(resolveShape({ contentId: id }), resolveShape({ name: t.name, src: t.src }), t.name);
    const shape = resolveShape({ contentId: id });
    assert.deepEqual(shape, t.shape, `${t.name} is registered with its recipe`);
    assert.ok(shape.extractCols, `${t.name} pins its extraction mode (the grab reads it first)`);
  }
  assert.equal(new Set(CS_TABLES.map((t) => contentIdForName(t.name, t.src))).size, 48, "no two share an id");
});

test("a map's tables carry the region name its key-location entry has, apart from the Guide's region of the same name", () => {
  // The travel check finds a hex's zone table by the region in the table's name and groups every imported
  // zone table by it, whatever book it came from. A plain "The Gloaming" would land in the Guide's group,
  // give a forest hex two Forest columns and make the Western Reaches check ambiguous.
  for (const [src, region] of Object.entries(CS_REGION)) {
    assert.ok(Object.keys(CURSED_SCROLL_KEY_LOCATIONS[src]).includes(region), `${src}: the key locations are titled ${region}`);
  }
  for (const src of ["CS1", "CS2", "CS3", "CS5"]) {
    const zone = CS_TABLES.find((t) => t.src === src && t.shape.kind === "suite" && /Encounter Zone$/.test(t.name));
    const parsed = zone.shape.members.map((m) => parseZoneTableName(`Cursed Scroll ${src.slice(2)} - ${m.name}`));
    assert.ok(parsed.every((p) => p?.region === CS_REGION[src]), `${src}: every column parses to ${CS_REGION[src]}`);
    assert.deepEqual(parsed.map((p) => p.column), findById(zone.id).columns, `${src}: the columns`);
  }
  assert.notEqual(parseZoneTableName("Cursed Scroll 1 - The Gloaming (Cursed Scroll 1) Encounter Zone: Forest").region,
    parseZoneTableName("Western Reaches GM Guide - The Gloaming Encounter Zone: Forest").region);
});

test("every Cursed Scroll grid the travel check reads is found by its region, and each hex terrain reaches its own column", () => {
  // Zone discovery keeps only "<Region> Encounter Zone: <col>" / "Encounter Type: <col>". The Black River's grid is
  // printed "Encounter Type by Terrain", so it has to file its columns as "Encounter Type: <col>" like Tal-Yool's does.
  const zones = new Map();
  for (const t of CS_TABLES.filter((x) => x.shape.kind === "suite" && /Encounter (Zone|Type)/.test(x.name))) {
    for (const m of t.shape.members) {
      const p = parseZoneTableName(`Cursed Scroll ${t.src.slice(2)} - ${m.name}`);
      assert.ok(p, `${t.src} ${m.name} is recognized by zone discovery`);
      assert.equal(p.region, CS_REGION[t.src]);
      zones.set(p.region, [...(zones.get(p.region) ?? []), { ...p, uuid: `uuid-${p.column}` }]);
    }
  }
  assert.deepEqual([...zones.keys()].sort(), Object.values(CS_REGION).sort(), "all five regions are discovered");
  const black = CS_REGION.CS4;
  const at = (terrain, features = []) => hexTableUuid({ num: 1, terrain, zone: black, features }, { zonesByRegion: zones, fallback: "none" }).uuid;
  assert.equal(at("jungle"), "uuid-Jungle");
  assert.equal(at("river"), "uuid-River");
  assert.equal(at("mountain"), "uuid-Mountain");
  assert.equal(at("jungle", ["coast"]), "uuid-Shoreline", "a coastal hex rolls the Shoreline column");
  assert.equal(pickZoneTable(black, "jungle", [], zones).status, "ok");
});

test("the Manage tree lists every table in its book's leaf with its catalogue id, page and recipe", async () => {
  const entries = await gatherCharContentEntries(presenceWith([]));
  const roll = _testBuildRollTables(entries, new Set(), new Set());
  for (const src of ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6"]) {
    const leaf = roll.children.find((c) => c.id === `tables/${src}`);
    assert.ok(leaf, `Roll Tables has a ${src} leaf`);
    for (const t of CS_TABLES.filter((x) => x.src === src)) {
      const e = leaf.entries.find((x) => x.name === t.name);
      assert.ok(e, `${src} lists ${t.name}`);
      assert.equal(e.manifestId, t.id, `${t.name}: the catalogue id rides on the row`);
      assert.equal(e.pages, t.pages, `${t.name}: page`);
      assert.equal(e.contentId, contentIdForName(t.name, t.src), `${t.name}: recipe id`);
      assert.equal(e.present, false);
    }
  }
  assert.equal(tablePagesFor("CS6", `${"The City of Masks"} Rumors`), "48-49");
});

test("a table reads as imported once it exists under its name, and a grid only when every column does", async () => {
  const oneTable = CS_TABLES.find((t) => t.id === "cs1-rumors-the-gloaming");
  const grid = CS_TABLES.find((t) => t.id === "cs1-encounter-zone");
  const columns = grid.shape.members.map((m) => `Cursed Scroll 1 - ${m.name}`);
  const present = async (names) => {
    const node = _testBuildRollTables(await gatherCharContentEntries(presenceWith(names)), new Set(), new Set());
    const leaf = node.children.find((c) => c.id === "tables/CS1");
    return (t) => leaf.entries.find((e) => e.name === t.name).present;
  };
  let is = await present([`Cursed Scroll 1 - ${oneTable.name}`]);
  assert.equal(is(oneTable), true);
  assert.equal(is(grid), false);
  is = await present(columns.slice(0, 3));
  assert.equal(is(grid), false, "three of four columns is not imported");
  is = await present(columns);
  assert.equal(is(grid), true);
});

test("Import everything plans one job per row, the way a click on it would", async () => {
  const roll = _testBuildRollTables(await gatherCharContentEntries(presenceWith([])), new Set(), new Set());
  const plan = planBatch([roll], { canRun: () => true });
  const jobs = plan.jobs.filter((j) => CS_TABLES.some((t) => t.name === j.entry.name && t.src === j.entry.src));
  assert.equal(jobs.length, 48);
  assert.ok(jobs.every((j) => j.route === ROUTE.HUB && j.entry.manifestId && j.entry.pages));
  assert.equal(new Set(jobs.map((j) => j.key)).size, 48, "each is its own job: a shared page does not fold two tables into one");
});

test("the Guide's tables are untouched: Manage still lists its regions under its own names", async () => {
  const entries = await gatherCharContentEntries(presenceWith([]));
  const guide = entries.filter((e) => e.src === "GMWR" && e.type === "Table").map((e) => e.name);
  assert.ok(guide.includes("The Gloaming Rumors") && guide.includes("The Gloaming Encounter Zone"));
  assert.ok(!CS_TABLES.some((t) => guide.includes(t.name)), "no Cursed Scroll table takes a Guide name");
});

test("the Roll Tables hub sees a grid as imported when its columns are there, though the catalogue names the row bare", () => {
  // The hub finds a grid's member names by the catalogue row's OWN name ("Encounter Zone"), and the registry
  // holds it under the map's region name, so without an alias every one of these grids read "missing" here
  // while the Manage tree showed them imported.
  for (const t of CS_TABLES.filter((x) => x.shape.kind === "suite")) {
    const row = findById(t.id);
    const members = suiteMembersOf(row);
    assert.deepEqual(members, t.shape.members.map((m) => m.name), `${t.id}: the hub finds the columns`);
    const book = `Cursed Scroll ${t.src.slice(2)}`;
    const world = new Map(members.map((m) => [normalizeName(`${book} - ${m}`), [{ name: `${book} - ${m}` }]]));
    assert.equal(suiteStatusOf(members, world).state, "imported", `${t.id}: all columns`);
    world.delete([...world.keys()][0]);
    assert.equal(suiteStatusOf(members, world).state, "partial", `${t.id}: one column short`);
  }
});

test("a bare catalogue name only resolves inside its own book, so the aliases take nothing from another", () => {
  for (const t of CS_TABLES.filter((x) => x.shape.kind === "suite")) {
    const bare = findById(t.id).name;
    assert.equal(contentIdForName(bare, t.src), contentIdForName(t.name, t.src), `${t.src} ${bare}`);
    assert.equal(contentIdForName(bare), null, `${bare} with no book stays unresolved: two books print it`);
  }
  // The Guide's own bare-named rows are not shadowed.
  assert.notEqual(contentIdForName("Encounters", "CS1"), contentIdForName("Encounters", "GMWR"));
});
