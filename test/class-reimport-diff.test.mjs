/**
 * Review #12 regressions: corrected class re-imports must detect stale
 * content instead of blindly reusing same-named docs. Pure diff-helper
 * coverage; the Foundry-bound update path is live-probed via MCP.
 * All fixture data is invented — no book content.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { _internals } from "../scripts/encounter/class-unit-importer.mjs";

const { _deepEq, _subsetEq, _staleFields, _effectShape } = _internals;

test("_deepEq: structural equality, order-insensitive keys, array order-sensitive", () => {
  assert.ok(_deepEq({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }));
  assert.ok(!_deepEq({ a: 1 }, { a: 2 }));
  assert.ok(!_deepEq([1, 2], [2, 1]));
  assert.ok(!_deepEq(null, {}));
  assert.ok(_deepEq(null, null));
});

test("_staleFields: identical import-owned fields → no stale fields", () => {
  const data = {
    name: "Sneak", type: "Talent", img: "icons/x.webp",
    system: { description: "<p>Old text.</p>", level: 1, talentClass: "class", source: { title: "wr" } },
    effects: [],
    flags: { "shadowdark-enhancer": { imported: true } },
  };
  const docObj = {
    img: "icons/x.webp",
    // stored doc carries EXTRA schema fields the import doesn't own — ignored
    system: { ...data.system, lost: false, magicItem: false },
    effects: [],
    flags: { "shadowdark-enhancer": { imported: true, source: "CS1" }, core: {} },
    folder: "somewhere-else",   // folder differences never count as stale
  };
  assert.deepEqual(_staleFields(docObj, data), []);
});

test("_staleFields: nested schema-filled keys never count as stale (live-caught)", () => {
  // Import defines a 3-key spellcasting object; the stored doc's schema adds
  // spellsknown etc. — an identical re-import must NOT report an update.
  const data = { system: { spellcasting: { ability: "", baseDifficulty: 10, class: "__not_spellcaster__" } } };
  const docObj = { system: { spellcasting: { ability: "", baseDifficulty: 10, class: "__not_spellcaster__", spellsknown: {} } } };
  assert.deepEqual(_staleFields(docObj, data), []);
  assert.ok(_subsetEq(data.system, docObj.system));
  // but a value the import DOES own still trips it
  const corrected = { system: { spellcasting: { ...data.system.spellcasting, ability: "int" } } };
  assert.deepEqual(_staleFields(docObj, corrected), ["system.spellcasting"]);
});

test("_staleFields: corrected description / titles / effects are detected", () => {
  const base = {
    img: "icons/x.webp",
    system: { description: "<p>Old.</p>", titles: [{ from: 1, to: 2, lawful: "Squire" }] },
    effects: [],
    flags: {},
  };
  const corrected = {
    img: "icons/x.webp",
    system: { description: "<p>New corrected.</p>", titles: [{ from: 1, to: 2, lawful: "Knave" }] },
    effects: [{ name: "Buff", system: { changes: [{ key: "system.bonuses.x", value: "1" }] } }],
    flags: {},
  };
  const fields = _staleFields(base, corrected);
  assert.ok(fields.includes("system.description"));
  assert.ok(fields.includes("system.titles"));
  assert.ok(fields.includes("effects"));
});

test("_effectShape: core changes and SD system.changes normalize identically", () => {
  const core = [{ name: "E", transfer: true, changes: [{ key: "k", mode: 2, value: 1 }] }];
  const sd = [{ name: "E", system: { changes: [{ key: "k", value: "1" }] } }];
  assert.ok(_deepEq(_effectShape(core), _effectShape(sd)), "mode default 2 + value stringified");
});
