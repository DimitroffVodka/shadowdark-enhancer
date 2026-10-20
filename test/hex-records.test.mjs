import test from "node:test";
import assert from "node:assert/strict";
import { recordView, playerProjection, HexRecords, loadHexRecords, scenePrint, bookKeyedPages, mergeKeyedPages } from "../scripts/hex-map/hex-records.mjs";
const base = { sceneUuid: "Scene.a", offset: { i: -2, j: 3 }, num: 101 };
test("facade reads terrain/features/provenance from existing tags, not archived legacy", () => {
  const r = recordView({ ...base, cell: { title: "Ford", terrain: "river", features: [{ type: "river", id: "old" }, { type: "dungeon", id: "cave" }], legacy: { terrain: "lake" } }, tag: { terrain: "forest", features: ["path"], source: "auto", margin: 1.42, review: true } });
  assert.equal(r.terrain, "forest");
  assert.deepEqual(r.features.map(f => f.type), ["dungeon", "path"]);
  assert.deepEqual(r.provenance, { source: "auto", margin: 1.42, review: true });
  assert.equal(r.sceneUuid, "Scene.a");
  assert.deepEqual(r.offset, base.offset);
});
test("projection never carries unknown fields, GM notes, unvisited keyed content or feature extras", () => {
  const r = { ...base, terrain: "forest", title: "Secret dungeon", notes: [{ id: "public", text: "Bridge", visible: true, private: "secret" }, { text: "GM" }], features: [{ id: "river", type: "river", discovered: true, secret: "hide" }, { id: "cave", type: "dungeon", name: "Cave", discovered: true }], links: [{ uuid: "JournalEntry.a", label: "Clue", visible: true, secret: "hide" }], legacy: { secret: true }, discovery: { revealed: false, visited: false } };
  assert.equal(playerProjection(r), null);
  r.discovery.revealed = true;
  let p = playerProjection(r);
  assert.equal(p.title, undefined);
  assert.deepEqual(p.features, [{ id: "river", type: "river" }]);
  assert.deepEqual(p.notes, [{ id: "public", text: "Bridge" }]);
  assert.equal(p.links, undefined);
  r.discovery.visited = true;
  p = playerProjection(r);
  assert.equal(p.title, "Secret dungeon");
  assert.deepEqual(p.links, [{ uuid: "JournalEntry.a", label: "Clue" }]);
  assert.equal(JSON.stringify(p).includes("secret"), false);
});
test("explicitly hidden keyed location stays hidden after a visit", () => {
  const p = playerProjection({ ...base, title: "Secret", features: [{ type: "dungeon", discovered: true }], discovery: { revealed: true, visited: true, locationRevealed: false } });
  assert.equal(p.title, undefined);
  assert.deepEqual(p.features, []);
});
test("player facade applies effective location disclosure to readable pinned pages", () => {
  const oldGame = globalThis.game;
  const page = { uuid: "JournalEntry.public.JournalEntryPage.location", name: "Keyed location", testUserPermission: () => true };
  const entry = { pages: { get: id => id === "location" ? page : null }, testUserPermission: () => true };
  const scene = { id: "a", uuid: base.sceneUuid, notes: { contents: [{ entryId: "public", pageId: "location", flags: { "shadowdark-enhancer": { hexPin: { num: 101 } } } }] } };
  const cells = {};
  const projectionJournal = { flags: { "shadowdark-enhancer": { hexRecordProjection: { sceneUuid: base.sceneUuid, cells } } } };
  globalThis.game = { user: { isGM: false }, journal: { contents: [projectionJournal], get: id => id === "public" ? entry : null } };
  try {
    for (const [discovery, visible] of [
      [{ revealed: true, visited: false }, false],
      [{ revealed: true, visited: true }, true],
      [{ revealed: true, visited: true, locationRevealed: false }, false],
      [{ revealed: true, visited: false, locationRevealed: true }, true],
      [{ revealed: true, visited: true, locationRevealed: false }, false],
    ]) {
      cells["-2_3"] = playerProjection({ ...base, title: page.name, discovery });
      const read = HexRecords.read(base.offset, scene);
      assert.equal(read.title, visible ? page.name : undefined);
      assert.deepEqual(read.keyed ?? [], visible ? [{ uuid: page.uuid, title: page.name }] : []);
      assert.equal(read.discovery.locationRevealed ?? !!read.discovery.visited, visible);
    }
  } finally {
    if (oldGame === undefined) delete globalThis.game;
    else globalThis.game = oldGame;
  }
});
test("a keyed hex with no typed title is named by its journal page, without the printed number", () => {
  const keyed = [{ uuid: "JournalEntry.a.JournalEntryPage.p", title: "3826 Haldrin's Tower" }];
  assert.equal(recordView({ ...base, cell: {}, keyed }).title, "Haldrin's Tower");
  assert.equal(recordView({ ...base, cell: { title: "My name" }, keyed }).title, "My name", "a typed title wins");
  assert.equal(recordView({ ...base, cell: {}, keyed: [] }).title, undefined, "no page, no invented title");
  assert.deepEqual(recordView({ ...base, cell: {}, keyed }).keyed, keyed);
});
test("private store reads are GM only; same offset in different scenes never shares data", async () => {
  const journals = ["a", "b"].map(id => ({ id, flags: { "shadowdark-enhancer": { hexRecords: { version: 1, sceneUuid: `Scene.${id}`, cells: { "-2_3": { title: id, terrain: "Forest", discovery: { revealed: true, visited: true } } } } } } }));
  const scene = id => ({ id, uuid: `Scene.${id}`, getFlag: () => null });
  globalThis.game = { user: { isGM: true }, journal: { contents: [] }, packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => journals }) } };
  await loadHexRecords();
  assert.equal(HexRecords.read(base.offset, scene("a")).title, "a");
  assert.equal(HexRecords.read(base.offset, scene("b")).title, "b");
  globalThis.game.user.isGM = false;
  assert.equal(HexRecords.read(base.offset, scene("a")), null);
  delete globalThis.game;
});
test("raw cell writes refuse archive and history fields but keep the editable set", async () => {
  const scene = { id: "s", uuid: "Scene.s", grid: { isHexagonal: false } };
  const oldGame = globalThis.game;
  globalThis.game = { user: { isGM: true }, journal: { contents: [] } };
  try {
    for (const patch of [{ legacy: {} }, { arrivalRolled: true }, { discovery: { revealed: false } }, { unknownField: 1 }]) {
      await assert.rejects(HexRecords.write({ i: 0, j: -1 }, patch, scene), /protectedField/);
    }
    await assert.rejects(HexRecords.write({ i: 0, j: -1 }, { title: "New" }, scene), /unreadable/, "an editable patch passes validation and stops where the store is missing");
  } finally {
    if (oldGame === undefined) delete globalThis.game; else globalThis.game = oldGame;
  }
});
test("publishing the players' view decodes the map's tags once, not once a recorded hex (a second a walked hex)", async () => {
  const { publishHexProjection, cacheHexJournal } = await import("../scripts/hex-map/hex-records.mjs");
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, replace: globalThis._replace };
  let decoded = 0, published = null;
  const tags = { origin: null, get cells() { decoded += 1; return {}; } };
  const scene = { id: "pub", uuid: "Scene.pub", getFlag: (mod, key) => (mod === MOD && key === "hexTags" ? tags : undefined) };
  const cells = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`${n}_0`, { discovery: { revealed: true } }]));
  cacheHexJournal({ id: "jpub", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.pub", cells } } } });
  const publicJournal = { flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.pub", cells: {} } } }, update: async (data) => { published = data; } };
  globalThis._replace = (value) => value;
  globalThis.game = { user: { isGM: true }, journal: { contents: [publicJournal], get: () => null },
    packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" } }) } };
  try {
    await publishHexProjection(scene);
    assert.ok(published, "the view is written");
    assert.equal(decoded, 1);
  } finally {
    globalThis._replace = saved.replace;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
});
test("a store the pack re-seated is read and published from the seated copy, not the one loaded first", async () => {
  const { publishHexProjection } = await import("../scripts/hex-map/hex-records.mjs");
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, replace: globalThis._replace };
  const store = revealed => ({ id: "jseat", ownership: { default: 0 }, update: async () => {},
    flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.seat", cells: { "1_1": { discovery: { revealed, visited: false } } } } } } });
  const loaded = store(false), seated = store(true), held = new Map();
  let published = null;
  const publicJournal = { flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.seat", cells: {} } } }, update: async data => { published = data; } };
  // getDocuments() answers with copies; the pack applies updates to the one it holds, and drops it when idle.
  const pack = { ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [loaded], get: id => held.get(id) };
  globalThis._replace = value => value;
  globalThis.game = { user: { isGM: true }, journal: { contents: [publicJournal], get: () => null }, packs: { get: () => pack } };
  const scene = { id: "seat", uuid: "Scene.seat", getFlag: () => null };
  const revealed = () => HexRecords.read({ i: 1, j: 1 }, scene).discovery.revealed;
  try {
    await loadHexRecords();
    assert.equal(revealed(), false, "until the pack holds a copy, the loaded one answers");
    held.set("jseat", seated);
    assert.equal(revealed(), true, "an update landed on the pack's copy: reads follow it");
    held.clear();
    assert.equal(revealed(), true, "once the pack drops it, the last copy it held answers, not the first one loaded");
    await publishHexProjection(scene);
    assert.ok(published["flags.shadowdark-enhancer.hexRecordProjection"].cells["1_1"], "players are shown the revealed hex");
  } finally {
    globalThis._replace = saved.replace;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
});
test("a write is based on the pack's held copy, so one reveal does not erase the others", async () => {
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, replace: globalThis._replace };
  const landed = [];
  const store = (name, keys) => ({ id: "jwrite", ownership: { default: 0 }, update: async data => { landed.push({ name, cells: Object.keys(data[`flags.${MOD}.hexRecords`].cells) }); },
    flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.write", cells: Object.fromEntries(keys.map(k => [k, { discovery: { revealed: true, visited: false } }])) } } } });
  const loaded = store("loaded", ["0_0"]), seated = store("seated", ["0_0", "0_1", "0_2"]), held = new Map();
  const publicJournal = { flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.write", cells: {} } } }, update: async () => {} };
  const pack = { ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [loaded], get: id => held.get(id) };
  globalThis._replace = value => value;
  globalThis.game = { user: { isGM: true }, journal: { contents: [publicJournal], get: () => null }, packs: { get: () => pack } };
  const scene = { id: "write", uuid: "Scene.write", grid: { isHexagonal: false }, getFlag: () => null };
  try {
    await loadHexRecords();
    held.set("jwrite", seated);
    await HexRecords.write({ i: 5, j: 0 }, { title: "New" }, scene);
    assert.deepEqual(landed.at(-1), { name: "seated", cells: ["0_0", "0_1", "0_2", "5_0"] }, "the update lands on the pack's copy and keeps every cell it holds");
    held.clear();
    await HexRecords.write({ i: 6, j: 0 }, { title: "Next" }, scene);
    assert.deepEqual(landed.at(-1), { name: "seated", cells: ["0_0", "0_1", "0_2", "6_0"] }, "once the pack drops it, the last held copy is the baseline, not the one loaded first");
  } finally {
    globalThis._replace = saved.replace;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
});

test("a keyed hex on a scene with no pins is named by its crawl row; the GM's title and a pinned page both win", () => {
  const base = { sceneUuid: "Scene.a", offset: { i: 0, j: 0 }, num: 5238 };
  assert.equal(recordView({ ...base, rowName: "The Swamp Ape" }).title, "The Swamp Ape");
  assert.equal(recordView({ ...base, rowName: "The Swamp Ape", keyed: [{ uuid: "x", title: "5238 Ape Lair" }] }).title, "Ape Lair");
  assert.equal(recordView({ ...base, rowName: "The Swamp Ape", cell: { title: "Typed" } }).title, "Typed");
  assert.equal(recordView(base).title, undefined);
});

test("crawl row names belong to the scene's own book: not another book's, not a scene no book claims, not a hex that is not keyed", async () => {
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, CONST: globalThis.CONST };
  const { hexNumberAt } = await import("../scripts/hex-map/hex-number-api.mjs");
  const { loadCrawlNames } = await import("../scripts/hex-map/hex-records.mjs");
  globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } };
  const origin = { q: 0, r: 0, num: "0000", shifted: "odd" };
  const forest = { i: 3, j: 4 }, keyed = { i: 5, j: 6 };
  const sceneOf = mapId => {
    const probe = { grid: { type: 4 }, getFlag: () => ({ origin }) };
    const cells = { [hexNumberAt(forest, probe)]: "forest|gm", [hexNumberAt(keyed, probe)]: "keyed_location|gm" };
    return { id: "s", uuid: "Scene.s", grid: { type: 4 }, notes: { contents: [] },
      getFlag: (m, k) => (k === "hexTags" ? { version: 1, origin, cells } : k === "hexMapId" ? mapId : null) };
  };
  const nums = [forest, keyed].map(o => hexNumberAt(o, sceneOf(null)));
  const crawl = (source, names) => {
    const flag = { crawl: "Invented crawl", source, keyed: nums.map((num, n) => ({ num: String(num).padStart(4, "0"), name: names[n] })) };
    return { getFlag: (m, k) => (m === MOD && k === "hex" ? flag : undefined) };
  };
  // Both numbers are keyed in two books, as the books' numbering ranges overlap.
  const entries = [crawl("GMWR", ["WR Place", "WR Keyed"]), crawl("CS1", ["CS1 Place", "CS1 Keyed"])];
  const pack = { metadata: { packageType: "world" }, collection: "world.sde-journal", getDocuments: async () => entries };
  globalThis.game = { user: { isGM: true }, journal: { contents: [] }, packs: Object.assign([pack], { get: () => null }) };
  try {
    await loadCrawlNames();
    const titles = mapId => [forest, keyed].map(o => HexRecords.read(o, sceneOf(mapId)).title);
    assert.deepEqual(titles("hex-cs1"), [undefined, "CS1 Keyed"], "its own book's row names the keyed hex; the forest hex stays unnamed");
    assert.deepEqual(titles("hex-wr"), [undefined, "WR Keyed"], "each scene reads only its own book");
    assert.deepEqual(titles("hex-cs2"), [undefined, undefined], "a book with no crawl filed names nothing");
    assert.deepEqual(titles(null), [undefined, undefined], "a scene no book claims names nothing");
  } finally {
    for (const [key, value] of [["game", saved.game], ["CONST", saved.CONST]]) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
test("a scene's book comes from its flag, else the tagged print bounds the tagger reads", () => {
  const scene = (mapId, bounds) => ({ getFlag: (_m, key) => (key === "hexMapId" ? mapId : key === "hexTags" ? (bounds ? { origin: { bounds } } : null) : undefined) });
  assert.equal(scenePrint(scene("hex-cs5", null))?.folder, "CS5");
  assert.equal(scenePrint(scene("hex-wr:cell", null))?.folder, "Western Reaches", "the cell suffix is not part of the map id");
  assert.equal(scenePrint(scene(null, { cols: 64, rows: 75, rowsLowered: 74 }))?.folder, "Western Reaches", "a painted copy carries no flag; its tags carry the print's bounds");
  assert.equal(scenePrint(scene(null, { cols: 17, rows: 22 })), null, "another size of map is not the print");
  assert.equal(scenePrint(scene("hex-nope", null)), null);
  assert.equal(scenePrint(scene(null, null)), null);
  assert.equal(scenePrint(undefined), null);
});
test("the book's crawl pages are found by number, scoped to that book, the deployed world copy first", async () => {
  const MOD = "shadowdark-enhancer", saved = globalThis.game;
  const page = (uuid, num, name) => ({ uuid, name, getFlag: (m, k) => (m === MOD && k === "hex" ? { num } : undefined) });
  const entry = (id, source, pages) => ({ id, getFlag: (m, k) => (m === MOD && k === "hex" ? { crawl: id, source } : undefined), pages: { contents: pages } });
  const packWr = entry("wr", "gmwr", [page("Compendium.world.sde-journal.JournalEntry.wr.JournalEntryPage.a", "1403", "1403 Thornmere (pack)"), page("Compendium.world.sde-journal.JournalEntry.wr.JournalEntryPage.b", "1404", "1404 Elsewhere")]);
  const packCs = entry("cs", "cs5", [page("Compendium.world.sde-journal.JournalEntry.cs.JournalEntryPage.x", "1403", "1403 The Wrong Book"), page("Compendium.world.sde-journal.JournalEntry.cs.JournalEntryPage.y", "", "")]);
  const worldWr = entry("wr", "gmwr", [page("JournalEntry.wr.JournalEntryPage.a", "1403", "1403 Thornmere")]);
  const pack = { metadata: { packageType: "world", label: "Shadowdark Enhancer — Journals" }, collection: "world.sde-journal", getDocuments: async () => [packWr, packCs] };
  const wrScene = { getFlag: (_m, key) => (key === "hexMapId" ? "hex-wr" : undefined) };
  const csScene = { getFlag: (_m, key) => (key === "hexMapId" ? "hex-cs5" : undefined) };
  globalThis.game = { packs: [pack], journal: { get: (id) => (id === "wr" ? worldWr : null) } };
  try {
    assert.deepEqual(await bookKeyedPages(wrScene, 1403), { book: true, imported: true, pages: [{ uuid: "JournalEntry.wr.JournalEntryPage.a", title: "1403 Thornmere" }] },
      "the world copy answers where the pin step deployed it; the other book's 1403 page and a numberless page stay out");
    assert.deepEqual(await bookKeyedPages(csScene, 1403), { book: true, imported: true, pages: [{ uuid: "Compendium.world.sde-journal.JournalEntry.cs.JournalEntryPage.x", title: "1403 The Wrong Book" }] },
      "with no world copy the pack copy answers, and only this book's entry");
    assert.deepEqual(await bookKeyedPages(wrScene, 1404), { book: true, imported: true, pages: [] }, "an imported crawl with no page for the hex is told apart from no crawl; the world copy stands in for the whole entry, pack-only pages included");
    globalThis.game.packs = [];
    assert.deepEqual(await bookKeyedPages(wrScene, 1403), { book: true, imported: false, pages: [] }, "no journals pack reads as nothing imported, not as an untied scene");
    globalThis.game.packs = [pack];
    assert.deepEqual(await bookKeyedPages({ getFlag: () => undefined }, 1403), { book: false, imported: false, pages: [] }, "a scene no book claims says so");
    assert.deepEqual(await bookKeyedPages(wrScene, null), { book: true, imported: true, pages: [] });
    assert.deepEqual(await bookKeyedPages(wrScene, 9999), { book: true, imported: true, pages: [] }, "a number outside the print is not a missing import");
  } finally {
    if (saved === undefined) delete globalThis.game; else globalThis.game = saved;
  }
});
test("one keyed row per document: the pinned page first, then the book's own", () => {
  assert.deepEqual(mergeKeyedPages([{ uuid: "a", title: "Pinned" }], [{ uuid: "a", title: "Book" }, { uuid: "b", title: "Second" }]),
    [{ uuid: "a", title: "Pinned" }, { uuid: "b", title: "Second" }]);
  assert.deepEqual(mergeKeyedPages([], []), []);
  assert.deepEqual(mergeKeyedPages(undefined, undefined), []);
});
test("projection journals leave the Journals sidebar, and so does a folder they alone fill for this viewer", async () => {
  const { hideProjectionJournals } = await import("../scripts/hex-map/hex-records.mjs");
  const MOD = "shadowdark-enhancer", saved = globalThis.game;
  const projection = (id, folder) => ({ id, folder: folder ? { id: folder } : null, flags: { [MOD]: { hexRecordProjection: { sceneUuid: `Scene.${id}` } } } });
  const journals = [projection("p1", "only"), projection("p2", "mixed"), { id: "note", folder: { id: "mixed" }, flags: {} },
    projection("p3", "hidden"), { id: "gmOnly", folder: { id: "hidden" }, visible: false, flags: {} },
    projection("p4", "parent")];
  const removed = [];
  const el = (key) => ({ remove: () => removed.push(key) });
  const rows = journals.map(j => ({ dataset: { entryId: j.id }, ...el(j.id) }));
  const root = { querySelectorAll: () => rows, querySelector: (sel) => el(sel.match(/data-folder-id="([^"]+)"/)[1]) };
  globalThis.game = { journal: Object.assign([...journals], { get: id => journals.find(j => j.id === id) }), folders: [{ id: "child", folder: { id: "parent" } }] };
  try {
    hideProjectionJournals(null, [root]);
    assert.deepEqual(removed.sort(), ["hidden", "only", "p1", "p2", "p3", "p4"],
      "every projection goes; a folder of only projections goes, as does one whose other journals this viewer cannot see; one with a sub-folder stays");
  } finally {
    if (saved === undefined) delete globalThis.game; else globalThis.game = saved;
  }
});
test("a scene with nothing disclosed gets no projection journal, while an existing one is still emptied", async () => {
  const { publishHexProjection, cacheHexJournal } = await import("../scripts/hex-map/hex-records.mjs");
  const MOD = "shadowdark-enhancer", saved = { game: globalThis.game, replace: globalThis._replace, JournalEntry: globalThis.JournalEntry };
  const scene = { id: "quiet", uuid: "Scene.quiet", getFlag: () => null };
  cacheHexJournal({ id: "jquiet", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.quiet", cells: { "0_0": { discovery: { revealed: false } } } } } } });
  let created = 0, published = null;
  globalThis.JournalEntry = { create: async () => { created += 1; } };
  globalThis._replace = (value) => value;
  globalThis.game = { user: { isGM: true }, journal: { contents: [], get: () => null }, i18n: { format: k => k },
    packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" } }) } };
  try {
    await publishHexProjection(scene);
    assert.equal(created, 0, "nothing disclosed: no journal");
    globalThis.game.journal.contents.push({ flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.quiet", cells: { "0_0": {} } } } }, update: async data => { published = data; } });
    await publishHexProjection(scene);
    assert.deepEqual(published[`flags.${MOD}.hexRecordProjection`].cells, {}, "an existing view is emptied, not stranded");
  } finally {
    globalThis._replace = saved.replace;
    if (saved.JournalEntry === undefined) delete globalThis.JournalEntry; else globalThis.JournalEntry = saved.JournalEntry;
    if (saved.game === undefined) delete globalThis.game; else globalThis.game = saved.game;
  }
});
