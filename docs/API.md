# Shadowdark Enhancer — Module API

A versioned, public API for other modules and macros to drive Shadowdark
Enhancer's importer, linker, encounter, loot, table, bundle, monster-art,
merchant, party-XP, session-recap, and character-builder features.

**Namespaces:** [`import`](#import--universal-dump-segmentation) ·
[`items`](#items--bulk-items-importer) · [`monsters`](#monsters--bulk-monster-importer) ·
[`linker`](#linker--name--compendium-resolution) · [`encounter`](#encounter) ·
[`loot`](#loot) · [`tables`](#tables) · [`bundle`](#bundle--suite-export--import) ·
[`mutator`](#mutator) · [`monsterCreator`](#monstercreator--forge) ·
[`forge`](#monstercreator--forge) · [`tokenArt`](#tokenart--monster-compendium-art) ·
[`merchant`](#merchant--shop-window--transaction-log) ·
[`partyXp`](#partyxp--party-xp-awards) · [`recap`](#recap--session-recap) ·
[`charBuilder`](#charbuilder--guided-character-creation)

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

// Headless pre-suite migration: backfill + copy world imported actors into
// sde-actors, move the originals to _Backup, retire the legacy pack in place.
// GM-only; returns the migrateActors result, or null if blocked.
await api.monsters.migrateSuite({ dryRun: true });
```

`backfill` accepts `{ scope: "pack" | "selection", actorUuids, dryRun }`. The
same sweep runs automatically once per module version at world load, so calling
it by hand is only needed to force a re-run or to target a selection.

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
// Registry queries (all synchronous):
api.tables.all();                 // every registry row
api.tables.byGroup("loot");       // rows in one group
api.tables.groups();              // the group ids
api.tables.lootTables();          // loot-flagged tables
api.tables.encounterTables();     // encounter-flagged tables
await api.tables.organize(opts);  // GM-only: file tables into their folders

// Windows (async — these UIs parse on first open):
await api.tables.openHub();               // the Importer Hub (one scrolling view;
                                          //   the legacy tab argument is ignored)
await api.tables.openClassImporter();     // dedicated Class Importer workspace
await api.tables.openSpellImporter();     // dedicated Spell Importer workspace

await api.tables.enrich(uuid, "encounter"); // one table → monster links
await api.tables.relinkAll();              // GM-only sweep: EVERY pack table
                                           // re-linked to imported monsters/items
                                           // (idempotent, link-preserving)
```

`openHub(tab, seed)` keeps its legacy signature for back-compat, but the hub has
been a single tabless view since the 0.11.x rework — `tab` is accepted and
ignored. A `seed` still forces the paste box's type, source and contents.

`relinkAll` also runs automatically after every import commit, so calling it by
hand is normally unnecessary.

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

// Phase-1 Core magic-item tables (weapons & armor) — read-only.
await api.forge.catalog();            // live { magic-weapon-base, …, magic-personality-detail }
                                      //   state per set: locked|partial|ready|ambiguous|invalid,
                                      //   with per-table readiness + (when ready) rolled/selectable
                                      //   results read from your OWN imported sde-tables.
api.forge.sets();                     // set metadata (ids, child tables, formulas, domains, pages)
api.forge.buildSetSeed("magic-weapon-base");     // Importer-Hub seed for a whole set (base = bundle,
                                                 //   all-or-nothing; riders/personality = per-table)
api.forge.buildChildSeed("core-weapon-benefit"); // Importer-Hub seed for a single child table
```

The Forge's **Core Rulebook tables** mode drives Weapon/Armor recipes off these
imported tables. Only an unambiguous whole-result `+N` (0..3) from a *Bonus*
table is mechanized (weapon = two transferring Active Effects, armor =
`system.ac.modifier`); Feature/Benefit/Curse/Virtue/Flaw/Personality are escaped
descriptive riders (marked non-automated); the rolled Type is a base-selector
hint only. Forged items store **provenance v2** (refs only — `manifestId`,
`tableUuid`, `resultId`, `range` + automation summary), never source prose;
selections are re-validated against the live pack immediately before creation
and fail closed. No persistent raw-prose API is exposed. Manual forging is
unchanged. Potion / Utility / Scroll / Wand Core-table automation is out of
scope for Phase 1.

## `tokenArt` — monster compendium art

Re-skins Shadowdark NPCs with art **referenced by path** from art modules already
installed under `Data/modules` — nothing is ever copied, bundled, or
redistributed. A source module must be *installed*, but does **not** need to be
*enabled*. Write operations are GM-only.

```js
await api.tokenArt.openManager();     // the multi-source per-monster manager
api.tokenArt.open();                  // legacy single-source dialog

// Compendium-art overlay — skins every future monster drag. Injected at
// runtime, so no world relaunch is needed.
await api.tokenArt.applyToCompendium();
await api.tokenArt.restoreCompendium();   // turn the overlay back off
```

### Re-skinning placed tokens

```js
// Defaults shown. GM-only; returns null for non-GMs.
await api.tokenArt.apply({
  scene: true,       // update tokens on scenes
  actors: true,      // update actor prototype tokens
  portraits: true,   // update portraits too
  dryRun: false,     // report without writing — run this first on a big world
  minScore: 0.5,     // fuzzy-match floor
});
// → { tokens, portraits, kept, skipped: [...] }
//   plus `missing: true` when the configured source module isn't installed
```

### Catalog and matching

```js
// Every source + every monster's per-source options:
const cat = await api.tokenArt.catalog();
// → { sources: [{ id, label, kind, credit, count }],
//     byMonster: [{ id, name, options: [{ source, token, portrait, tokenObj }] }] }

const plan = api.tokenArt.resolveCatalog(cat);
// → { tables, chosen, stats: { total, mapped, perSource } }
await api.tokenArt.applyResolved(plan.tables);

// Full cross-source file library — every token file, not just name matches.
// Powers the manual image browser for monsters nothing matched.
const lib = await api.tokenArt.library();
// → [{ source, label, file, token, portrait, tokenObj }]  (priority order, then A→Z)

// Pure single-source match, no writes:
const sets = await api.tokenArt.buildFileSets(source);
api.tokenArt.resolve("Brain Eater", sets, source, 0.5);
// → { token, portrait, score } | null
```

Matching tries a source's own Shadowdark map, then exact name, then **semantic
aliases** (Shadowdark renames several D&D creatures — *Brain Eater* also tries
*Mind Flayer* / *Illithid*), then fuzzy match above `minScore`. A hand-picked
per-monster override always beats source priority.

## `merchant` — shop window & transaction log

The GM opens a shop that appears for **all connected players at once**. Buying
and selling settle against each actor's `system.coins`. Every transaction is
serialised on a single processing client, so concurrent buys can't double-spend
or oversell.

```js
// GM-only. mode: "compendium" (a curated catalog) | "actor" (an NPC's own stock).
api.merchant.open({ mode: "actor", actorId });
api.merchant.open();                    // defaults to { mode: "compendium" }
api.merchant.close();                   // closes it for players too

api.merchant.openLocally();             // open just this client's window —
                                        //   players may use it once the GM has
                                        //   marked the shop available

api.merchant.getLog();                  // → [{ player, action: "buy"|"sell", ... }]
await api.merchant.clearLog();
```

`open()` shows the window to the GM only; players get it when the GM clicks
**Open for All**. `openLocally()` on a player client reads the availability
snapshot the GM published, so it needs no round trip — and warns if the shop
isn't currently available.

The sell ratio and shop name are world settings edited **in the shop window**,
not in Foundry's settings UI (`shopSellRatio`, default `50`; `shopName`, default
`"The Merchant"`).

## `partyXp` — party XP awards

Shadowdark RAW: treasure and quest XP is awarded to **each** character in full,
never divided. Writes only `system.level.xp` — it never touches
`system.level.value`, so nobody is auto-levelled; characters over the threshold
are merely *flagged*.

```js
// GM-only. Omit actorIds to award to the whole party.
const results = await api.partyXp.award(40, { actorIds: [...], label: "Dragon hoard" });
// → [{ id, name, level, before, added, after, readyToLevel }]  | null if refused
```

`award` posts a summary chat card, then fires a public hook:

```js
Hooks.on("shadowdark-enhancer.partyXpAwarded", ({ amount, label, results }) => { … });
```

```js
api.partyXp.open();                        // the Party XP window (GM-only)

api.partyXp.xpOfItem(item);                // → { xp, source: "flag" | "score" }
await api.partyXp.assignToItem(item, 25);  // tag an XP value onto an item → boolean
```

`xpOfItem` prefers a **tagged** value and falls back to the item's loot-quality
score (derived from its cost and whether it is magical). `assignToItem` requires
GM, or ownership of the item.

The level threshold is `10` XP by default (`XP level-up thresholds` setting).

## `recap` — session recap

A per-session tracker tied to the crawl lifecycle: starting a crawl begins or
continues a session, ending one saves, pauses, or discards it. In a multi-GM
world **only the active GM records**, so nothing is double-counted.

```js
api.recap.open();               // the Session Recap window
api.recap.isActive();           // → boolean (sessionState === "active")
api.recap.formatForDiscord();   // → Discord-flavoured markdown string

const data = api.recap.getData();
// → { sessionState: "inactive" | "active" | …, sessionStart,
//     loot: [], sales: [], purchases: [], xp: [], combats: [],
//     encounterChecks: [], playerStats: { [actorId]: {...} } }
```

Each entry in `playerStats` carries:

```js
{ name,
  attacks: { hits, misses, nat20s, nat1s },
  saves:   { passes, fails, nat20s, nat1s },
  rolls:   { total, sum },
  damageDealt, damageTaken, … }
```

**Treat `getData`'s result as read-only.** It is the live setting value with
defensive migration applied for older payloads; mutating it persists nothing and
risks desyncing the in-memory copy. All internal writes go through a serialised
queue, so rapid combat events can't interleave and drop increments.

Logging is driven by the features themselves (loot claims, merchant
transactions, XP awards, encounter checks, combat) — there are no public
`log*` entry points, and every logger no-ops when no session is active.

## `charBuilder` — guided character creation

```js
api.charBuilder.open();      // Character Builder window (singleton — an already-
                             // open builder is brought to front, not replaced)
await api.charBuilder.appClass();  // the ShadowdarkCharBuilder Application class
```

> Since the lazy-load pass, heavy feature UIs (builder, importer hub, forge,
> loot apps, encounter roller, token-art manager) parse on first open instead
> of at `init`. Their `open()` API calls are now async (they were already
> fire-and-forget for every known caller). The former sync `charBuilder.app`
> class handle is replaced by the async `appClass()` accessor — a sync handle
> would have forced the whole builder tree eager again.

The builder is player-usable: it commits through the Shadowdark system's own
creation path, and a player without actor-create permission is handed off to
the GM via the system socket (the GM must be connected).

---

## Stability notes

- Everything documented here is public surface; undocumented internals
  (direct `scripts/**/*.mjs` exports) may change without notice.
- `apiVersion` was introduced at `1.0.0`; earlier releases (≤ v0.3.0)
  exposed the same core namespaces without a version field.
- All 16 namespaces on `game.shadowdarkEnhancer` are now documented. The
  `tokenArt`, `merchant`, `partyXp` and `recap` sections describe surface that
  already shipped — documenting them is **not** an additive API change and does
  not bump `apiVersion`.
- Anything that creates or modifies documents is **GM-only** and follows the
  never-overwrite, never-delete contract. Player-initiated actions that need a
  write (loot claims, merchant transactions, movement rollback, character
  creation without create permission) are relayed to the **active GM** over the
  module socket — they silently do nothing when no GM is connected.

## Public hooks

| Hook | Fired when | Payload |
|---|---|---|
| `shadowdarkEnhancer.ready` | The API is live and mirrored on the module | the api object |
| `shadowdark-enhancer.contentUnlocked` | Imported content becomes available — an open Character Builder re-reads its content | *(none)* |
| `shadowdark-enhancer.partyXpAwarded` | A party XP award commits | `{ amount, label, results }` |
| `shadowdark-enhancer.lootScored` | A claimable loot card is posted | `{ totalGp, totalXp, items, source, messageId }` |
| `shadowdark-enhancer.crawlStart` | A crawl session starts | the crawl state |
| `shadowdark-enhancer.crawlEnd` | A crawl session ends | the crawl state |
| `sde.stateChanged` | Any crawl-state change (mode, turn, roster, out-of-combat initiative) — this is the high-frequency one the strip and bar re-render on | the crawl state |

> **Three prefixes are in play, deliberately.** The ready signal uses camelCase
> `shadowdarkEnhancer.`; feature hooks use the module id
> `shadowdark-enhancer.`; and the crawl-state change hook uses the short
> `sde.` form. All three are existing surface kept for back-compat — match them
> exactly.
