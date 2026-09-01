/**
 * G8 — logical supporting-table registry.
 *
 * Table text below is synthetic.  The importer is exercised only for its
 * structural matrix split and identity stamping; no Core book prose ships in
 * this test.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  buildSupportingTableCatalog,
  buildSupportingTableSeed,
  definitionForRole,
  loadManagedSupportingTables,
  loadSystemSupportingTables,
  pickSupportingTableResult,
  resolveSupportingTableRole,
  SIGNATURE_TACTICS_IDENTITIES,
  SUPPORTING_ROLE_DEFINITIONS,
  SUPPORTING_ROLE_KEYS,
} from "../scripts/forge-loot/supporting-tables.mjs";
import {
  columnManifestId,
  findById,
} from "../scripts/importer/tables/table-manifest.mjs";
import { parseMatrixByColumns } from "../scripts/importer/tables/table-importer.mjs";

const SIGNATURE_ENTRY = findById("core-signature-tactics");

function syntheticMatrix(entry) {
  const lines = [entry.columns.join("  ")];
  for (let roll = 1; roll <= entry.rows; roll++) {
    const cells = entry.columns.map((column) => `${column} option ${roll}`);
    lines.push(`${roll} ${cells.join(" | ")}`);
  }
  return lines.join("\n");
}

function splitAsImporter(entry, text) {
  const split = parseMatrixByColumns(text, entry.columns, entry.widths);
  split.forEach((table, index) => {
    table.name = `${entry.name} - ${entry.columns[index]}`;
    table.manifestId = columnManifestId(entry.id, entry.columns[index]);
  });
  return split;
}

function liveDocument(manifestId, source = "CORE", name = manifestId, formula = "1d4") {
  return {
    id: `id-${manifestId}`,
    uuid: `Compendium.world.sde-tables.RollTable.${manifestId}`,
    name,
    formula,
    flags: { [MODULE_ID]: { manifestId, source } },
    results: [
      { id: "one", range: [1, 1], name: `${name} result one` },
      { id: "two", range: [2, 2], name: `${name} result two` },
      { id: "three", range: [3, 3], name: `${name} result three` },
      { id: "four", range: [4, 4], name: `${name} result four` },
    ],
  };
}

function allManagedDocuments() {
  const documents = [];
  for (const role of SUPPORTING_ROLE_KEYS) {
    const definition = SUPPORTING_ROLE_DEFINITIONS[role];
    if (definition.kind === "matrix") {
      for (const child of definition.children) {
        documents.push(liveDocument(child.manifestId, "CORE", child.expectedImportName, child.formula));
      }
    } else {
      documents.push(liveDocument(definition.manifestId, "CORE", definition.expectedImportName, definition.formula));
    }
  }
  return documents;
}

test("the existing matrix importer emits exact Signature Tactics identities and names", () => {
  const split = splitAsImporter(SIGNATURE_ENTRY, syntheticMatrix(SIGNATURE_ENTRY));
  assert.deepEqual(
    split.map((table) => table.manifestId),
    [
      "core-signature-tactics:lawful",
      "core-signature-tactics:neutral",
      "core-signature-tactics:chaotic",
    ],
  );
  assert.deepEqual(
    split.map((table) => table.name),
    [
      "Rival Crawlers: Signature Tactics - Lawful",
      "Rival Crawlers: Signature Tactics - Neutral",
      "Rival Crawlers: Signature Tactics - Chaotic",
    ],
  );
  for (const alignment of ["lawful", "neutral", "chaotic"]) {
    assert.deepEqual(SIGNATURE_TACTICS_IDENTITIES[alignment], {
      manifestId: `core-signature-tactics:${alignment}`,
      name: `Rival Crawlers: Signature Tactics - ${alignment[0].toUpperCase()}${alignment.slice(1)}`,
    });
  }
});

test("all NPC and Rival role families resolve from fresh managed imports", () => {
  const catalog = buildSupportingTableCatalog(allManagedDocuments());
  assert.equal(catalog.ready, true);
  for (const role of SUPPORTING_ROLE_KEYS) {
    if (role === "npc-name-by-ancestry") continue;
    const state = resolveSupportingTableRole(catalog, role);
    assert.equal(state.ready, true, role);
    assert.equal(state.diagnostics.length, 0, role);
  }
  assert.equal(
    resolveSupportingTableRole(catalog, "npc-name-by-ancestry", { ancestry: "Half-Orc" }).ready,
    true,
  );
  assert.equal(resolveSupportingTableRole(catalog, "signature-tactics:lawful").manifestId,
    "core-signature-tactics:lawful");
});

test("managed lookup uses stamped identity, so a GM rename does not break resolution", async () => {
  const documents = allManagedDocuments();
  const age = documents.find((document) => document.flags[MODULE_ID].manifestId === "core-age");
  age.name = "Age — GM's local label";
  const pack = {
    collection: "world.sde-tables",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Roll Tables" },
    getDocuments: async () => documents,
  };
  const managed = await loadManagedSupportingTables({ game: { packs: [pack] } });
  const catalog = buildSupportingTableCatalog(managed);
  const state = resolveSupportingTableRole(catalog, "age");
  assert.equal(state.ready, true);
  assert.equal(state.descriptor.name, "Age — GM's local label");
});

test("the two system-owned roles resolve only from their exact system UUIDs", async () => {
  const calls = [];
  const docs = {
    "Compendium.shadowdark.rollable-tables.RollTable.ljbaTPUHqeNzyM2b": {
      uuid: "Compendium.shadowdark.rollable-tables.RollTable.ljbaTPUHqeNzyM2b",
      name: "System ancestry",
      formula: "1d12",
      results: [],
    },
    "Compendium.shadowdark.rollable-tables.RollTable.TJCChWMoFSEf9qhK": {
      uuid: "Compendium.shadowdark.rollable-tables.RollTable.TJCChWMoFSEf9qhK",
      name: "System alignment",
      formula: "1d6",
      results: [],
    },
  };
  const loaded = await loadSystemSupportingTables({
    fromUuid: async (uuid) => {
      calls.push(uuid);
      return docs[uuid];
    },
  });
  assert.deepEqual(calls, Object.keys(docs));
  assert.deepEqual(
    loaded.map((document) => document.manifestId),
    ["core-random-ancestry", "core-random-alignment"],
  );
  assert.ok(loaded.every((document) => document.source === "core" && document.location === "system"));
});

test("the three tactic tables select rows through the resolved identity", () => {
  const documents = ["lawful", "neutral", "chaotic"].map((alignment) => {
    const identity = SIGNATURE_TACTICS_IDENTITIES[alignment];
    return liveDocument(identity.manifestId, "CORE", identity.name, "1d4");
  });
  const catalog = buildSupportingTableCatalog(documents);
  for (const alignment of ["lawful", "neutral", "chaotic"]) {
    const state = resolveSupportingTableRole(catalog, `signature-tactics:${alignment}`);
    const result = pickSupportingTableResult(state, () => 0.5);
    assert.equal(result.manifestId, `core-signature-tactics:${alignment}`);
    assert.equal(result.id, "three");
    assert.equal(result.range[0], 3);
  }
});

test("missing, name-only, foreign, and duplicate identities fail visibly", () => {
  const missing = buildSupportingTableCatalog(
    allManagedDocuments().filter((document) => document.flags[MODULE_ID].manifestId !== "core-age"),
  );
  const missingState = resolveSupportingTableRole(missing, "age");
  assert.equal(missingState.ready, false);
  assert.equal(missingState.status, "missing");
  assert.match(missingState.diagnostics[0].message, /age.*core-age/i);

  const nameOnly = buildSupportingTableCatalog([{ name: "Age", source: "CORE" }]);
  assert.equal(resolveSupportingTableRole(nameOnly, "age").status, "missing");

  const foreign = buildSupportingTableCatalog([liveDocument("core-age", "CS1", "Age")]);
  const foreignState = resolveSupportingTableRole(foreign, "age");
  assert.equal(foreignState.ready, false);
  assert.equal(foreignState.status, "foreign-source");
  assert.match(foreignState.diagnostics[0].message, /age.*core-age.*source/i);

  const duplicate = buildSupportingTableCatalog([
    liveDocument("core-age", "CORE", "Age 1"),
    liveDocument("core-age", "Core Rulebook", "Age 2"),
  ]);
  const duplicateState = resolveSupportingTableRole(duplicate, "age");
  assert.equal(duplicateState.ready, false);
  assert.equal(duplicateState.status, "duplicate");
  assert.match(duplicateState.diagnostics[0].message, /age.*core-age.*exactly one/i);
});

test("dynamic roles name the expected child identity when input is absent or unknown", () => {
  const absent = definitionForRole("npc-name-by-ancestry");
  assert.match(absent.expectedManifestId, /core-npc-names-by-ancestry:<ancestry-slug>/);
  const unknown = resolveSupportingTableRole("npc-name-by-ancestry", {
    descriptors: [],
    ancestry: "Dragon",
  });
  assert.equal(unknown.status, "invalid");
  assert.match(unknown.diagnostics[0].message, /npc-name-by-ancestry.*core-npc-names-by-ancestry:dragon/i);
});

test("seeds route matrix roles through the existing Table Hub creation path", () => {
  const seed = buildSupportingTableSeed("signature-tactics:lawful");
  assert.equal(seed.manifestId, "core-signature-tactics");
  assert.equal(seed.matrix, true);
  assert.deepEqual(seed.columns, ["Lawful", "Neutral", "Chaotic"]);
  assert.equal(seed.expectedManifestId, "core-signature-tactics:lawful");
  assert.equal(seed.expectedImportName, "Rival Crawlers: Signature Tactics - Lawful");
  assert.equal(buildSupportingTableSeed("identifier").requestedDie, "4d4");
});
