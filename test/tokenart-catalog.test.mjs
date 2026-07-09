import { test } from "node:test";
import assert from "node:assert/strict";

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

const { TokenArtCatalog } = await import("../scripts/monster-art/token-art-catalog.mjs");
const { MonsterTokenArt } = await import("../scripts/monster-art/monster-token-art.mjs");

// --- helpers ---------------------------------------------------------------
const opt = (source, tag) => ({
  source,
  portrait: `port/${tag ?? source}`,
  tokenObj: { texture: { src: `tok/${tag ?? source}` } },
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

// --- reorder(): display order follows priority -----------------------------
test("reorder sorts each monster's options into priority order", () => {
  const c = cat([{ id: "m1", name: "X", options: [opt("src-b"), opt("src-a")] }]);
  TokenArtCatalog.reorder(c, ["src-a", "src-b"]);
  assert.deepEqual(c.byMonster[0].options.map((o) => o.source), ["src-a", "src-b"]);
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
