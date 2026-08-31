/**
 * G3 — pure readiness reports and the read-only source adapter.
 *
 * The classes here are intentionally Core/imported-shaped and synthetic rather
 * than named after the book's familiar classes.  The important contract is the
 * evidence and metadata, not a class-name lookup.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildClassReadinessReport,
  collectClassReadiness,
} from "../scripts/forge-loot/class-readiness-adapter.mjs";
import {
  CLASS_READINESS_VERSION,
  DEFAULT_DEFECT_QUEUE_LIMIT,
  G6A_UNSUPPORTED_TO_READINESS,
  READINESS_CODES,
  READINESS_SEVERITIES,
  assessClassReadiness,
  buildClassReadinessReport as buildPureReport,
  normalizeTalentRows,
  supportedChoiceVocabulary,
} from "../scripts/forge-loot/class-readiness.mjs";

const TALENT_ROWS = Object.freeze([
  { lo: 2, hi: 2, text: "First outcome" },
  { lo: 3, hi: 6, text: "Second outcome" },
  { lo: 7, hi: 9, text: "Third outcome" },
  { lo: 10, hi: 11, text: "Fourth outcome" },
  { lo: 12, hi: 12, text: "Fifth outcome" },
]);

const viaFor = (rows = TALENT_ROWS, via = "system") => rows.map((row) => ({
  wired: via !== null,
  via,
  match: via ? row.text : null,
}));

const levelGrid = (change = {}) => Object.fromEntries(
  Array.from({ length: 6 }, (_, index) => {
    const level = index + 1;
    return [String(level), { "1": 1, "2": null, "3": null, "4": null, "5": null, ...change[level] }];
  }),
);

const validClass = (extra = {}) => {
  const base = {
    uuid: "Compendium.fixture.classes.synthetic",
    name: "Metadata Vessel",
    source: "core",
    system: {
      hitPoints: "d8",
      classTalentTable: { formula: "2d6", rows: TALENT_ROWS },
      spellcasting: { ability: "", class: "__not_spellcaster__" },
    },
  };
  const rows = extra.system?.classTalentTable?.rows ?? TALENT_ROWS;
  const wiring = Object.prototype.hasOwnProperty.call(extra, "talentWiring") ? extra.talentWiring : viaFor(rows);
  return { ...base, ...extra, system: { ...base.system, ...extra.system }, talentWiring: wiring };
};

const issueCodes = (record) => record.blockers.map((issue) => issue.code);

function hasCode(record, code) {
  return record.blockers.some((issue) => issue.code === code);
}

function hasWarning(record, code) {
  return record.warnings.some((issue) => issue.code === code);
}

test("the G3 pure module has no Foundry globals, module globals, or class-name branches", () => {
  const source = readFileSync(new URL("../scripts/forge-loot/class-readiness.mjs", import.meta.url), "utf8");
  for (const token of ["game.", "foundry.", "fromUuid", "Math.random", "shadowdark.", "Fighter", "Wizard", "Priest"]) {
    assert.equal(source.includes(token), false, `pure readiness must not use ${token}`);
  }
  assert.deepEqual(READINESS_SEVERITIES, ["blocker", "warning"]);
  assert.equal(typeof CLASS_READINESS_VERSION, "number");
  assert.equal(DEFAULT_DEFECT_QUEUE_LIMIT > 0, true);
});

test("valid Core, importer-managed, and unusual synthetic classes are eligible", () => {
  const core = validClass();
  const imported = validClass({ uuid: "Compendium.world.classes.imported", source: "importer-managed" });
  const unusual = validClass({
    uuid: "Compendium.world.classes.unusual",
    name: "Bog Lantern Cartographer",
    source: "importer",
    system: {
      hitPoints: "d6",
      classTalentTable: { formula: "2d6", rows: TALENT_ROWS },
      spellcasting: { ability: "", class: "__not_spellcaster__" },
    },
  });
  const report = buildPureReport([core, imported, unusual]);
  assert.equal(report.classes.length, 3);
  assert.equal(report.classes.every((record) => record.eligible), true);
  assert.deepEqual(report.classes.map((record) => record.source), ["core", "importer-managed", "importer-managed"]);
  assert.deepEqual(report.excluded, []);
});

test("classGateBlockers is reused and its original evidence stays visible", () => {
  const record = assessClassReadiness(validClass({ warnings: [
    "Spellcaster: informational",
    "BLOCKER: talent bands don't tile 2..12 — inspect the source",
  ] }));
  assert.equal(record.eligible, false);
  const blocker = record.blockers.find((issue) => issue.code === READINESS_CODES.QUALITY_GATE);
  assert.ok(blocker);
  assert.equal(blocker.message, "talent bands don't tile 2..12 — inspect the source");
  assert.deepEqual(blocker.evidence, {
    classId: "Compendium.fixture.classes.synthetic",
    className: "Metadata Vessel",
    gate: "classGateBlockers",
    warning: "talent bands don't tile 2..12 — inspect the source",
    warningIndex: 0,
  });
});

test("missing and unresolved talent tables are concrete blockers", () => {
  const missing = validClass({ system: { classTalentTable: undefined }, talentWiring: [] });
  delete missing.system.classTalentTable;
  const missingRecord = assessClassReadiness(missing);
  assert.equal(hasCode(missingRecord, READINESS_CODES.TALENT_TABLE_MISSING), true);
  assert.match(missingRecord.blockers.find((issue) => issue.code === READINESS_CODES.TALENT_TABLE_MISSING).message, /no class talent table/i);

  const unresolved = validClass({ system: { classTalentTable: "Compendium.fixture.tables.missing" }, talentWiring: [] });
  const unresolvedRecord = assessClassReadiness(unresolved);
  const issue = unresolvedRecord.blockers.find((entry) => entry.code === READINESS_CODES.TALENT_TABLE_UNRESOLVED);
  assert.ok(issue);
  assert.match(issue.message, /Compendium\.fixture\.tables\.missing/);
  assert.equal(issue.evidence.reference, "Compendium.fixture.tables.missing");
});

test("talent formula, range, gaps, overlaps, and invalid rows are all reported", () => {
  const invalidFormula = validClass({ system: {
    classTalentTable: { formula: "d20", rows: TALENT_ROWS },
  } });
  const formulaRecord = assessClassReadiness(invalidFormula);
  assert.equal(hasCode(formulaRecord, READINESS_CODES.TALENT_TABLE_INVALID), true);
  assert.match(formulaRecord.blockers.find((issue) => issue.code === READINESS_CODES.TALENT_TABLE_INVALID).message, /required 2–12/i);

  const gappedRows = [
    { lo: 2, hi: 2, text: "A" },
    { lo: 4, hi: 6, text: "B" },
    { lo: 7, hi: 9, text: "C" },
    { lo: 10, hi: 11, text: "D" },
    { lo: 12, hi: 12, text: "E" },
  ];
  const gapRecord = assessClassReadiness(validClass({
    system: { classTalentTable: { formula: "2d6", rows: gappedRows } },
    talentWiring: viaFor(gappedRows),
  }));
  const gap = gapRecord.blockers.find((issue) => issue.code === READINESS_CODES.TALENT_TABLE_NOT_TILED);
  assert.ok(gap);
  assert.match(gap.message, /2–12/);
  assert.ok(gap.evidence.issues.some((entry) => entry.kind === "gap"));

  const overlapRows = [
    { lo: 2, hi: 4, text: "A" },
    { lo: 4, hi: 6, text: "B" },
    { lo: 7, hi: 9, text: "C" },
    { lo: 10, hi: 11, text: "D" },
    { lo: 12, hi: 12, text: "E" },
  ];
  const overlapRecord = assessClassReadiness(validClass({
    system: { classTalentTable: { formula: "2d6", rows: overlapRows } },
    talentWiring: viaFor(overlapRows),
  }));
  assert.ok(overlapRecord.blockers.find((issue) => issue.code === READINESS_CODES.TALENT_TABLE_NOT_TILED)
    .evidence.issues.some((entry) => entry.kind === "overlap"));

  const invalidRow = [...TALENT_ROWS.slice(0, 4), { lo: 13, hi: 13, text: "Outside" }, { text: "No range" }];
  const invalidRowRecord = assessClassReadiness(validClass({
    system: { classTalentTable: { formula: "2d6", rows: invalidRow } },
    talentWiring: viaFor(invalidRow),
  }));
  const invalid = invalidRowRecord.blockers.find((issue) => issue.code === READINESS_CODES.TALENT_TABLE_NOT_TILED);
  assert.ok(invalid.evidence.issues.some((entry) => entry.kind === "out-of-bounds"));
  assert.ok(invalid.evidence.issues.some((entry) => entry.kind === "invalid-row"));
});

test("same-range Foundry choice results collapse into one tiled logical talent row", () => {
  const rawRows = [
    { type: "text", name: "Choose 1", range: [2, 2] },
    { type: "document", name: "First option", documentUuid: "Item.first", range: [2, 2] },
    { type: "document", name: "Second option", documentUuid: "Item.second", range: [2, 2] },
    ...TALENT_ROWS.slice(1),
  ];
  const rows = normalizeTalentRows(rawRows);
  assert.equal(rows.length, TALENT_ROWS.length);
  assert.equal(rows[0].kind, "choice");
  assert.deepEqual(rows[0].options, ["First option", "Second option"]);
  assert.deepEqual(rows[0].documentUuids, ["Item.first", "Item.second"]);

  const record = assessClassReadiness(validClass({
    system: { classTalentTable: { formula: "2d6", results: rawRows } },
    talentWiring: viaFor(rows),
  }));
  assert.equal(record.eligible, true);
  assert.equal(record.blockers.some((issue) => issue.code === READINESS_CODES.TALENT_TABLE_NOT_TILED), false);
});

test("the existing via classifier evidence blocks null rows but permits idiom-thin overlay-text rows", () => {
  const nullVia = assessClassReadiness(validClass({ talentWiring: viaFor(TALENT_ROWS, null) }));
  assert.equal(nullVia.blockers.filter((issue) => issue.code === READINESS_CODES.TALENT_ROW_UNWIRED).length, TALENT_ROWS.length);
  assert.ok(nullVia.blockers.every((issue) => issue.code !== READINESS_CODES.TALENT_ROW_CLASSIFIER_ERROR));

  const overlayText = assessClassReadiness(validClass({ talentWiring: viaFor(TALENT_ROWS, "overlay-text") }));
  assert.equal(overlayText.eligible, true);
  assert.equal(overlayText.blockers.some((issue) => issue.code === READINESS_CODES.TALENT_ROW_UNWIRED), false);

  const classifierError = assessClassReadiness(validClass({ talentClassifierError: "classifier unavailable" }));
  const issue = classifierError.blockers.find((entry) => entry.code === READINESS_CODES.TALENT_ROW_CLASSIFIER_ERROR);
  assert.ok(issue);
  assert.match(issue.message, /classifier unavailable/);
});

test("missing and malformed hit dice block advancement", () => {
  const missing = validClass();
  delete missing.system.hitPoints;
  const missingRecord = assessClassReadiness(missing);
  assert.equal(hasCode(missingRecord, READINESS_CODES.MISSING_HIT_DIE), true);

  const malformed = assessClassReadiness(validClass({ system: { hitPoints: "lots of hp" } }));
  assert.equal(hasCode(malformed, READINESS_CODES.INVALID_HIT_DIE), true);
  assert.match(malformed.blockers.find((issue) => issue.code === READINESS_CODES.INVALID_HIT_DIE).message, /lots of hp/);
});

test("caster grids require ability and every level 1–6 tier, while a real non-caster remains valid", () => {
  const caster = validClass({ system: {
    spellcasting: { ability: "wis", class: "Compendium.fixture.classes.caster", spellsknown: levelGrid() },
  } });
  const casterRecord = assessClassReadiness(caster);
  assert.equal(casterRecord.eligible, true);

  const noAbility = validClass({ system: {
    spellcasting: { ability: "", class: "Compendium.fixture.classes.caster", spellsknown: levelGrid() },
  } });
  assert.equal(hasCode(assessClassReadiness(noAbility), READINESS_CODES.MISSING_CASTING_ABILITY), true);

  const noGrid = validClass({ system: {
    spellcasting: { ability: "int", class: "Compendium.fixture.classes.caster" },
  } });
  assert.equal(hasCode(assessClassReadiness(noGrid), READINESS_CODES.SPELL_GRID_MISSING), true);

  const missingLevel = levelGrid();
  delete missingLevel["6"];
  const incompleteLevel = validClass({ system: {
    spellcasting: { ability: "int", class: "Compendium.fixture.classes.caster", spellsknown: missingLevel },
  } });
  const levelIssue = assessClassReadiness(incompleteLevel).blockers.find((issue) => issue.code === READINESS_CODES.SPELL_GRID_INCOMPLETE);
  assert.ok(levelIssue);
  assert.match(levelIssue.message, /level 6/);

  const missingTierGrid = levelGrid();
  delete missingTierGrid["3"]["4"];
  const missingTier = assessClassReadiness(validClass({ system: {
    spellcasting: { ability: "int", class: "Compendium.fixture.classes.caster", spellsknown: missingTierGrid },
  } }));
  const tierIssue = missingTier.blockers.find((issue) => issue.code === READINESS_CODES.SPELL_GRID_INCOMPLETE && issue.evidence.tier === 4);
  assert.ok(tierIssue);
  assert.match(tierIssue.message, /level 3, tier 4/);

  const invalidQuota = levelGrid({ 2: { "1": -1 } });
  const invalidGrid = assessClassReadiness(validClass({ system: {
    spellcasting: { ability: "int", class: "Compendium.fixture.classes.caster", spellsknown: invalidQuota },
  } }));
  assert.ok(invalidGrid.blockers.some((issue) => issue.code === READINESS_CODES.SPELL_GRID_INVALID && issue.evidence.level === 2));

  const malformedSentinel = assessClassReadiness(validClass({ system: {
    spellcasting: { ability: "int", class: "__not_spellcaster__", spellsknown: levelGrid() },
  } }));
  assert.equal(hasCode(malformedSentinel, READINESS_CODES.CASTER_SENTINEL), true);

  const nonCaster = assessClassReadiness(validClass());
  assert.equal(nonCaster.eligible, true);
});

test("Foundry's schema-default empty spell grid keeps a sentinel non-caster eligible", () => {
  const record = assessClassReadiness(validClass({ system: {
    spellcasting: { ability: "", class: "__not_spellcaster__", spellsknown: {} },
  } }));
  assert.equal(record.eligible, true);
  assert.equal(record.blockers.some((issue) => issue.code === READINESS_CODES.CASTER_SENTINEL), false);
});

test("a non-empty spell grid still blocks contradictory sentinel metadata", () => {
  const record = assessClassReadiness(validClass({ system: {
    spellcasting: { ability: "", class: "__not_spellcaster__", spellsknown: levelGrid() },
  } }));
  assert.equal(hasCode(record, READINESS_CODES.CASTER_SENTINEL), true);
  assert.equal(record.eligible, false);
});

test("reachable REPLACEME effects use G6a choice vocabulary and unknown modal codes fail closed", () => {
  const replacement = (name) => ({ name, changes: [{ key: "system.roll.bonus.REPLACEME", value: 1 }] });
  const unknownEffect = assessClassReadiness(validClass({ talentDocs: [
    { uuid: "Item.unknown", name: "Unattended Choice", effects: [replacement("Future Choice")] },
  ] }));
  const unknownIssue = unknownEffect.blockers.find((issue) => issue.code === READINESS_CODES.UNSUPPORTED_CHOICE);
  assert.ok(unknownIssue);
  assert.equal(unknownIssue.evidence.g6aCode, "no-matching-spec");
  assert.match(unknownIssue.message, /REPLACEME/);

  const supportedEffect = assessClassReadiness(validClass({ talentDocs: [
    { uuid: "Item.supported", name: "Weapon Pick", effects: [replacement("Weapon Mastery")] },
  ] }));
  assert.equal(supportedEffect.blockers.some((issue) => issue.code === READINESS_CODES.UNSUPPORTED_CHOICE), false);

  for (const [g6aCode, readinessCode] of Object.entries(G6A_UNSUPPORTED_TO_READINESS)) {
    const result = assessClassReadiness(validClass({ choiceResults: [{ unsupported: {
      code: g6aCode, evidence: { resolver: g6aCode },
    } }] }));
    const issue = result.blockers.find((entry) => entry.code === readinessCode);
    assert.ok(issue, `G6a ${g6aCode} should map to ${readinessCode}`);
    assert.equal(issue.evidence.g6aCode, g6aCode);
    assert.deepEqual(issue.evidence.evidence, { resolver: g6aCode });
  }

  const modal = assessClassReadiness(validClass({ modalCodes: ["future-modal"] }));
  const modalIssue = modal.blockers.find((issue) => issue.code === READINESS_CODES.UNKNOWN_CHOICE_CODE);
  assert.ok(modalIssue);
  assert.equal(modalIssue.evidence.g6aCode, "future-modal");
  assert.match(modalIssue.message, /future-modal/);
});

test("idiom-thin is a warning only, with complete G6a evidence", () => {
  const record = assessClassReadiness(validClass({
    idiom: {
      priority: ["con", "str", "dex", "int", "wis", "cha"],
      weights: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      signals: [{ source: "constitution-floor", ability: "con", contribution: 1 }],
      idiomThin: true,
    },
  }));
  assert.equal(record.eligible, true);
  assert.equal(hasWarning(record, READINESS_CODES.IDIOM_THIN), true);
  const warning = record.warnings.find((issue) => issue.code === READINESS_CODES.IDIOM_THIN);
  assert.deepEqual(warning.evidence.priority, ["con", "str", "dex", "int", "wis", "cha"]);
  assert.deepEqual(warning.evidence.weights, { cha: 0, con: 0, dex: 0, int: 0, str: 0, wis: 0 });
  assert.equal(record.blockers.length, 0);
});

test("unsupported-choice vocabulary is exposed once and evidence is deterministic", () => {
  const vocabulary = supportedChoiceVocabulary();
  assert.deepEqual(vocabulary.unsupportedCodes, ["no-matching-spec", "empty-option-set", "missing-metadata"]);
  assert.deepEqual(vocabulary.mappings, G6A_UNSUPPORTED_TO_READINESS);
  assert.equal(vocabulary.specs.length, 3);

  const bad = validClass({
    talentWiring: viaFor(TALENT_ROWS, null),
    choiceResults: [{ unsupported: { code: "empty-option-set", evidence: { kind: "weapon" } } }],
  });
  const first = buildPureReport([bad, validClass({
    idiom: { priority: ["con", "str", "dex", "int", "wis", "cha"], weights: {}, signals: [], idiomThin: true },
  })], { maxDefects: 2 });
  const second = buildPureReport([bad, validClass({
    idiom: { priority: ["con", "str", "dex", "int", "wis", "cha"], weights: {}, signals: [], idiomThin: true },
  })], { maxDefects: 2 });
  assert.deepEqual(first, second);
  assert.equal(first.defectQueue.length, 2);
  assert.equal(first.defectQueueTotal > first.defectQueue.length, true);
  assert.equal(first.defectQueueTruncated, true);
  assert.equal(first.defectQueue.every((entry) => entry.evidence.classId), true);
});

test("the pure evaluator does not mutate captured input snapshots", () => {
  const input = validClass({ talentDocs: [{ name: "Choice", effects: [{ name: "Armor Mastery", changes: [{ key: "x.REPLACEME" }] }] }] });
  const before = JSON.stringify(input);
  assessClassReadiness(input);
  assert.equal(JSON.stringify(input), before);
});

test("the Foundry adapter reads only Core and importer-managed classes and reuses the via classifier", async () => {
  const calls = [];
  const tableFor = (id, talentId) => ({ uuid: id, formula: "2d6", results: TALENT_ROWS.map((row, index) => ({
    ...row,
    kind: "single",
    documentUuid: `${talentId}-${index}`,
  })) });
  const coreClass = {
    uuid: "Compendium.shadowdark.classes.Item.core",
    name: "Core Metadata Class",
    type: "Class",
    system: {
      hitPoints: "d8",
      classTalentTable: "table-core",
      spellcasting: { ability: "", class: "__not_spellcaster__" },
    },
  };
  const importedClass = {
    uuid: "Compendium.world.classes.Item.imported",
    name: "Imported Metadata Class",
    type: "Class",
    system: {
      hitPoints: "d6",
      classTalentTable: "table-imported",
      spellcasting: { ability: "", class: "__not_spellcaster__" },
    },
  };
  const corePack = {
    collection: "shadowdark.classes",
    metadata: { packageType: "system", label: "Shadowdark Classes" },
    async getIndex() { return []; },
    async getDocuments() { calls.push("core.getDocuments"); return [coreClass]; },
  };
  const managedPack = {
    collection: "world.classes",
    metadata: { packageType: "world", label: "Classes" },
    async getIndex() { return []; },
    async getDocuments() { calls.push("managed.getDocuments"); return [importedClass]; },
  };
  const tables = {
    "table-core": tableFor("table-core", "core-talent"),
    "table-imported": tableFor("table-imported", "imported-talent"),
  };
  const game = { packs: new Map([
    [corePack.collection, corePack], [managedPack.collection, managedPack],
  ]) };
  const report = await collectClassReadiness({
    game,
    fromUuid: async (uuid) => {
      calls.push(`fromUuid:${uuid}`);
      if (tables[uuid]) return tables[uuid];
      return { uuid, name: uuid, type: "Talent", effects: [] };
    },
    classifyTalentRows: async (rows, overlay) => {
      calls.push(`classify:${rows.length}:${overlay ? "overlay" : "none"}`);
      return rows.map((row) => ({ wired: true, via: "system", match: row.text }));
    },
    overlayFor: () => null,
  });
  assert.equal(report.classes.length, 2);
  assert.deepEqual(report.classes.map((record) => record.source), ["core", "importer-managed"]);
  assert.equal(report.classes.every((record) => record.eligible), true);
  assert.deepEqual(report.sources.map((source) => [source.source, source.present, source.classCount]), [
    ["core", true, 1], ["importer-managed", true, 1],
  ]);
  assert.equal(calls.filter((call) => call.startsWith("classify:")).length, 2);
  assert.equal(calls.some((call) => call === "fromUuid:table-core"), true);
  assert.equal(calls.some((call) => call === "fromUuid:table-imported"), true);
  assert.equal(calls.some((call) => call.startsWith("fromUuid:core-talent-0")), true);
  assert.equal(calls.some((call) => call.includes("create") || call.includes("update") || call.includes("delete")), false);
});

test("the Foundry adapter normalizes same-range choice results before classifier wiring", async () => {
  const rawRows = [
    { type: "text", name: "Choose 1", range: [2, 2] },
    { type: "document", name: "First option", documentUuid: "Item.first", range: [2, 2] },
    { type: "document", name: "Second option", documentUuid: "Item.second", range: [2, 2] },
    ...TALENT_ROWS.slice(1),
  ];
  const calls = [];
  const coreClass = {
    uuid: "Compendium.shadowdark.classes.Item.grouped",
    name: "Grouped Metadata Class",
    type: "Class",
    system: {
      hitPoints: "d8",
      classTalentTable: "table-grouped",
      spellcasting: { ability: "", class: "__not_spellcaster__" },
    },
  };
  const corePack = {
    collection: "shadowdark.classes",
    metadata: { packageType: "system", label: "Shadowdark Classes" },
    async getDocuments() { return [coreClass]; },
  };
  const report = await collectClassReadiness({
    game: { packs: new Map([[corePack.collection, corePack]]) },
    fromUuid: async (uuid) => {
      calls.push(`fromUuid:${uuid}`);
      if (uuid === "table-grouped") return { uuid, formula: "2d6", results: rawRows };
      return { uuid, name: uuid, type: "Talent", effects: [] };
    },
    classifyTalentRows: async (rows) => {
      calls.push(`classify:${rows.length}`);
      return rows.map((row) => ({ wired: true, via: "system", match: row.text }));
    },
    overlayFor: () => null,
  });
  assert.equal(report.classes.length, 1);
  assert.equal(report.classes[0].eligible, true);
  assert.deepEqual(calls.filter((call) => call.startsWith("classify:")), ["classify:5"]);
  assert.equal(calls.includes("fromUuid:Item.first"), true);
  assert.equal(calls.includes("fromUuid:Item.second"), true);
});

test("adapter reports unavailable required sources without inventing classes", async () => {
  const report = await collectClassReadiness({ game: { packs: new Map() }, fromUuid: async () => null });
  assert.deepEqual(report.classes, []);
  assert.equal(report.eligible.length, 0);
  assert.equal(report.excluded.length, 0);
  assert.deepEqual(report.sources.map((source) => [source.source, source.present, source.classCount]), [
    ["core", false, 0], ["importer-managed", false, 0],
  ]);
});

test("the adapter's report API is exported from the stable pure module boundary", () => {
  // This is a small contract assertion for consumers that import the pure
  // report directly; the adapter test above exercises the Foundry path.
  assert.equal(typeof buildPureReport, "function");
  assert.equal(typeof buildClassReadinessReport, "function");
  assert.equal(typeof READINESS_CODES.QUALITY_GATE, "string");
  assert.deepEqual(issueCodes(assessClassReadiness(validClass())), []);
});
