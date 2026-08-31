import { test } from "node:test";
import assert from "node:assert/strict";

let setting;
let promptResult = null;
let confirmResult = false;
const browseResults = new Map();
const browseCalls = [];
const notices = [];

const FilePicker = {
  browse: async (source, folder) => {
    browseCalls.push({ source, folder });
    const result = browseResults.get(folder);
    if (result instanceof Error) throw result;
    return result ?? { files: [], dirs: [] };
  },
};

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: {
        prompt: async () => promptResult,
        confirm: async () => confirmResult,
      },
    },
    apps: { FilePicker: { implementation: FilePicker } },
  },
  utils: {
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
  },
};
globalThis.game = {
  settings: {
    get: (_module, key) => key === "tokenArtManager" ? setting : undefined,
    set: async (_module, key, value) => { if (key === "tokenArtManager") setting = value; },
  },
  user: { isGM: true },
  modules: [],
  system: { id: "shadowdark" },
  packs: new Map(),
};
globalThis.ui = {
  notifications: {
    info: (message) => notices.push(["info", message]),
    warn: (message) => notices.push(["warn", message]),
    error: (message) => notices.push(["error", message]),
  },
};

const { normalizeTokenArtManagerState, tokenArtFolderSourceId } = await import(
  "../scripts/monster-art/token-art-manager-state.mjs"
);
const { TokenArtCatalog } = await import("../scripts/monster-art/token-art-catalog.mjs");
const { MonsterTokenArt } = await import("../scripts/monster-art/monster-token-art.mjs");
const { TokenArtManagerApp } = await import("../scripts/monster-art/token-art-manager-app.mjs");

function configure(next = {}) {
  setting = next;
  promptResult = null;
  confirmResult = false;
  browseResults.clear();
  browseCalls.length = 0;
  notices.length = 0;
  globalThis.game.user.isGM = true;
}

test("normalizer adds folders without dropping old or future setting fields", () => {
  const future = { enabledBy: "later" };
  const normalized = normalizeTokenArtManagerState({
    priority: ["source-a"],
    overrides: { goblin: "source-a" },
    picks: { goblin: { file: "goblin.webp" } },
    folders: [
      { label: "  My Tokens ", path: "  custom/tokens/ ", futureFolderKey: true },
      { label: "", path: "ignored" },
      { label: "Ignored", path: "" },
    ],
    future,
  });

  assert.deepEqual(normalized, {
    priority: ["source-a"],
    overrides: { goblin: "source-a" },
    picks: { goblin: { file: "goblin.webp" } },
    folders: [{ label: "My Tokens", path: "custom/tokens/", futureFolderKey: true }],
    future,
  });
});

test("old manager state receives an empty folders list and remains detached", () => {
  const old = { priority: ["source-a"], overrides: {}, picks: {}, future: { keep: true } };
  const normalized = normalizeTokenArtManagerState(old);
  assert.deepEqual(normalized, { ...old, folders: [] });
  assert.notEqual(normalized.priority, old.priority);
  assert.notEqual(normalized.overrides, old.overrides);
  assert.notEqual(normalized.picks, old.picks);
  assert.equal(old.folders, undefined);
});

test("buildLibrary includes named folders as Browse-only sources", async () => {
  configure({ priority: ["source-a"], overrides: {}, picks: {}, folders: [{ label: "My Tokens", path: "custom/tokens" }] });
  browseResults.set("custom/tokens", { files: ["custom/tokens/Goblin.webp", "custom/tokens/readme.txt"], dirs: [] });
  const oldDirs = TokenArtCatalog.LIBRARY_DIRS;
  const oldAutos = TokenArtCatalog._discoverPf2eTokenModules;
  TokenArtCatalog.LIBRARY_DIRS = {};
  TokenArtCatalog._discoverPf2eTokenModules = async () => [];
  try {
    const library = await TokenArtCatalog.buildLibrary();
    assert.deepEqual(library.map(({ source, label, file, token }) => ({ source, label, file, token })), [{
      source: tokenArtFolderSourceId({ path: "custom/tokens" }),
      label: "My Tokens",
      file: "Goblin.webp",
      token: "custom/tokens/Goblin.webp",
    }]);
    assert.ok(TokenArtCatalog.managedArtPrefixes().includes("custom/tokens/"));
  } finally {
    TokenArtCatalog.LIBRARY_DIRS = oldDirs;
    TokenArtCatalog._discoverPf2eTokenModules = oldAutos;
  }
});

test("an unreadable named folder is skipped locally", async () => {
  configure({ priority: [], overrides: {}, picks: {}, folders: [{ label: "Missing", path: "missing/tokens" }] });
  browseResults.set("missing/tokens", new Error("not found"));
  const oldDirs = TokenArtCatalog.LIBRARY_DIRS;
  const oldAutos = TokenArtCatalog._discoverPf2eTokenModules;
  TokenArtCatalog.LIBRARY_DIRS = {};
  TokenArtCatalog._discoverPf2eTokenModules = async () => [];
  try {
    await assert.doesNotReject(async () => {
      assert.deepEqual(await TokenArtCatalog.buildLibrary(), []);
    });
  } finally {
    TokenArtCatalog.LIBRARY_DIRS = oldDirs;
    TokenArtCatalog._discoverPf2eTokenModules = oldAutos;
  }
});

test("named folders do not enter automatic catalog matching", async () => {
  configure({ priority: [], overrides: {}, picks: {}, folders: [{ label: "My Tokens", path: "custom/tokens" }] });
  browseResults.set("custom/tokens", { files: ["custom/tokens/Goblin.webp"], dirs: [] });
  const oldPresent = MonsterTokenArt.presentPacks;
  const oldDiscover = TokenArtCatalog.discoverSources;
  const oldPacks = globalThis.game.packs;
  MonsterTokenArt.presentPacks = () => ["shadowdark.monsters"];
  TokenArtCatalog.discoverSources = async () => [];
  globalThis.game.packs = new Map([["shadowdark.monsters", { getIndex: async () => [{ _id: "goblin", name: "Goblin", type: "NPC" }] }]]);
  try {
    const catalog = await TokenArtCatalog.build();
    assert.deepEqual(catalog.sources, []);
    assert.deepEqual(catalog.byMonster, [{ id: "goblin", name: "Goblin", pack: "shadowdark.monsters", options: [] }]);
  } finally {
    MonsterTokenArt.presentPacks = oldPresent;
    TokenArtCatalog.discoverSources = oldDiscover;
    globalThis.game.packs = oldPacks;
  }
});

test("manager save normalizes while preserving priority, picks, overrides, and unknown fields", async () => {
  configure({
    priority: ["source-a"],
    overrides: { goblin: "source-a" },
    picks: { goblin: { file: "goblin.webp" } },
    future: { keep: true },
  });
  const app = Object.create(TokenArtManagerApp.prototype);
  const saved = await app._saveState({ folders: [{ label: "My Tokens", path: "custom/tokens" }] });
  assert.deepEqual(saved, {
    priority: ["source-a"],
    overrides: { goblin: "source-a" },
    picks: { goblin: { file: "goblin.webp" } },
    future: { keep: true },
    folders: [{ label: "My Tokens", path: "custom/tokens" }],
  });
  assert.deepEqual(setting, saved);
});

test("GM folder UI validates add, edit, and remove without touching other state", async () => {
  configure({
    priority: ["source-a"],
    overrides: { goblin: "source-a" },
    picks: { goblin: { file: "goblin.webp" } },
    future: { keep: true },
    folders: [{ label: "Old", path: "old/tokens", futureFolderKey: 7 }],
  });
  browseResults.set("new/tokens", { files: ["new/tokens/Goblin.webp"], dirs: [] });
  const app = Object.create(TokenArtManagerApp.prototype);
  app.render = async () => {};
  app._catalog = { cached: true };
  app._library = [{ cached: true }];

  promptResult = { label: "New", path: "new/tokens" };
  assert.equal(await TokenArtManagerApp._onFolderEdit.call(app, null, { dataset: { folder: "0" } }), true);
  assert.deepEqual(setting.folders, [{ label: "New", path: "new/tokens", futureFolderKey: 7 }]);
  assert.deepEqual(setting.priority, ["source-a"]);
  assert.deepEqual(setting.overrides, { goblin: "source-a" });
  assert.deepEqual(setting.picks, { goblin: { file: "goblin.webp" } });
  assert.deepEqual(setting.future, { keep: true });
  assert.equal(app._catalog, null);
  assert.equal(app._library, null);

  promptResult = { label: "Bad", path: "missing/tokens" };
  browseResults.set("missing/tokens", new Error("permission denied"));
  assert.equal(await TokenArtManagerApp._onFolderAdd.call(app), false);
  assert.deepEqual(setting.folders, [{ label: "New", path: "new/tokens", futureFolderKey: 7 }]);
  assert.ok(notices.some(([kind]) => kind === "error"));

  confirmResult = true;
  assert.equal(await TokenArtManagerApp._onFolderRemove.call(app, null, { dataset: { folder: "0" } }), true);
  assert.deepEqual(setting.folders, []);
});

test("non-GMs cannot mutate named Browse folders", async () => {
  configure({ folders: [{ label: "Keep", path: "custom/tokens" }] });
  globalThis.game.user.isGM = false;
  const app = Object.create(TokenArtManagerApp.prototype);
  app.render = async () => {};
  promptResult = { label: "Nope", path: "other/tokens" };
  assert.equal(await TokenArtManagerApp._onFolderAdd.call(app), false);
  assert.deepEqual(setting.folders, [{ label: "Keep", path: "custom/tokens" }]);
  assert.equal(await TokenArtManagerApp._onFolderRemove.call(app, null, { dataset: { folder: "0" } }), false);
  assert.deepEqual(setting.folders, [{ label: "Keep", path: "custom/tokens" }]);
});
