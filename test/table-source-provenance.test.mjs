/**
 * Table provenance regressions for the parser → resolver boundary.
 *
 * Fixtures are deliberately small but retain the real matrix shape: a known
 * column list, per-face rows, and the source/manifest metadata a seeded import
 * carries before it is split. No Foundry world is touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResolvedTableData,
  parseMatrixByColumns,
  parseTables,
} from "../scripts/importer/tables/table-importer.mjs";
import {
  buildSupportingTableCatalog,
  resolveSupportingTableRole,
} from "../scripts/forge-loot/supporting-tables.mjs";
import { columnManifestId } from "../scripts/importer/tables/table-manifest.mjs";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

const COLUMNS = ["Lawful", "Neutral", "Chaotic"];
const MATRIX_TEXT = [
  "d4 Lawful Neutral Chaotic",
  "1 lawful-1 | neutral-1 | chaotic-1",
  "2 lawful-2 | neutral-2 | chaotic-2",
  "3 lawful-3 | neutral-3 | chaotic-3",
  "4 lawful-4 | neutral-4 | chaotic-4",
].join("\n");

// Ensure the resolver exercises the explicit legacy folder path without
// needing Foundry's Folder class. The folder name is intentionally "Game
// Master": that is the false source the old fallback manufactured.
function fakePack() {
  return {
    collection: "world.sde-tables",
    documentName: "RollTable",
    folders: [
      { id: "gm", name: "Game Master", folder: null },
      { id: "tables", name: "Tables", folder: { id: "gm" } },
    ],
  };
}

function resolvedSource(data) {
  return data.flags?.[MODULE_ID]?.source;
}

test("CORE provenance survives every child of a matrix split", async () => {
  const split = parseMatrixByColumns(MATRIX_TEXT, COLUMNS, null, { source: "CORE" });
  assert.deepEqual(split.map((table) => table.source), ["CORE", "CORE", "CORE"]);

  const resolved = await Promise.all(split.map((table) => buildResolvedTableData({
    ...table,
    folderPath: ["Game Master", "Tables"],
  }, fakePack())));
  assert.deepEqual(resolved.map(resolvedSource), ["CORE", "CORE", "CORE"]);
});

test("CORE provenance survives the singleton parser path", async () => {
  const [table] = parseTables(
    "d4 Result\n1 one\n2 two\n3 three\n4 four",
    { source: "CORE" },
  );
  assert.equal(table.source, "CORE");

  const resolved = await buildResolvedTableData({
    ...table,
    folderPath: ["Game Master", "Tables"],
  }, fakePack());
  assert.equal(resolvedSource(resolved), "CORE");
});

test("a matrix split carries the pre-split manifestId until column identity is stamped", () => {
  const split = parseMatrixByColumns(
    MATRIX_TEXT,
    COLUMNS,
    null,
    { manifestId: "core-signature-tactics" },
  );
  assert.deepEqual(
    split.map((table) => table.manifestId),
    ["core-signature-tactics", "core-signature-tactics", "core-signature-tactics"],
  );
});

test("a source-less table stays distinguishable from a GM-authored table", async () => {
  const base = {
    name: "Untitled Provenance Check",
    formula: "1d2",
    rows: [{ min: 1, max: 1, text: "one" }, { min: 2, max: 2, text: "two" }],
    folderPath: ["Game Master", "Tables"],
  };
  const sourceLess = await buildResolvedTableData(base, fakePack());
  const gmAuthored = await buildResolvedTableData({ ...base, source: "Game Master" }, fakePack());

  assert.equal(resolvedSource(sourceLess), undefined);
  assert.equal(resolvedSource(gmAuthored), "Game Master");
  assert.notEqual(resolvedSource(sourceLess), resolvedSource(gmAuthored));
});

test("correctly sourced matrix children remain eligible for G8 source-qualified lookup", async () => {
  const catalogForSource = async (source) => {
    const split = parseMatrixByColumns(
      MATRIX_TEXT,
      COLUMNS,
      null,
      { source, manifestId: "core-signature-tactics" },
    );
    const documents = await Promise.all(split.map((table, index) => buildResolvedTableData({
      ...table,
      name: `Rival Crawlers: Signature Tactics - ${COLUMNS[index]}`,
      manifestId: columnManifestId("core-signature-tactics", COLUMNS[index]),
      folderPath: ["Game Master", "Tables"],
    }, fakePack())));
    return buildSupportingTableCatalog(documents.map((data) => ({
      name: data.name,
      flags: data.flags,
      results: data.results,
    })));
  };

  // Flip only the persisted source. This proves the G8 result is source
  // qualification, not an inability to construct the fixture's identities.
  const coreState = resolveSupportingTableRole(
    await catalogForSource("CORE"),
    "signature-tactics:lawful",
  );
  const gmState = resolveSupportingTableRole(
    await catalogForSource("Game Master"),
    "signature-tactics:lawful",
  );
  assert.equal(coreState.ready, true);
  assert.equal(coreState.descriptor.source, "core");
  assert.equal(coreState.descriptor.manifestId, "core-signature-tactics:lawful");
  assert.equal(gmState.ready, false);
  assert.equal(gmState.status, "foreign-source");
});
