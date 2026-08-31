import { test } from "node:test";
import assert from "node:assert/strict";

const PF_ID = "pf2e-tokens-characters";
const PF_LABEL = "Pathfinder: Character Gallery";
const PF_TOKEN_DIR = `modules/${PF_ID}/assets/tokens`;
const PF_PORTRAIT_DIR = `modules/${PF_ID}/assets/portraits`;
const PF_SUBJECT_DIR = `modules/${PF_ID}/assets/subjects`;
const PF_MAP = `modules/${PF_ID}/data/compendium-map.json`;
const PF_CREDIT = "<em>Portrait, token, and subject artwork from the Pathfinder Tokens: Character Gallery.</em>";

let setting;
let browseResults = new Map();
let mapResults = new Map();
const browseCalls = [];

const FilePicker = {
  browse: async (source, folder) => {
    browseCalls.push({ source, folder });
    const result = browseResults.has(folder) ? browseResults.get(folder) : { files: [], dirs: [] };
    if (result instanceof Error) throw result;
    return result;
  },
};

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {},
    },
    apps: { FilePicker: { implementation: FilePicker } },
  },
  utils: {
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) => String(value ?? ""),
    fetchJsonWithTimeout: async (path) => {
      const result = mapResults.has(path) ? mapResults.get(path) : {};
      if (result instanceof Error) throw result;
      return result;
    },
  },
};
globalThis.game = {
  settings: {
    get: (_module, key) => key === "tokenArtManager" ? setting : undefined,
  },
  user: { isGM: true },
  system: { id: "shadowdark" },
  modules: [],
  packs: new Map(),
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { TokenArtCatalog } = await import("../scripts/monster-art/token-art-catalog.mjs");
const { MonsterTokenArt } = await import("../scripts/monster-art/monster-token-art.mjs");
const { TokenArtManagerApp } = await import("../scripts/monster-art/token-art-manager-app.mjs");

const names = ["pc-kyra-the-cleric.webp", "pc-amiri-the-barbarian.webp", "tempest-sun-mage.webp"];
const pathFor = (dir, file) => `${dir}/${file}`;
const mapFixture = () => ({
  "pf2e.iconics": {
    kyra: {
      actor: pathFor(PF_PORTRAIT_DIR, names[0]),
      token: {
        texture: { src: pathFor(PF_TOKEN_DIR, names[0]), scaleX: 2, scaleY: 2 },
        ring: { enabled: true, subject: { scale: 2 } },
      },
    },
    amiri: {
      actor: pathFor(PF_PORTRAIT_DIR, names[1]),
      token: {
        texture: { src: pathFor(PF_TOKEN_DIR, names[1]), scaleX: 1, scaleY: 1 },
        ring: { enabled: true, subject: { scale: 1 } },
      },
    },
  },
});

function configure({ active = true, token = names, portraits = names, subjects = names, map = mapFixture() } = {}) {
  setting = { priority: [], overrides: {}, picks: {}, folders: [] };
  browseResults = new Map([
    [PF_TOKEN_DIR, { files: token.map((file) => pathFor(PF_TOKEN_DIR, file)), dirs: [] }],
    [PF_PORTRAIT_DIR, { files: portraits.map((file) => pathFor(PF_PORTRAIT_DIR, file)), dirs: [] }],
    [PF_SUBJECT_DIR, { files: subjects.map((file) => pathFor(PF_SUBJECT_DIR, file)), dirs: [] }],
  ]);
  mapResults = new Map([[PF_MAP, map]]);
  browseCalls.length = 0;
  globalThis.game.modules = [{ id: PF_ID, title: PF_LABEL, active }];
  globalThis.game.packs = new Map();
}

function pfSource() {
  return TokenArtCatalog.FOLDER_SOURCES.find((source) => source.id === PF_ID);
}

test.after(() => {
  delete globalThis.game;
  delete globalThis.foundry;
  delete globalThis.ui;
});

test("registers only the verified Character Gallery roots, priority slot, and credit", () => {
  const source = pfSource();
  assert.deepEqual(source, {
    id: PF_ID,
    label: PF_LABEL,
    tokenDir: PF_TOKEN_DIR,
    portraitDir: PF_PORTRAIT_DIR,
    subjectDir: PF_SUBJECT_DIR,
    tokenMapping: PF_MAP,
    credit: PF_CREDIT,
  });
  assert.deepEqual(TokenArtCatalog.LIBRARY_DIRS[PF_ID], {
    label: PF_LABEL,
    root: PF_TOKEN_DIR,
    present: [PF_MAP],
    subjectDir: PF_SUBJECT_DIR,
    defaultScale: 1.0,
    subjectScale: 1.0,
    credit: PF_CREDIT,
  });
  assert.ok(TokenArtCatalog.DEFAULT_PRIORITY.indexOf(PF_ID) > TokenArtCatalog.DEFAULT_PRIORITY.indexOf("pf2e-tokens-monster-core"));
  assert.equal(TokenArtCatalog.DEFAULT_PRIORITY.indexOf(PF_ID), 3);
});

test("discovers the optional source when its token root is present", async () => {
  configure();

  const discovered = await TokenArtCatalog.discoverSources();
  const source = discovered.find((entry) => entry.id === PF_ID);

  assert.equal(source?.kind, "folder");
  assert.equal(source?.label, PF_LABEL);
  assert.equal(source?.tokenMapping, PF_MAP);
  assert.equal(source?.credit, PF_CREDIT);
  assert.deepEqual(browseCalls.filter(({ folder }) => folder === PF_TOKEN_DIR), [{ source: "data", folder: PF_TOKEN_DIR }]);
});

test("disabled Character Gallery assets remain available without checking module.active", async () => {
  configure({ active: false });

  const discovered = await TokenArtCatalog.discoverSources();
  const library = await TokenArtCatalog.buildLibrary();

  assert.equal(discovered.some((entry) => entry.id === PF_ID), true);
  assert.equal(library.some((entry) => entry.source === PF_ID), true);
});

test("automatic catalog matching preserves mapped scales and subject fallback", async () => {
  configure();
  const oldPresentPacks = MonsterTokenArt.presentPacks;
  MonsterTokenArt.presentPacks = () => ["shadowdark.monsters"];
  globalThis.game.packs = new Map([[
    "shadowdark.monsters",
    {
      getIndex: async () => names.map((file, i) => ({
        _id: `pc-${i}`,
        name: file.replace(/\.webp$/, "").replaceAll("-", " "),
        type: "NPC",
      })),
    },
  ]]);

  try {
    const catalog = await TokenArtCatalog.build();
    const source = catalog.sources.find((entry) => entry.id === PF_ID);
    const kyra = catalog.byMonster.find((entry) => entry.id === "pc-0");
    const tempest = catalog.byMonster.find((entry) => entry.id === "pc-2");

    assert.deepEqual(source, {
      id: PF_ID,
      label: PF_LABEL,
      kind: "folder",
      credit: PF_CREDIT,
      count: 3,
    });
    assert.deepEqual(kyra.options.map((option) => option.source), [PF_ID]);
    assert.equal(kyra.options[0].tokenObj.texture.scaleX, 2);
    assert.equal(kyra.options[0].tokenObj.ring.subject.scale, 2);
    assert.equal(tempest.options[0].tokenObj.texture.scaleX, 1);
    assert.equal(tempest.options[0].tokenObj.ring.enabled, true);
    assert.equal(tempest.options[0].tokenObj.ring.subject.texture, pathFor(PF_SUBJECT_DIR, names[2]));

    setting.priority = [PF_ID];
    const resolved = TokenArtCatalog.resolve(catalog);
    assert.equal(resolved.chosen["pc-0"], PF_ID);

    const cached = Object.create(TokenArtManagerApp.prototype);
    cached._catalog = catalog;
    cached._library = await TokenArtCatalog.buildLibrary();
    cached.render = async () => {};
    await TokenArtManagerApp._onRefresh.call(cached);
    assert.equal(cached._catalog, null);
    assert.equal(cached._library, null);
  } finally {
    MonsterTokenArt.presentPacks = oldPresentPacks;
  }
});

test("Browse library reuses authored map scale/ring data and pairs unmapped subjects", async () => {
  configure();

  const library = await TokenArtCatalog.buildLibrary();
  const kyra = library.find((entry) => entry.source === PF_ID && entry.file === names[0]);
  const amiri = library.find((entry) => entry.source === PF_ID && entry.file === names[1]);
  const tempest = library.find((entry) => entry.source === PF_ID && entry.file === names[2]);

  assert.equal(kyra.label, PF_LABEL);
  assert.equal(kyra.portrait, pathFor(PF_PORTRAIT_DIR, names[0]));
  assert.equal(kyra.tokenObj.texture.scaleX, 2);
  assert.equal(kyra.tokenObj.ring.subject.scale, 2);
  assert.equal(amiri.tokenObj.texture.scaleX, 1);
  assert.equal(amiri.tokenObj.ring.subject.scale, 1);
  assert.equal(tempest.tokenObj.texture.scaleX, 1);
  assert.equal(tempest.tokenObj.ring.enabled, true);
  assert.deepEqual(tempest.tokenObj.ring.subject, {
    scale: 1,
    texture: pathFor(PF_SUBJECT_DIR, names[2]),
  });
});

test("adding PF art does not move F1 manual folders into automatic matching or ownership", async () => {
  configure();
  const manualPath = "custom/tokens";
  const witness = `${manualPath}/old.webp`;
  setting.folders = [{ label: "Manual", path: manualPath }];
  setting.managedPaths = [witness];
  browseResults.set(manualPath, { files: [`${manualPath}/pc-kyra-the-cleric.webp`], dirs: [] });

  const library = await TokenArtCatalog.buildLibrary();
  assert.equal(library.some((entry) => entry.source === `manual-folder:${manualPath}`), true);
  assert.deepEqual(TokenArtCatalog.managedArtPaths(), [witness]);

  const oldPresentPacks = MonsterTokenArt.presentPacks;
  MonsterTokenArt.presentPacks = () => ["shadowdark.monsters"];
  globalThis.game.packs = new Map([[
    "shadowdark.monsters",
    { getIndex: async () => [{ _id: "pc-0", name: "PC Kyra The Cleric", type: "NPC" }] },
  ]]);
  try {
    const catalog = await TokenArtCatalog.build();
    assert.equal(catalog.sources.some((entry) => entry.id === `manual-folder:${manualPath}`), false);
    assert.deepEqual(catalog.byMonster[0].options.map((option) => option.source), [PF_ID]);
  } finally {
    MonsterTokenArt.presentPacks = oldPresentPacks;
  }
});

test("absent or unreadable Character Gallery roots are skipped without affecting the catalog", async () => {
  configure();
  globalThis.game.modules = [];
  browseResults.set(PF_TOKEN_DIR, new Error("optional module absent"));

  const discovered = await TokenArtCatalog.discoverSources();
  const library = await TokenArtCatalog.buildLibrary();

  assert.equal(discovered.some((entry) => entry.id === PF_ID), false);
  assert.equal(library.some((entry) => entry.source === PF_ID), false);
});

test("malformed optional layout metadata is contained and falls back to safe defaults", async () => {
  configure({ map: null });
  browseResults.set(PF_TOKEN_DIR, {
    files: [pathFor(PF_TOKEN_DIR, names[2])],
    dirs: { not: "an array" },
  });
  browseResults.set(PF_PORTRAIT_DIR, { files: [pathFor(PF_PORTRAIT_DIR, names[2])], dirs: [] });
  browseResults.set(PF_SUBJECT_DIR, { files: [pathFor(PF_SUBJECT_DIR, names[2])], dirs: [] });

  const discovered = await TokenArtCatalog.discoverSources();
  const library = await TokenArtCatalog.buildLibrary();
  const tempest = library.find((entry) => entry.source === PF_ID && entry.file === names[2]);

  assert.equal(discovered.some((entry) => entry.id === PF_ID), true);
  assert.equal(tempest.tokenObj.texture.scaleX, 1);
  assert.equal(tempest.tokenObj.ring.enabled, true);
  assert.equal(tempest.tokenObj.ring.subject.texture, pathFor(PF_SUBJECT_DIR, names[2]));
});

test("a malformed token-root response is treated as absent rather than throwing", async () => {
  configure();
  browseResults.set(PF_TOKEN_DIR, { files: "not-an-array", dirs: { nested: true } });

  await assert.doesNotReject(async () => {
    const discovered = await TokenArtCatalog.discoverSources();
    const library = await TokenArtCatalog.buildLibrary();
    assert.equal(discovered.some((entry) => entry.id === PF_ID), false);
    assert.equal(library.some((entry) => entry.source === PF_ID), false);
  });
});
