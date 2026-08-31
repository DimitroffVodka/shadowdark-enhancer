import { test } from "node:test";
import assert from "node:assert/strict";

import { IMPORTED_MONSTER_ART } from "../scripts/monster-art/imported-monster-art.mjs";

// TokenArtCatalog.resolve()/resolvePriority read game.settings, and
// applyResolvedToPlaced reads game.user/scenes/actors. Stub those globals
// BEFORE importing (dynamic import runs after these assignments) so the pure
// choice logic can be exercised without a live Foundry world.
let SETTINGS = { priority: [], overrides: {} };
globalThis.game = {
  settings: { get: (_mod, key) => (key === "tokenArtManager" ? SETTINGS : undefined) },
  user: { isGM: true },
  actors: [],
  scenes: { active: null },
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {},
    },
  },
  utils: {
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) => String(value ?? ""),
  },
};

const { TokenArtCatalog } = await import("../scripts/monster-art/token-art-catalog.mjs");
const { MonsterTokenArt } = await import("../scripts/monster-art/monster-token-art.mjs");
const { TokenArtManagerApp } = await import("../scripts/monster-art/token-art-manager-app.mjs");

// --- helpers ---------------------------------------------------------------
const opt = (source, tag) => ({
  source,
  portrait: `port/${tag ?? source}`,
  tokenObj: { texture: { src: `tok/${tag ?? source}` } },
});
const pathOpt = (source, token, portrait = token) => ({
  source,
  token,
  portrait,
  tokenObj: { texture: { src: token } },
});
const cat = (byMonster, sources) => ({
  sources: sources ?? [{ id: "src-a" }, { id: "src-b" }],
  byMonster,
});

// --- resolve(): rank by CURRENT priority (finding #1) ----------------------
test("resolve picks the highest-priority option regardless of build-time order", () => {
  SETTINGS = { priority: ["src-a", "src-b"], overrides: {} };
  // options[0] is the LOWER-priority source; resolve must still pick src-a.
  const c = cat([{ id: "m1", name: "Goblin", pack: "shadowdark.monsters", options: [opt("src-b"), opt("src-a")] }]);
  const { chosen, tables } = TokenArtCatalog.resolve(c);
  assert.equal(chosen.m1, "src-a");
  assert.equal(tables["shadowdark.monsters"].m1.token.texture.src, "tok/src-a");
});

test("resolve reflects a flipped priority without rebuilding the catalog", () => {
  const c = cat([{ id: "m1", name: "Goblin", pack: "shadowdark.monsters", options: [opt("src-b"), opt("src-a")] }]);
  SETTINGS = { priority: ["src-a", "src-b"], overrides: {} };
  assert.equal(TokenArtCatalog.resolve(c).chosen.m1, "src-a");
  SETTINGS = { priority: ["src-b", "src-a"], overrides: {} };
  assert.equal(TokenArtCatalog.resolve(c).chosen.m1, "src-b");   // same catalog, new default
});

test("resolve: an explicit per-monster override beats priority", () => {
  SETTINGS = { priority: ["src-a", "src-b"], overrides: { m1: "src-b" } };
  const c = cat([{ id: "m1", name: "Goblin", pack: "shadowdark.monsters", options: [opt("src-a"), opt("src-b")] }]);
  assert.equal(TokenArtCatalog.resolve(c).chosen.m1, "src-b");
});

test("resolve: a Community pin overrides priority when a Community option exists", () => {
  SETTINGS = { priority: ["dnd-monster-manual", "shadowdark-community-tokens"], overrides: {} };
  const sources = [{ id: "dnd-monster-manual" }, { id: "shadowdark-community-tokens" }];
  const withCommunity = cat([{ id: "m1", name: "Rime Walker", pack: "shadowdark.monsters",
    options: [opt("dnd-monster-manual"), opt("shadowdark-community-tokens")] }], sources);
  assert.equal(TokenArtCatalog.resolve(withCommunity).chosen.m1, "shadowdark-community-tokens");
  // …but falls back to priority when the pinned source has no art for it.
  const noCommunity = cat([{ id: "m1", name: "Rime Walker", pack: "shadowdark.monsters",
    options: [opt("dnd-monster-manual")] }], sources);
  assert.equal(TokenArtCatalog.resolve(noCommunity).chosen.m1, "dnd-monster-manual");
});

test("resolve leaves an N6 reviewed-unmatched Tar Bat Browse-only despite generic bat.webp", () => {
  SETTINGS = { priority: ["dnd-monster-manual"], overrides: {}, picks: {} };
  const genericBat = pathOpt(
    "dnd-monster-manual",
    "modules/dnd-monster-manual/assets/tokens/bat.webp",
  );
  const c = cat([
    {
      id: "tar-bat",
      name: "Tar Bat",
      pack: "world.sde-actors",
      managedImported: true,
      curatedImportedArt: { key: "CS1:tar bat", status: "unmatched" },
      options: [genericBat],
    },
  ], [{ id: "dnd-monster-manual" }]);

  const resolved = TokenArtCatalog.resolve(c);
  assert.equal(resolved.tables["world.sde-actors"], undefined);
  assert.equal(resolved.stats.mapped, 0);
  assert.equal(c.byMonster[0].options.length, 1, "Browse still sees the generic option");
});

test("resolve suppresses a missing reviewed path but allows a manual pick or explicit override", () => {
  const fuzzy = pathOpt(
    "dnd-monster-manual",
    "modules/dnd-monster-manual/assets/tokens/sea-serpent.webp",
  );
  const c = cat([
    {
      id: "sea-serpent",
      name: "Sea Serpent",
      pack: "world.sde-actors",
      managedImported: true,
      curatedImportedArt: { key: "CS3:sea serpent", status: "path-unavailable" },
      options: [fuzzy],
    },
  ], [{ id: "dnd-monster-manual" }]);

  SETTINGS = { priority: ["dnd-monster-manual"], overrides: {}, picks: {} };
  assert.equal(TokenArtCatalog.resolve(c).tables["world.sde-actors"], undefined);

  SETTINGS = {
    priority: ["dnd-monster-manual"],
    overrides: { "sea-serpent": "dnd-monster-manual" },
    picks: {},
  };
  assert.equal(TokenArtCatalog.resolve(c).chosen["sea-serpent"], "dnd-monster-manual");

  SETTINGS = {
    priority: ["dnd-monster-manual"],
    overrides: {},
    picks: {
      "sea-serpent": {
        source: "manual-folder:gm",
        token: "gm/sea.webp",
        portrait: "gm/sea.webp",
        tokenObj: { texture: { src: "gm/sea.webp" } },
      },
    },
  };
  const manual = TokenArtCatalog.resolve(c);
  assert.equal(manual.chosen["sea-serpent"], "__manual__");
  assert.equal(manual.tables["world.sde-actors"]["sea-serpent"].actor, "gm/sea.webp");
});

// --- reorder(): display order follows priority -----------------------------
test("reorder sorts each monster's options into priority order", () => {
  const c = cat([{ id: "m1", name: "X", options: [opt("src-b"), opt("src-a")] }]);
  TokenArtCatalog.reorder(c, ["src-a", "src-b"]);
  assert.deepEqual(c.byMonster[0].options.map((o) => o.source), ["src-a", "src-b"]);
});

test("the managed-pack census keeps one NPC row per id and skips non-monsters", () => {
  const rows = TokenArtCatalog._monsterEntries([
    { _id: "boat", name: "Canoe", type: "shadowdark-enhancer.boat" },
    { _id: "core", name: "Goblin", type: "NPC" },
    { _id: "core", name: "Goblin", type: "NPC" },
    { _id: "imported", name: "Goblin", type: "npc" },
  ], "world.sde-actors");
  assert.deepEqual(rows, [
    { id: "core", name: "Goblin", pack: "world.sde-actors" },
    { id: "imported", name: "Goblin", pack: "world.sde-actors" },
  ]);
});

test("managed imported census includes both mount forms but never boats or Core mounts", () => {
  const entries = [
    { _id: "npc", name: "Goblin", type: "NPC" },
    { _id: "mount", name: "Horse", type: "Mount" },
    { _id: "namespaced-mount", name: "Horse, War", type: "shadowdark-enhancer.mount" },
    { _id: "boat", name: "Canoe", type: "shadowdark-enhancer.boat" },
  ];
  assert.deepEqual(
    TokenArtCatalog._monsterEntries(entries, "world.sde-actors", { includeManagedTypes: true })
      .map(({ id, name }) => ({ id, name })),
    [
      { id: "npc", name: "Goblin" },
      { id: "mount", name: "Horse" },
      { id: "namespaced-mount", name: "Horse, War" },
    ],
  );
  assert.deepEqual(
    TokenArtCatalog._monsterEntries(entries, "shadowdark.monsters").map(({ id }) => id),
    ["npc"],
    "Core remains NPC-only even when the wider managed type option is available",
  );
});

test("build preserves Core/imported provenance and zero-option imported rows", async () => {
  const original = {
    presentPacks: MonsterTokenArt.presentPacks,
    discoverSources: TokenArtCatalog.discoverSources,
    sourceArt: TokenArtCatalog._sourceArt,
    packs: globalThis.game.packs,
  };
  const packs = {
    "shadowdark.monsters": { getIndex: async () => [{ _id: "core-goblin", name: "Goblin", type: "NPC" }] },
    "world.sde-actors": {
      documentName: "Actor",
      metadata: { packageType: "world", label: "Shadowdark Enhancer — Actors" },
      getIndex: async () => [
        { _id: "imported-goblin", name: "Goblin", type: "NPC" },
        { _id: "imported-moth", name: "Ashen Moth", type: "NPC" },
        { _id: "boat", name: "Canoe", type: "shadowdark-enhancer.boat" },
      ],
    },
  };
  MonsterTokenArt.presentPacks = () => Object.keys(packs);
  TokenArtCatalog.discoverSources = async () => [{ id: "src-a", label: "Source A", kind: "folder" }];
  TokenArtCatalog._sourceArt = async (_source, monsters) => Object.fromEntries(
    monsters.filter((m) => m.name === "Goblin").map((m) => [m.id, opt("src-a", m.id)])
  );
  globalThis.game.packs = { get: (id) => packs[id] };
  try {
    const built = await TokenArtCatalog.build();
    assert.deepEqual(built.byMonster.map((m) => ({ id: m.id, name: m.name, pack: m.pack, options: m.options.length })), [
      { id: "imported-moth", name: "Ashen Moth", pack: "world.sde-actors", options: 0 },
      { id: "core-goblin", name: "Goblin", pack: "shadowdark.monsters", options: 1 },
      { id: "imported-goblin", name: "Goblin", pack: "world.sde-actors", options: 1 },
    ]);
  } finally {
    MonsterTokenArt.presentPacks = original.presentPacks;
    TokenArtCatalog.discoverSources = original.discoverSources;
    TokenArtCatalog._sourceArt = original.sourceArt;
    globalThis.game.packs = original.packs;
  }
});

test("final catalog maps namespaced managed mounts, isolates CS2/WR names, and keeps unmatched mounts browsable", async () => {
  const original = {
    presentPacks: MonsterTokenArt.presentPacks,
    discoverSources: TokenArtCatalog.discoverSources,
    sourceArt: TokenArtCatalog._sourceArt,
    packs: globalThis.game.packs,
    settings: SETTINGS,
  };
  const core = {
    getIndex: async () => [
      { _id: "core-horse", name: "Horse", type: "NPC" },
      { _id: "core-mount", name: "Horse, War", type: "Mount" },
    ],
  };
  const managedActors = [
    {
      _id: "cs2-war", name: "Horse, War", type: "NPC",
      flags: { "shadowdark-enhancer": { source: "CS2" } },
    },
    {
      _id: "wr-war", name: "Horse, War", type: "shadowdark-enhancer.mount",
      flags: { "shadowdark-enhancer": { source: "WR" } },
    },
    {
      _id: "wr-camel", name: "Camel", type: "Mount",
      flags: { "shadowdark-enhancer": { source: "WR" } },
    },
    {
      _id: "wr-donkey", name: "Donkey", type: "shadowdark-enhancer.mount",
      flags: { "shadowdark-enhancer": { source: "WR" } },
    },
    {
      _id: "cs1-tar", name: "Tar Bat", type: "NPC",
      flags: { "shadowdark-enhancer": { source: "CS1" } },
    },
    {
      _id: "boat", name: "Donkey", type: "shadowdark-enhancer.boat",
      flags: { "shadowdark-enhancer": { source: "WR" } },
    },
  ];
  const thirdParty = {
    collection: "world.other-actors",
    documentName: "Actor",
    metadata: { packageType: "world", label: "Other Actors" },
    getDocuments: async () => [{
      _id: "third-party", name: "Horse, War", type: "shadowdark-enhancer.mount",
      flags: { "shadowdark-enhancer": { source: "WR" } },
    }],
    getIndex: async () => [],
  };
  const managed = {
    collection: "world.sde-actors",
    documentName: "Actor",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Actors" },
    getDocuments: async () => managedActors,
    getIndex: async () => managedActors,
  };
  const packs = {
    "shadowdark.monsters": core,
    "world.sde-actors": managed,
    "world.other-actors": thirdParty,
  };
  const exact = (id) => {
    const selected = IMPORTED_MONSTER_ART[id];
    return {
      token: selected.token,
      portrait: selected.portrait,
      tokenObj: { texture: { src: selected.token } },
    };
  };

  MonsterTokenArt.presentPacks = () => Object.keys(packs);
  TokenArtCatalog.discoverSources = async () => [
    { id: "pf2e-tokens-monster-core", label: "Pathfinder", kind: "mapping" },
    { id: "shadowdark-community-tokens", label: "Community", kind: "mapping" },
    { id: "dnd-monster-manual", label: "Monster Manual", kind: "folder" },
  ];
  TokenArtCatalog._sourceArt = async (source, monsters) => {
    const art = {};
    for (const monster of monsters) {
      if (monster.id === "cs2-war" && source.id === "pf2e-tokens-monster-core") art[monster.id] = exact("CS2:horse, war");
      if (monster.id === "wr-war" && source.id === "pf2e-tokens-monster-core") art[monster.id] = exact("WR:horse, war");
      if (monster.id === "wr-camel" && source.id === "shadowdark-community-tokens") art[monster.id] = exact("WR:camel");
      if (monster.id === "wr-donkey" && source.id === "dnd-monster-manual") art[monster.id] = pathOpt(
        source.id,
        "modules/dnd-monster-manual/assets/tokens/horse.webp",
      );
      if (monster.id === "cs1-tar" && source.id === "dnd-monster-manual") art[monster.id] = pathOpt(
        source.id,
        "modules/dnd-monster-manual/assets/tokens/bat.webp",
      );
    }
    return art;
  };
  globalThis.game.packs = { get: (id) => packs[id] };
  SETTINGS = {
    priority: ["pf2e-tokens-monster-core", "shadowdark-community-tokens", "dnd-monster-manual"],
    overrides: {},
    picks: {},
  };

  try {
    const built = await TokenArtCatalog.build();
    const horseWars = built.byMonster.filter((monster) => monster.name === "Horse, War");
    assert.deepEqual(horseWars.map((monster) => monster.id).sort(), ["cs2-war", "wr-war"]);
    assert.equal(built.byMonster.some((monster) => monster.id === "core-mount"), false, "Core mounts remain outside the catalog");
    assert.equal(built.byMonster.some((monster) => monster.id === "boat"), false, "boats remain outside the catalog");
    assert.equal(built.byMonster.some((monster) => monster.id === "third-party"), false, "third-party packs remain outside the catalog");

    const resolved = TokenArtCatalog.resolve(built);
    assert.ok(resolved.tables["world.sde-actors"]?.["cs2-war"]);
    assert.ok(resolved.tables["world.sde-actors"]?.["wr-war"], "namespaced WR mount reaches final mapping");
    assert.ok(resolved.tables["world.sde-actors"]?.["wr-camel"], "generic Mount reaches final mapping");
    assert.equal(resolved.tables["world.sde-actors"]?.["wr-donkey"], undefined, "reviewed-unmatched mount stays unmapped");
    assert.equal(resolved.tables["world.sde-actors"]?.["cs1-tar"], undefined, "reviewed-unmatched NPC stays unmapped");

    const app = Object.create(TokenArtManagerApp.prototype);
    app._catalog = built;
    app._filter = "";
    app._conflictsOnly = false;
    const context = await app._prepareContext();
    const unmatchedMount = context.rows.find((row) => row.id === "wr-donkey");
    assert.equal(unmatchedMount.imported, true);
    assert.equal(unmatchedMount.hasOptions, true, "unmatched mount options remain visible to Browse");
  } finally {
    MonsterTokenArt.presentPacks = original.presentPacks;
    TokenArtCatalog.discoverSources = original.discoverSources;
    TokenArtCatalog._sourceArt = original.sourceArt;
    globalThis.game.packs = original.packs;
    SETTINGS = original.settings;
  }
});

// --- resolveByName(): name → chosen art for re-skinning placed tokens ------
test("resolveByName maps monster names to the chosen art", () => {
  SETTINGS = { priority: ["src-a", "src-b"], overrides: {} };
  const c = cat([{ id: "m1", name: "Goblin", pack: "shadowdark.monsters", options: [opt("src-b"), opt("src-a")] }]);
  const byName = TokenArtCatalog.resolveByName(c);
  assert.deepEqual([...byName.keys()], ["Goblin"]);
  assert.equal(byName.get("Goblin").tokenObj.texture.src, "tok/src-a");
  assert.equal(byName.get("Goblin").portrait, "port/src-a");
});

test("resolveByName keeps Core art ahead of a same-name imported row", () => {
  SETTINGS = { priority: ["src-b", "src-a"], overrides: {}, picks: {} };
  const c = cat([
    { id: "core", name: "Goblin", pack: "shadowdark.monsters", options: [opt("src-a", "core")] },
    { id: "imported", name: "Goblin", pack: "world.sde-actors", options: [opt("src-b", "imported")] },
  ], [{ id: "src-a" }, { id: "src-b" }]);
  assert.equal(TokenArtCatalog.resolveByName(c).get("Goblin").tokenObj.texture.src, "tok/core");
});

test("resolveByName lets imported art fill a same-name Core row with no options", () => {
  SETTINGS = { priority: ["src-a"], overrides: {}, picks: {} };
  const rows = [
    { id: "core", name: "Goblin", pack: "shadowdark.monsters", options: [] },
    { id: "imported", name: "Goblin", pack: "world.sde-actors", options: [opt("src-a", "imported")] },
  ];
  for (const byMonster of [rows, [...rows].reverse()]) {
    const byName = TokenArtCatalog.resolveByName(cat(byMonster, [{ id: "src-a" }]));
    assert.equal(byName.get("Goblin").tokenObj.texture.src, "tok/imported");
    assert.equal(byName.get("Goblin").portrait, "port/imported");
  }
});

test("manager context keeps same-name imported rows and Browse-ready zero matches", async () => {
  const state = {
    priority: ["src-a"],
    overrides: {},
    picks: {
      "imported-moth": {
        source: "src-a", file: "moth.webp", token: "tokens/moth.webp",
        portrait: "portraits/moth.webp", tokenObj: { texture: { src: "tokens/moth.webp" } },
      },
    },
  };
  SETTINGS = state;
  const app = Object.create(TokenArtManagerApp.prototype);
  app._catalog = {
    sources: [{ id: "src-a", label: "Source A" }],
    byMonster: [
      { id: "core-goblin", name: "Goblin", pack: "shadowdark.monsters", options: [opt("src-a", "core")] },
      { id: "imported-goblin", name: "Goblin", pack: "world.sde-actors", options: [] },
      { id: "imported-moth", name: "Ashen Moth", pack: "world.sde-actors", options: [] },
    ],
  };
  const context = await app._prepareContext();
  assert.equal(context.rows.length, 3);
  assert.deepEqual(context.rows.filter((r) => r.name === "Goblin").map((r) => ({ id: r.id, imported: r.imported })), [
    { id: "core-goblin", imported: false },
    { id: "imported-goblin", imported: true },
  ]);
  const zero = context.rows.find((r) => r.id === "imported-goblin");
  assert.equal(zero.hasOptions, false);
  assert.deepEqual(context.rows.find((r) => r.id === "imported-moth").pick, {
    thumb: "tokens/moth.webp", label: "Source A", file: "moth.webp",
  });
});

test("manager can save a manual pick for a zero-option imported row", async () => {
  const state = { priority: [], overrides: {}, picks: {} };
  const app = Object.create(TokenArtManagerApp.prototype);
  app._state = () => state;
  let saved;
  app._saveState = async (patch) => { saved = patch; };
  app.render = () => {};
  await app._pickImage("imported-moth", {
    source: "src-a", file: "moth.webp", token: "tokens/moth.webp",
    portrait: "portraits/moth.webp", tokenObj: { texture: { src: "tokens/moth.webp" } },
  });
  assert.deepEqual(saved.picks["imported-moth"], {
    source: "src-a", file: "moth.webp", token: "tokens/moth.webp",
    portrait: "portraits/moth.webp", tokenObj: { texture: { src: "tokens/moth.webp" } },
  });
});

// --- managedArtPrefixes(): replaceable art-source dirs ----------------------
test("managedArtPrefixes covers the shipped art sources", () => {
  const p = TokenArtCatalog.managedArtPrefixes();
  assert.ok(p.includes("modules/dnd-monster-manual/"));
  assert.ok(p.includes("modules/pf2e-tokens-monster-core/"));
  assert.ok(p.includes("systems/dnd5e/tokens"));
});

// --- applyResolvedToPlaced(): re-skin placed tokens (finding #2) -----------
const fakeToken = (name, src) => {
  const _updates = [];
  return {
    actor: { name, type: "NPC" },
    texture: { src },
    ring: {},
    update: async (u) => { _updates.push(u); },
    _updates,
  };
};

test("applyResolvedToPlaced re-skins a placed token from default art to the picked art", async () => {
  const tok = fakeToken("Goblin", "systems/shadowdark/assets/monster.webp");   // replaceable default
  globalThis.game.scenes = { active: { tokens: [tok] } };
  globalThis.game.actors = [];
  const byName = new Map([["Goblin", {
    tokenObj: { texture: { src: "modules/dnd-monster-manual/assets/tokens/goblin.webp" } },
    portrait: "p/goblin.webp",
  }]]);
  const r = await MonsterTokenArt.applyResolvedToPlaced(byName, { actors: false, portraits: false });
  assert.equal(r.tokens, 1);
  assert.equal(tok._updates[0].texture.src, "modules/dnd-monster-manual/assets/tokens/goblin.webp");
});

test("applyResolvedToPlaced honors extraPrefixes to switch between managed sources", async () => {
  const src = "modules/dnd-monster-manual/assets/tokens/goblin.webp";
  const target = { tokenObj: { texture: { src: "modules/pf2e-tokens-monster-core/tokens/goblin.webp" } }, portrait: "" };
  const byName = new Map([["Goblin", target]]);
  globalThis.game.actors = [];

  // MM art is NOT in the base replaceable set → without extraPrefixes it stays.
  const kept = fakeToken("Goblin", src);
  globalThis.game.scenes = { active: { tokens: [kept] } };
  let r = await MonsterTokenArt.applyResolvedToPlaced(byName, { actors: false, portraits: false, extraPrefixes: [], fuzzyFallback: false });
  assert.equal(r.tokens, 0);
  assert.equal(r.kept, 1);

  // With the MM prefix marked replaceable, the placed token switches sources.
  const switched = fakeToken("Goblin", src);
  globalThis.game.scenes = { active: { tokens: [switched] } };
  r = await MonsterTokenArt.applyResolvedToPlaced(byName, { actors: false, portraits: false, extraPrefixes: ["modules/dnd-monster-manual/"], fuzzyFallback: false });
  assert.equal(r.tokens, 1);
  assert.equal(switched._updates[0].texture.src, "modules/pf2e-tokens-monster-core/tokens/goblin.webp");
});

test("applyResolvedToPlaced disables a stale dynamic ring when switching to flat art", async () => {
  // Token currently shows MM art with the dynamic ring ON.
  const tok = fakeToken("Golem", "modules/dnd-monster-manual/assets/tokens/golem.webp");
  tok.ring = { enabled: true, subject: { texture: "modules/dnd-monster-manual/assets/subjects/golem.webp", scale: 1 } };
  globalThis.game.scenes = { active: { tokens: [tok] } };
  globalThis.game.actors = [];
  // Community art is flat (no ring) — the update must turn the stale ring OFF,
  // else Foundry crams the flat art into the old ring subject (renders tiny).
  const flat = { tokenObj: { texture: { src: "modules/shadowdark-community-tokens/artwork/tokens/golem.webp", scaleX: 1, scaleY: 1 } }, portrait: "" };
  const r = await MonsterTokenArt.applyResolvedToPlaced(new Map([["Golem", flat]]),
    { actors: false, portraits: false, extraPrefixes: ["modules/dnd-monster-manual/"], fuzzyFallback: false });
  assert.equal(r.tokens, 1);
  const u = tok._updates[0];
  assert.equal(u.texture.src, "modules/shadowdark-community-tokens/artwork/tokens/golem.webp");
  assert.equal(u.ring.enabled, false);
});

test("applyResolvedToPlaced preserves the ring block for a ringed source", async () => {
  const tok = fakeToken("Golem", "systems/shadowdark/assets/monster.webp");
  globalThis.game.scenes = { active: { tokens: [tok] } };
  globalThis.game.actors = [];
  const ringed = { tokenObj: {
    texture: { src: "modules/pf2e-tokens-monster-core/assets/tokens/golem.webp", scaleX: 2, scaleY: 2 },
    ring: { enabled: true, subject: { texture: "modules/pf2e-tokens-monster-core/assets/subjects/golem.webp", scale: 2 } },
  }, portrait: "" };
  const r = await MonsterTokenArt.applyResolvedToPlaced(new Map([["Golem", ringed]]),
    { actors: false, portraits: false, fuzzyFallback: false });
  assert.equal(r.tokens, 1);
  assert.equal(tok._updates[0].ring.enabled, true);
  assert.equal(tok._updates[0].ring.subject.texture, "modules/pf2e-tokens-monster-core/assets/subjects/golem.webp");
});

test("applyResolvedToPlaced falls back to the single-source fuzzy matcher for un-catalogued actors", async () => {
  // A renamed/homebrew world actor whose name isn't a catalog monster — the
  // legacy apply() would still fuzzy-match it, so re-skin must too (superset).
  const tok = fakeToken("Skeleton Warrior", "systems/shadowdark/assets/monster.webp");
  globalThis.game.scenes = { active: { tokens: [tok] } };
  globalThis.game.actors = [];
  const byName = new Map([["Goblin", { tokenObj: { texture: { src: "tok/goblin" } }, portrait: "p" }]]);
  const orig = { s: MonsterTokenArt.buildFileSets, r: MonsterTokenArt.resolveArt, t: MonsterTokenArt._tokenArt };
  MonsterTokenArt.buildFileSets = async () => ({ stub: true });
  MonsterTokenArt.resolveArt = () => ({ file: "skeleton-01.webp", portrait: "p/skeleton-01.webp" });
  MonsterTokenArt._tokenArt = () => ({ texture: { src: "modules/dnd-monster-manual/assets/tokens/skeleton-01.webp" } });
  try {
    const r = await MonsterTokenArt.applyResolvedToPlaced(byName, { actors: false, portraits: false });
    assert.equal(r.tokens, 1);
    assert.equal(tok._updates[0].texture.src, "modules/dnd-monster-manual/assets/tokens/skeleton-01.webp");
  } finally {
    MonsterTokenArt.buildFileSets = orig.s; MonsterTokenArt.resolveArt = orig.r; MonsterTokenArt._tokenArt = orig.t;
  }
});

test("applyResolvedToPlaced reports unmatched names and skips them", async () => {
  const tok = fakeToken("Unknown Beast", "systems/shadowdark/assets/monster.webp");
  globalThis.game.scenes = { active: { tokens: [tok] } };
  globalThis.game.actors = [];
  const byName = new Map([["Goblin", { tokenObj: { texture: { src: "x" } }, portrait: "" }]]);
  const r = await MonsterTokenArt.applyResolvedToPlaced(byName, { actors: false, portraits: false, fuzzyFallback: false });
  assert.equal(r.tokens, 0);
  assert.deepEqual(r.skipped, ["Unknown Beast"]);
  assert.equal(tok._updates.length, 0);
});

test("applyResolvedToPlaced returns missing:true for an empty pick set", async () => {
  const r = await MonsterTokenArt.applyResolvedToPlaced(new Map());
  assert.equal(r.missing, true);
});
