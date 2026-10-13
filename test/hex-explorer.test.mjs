import test from "node:test";
import assert from "node:assert/strict";
import { explorerView, planExplorerEdit, explorerClick, encounterReadout, ownsHexData, playerOpenable, canOpenLink, raisedOwnership, droppedLink, arrivalFields, mergedCell } from "../scripts/hex-map/hex-explorer.mjs";
import { arrivalDue } from "../scripts/hex-map/hex-fog-core.mjs";
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
test("pre-filtered player input still drops explicitly hidden markers", () => {
  const view = explorerView({ sceneUuid: "Scene.a", offset: record.offset, num: 101, terrain: "forest",
    features: [{ type: "river" }, { type: "dungeon", name: "Lair", discovered: false }],
    notes: [{ text: "Bridge" }, { text: "GM SECRET", visible: false }],
    links: [{ uuid: "JournalEntry.a", label: "Clue" }, { uuid: "JournalEntry.b", label: "HIDDEN", visible: false }],
    discovery: { revealed: true, visited: true }, keyed: record.keyed }, false);
  assert.deepEqual(view.features, [{ type: "river" }]);
  assert.deepEqual(view.notes, [{ text: "Bridge" }]);
  assert.deepEqual(view.links, [{ uuid: "JournalEntry.a", label: "Clue" }, { uuid: "JournalEntry.a.JournalEntryPage.b", label: "Keyed cave" }]);
  assert.ok(!JSON.stringify(view).includes("SECRET"));
  assert.ok(!JSON.stringify(view).includes("HIDDEN"));
});
test("the encounter readout says where the hex's table came from", () => {
  const column = { column: "Forest", uuid: "RollTable.f" };
  assert.deepEqual(encounterReadout({ uuid: "RollTable.f", zone: "Lowland Moor", verdict: { status: "ok", column } }, "Moor: Forest"),
    { state: "region", uuid: "RollTable.f", name: "Moor: Forest", zone: "Lowland Moor", column: "Forest", options: "" });
  const two = encounterReadout({ uuid: "RollTable.t", zone: "Moor", verdict: { status: "ambiguous", columns: [{ column: "Forest Day" }, { column: "Full Moon" }] } }, "Terrain");
  assert.equal(two.state, "ambiguous"); assert.equal(two.options, "Forest Day, Full Moon");
  assert.equal(encounterReadout({ uuid: "RollTable.t", zone: null, verdict: { status: "none" } }, "Forest").state, "terrain");
  assert.equal(encounterReadout({ uuid: "RollTable.a", zone: null, verdict: { status: "none" } }, "Wandering", "RollTable.a").state, "active");
  assert.equal(encounterReadout({ uuid: "RollTable.a", zone: null, verdict: { status: "none" } }, "Wandering", "RollTable.a", "RollTable.a").state, "terrain",
    "the terrain's own table is named as such even when it is also the active one");
  assert.equal(encounterReadout({ uuid: "", zone: null, verdict: { status: "none" } }).state, "none");
  assert.equal(encounterReadout().state, "none");
});
test("Hex Data owns an adopted hex scene even while Extras' Hex Tooltip is on, and a square or plain scene never", () => {
  const scene = (hexagonal, adopted) => ({ grid: { isHexagonal: hexagonal }, getFlag: (_m, key) => (adopted && key === "hexRecords" ? { adopted: true } : undefined) });
  const before = globalThis.game;
  globalThis.game = { modules: new Map([["shadowdark-extras", { active: true }]]), settings: { get: () => [] } };
  try {
    assert.equal(ownsHexData(scene(true, true)), true);
    assert.equal(ownsHexData(scene(false, true)), false);
    assert.equal(ownsHexData(scene(true, false)), false);
  } finally { globalThis.game = before; }
});
test("river, path and coast are always disclosed, whatever an old record stored", () => {
  const features = [{ type: "river", discovered: false }, { type: "path" }, { type: "dungeon", name: "Lair", discovered: false }];
  const view = explorerView({ ...record, features, discovery: { revealed: true, visited: false } }, false);
  assert.deepEqual(view.features, [{ type: "river" }, { type: "path" }]);
  const plan = planExplorerEdit({ ...record, features: [] }, { ...input, lines: ["river", "coast"], features: [] }, structuredClone(flag));
  assert.deepEqual(plan.patch.features.map(f => [f.type, f.discovered]), [["river", true], ["coast", true]]);
});
test("a link's player warning reads the default role, walks a page's INHERIT to its journal, and asks a compendium for its policy", () => {
  const journal = level => ({ documentName: "JournalEntry", ownership: { default: level } });
  assert.equal(playerOpenable(null), false);
  assert.equal(playerOpenable(journal(0)), false);
  assert.equal(playerOpenable(journal(2)), true);
  assert.equal(playerOpenable(journal(3)), true);
  assert.equal(playerOpenable({ documentName: "JournalEntry" }), false);
  const page = (level, parent) => ({ documentName: "JournalEntryPage", ownership: { default: level }, parent });
  assert.equal(playerOpenable(page(-1, journal(2))), true, "an inheriting page follows its journal");
  assert.equal(playerOpenable(page(-1, journal(0))), false);
  assert.equal(playerOpenable(page(0, journal(2))), false, "an explicitly locked page stays locked");
  assert.equal(playerOpenable({ documentName: "JournalEntry", pack: "world.p", ownership: { default: 0 }, compendium: { ownership: { PLAYER: "OBSERVER" } } }), true);
  assert.equal(playerOpenable({ documentName: "JournalEntry", pack: "world.p", ownership: { default: 3 }, compendium: { ownership: { PLAYER: "NONE" } } }), false);
});
test("canOpenLink asks for observer on the document and, for a page, on its journal", () => {
  const permit = level => ({ testUserPermission: () => level >= 2 });
  assert.equal(canOpenLink(permit(2), {}), true);
  assert.equal(canOpenLink(permit(1), {}), false);
  assert.equal(canOpenLink({ ...permit(3), parent: permit(0) }, {}), false);
  assert.equal(canOpenLink({ ...permit(3), parent: permit(2) }, {}), true);
  assert.equal(canOpenLink(null, {}), false);
  assert.equal(canOpenLink(permit(3), null), false);
});
test("a share tick raises every ownership level to observer and never lowers one", () => {
  assert.deepEqual(raisedOwnership({ default: 0 }), { default: 2 });
  assert.deepEqual(raisedOwnership({ default: 3, playerA: 1 }), { default: 3, playerA: 2 });
  assert.deepEqual(raisedOwnership({}), { default: 2 });
  assert.deepEqual(raisedOwnership(), { default: 2 });
});
test("a drop makes a link row for a journal entry, journal page or roll table, and nothing else", () => {
  const doc = (documentName, name = "Doc") => ({ documentName, name, uuid: `${documentName}.x` });
  assert.deepEqual(droppedLink(doc("JournalEntry")), { index: null, uuid: "JournalEntry.x", label: "Doc", visible: false });
  assert.equal(droppedLink(doc("JournalEntryPage")).uuid, "JournalEntryPage.x");
  assert.equal(droppedLink(doc("RollTable")).uuid, "RollTable.x");
  assert.equal(droppedLink(doc("Actor")), null);
  assert.equal(droppedLink(doc("Item")), null);
  assert.equal(droppedLink({ documentName: "RollTable", name: "T" }), null, "no uuid, no row");
  assert.equal(droppedLink(null), null);
});
test("the arrival block writes the trio, rounds the chance, and a cleared table clears all three", () => {
  assert.deepEqual(arrivalFields({ rollTable: "RollTable.t", rollTableChance: "75", rollTableFirstOnly: true }),
    { rollTable: "RollTable.t", rollTableChance: 75, rollTableFirstOnly: true });
  assert.equal(arrivalFields({ rollTable: "RollTable.t", rollTableChance: "12.6" }).rollTableChance, 13);
  assert.equal(arrivalFields({ rollTable: "RollTable.t", rollTableChance: "" }).rollTableChance, 100, "an empty box means every entry");
  assert.equal(arrivalFields({ rollTable: "RollTable.t", rollTableChance: "abc" }).rollTableChance, 100);
  assert.equal(arrivalFields({ rollTable: "RollTable.t", rollTableChance: "500" }).rollTableChance, 100);
  assert.equal(arrivalFields({ rollTable: "RollTable.t", rollTableChance: "-5" }).rollTableChance, 0);
  const cleared = arrivalFields({ rollTable: "  " });
  assert.ok(["rollTable", "rollTableChance", "rollTableFirstOnly"].every(key => Object.hasOwn(cleared, key) && cleared[key] === undefined));
  assert.deepEqual(arrivalFields({}), {}, "an input that never mentions the block leaves the stored fields alone");
});
test("imported arrival fields survive a save, a cleared table removes them, and the share tick is a save action, not stored state", () => {
  const stored = { rollTable: "RollTable.t", rollTableChance: 40, rollTableFirstOnly: true, archive: { keep: true } };
  const r = { ...record, ...stored };
  // The window always carries the block, so a save writes back exactly what it shows — imported values included.
  const shown = { ...input, rollTable: "RollTable.t", rollTableChance: "40", rollTableFirstOnly: true };
  const kept = mergedCell(stored, planExplorerEdit(r, shown, structuredClone(flag)).patch);
  assert.equal(kept.rollTable, "RollTable.t"); assert.equal(kept.rollTableChance, 40); assert.equal(kept.rollTableFirstOnly, true);
  assert.deepEqual(kept.archive, { keep: true }, "fields outside the window's block are kept");
  const cleared = mergedCell(stored, planExplorerEdit(r, { ...shown, rollTable: "", rollTableChance: "", rollTableFirstOnly: false }, structuredClone(flag)).patch);
  assert.ok(!Object.hasOwn(cleared, "rollTable") && !Object.hasOwn(cleared, "rollTableChance") && !Object.hasOwn(cleared, "rollTableFirstOnly"));
  assert.deepEqual(cleared.archive, { keep: true });
  const shared = planExplorerEdit(r, { ...input, links: [{ index: 0, uuid: "JournalEntry.a", label: "Clue", visible: true, share: true }] }, structuredClone(flag));
  assert.equal(shared.patch.links[0].visible, true);
  assert.ok(!Object.hasOwn(shared.patch.links[0], "share"), "the tick is applied on save, never stored on the row");
});
test("the arrival fields a save writes are the ones a committed arrival reads", () => {
  const cell = mergedCell({}, planExplorerEdit({ ...record, rollTable: "" }, { ...input, rollTable: "RollTable.t", rollTableChance: "100", rollTableFirstOnly: true }, structuredClone(flag)).patch);
  assert.equal(cell.rollTable, "RollTable.t");
  assert.equal(arrivalDue(cell, { entered: true }), true);
  assert.equal(arrivalDue({ ...cell, arrivalRolled: true }, { entered: true }), false);
  assert.equal(arrivalDue({ ...cell, arrivalRolledBy: ["A"] }, { entered: true, partyId: "A" }), false, "first entry only draws once for that party");
  assert.equal(arrivalDue({ ...cell, arrivalRolledBy: ["A"] }, { entered: true, partyId: "B" }), true, "and still draws for another party");
});
