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
  ART_QUERY,
  PF_CHARACTER_ART_FOLDER,
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
