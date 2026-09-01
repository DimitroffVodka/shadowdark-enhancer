/**
 * G2/#79 — derived Rival Crawler class table.
 *
 * All table documents below are synthetic.  The adapter fakes exercise the
 * identity/fingerprint boundary; no Foundry world is touched by this suite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { ClassIndex } from "../scripts/importer/char-content/class-index.mjs";
import {
  RIVAL_CLASS_TABLE_NAME,
  RIVAL_CLASS_TABLE_WARNING,
  buildRivalClassTablePayload,
  canonicalClassName,
  isLevelZeroClassName,
  rivalClassTableFingerprint,
  selectRivalClasses,
} from "../scripts/forge-loot/rival-class-table.mjs";
import {
  CLASS_INDEX_INVALIDATED_HOOK,
  findRivalClassTable,
  installRivalClassTableListener,
  regenerateRivalClassTable,
  resetRivalClassTableListener,
} from "../scripts/forge-loot/rival-class-table-adapter.mjs";

const classRecord = (name, source, eligible = true, classId = `${source}:${name}`) => ({
  classId, name, source, eligible,
});

const readyReport = (classes) => ({ version: 1, classes });

function fakeDocument(data, id = "table-1") {
  const document = {
    _id: id,
    id,
    uuid: `Compendium.world.sde-tables.RollTable.${id}`,
    documentName: "RollTable",
    type: "RollTable",
    ...structuredClone(data),
  };
  document.results = document.results ?? [];
  document.flags ??= {};
  document.toObject = () => structuredClone({
    ...document,
    toObject: undefined,
  });
  document.getEmbeddedCollection = () => document.results;
  document.update = async (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (key.startsWith("flags.")) {
        const [, namespace, ...path] = key.split(".");
        document.flags[namespace] ??= {};
        let target = document.flags[namespace];
        for (const part of path.slice(0, -1)) target = (target[part] ??= {});
        target[path.at(-1)] = structuredClone(value);
      } else document[key] = structuredClone(value);
    }
    return document;
  };
  document.deleteEmbeddedDocuments = async (_type, ids) => {
    document.results = document.results.filter((row) => !ids.includes(row.id ?? row._id));
  };
  document.createEmbeddedDocuments = async (_type, rows) => {
    document.results.push(...structuredClone(rows).map((row, index) => ({ id: row.id ?? `created-${index}`, ...row })));
    return document.results;
  };
  return document;
}

function fakePack(documents = []) {
  return {
    collection: "world.sde-tables",
    documentName: "RollTable",
    documents,
    async getDocuments() { return this.documents; },
    async getIndex() { return this.documents.map((doc) => ({ ...doc, _id: doc._id })); },
    async getDocument(id) { return this.documents.find((doc) => doc._id === id) ?? null; },
  };
}

function installGame(pack, { isGM = true } = {}) {
  globalThis.game = {
    user: { id: "gm-1", isGM },
    users: { activeGM: { id: "gm-1" } },
    packs: [pack],
  };
  return globalThis.game;
}

test("the pure selector uses G3 classes, exact Level-0 filtering, Core precedence, and stable name order", () => {
  assert.equal(canonicalClassName("  MiXeD  "), "mixed");
  assert.equal(isLevelZeroClassName("Goblin Level 0"), true);
  assert.equal(isLevelZeroClassName("Level 10 Hero"), false);

  const importedFirst = classRecord("  beta ", "importer-managed", true, "import-beta");
  const report = readyReport([
    importedFirst,
    classRecord("ALPHA", "core", true, "core-alpha"),
    classRecord("Beta", "core", true, "core-beta"),
    classRecord("Gamma", "importer-managed", true, "import-gamma"),
    classRecord("Level 0 Apprentice", "core", true, "level-0"),
    classRecord("Other", "third-party", true, "other"),
  ]);
  const winners = selectRivalClasses(report);
  assert.deepEqual(winners.map((entry) => entry.name), ["ALPHA", "Beta", "Gamma"]);
  assert.deepEqual(winners.map((entry) => entry.classId), ["core-alpha", "core-beta", "import-gamma"]);
});

test("an ineligible Core collision excludes an eligible importer copy", () => {
  const winners = selectRivalClasses(readyReport([
    classRecord("Bard", "importer-managed", true, "import-bard"),
    classRecord("Bard", "core", false, "core-bard"),
    classRecord("Only Import", "importer-managed", true, "import-only"),
  ]));
  assert.deepEqual(winners.map((entry) => entry.name), ["Only Import"]);
});

test("payload rows are equal-probability, sorted, linked, and fingerprinted for N=1/N>=5", () => {
  const one = buildRivalClassTablePayload([classRecord("Solo", "core", true, "Item.solo")]);
  assert.equal(one.name, RIVAL_CLASS_TABLE_NAME);
  assert.equal(one.formula, "1d1");
  assert.deepEqual(one.results.map((row) => row.range), [[1, 1]]);
  assert.equal(one.results[0].type, "document");
  assert.equal(one.results[0].documentUuid, "Item.solo");
  assert.equal(one.description, RIVAL_CLASS_TABLE_WARNING);
  assert.equal(typeof one.flags[MODULE_ID].forgeLoot.rivalClassTable.fingerprint, "string");
  assert.equal(rivalClassTableFingerprint(one), one.flags[MODULE_ID].forgeLoot.rivalClassTable.fingerprint);

  const many = buildRivalClassTablePayload([
    classRecord("Zulu", "core", true, "z"),
    classRecord("alpha", "core", true, "a"),
    classRecord("Echo", "core", true, "e"),
    classRecord("Bravo", "core", true, "b"),
    classRecord("Charlie", "core", true, "c"),
  ]);
  assert.equal(many.formula, "1d5");
  assert.deepEqual(many.results.map((row) => row.name), ["alpha", "Bravo", "Charlie", "Echo", "Zulu"]);
  assert.deepEqual(many.results.map((row) => row.range), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
  assert.deepEqual(many.results.map((row) => row.weight), [1, 1, 1, 1, 1]);
  assert.deepEqual(buildRivalClassTablePayload([
    classRecord("Bravo", "core", true, "b"), classRecord("alpha", "core", true, "a"),
  ]), buildRivalClassTablePayload([
    classRecord("alpha", "core", true, "a"), classRecord("Bravo", "core", true, "b"),
  ]));
});

test("empty eligibility persists a stable zero-row inert table payload", () => {
  const payload = buildRivalClassTablePayload([]);
  assert.equal(payload.formula, "1d1");
  assert.deepEqual(payload.results, []);
  assert.equal(payload.flags[MODULE_ID].forgeLoot.rivalClassTable.generated, true);
  assert.equal(rivalClassTableFingerprint(payload), payload.flags[MODULE_ID].forgeLoot.rivalClassTable.fingerprint);
});

test("the pure module has no Foundry or module-global dependency", async () => {
  const source = await readFile(new URL("../scripts/forge-loot/rival-class-table.mjs", import.meta.url), "utf8");
  for (const token of ["game.", "Hooks.", "fromUuid", "Math.random"]) {
    assert.equal(source.includes(token), false, `pure selector must not use ${token}`);
  }
});

test("adapter creates by flag identity and leaves a same-name unflagged table alone", async () => {
  const decoy = fakeDocument({ name: RIVAL_CLASS_TABLE_NAME, formula: "1d20", results: [] }, "decoy");
  delete decoy.flags[MODULE_ID];
  const pack = fakePack([decoy]);
  const gameRef = installGame(pack);
  const created = [];
  globalThis.RollTable = {
    async create(data) {
      const doc = fakeDocument(data, `generated-${created.length + 1}`);
      created.push(doc);
      pack.documents.push(doc);
      return doc;
    },
  };
  const RollTable = globalThis.RollTable;
  const report = readyReport([classRecord("Eligible", "core", true, "Item.eligible")]);
  const first = await regenerateRivalClassTable({ game: gameRef, pack, report, RollTable });
  assert.equal(first.status, "created");
  assert.equal(first.rowCount, 1);
  assert.equal(created.length, 1);
  assert.equal(pack.documents.length, 2, "same-name unflagged decoy is retained");
  assert.equal((await findRivalClassTable(pack)).uuid, created[0].uuid);
  const second = await regenerateRivalClassTable({ game: gameRef, pack, report, RollTable });
  assert.equal(second.status, "unchanged");
  assert.equal(created.length, 1);
});

test("changed eligibility replaces the flagged table in place and preserves identity", async () => {
  const pack = fakePack([]);
  const gameRef = installGame(pack);
  const created = [];
  globalThis.RollTable = {
    async create(data) {
      const doc = fakeDocument(data, "stable-id");
      created.push(doc);
      pack.documents.push(doc);
      return doc;
    },
  };
  const RollTable = globalThis.RollTable;
  const firstReport = readyReport([classRecord("First", "core", true, "Item.first")]);
  const secondReport = readyReport([
    classRecord("First", "core", true, "Item.first"),
    classRecord("Second", "importer-managed", true, "Item.second"),
  ]);
  await regenerateRivalClassTable({ game: gameRef, pack, report: firstReport, RollTable });
  const original = created[0];
  original.flags[MODULE_ID].imported = true;
  original.flags[MODULE_ID].importerMetadata = { keep: "this" };
  const changed = await regenerateRivalClassTable({ game: gameRef, pack, report: secondReport, RollTable });
  assert.equal(changed.status, "updated");
  assert.equal(changed.document, original);
  assert.equal(changed.uuid, original.uuid);
  assert.deepEqual(original.results.map((row) => row.name), ["First", "Second"]);
  assert.equal(original.flags[MODULE_ID].imported, true, "replacementFlags preserves undeclared module keys");
  assert.deepEqual(original.flags[MODULE_ID].importerMetadata, { keep: "this" });
  assert.equal(created.length, 1);
});

test("empty report creates the flagged zero-row table and marks Rival disabled", async () => {
  const pack = fakePack([]);
  const gameRef = installGame(pack);
  const RollTable = {
    async create(data) {
      const doc = fakeDocument(data, "empty-id");
      pack.documents.push(doc);
      return doc;
    },
  };
  const result = await regenerateRivalClassTable({ game: gameRef, pack, report: readyReport([]), RollTable });
  assert.equal(result.status, "created");
  assert.equal(result.disabled, true);
  assert.deepEqual(result.document.results, []);
});

test("rowless partial replacement recovers on the next regeneration", async () => {
  const pack = fakePack([]);
  const gameRef = installGame(pack);
  let failCreate = true;
  const RollTable = {
    async create(data) {
      const doc = fakeDocument(data, "recover-id");
      const createEmbedded = doc.createEmbeddedDocuments;
      doc.createEmbeddedDocuments = async (type, rows) => {
        if (failCreate) {
          failCreate = false;
          throw new Error("synthetic embedded create failure");
        }
        return createEmbedded.call(doc, type, rows);
      };
      pack.documents.push(doc);
      return doc;
    },
  };
  const report = readyReport([classRecord("Recoverable", "core", true, "Item.recoverable")]);
  // Seed a flagged document whose desired rows differ, so replaceDocument's
  // in-place branch reaches the intentionally failing embedded create.
  const initial = buildRivalClassTablePayload([]);
  const existing = fakeDocument(initial, "recover-id");
  const createEmbedded = existing.createEmbeddedDocuments;
  existing.createEmbeddedDocuments = async (type, rows) => {
    if (failCreate) {
      failCreate = false;
      throw new Error("synthetic embedded create failure");
    }
    return createEmbedded.call(existing, type, rows);
  };
  pack.documents.push(existing);
  const first = await regenerateRivalClassTable({ game: gameRef, pack, report, RollTable });
  assert.equal(first.status, "failed");
  assert.deepEqual(existing.results, [], "partial failure leaves the document rowless");
  const retry = await regenerateRivalClassTable({ game: gameRef, pack, report, RollTable });
  assert.equal(retry.status, "updated");
  assert.equal(retry.uuid, existing.uuid);
  assert.deepEqual(existing.results.map((row) => row.name), ["Recoverable"]);
});

test("manual row edits are replaced with one warning", async () => {
  const pack = fakePack([]);
  const gameRef = installGame(pack);
  const RollTable = {
    async create(data) {
      const doc = fakeDocument(data, "manual-id");
      pack.documents.push(doc);
      return doc;
    },
  };
  const report = readyReport([classRecord("Edited", "core", true, "Item.edited")]);
  await regenerateRivalClassTable({ game: gameRef, pack, report, RollTable });
  const doc = pack.documents[0];
  doc.results[0].name = "GM edit";
  const notices = [];
  const result = await regenerateRivalClassTable({ game: gameRef, pack, report, RollTable, notify: (message) => notices.push(message) });
  assert.equal(result.status, "updated");
  assert.equal(result.replacedManualEdits, true);
  assert.deepEqual(notices, [RIVAL_CLASS_TABLE_WARNING]);
  assert.equal(doc.results[0].name, "Edited");
});

test("ClassIndex invalidation listener debounces a burst and never runs on a player", async () => {
  resetRivalClassTableListener();
  const pack = fakePack([]);
  const gameRef = installGame(pack);
  const hooks = new Map();
  const Hooks = {
    on(name, callback) {
      const list = hooks.get(name) ?? [];
      list.push(callback);
      hooks.set(name, list);
      return list.length;
    },
  };
  let calls = 0;
  installRivalClassTableListener({
    Hooks, game: gameRef, delay: 5,
    regenerate: async () => { calls += 1; return { status: "unchanged" }; },
  });
  const fire = () => hooks.get(CLASS_INDEX_INVALIDATED_HOOK)?.forEach((fn) => fn());
  fire(); fire(); fire();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);

  resetRivalClassTableListener();
  const playerGame = installGame(pack, { isGM: false });
  installRivalClassTableListener({
    Hooks: { on: (_name, callback) => { callback(); return 1; } },
    game: playerGame, delay: 0,
    regenerate: async () => { calls += 1; return { status: "unexpected" }; },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  resetRivalClassTableListener();
});

test("ClassIndex.invalidate stays synchronous/non-throwing while emitting one hook", () => {
  const calls = [];
  globalThis.Hooks = { callAll: (name) => calls.push(name) };
  assert.doesNotThrow(() => ClassIndex.invalidate());
  assert.deepEqual(calls, [CLASS_INDEX_INVALIDATED_HOOK]);
  globalThis.Hooks.callAll = () => { throw new Error("listener failure"); };
  assert.doesNotThrow(() => ClassIndex.invalidate());
  delete globalThis.Hooks;
});

test.after(() => {
  resetRivalClassTableListener();
  delete globalThis.game;
  delete globalThis.RollTable;
  delete globalThis.Hooks;
});
