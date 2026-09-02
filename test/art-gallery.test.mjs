/**
 * Character Builder gallery integration for the optional Pathfinder Character
 * Gallery module.
 *
 * The real gallery browse is exercised with a small Foundry surface stub so
 * these tests cover both clients: a GM browses locally, while a permissionless
 * player only asks the active GM's registered query for the already-filtered
 * file list.
 */
import test from "node:test";
import assert from "node:assert/strict";

const saved = {
  game: globalThis.game,
  foundry: globalThis.foundry,
  CONST: globalThis.CONST,
  CONFIG: globalThis.CONFIG,
};

const PF_FOLDER = "modules/pf2e-tokens-characters/assets/portraits";
let setting = "";
let browseResults = new Map();
const browseCalls = [];

globalThis.CONST = { IMAGE_FILE_EXTENSIONS: { webp: true, png: true, jpg: true } };
globalThis.CONFIG = { queries: {} };
globalThis.foundry = {
  applications: {
    apps: {
      FilePicker: {
        implementation: {
          browse: async (source, folder) => {
            browseCalls.push({ source, folder });
            const result = browseResults.get(folder);
            if (result instanceof Error) throw result;
            return result ?? { files: [] };
          },
        },
      },
    },
  },
};
globalThis.game = {
  settings: { get: () => setting },
  user: { can: () => true },
  users: { activeGM: null },
};

const {
  ANCESTRY_TAGS,
  ART_QUERY,
  ancestryKey,
  PF_CHARACTER_ART_FOLDER,
  datasheetEntries,
  galleryEntries,
  galleryFolders,
  listGalleryArt,
  registerArtGalleryQuery,
} = await import("../scripts/char-builder/art-gallery.mjs");

function configure({ raw = "custom/portraits", canBrowse = true, activeGM = null } = {}) {
  setting = raw;
  browseResults = new Map();
  browseCalls.length = 0;
  globalThis.game.user.can = () => canBrowse;
  globalThis.game.users.activeGM = activeGM;
}

test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

test("galleryFolders appends the PF portraits root without changing custom order", () => {
  configure({ raw: "custom/first/,\n custom/second; custom/first" });

  assert.deepEqual(galleryFolders(), ["custom/first", "custom/second", PF_FOLDER]);
  assert.equal(PF_CHARACTER_ART_FOLDER, PF_FOLDER);
});

test("a blank setting still disables the gallery", () => {
  configure({ raw: "  \n ; , " });
  assert.deepEqual(galleryFolders(), []);
});

test("the GM browse merges PF portraits with custom images and filters non-images", async () => {
  configure();
  browseResults.set("custom/portraits", {
    files: ["custom/portraits/zulu.webp", "custom/portraits/readme.txt"],
  });
  browseResults.set(PF_FOLDER, {
    files: ["modules/pf2e-tokens-characters/assets/portraits/Amiri.webp", "custom/portraits/zulu.webp"],
  });

  const files = await listGalleryArt();

  assert.deepEqual(files, [
    "modules/pf2e-tokens-characters/assets/portraits/Amiri.webp",
    "custom/portraits/zulu.webp",
  ]);
  assert.deepEqual(browseCalls, [
    { source: "data", folder: "custom/portraits" },
    { source: "data", folder: PF_FOLDER },
  ]);
});

test("a missing PF directory is skipped without dropping custom gallery results", async () => {
  configure();
  browseResults.set("custom/portraits", { files: ["custom/portraits/keep.png"] });
  browseResults.set(PF_FOLDER, new Error("directory does not exist"));

  assert.deepEqual(await listGalleryArt(), ["custom/portraits/keep.png"]);
});

test("a player uses the existing GM query and never browses locally", async () => {
  const calls = [];
  configure({
    canBrowse: false,
    activeGM: {
      query: async (...args) => {
        calls.push(args);
        return { files: [`${PF_FOLDER}/Kyra.webp`] };
      },
    },
  });

  assert.deepEqual(await listGalleryArt(), [`${PF_FOLDER}/Kyra.webp`]);
  assert.deepEqual(calls, [[ART_QUERY, {}, { timeout: 10_000 }]]);
  assert.deepEqual(browseCalls, []);
});

test("the registered GM query returns custom and PF files with PF absence tolerated", async () => {
  configure();
  browseResults.set("custom/portraits", { files: ["custom/portraits/keep.webp"] });
  browseResults.set(PF_FOLDER, new Error("optional module absent"));
  registerArtGalleryQuery();

  const result = await globalThis.CONFIG.queries[ART_QUERY]({ ignored: "payload" });

  assert.deepEqual(result.files, ["custom/portraits/keep.webp"]);
  assert.deepEqual(result.folders, ["custom/portraits", PF_FOLDER]);
});

// ─── Datasheets ──────────────────────────────────────────────────────────────
//
// A module may publish a manifest ABOUT its art (label, per-slot paths, tag
// groups) through `flags.galleryDatasheets`. That metadata is what makes a
// 1,200-image folder searchable, so these cover the two things that go wrong
// silently: the token slot handing back a portrait, and the same character
// appearing twice because the folder browse also found its raw file.

const SHEET = "modules/pf/data/datasheet.json";
const ROW = {
  label: "Aldori Swordlord",
  source: "Lost Omens Character Guide",
  art: {
    portrait: `${PF_FOLDER}/aldori-swordlord.webp`,
    token: "modules/pf/assets/tokens/aldori-swordlord.webp",
    thumb: "modules/pf/assets/thumbnails/aldori-swordlord.webp",
  },
  tags: { ancestry: ["human"], family: ["warrior", "affluent"] },
};

/** Declare `sheets` on a fake module list and serve `body` from fetch. */
function withDatasheet(body, { active = true } = {}) {
  globalThis.game.modules = [{ active, flags: { galleryDatasheets: { "character-gallery": { sheet: SHEET } } } }];
  globalThis.fetch = async (path) => (path === SHEET
    ? { ok: true, json: async () => body }
    : { ok: false, status: 404, json: async () => [] });
}

test.afterEach(() => {
  delete globalThis.game.modules;
  delete globalThis.fetch;
});

test("a datasheet row becomes a tagged entry, and the token slot gets the TOKEN art", async () => {
  configure();
  withDatasheet([ROW]);

  const [portrait] = await datasheetEntries("portrait");
  assert.equal(portrait.src, ROW.art.portrait);
  assert.equal(portrait.thumb, ROW.art.thumb);
  assert.equal(portrait.label, "Aldori Swordlord");
  assert.deepEqual(portrait.tags, { ancestry: ["human"], family: ["warrior", "affluent"] });

  const [token] = await datasheetEntries("token");
  assert.equal(token.src, ROW.art.token, "the token slot must not hand back a portrait");
});

test("a row missing the requested slot falls back rather than vanishing", async () => {
  configure();
  withDatasheet([{ label: "Portrait Only", art: { portrait: `${PF_FOLDER}/only.webp` } }]);

  const [token] = await datasheetEntries("token");
  assert.equal(token.src, `${PF_FOLDER}/only.webp`);
});

test("an inactive module's datasheet is not read", async () => {
  configure();
  withDatasheet([ROW], { active: false });

  assert.deepEqual(await datasheetEntries("portrait"), []);
});

test("an unreadable datasheet degrades to the plain folder browse", async () => {
  configure();
  globalThis.game.modules = [{ active: true, flags: { galleryDatasheets: { g: { sheet: SHEET } } } }];
  globalThis.fetch = async () => { throw new Error("offline"); };
  browseResults.set("custom/portraits", { files: ["custom/portraits/keep.webp"] });

  const entries = await galleryEntries("portrait");
  assert.deepEqual(entries.map((e) => e.src), ["custom/portraits/keep.webp"]);
});

test("a described entry suppresses the browsed copy of every path it owns", async () => {
  configure();
  withDatasheet([ROW]);
  // The folder browse finds the same character's raw portrait file. Without
  // path coverage the token slot would list Aldori twice — once described, once
  // as a bare filename.
  browseResults.set(PF_FOLDER, { files: [ROW.art.portrait] });
  browseResults.set("custom/portraits", { files: ["custom/portraits/zzz-own.webp"] });

  const entries = await galleryEntries("token");
  assert.deepEqual(entries.map((e) => e.label), ["Aldori Swordlord", "zzz own"]);
  assert.deepEqual(entries.map((e) => e.src), [ROW.art.token, "custom/portraits/zzz-own.webp"]);
});

test("an undescribed file still carries a readable label and empty facets", async () => {
  configure();
  browseResults.set("custom/portraits", { files: ["custom/portraits/half_elf-ranger.webp"] });

  const [entry] = await galleryEntries("portrait");
  assert.equal(entry.label, "half elf ranger");
  assert.deepEqual(entry.tags, {});
  assert.equal(entry.thumb, entry.src, "with no thumbnail the full image is the thumb");
});

// ─── Curated ancestry filter ─────────────────────────────────────────────────

test("Shadowdark ancestry names fold to their tag keys", () => {
  assert.equal(ancestryKey("Half-Elf"), "halfelf");
  assert.equal(ancestryKey("half elf"), "halfelf");
  assert.equal(ancestryKey("Half-Orc"), "halforc");
  assert.equal(ancestryKey(null), "");
});

test("the half-ancestries accept Pathfinder's own names for them", () => {
  // Matching only "elf"/"orc" would drop every portrait tagged as specifically
  // half-ancestry, which are the closest matches there are.
  // Order matters, not just membership: the filter promotes the FIRST tag to the
  // front of the grid, so the exact half-ancestry art leads and the borrowed
  // elf/orc art follows. Swapping these silently buries the best matches.
  assert.deepEqual(ANCESTRY_TAGS.halfelf.tags, ["aiuvarin", "elf"]);
  assert.deepEqual(ANCESTRY_TAGS.halforc.tags, ["dromaar", "orc"]);
  assert.deepEqual(Object.keys(ANCESTRY_TAGS).sort(), [
    "dwarf", "elf", "goblin", "halfelf", "halfling", "halforc", "human", "kobold",
  ]);
  // "halfling" is not a half-ancestry — a label derived from the key spelled it
  // "Half-Ling" in the live dialog, so the labels are written out, not computed.
  assert.equal(ANCESTRY_TAGS.halfling.label, "Halfling");
  assert.equal(ANCESTRY_TAGS.halfelf.label, "Half-Elf");
});
