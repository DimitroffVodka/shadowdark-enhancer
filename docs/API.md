# Shadowdark Enhancer — Module API

A versioned, public API for other modules and macros to drive Shadowdark
Enhancer's importer, linker, encounter, loot, table, bundle, monster-art,
monster-spell-library, merchant, party-XP, session-recap, character-builder,
and Forge & Loot features.

**Namespaces:** [`import`](#import--universal-dump-segmentation) ·
[`items`](#items--bulk-items-importer) · [`monsters`](#monsters--bulk-monster-importer) ·
[`linker`](#linker--name--compendium-resolution) · [`encounter`](#encounter) ·
[`loot`](#loot) · [`tables`](#tables) · [`bundle`](#bundle--suite-export--import) ·
[`mutator`](#mutator) · [`monsterCreator`](#monstercreator--forge) ·
[`monsterSpells`](#monsterspells) · [`forge`](#monstercreator--forge) · [`forgeLoot`](#forgeloot--preview-first-generator-shell) · [`tokenArt`](#tokenart--monster-compendium-art) ·
[`merchant`](#merchant--shop-window--transaction-log) ·
[`partyXp`](#partyxp--party-xp-awards) · [`recap`](#recap--session-recap) ·
[`charBuilder`](#charbuilder--guided-character-creation) ·
[`actors`](#actors--western-reaches-boats) ·
[`statDamage`](#statdamage--tracked-ability-damage) · [`quests`](#quests--the-quest-log) ·
[`dying`](#dying--death-timers-and-stabilizing) ·
[`hexMaps`](#hexmaps--hex-map-tagging-and-the-extras-dataset) ·
[`rules`](#rules--western-reaches-rules-data) ·
[`holidays`](#holidays--when-a-holiday-falls-and-what-it-does-to-carousing) ·
[`time`](#time--season-day-and-night-sun-moon-and-anchors) ·
[`overland`](#overland--the-travel-state)

**API version:** `1.14.0` (semver — additive changes bump the minor version,
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

## `actors` — Western Reaches boats

```js
// GM-only. Opens the Importer Hub seeded for the Western Reaches boats table
// (Player's Guide p118): it grabs that page from the GM's OWN uploaded WR PDF
// (no stats are bundled), parses the eight boats, and shows them in the preview.
// Committing files them as `shadowdark-enhancer.boat` actors into the sde-actors
// compendium (skipping same-name boats). A paste box covers a missing PDF.
await api.actors.importBoats();
```

Boats import through the standard paste → preview → commit flow, exactly like
monsters and items. The Importer Hub's **Manage → Vehicles → Boats** tree opens the
same flow (as does `api.actors.importBoats()`).

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
api.encounter.getCheckFrequency(); api.encounter.setCheckFrequency(3); // automatic crawl-round check: every 3 rounds, counted from the last check
await api.encounter.tableForHex({ num: 2849, terrain: "forest", features: ["river", "coast"] }); // → RollTable | null
```

### `encounter.tableForHex(hex, { hour?, moon?, scene? })`

Added in 1.11.0. The roll table the book intends for a hex, the same one every
encounter check rolls, so another module (Shadowdark Extras' hex fog) can roll
it too. Resolves to the `RollTable` document, or `null` when nothing answers.

`hex` is `{ num?, terrain, zone?, features? }`:

- `terrain` is the hex's terrain word (`forest`, `arctic sea`, `river` for a
  river tile). Only terrain picks a column.
- `features` is the tag store's list (`["river", "coast"]`) or an Extras
  record's (`[{ type: "coast", ... }]`). Only `coast` counts: in a region whose
  imported grid prints a Coast column, a coastal hex rolls on it.
- `zone` is the region name. Left out, it comes from the print's region scan
  by `num`, as the map overlay and the Extras hand-off read it.
- `num`, the published hex number, also places the hex in the northern or
  southern half of its region's rows, for grids printed as `N. Ocean` /
  `S. Ocean`. Without it that split cannot be decided.

The order is: the region's printed column (from the imported *Encounter Zone*
grids), else the table mapped to the terrain under **Tables by terrain**, else
the active table. Day and night columns (`Swamp, Day` / `Swamp, Night`) are
read at the call: `hour` (0–23) overrides the world clock, night being 18:00
to 06:00 (fixed, on a 24-hour day; a world clock that never advances sits at
00:00, which is night). These are the book's check halves, not the sunset of
`time.sun()`. A moon column (`New Moon`, `Full Moon`) takes over on its night:
since 1.12.0 the phase comes from [`time.moonPhase()`](#time--season-day-and-night-sun-moon-and-anchors),
so a Myre Swamp hex on a new-moon night rolls *New Moon*. `moon` (`"new"`,
`"full"`, or `null` to leave it undecided) overrides the clock.
`scene` names the scene whose region scan answers (default: the one being
viewed, or the world's only scanned print).

## `loot`

```js
// GM-only: generate a treasure hoard for a level, post a claimable chat card.
await api.loot.generateHoard(5, 2);
// Rewrite loot RollTables so rows are real compendium items:
await api.loot.linkTables();        // all loot tables (or pass one table)
// (Note: Recognized source-qualified treasure tables route through their
//  dedicated materializers before the general system-first index — CS3 Sea Wolf
//  Plunder (D4) and CS2 Dead Bandit Loot (D5) mint 20 generated Items each in
//  sde-items and preserve the full source phrase as the TableResult display;
//  CS1 Diabolical Treasure (D6) mints 20 identification-gated Items and reduces
//  the cartesian 20×20 generator to 20 name-only 1d20 results.)
api.loot.open(); api.loot.openSetup();

// Resolve one loot row's text to a compendium Item — exact/alias only (A7).
// Returns the whole decision, so an ambiguous row is distinguishable from an
// unmatched one. Async because it builds the Item index from installed packs.
const hit = await api.loot.resolve("Dagger (1 gp)");
// → { status: "exact", query: "Dagger", uuid, name, matched }   // exact/alias carry a link
//   { status: "alias",  ... }  // alias tier: article/count, trailing parenthetical, final-word plural all folded (anchored only)
await api.loot.resolve("Unopened bottle of exceptionally potent Murgazi wine (25 gp)");
// → { status: "unresolved", query: "…" }                        // generic containers are refused — not a containment search
await api.loot.resolve("3 bolts (2 gp)"); // when both "Bolt" and "Bolts" exist
// → { status: "ambiguous", query: "3 bolts", candidates: [{uuid,name},…] }
await api.loot.resolve("Bolts"); // exact tier wins first, so just "Bolts" resolves as "exact"
```

`resolve` is **whole-name and anchored**. It tries the priced-row-as-a-name `exact` tier first (case/spacing/curly-quote folded, trailing sentence punctuation and `each` stripped to a fixed point — `Dagger (1 gp).` is still exact), then anchored `alias` normalizations at the start, end, or final word — these can compose, e.g. `2 daggers (steel)` folds count, parenthetical, and plural together — each remaining anchored, none ever becoming containment. Nothing else matches: interior-word containment (`Murgazi wine` → `Bottle`, `flask of oil` → `Flask`) is structurally unreachable, and a row that lands on more than one distinct Item at the same tier is `ambiguous` and also resolves to nothing (two plausible answers is not a confident match, and picking one by index order would be the containment bug again). The **candidate index is system-first** (built by `LootLinker.buildItemIndex`): system Item packs come before world/module packs (including `world.shadowdark-enhancer--items`), so on a same-name clash a system Item wins — imports fill gaps. The index is session-cached; call `api.linker.invalidate()` after bulk compendium changes. `api.loot.resolve` reads the same session cache as `loot.linkTables()` and the six `findLink` consumers (merchant shop, treasure classification, loot generator, roll-table catalog, table-hub preview, importer-hub paste preview), which all share the `exact`/`alias`-confident `null`-or-link shape; `resolve` is the caller that needs to distinguish `ambiguous` from `unresolved`.

### `loot.generated` — stable identity and replace-always reconciliation

Generated treasure Items (starting with Sea Wolf Plunder in D4) live only in
`world.shadowdark-enhancer--items` and are identified by **`flags[\"shadowdark-enhancer\"].generated === true`
plus a stored bookkeeping block — both halves required**. Their identity is
`source + canonical name` (FNV-1a/32 `id` plus a `key = \"<canonical source>:<normalized name>\"`;
source via `sourceKey`, name via `curatedNameKey`). Renaming a definition
creates a **new identity** — the old Item is not deleted. Outside that pack or
without that flag, ordinary imported Items still obey A3 provenance; a name
collision with a generated Monster Spell (`flags[MODULE_ID].monsterSpell.generated`,
which shares this pack since A1) is a **preserve-on-conflict** refusal, not a
takeover, and is reported as `name-collision` with `monsterSpell: true`.

```js
// Pure, synchronous. "" when either half is missing or blank.
const id = api.loot.generated.identity("CS1", "Carved Bone");
// → "fnv1a32:573d24a5" | ""

// Pure, no-write — the whole rerun decision for a definition set (A7).
// Source precedence per definition: `item.source` → `{source}` → `flags[MODULE_ID].source`.
const plan = await api.loot.generated.plan(desired, { source: "CS1" });
// → { pack: "world.shadowdark-enhancer--items", boundary: true,
//     create: [{id,name,payload}], update: [{id,name,payload,documentId,definitionMoved,documentMoved}],
//     unchanged: [{id,name,payload,documentId}],
//     refused: [{reason,name,id?,documentId?,storedKey?,desiredKey?,duplicateKey?,monsterSpell?}], boundary }
// refused[].reason is one of: "out-of-boundary" | "no-identity" | "duplicate-definition"
//   | "duplicate-document" | "name-collision" | "identity-collision" (32-bit id hit, discriminated by key)
// update[].definitionMoved / documentMoved are the two witnesses: the stored fingerprint
// vs the definition's fingerprint, and the stored document projected onto the declared
// shape vs the desired content. Either true triggers an update. Unchanged means both false.
// ActiveEffects: `priority` omitted in the definition means Foundry's default 20; an
// explicit `priority` is authoritative. Undeclared top-level flag namespaces (e.g. SDX
// alignment) are carried forward; `folder` is placement and is left alone; unchanged
// non-empty effects do not churn embedded ids. A plan outside the managed pack sets
// `boundary: false`, writes nothing, and refuses every definition as `out-of-boundary`.

// Apply it. GM-only; reads live pack docs, plans again, writes sequentially.
// Pack lifecycle: missing pack is provisioned via `ensureLootPack()` (then reconciled),
// an empty pack reconciles and creates, only a non-GM returns `null` with a warning;
// `plan` returns `null` when no pack exists for a pure preview.
// Returns the plan plus write counts; failures are reported, not swallowed.
const result = await api.loot.generated.reconcile(desired, { source: "CS1" });
// → { plan, created, updated, unchanged, refused, failures: [{reason,id,name,documentId,error}] }
// failures[].reason is one of: "create-failed" (Item.create returned falsey) |
//   "missing-target" (target vanished between plan and apply) |
//   "update-failed" (throwing replace). Each also carries `error: string|null`.
const plan2 = await api.loot.generated.plan(desired, { source: "CS1" });
// When `findSuitePack("sde-items")` cannot find a pack, `plan` returns `null`
// (a pure preview has no pack to preview). Only a non-GM `reconcile` also
// returns `null`; a missing `reconcile` pack is provisioned, an empty one creates.
// The operation is sequential and RETRYABLE, not transactional: a failed create
// is retried as a create next run, a missing target is re-planned, and a throwing
// update is reported while the rest of the batch continues. One case is not
// self-healing: if the update falls back to create-then-delete and the delete
// fails, the pack holds two documents with one identity; the next plan reports
// it as `duplicate-document` for GM cleanup rather than healing it.
// A notification aggregates refused + failed names when either is non-empty.
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

await api.tables.enrich(uuid, "encounter"); // one table → monster links + inline dice
                                           // (+ contextual checks on CS3 Arctic Sea)
await api.tables.relinkAll();              // GM-only sweep: managed sde-tables
                                           // re-linked to imported monsters/items
                                           // (idempotent, link-preserving)
```

`openHub(tab, seed)` keeps its legacy signature for back-compat, but the hub has
been a single tabless view since the 0.11.x rework — `tab` is accepted and
ignored. A `seed` still forces the paste box's type, source and contents.

Encounter table enrichment (`api.tables.enrich(uuid, "encounter")` and `api.tables.relinkAll()`) transforms bare dice to `[[/r ...]]` rolls and links recognized monster names to `@UUID` compendium references. `relinkAll` sweeps the managed Roll Tables pack (`world.shadowdark-enhancer--roll-tables` / `sde-tables`), enriching tables inferred as encounter or treasure while skipping other table shapes. For the *Cursed Scroll 3* Arctic Sea Encounters table (recognized by manifest ID `cs3-arctic-sea-encounters` or its CS3-scoped name), it additionally transforms DC expressions (`DC 15 DEX`) into clickable `[[check 15 dex]]` controls. Unrelated encounter tables leave DC expressions as unmodified prose. Re-running enrichment on an already enriched table is idempotent (`updated: 0`).

The same pack sweep is debounced and scheduled automatically after successful monster and item import batches, so calling `relinkAll` by hand is normally unnecessary.

## `bundle` — suite export / import

All GM-only. The bundle is one self-contained JSON of every managed
compendium pack (documents keep their `_id`s; legacy references are remapped
at export). Pre-consolidation (format-1) bundles containing a legacy
`packs.monsterSpells` payload are automatically restored into `sde-items` under
the `Monster Spells / <source>` hierarchy, with explicit failure reporting
rather than silent omission. `apply` skips documents that already exist —
idempotent, never overwrites.

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

## `monsterSpells`

The Monster Spell Library copies embedded monster `Spell` items into the GM-only
**Shadowdark Enhancer — Items** world compendium under `Monster Spells / <source>`.
Source Actors keep their embedded spells. Attaching a library entry in Monster
Creator creates another embedded copy on the destination NPC; it never creates a
live compendium link.

```js
const sources = api.monsterSpells.listSources();
// [{ id, label, version, pack }, ...]

// Read-only: scan selected sources and compare them with the current library.
const preview = await api.monsterSpells.preview({
  sourceIds: ["shadowdark.monsters", "world.shadowdark-enhancer--actors"],
});
// preview.operations → { create, update, unchanged, conflict, stale }

// GM-only interactive flow: choose sources, review the dry-run, then write.
await api.monsterSpells.refresh(); // Build/Refresh Monster Spells
```

Refreshes reconcile by provenance rather than by spell name. Generated copies
are filed into `Shadowdark Enhancer — Items / Monster Spells / <source>`. Worlds
with content in the legacy `world.shadowdark-enhancer--monster-spells` pack are
automatically migrated on activation by the primary GM: generated copies are
consolidated, hand-authored GM items move to `Monster Spells / Other Sources`,
existing edits and art are preserved, and the retired pack is left
empty-but-present for one release as a visible deprecation and compatibility
shell (moved documents receive new IDs in `sde-items`, so legacy document UUIDs
do not resolve). Re-running the migration or refresh is safe and idempotent.

On each world activation, the single active GM automatically checks the
version-gated refresh (`monsterSpellSyncVersion`) and reconciles Shadowdark Core
and the managed Enhancer Actor source once per module version; a successful
Importer Hub monster create/replace reconciles the managed Enhancer Actor source.
Automatic syncs queue behind an in-progress refresh. The interactive refresh
remains available for reviewed recovery. Identical spell definitions consolidate
with all source monsters recorded. Automatically maintained entries use `Spell
Name - Monster Name`; same-name definitions that differ remain separate and add
tier/source detail when needed. Generated entries with curated edits preserve both
their content and edited name and are marked as conflicts; stale entries are
reported but never deleted. Validation warnings report suspicious DC, dice,
duration, and damage-formula mismatches without rewriting source content.

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

## `forgeLoot` — preview-first generator shell

Opens the shared GM-only Forge & Loot shell. The shell **hosts previews
supplied by a registered generator adapter**: it presents the adapter's
immutable seeded preview and keeps all persistence behind the adapter's commit
boundary. The shell itself does not generate NPCs or write world documents.
Preview, reroll, and cancel do not write; approval rechecks the active
GM/source snapshot and consumes the exact preview once. NPC and Rival Crawler
rules are supplied by later generator packages — today the `npc` and `rival`
adapters are disabled placeholders.

```js
await api.forgeLoot.open();
// Choose the adapter and seed when opening (rules arrive in later generator
// packages; the current npc/rival adapters are disabled placeholders).
await api.forgeLoot.open({ generator: "npc", seed: "session-01" });
```

### Internal foundation seams

The Forge & Loot subsystem relies on internal, pure, and read-only helper
modules under `scripts/forge-loot/`. These modules do not expose public API
namespaces, do not write Actor documents to Foundry, and follow strict
boundaries:

- **Class readiness audit (`class-readiness.mjs`, G3):** Read-only audit of
  Core and imported Class documents against character-generation rules.
  Evaluates talent tables, hit dice, spellcasting metadata, and choices into
  stable blocker and warning diagnostics with a bounded defect queue.
  Schema-default empty spell grids (where all nested cells are null/blank) are
  recognized as non-caster defaults, while meaningful leaves, casting ability,
  or explicit caster flags serve as caster evidence.
- **Managed Rival Classes table (`rival-class-table.mjs`, G2):** Derives and
  maintains a single flag-identified RollTable in `sde-tables` from the G3
  report. Core precedence applies before eligibility on same-name collisions;
  ineligible classes are excluded; manual row edits are replaced with a warning.
- **Supporting-table registry (`supporting-tables.mjs`, G8):** Internal
  manifest-stamped registry resolving NPC and Rival table inputs, including the
  three Signature Tactics alignment children. Tolerates GM renames, fails
  closed on missing/foreign/duplicate/loose-name candidates, and allows exact
  Core UUID fallback only for ancestry and alignment. Table Hub remains the
  creation path.
- **Advancement planning engine (`advancement-engine.mjs`, G6b):** Pure
  deterministic planner advancing complete level-1 Player plans through
  levels 2–6 with injected RNG, G6a choice resolution, bounded duplicate and
  recursion handling, and replacement-effect materialization. Tagged failures
  return no committable Actor data; it writes no Foundry documents and serves
  as an input seam for future G7 party assembly.

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
//   plus `missing: true` when dnd-monster-manual isn't installed
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
// Powers the manual image browser for monsters nothing matched. Includes
// auto-discovered modules and GM-configured manual Browse folders (source: "manual-folder:<path>").
const lib = await api.tokenArt.library();
// → [{ source, label, file, token, portrait, tokenObj }]  (priority order, then manual folders)

// Pure single-source match, no writes:
const sets = await api.tokenArt.buildFileSets(source);
api.tokenArt.resolve("Brain Eater", sets, source, 0.5);
// → { token, portrait, score } | null
```

Matching tries a source's own Shadowdark map, then exact name, then **semantic
aliases** (Shadowdark renames several D&D creatures — *Brain Eater* also tries
*Mind Flayer* / *Illithid*), then fuzzy match above `minScore`. Auto-discovered
built-in sources include *Monster Manual*, *Player's Handbook*, *Pathfinder: Monster Core*,
*Pathfinder: Character Gallery* (`modules/pf2e-tokens-characters`, carrying approved
attribution *"Portrait, token, and subject artwork from the Pathfinder Tokens: Character Gallery"*),
and *Community Tokens*. The catalog includes managed imported NPCs and mounts
(`world.shadowdark-enhancer--actors`), where 16 exact reviewed picks receive curated art
(`origin: "curated"`) while 63 reviewed-unmatched identities suppress automatic fuzzy mapping.
A hand-picked per-monster override or valid explicit source override always beats source priority
(an invalid or missing override suppresses automatic fallback and never falls through to fuzzy art).
Named manual Browse folders are Browse-only: they appear in `library()` for manual picking, but are
excluded from `catalog()` and automatic matching (`resolve()`). When re-skinning placed
tokens, the manager combines broad prefixes for active sources with exact
manager-owned file path witnesses (`managedPaths`), allowing previously picked
art to transition across folder edits/removals while protecting custom art at
other paths under former roots.

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

Every logged entry is stamped with the real time (`timestamp`, ms, and `time`,
"14:05") and, since 1.12.0, the in-game time: `worldTime` (seconds) and
`gameTime`, the date as [`time.format()`](#time--season-day-and-night-sun-moon-and-anchors)
writes it (both `null` without a world clock). Entries logged before 1.12.0
have no in-game time. A carousing row that Shadowdark Extras rewrites keeps
the stamp of its first capture.

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

## `downtime` — between-crawls activities

The downtime window: pick a source book and a character, attempt an activity,
pay its cost, roll the check, read the outcome. A GM can also run it as a table
session, where each player picks their own activity and rolls their own dice.

```js
await api.downtime.open();   // Downtime window. A GM may always open it; a player
                             // only while a session is running (otherwise warns and
                             // returns null). Singleton — an already-open window is
                             // brought to front, not replaced.

// Table session. GM-side; all four write the `downtimeSession` world setting
// and nudge every client to re-read it.
await api.downtime.startSession("cs6");  // "cs6" | "western-reaches" — must be unlocked
await api.downtime.lockRolls();          // phase "select" → "roll": picks freeze, dice open
await api.downtime.releaseRolls();       // phase "roll" → "select": back to choosing
await api.downtime.endSession();         // closes it and greys the announcement card

api.downtime.sessionState();             // deep clone of the live session state
```

**The GM never trusts a number from a player.** A player's message carries ids
only. The active GM re-reads the skeleton, the unlock setting, the actor and the
session at handling time and recomputes the DC, the cost and the gating itself.
Even the roll total is read back off the `ChatMessage` document rather than taken
from the payload. This is the shape every relayed action in the module follows —
see [Relay trust model](#relay-trust-model).

**Ships no book content.** The module bundles only the *skeleton* — activity
names, slot labels, DCs, per-attempt costs and the mechanical deltas (renown,
XP). Every outcome string is pasted by the GM from their own copy of the book
through the Importer Hub's **Downtime** import type, and stored in the
`downtimeContent` world setting, keyed by source slug. A book with no stored text
renders as a title-only card carrying an **Unlock via Importer** button, with no
activity list, no slot labels, no DCs and no costs, because the outline itself
would be a reading of the book's tables.

```js
// The frozen hand-off contract the window's own button uses.
await api.tables.openHub("import", { downtimeSource: "cs6" });
```

Rules behaviour worth knowing before you script around it:

- The fee is charged **per attempt, success or not**, and is debited *before*
  the die is rolled. Coins move through the shared `spendFromPurse` helper, so
  denominations are preserved and a purse is never driven negative.
- A failed attempt walks that slot's DC one rung down the 9/12/15/18/20 ladder
  for the character's next try; a success resets it. Progress is per-actor, in
  `flags["shadowdark-enhancer"].downtime.steps`, keyed by slot.
- Luck tokens cannot be spent on downtime checks. Every card says so.
- **Inside a session a success is applied for real** (renown, XP and the
  level-up prompt, weapon-training effects, damage-die steps, fabricated
  scrolls / wands / potions, spell trades, advantage effects, the merchant
  extortion swing). Outcomes with no mechanical shape in Shadowdark print a
  GM-adjudication note instead of faking one. Solo mode, outside a session,
  keeps the manual **Apply** buttons.

Purchases are mirrored into the session recap as `Downtime: <slot label>`, so
downtime spend shows up in the session's purchase total.

A successful extortion arms a one-shot ±25% swing as
`flags["shadowdark-enhancer"].downtimeExtortion` on that actor. The Merchant Shop
reads it through `readExtortion` / `applyExtortion` / `spendExtortion` and
consumes it on the next completed buy **or** sell.

---

## `renown` — the fame track

Renown is the Western Reaches fame score. The **number is the system's field**,
`system.renown` on a Player actor, and the Shadowdark sheet already shows it —
this namespace adds the band ladder that gives the number meaning, the single
write path that keeps every change logged, and the GM's award dialog.

```js
await api.renown.open();            // GM award / dock dialog. Also the party roster:
                                    // every PC's renown, band, meaning and bonus.
await api.renown.open({ actorId, delta: -1, reason: "Public humiliation" });

// The one write path. GM-only — it writes the actor AND the session recap, so a
// player-side call is refused rather than half-applied. On a GM client that is
// NOT `game.users.activeGM`, the call is forwarded there and the delta applied on
// that client, so two GMs cannot lose each other's awards (see the relay trust
// model). Awaiting it awaits the remote write, and a delivery failure comes back
// as `{ok: false, error}` like any other refusal.
const r = await api.renown.award({
  actor,                  // Actor
  delta: 1,               // signed; 0 is a no-op
  reason: "A major triumph",
  source: "gm",           // "gm" | "downtime" | "level-up" | "start"
  chat: true,             // post the announcement card (default true)
});
// → { ok, before, after, delta, band, summary, error? }

await api.renown.seedFromCha(actor); // set renown to the character's CHA modifier

// The same seed, but only if this character is still owed one — what the
// `renownOnCreate` setting fires on a new character. Returns null when nothing
// was owed: the seed is already spent, renown is non-zero, or there is a log
// entry. `force` skips the setting AND the eligibility rule, for a character made
// before the setting existed or one whose CHA has since changed.
await api.renown.maybeSeedFromCha(actor);
await api.renown.maybeSeedFromCha(actor, { force: true, chat: true });

api.renown.valueOf(actor);  // integer; may be negative
api.renown.bandOf(actor);   // { key, label, max, bonus, note }
api.renown.bonusOf(actor);  // 0 | 1 | 2 | 3
api.renown.party();         // [{ actorId, name, renown, band, bonus }], highest first

// The permanent per-character log. A copy, so sorting it cannot reorder the flag.
api.renown.history(actor);  // [{ delta, before, after, reason, source, player, gm, at }]
                            // oldest change first; the last 50 per character
api.renown.historyByPlayer();
// → [{ player, net, count, entries: [{ ...row, actorId, actorName }] }], by player name
```

**The log is written in the same `actor.update` as the number**, under
`flags.shadowdark-enhancer.renownLog`, so a change that failed to apply leaves no
row and a row always carries the total it produced. It exists because
`SessionRecap.logRenown` returns early when no session is running — before it, a
change made between sessions survived only as a chat card. Rows are stamped with
the owning player at award time, so reassigning a character does not rewrite its
history. `flags.shadowdark-enhancer.renownSeeded` marks the starting seed spent.

The four bands run `≤3` / `4–7` / `8–11` / `12+`, granting a `+0` / `+1` / `+2` /
`+3` bonus. Renown has no floor and is allowed to go negative.

**The reaction bonus is never added automatically.** A character adds it only
where they would plausibly be recognised, which is a per-roll decision, so the
Encounter Roller carries a **Recognised here** toggle (off by default) and a
picker for whose renown applies. Independent of all of that, **double 1s on the
reaction dice are always hostile** — `reactionBand(total, { doubleOnes })` in
`encounter-result.mjs` short-circuits before the band ladder.

**Carousing belongs to shadowdark-extras, and it applies the bonus itself.** By
the book the same bonus applies to carousing event rolls. This module has no
carousing roll to hook, but SDX does, and its `getRenownBonus` (CarousingSD.mjs)
is the same `≥4/≥8/≥12 → +1/+2/+3` ladder folded into the carousing `totalBonus`.
So do NOT tell users to add it by hand where SDX is installed — that doubles it.
SDX also applies carousing renown *deltas* with a bare
`actor.update({"system.renown": next})` (`applyRenownDelta`), which is why the
external-change watcher below exists.

Two triggers are wired automatically, both settings-gated, and everything else the
book lists is a judgement call that lives on the dialog as a suggestion:

- **Starting renown from CHA** — a new character is seeded to their CHA modifier,
  once. Attempted on `createActor` and again on the first `system.abilities.cha`
  change, because an actor made through **Create Actor** starts on the model's
  default 10s and gets its real scores later; a seed of +0 therefore does not
  count as spent. Active-GM only, and it refuses any character with non-zero
  renown or an existing log entry, so it cannot reset an established character.
- **Renown on level-up** — a level gain grants a point, two levels grant two.
  Reaching level 1 is excluded, because the Character Builder and the level-0
  funnel both write `system.level.value` as part of creating the character.

Beyond those, an `updateActor` watcher logs any change to `system.renown` that did
NOT come through `award`, with `source: "external"`. **`system.renown` is the
system's field, so the sheet input, a macro and other modules all write it** —
without this the log would record our awards rather than the character's renown.
Our own write is told apart by the ledger flag riding in the same update, so an
award is never logged twice. Active-GM only, measured against a per-client cache
(`updateActor` fires everywhere; `preUpdateActor` only on the initiating client),
and it posts no chat card, because whoever wrote the value already reported it.
The row is appended in its own update — the same-update atomicity guarantee
applies only to `award`, since here the number is already committed.

**Integrating a module that writes the field itself.** Calling `award` is the
better path and is what shadowdark-extras' carousing does (`applyRenownDelta`
delegates, passing the outcome text as `reason` and `source: "carousing"`, with
`chat: false`). Where that is not possible — a one-off migration, or a caller that
cannot await — describe the write in the update options instead:

```js
await actor.update({ "system.renown": next }, {
  "shadowdark-enhancer": { renown: { reason: "A nobleman overheard your joke", source: "carousing" } },
});
// A data move rather than a change in anybody's fame:
await actor.update({ "system.renown": legacy }, {
  "shadowdark-enhancer": { renown: { silent: true } },
});
```

`silent` suppresses the row and the recap write while still advancing the cache, so
the next real change is measured from the migrated value. **A hint is honoured only
on a GM-initiated update** — options travel with the update from whoever made it
and a player owns their own character, so an untrusted `silent` could otherwise
hide a self-edit. A non-GM's write is always recorded plainly as `external`. An
unrecognised `source` renders as its own slug via `sourceLabel`, so a module's own
provenance is never swallowed.

Every change — a GM award, a starting seed, a level-up, a downtime rumour — is
recorded on the character (see the log above), logged to the Session Recap (its
**XP & Renown** tab, and a `## Renown` section in the Discord export) and posts a
chat card, unless the caller passes `chat: false`. Downtime passes `chat: false`
because its own result card already reports the change, and the automatic starting
seed passes it because a funnel drops several characters in at once.

**Ships no book prose.** The band thresholds, the bonus numbers and the trigger
labels are mechanics. The one-line meanings shown beside each band are the
module's own wording, not the book's.

---

## `pitFighting` — Cursed Scroll 2 bouts

Sets a pit fight up in the book's order and records what came of it. GM-only.

```js
const api = game.shadowdarkEnhancer;

await api.pitFighting.open();          // the bout roller window

// Headless set-up. Rolls Venue (2d6), Stakes (APL + 1d6) and the Twist (2d6),
// picks the encounter table, draws the foe, and reads what it can out of the
// imported tables.
//
// NOTE there is no `fighterIds` here, and that is the whole point of the order:
// the bout is an OFFER, and it exists before anyone agrees to fight it. The
// stakes roll uses the PARTY's average level (`PitFighting.party()`), not the
// volunteers', so nobody needs to be chosen yet. Fighters accept afterwards, in
// the window; `awardFame` is where ids are finally named.
const s = await api.pitFighting.setUpBout({
  danger: null,        // null takes the level the stakes suggest
  group: false,        // solo or group bout — picks the encounter table
  // Every roll can be supplied instead, which is how "or choose" is served by
  // the same code path. Omit one and it is rolled.
  venueTotal: null,    // 2d6
  stakesTotal: null,   // APL + 1d6
  twistTotal: null,    // 2d6
  twistSub: null,      // the extra die a twist may call for
});
// → { bout, aplDetail, twistSub, venueText, twistText, foeText, foes, missing }

// Award the fame. One Renown.award per fighter, so each is logged and announced
// by that single write path.
await api.pitFighting.awardFame({ fighterIds: [...], delta: 1, reason: "Won a bout" });
```

`bout` carries the mechanics: `venue.total`/`venue.row`, `stakes`
(`total`, `key`, `label`, `table`, `raised`, `rolledKey`), `danger`
(`key`, `label`, `suggested`, `overridden`), `twist`
(`total`, `key`, `effect`, `subRoll`) and `encounterTable`.

Four things worth knowing before you build on it:

- **The danger level is a suggestion, never a ruling.** The book hands the GM the
  stakes *and* the venue and then says the GM decides. Only the stakes half can be
  derived — a venue's riskiness is a judgement about a described place, and no risk
  rating is printed to read it off. `danger.suggested` is what the module proposed;
  `danger.overridden` says whether you went elsewhere. Changing it changes
  `encounterTable`, so the foe is redrawn from the table that now applies.
- **A twist that raises the stakes moves the prize table, not the danger.** The GM
  set the danger and the fighters accepted on that basis before the twist was
  revealed. `stakes.raised` flags it and `stakes.rolledKey` keeps the original.
- **The twist is secret.** It is rolled during set-up and nothing about it reaches
  chat until the GM presses Reveal, which is when the book has it come out.
- **No renown value for a bout exists in print.** The default is a flat point for a
  win and nothing for a loss, for the GM to edit. Deliberately not scaled by
  stakes: a ladder would read as a rule, and there isn't one.

**Ships no book prose.** Venue descriptions, twist details, what each tier is
fought for and the foes themselves all come from RollTables you import from your
own copy of CS2. A table that isn't there is **named** in the window with a link to
the importer — the roller never substitutes text of its own. `missing` is that
list, so a headless caller sees the same gaps the window shows.

---

## `training` — the Western Reaches regional trainers

The GM Guide prints 21 trainers across its regions. A trainer spread is four
TASKS and four BENEFITS, joined by one line of rule: complete a task and the
trainer teaches you a technique, **once each**. So the gate is an adventure,
not a check — there is no DC here and no cost — and a single trainer is worth
four visits rather than one.

```js
const api = game.shadowdarkEnhancer;

await api.training.open();                  // the trainer window
await api.training.open({ actor });         // …on a particular character
await api.training.open({ actor, trainer: "gladiator" });   // …and trainer (1.6.0)

// Headless grant: teaches one d4 face. `choice` names a branch for the four
// either/or benefits ("+2 CHA or +4 renown"); omit it elsewhere.
const r = await api.training.grant(actor, "gladiator", 2);
// → { ok: true, item, notes: [] }
const c = await api.training.grant(actor, "swashbuckler", 4, "renown");

// Which faces this trainer has already taught this character.
await api.training.taught(actor, "gladiator");   // → [2]
```

**Every benefit lands on the character**, mechanical or not. A benefit this
module can compute grants a Talent carrying Active Effect changes; one it
cannot grants a Talent carrying the trainer's name, the book's line and a
plain sentence saying what the table still does by hand. Of the 84 benefits,
**27 compute something today and 57 are recorded as prose** — 16 carry effect
changes, 10 run a one-time write, 4 offer an either/or.

Roughly half the prose is automatable and simply is not automated yet: the
ones needing a pick (which weapon, which spell, which mount) and the ones
whose mechanic lives in another feature of this module (luck tokens, spell
mishaps, downtime checks, party XP, the renown floor). Those carry a `todo`
naming exactly what is missing. The rest are prose for good reason — a
trap-only advantage has no honest key, because the only core one covers every
DEX check in the game.

`grant` fails with `AlreadyTaught` when that face is already on the sheet,
`ChoiceRequired` when an either/or benefit was given no branch, and
`UnknownBenefit` for a trainer key or face that does not exist. "Once each" is
read off the character's own Talents rather than a counter, so **deleting the
Talent correctly frees the benefit to be learned again** and nothing can drift
out of step with what the sheet shows.

**Ships no book prose.** The wording of a benefit comes from the
`<Topic> Training Benefits` RollTable you import from your own copy of the GM
Guide, joined by table name and d4 face. A table that isn't there is **named**
in the window, which then falls back to this module's own compressed label —
it never substitutes a sentence of its own and presents it as the book's.

---

## `hexMaps` — hex map tagging and the Extras dataset

Added in 1.5.0. Nothing from a published map ships with the module; every call
works on the GM's own scene image and book text.

| Call | Who | What |
|---|---|---|
| `hexMaps.openTagger()` | GM | Open the Hex Tagger on the active hex scene (see the wiki page *Hex Maps*). Lazy. |
| `hexMaps.buildDataset({ name, source, drafts, summaryRows, tags, gridHint })` | any | Pure builder for the Shadowdark Extras hexcrawl dataset. `tags` is `{ [num]: { terrain, features } }`, where `features` lists `river`, `path` and `coast` (`overlays`, the old name, is still read). Each hex's river, path and coast come out as entries in its Extras `features` list. |
| `hexMaps.compare(csvText, { sources })` | GM + `hexMapsDevTools` | Score the active scene's tags against a truth CSV (`hex_id` plus `tags` or `terrain_tags`); returns terrain accuracy and river/path precision and recall. Dev check, ships no data. |
| `hexMaps.importDetails(entriesOrDataset, sceneId?, { regionScene?, repaint? })` | GM | Write hex details onto a scene Extras already built (default: the active scene) through its `hex.upsertHexRecords`, then repaint the tiles unless `repaint: false`. Given crawl entries (one, a list, or `[]` for zones alone), every hex the print's region scan covers also gets `zone` and `zoneColor`; `regionScene` names the scanned print scene, needed when the world has more than one. |
| `hexMaps.handoff(entryOrDataset)` | GM | Hand a dataset (or a filed crawl JournalEntry, converted first) to Extras' `hex.buildHexcrawl` when it exists, else download it as JSON. Returns `{ via: "extras" \| "download" \| "none", ... }`. |

The dataset carries published hex numbers only (`num`, column-major: 1403 is
column 14, row 03); never a column and row pair.

---

## `statDamage` — tracked ability damage

Added in 1.6.0. Stat damage has no setting and no control: a character who has
never taken any carries nothing. When it happens it is one Active Effect per
damaged ability, shown in the sheet's Effects tab, and it is gone when healed.

| Call | What |
|---|---|
| `statDamage.apply(actor, ability, amount)` | Add `amount` points to one ability (`"str"` … `"cha"`, any case, or the full name). Characters only. Resolves to that ability's new total, or `null` when nothing was applied (an NPC, an unknown ability, an amount below 1). |
| `statDamage.heal(actor)` | Clear all of it: a normal rest. `heal(actor, { all: true })` is the same. |
| `statDamage.heal(actor, { perAbility: n })` | Take `n` off each damaged ability: Grinder Mode passes 1. Resolves to what is left, as `of` reads it. |
| `statDamage.of(actor)` | `{ str, dex, con, int, wis, cha }`, the points of damage on each, zero when clean. Several effects on one ability are summed. |

`apply` and `heal` write Active Effects, so the caller needs owner permission
on the actor: the GM, or the character's own player.

**The effect is a contract.** Anything that creates stat damage without calling
`apply` (Shadowdark Extras' Effects library) must use exactly this shape, and
`of`, `heal` and the CON check then treat it like any other:

```js
{
  name: "STR damage",
  changes: [{ key: "system.abilities.str.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-1" }],
  flags: { "shadowdark-enhancer": { statDamage: { ability: "str" } } },
}
```

The system's ability modifier is computed from `value`, so the modifier drops
with the score. `apply` and `heal` replace an ability's effects with one effect
holding the new total, so two library drops become one line the next time that
ability changes.

**CON 0 is death.** When a stat-damage effect takes a character's CON to 0 or
below, the active GM's client marks them dead the way dying does (the `dead`
status, defeated in any combat they are in, and any dying state cleared). A
character carrying the `noDeathAtZeroCon` dying modifier (River of Death, or
the Ancient Ritual training) survives it; see `dying` below.

**Monster hits use it too.** A monster attack card that hits a character is
read for riders like `1 STR damage` or `DC 12 CON or 1d4 STR damage`; a saved
rider asks the character's player to roll through the user query
`shadowdark-enhancer.statDamageSave` (GM sender only, answered by the owner's
client), and the GM's client rolls it when no player answers.

---

## `quests` — the Quest Log

Added in 1.7.0. One place for "what are we doing", whether it came from a
rumor, a trouble, a trainer or the GM. Each quest is a **world JournalEntry**
in a *Quests* folder of the Journal sidebar, with a player page and a GM notes
page, so it reads fine without the window. Its state is one flag on the entry,
`flags["shadowdark-enhancer"].quest`; identity is that flag, never the name.

```js
const api = game.shadowdarkEnhancer;

await api.quests.open();                          // the Quest Log window (Ctrl+Q)

api.quests.list({ status: "active" });            // what this user may see
api.quests.list({ party: partyActor });           // assigned to that party
api.quests.list({ character: actor });            // personal to that character
api.quests.get(id);                               // one, or null

// GM only.
const q = await api.quests.create({
  name: "The drowned bell",
  status: "available",                            // default "hidden"
  source: { kind: "rumor", uuid: rumorEntry.uuid },
  description: "The fishers of Low Town hear a bell under the water.",
  objectives: ["Find the bell", "Silence it"],
  rewards: { xp: 3, renown: 1, items: [{ uuid: item.uuid, name: item.name }] },
  characters: [actor],                            // Actor, uuid or id
  party: partyActor,                              // Shadowdark Extras party, or omit
  hex: 353,                                       // pin to jump to, or omit
});
await api.quests.setStatus(q.id, "completed");    // asks the GM to confirm the payout
```

| Call | Who | What |
|---|---|---|
| `quests.open()` | anyone | Open the Quest Log. Players get it read-only. |
| `quests.list({ status, party, character, sourceKind, sourceUuid })` | anyone | Quests this user may see, newest first. Every filter is optional. `status` is one status or an array. `party` and `character` take an Actor, a UUID or a world actor id. |
| `quests.get(idOrUuid)` | anyone | One quest, or `null` when it does not exist or this user may not see it. |
| `quests.create(data)` | GM | Make a quest and return it. Every field is optional; a bare call makes a Hidden *New quest* from the GM. |
| `quests.setStatus(idOrUuid, status)` | GM | Move a quest. Returns it, or `null` when refused or cancelled. |

**The shape** every read returns:

```js
{
  id, uuid, name,
  status,        // "hidden" | "available" | "active" | "completed" | "failed"
  source: { kind, uuid },   // kind: "gm" | "rumor" | "trouble" | "trainer"; a trainer
                            // task also carries { trainer, task } (key and task index)
  party,         // party actor UUID or null
  characters,    // actor UUIDs; non-empty means the quest is personal to them
  objectives: [{ id, text, done }],
  description,   // the GM's player-facing text
  rewards: { xp, renown, items: [{ uuid, name, img }], training },   // training: a trainer key or null
  hex,           // published hex number or null
  paid,          // true once the rewards were handed out
  created,       // the entry's creation time, ms
}
```

**What players see.** A Hidden quest is the GM's alone: its entry's default
ownership is None, and `list`/`get` leave it out for a player whatever its
ownership says. Any other status sets the default ownership to Observer:
players read the entry, never edit it. The GM notes page is None for players
at every status.

**Sources.** `source.kind` says where a quest came from and `source.uuid`
points back at it, so a rumor ledger or a trouble tracker can create its
quest with `create({ source: { kind: "rumor", uuid } })` and find it again with
`list({ sourceUuid })`. Nothing here acts on a source when its quest ends;
the source listens to `questsChanged` and reads the status.

**Parties** are Shadowdark Extras' party actors, read through its
`api.party.list()` and `api.party.members()` (on an Extras from before those,
the NPCs flagged `shadowdark-extras.isParty`, with the same result). `list({ party })` matches quests *assigned* to
that party only; the personal quests of its members come from
`list({ character })` for each member. A quest can carry both, so deduplicate
by `id`. Without Extras the log works the same and a quest simply has no
party.

**Completing a quest pays its rewards once.** Moving a quest into Completed
with rewards not yet paid opens a confirmation listing them, where the GM
picks who gets the XP and renown (each in full), who gets each item, and
whether to open Regional Training for the benefit roll. XP goes through
`partyXp.award`, renown through `renown.award` (source `quest`), and items
are copied onto the chosen character. Cancelling leaves the quest where it
was. `paid` is written with the status before anything is handed out, so
Completed → Active → Completed never pays twice. Unticking everyone completes
a quest without paying it.

**Jump to pin** (the window's button) goes to a Note placed for the quest
itself (its journal entry dragged onto a scene), else to the Hex Tagger's pin
for `hex`.

The hook `shadowdark-enhancer.questsChanged` fires on every client, once per
burst of writes, after any quest is created, changed or deleted.

## `dying` — death timers and stabilizing

Added in 1.8.0. The core dying rule (p.89) with Deadly and Fatality (p.111);
the table-facing description is the wiki page *Dying and Death Timers*.

```js
const d = game.shadowdarkEnhancer.dying;

d.isDying(actor);                  // → true while dying (not stable, not dead)
d.timer(actor);                    // → rounds left, or null
d.state(actor);                    // → { timer, stable, conscious, tick } or null

await d.stabilize(actor, { by: helper }); // helper's INT check on THIS client; → did it succeed
await d.stabilize(actor);                 // GM: no roll (a potion, an automatic success)
await d.rise(actor);                      // GM: up at 1 HP, everything cleared
await d.adjust(actor, +1);                // GM: rounds added (or removed), never below 1
await d.setConscious(actor, true);        // GM: acting while dying; the timer still runs

d.STATUS;                          // "sde-dying", the status this module registers
d.KEYS.timerDie;                   // "flags.shadowdark-enhancer.dyingTimerDie", …
```

| Call | Who | Notes |
|---|---|---|
| `isDying`, `timer`, `state` | anyone | Read the actor's `flags["shadowdark-enhancer"].dying`. The hidden timer hides the count in the UI only. |
| `stabilize(actor, { by })` | owner of `by`, or GM | Runs the system's `rollStatCheck("int")` for `by`. The DC comes from the active GM (query `shadowdark-enhancer.dying`): 15, 18 under Deadly or near a `stabilizeDCNear` creature, and `by`'s own `stabilizeDC` beats both. The check's roll config carries `flags.shadowdark.rollConfig["shadowdark-enhancer"].stabilizeTarget`, so a Luck reroll of the card carries it too. The active GM reads every such card as it lands and stabilizes only when the card's author is a GM or owns `by`, and the roll's total meets the DC it works out itself. Resolves to whether this roll succeeded. |
| `stabilize(actor)` | GM | No roll. |
| `rise`, `adjust`, `setConscious` | GM | Run on the active GM, in the actor's queue with the automatic steps; another GM's call is relayed to it. |

`KEYS` is the modifier vocabulary, set on Active Effects (`override`, except
`timerBonus`, which is `add`): `timerDie`, `timerBonus`, `riseMin`,
`riseMinNear`, `stabilizeDC`, `stabilizeDCNear`, `noDeathAtZeroCon`. Values are
read from the actor's derived flags at the moment they are needed.
`noDeathAtZeroCon` also decides stat damage's death at CON 0 (`statDamage`
above).

Every write runs on the active GM, in one queue per actor: 0 HP in
`updateActor`, the turn start in a wrapped `Combat#_onStartTurn`, stabilize
cards in `createChatMessage`, and crawl rounds from the
`shadowdark-enhancer.crawlRound` hook, relayed there from whichever GM advanced
the round. The owning player's client only rolls the natural die; the GM adds
the modifiers. None of it runs while Shadowdark Crawl Helper is active.

---

## `holidays` — when a holiday falls, and what it does to carousing

Added in 1.9.0. Holidays today are the four City of Masks holidays from Cursed
Scroll 6 (pp. 46–47). Shadowdark Extras' carousing window reads them
(shadowdark-extras#151). The shape is generic, so another book's holidays can
join later.

```js
const api = game.shadowdarkEnhancer;

await api.holidays.list();                          // every imported holiday
await api.holidays.today({ place: "City of Masks" }); // falling today, there
await api.holidays.today({ place: "settlement-1334" }); // Extras' feature id works too
```

Both calls are **async**. A holiday is listed only once the GM has imported
its page: Importer Hub → Tools → **Chapter to journal** → preset *Cursed
Scroll 6: the City of Masks holidays*. Before that, both return `[]`.

`place` takes a settlement name (case, a leading "The" and a footnote `*` are
ignored), a hex number (`1334`, `"1334"` or `"01334"`, compared as numbers), or
Extras' settlement feature id (`"settlement-1334"`). With no `place`, `today()`
returns every holiday falling today, wherever it is. Each call returns fresh
copies, so a caller may change what it gets back.

Each holiday:

```js
{
  key: "maytide", name: "Maytide", source: "CS6", page: 46,
  pageKey: "maytide",                 // the imported journal page's key
  pageUuid: "Compendium.…JournalEntryPage.…", // that page, for its text
  place: { name: "City of Masks", hex: "1334" },
  when: { anchor: "springCrossQuarter" },
  carousing: {
    eventBonus: 1,            // added to carousing event rolls
    benefitBonus: 15,         // added to benefit rolls (d100)
    // also, where they apply: extraBenefit, extraMishap (booleans),
    // benefitAdvantage (boolean), chances: [{ key, oneIn: 20, label }]
  },
  garb: [                     // questions for the table; "yes" applies `modifier`
    { key: "maytideNoFloral", modifier: -1, label: "…" },
    { key: "maytideGems", modifier: 1, label: "…" },
    { key: "maytideDarkTones", modifier: -1, label: "…" },
  ],
}
```

A garb question with `required: true` (the Duke's Ball's 500 gp costume) gates
entry: a "no" keeps the character out of the ball. A question with a `note`
(red at the Duke's Ball) should post that note when answered "yes". Labels
come back already localised. Mechanics only: the book's wording is the
imported page, at `pageUuid`.

### When a holiday falls

`when.anchor` is one of `springEquinox`, `springCrossQuarter`,
`summerSolstice`, `autumnEquinox`, `winterSolstice` or `lastFullMoonOfYear`.
Today's date comes from the core calendar (`game.time.components`) as
`{ year, month (1–12), day (1–31), dayOfYear (1-based) }`.

- **Solar anchors** are fixed Gregorian dates: March 20, May 1 (the
  traditional cross-quarter day, not the astronomical midpoint of about
  May 5), June 21, September 22 and December 21. Real solstices and equinoxes
  drift a day either side. A world on a non-Gregorian calendar gets the same
  month and day numbers in its own months.
- **Lastmoon** falls on the day of the year's last full moon, which is
  `time.anchor("lastFullMoon")` (since 1.12.0). Before that it never fell.

---

## `rules` — Western Reaches rules data

Added in 1.10.0. The tables the Western Reaches books consult rather than roll:
terrain costs, hexes per day, hex visibility, climate, and the carousing and
warband-recruiting limits of a settlement. Overland travel, carousing and hex
visibility read them from here.

**Nothing from the books ships.** Every table starts empty. The GM fills it in
**Configure Settings → Shadowdark Enhancer → Rules data**, with **Import from
GM Guide** (reads the GM's own linked PDFs) or by hand. The data is the
`rulesData` world setting. Every call is synchronous, reads the setting each
time (so an edit is seen at once) and works for players too.

| Call | Returns |
|---|---|
| `rules.terrainCost(terrain, { boat, weather, harsh })` | Hexes of movement to enter a terrain. `Infinity` when impassable, `null` for a terrain it has no value for. |
| `rules.hexesPerDay(method)` | Hexes a day for `"walking"`, `"mounted"` or `"sailing"`, or `null`. |
| `rules.visibility()` | `{ darkness, stormy, excellent, slight, high, elevation }`: the hex visibility modifiers (numbers or `null`), and `elevation`, `{ terrain: "slight" \| "high" }` for every terrain that has one. |
| `rules.climate(region, season)` | `{ region, season, label, harsh }` or `null`. `harsh` is `"always"`, `"storm"` (harsh in stormy weather only) or `""`. |
| `rules.carousingLimit(kind)` | The largest carousing event, in gp, a settlement can host. `Infinity` for no limit; `null` while the table is not filled in, and for a kind the table does not have. |
| `rules.recruitingLimit(kind)` | The highest warband level a settlement can supply, with the same `Infinity` and `null`. |

- **Terrain** words are the Hex Tagger's (`scripts/importer/hex/hex-summary.mjs`
  `TERRAIN_TAGS`): `forest`, `salt_flat`, `arctic_sea` and so on. A printed
  spelling (`"Salt Flat"`) works too.
- **`terrainCost` options.** `boat: true` uses the terrain's cost with a boat
  where it has one. `weather: "stormy"` (or the table's own wording,
  `"Stormy weather"`, in any case) makes normal terrain cost what difficult
  terrain does, and with `harsh: true` (a harsh climate, from `climate()`)
  makes every terrain impassable for the day. A terrain with a type and no
  cost of its own costs what its type does.
- **Limits: "not set up" is not "no limit".** `carousingLimit` and
  `recruitingLimit` return `null` while every settlement in that table is empty
  (never imported or typed in), so a caller with a fallback of its own uses it.
  Once any settlement has a number, an empty one is the book's "no limit" and
  returns `Infinity`.
- **Elevation.** Mountain counts as high elevation until the GM changes it, and
  no terrain counts as slight. Both are editable in the window.
- **`region`** is matched any way the book spells it, with or without the
  article: `"Bastion Mtns"` and `"Bastion Mountains"`; `"Gloaming, The"`,
  `"The Gloaming"` and `"Gloaming"`.
- **`season`** is `"spring"`, `"summer"`, `"fall"` (or `"autumn"`) or
  `"winter"`. Spring and fall share one column, as the book prints them.
- **`kind`** is a settlement kind as the hex data names it: `"village"`,
  `"town"`, `"city"`, `"city_state"` (`"City-State"` works too).

```js
const rules = game.shadowdarkEnhancer.rules;
const today = rules.climate("Djurum Desert", "summer");            // null until filled in
const harsh = today?.harsh === "always" || (today?.harsh === "storm" && stormy);
const cost = rules.terrainCost("forest", { weather: stormy ? "stormy" : "", harsh });
```

---

## `time` — season, day and night, sun, moon and anchors

Added in 1.12.0. Readings on Foundry's world clock (`game.time`), which stays
the one clock: nothing here sets the time, and there is no calendar window.
Every call is synchronous and works for players too. `t` is a worldTime in
seconds and defaults to now.

```js
const time = game.shadowdarkEnhancer.time;
time.now();              // { worldTime, components, label: "Monday, 21 June 1300, 14:30" }
time.season();           // { key: "summer", index: 1, name: "Summer" }
time.isNight();          // true before sunrise and from sunset on
time.sun();              // { sunrise: 4.5, sunset: 19.5 }, hours with their fraction
time.moonPhase();        // { index: 0, key: "new", fraction: 0.01, illumination: 0.0 }
time.anchor("summerSolstice");       // worldTime of 21 June 00:00, this year
time.anchor("lastFullMoon", 1300);   // the day of that year's last full moon
time.format(t);          // the date string alone
```

| Call | Returns |
|---|---|
| `now()` | `{ worldTime, components, label }`: the clock, core's components, and `format()` of it. |
| `season(t?)` | `{ key, index, name }`. `key` is `spring`, `summer`, `autumn` or `winter`, by where the season's middle falls in the year (December to February is `winter`, and so on), so core's *Fall* is `autumn` whatever it is called; `index` and `name` (localised) are the calendar's. |
| `isNight(t?)` | Before sunrise, or from sunset on. |
| `sun(t?)` | `{ sunrise, sunset }` on that day, in hours (`4.5` is 04:30). |
| `moonPhase(t?)` | `{ index, key, fraction, illumination }`. `index` 0–7 with `key` `new`, `waxingCrescent`, `firstQuarter`, `waxingGibbous`, `full`, `waningGibbous`, `lastQuarter`, `waningCrescent`; `fraction` 0–1 through the month; `illumination` 0–1. |
| `anchor(name, year?)` | The worldTime of the 00:00 the anchor falls on. `null` for an unknown name, and for `lastFullMoon` in a year too short to hold a full moon (never on a 365-day year). `year` is core's count (`game.time.components.year`), this year by default. |
| `format(t?)` | The date and time the way the Overland bar shows it, with the calendar's own weekday and month names. |

- **Seasons** are core's: the calendar's own seasons, which on the Gregorian
  calendar go by month (spring is March to May), so a season changes on the 1st.
  A season the calendar gives neither months nor days is keyed by its name
  (`null` if the name says nothing).
- **Anchors:** `springEquinox` (20 March), `summerSolstice` (21 June),
  `autumnEquinox` (22 September), `winterSolstice` (21 December), the
  cross-quarters between them, `springCrossQuarter` (5 May),
  `summerCrossQuarter` (7 August), `autumnCrossQuarter` (6 November) and
  `winterCrossQuarter` (4 February), and `lastFullMoon`. A solar anchor is the
  day the calendar shows with that date. A calendar without twelve months puts
  it at the same fraction of its year. (The `holidays` recipes keep their own
  dates: Maytide stays on the traditional 1 May.)
- **Daylight** follows a cosine between the solstices: 15 hours on 21 June
  (04:30 to 19:30), 9 on 21 December (07:30 to 16:30), about 12 at the
  equinoxes, centred on noon. One latitude for the whole world.
- **The moon** follows the synodic month, 29.530588853 days, from a new moon at
  the `moonEpoch` world setting (worldTime 0 until a GM sets another).
- **Any calendar.** Nothing assumes the Gregorian calendar: weekdays, months,
  seasons and the length of a day come from the world's.

### `shadowdark-enhancer.timeAdvanced`

Fires on the **active GM's client only**, once per world-time change, so a
subscriber that writes is a single writer by construction:

```js
Hooks.on("shadowdark-enhancer.timeAdvanced", ({ from, to, dt, offDuty, crossed }) => {
  // crossed: { days, weeks, seasons: [{ from: "winter", to: "spring", at }], seasonChanges, dawns, dusks }
});
```

`crossed` counts what falls after `from` and up to `to`: midnights (`days`),
week starts (`weeks`; a week starts at weekday 0, 00:00, which is Monday on
core's calendar), season changes (`seasonChanges`), sunrises (`dawns`) and
sunsets (`dusks`). Sunday 23:00 plus ten days is `weeks: 2`.

`seasons` lists the **last** season changes, each with the worldTime it
changed at, and holds at most one per season of the calendar (four on core's
calendar, a year's worth). A GM who first sets the clock from 0 to the year
1300 gets `seasonChanges: 5200` and the four changes of 1299, not 5,200
entries.

A move backwards (`dt` below 0, from `game.time.set` or a negative
`advance`) still fires, and crosses nothing. `offDuty` is the reason given in
`game.time.advance(seconds, { "shadowdark-enhancer": { offDuty: "downtime" } })`,
else `null`. The hook is cheap for any jump, because when the system's
real-time light clock is on it advances the world time on every tick.


## `overland` — the travel state

Added in 1.14.0 (Overland O3, #229; design `docs/plans/overland.md` §2). One
travel state per world, in the `overlandState` world setting: the setting is
the truth, only the active GM writes it, and every client re-reads it.

```js
const o = game.shadowdarkEnhancer.overland;

o.isActive();   // true while travelling (the crawl state's mode is "overland")
o.state();      // a copy of the travel state, plus derived fields:
// {
//   tokenUuid, members,            // the travel token; who travels (actor ids)
//   method, mounts, boatUuid, pushed,
//   day, budget, spent,            // the open day's dawn (worldTime) and points
//   weather, checks, pending, foraged,
//   hex: { num, terrain, region, features },  // the travel token's last hex
//   hexesLeft, climate, harsh, isNight,       // derived, never stored
// }
```

- **Starting and ending travel** is the GM's, from the crawl bar's **Travel**
  and **End travel** (offered on a tagged hex map). Another GM's click is
  forwarded to the active GM. The travel token is the Shadowdark Extras party
  token when exactly one is on the scene, otherwise the one token the GM has
  selected. The members are that party's members, or every player-owned
  character.
- **The mode:** travel is the crawl state's `overland` mode (version 3). In it
  the Crawl Strip is off and movement tracking idle; a combat started while
  travelling hides it and returns to it. `CrawlState.isActive` is true for a
  crawl or a combat only. Ending travel keeps the travel state, so starting
  again resumes it.
- **Players:** one relayed action, Forage, for a character they own; the GM
  checks the sender from the query context. It records the forage for today;
  the check and the ration are the next pieces of the build (#233).
- Weather (#230), the day's budget and the clock (#231), encounter checks
  (#232) and rations (#233) fill the fields above as they land; until then
  they keep their defaults.

## Stability notes

- Everything documented here is public surface; undocumented internals
  (direct `scripts/**/*.mjs` exports) may change without notice.
- `apiVersion` was introduced at `1.0.0`; earlier releases (≤ v0.3.0)
  exposed the same core namespaces without a version field.
- All public namespaces on `game.shadowdarkEnhancer` are documented. The
  `tokenArt`, `merchant`, `partyXp` and `recap` sections describe surface that
  already shipped — documenting them is **not** an additive API change and does
  not bump `apiVersion`.
- `1.3.0` adds `loot.resolve` and `loot.generated.{identity,plan,reconcile}`.
- `1.5.0` adds the `hexMaps` namespace (Hex Tagger, dataset builder, hand-off).
- `1.6.0` adds the `statDamage` namespace (tracked ability damage).
- `1.7.0` adds the `quests` namespace (the Quest Log) and the
  `shadowdark-enhancer.questsChanged` hook.
- `1.8.0` adds the `dying` namespace (death timers, stabilize) and the
  `shadowdark-enhancer.crawlRound` hook.
- `1.9.0` adds the `holidays` namespace (`list`, `today`).
- `1.10.0` adds the `rules` namespace (Western Reaches rules data).
- `1.11.0` adds `encounter.tableForHex`.
- `1.12.0` adds the `time` namespace and the `shadowdark-enhancer.timeAdvanced`
  hook. Holidays' Lastmoon and the encounter tables' moon columns now resolve,
  and recap entries carry `worldTime` and `gameTime`.
- `1.14.0` adds the `overland` namespace and the `overlandChanged`,
  `overlandStart` and `overlandEnd` hooks. The crawl state is version 3, with
  an `overland` mode.
- `1.4.0` adds the shared `forgeLoot.open()` preview shell. Generator rules and
  document writes remain behind the later NPC/Rival adapter implementations.
  The version policy is additive: new namespaces bump the minor version; breaking
  shapes would bump the major.
- Anything that creates or modifies documents is **GM-only** and follows the
  never-overwrite, never-delete contract — **except** generated Items in
  `world.shadowdark-enhancer--items` with `flags[\"shadowdark-enhancer\"].generated === true`, which are **replace-always**: a rerun replaces the whole document (art and properties included) at the same identity. That boundary is structural and explicit; ordinary imported Items and a generated Monster Spell (`flags[MODULE_ID].monsterSpell.generated`, same pack since A1, opposite preserve-on-conflict contract) are not overwritten. Player-initiated actions that need a
  write (loot claims, merchant transactions, item drops, luck-token gifts,
  movement rollback, downtime picks, character creation without create
  permission) are relayed to the **active GM** — see the trust model below.

## Relay trust model

Players cannot write world settings or create documents they do not own, so
every player action that mutates shared state is performed by one client: the
**active GM**. Two rules govern how that client decides whether to do it.

**1. The payload is data, never authority.** A request carries ids and nothing
else. The GM re-reads the actor, the item, the shop inventory, the loot card and
the session at handling time and recomputes prices, quantities and gating from
those documents. A forged `cost`, an inflated quantity or a fabricated item body
is not consulted, so it cannot take effect.

**2. The sender is established by the server, never by the request.** Player
actions travel as Foundry **user queries** (`CONFIG.queries` + `User#query`,
v13+), where the server stamps the sender from the authenticated socket before
delivering. The handler receives that `User` document and requires OWNER on the
actor being acted for; GMs may act for anyone.

**3. The receiving client decides whether it is the one that should act.** A
query is point-to-point, but the *sender* chooses the recipient, so "the player
addresses `game.users.activeGM`" is a property of a cooperative client and not a
guarantee. A player can send the same authenticated query to every connected GM,
and since each client has the handlers registered and its own in-memory locks,
the action would run once per GM. Every query entry point therefore opens with
`refuseQuery`, which requires this client to *be* `game.users.activeGM` — the
same gate the old socket handlers had, kept for the same reason. In a world with
a second GM (an assistant, or an always-on watchdog client) dropping it would
double every transaction.

Rule 2 is load-bearing rather than belt-and-braces. `game.socket.emit` carries
no proof of who sent a message, and `Document#testUserPermission` returns OWNER
unconditionally for any GM — so while identity came out of the payload, a client
naming any online GM satisfied every ownership check in the module. All
player→GM actions now travel that way, and the raw module socket carries
only GM→everyone broadcasts and payload-free "re-read the setting" nudges, none
of which grant anything.

**The same rule applies in reverse.** A GM→everyone push has no authenticated
sender on a raw socket either, so the merchant's transaction notices are queries
addressed to each connected player, and the receiver checks `user.isGM` on the
server-stamped sender. Stamping the GM's id into a broadcast payload and
comparing it against `game.users.activeGM` would *look* like a fix and be none:
the stamp is a payload field, so an attacker writes the GM's id into it. What is
left on the raw socket is one-to-many state nudges that carry no payload at all
— `shop:open`, `shop:close`, `downtime:sync`, `crawl:state` — where the receiver
re-reads the world setting and a forged nudge buys an idempotent re-read of what
the GM actually persisted.

**A GM can be the wrong writer too.** Renown is the one value the module adjusts
by reading it, adding a delta and writing the sum back — and "GM-only" is not
"one client": a world with an assistant GM, or with an always-on watchdog client,
has several. Two GMs awarding in the same moment both read the same value and
both write the same total, so one award is silently lost while both are logged.
`Renown.award` therefore forwards to `game.users.activeGM` whenever it is not
already running there (query `sde.renown`, registered by GM clients only), and
the receiving client re-reads the actor and applies the **delta** inside a
serialized queue. The delta is what travels; a computed total never does. The
queue is needed on top of the single-writer rule because `actor.update` awaits a
server round trip, so two awards on one client can still overlap.

Two consequences worth knowing:

- **`QUERY_USER` must stay enabled for the player role.** It is on by default.
  A world that revokes it gets an explicit warning naming the permission rather
  than a dead button.
- **A refusal reaches the player who asked, and nobody else.** The GM's handler
  returns `{ok: false, error}` and that string is shown as a warning on the
  requesting client. Refusals are no longer broadcast.

Module code registering its own relay should use `scripts/shared/gm-relay.mjs`:
`relayToGM(queryName, data, {label})` on the player side, `refuseQuery(user)`
plus `authorizeActorFor(actorId, user)` on the GM side, and
`notifyPlayers(queryName, data)` for a GM→players push.

## Public hooks

| Hook | Fired when | Payload |
|---|---|---|
| `shadowdarkEnhancer.ready` | The API is live and mirrored on the module | the api object |
| `shadowdark-enhancer.contentUnlocked` | Imported content becomes available — an open Character Builder re-reads its content | *(none)* |
| `shadowdark-enhancer.partyXpAwarded` | A party XP award commits | `{ amount, label, results }` |
| `shadowdark-enhancer.lootScored` | A claimable loot card is posted | `{ totalGp, totalXp, items, source, messageId }` |
| `shadowdark-enhancer.questsChanged` | A quest was created, changed or deleted; fires on every client, once per burst of writes | `{ ids }` — the quest entry ids that changed |
| `shadowdark-enhancer.crawlStart` | A crawl session starts | the crawl state |
| `shadowdark-enhancer.crawlEnd` | A crawl session ends | the crawl state |
| `shadowdark-enhancer.crawlRound` | The crawl round advances, on the one GM client that advanced it (the death timers tick on it) | the crawl state |
| `shadowdark-enhancer.timeAdvanced` | The world time changes; on the active GM only, once per change | `{ from, to, dt, offDuty, crossed }` — see [`time`](#shadowdark-enhancertimeadvanced) |
| `shadowdark-enhancer.overlandChanged` | The travel state was written; on every client | a copy of the travel state |
| `shadowdark-enhancer.overlandStart` | Overland travel starts, on the GM client that started it (as `crawlStart`) | [`overland.state()`](#overland--the-travel-state) |
| `shadowdark-enhancer.overlandEnd` | Overland travel ends, on the GM client that ended it (as `crawlEnd`) | [`overland.state()`](#overland--the-travel-state) |
| `sde.stateChanged` | Any crawl-state change (mode, turn, roster, out-of-combat initiative) — this is the high-frequency one the strip and bar re-render on | the crawl state |

> **Three prefixes are in play, deliberately.** The ready signal uses camelCase
> `shadowdarkEnhancer.`; feature hooks use the module id
> `shadowdark-enhancer.`; and the crawl-state change hook uses the short
> `sde.` form. All three are existing surface kept for back-compat — match them
> exactly.
