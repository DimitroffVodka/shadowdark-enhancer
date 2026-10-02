import test from "node:test";
import assert from "node:assert/strict";
import { explorerView, planExplorerEdit, explorerClick } from "../scripts/hex-map/hex-explorer.mjs";
const record = { sceneUuid: "Scene.a", offset: { i: -2, j: 3 }, num: 101, terrain: "forest", title: "Cave", features: [{ type: "river", discovered: true, secret: "private" }, { type: "dungeon", name: "Secret cave", discovered: true, custom: { x: 1 } }], notes: [{ text: "Bridge", visible: true }, { text: "GM SECRET", visible: false }], links: [{ uuid: "JournalEntry.a", label: "Clue", visible: true }], keyed: [{ title: "Keyed cave", uuid: "JournalEntry.a.JournalEntryPage.b" }], discovery: { revealed: true, visited: false } };
test("tooltip discloses only safe terrain/public notes until location disclosure", () => {
  const view = explorerView(record, true);
  assert.equal(view.title, undefined); assert.deepEqual(view.features, [{ type: "river" }]);
  assert.deepEqual(view.notes, [{ text: "Bridge" }]); assert.deepEqual(view.links, []);
  assert.ok(!JSON.stringify(view).includes("SECRET")); assert.ok(!JSON.stringify(view).includes("private"));
  assert.equal(explorerView({ ...record, discovery: { revealed: false } }, true), null);
  const visited = explorerView({ ...record, discovery: { revealed: true, visited: true } }, true);
  assert.equal(visited.title, "Cave"); assert.equal(visited.links.length, 2);
  assert.equal(explorerView({ ...record, discovery: { revealed: true, visited: true, locationRevealed: false } }, true).links.length, 0);
});
test("already filtered player record keeps disclosed features and notes, no private fallbacks", () => {
  const view = explorerView({ sceneUuid: "Scene.a", offset: record.offset, num: 101, terrain: "forest", features: [{ type: "river" }], notes: [{ text: "Bridge" }], discovery: { revealed: true, locationRevealed: false }, keyed: record.keyed }, false);
  assert.deepEqual(view.features, [{ type: "river" }]); assert.deepEqual(view.notes, [{ text: "Bridge" }]); assert.deepEqual(view.links, []);
});
const flag = { version: 1, origin: { q: 0, r: 0 }, cells: { 101: "forest;river|auto:1.42?", 102: "lake|sdx", 103: "desert|auto:2.123?" }, palette: ["forest"] };
const input = { terrain: "Mountain", title: "Edited", lines: ["path"], features: [{ index: 1, type: "dungeon", name: "Edited cave", uuid: "", discovered: true }], notes: [{ index: 0, text: "Edited bridge", visible: true }, { index: 1, text: "GM SECRET", visible: false }], links: [{ index: 0, uuid: "RollTable.a", label: "Arrival", visible: false }], revealed: true, visited: true, location: "hide" };
test("one cell edits authoritative terrain/lines while rich metadata and other raw tags survive", () => {
  const before = structuredClone(flag), r = { ...record, features: [...record.features, { type: "path", id: "road", width: 4, discovered: true }], discovery: { ...record.discovery, arrivalRolled: true } };
  const plan = planExplorerEdit(r, input, flag);
  assert.equal(plan.tags.cells[101], "mountain;path|gm"); assert.equal(plan.tags.cells[103], flag.cells[103]);
  assert.deepEqual(plan.tags.origin, flag.origin); assert.deepEqual(flag, before);
  assert.ok(!Object.hasOwn(plan.patch, "terrain"));
  assert.deepEqual(plan.patch.features.find(f => f.type === "dungeon").custom, { x: 1 });
  assert.deepEqual(plan.patch.features.find(f => f.type === "path"), { type: "path", id: "road", width: 4, discovered: true });
  assert.ok(!plan.patch.features.some(f => f.type === "river"));
  assert.equal(plan.patch.discovery.arrivalRolled, true); assert.equal(plan.patch.discovery.locationRevealed, false);
  assert.equal(plan.patch.links[0].uuid, "RollTable.a");
});
test("automatic location disclosure clears explicit override without clearing visit/history", () => {
  const plan = planExplorerEdit({ ...record, discovery: { revealed: true, visited: true, locationRevealed: false, arrivalRolled: true } }, { ...input, location: "auto" }, flag);
  assert.ok(!Object.hasOwn(plan.patch.discovery, "locationRevealed")); assert.equal(plan.patch.discovery.arrivalRolled, true);
});
test("invalid numbered identity/terrain refuses rather than flattening structured features into tags", () => {
  for (const r of [{ ...record, num: null }, { ...record, offset: { i: 1.5, j: 0 } }]) assert.throws(() => planExplorerEdit(r, input, flag));
  assert.throws(() => planExplorerEdit(record, { ...input, terrain: "forest|gm" }, flag));
  assert.throws(() => planExplorerEdit(record, { ...input, terrain: "" }, flag));
});
test("short blank-cell select observes but never takes drags, pins, modifiers or ping", () => {
  const press = { x: 100, y: 100, at: 0 }, event = { button: 0, global: { x: 100, y: 100 }, timeStamp: 100 };
  assert.equal(explorerClick(press, event, 500), true);
  for (const change of [{ timeStamp: 500 }, { global: { x: 110, y: 100 } }, { shiftKey: true }, { target: { document: {} } }, { target: { parent: { document: {} } } }, { button: 2 }]) assert.equal(explorerClick(press, { ...event, ...change }, 500), false);
});
test("structured rows refuse line types instead of silently discarding rich data", () => {
  assert.throws(() => planExplorerEdit(record, { ...input, features: [{ ...input.features[0], type: "river" }] }, flag), /invalidFeature/);
});
test("adopted unnumbered cells keep offset terrain/features in their existing native authority", () => {
  const r = { ...record, num: null };
  const plan = planExplorerEdit(r, input, null);
  assert.equal(plan.tags, null); assert.equal(plan.patch.terrain, "mountain");
  assert.deepEqual(plan.patch.features.map(f => f.type), ["dungeon", "path"]);
  assert.deepEqual(r.offset, { i: -2, j: 3 });
});
