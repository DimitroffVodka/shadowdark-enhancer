import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURATED_IMPORTED_MONSTER_ART_ORIGIN,
  IMPORTED_MONSTER_ART,
  IMPORTED_MONSTER_ART_ROWS,
  IMPORTED_MONSTER_ART_UNMATCHED_KEYS,
  curatedImportedMonsterArtFor,
  importedMonsterArtKey,
  importedMonsterArtDisposition,
  planCuratedImportedMonsterArt,
} from "../scripts/monster-art/imported-monster-art.mjs";

test("F4 carries the source-aware picks and the reviewed-unmatched remainder", () => {
  assert.equal(IMPORTED_MONSTER_ART_ROWS.length, 72);
  assert.equal(Object.keys(IMPORTED_MONSTER_ART).length, 72);
  assert.equal(importedMonsterArtKey("Cursed Scroll #2", "Horse,   War"), "CS2:horse, war");
  assert.equal(importedMonsterArtKey("Western Reaches", "Horse, War"), "WR:horse, war");
  assert.notEqual(
    importedMonsterArtKey("Cursed Scroll 2", "Horse, War"),
    importedMonsterArtKey("Western Reaches", "Horse, War"),
  );
  assert.equal(curatedImportedMonsterArtFor("CS4", "Basilisk Hatchling")?.source, "shadowdark-community-tokens");
  assert.equal(curatedImportedMonsterArtFor("CS2", "Tar Bat"), null);
  assert.equal(curatedImportedMonsterArtFor("CS2", "Horse"), null, "no bare-name fallback");
  assert.equal(IMPORTED_MONSTER_ART_UNMATCHED_KEYS.length, 11);
  assert.equal(new Set(IMPORTED_MONSTER_ART_UNMATCHED_KEYS).size, 11);
  // No key may be both curated and reviewed-unmatched: disposition checks the
  // curated map first, so an overlap would silently mask a stale row.
  assert.deepEqual(
    IMPORTED_MONSTER_ART_UNMATCHED_KEYS.filter((k) => IMPORTED_MONSTER_ART[k]), [],
  );
  assert.equal(importedMonsterArtDisposition("CS5", "Wendel"), "unmatched");
  assert.equal(importedMonsterArtDisposition("CS1", "Tar Bat"), "curated");
  assert.equal(importedMonsterArtDisposition("CS3", "Sea Serpent"), "curated");
  assert.equal(importedMonsterArtDisposition("CS1", "Unreviewed Import"), null);
});
const row = (key) => IMPORTED_MONSTER_ART[key];
const candidate = (key) => {
  const selected = row(key);
  return {
    source: selected.source,
    file: selected.token.split("/").pop(),
    token: selected.token,
    portrait: selected.portrait,
    tokenObj: { texture: { src: selected.token, scaleX: 2, scaleY: 2 } },
  };
};

test("the pure F4 plan applies exact rows, preserves GM picks, and leaves unmatched Browse rows alone", () => {
  const records = [
    { id: "cs2-war", name: "Horse, War", source: "Cursed Scroll #2" },
    { id: "wr-war", name: "Horse, War", source: "wr" },
    { id: "wr-camel", name: "Camel", source: "Western Reaches" },
    { id: "cs5-wendel", name: "Wendel", source: "CS5" },
    { id: "cs4-slug", name: "Death Slug", source: "CS4" },
  ];
  const manual = { source: "manual-folder:gm", file: "tar.webp", token: "gm/tar.webp", portrait: "gm/tar.webp", tokenObj: { texture: { src: "gm/tar.webp" } } };
  const plan = planCuratedImportedMonsterArt(records, {
    picks: { "wr-camel": manual },
    overrides: { "wr-war": "shadowdark-community-tokens" },
    managedPaths: ["gm/tar.webp"],
    candidates: {
      "CS2:horse, war": candidate("CS2:horse, war"),
      "WR:horse, war": candidate("WR:horse, war"),
      "WR:camel": candidate("WR:camel"),
    },
  });

  assert.equal(plan.changed, true);
  assert.equal(plan.picks["cs2-war"].origin, CURATED_IMPORTED_MONSTER_ART_ORIGIN);
  assert.equal(plan.picks["cs2-war"].token, row("CS2:horse, war").token);
  assert.equal(plan.picks["wr-war"], undefined, "an explicit GM override blocks curation");
  assert.deepEqual(plan.picks["wr-camel"], manual, "a later/legacy Browser pick survives");
  assert.equal(plan.unmatched.find((entry) => entry.id === "cs5-wendel")?.reason, "unmatched");
  assert.equal(plan.unmatched.find((entry) => entry.id === "cs4-slug")?.reason, "unmatched");
  assert.deepEqual(plan.managedPaths, ["gm/tar.webp", row("CS2:horse, war").token, row("CS2:horse, war").portrait]);
});

test("replanning the same curated rows is idempotent and does not rewrite state", () => {
  const selected = candidate("WR:horse");
  const first = planCuratedImportedMonsterArt([{ id: "horse", name: "Horse", source: "WR" }], {
    candidates: { "WR:horse": selected },
  });
  assert.equal(first.applied.length, 1);
  assert.equal(first.changed, true);

  const second = planCuratedImportedMonsterArt([{ id: "horse", name: "Horse", source: "Western Reaches" }], {
    picks: first.picks,
    managedPaths: first.managedPaths,
    candidates: { "WR:horse": selected },
  });
  assert.equal(second.applied.length, 0);
  assert.equal(second.changed, false);
  assert.equal(second.preserved[0].reason, "already-curated");
  assert.deepEqual(second.picks, first.picks);
  assert.deepEqual(second.managedPaths, first.managedPaths);
});

test("an absent exact candidate never promotes the static row into a pick", () => {
  const plan = planCuratedImportedMonsterArt([{ id: "sea", name: "Sea Serpent", source: "CS3" }], {
    candidates: () => undefined,
  });
  assert.equal(plan.applied.length, 0);
  assert.equal(plan.unmatched[0].reason, "path-unavailable");
  assert.deepEqual(plan.picks, {});
});

// The adapter test below exercises the real pack guard and the existing manager
// setting shape without launching Foundry. The library is intentionally supplied
// as exact path-validated entries, mirroring buildLibrary's disk result.
let setting = { priority: [], overrides: {}, picks: {}, managedPaths: [] };
const settingWrites = [];
globalThis.game = {
  user: { isGM: true },
  settings: {
    get: (_module, key) => key === "tokenArtManager" ? setting : undefined,
    set: async (_module, key, value) => {
      if (key === "tokenArtManager") { setting = value; settingWrites.push(value); }
      return value;
    },
  },
};
globalThis.ui = { notifications: { warn() {} } };
globalThis.foundry = {
  applications: { apps: {} },
  utils: { deepClone: (value) => structuredClone(value) },
};

const { TokenArtCatalog } = await import("../scripts/monster-art/token-art-catalog.mjs");

const managedActor = ({ id, name, source, type = "NPC" }) => ({
  _id: id,
  id,
  name,
  type,
  flags: { "shadowdark-enhancer": { source } },
});

test("the Foundry adapter only seeds managed imported rows and handles zero-option art", async () => {
  setting = { priority: [], overrides: {}, picks: {}, managedPaths: [] };
  settingWrites.length = 0;
  const actors = [
    managedActor({ id: "cs2-war", name: "Horse, War", source: "CS2" }),
    managedActor({ id: "wr-war", name: "Horse, War", source: "Western Reaches" }),
    managedActor({ id: "wr-camel", name: "Camel", source: "WR" }),
    managedActor({ id: "cs3-sea", name: "Sea Serpent", source: "CS3" }),
    managedActor({ id: "cs5-wendel", name: "Wendel", source: "CS5" }),
    managedActor({ id: "cs4-slug", name: "Death Slug", source: "CS4" }),
    managedActor({ id: "boat", name: "Boat", source: "WR", type: "shadowdark-enhancer.boat" }),
  ];
  const pack = {
    collection: "world.sde-actors",
    documentName: "Actor",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Actors" },
    getDocuments: async () => actors,
  };
  const manual = { source: "manual-folder:gm", file: "sea.webp", token: "gm/sea.webp", portrait: "gm/sea.webp", tokenObj: { texture: { src: "gm/sea.webp" } } };
  setting.picks = { "cs3-sea": manual };
  setting.overrides = { "wr-camel": "shadowdark-community-tokens" };
  const library = Object.fromEntries(IMPORTED_MONSTER_ART_ROWS.map((selected) => [
    selected.key,
    {
      source: selected.source,
      file: selected.token.split("/").pop(),
      token: selected.token,
      portrait: selected.portrait,
      tokenObj: { texture: { src: selected.token, scaleX: 2, scaleY: 2 } },
    },
  ]));

  const first = await TokenArtCatalog.applyCuratedImportedArt({ pack, library: Object.values(library) });
  assert.equal(first.status, "completed");
  assert.equal(first.total, 6, "only managed NPCs enter the census");
  assert.equal(first.applied.length, 2, "CS2 and WR Horse, War are distinct source-aware rows");
  // The other four census rows are a manual pick, an override, and two
  // reviewed-unmatched creatures — none of which the curated seed may touch.
  assert.equal(setting.picks["cs2-war"].token, row("CS2:horse, war").token);
  assert.equal(setting.picks["wr-war"].token, row("WR:horse, war").token);
  assert.deepEqual(setting.picks["cs3-sea"], manual, "legacy/manual pick survives");
  assert.equal(setting.picks["wr-camel"], undefined, "explicit override blocks the curated seed");
  assert.equal(setting.picks["cs1-tar"], undefined, "unmatched zero-option row remains Browse-only");
  assert.equal(setting.picks["cs2-donkey"], undefined, "true zero row remains untouched");
  assert.ok(setting.managedPaths.includes(row("CS2:horse, war").token));
  assert.ok(setting.managedPaths.includes(row("WR:horse, war").portrait));
  assert.equal(settingWrites.length, 1);

  settingWrites.length = 0;
  const second = await TokenArtCatalog.applyCuratedImportedArt({ pack, library: Object.values(library) });
  assert.equal(second.status, "completed");
  assert.equal(second.applied.length, 0);
  assert.equal(second.changed, false);
  assert.equal(settingWrites.length, 0, "an identical run does not rewrite manager state");
});

test("missing exact source files are reported as unmatched rather than fuzzy-filled", async () => {
  setting = { priority: [], overrides: {}, picks: {}, managedPaths: [] };
  const actor = managedActor({ id: "cs3-sea", name: "Sea Serpent", source: "CS3" });
  const pack = {
    collection: "world.sde-actors",
    documentName: "Actor",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Actors" },
    getDocuments: async () => [actor],
  };
  const report = await TokenArtCatalog.applyCuratedImportedArt({
    pack,
    library: [],
    pathExists: () => false,
  });
  assert.equal(report.applied.length, 0);
  assert.equal(report.unmatched[0].reason, "path-unavailable");
  assert.deepEqual(setting.picks, {});
});
