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
[`charBuilder`](#charbuilder--guided-character-creation) ·
[`actors`](#actors--western-reaches-boats)

**API version:** `1.1.0` (semver — additive changes bump the minor version,
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

api.renown.valueOf(actor);  // integer; may be negative
api.renown.bandOf(actor);   // { key, label, max, bonus, note }
api.renown.bonusOf(actor);  // 0 | 1 | 2 | 3
api.renown.party();         // [{ actorId, name, renown, band, bonus }], highest first
```

The four bands run `≤3` / `4–7` / `8–11` / `12+`, granting a `+0` / `+1` / `+2` /
`+3` bonus. Renown has no floor and is allowed to go negative.

**The reaction bonus is never added automatically.** A character adds it only
where they would plausibly be recognised, which is a per-roll decision, so the
Encounter Roller carries a **Recognised here** toggle (off by default) and a
picker for whose renown applies. Independent of all of that, **double 1s on the
reaction dice are always hostile** — `reactionBand(total, { doubleOnes })` in
`encounter-result.mjs` short-circuits before the band ladder.

**Carousing is not automated.** By the book the same bonus applies to carousing
event rolls, but the module has no carousing roll to hook it into, so `bonusOf`
is all it offers there — add the bonus by hand when you roll the table.

Only one trigger is wired automatically: a level gain, controlled by the
**Renown on level-up** setting. Reaching level 1 is excluded, because the
Character Builder and the level-0 funnel both write `system.level.value` as part
of creating the character. Everything else the book lists is a judgement call and
lives on the dialog as a suggestion.

Every change — a GM award, a level-up, a downtime rumour — is logged to the
Session Recap (its **XP & Renown** tab, and a `## Renown` section in the Discord
export) and posts a chat card, unless the caller passes `chat: false`. Downtime
passes `chat: false`, because its own result card already reports the change.

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
// picks the encounter table, and reads what it can out of the imported tables.
const s = await api.pitFighting.setUpBout({
  fighterIds: ["abc123", "def456"],    // who enters the pit
  danger: null,                        // null follows the suggestion
});
// → { bout, aplDetail, fighters, twistSub, venueText, twistText, foeText, missing }

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
| `shadowdark-enhancer.crawlStart` | A crawl session starts | the crawl state |
| `shadowdark-enhancer.crawlEnd` | A crawl session ends | the crawl state |
| `sde.stateChanged` | Any crawl-state change (mode, turn, roster, out-of-combat initiative) — this is the high-frequency one the strip and bar re-render on | the crawl state |

> **Three prefixes are in play, deliberately.** The ready signal uses camelCase
> `shadowdarkEnhancer.`; feature hooks use the module id
> `shadowdark-enhancer.`; and the crawl-state change hook uses the short
> `sde.` form. All three are existing surface kept for back-compat — match them
> exactly.
