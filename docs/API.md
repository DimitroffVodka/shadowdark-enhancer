# Shadowdark Enhancer — Module API

A versioned, public API for other modules and macros to drive Shadowdark
Enhancer's importer, linker, encounter, loot, table, bundle, and
character-builder features.

**API version:** `1.0.0` (semver — additive changes bump the minor version,
breaking changes the major; check `apiVersion` before relying on newer keys).

## Discovery

The API lives at `game.shadowdarkEnhancer` and is mirrored at the
Foundry-conventional `game.modules.get("shadowdark-enhancer")?.api`.
For interop, wait for the ready signal:

```js
Hooks.once("shadowdarkEnhancer.ready", (api) => {
  console.log("SDE API", api.apiVersion);
});
```

Many entry points are **GM-only** (anything that creates or modifies
documents); they warn and return `null` for non-GM callers. Import-type
operations follow the module's never-delete contract: they create or skip,
never overwrite or remove existing documents.

---

## `import` — universal dump segmentation

```js
// Pure + synchronous. One pasted text → typed buckets.
const seg = api.import.segment(rawPastedText);
// → { monsters: [...], items: [{draft, warnings}...], tables: [...],
//     skipped: [{name, reason}...] }
```

Deterministic anchor-based recognition (statblock `AC…LV` lines, item
`Benefit./Curse.` riders and `N gp` cost lines, dice-table headers/ranges).
Unrecognized blocks land in `skipped` — never silently dropped.

## `items` — bulk items importer

```js
// Pure parse of one blank-line block:
const parsed = api.items.parse("Probe Rope, 5 gp, 1 slot");
// → { draft: { name: "Probe Rope", type, cost, slots, description, riders, img },
//     warnings: [] }   (or null when the block has no item anchor)

// GM-only: file drafts into the managed Items compendium (conflict-handled):
const result = await api.items.create([parsed.draft], { source: "cs2" });
```

## `monsters` — bulk monster importer

```js
api.monsters.openImporter();                    // open the hub on the Monsters tab
await api.monsters.importDump(rawText, "cs4");  // headless: parse + create NPCs
await api.monsters.backfill({ dryRun: true });  // upgrade existing imports
```

## `linker` — name → compendium resolution

System/Core compendia win on a name clash; imports fill gaps.

```js
const m = await api.linker.resolveMonster("Gloomrat");
// → { uuid: "Compendium....Actor.xxxx", name: "Gloomrat" } | null
const i = await api.linker.resolveItem("Torch");
api.linker.invalidate(); // drop both caches after bulk content changes
```

## `encounter`

```js
await api.encounter.check();          // run an encounter check
api.encounter.openRoller();           // roller window
api.encounter.setActiveTable(uuid);   // bind the active encounter table
api.encounter.getThreshold(); api.encounter.setThreshold(3);
```

## `loot`

```js
// GM-only: generate a treasure hoard for a level, post a claimable chat card.
await api.loot.generateHoard(5, 2);
// Rewrite loot RollTables so rows are real compendium items:
await api.loot.linkTables();        // all loot tables (or pass one table)
api.loot.open(); api.loot.openSetup();
```

## `tables`

```js
api.tables.all();                          // registry rows
api.tables.openHub("import");              // hub: "import" | "tables" | "monsters"
await api.tables.enrich(uuid, "encounter"); // one table → monster links
await api.tables.relinkAll();              // GM-only sweep: EVERY pack table
                                           // re-linked to imported monsters/items
                                           // (idempotent, link-preserving)
```

## `bundle` — suite export / import

All GM-only. The bundle is one self-contained JSON of every managed
compendium pack (documents keep their `_id`s; legacy references are remapped
at export). `apply` skips documents that already exist — idempotent, never
overwrites.

```js
const bundle = await api.bundle.build();   // object (no download)
await api.bundle.export();                 // build + browser download
const report = await api.bundle.apply(bundleObject);
// → { ok, created, skippedExisting, failures, packs: {...} }
```

## `mutator`

Reads the GM's **own imported** Core Rulebook matrices (Monster Generator d20×4,
Make It Weird d12×3) from the managed `sde-tables` pack — there is no shipped
catalogue. Results are applied conservatively as descriptive `NPC Feature`s only
(no stat/attack/movement/spellcasting/name inference).

```js
// Async — structured state + dynamic columns/results for both sets:
//   { generator, mutations } each with
//   { state: "locked"|"partial"|"ready"|"ambiguous"|"invalid", ready, columns: [...] }
const cat = await api.mutator.catalog();
const combat = cat.generator.columns[0].results;   // [{ manifestId, tableUuid, resultId, range, columnKey, columnLabel, text }]

// Create a variant copy from validated imported-result references. Old static
// string ids (e.g. "giant") throw a deprecation error BEFORE anything persists.
const refs = [{ manifestId: combat[0].manifestId, tableUuid: combat[0].tableUuid, resultId: combat[0].resultId }];
await api.mutator.create(baseActorUuid, refs);            // → new world actor
await api.mutator.createFromResults(baseActorUuid, refs); // alias
```

New actors record provenance **version 2** under `flags["shadowdark-enhancer"].mutation`
— stable references only (`manifestId`, `tableUuid`, `resultId`, `range`, plus
`baseUuid`/`baseName`/`createdAt`), never source prose. Version-1 provenance on
older actors is left untouched.

## `monsterCreator` / `forge`

```js
api.monsterCreator.open();   // Monster Creator window
api.forge.open();            // Magic Item Forge window
```

## `charBuilder` — guided character creation

```js
api.charBuilder.open();      // Character Builder window (singleton — an already-
                             // open builder is brought to front, not replaced)
api.charBuilder.app;         // the ShadowdarkCharBuilder Application class
```

The builder is player-usable: it commits through the Shadowdark system's own
creation path, and a player without actor-create permission is handed off to
the GM via the system socket (the GM must be connected).

---

## Stability notes

- Everything documented here is public surface; undocumented internals
  (`scripts/encounter/*.mjs` exports) may change without notice.
- `apiVersion` was introduced at `1.0.0`; earlier releases (≤ v0.3.0)
  exposed the same core namespaces without a version field.
