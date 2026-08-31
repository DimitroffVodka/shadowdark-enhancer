# Changelog

## [Unreleased]

### Added
- **Pathfinder Character Gallery portraits in Character Builder.** When the
  curated portrait gallery is enabled, character portraits from *Pathfinder
  Tokens: Character Gallery* (`modules/pf2e-tokens-characters/assets/portraits`)
  are now automatically discovered and merged into the portrait picker on the
  **Preview** step. Players need no file permissions (`FILES_BROWSE`):
  browsing executes on the active GM's client via the
  `shadowdark-enhancer.browseArt` query and returns the filtered image list.
  The gallery setting (**Portrait/token art folders**) continues to allow
  custom comma-separated folders, and leaving it blank remains the explicit
  switch to disable the gallery entirely. If the Pathfinder module is not
  installed or its directory is unreadable, it is silently skipped without
  affecting custom or bundled gallery images.
- **Explicit art provenance for imported items.** Item art on re-import is now
  governed by an explicit provenance stamp (`default`, `imported`, `curated`,
  `custom`) rather than guessing from the image path string. The previous
  heuristic (`img.startsWith("icons/")`) failed in both directions: bundled
  defaults under `modules/shadowdark-enhancer/assets/icons/shikashi/` failed the
  check and overwrote hand-picked GM art on re-import, while deliberate curated
  `icons/...` picks looked like defaults and could never be upgraded.
  Every image written by the item importer is now stamped with its state and the
  exact path written; if the stored path still matches the witness on re-import,
  upgradeable states (`default`, `imported`, `curated`) can be upgraded by new
  defaults or curated icon maps, while any user modification diverges from the
  witness and is classified as `custom` (preserved and never overwritten).
  Legacy unmarked items are classified deterministically and conservatively (matching
  the module's default pick today or blank is `default`, everything else is `custom`
  and preserved). Generated artifacts in the managed Items pack
  (`world.shadowdark-enhancer--items`) are governed by the structural replace-always
  contract (A7/D6) and remain authoritative.
  *Note:* This provenance mechanism now governs `item-importer` and class-content re-imports (`Class`, `Talent`, `Class Ability`, and overlay `Item` art via `scripts/importer/char-content/class-unit-importer.mjs` reusing the same `flags["shadowdark-enhancer"].art` witness). Monster/token art remains handled by Monster Token Art / Token Art Manager (B9/F4/N6).
- **Import everything.** *Importer Hub → Manage* now carries an **Import
  everything (N)** button, and opening any folder puts an **Import all N in
  \<folder\>** button at the top of it — the same run, scoped to that branch. It automates the loop rather than
  changing it: for each locked row it seeds the unlock, grabs the cited pages out
  of *your own* uploaded PDF, parses them and commits the preview, through the
  same parsers and the same commit paths you'd drive by hand — the Class
  Importer, Spell Importer and Item Builder included. Rows that one press already
  unlocks together (a whole bestiary spread, the eight WR boats, a gear price
  table) count as one entry, so the run does the work once instead of per row.
  Because nobody is watching it, it holds three lines: **nothing is overwritten**
  — every name conflict answers "keep what's there", so a second run creates
  nothing and duplicates nothing; **nothing broken is committed** — a table or
  class that fails its quality check is left alone and named in the report; and
  **every row is accounted for** — a row with no linked PDF, no page cite or no
  automated route is reported with the reason rather than dropped. You get a
  count and a per-workspace breakdown before it starts, a progress bar with a
  **Stop** button while it runs (it finishes the current entry, then stops), and
  a report grouped by outcome at the end: *Imported*, *Nothing to import*, *Needs
  your attention*, *Not run*, *Import these by hand*. Toasts are collected during
  the run instead of stacking hundreds deep — each entry's own warning lands on
  its row in the report. The censuses rebuild once at the end rather than after
  every entry, so a long run doesn't spend its time re-scanning your packs.
- **Auto-detect now recognises a downtime page instead of offering to build an
  item out of it.** Auto sorts monsters, items, spells and tables; downtime is
  none of those, because unlocking it needs a book chosen and writes a world
  setting rather than creating documents. But being absent from the sorter did
  not mean being left alone — the item recognizer claimed the `DC 9:` lines and
  the Hub offered to create a **Basic** item out of a page of the book. Auto now
  checks first, and a page carrying a printed activity heading (SPIRITUALISM,
  SKULDUGGERY, MARTIAL TRAINING, MAGICAL RESEARCH) together with at least two DC
  lines is reported rather than parsed: a notification and a Skipped entry naming
  what it saw, and telling you to set **Importing** to **Downtime** and pick the
  book. Nothing is created. The bar is deliberately high — an item list, a
  statblock, or a table that happens to print DCs are all left alone.
- **Curated weapon icons for 37 Core and Western Reaches weapons.** Imported weapons filed into the managed Items pack (`world.shadowdark-enhancer--items`) that match one of 37 reviewed names now receive a Foundry-native `icons/...webp` icon on creation, selected from the matching `icons/weapons/...` or `icons/skills/melee/...` folder and vetted against the real Foundry icon tree. The map is source-agnostic (`Bastard Sword` resolves the same regardless of which supported book printed it) and is registered through A4's discovery seam (`scripts/shared/curated-icon-maps/weapon-icons.mjs`), consulted in `buildItemData` ahead of the generic fallback. Fresh imports with no art, items carrying the module default, untouched imported images, and prior curated picks are upgradeable on re-import; a later map revision upgrades an untouched curated pick, while any GM-edited image diverges from its witness and is classified as `custom` and never overwritten. Unmapped weapon names keep the existing generic/type default, and no document in the Shadowdark system compendium (`shadowdark.gear`) or other system pack is mutated — the resolver's `world.` allowlist refuses those targets. Armor, Basic Gear, and treasure keep their existing fallback art in this D1 changeset; other category maps activate only when their owning D-tickets ship. Intentional semantic selections where weapon art had no distinct match include `Lance` → `icons/skills/melee/strike-polearm-light-orange.webp`, `Morningstar` → `icons/skills/melee/strike-morningstar-gray.webp`, and `Strikes` → `icons/skills/melee/unarmed-punch-fist-blue.webp`.
- **Curated armor icons for 9 canonical armors + 4 mithral spelling aliases (13 rows).** Imported armor filed into the managed Items pack (`world.shadowdark-enhancer--items`) that matches one of 13 reviewed armor display names now receives a Foundry-native `icons/...webp` icon on creation, selected from the matching `icons/equipment/...` or `icons/commodities/...` folder and vetted against the real Foundry icon tree. The map is source-agnostic (`curatedNameKey(finalDocument.name)` alone → `leather armor`, `mithral chainmail`; `Chainmail, mithral` and `Mithral Chainmail` resolve to the same reviewed path) and is registered through A4's discovery seam (`scripts/shared/curated-icon-maps/armor-icons.mjs`), consulted in `buildItemData` ahead of the generic fallback via `_automaticArt` → `curatedArtFor({name})` and stamped `curated`. Covers the N3 armor census: 9 canonical names — `Leather armor`, `Chainmail`, `Mithral Chainmail`, `Plate mail`, `Mithral Plate Mail`, `Shield`, `Mithral Shield`, `Round shield`, `Mithral Round Shield` — plus 4 deliberate source-spelling aliases that share the reviewed path without inflating canonical inventory: `Chainmail, mithral` ↔ `Mithral Chainmail` → `icons/equipment/chest/breastplate-banded-steel-grey.webp`, `Plate mail, mithral` ↔ `Mithral Plate Mail` → `icons/equipment/chest/breastplate-cuirass-steel-blue.webp`, `Shield, mithral` ↔ `Mithral Shield` → `icons/equipment/shield/heater-crystal-blue.webp`, `Round shield, mithral` ↔ `Mithral Round Shield` → `icons/equipment/shield/round-wooden-boss-steel-yellow-blue.webp` (remaining canonical paths: `Leather armor` → `icons/equipment/chest/breastplate-layered-leather-brown.webp`, `Chainmail` → `icons/commodities/metal/mail-chain-steel.webp`, `Plate mail` → `icons/equipment/chest/breastplate-layered-steel.webp`, `Shield` → `icons/equipment/shield/heater-steel-gray.webp`, `Round shield` → `icons/equipment/shield/shield-round-boss-wood-brown.webp`). Fresh imports with no art, items carrying the module default, untouched imported images, and prior `curated` picks are upgradeable on re-import; a later armor-map revision upgrades an untouched curated pick, while any GM-edited image diverges from its witness and is classified as `custom` and never overwritten. Enabling the map does not reclassify an already stored `imported` Item; its stored classification stands until the image itself changes. Unmapped armor names keep the existing generic/type default, and no document in the Shadowdark system compendium (`shadowdark.gear`) or other system pack is mutated — the resolver's `world.` allowlist refuses those targets, so `shadowdark.gear` remains byte-stable. Basic Gear and treasure keep their existing fallback art in this D2 changeset; other category maps activate only when their owning D-tickets ship.
- **Curated Basic Gear icons for 37 canonical names plus 7 quantity/spelling aliases (44 rows).** Imported Basic Gear in the managed Items pack now resolves through `scripts/shared/curated-icon-maps/gear-icons.mjs` before the generic fallback. Keys are source-agnostic final names, with deliberate aliases for `Arrows (20)`, `Caltrops (one bag)`, `Candle (3)`, `Crossbow bolts (20)`, `Iron spikes (10)`, `Rope, morzo silk`, and `Rations (3)` sharing their canonical icon paths. Matches are stamped `curated`; untouched `default`, `imported`, or earlier `curated` art can upgrade, while GM-custom art is preserved and unmapped names keep `default` fallback art. The composed D1+D2+D3 registry is now mechanically audited as one collision-free bare-key space: 94 rows (37 weapons + 13 armor + 44 Basic Gear), zero sourced rows or registry problems, with all reviewed paths checked against the real Foundry icon tree when available. System compendiums remain outside the write boundary. Treasure art remains unchanged in this D3 changeset and activates only with its owning D4–D6 tickets.

### Changed
- **Monster Spell Library automatic refresh is now gated by module version.**
  On world activation, the active GM checks the world setting
  `monsterSpellSyncVersion`. When it matches the current module version, the
  automatic refresh is skipped completely. On a fresh version or when the stamp
  is cleared, the active GM automatically refreshes monster spells from
  Shadowdark Core and the managed Enhancer Actors pack (`sde-actors`), advancing
  the stamp only when the refresh succeeds.
- **Legacy Monster Spell consolidation and update gate failure handling.**
  Consolidation of the retired `world.shadowdark-enhancer--monster-spells` pack
  continues to run on every world activation as a safety net. If consolidation
  fails — either throwing or returning `status: \"incomplete\"` when created
  copies could not be verified and A1 deliberately kept the originals in the
  retired pack for a later retry — the automatic refresh is deferred to prevent
  generated copies from replacing curated legacy spells. The bound is the
  retired pack's state: if it still holds unmigrated documents (or cannot be read,
  which the gate treats as populated), the automatic refresh is deferred, a warning
  notification is surfaced once per session directing the GM to the manual
  **Build / Refresh** workflow, and the version stamp is left unchanged to retry
  next activation. If the retired compendium is absent or already empty, the same
  consolidation failure does not block the version-gated refresh. Manual
  **Build / Refresh** remains available at all times and does not consult or modify
  the version stamp.
- **Monster Spells now live in the managed Items pack.** Generated copies of
  monster-only spells are now filed into `Shadowdark Enhancer — Items` under
  `Monster Spells / <source>` (e.g. `Monster Spells / Shadowdark Core`,
  `Monster Spells / Cursed Scroll 3`) instead of auto-creating a dedicated
  `world.shadowdark-enhancer--monster-spells` compendium. On world activation as
  the primary GM, existing content in the legacy pack is migrated automatically
  into `sde-items` before the legacy pack is emptied. Hand-authored GM items in
  the legacy pack are moved verbatim into `Monster Spells / Other Sources`.
  Existing edits and custom artwork are preserved, and a migration marker
  prevents duplicate items on partial runs. The legacy pack remains present but
  empty for one release as a visible deprecation and compatibility shell;
  because moved documents receive new IDs inside `sde-items`, legacy document
  UUID references do not resolve and should be repointed to their target
  counterparts. Pre-A1 suite backups containing `packs.monsterSpells` payloads
  are automatically restored into the managed Items / Monster Spells folder
  hierarchy during bundle import, reporting explicit errors rather than
  silently omitting legacy documents. Migration, restore, and refresh sweeps
  are safe and idempotent on re-run.

### Fixed
- **An ordinary item import that says Replace no longer replaces a generated Monster Spell.** Where the pasted item's name matches a generated Monster Spell, choosing **Replace existing** no longer overwrites the library document — the spell is kept in place, the import lands beside it under a free name, and a warning names the protected document and the name the import was kept as.
- **A permitted item replacement no longer erases module-owned flag blocks the import never declared.** Updating a compendium document now preserves this module's own flag blocks a replacement payload did not mention. Losing `monsterSpell.libraryId` made the planner miss the original on the next library refresh and generate a duplicate beside it.
- **An importer-generated description that only echoes the document's name no longer displaces curated prose.** A Spell paste that arrives with no description fills as `<p>{name}</p>` — that placeholder now counts as importer output on the way in and as nothing worth keeping on the way out, so hand-written spell text is no longer overwritten by a name-echo re-import.
- **Western Reaches siege weapon properties now live in their own dedicated folder.**
  When importing siege weapons (*Western Reaches* p119), the generated *Blast* and
  *Exploding* weapon property items are now filed cleanly into `Shadowdark Enhancer — Items`
  under `Western Reaches / Weapon Properties` instead of landing loose at pack root.
  Both individual Items commit and batch *Import everything* / *Commit All* share this
  preparation prepass so property items are always properly materialized and foldered.
  On re-import or when updating an existing library, legacy same-name property documents
  at the pack root are moved into the folder in place, preserving their document UUIDs,
  system descriptions, and GM edits without creating duplicate folders or duplicate
  items. Ordinary weapon items and unrelated gear continue to follow their existing folder
  locations.
- **Boat sheet description text has readable contrast across all themes.** On
  dark Foundry themes, opening a Boat actor's **Description** tab showed dark
  text against a dark inherited background, making notes nearly unreadable.
  The description text area now uses an explicit parchment surface with dedicated
  dark ink and focus states scoped strictly to the Boat sheet,
  restoring clear readability across light and dark themes without affecting
  other sheets.
- **Gutter warnings no longer cry wolf over lower full-width tables or sub-point glyph margins.**
  PDF extraction warns when a chosen two-column gutter might slice through body text,
  advising you to check the extracted preview before importing. But on mixed-layout pages
  where two prose columns sit above a full-width table (such as the *Western Reaches*
  boats table on p118), the warning pass was evaluating the wide lower table against
  the prose gutter above it, falsely reporting that column cuts ran through table cells
  that the layout already handled as a single wide block. Similarly, tight table column
  headers (like *Type* on *Western Reaches* p119) could overhang the detected split
  boundary by a fraction of a point due to font glyph metrics even when the word's
  center was safely positioned within its column. The warning detector now excludes
  lower full-width bands from the prose gutter check and tolerates sub-point overhangs
  for words centered cleanly in their column, eliminating false alarms while preserving
  visible warnings for genuine column-split text corruption.
- **Token Art Manager imported-monster census and placed-token resolution hardened.**
  Managed imported NPCs in `sde-actors` (e.g. Cursed Scroll and Western Reaches
  monsters) have their catalog census ingestion hardened to handle both Array
  and Collection-shaped index payloads, case-insensitive NPC type checks, and
  per-pack ID deduplication, ensuring non-NPC actors (boats/mounts) remain
  cleanly excluded. Same-name Core and imported monsters remain distinct
  provenance-tagged rows with independent picks and Browse access for
  zero-suggestion rows. Placed-token resolution by name (`resolveByName`)
  uses Core-first precedence when both rows have art while correctly falling
  back to an imported pick when Core has no configured art.
- **Martial Training no longer vanishes from the Downtime window.** When a
  character's class hit die couldn't be read — a level 0 character who hasn't
  picked a class yet, or a class item that won't load — the whole activity
  quietly disappeared instead of showing. The window was narrowing the list to
  "the character's tier", and with no tier to narrow to it matched nothing;
  Martial Training is the only activity where *every* entry belongs to a tier,
  so nothing was left to draw and the section was dropped. It now does what the
  book does and what the wiki always described: all three tiers show at once,
  each under its own heading, all of it dead, with a note naming the reason. The
  **Training tier** dropdown stays hidden while that is true, since every tier is
  already on the page and the gate is shut for the GM as well.
- **The Western Reaches siege weapons import again.** *Importer Hub → Manage →
  Vehicles → Siege Weapons* warned that the page's gutter cut through a word and
  then reported "No siege weapons found", for every one of the four weapons —
  nothing could be imported at all. Two things were wrong, and both are fixed.
  The grab read p119 in column-aware mode, but the SIEGE WEAPONS table is printed
  **full width** on a two-column page, so the column split ran straight down the
  middle of the table and handed the parser a transposed jumble — the same thing
  the Basic Gear / Weapons / Armor unlocks already avoid by reading their wide
  price tables as a single column. The page is now read **twice**, once per
  column mode: the table comes off the single-column read, and the Blast /
  Exploding rule text off the column-aware one, so neither is reconstructed from
  a shape that mangles it. (The paste box therefore holds p119 once per mode, and
  a "Column check" warning there now refers to the rules text rather than the
  table.) The parser was the other half: it accepted exactly two layouts and gave
  up whole when either was off by a cell, so a blank Properties column, a
  differently-punctuated *Crossbow (heavy)*, or one word the gutter pushed across
  cost all four weapons rather than one. It now reads a row whole, one cell per
  line, or split across the gutter — pairing the split halves on the column they
  meet at, so a stray cell costs at most its own row — and takes the name however
  the printing punctuates it. When a row still can't be read, the rest import and
  the message names the one that didn't, instead of reporting nothing found; and
  when *nothing* parses, it says whether the page had the weapon names on it at
  all, which separates a bad page cite from a bad column split — and, for the
  bad-cite case, points at the printing rather than at a page-offset control,
  which the Source PDFs library does not have (offsets are a constant in code,
  and only the Core Rulebook carries one).
- **A weapon's book-only properties no longer arrive as a note to self.** The
  Western Reaches weapon and armour tables print property codes core Shadowdark
  ships no property for — *Charge*, *Devastating* and *Mounted* on the Lance,
  *Obsidian* on the obsidian weapons, *Sniper* on the blowpipe, *Mount* on
  barding. There is nothing to attach them to, so the importer left them off and
  flagged each one with *"note it in the description"* — and then didn't. The
  Lance committed as a plain 15 gp d12 pole, and the three properties that make
  it a lance survived only for as long as the GM remembered to type them in by
  hand. They are now written into the item's description as it commits —
  *"Properties with no core Shadowdark equivalent: Charge, Devastating,
  Mounted."* — property labels only, because the rules text stays in the book you
  own. Re-importing the same weapon refreshes that one line and leaves a
  description you wrote yourself exactly as it was. The **Paladin's Lance** is
  stocked by the class import rather than pasted as a table row, and it now
  arrives the same way — importing the Paladin again updates an existing Lance
  in place, so a world that already has one gets the line without a re-import of
  anything else. That same pass stopped a quieter loss: re-importing a class used
  to blank any description a GM had written on its stocked gear (the Duelist's
  Rapier and Falchion, the Necromancer's Stave), because the overlay ships stats
  and no text. Those descriptions are now left alone.
- **A downtime paste no longer loses Martial Training and Magical Research to a
  missing period.** Paste all four activities and only the first two would
  appear — not because anything was missing, but because those two are the only
  ones that need a *sub*-heading above their DC lines, and the parser demanded
  one exact shape. A tier line printed `d8+ INT, STR, or DEX Check` instead of
  `d8+.`, or a subsection line reading `INT or CHA Spellcasters:` with a colon,
  left the segment unopened; every line beneath it then had nowhere to go, both
  activities stayed empty, and an activity with no entries isn't drawn. The
  matchers now take the punctuation a real page carries — a missing period, a
  trailing colon, ALL CAPS — while still refusing to mistake a wrapped line of
  outcome text (`…no larger than d6 max`) for a tier heading.
- **A paste that can't be placed now says so loudly.** The parser's
  "couldn't place this line" notes had no prose written for them, so they
  rendered in the quiet style meant for the two-column recovery notes: a paste
  that silently dropped two whole activities read no worse than a clean one.
  They are now full-voiced problems that name the activity and the exact line
  the paste is missing, and repeats collapse — one note per activity that failed
  to open, not one per line it swallowed.
- **A column-check warning now names the word it is worried about, and stops
  crying wolf over centred headings.** Grabbing text from a PDF warns when the
  column split may have moved a word between columns — but it only ever said
  *how many* words, so "cuts through 1 word" on a four-page bestiary grab meant
  proofreading four pages to find out which. The warning now quotes the words
  themselves (up to three, then a trailing "…"), so checking it is one search in
  the paste box.

  It also fires far less often. Page furniture — a section title, a running
  header, a folio, an ornament — crosses a perfectly good gutter all the time
  and lands in one column harmlessly, and the warning used to recognise it by
  its being alone on its baseline. A centred title loses that signature the
  moment PDF.js hands it over as several runs, which letter-spaced display type
  usually does: every run is narrow, so the one sitting over the gutter scored
  as a stolen body word. Furniture is now judged by its whole row — ink that
  never leaves the middle half of the page is furniture however many pieces it
  arrives in — while a word on a real two-column line still warns, by name.
  Caught on a Cursed Scroll 2 bestiary grab (pgs. 40-43), which raised two
  one-item warnings that named nothing to look at.
- **Importing a mount created a roll table instead of a mount.** *Importer Hub →
  Manage → Monsters → Mounts* offered an **Import** button for each of the seven
  Western Reaches mounts the system doesn't ship, and pressing it produced a
  **Roll Table** named after the mount — never the actor. The unlock was handed
  to the generic content-unlock route, which parses "auto" and treats every
  seeded unlock as a request for exactly ONE table: it kept whatever table the
  MOUNTS spread parsed into, stamped the mount's name on it, and sent that to the
  table commit, while the statblocks the GM actually wanted were left with
  nothing to create. A mount unlock is an *actor* unlock, so it now parses the
  pages as statblocks — beside the boats and siege-weapon unlocks, which always
  had their own parse — and the one-table rule no longer applies to actor,
  vehicle or gear unlocks alone. A single **Import** click keeps that one
  mount's statblock and sends the rest of the spread to **Skipped**, so
  importing one missing mount still can't mint the other fourteen as duplicates;
  **Import everything** instead batches every *selected* Western Reaches mount
  together — one `WR pp.116–117` spread read, one mount parse, one commit
  through the same importer — and the run report lists each requested mount by
  name as **Imported**, **Nothing to import** (already in your library), or
  **Needs your attention** (not among the statblocks on those pages), so a
  partial parse or a rerun can no longer hide as a single successful entry. The
  book prints the mounts by
  their natural names ("WAR HORSE") while the catalog lists them index-style
  ("Horse, War"), which used to mean the selected statblock matched nothing at
  all; both spellings are now understood. The mount is created under the
  catalog's name — the one on the button the GM pressed — because the actor's
  name is what the Mounts list reconciles against, and a mount filed under the
  book's heading would have stayed listed as missing, still offering an Import
  its own duplicate check then refused. A mount already in your world under
  either spelling now counts as present. And when the extracted pages hold no
  statblock, the importer says so and names the pages to grab instead of quietly
  creating the wrong kind of document.
- **Importing the Basic Gear table no longer mints a Coin and a Gem.** Both sit
  in the book's gear table next to real equipment, so the importer took them for
  gear and created them as items — worth `0 gp`, because the table prices them
  *Varies*. They then lived in `Manage > Items > Basic Gear` permanently, two
  rows of currency in a list of equipment. Neither is a thing a character buys:
  a coin is money and a gem is treasure, and what either is worth is whatever
  the GM says at the time. Both are now refused wherever a gear table is read —
  the paste box, the Item Builder's guided gear stage, and the cost-table join —
  and they are listed under **Skipped** with the reason, rather than dropped
  without a word. `Manage > Items > Basic Gear` also stops listing them, so a
  world that got them from an earlier import shows equipment only; the items
  themselves are left in `sde-items` for you to delete, because nothing here
  deletes your documents. Names that merely start the same way — a coin purse, a
  gemstone dust — are unaffected: the rule matches the row's name cell exactly.
- **Basic Gear descriptions no longer swallow the next item's text.** Descriptions pasted as `Name. body…` blocks previously ended at the next *anchored* header, so any real record start the anchor list didn't cover was swallowed by the item above it — a refused currency row (Coin/Gem), a header spelled differently from its table row (`Oil flask.` vs `Oil, flask`), or a name two rows share (`Rope` from `Rope, 60'` / `Rope, morzo silk`). Page-furniture lines (a bare number optionally fenced by punctuation, e.g. `108` or `— 42 —`) are not record starts; before the fix they could be retained as garbage inside a captured description, and C1 now excises them without splitting a record that continues across the page — the actual following header (known or generic) is what ends the prior body. On the active Item Builder path (`splitDescriptionsByNames` → `findRecordStarts`) the shared `record-boundary` rule now ends a known description at the next record start even when that start is unassigned — a known name plus period (any length on this path, matched at the text start, after a period, or after a newline so two records on one line still split there) or a line-initial, capitalised, at-most-44-character, at-most-three-word lead-in that is not a sentence opener — so assignment and boundary detection are separate steps and the affected Basic Gear records no longer fuse. Trailing and multiline prose (`Has a shutter to hide the light.`, wrapped sentences, and lowercase mentions like `iron spikes.` that used to cut Caltrops) stays with its own record. This is a parser-only fix — existing Items that imported with bled text keep that text until you re-import the Basic Gear descriptions; nothing is migrated automatically. `Oil, flask` (header `Oil flask.`) and the plain `Rope.` header remain deliberately unassigned on the current anchor rules and are tracked separately, and pasting a table page with its footer number can still mint a spurious numeric row in the table path — both are separate follow-ups outside this boundary fix.

## [0.15.1] — 2026-08-26

### Added
- **The Duelist's Taunt now remembers itself.** *"When an enemy misses you with
  an attack, you have advantage on attacks against that enemy next round."* A
  talent nobody remembers mid-fight, because it depends on something that
  happened on somebody else's turn. Now an enemy that misses a character with
  Taunt hands them advantage against **that** enemy — not its friends — until
  the end of their next turn, and a short card says so when it arms. When they
  attack that enemy the advantage is on the roll, with the reason printed on the
  roll card, so it never has to be remembered or argued about. Attacking does not
  use it up; it lasts the full duration. Two rulings are baked in and both follow
  the rules as written: advantage and disadvantage **cancel**, so a Duelist who
  is also at disadvantage rolls normally rather than having the disadvantage
  quietly replaced; and a blow turned aside by **Parry** counts as a miss, since
  the talent says the attack *misses instead* — so parrying arms Taunt. The
  duration is measured against the combat's own turn order, and a miss during
  your *own* turn doesn't burn the duration on the turn you are already in.
  Duelists already in your world are recognised without a re-import. One
  setting, **Automate the Duelist's Taunt**, turns it off.
- **The Duelist's Parry is now a button, not a note on the sheet.** *"Once per
  day, an attack of your choice that would hit you misses instead."* Because you
  choose *after* seeing the blow land, this could never be automatic — so when
  an attack hits a character who has the ability, a **Parry this attack** button
  appears on that attack's card for their player and for the GM. Using it spends
  one of the day's uses, announces that the attack missed, and strikes the
  damage total through on the original card so nobody applies it out of habit.
  If the GM was quicker than the player and the damage has already landed, it is
  given back — and given back correctly. Shadowdark clamps HP at zero, so a
  Duelist on 3 HP hit for 7 lost three points and not seven; Parry returns the
  three that actually left, rather than handing them a profit. A hit that
  dropped them also takes the downed state with it: the defeated marker and the
  unconscious condition are cleared, while anything true *before* the blow —
  already prone, already defeated — is left exactly as it was. Needs the
  system's **Enable Targeting** setting, which is what tells an attack roll
  whose AC it was rolling against; without a target there is no "you" for the
  attack to have hit. Duelists already in your world are recognised without a
  re-import. One setting, **Automate the Duelist's Parry**, turns it off.
- **The Delver's Scavenger talent now rolls itself.** *"When you expend the
  last of a consumable item you've carried since your last rest, roll a d6. On
  a 5 or 6, you regain one use of that item."* Until now that arrived as rules
  text on the sheet and nothing more, so it only happened when a player
  remembered it. Spend your last torch — burn it out, drink your last potion,
  loose your last arrow — and the d6 rolls, a card shows the face and the
  success range, and on a success the item comes back at one use. A recovered
  light source returns unlit with a full burn time, so it is a torch again
  rather than a spent one. **Master Scavenger** widens the range to 4-6, and a
  second copy to 3-6, which is where the Delver talent table stops it; a Delver
  already at 3-6 who rolls 10-11 again should reroll, which stays a GM call at
  level-up. Two settings: **Automate the Delver's Scavenger** and **Scavenger
  covers ammunition**, the latter separate because arrows decrement on every
  ranged attack and fire far more often than gear does. Delvers already in your
  world are recognised without a re-import. Note that Shadowdark records no
  difference between using a consumable up and getting rid of one, so selling
  or gifting your last torch can also pay out.

### Fixed
- **A player could mint luck tokens through an owned NPC.** The luck relay
  authorised the giver by ownership alone, and players routinely own NPCs —
  familiars, mounts, hirelings. An NPC data model has no `useLuckToken`, so the
  optional call returned `undefined` rather than `false` and sailed straight
  past the refusal written to stop exactly this: the giver lost nothing, the
  receiver was credited anyway, and the query answered *ok* every time it was
  sent. Both ends are now gated on a Player actor, and any falsy spend counts as
  a refusal. Those refusals also never reached the player who pressed the
  button — they were raised on the GM's client for a relayed give, so the GM
  read *"X has no luck token to give"* while the player saw nothing. The
  sentence now goes to whoever asked.
- **Blanking a GM initiative box wrote a permanent 0.** `Number("")` is 0, not
  NaN, so the finite-number gate read a cleared field as a deliberate zero — a
  real, storable initiative that sorted the member last, counted them as having
  rolled, and could not be unset from anywhere in the tab. Emptiness is now
  checked before coercion: blank means "no change", and the stored value is
  re-rendered.
- **A dead enemy's turn stalled the crawl strip on nobody.** The strip drops
  defeated enemies while leaving them in the combat tracker (the tracker is what
  end-of-combat loot and the session recap read), so when the turn pointer landed
  on one, every card dimmed and none lit — it read as nobody's turn until the GM
  worked out they had to click past a corpse they could no longer see. Those
  turns now skip themselves, on exactly the rule that hides the card: no card, no
  turn. It fires whether the enemy was already dead or dies partway through its
  own turn, and PCs are never skipped — a downed PC keeps its card and its turn.
  Foundry's own **Skip Defeated** setting is not a substitute: it only knows the
  tracker's defeated marker, and Shadowdark 4.x stamps that from one place,
  `applyDamage`. An enemy dropped to 0 HP by a sheet edit or an effect gets no
  marker at all on a plain install, and where a companion module restores the
  old auto-marking it arrives a beat late and only on the GM client that made
  the change — so the skip reads HP, which is already true when the card
  disappears. If *every* remaining combatant is dead the pointer stays put
  rather than rolling rounds forever.
- **Monster token art never applied on a server the module was installed on.**
  Applying token art reported success — *"Applied token art to 213/244
  monsters"* — while a server error appeared alongside it and no art changed.
  The generated art mapping was written to the module's `data/` folder, which
  ships in no release, and Foundry does not create a missing upload target: it
  raises an error and reports failure *without throwing*, so the module carried
  on, switched the compendium overlay on, and pointed it at a file that had
  never been written. The directory is now created first, a failed write is
  treated as a failure rather than announced as a success, and the mapping has
  moved to the module's `storage/` folder — the one directory a module update
  preserves. Previously the mapping was wiped by every update, so token art
  silently reverted until someone thought to re-run Apply; existing mappings
  are migrated to the new location automatically on load. **This changes the
  manifest, so relaunch the world** (a browser reload is not enough) and, if
  your art had stopped applying, run Apply once more.
- **Importing a class glued the page's own header into a feature's rules
  text.** Every Delver's Scavenger read *"…you regain one use of that item.
  Delver Class"*, and it was not just the Delver: all nine Western Reaches
  classes carried it. Book pages print the class's name as a running header,
  and where that header falls in the page's column flow decides what it damages
  — seven classes had it glued onto the end of a feature (Duelist/Parry, Green
  Knight/Rooted, Kyzian Archer/Kyzian Quiver, Monk of Yag-Kesh/Fist of the Moon
  God, Necromancer/River of Death, Paladin/Inspiring Presence), and two had it
  land in the class's flavor text instead (Roustabout, Wyrdling). It is
  title-case prose, so it read as an ordinary sentence rather than as a caption.
  The header is now dropped wherever it appears; parsing is otherwise
  unchanged, byte for byte, across all nine classes. The sweep needed the class
  name to find the header, though, and one page does not hand it over: on the
  Duelist page (Western Reaches pg 42, reprinted in City of Masks pg 15) the
  header prints in the middle of a column, so a copied page *starts* with the
  flavor. Pasting one into the Importer Hub named the class "Spinning swordsmen
  and fast-", dropped that line from its flavor, and left Parry reading *"…that
  would hit you misses instead. Duelist ClassDuelist Class"*. The name now comes
  out of the header itself when the heading isn't the first line, and a header is
  recognised by its shape whichever way the name was resolved — so a bare page
  paste imports the same as one started from an Unlock button.
- **Class features ended with the page's parting quote.** The last feature on a
  class page ran on into the flavour quote printed at the bottom — the Duelist's
  Taunt closed with *"Have I told you about the time I defeated a baron…"*, the
  Roustabout's Surprising Guts with *"I knew I should have stayed home today!"*,
  and the Necromancer's River of Death with a half-swallowed *"The dead don'"*.
  The quote and its attribution are ordinary prose, and the talents caption that
  sits between them and the feature had already been claimed by the talent
  table, so nothing marked the end of the rules text. A line that opens with a
  quote mark now closes the feature list, which is where the page ends anyway.
- **Every new Duelist rolled up holding a free Rapier and Falchion.** Character
  creation issued both, 20 gp of swords, before the player had spent a copper.
  Some classes come with a weapon that is part of the character — the Wyrdling's
  Pseudopod, the Monk of Yag-Kesh's Strike — and the module ships those so they
  land on the sheet at creation. It also ships stat lines for the Western
  Reaches weapons a class can wield, purely so the wield list and the merchant
  know what a Rapier is; those had been going out as gifts too, which also
  handed the Paladin a Lance and the Necromancer a Stave. The two kinds are now
  told apart: natural weapons are still granted, priced gear goes on the shelf
  to be bought. Classes already imported are corrected on the next world load,
  with no re-import — an existing character keeps whatever is on their sheet,
  since by now they may well have paid for it.
- **The class importer said "text only" for talents it was about to wire.** A
  talent-table row whose mechanics the module supplies rather than the book —
  the Delver's *"You gain 2 gear slots and an additional Trusty Gear"*, which
  imports as Deep Pockets with a working +2 gear-slot effect — was labelled as
  plain text needing hand-wiring. Rows like that now read **real talent**, and a
  row that only gets a name and no effect says so instead of claiming no talent
  matched.
- **A feature's bullet list flattened into a run-on in the import preview.** The
  Delver's Trailblazer lists five things you have advantage on; the preview
  showed every word but none of the structure, which reads like a broken import.
  The preview now keeps the paragraphs and bullets the parser found.
- **Unlocking an ancestry's names imported six rows of prose instead of a
  hundred names.** Every Western Reaches ancestry — Dwarf, Elf, Goblin,
  Half-Elf, Half-Orc, Halfling, Human, Kobold — unlocked into a broken card
  flagging *"values 3, 6-8 have no row"*. Those pages print the names table's
  `d10` column down the middle of two columns of prose, so a straight read of
  the page interleaves them: four of the ten faces come out glued to a sentence
  (`ORIGINS 3`) and only the six bare ones survive as rows. The names themselves
  were never read at all. The importer expands these tables from their two
  syllable columns — 10 prefixes × 10 suffixes = a d100 of whole names — but it
  only recognised the two shapes a **clipboard** copy produces, and the module's
  own page reader emits a third: both column labels joined onto one `Part 1
  Part 2` line, and each row joined into `Den- -dor`. That shape is now
  recognised, so an unlock claims the whole block — the stranded die faces
  included, which is what stops the prose table being minted beside the real
  one — and yields the full hundred: *Dendor, Dengrim, Denror…*
- **Every ancestry's Trinket table ended result 49-50 with a line from the
  page.** Rolling a 49 or 50 gave you *"Goat hair blanket PCs may start with one
  trinket; it is free to carry."* Those tables print in two columns, and the
  book sets that aside in the gap between them — so it lands between column
  one's last row and column two's first. The importer strips the caption and the
  repeated `d100 Details` header that mark the column break, and once those are
  gone the aside is indistinguishable from a row that wrapped onto a second
  line, so it folded onto the row above. A line stranded in that gap is now
  dropped with the header it belongs to. A genuinely wrapped row is still
  joined: a wrap resumes mid-phrase, uncapitalized and unpunctuated, where an
  aside is a whole sentence.
- **…but that drop was too eager, and could swallow a table's footnote.** As
  first written it stripped a stranded line above *every* piece of page
  furniture it removed — including bare page numbers, where the line above is
  ordinary table text rather than an aside. Only a repeated caption strands an
  aside, so the drop now happens there alone. It is also no longer silent: when
  a line is removed this way the strip note names it, because a row that wrapped
  at a sentence boundary looks exactly like an aside and nothing in the text can
  tell them apart. If it was table text, paste it back.
- **Another module's name tables made an ancestry look already imported.** With
  a third-party ancestry module installed, *Elf Names* showed up pre-imported
  and pointed at **Character Names: Shadow Elf** — a d20 table from *Unnatural
  Selection* — so the row could never be unlocked and opening it gave you
  someone else's names. Ancestry name tables import under their own convention,
  *"Character Names: `<Source>` `<Ancestry>`"*, and the check for one only asked
  whether an existing table's name **ended** with the ancestry. Nothing looked at
  what came before it, and a world with extra ancestry content in it is full of
  names that end in *Elf*. The part before the ancestry now has to name a book
  the module actually knows — and, when the check is asking on behalf of a
  specific book, *that* book. This also fixes a quieter case with no third-party
  module involved: *Half-Elf* ends in *Elf*, so importing Half-Elf's names used
  to tick Elf's row off too.
- **An ancestry's names took the wrong name when pasted with its trinkets.** A
  names table borrows its ancestry from a neighbouring caption, but only ever
  matched the plural *"Trinkets"*, while the caption the books actually print is
  singular. The result was a table called *"Western Reaches - Goblin Trinket
  Names"* — which the ancestry sheet's **Random Name Table** dropdown does not
  list, because it only shows tables named *"Character Names: …"*. Both
  spellings now resolve, as does a page that splits the caption in two (a
  `DWARF` heading at the top and a bare `NAMES` above the table), so the table
  arrives as *"Character Names: Western Reaches Goblin"* and shows up in the
  dropdown.

## [0.15.0] — 2026-08-17

### Added
- **The Crawl Order tab is now the combat tracker, for a party out of combat.**
  It was a plain list with three buttons; it is now the same tool your table
  already knows. The rows are core's own tracker rows — portrait, name, and an
  initiative box the GM can type into — so a member with no roll yet offers the
  **same d20 button** the combat tracker does, and the character holding the
  turn gets combat's own highlight rather than a lookalike. The footer is
  combat's too: **previous round · previous turn · End Crawl · next turn · next
  round**, with a player seeing a single **End Turn** button while the turn is
  theirs. Clicking a row selects that character's token. Two of those controls
  are new to the module: stepping the turn *back* (which steps the crawl round
  back with it when it crosses the top of the order, so an accidental advance
  undoes cleanly) and stepping the crawl round back on its own — a counter
  correction only, which deliberately does not un-refill movement or un-roll an
  encounter check, because neither of those can be taken back. Matching the look
  is not a copied stylesheet: the tab wears core's `combat-sidebar` class and
  renders core's markup, so it inherits Foundry's tracker styling and any theme
  applied to it.
- **The out-of-combat order now has a sidebar tab of its own, under Combat.**
  Foundry tracks turn order in the sidebar and has nothing there for a party
  moving out of combat, so the rolled order only ever existed on the crawl
  strip — fine while you are looking at the map, less so when the strip is
  behind a window or you simply expect turn order to live where turn order
  lives. A **Crawl Order** tab now sits one icon below **Combat**, listing the
  order as portrait, name and initiative: the current turn-holder outlined in
  the accent colour, anyone who still owes a roll dimmed with a `—` where their
  number will go, so it is obvious at a glance who is holding the round up. Its
  header carries the same three controls as the strip — roll for everyone
  unrolled, advance the turn, reset initiative — under the same rules, so a
  player sees the advance only on their own turn and the GM's controls appear
  only when they would do something. Right-click the icon for a floating copy,
  as with any core tab. The tab exists only while a crawl is running: end the
  crawl and the icon goes too, handing the sidebar back to Chat if you were
  looking at it. It is a second view, not a second tracker — rolling on the
  strip fills the tab, advancing in the tab moves the strip's highlight.
- **Roll out-of-combat initiative for the whole party in one click.** Starting a
  crawl round meant clicking each card's d20 in turn, and with five or six
  members that is five or six clicks to reach a state the strip only acts on
  once *everybody* has rolled. The GM now gets a dice button above the round
  number, in the same column as **Next Round**, that rolls for every member who
  hasn't rolled yet — one chat card each, through the same system roll path and
  the same `1d20 + DEX + initiative bonus` as the per-card dice, so the totals
  are indistinguishable from rolling them one at a time. Members who already
  have a number are skipped, which makes it safe to press again after a
  latecomer joins the roster. It is GM-only (a player rolls their own card), it
  appears only while somebody still owes a roll, and it leaves as the last roll
  lands — the same reason each card's dice gives way to its rolled number.
  **Reset Initiative** brings it back with the cards' own dice. A second click
  arriving while the batch is still landing is refused rather than queued, so a
  double-click cannot roll anyone twice.

### Fixed
- **The GM's out-of-combat advance arrow was a dead button before the party had
  rolled.** It sat in the crawl badge from the moment a crawl started, but there
  is nothing to advance until every member has an initiative — clicking it did
  nothing, gave no reason, and read as a broken control rather than an
  unavailable one. It now appears only once the order is live: every member
  rolled, and somebody holding the turn. That is the same condition the movement
  lock engages on, so the arrow and the lock arrive together. The player side is
  unchanged — a player still sees it only while the turn belongs to a character
  they own, and the GM still re-checks that ownership when the request lands.

## [0.14.0] — 2026-08-16

### Security
- **Any player could act as the GM, on any character, in nine more handlers.**
  The same flaw the downtime fix below closed ran through the whole module: every
  player action travelled on the raw module socket, which authenticates nothing,
  and the GM authorized it from a `userId` field inside the message. Because
  Foundry's `testUserPermission` returns OWNER unconditionally for a GM, and
  `game.users` is readable by every client, a player naming any online GM's id
  passed every ownership check there was. Live-verified on 14.365 from a real
  player account: one socket message spent another character's coins and put the
  goods on their sheet. The same trick could sell another player's magic sword,
  claim loot onto a character you don't play, take a luck token off someone
  else's sheet and put it on your own, and teleport any token on the map back to
  its turn-start position. Shop buys, sells, catalog buys and gambles, loot and
  coin claims, item drops and pickups, luck-token gifts and movement rollbacks
  now travel as Foundry user queries, where the server states who sent the
  message, and every one of them requires the sender to own the character (a GM
  may still act for anyone). **GMs must reload their Foundry tab after
  updating.**
- **Item drops were worse than the rest: naming the GM skipped the entire
  check.** The drop handler guarded its authoritative re-read with "unless the
  sender is us", so a message claiming to be from the GM did not merely pass
  validation, it deleted it, and the payload's own item data was baked into a new
  world Actor and a Scene Token. Both are documents a player cannot create.
  Live-verified: a player account created an actor and a map token of its own
  naming and artwork. The item is now always re-read from the source character
  and the quantity always clamped to the stack that is actually there, with no
  "skip when it's us" branch left to impersonate into. A drop carrying no source
  character (the Loot Generator's *Drop on Ground*) is GM-only, because there is
  nothing to re-read.
- **One player could block every other player's actions, with a message blaming
  the GM.** The stale-tab handshake asked over a broadcast, so every client saw
  another client's ping, and nothing checked that the answer came from a GM.
  Live-verified: a listener on one player account made four of five probes from
  another client report *Your GM's Foundry tab is running Shadowdark Enhancer
  0.0.0 and yours is 0.13.1*, freezing loot claims, purchases and downtime while
  the GM was demonstrably current. Reloading did not help, because the attacker
  answered again. The ping and pong are gone: a query that the GM's build cannot
  answer is itself the stale-tab signal, and it comes from the server.
- **Any client could publish a fake price list to the whole table.** The
  shop-availability broadcast carried the entire inventory and every client
  acted on it without checking who sent it, so a player could push a price list
  into everyone's window. The Buy button stayed real: the victim clicked
  expecting 1 gp, the GM charged the true price, and the victim's own coins
  moved. The transaction-result broadcast was forgeable the same way, firing an
  invented "X bought Y for Z" on every screen. Availability is now a
  payload-free "the setting changed, go re-read it" nudge, so a forged one
  achieves an idempotent re-read of what the GM actually saved, and transaction
  notices are sent to each player over the authenticated channel, where the
  receiving client can confirm a GM really sent them.
- **A player could sell into a shop the GM had never opened.** Buy, catalog buy
  and gamble all refuse when there is no live shop; sell read the ratio through
  a `?.` that swallowed the missing context and completed at the default 50%.
- **Luck-token gifts were processed twice in a two-GM world.** The handler
  checked "am I a GM" rather than "am I the GM doing the work", so a world with a
  second connected GM ran it on both clients. In pulp mode the giver was charged
  twice for one gift. Every player action now confirms this client is the primary
  GM before acting — which matters more than it first appears, because the sender
  of a query chooses who receives it. A player could otherwise send the same
  request to each connected GM in turn and have it performed once per GM: two
  luck tokens debited, two claimed items created, two dropped tokens, two
  rollbacks. Worlds with an assistant GM or an always-on watchdog client were
  exposed to that on every relayed action, not just luck.
- **A player could settle a downtime attempt with somebody else's dice, or with
  their own dice from an hour ago.** The GM read the roll total off whichever
  chat message the incoming payload named, checking only that the same user had
  authored it — not that the message was a downtime roll, belonged to that
  character, that activity or that attempt, nor that it had not already been
  used. Any earlier high roll settled the attempt; live testing turned a 25 on an
  out-of-combat initiative roll into a success against DC 12. Each pick now mints
  a one-shot token that the **Roll it** button stamps into the roll message
  alongside the character and slot; settlement checks all three, checks the
  message speaks as the same character, and spends the token so it cannot be
  offered twice. A refused roll writes nothing at all — no fee, no ladder
  progress, no result, no card.
- **Downtime actions took the sender's word for who they were.** Picks, rolls and
  effect choices travelled on the raw module socket, which authenticates nothing,
  and the GM authorized them from a `userId` field inside the message. Naming the
  GM's id passed every ownership check, so any client could resolve another
  character's pending reward; the roll path had no ownership check at all. The
  three actions now travel as Foundry user queries, where the server hands the
  GM's client the sender's real identity, and every one of them requires the
  sender to own the character (a GM may still act for anyone). **GMs must reload
  their Foundry tab after updating** — a tab left open on the old build keeps the
  old listener alive until it does.

### Fixed
- **A card's action menu stopped opening once the strip redrew underneath it.**
  The menu panel is a child of the strip, so any redraw — an item update, a
  combat turn, a character taking damage — deleted the panel while the code went
  on believing it was still open for that character. Hovering the same card then
  did nothing at all; the menu came back only after hovering some *other* card
  first, which reads as the strip having randomly stopped working. It now
  notices the panel is gone and rebuilds it.
- **Saving a session threw away its downtime and renown.** The archive kept eight
  of the recap's arrays and silently dropped the rest, so a session you saved at
  the end of the night reopened from **History** with no downtime attempts and no
  renown changes — and exported to Discord without those sections too. Everything
  the window can show is now archived. The end-crawl prompt also counts them when
  deciding whether to offer **Discard**: an evening of nothing but downtime and
  carousing used to look like an empty session.
- **Two GMs awarding renown at once lost one of the awards.** Renown is adjusted
  by reading the current value, adding the change and writing the sum back, and
  "GM-only" is not the same as "one client" — a world with an assistant GM, or
  with an always-on watchdog client, has more than one. Both would read 5, both
  would write 6, and two separate `+1` awards left the character on 6 with both
  of them written into the recap. Awards made on a GM client that isn't the
  primary one are now handed to the primary GM, which re-reads the character and
  applies the *change* rather than a total, one award at a time. The queue matters
  even with a single GM: saving a character waits on the server, so two awards
  fired in quick succession could overlap on one client too.
- **Renown claimed a carousing bonus the module never applied.** The wiki, the
  award dialog and the roster tooltip all said the bonus applies to reaction rolls
  *and* carousing event rolls. The first half was true — the Encounter Roller's
  **Recognised here** toggle adds it — but there is no carousing roll anywhere in
  the module for the second half to attach to, so nothing was ever added. The
  wording now says which one is automatic and which one you apply yourself. The
  numbers are unchanged.
- **Downtime training could advertise a free-text answer and then refuse it.**
  The three "new weapon or armor" slots record a descriptive Talent, so the
  option buttons are only what the gear packs happen to hold — but a name that
  wasn't in an index had nowhere to go, stranding a paid success. Those slots now
  carry `Not listed? Type it:` with a text box and a **Train with this** button
  under the presets. Typed names are trimmed, capped at 60 characters and
  stripped of markup before they become an item name and a chat line; the presets
  are unchanged, and no other slot accepts free text.

### Added
- **Wands and scrolls now cast from the crawl strip.** The strip's **Spells** tab
  listed only memorised spells, so a wand or a scroll — the way most of the party
  gets to cast anything — meant opening the sheet. Both now appear there: a wand
  lists every spell it holds, a scroll the one it carries. Each row is named for
  the *spell* and carries a small wand or scroll icon, with the item's own name in
  the tooltip, so `Fireball` off a wand reads apart from `Fireball` off a scroll.
  Clicking casts through the system's own `castSpell` with the item attached, so
  its rules still apply: the scroll is spent, a wand can break on a critical
  failure, and a non-caster may use both *if* the GM has ticked that character's
  **Allow all magic items** box. The tab follows the character sheet's own rule
  (`canUseMagicItems`), so a plain non-caster does not get one — the system would
  refuse the cast. What the character sheet hides, the strip hides — lost
  spells, burned-out wand charges, broken wands, and anything stashed or
  unidentified.
- **Out-of-combat initiative now holds a turn, not just an order.** A rolled
  order sorted the crawl strip's cards and stopped there, so the party knew the
  order and then tracked whose go it was out loud. The strip keeps the turn
  itself now: once *every* member of the crawl roster has rolled, the order goes
  live, the top of it takes the turn, and that character's card lights up with
  the same highlight combat mode uses — the strip reads the same either side of
  an encounter. A partial order is not an order. Nothing engages until the last
  member has rolled, so a party mid-roll is never half in a turn structure and a
  member who hasn't rolled is treated the way a token outside a combat is. The
  turn is kept against the character rather than the token, so it survives a
  scene change exactly as the order does, and it is cleared by **Reset
  Initiative** (right-click **Add Tokens** on the bar) and at both ends of a
  crawl.
- **The player whose turn it is can advance it.** Only the GM could move the
  table on, in combat and out, which made every player's turn end with a request
  across the table. An arrow now sits beside the crawl round number on the strip,
  and in combat beside the round badge. A player sees it only while the turn
  belongs to a character they own; a GM always sees it and may advance for
  anyone. The button is a filter on what to *show*, never the decision: a
  player's click travels to the GM as an authenticated Foundry query, and the GM
  re-reads the current holder from its own state and re-checks ownership before
  anything moves, so a message naming somebody else's turn is refused. A player
  may never advance across a round boundary — the last combatant's advance, or a
  turn order that would roll into the next round, is answered with *"The GM
  advances the next round."* — because rolling the round is a GM control that
  fires wandering-monster checks and movement refills. Refusals say which one
  they are (*"It isn't your turn."*, *"No combat is in progress."*, *"No
  initiative order is rolled yet."*) rather than failing quietly. An advance
  already in flight disables the button, and the GM client refuses a second
  advance of the same turn while one is still landing, so a double-click — or a
  player's relayed request arriving just as the GM clicks — still moves the
  table exactly one turn.
- **A full cycle of the party rolls the crawl round.** Advancing past the last
  character in the order wraps back to the top, and that wrap *is* the round: it
  advances the crawl clock, refills every member's movement budget and runs the
  wandering-monster check, the same as pressing **Next Round**. A one-character
  order rolls the round on every advance, since that character's turn ending is
  the whole cycle. Establishing the turn at the top of a fresh order is not a
  wrap and costs nothing. The crawl clock is called a **Round** everywhere now —
  the bar badge reads `Crawl · Round 3` — because a character's turn and the
  crawl's own clock were both called a turn, and with the party now taking turns
  inside a round the two needed different names.
- **Lock movement out of turn**, an opt-in setting, **off** by default. On, a
  player may only move the token whose turn it is: in combat, the current
  combatant; out of combat, the holder of the rolled initiative order. GMs are
  never locked, tokens outside the combat or off the crawl roster are never
  locked, and updates that don't change position — vision, light, elevation
  alone, flags — are never touched. Out of combat the lock needs a complete
  order and a live holder before it engages, and it fails *open* without them: no
  order and no holder mean no turn to enforce, and a lock that freezes the whole
  table because its own state is half-written is indistinguishable from a broken
  module. That does mean a member who never rolls keeps the lock off for
  everybody, which is a deliberate trade — the missing roll is visible on the
  strip as an unrolled card, where a silently frozen party is not.
- **Carousing now lands in the Session Recap.** Shadowdark Extras runs carousing;
  this module never did, so a night at the tavern was the one downtime activity
  that left no trace in the session log. Its results are now mirrored into a
  **Carousing** block on the renamed **Downtime & Carousing** tab, and into the
  **Copy for Discord** export. Both of that module's carousing modes are read —
  Original's d8 outcome with its single benefit, and Expanded's d8-to-XP with its
  d100 benefit and mishap rolls — detected from the results themselves rather than
  the mode setting, so a carouse rolled before the GM flipped that setting still
  reads correctly. Grouped per carouse rather than per player, because the tier
  and its cost were bought by the whole party. Nothing is written back: no rolls,
  no actor changes, no edits to that module's own Carousing Log journal. The block
  appears only when Shadowdark Extras is active with **Enable Carousing** on.
  Each carouse is *copied* rather than read live, because that module's overlay
  holds one carouse at a time and resetting it for a second round of the evening
  erases the first.
- **Carousing renown is attributed properly.** Shadowdark Extras now hands its
  carousing renown to this module rather than writing the field itself, so a
  mishap appears in the log as its own sentence — *"A nobleman overheard your
  joke"* — with a **Carousing** tag beside it, instead of as an anonymous
  adjustment. A module that cannot delegate can describe its write in the update
  options instead (`{ "shadowdark-enhancer": { renown: { reason, source } } }`),
  or pass `silent: true` for a data migration, which is a move rather than a
  change in anybody's fame. A hint is honoured only on a GM-initiated update: a
  player owns their own character, and an untrusted `silent` would otherwise hide
  a self-edit. Log rows now carry a provenance tag whenever a reason supplies the
  row text, so Carousing, Downtime and a GM's own award are told apart at a glance.
- **Renown changes made outside the module are logged too.** `system.renown` is
  the Shadowdark system's field, so the sheet's own input, a macro and other
  modules all write it — and the log recorded only changes routed through this
  module, which made it a record of our awards rather than of the character's
  renown. The case that bit in practice: **Shadowdark Extras' carousing** applied
  its renown with a bare `actor.update`, so a mishap reading "-3 renown" moved the
  sheet and left no trace. An `updateActor` watcher now catches any change we did
  not make and logs it as *Changed outside the module*, with no chat card, since
  whoever wrote the value already reported it. Our own awards are told apart by
  the ledger row riding in the same update, so nothing is logged twice.
  Carousing itself does better than that fallback: it now hands its changes to
  this module, so a carousing row reads as the mishap's or benefit's own wording
  tagged **Carousing** rather than as an anonymous adjustment — and removing a
  result posts a reversing entry instead of rewriting the row. The watcher remains
  the catch-all for sheet edits, macros, and older Shadowdark Extras builds.
- **A new character's renown is set from their Charisma modifier, without a
  click.** Previously the starting value existed only as a **Start at CHA mod**
  button somebody had to remember to press. The seed is attempted when the
  character is created and again the first time their Charisma changes, because
  the two ways a character arrives differ: the Character Builder and the level-0
  funnel write the abilities as part of creating the actor, while **Create Actor**
  makes a character on the model's default 10s and gets its real scores minutes
  later. A seed of exactly +0 therefore does not count as spent. It runs once per
  character ever, on the active GM only, and refuses any character whose renown is
  already non-zero or who already has a log entry — a stat fix or a curse late in
  a campaign cannot reset somebody's fame. New **Starting renown from CHA**
  setting, on by default. **Start at CHA mod** still works and now overrides both
  the setting and the once-only rule, for characters made before this existed.
- **Every renown change is now logged on the character, permanently.** The
  Session Recap only records while a session is running, so a change made between
  sessions — or with no recap started — survived only as a chat card, and chat
  gets cleared. Each character now keeps its own ledger: what moved, the total it
  produced, the reason, the source, the GM who applied it, the player who owned
  the character at the time, and when. Read it in the **Renown** dialog under
  **Renown log**, collapsed by default, grouped one section per player with their
  net change. The row is written in the *same actor update* as the number, so the
  two cannot disagree — a change that failed to apply leaves no row behind. Each
  character keeps its last 50 changes, since the log lives on the actor document.
  `renown.history(actor)` and `renown.historyByPlayer()` on the API.
- **Pit fighting, from Cursed Scroll 2.** A new **Pit Fighting** entry in the
  Crawl Bar's **Forge & Loot** menu sets a bout up in the book's order — the
  offer first, then the secret twist, and only then who steps up: roll the venue,
  roll the stakes against the **party's** average level, say whether it's a solo
  or group bout, settle the danger, draw the foe, and check for a twist. Each
  line can be rolled on its own or picked instead. The stakes go against the
  whole party because the offer exists before anyone volunteers; a fractional
  average rounds to nearest and shows you the unrounded figure beside it.
  **The danger level is yours** — the book gives the GM the stakes *and* the
  venue and then leaves the call, so the dropdown arrives pre-set to what the
  stakes suggest and changing it redraws the foe from the encounter table that now
  applies. **The twist stays hidden** until you press Reveal, including when it
  turns out to be nothing: a hidden line that always meant trouble would tell the
  table something. The one twist with a mechanical consequence — a donor raising
  the stakes — moves the *prize* table without making the fight deadlier, since
  the fighters accepted on the danger you already set. Afterwards, mark it won or
  lost, roll the prize for the tier actually fought for, and apply the fame, which
  goes through the same single renown write path as everything else. Documented in
  [docs/wiki/Pit-Fighting.md](docs/wiki/Pit-Fighting.md).
  The descriptions all come from **your own book**: venues, twists, prizes and
  foes are read out of the fourteen CS2 tables you import, and a table you haven't
  imported yet is **named in the window** with a link to the importer rather than
  filled in with wording of ours. CS2 prints no renown value for a bout, so the
  default is a point for a win and nothing for a loss, for you to change —
  deliberately not scaled by stakes, which would read as a rule that isn't there.
  Lethality is not automated: the danger level picks an encounter table, and what
  happens when a fighter drops stays a ruling at your table.
- **Pit fight foes go on the map.** The drawn encounter row is now read as
  creatures rather than left as a line of text, and a **Place** button drops them
  on the current scene one per click, walking the row in order and naming what
  the next click will drop. Names are matched the way CS2 writes them against the
  way Shadowdark files them — `Gt. centipede` finds *Centipede, Giant*, counts
  and the pg. 39 footnote star come off, and `Wyvern (chained)` looks for
  *Wyvern* while keeping *chained* as a note. A creature you don't own stays
  listed and marked, and Place puts down the rest.
- **An arena, as a scene — and it knows which venue you rolled.** An **Arena
  map…** button offers twelve bundled battle maps and builds the one you pick as
  a scene: the map on a grid sized to its own printed squares at 5 ft, darkened
  for a night bout. The maps offered *first* are the ones matching the venue you
  just rolled, under a heading carrying that venue's own text — roll a *luxurious
  private arena owned by a noble* and the private arenas sit at the top, already
  selected. Every other map stays right beneath under **Other maps**: the book is
  explicit that any scene of your own works exactly as well, so a venue you
  overrode must not lock away the map you actually want. Maps are named for the
  venue they stand in for rather than the product they were sold as, so the list
  reads *Large Arena* where the shop reads *Greybanner Coliseum*, and CREDITS.md
  lists the two side by side. Each map is its own scene and is reused every
  time after, so the map you dressed is the map you get back. The maps are
  2-Minute Tabletop's, used under CC BY-NC 4.0 (see CREDITS.md); the book prints
  no battle map of its own.
- **A two-level Tavern Cellar for the shadiest venue.** The lowest venue row is a
  *shady back alley or tavern cellar at night*, and the cellar half of that had
  no map — so it is on the list now like any other: pick it and you get a vault
  floor with, twenty feet above it, a fighting pit whose opening looks down into
  the vault below rather than onto blank colour. It is built on Foundry v14's
  native scene levels, with a *Cellar Stair* region spanning both floors, so
  walking a token onto the stair has Foundry offer to move it between them
  instead of you dragging it between two separate scenes. (Only on a **walked**
  move — a displaced or ruler-dragged token passes straight through.)
- **A pit fight now survives closing the window.** The bout is stored in the
  world rather than held in the window, so you can set the offer up, close it to
  run the combat on the map, and come back afterwards to the same stakes, venue,
  foe and fighters, with the prize still to roll. Previously closing the window
  threw the whole bout away — and since the reveal card carries only the twist,
  there was nothing left anywhere to say what the fight had been for. Only *New
  offer* discards it.
- **The census can see arena monsters now.** CS2's encounter tables are
  three-column creature grids typed `other`, so the monster census skipped them
  before reading a row, and their cells (`Rookie*`, `Canyon ape*`) are shapes its
  name scanner could not match. It now recognises creature matrices from the
  table manifest and reads their columns by position, so **Rookie**, **Hero** and
  **Canyon Ape** are reported under their source until you import them. Row text
  is also read from a result's `name` as well as its description, which is where
  authored tables actually keep it.
- **The Forge & Loot button says what is behind it.** Its tooltip still named the
  original three tools, so the five added since — Party XP, Downtime, Pit
  Fighting, Renown and Session Recap — were listed nowhere until you opened the
  menu. It names all eight.
- **Renown, the fame track.** The number was already on the character sheet —
  the system owns `system.renown` — but nothing read it. It now means something.
  A new **Renown** entry in the Crawl Bar's **Forge & Loot** menu opens a GM
  dialog listing every party character with their renown, the band it puts them
  in (`≤3` Unknown, `4–7` Locally known, `8–11` Known name, `12+` Celebrity),
  what that band means at the table, and the `+0` / `+1` / `+2` / `+3` bonus it
  grants. Award or dock from the same dialog with a reason, with the book's
  triggers offered as suggestions, or press **Start at CHA mod** to set a
  character's starting value. Renown has no floor and is allowed to go negative.
  Gaining a level is the one trigger wired automatically, controlled by the new
  **Renown on level-up** setting; reaching level 1 is excluded, since character
  creation writes it. Every change — a GM award, a level-up, or one of the two
  Downtime outcomes that move renown — now goes through one write path, posts a
  chat card and is logged to the Session Recap, whose **XP** tab is now
  **XP & Renown** and whose Discord export gains a `## Renown` section. New API
  namespace `game.shadowdarkEnhancer.renown`. Documented in
  [docs/wiki/Renown.md](docs/wiki/Renown.md).
- **The Encounter Roller can add a renown bonus to a reaction roll.** Under the
  CHA stepper, a **Recognised here** toggle and a picker for whose renown
  applies, defaulting to the party's most renowned character. The toggle is
  **off by default**: a character adds the bonus only somewhere they would
  plausibly be known, so it stays the GM's call per roll rather than an
  automatic add. When it is on, the result card and the chat card both show the
  arithmetic and the reason (`Renown +2 — Eliara is Known name here`).

- **An activity nobody can pay for cannot be picked.** A slot whose fee is
  beyond the character's purse renders dimmed with the shortfall spelled out,
  for example `Costs 50 gp per attempt — you're 19 gp 9 sp short`, and its
  **Choose** button is dead. Free slots are never blocked. The block lifts on
  its own when the character gains the coin, with no reopening. The same check
  runs again when the die is pressed, since a purse can empty in between: no
  fee, no roll, and the pick survives so the character can try once they can
  pay. Previously the dice were rolled and posted to chat before the fee was
  found wanting, which read as a roll that simply did not count. There is no GM
  override on any path, including picking or rolling for an absent player. The
  remedy is to add coin to the sheet.
- **Downtime, the between-crawls activity window.** A new **Downtime** entry in
  the Crawl Bar's **Forge & Loot** menu opens a
  window covering the 25 downtime activities across **Spiritualism**,
  **Skulduggery**, **Martial Training** and **Magical Research**. Pick a book,
  pick a character, press **Attempt**: the fee is taken from their purse
  *before* the roll (per attempt, win or lose, per RAW), the check is rolled at
  Advantage / Normal / Disadvantage, and a chat card reports the total against
  the DC with the outcome. **Every row names its own ability and DC** as a chip
  (`CHA DC 9`, `DEX DC 15`, `INT/STR/DEX DC 15`, `Spellcasting DC 12`), because
  the section header can't speak for Skulduggery, which mixes CHA and DEX rows
  in one activity. A **failed attempt walks that slot's DC one rung down
  the ladder** (`9 · 12 · 15 · 18 · 20`) for the next try and a success resets
  it, tracked per character and shown on the row as `DC 12 (was 18)`, with a
  **Clear DC progress** button to wipe it. Activities gate themselves: Martial
  Training is tiered by class hit die (d4 / d6 / d8+) behind a **Training tier**
  dropdown that defaults to the character's own, labelled `d4 — this character`,
  and Magical Research is hidden for non-casters and prints **both** of the
  book's subsections under their real headings, **INT or CHA Spellcasters** and
  **WIS or CHA Spellcasters**, with the inapplicable one visible but dead and
  its reason beside the heading. A CHA caster belongs to both
  lists in the book, so that character gets an **Arcane** / **Divine** toggle
  that decides which subsection is live,
  remembered on the actor instead of a guess. Successes worth renown or XP offer
  an **Apply** button rather than writing silently, and the rumor result offers a
  signed **+1** / **−1** pair plus a party dropdown, because a rumor can cut
  either way. Every card carries the line *"Luck tokens cannot be spent on
  downtime checks."* Downtime fees are mirrored into the Session Recap as
  `Downtime: <slot label>`. New API namespace `game.shadowdarkEnhancer.downtime`.
  Documented in [docs/wiki/Downtime.md](docs/wiki/Downtime.md).
- **A GM can set the DC credit by hand.** Beside every row's DC there is now a
  **−** / **+** stepper, GM-only and never shown to players. **−** grants one
  rung of credit, **+** takes one back, and both clamp to the same ladder bound
  the automatic failure walk uses, so a hand-set DC can never leave the ladder.
  The row still reads `DC 15 (was 18)`, so credit is always visible rather than
  buried in a flag. This is for the attempt that happened away from the tool: a
  failure rolled in play, or a session you ran straight from the book, should
  still walk the ladder down, and a ruling you want back should not cost you that
  character's whole history via **Clear DC progress**. Automatic step-down on
  failure and reset on success are unchanged.
- **Browse any Martial Training tier.** The **Training tier** dropdown lists
  **d4**, **d6** and **d8+**, defaulting to the character's own tier and marking
  it `d4 — this character`. A GM may attempt any tier. A player may switch to
  read another one, but its controls stay dead with the reason naming the tier
  they actually train at, so browsing never becomes taking. A hit die the module
  can't read still refuses to guess: every tier shows, all dead, with the note
  saying why.
- **The downtime log, in two places.** Every resolved attempt is now recorded.
  The [Session Recap](docs/wiki/Session-Recap.md) gains a **Downtime** tab
  holding one row per attempt, grouped by controlling player and newest first,
  each group carrying a `2/3 · 30 gp` subtotal of what landed and what it cost,
  and it exports under its own **Downtime** heading in the Discord markdown.
  Separately, a persistent world JournalEntry called **Downtime Log** collects
  the same attempts beyond the session, at the Journal root with no folder,
  created GM-side the first time anything is recorded, grouped under a heading
  per real-world day with **newest day first and newest row first within a day**.
  It is found by an internal flag and never by name, so renaming it is safe and a
  journal you happen to name the same is never adopted. Deleting it is safe too:
  the next attempt makes a fresh one. Logging runs **after** the result is
  committed, so a logging failure can never cost somebody a paid roll, and an
  attempt still owing an effect choice is logged as it rolled rather than waiting
  on a pick that may never come. **The fee mirror into Purchases stays**, which
  is deliberate double entry: Purchases is the money ledger that feeds the spend
  totals, the Downtime section is the narrative record of what was tried.
- **Downtime at the table: everyone picks, everyone rolls.** The GM presses
  **Start session** and picks the book, which pins for the whole table. A chat
  card announces it with an **Open Downtime** button, and players open their own
  window (their own characters only). Each slot row now prints its **full
  unlocked outcome text**, so a player reads what an activity does before
  committing, then presses **Choose**. Advantage is declared at pick time, not at
  roll time. The GM presses **Lock & unlock dice** and every player gets a
  **Roll it** button. **The dice are the player's own**: the roll executes on
  their client under their speaker, so their dice colours and roll history are
  the ones that show up, and only the message id travels back. The GM side then
  reads the total off the chat message and recomputes DC, cost and gating from
  the skeleton, never trusting a number from a player's payload. A live panel
  shows every character's pick, their declared advantage and their result, with
  **Clear** to drop a pick, **Re-open picks** to go back a phase, **Roll for** to
  cover an absent player (the card is marked `(rolled by the GM)`) and **End
  session**, which greys the announcement card to **Downtime ended**. Working
  solo without a session is unchanged. New world setting `downtimeSession`
  (internal, not in Configure Settings) and five new API entries:
  `startSession` · `endSession` · `lockRolls` · `releaseRolls` · `sessionState`.
- **Downtime outcomes now actually happen.** Inside a session a success is
  applied rather than described. Straight away: renown for church favor and
  rumor (with a target picker, since a rumor cuts both ways), **+2 XP** which
  also raises Shadowdark's own level-up prompt once the character is at the
  threshold, the two "advantage on your next…" outcomes as real labelled Active
  Effects (the divine one carrying 3 uses, and neither self-decrementing, so
  deleting it stays a deliberate act), the Potion of Healing, and the extortion
  swing. Where the book asks you to choose, the result card asks too. Weapon
  training writes real attack and damage effects onto the weapon you name and
  records what it granted, so the same award can't land on the same weapon twice.
  The damage-die step edits the weapon itself, capped at d12 and twice per weapon.
  Training with something new creates a `Training: <name>` Talent, free text
  allowed, because Shadowdark has no proficiency field to set. Create
  scroll / wand / potion fabricates the real item, with a wand refused while an
  unbroken one of that spell is carried. The spell trade swaps an embedded
  spell for a same-tier replacement in one click. **An option you can't take is
  greyed out with its reason on hover, never hidden.** Outcomes Shadowdark models
  no mechanic for (lay low, hide out, both crimes, the talent reroll, cleansing
  with no flagged curse) print a GM-adjudication note instead of faking one.

- **Downtime outcomes unlock through the Importer.** As everywhere else, no
  sourcebook prose ships. The module carries the skeleton only (activity names,
  compressed slot labels, DCs, which slots cost gold, and the renown or XP a
  success is worth) and every outcome sentence comes from a GM paste. The
  Importer Hub gains a **Downtime** import type: pick the **Book**, paste the
  pages from your own copy, **Parse** to read `Matched 25 of 25 slots.`, then
  **Unlock outcomes**, which confirms with
  `Downtime (Cursed Scroll 6): 25 of 25 entries unlocked.` It is the one import
  type that writes a world setting (`downtimeContent`) instead of creating
  documents, and the one **Auto-detect** deliberately does not recognise, so a
  downtime page pasted under Auto lands in **Skipped**. The parser matches inside
  each activity's own block and has a rescue pass for the interleaving that
  two-column PDF copies produce, and it never assigns a line by resemblance.
  Anything it cannot place is listed back to you under **Lines nothing claimed:**,
  alongside **Still unfilled:** for the slots that got no text. Pasting the wrong
  book is caught by the authority wording (*Cursed Scroll 6* says City Guard, the
  *Western Reaches* says authorities). The hub's Manage tree gains a **Downtime**
  node with one row per book, showing a state chip (`Unlocked (25/25)`,
  `Partial (12/25)`, `Locked`) and an **Unlock** button that seeds the paste flow.
  Double-clicking an unlocked row opens the Downtime window. Re-unlocking a book
  replaces that book's stored text and leaves the other book alone. The two books
  differ on price (`10 gp × level` per attempt in Cursed Scroll 6, a flat `50 gp`
  in the Western Reaches) and on one slot, minor crime, which the Western Reaches
  does not charge for.
- **A locked book shows its title and nothing else.** The Downtime window no
  longer renders locked material greyed out. A book you haven't imported is a
  single card carrying the title, its page cite, and an **Unlock via Importer**
  button that opens the hub pre-seeded. No activity sections, no slot labels, no
  DCs, no costs, because an outline of a book's tables is still a reading of that
  book's tables. With nothing imported the window body is just those cards, header
  and footer included. A partial unlock shows what came through plus one count
  line (`N entries did not unlock.`) and never names what is missing. The Manage
  tree follows the same rule and reports counts only.

### Fixed
- **Double 1s on a reaction roll are now always hostile.** The rule was never
  implemented: a raw `2` with a `+5` CHA modifier came out *Suspicious*. It is
  now applied before the band ladder, so no modifier can rescue it, and the
  roller says why on the card.
- **A player's action no longer vanishes into a GM tab running old code.** Loot
  claims, shop transactions, downtime picks and rolls, and item drops all get
  handled by the **active GM's** client. A GM who had left a tab open since
  before the module was updated was running a build with no listener for the
  newer actions, so a player's click landed nowhere: nothing threw, nothing
  logged, the button just did nothing. Every one of those relays now pings the
  active GM and compares module versions *before* sending. A stale tab, a
  mismatched version, or no GM online, and the player is told —
  *"Your GM's Foundry tab needs a reload before downtime actions can land."* —
  naming both builds when the versions differ. A proven GM is cached briefly so
  a burst of clicks costs one round trip; a failure is never cached, so the very
  next attempt after the GM reloads goes straight through. A blocked loot claim
  hands its button back rather than leaving the item looking claimed. Only the
  **active** GM answers the ping, so an always-on second GM client can't vouch
  for a stale one. Luck-spend logging is deliberately left unguarded: the reroll
  has already happened on the player's own client, so a stale GM costs one line
  in the Session Recap rather than a lost action.
- **PDF text extraction could quietly move a word between columns.** Column
  detection looked for the widest empty band in a histogram of word *centres*,
  and a column's ragged right edge leaves exactly the same gap a gutter does —
  so on a page whose left column runs short, the split landed inside that column
  and handed its last word to the other one. The page still read cleanly and
  still parsed to a perfect score; only the stored text was wrong. Detection now
  measures where the page's *ink* actually is, which tells a ragged edge (still
  crossed by the long lines above and below it) from a real gutter (crossed by
  nothing but the odd full-width heading). Checked page by page across all seven
  books, it now agrees with an independent second opinion on 343 of 642 pages
  where the old code managed 210, and it splits far fewer pages that should have
  been left whole. Grabbing text also warns you now when a split runs through
  words or sits well off the page midline, so a doubtful page says so instead of
  failing silently.

### Changed
- **The Merchant Shop honours a downtime extortion.** A character who succeeded
  at **Extortion: 25% price swing** gets **25% off** their next purchase **or**
  **25% more** for their next sale, whichever comes first. It is armed on the
  character rather than the shop, so it never reprices anything for the rest of
  the party, and it is spent only once a transaction has actually landed (a
  purchase refused for want of funds leaves it armed). Both the charged price and
  the transaction's chat card name it.

## [0.13.1] — 2026-07-26

### Changed
- Added the prescribed Shadowdark RPG Third-Party License attribution to the
  shipped README and credits.

## [0.13.0] — 2026-07-26

### Fixed
- **Boat sheet edits weren't saving.** The sheet's template wrapped its fields
  in a second `<form>` inside ApplicationV2's own form, which disconnected every
  input from the save handler — so lowering a boat's HP (and everything else)
  reverted on close, and the damage-derived Repair cost never moved off 0. The
  template root is now a plain container, so edits persist. The window's built-in
  Toggle-Controls and Close icons were also invisible (blacked out by the sheet's
  dark-ink rule) and are now light on the dark title bar.

### Changed
- **Boat properties match the Western Reaches book exactly.** The property list is
  now Crew / Fast / **Row Galley** / Unseaworthy / Weapons — CS3's *Oars* and
  *Portage* are gone (WR dropped them). Existing boats migrate automatically (the old
  `oars` flag becomes Row Galley; Portage is removed), so nothing is lost.
- **Only siege weapons appear on a boat's Weapons tab now.** Mounted weapons are
  classified by a flag, not by item type, so ordinary weapons carried aboard stay in
  Cargo instead of masquerading as siege weapons. Dropping a weapon onto the Weapons
  tab mounts it as a siege weapon (home-brew welcome); non-weapons are turned away.
  WR's limits — up to two siege weapons, trebuchets on galleons only, a Weapons
  property to mount — warn but don't hard-block (the GM adjudicates). Actor/item names
  in the attack dialog and chat cards are HTML-escaped, and a boat keeps a single
  captain (assigning a new one steps down the last).

### Added
- **Crew roles on the boat sheet — Captain & Gunner.** Each occupant on the
  Passengers & Crew tab gets a role selector (Passenger / Captain / Gunner / Crew),
  shown as a badge. The **Gunner** is auto-selected as the operator when you fire a
  siege weapon. **Captain, Gunner, and Crew** all count toward the boat's *4+ trained
  crew* requirement (plain Passengers don't); the Overview shows the **Crew aboard**
  total — assigned working occupants plus a **Hired crew** number for abstract NPC
  hands — and warns when a vessel is short. The **Captain** appears in a new **Command** box on the Overview with a
  **Right the ship** button — an *optional Cursed Scroll 3* rule (Western Reaches
  boats sink rather than capsize), clearly labelled as such: a DC 20 STR check
  rolled with the captain's STR, at advantage for a Sea Wolf captain (**Seafarer**).
- **Import the Western Reaches siege weapons + mount them on boats.** The four
  siege weapons (Ballista, Catapult, Crossbow (heavy), Trebuchet — *WR p119*)
  import through the standard paste → preview → commit flow as Shadowdark
  **Weapon** items in `sde-items` (Importer Hub → Manage → **Vehicles → Siege
  Weapons**). As with every unlock, no stats are bundled — the table is read from
  your own WR PDF. Each import also materializes the **Blast** and **Exploding**
  weapon properties (real Property items, so they list on the weapon sheet, with
  the rule text read off the page) and a **Siege Weapon Ammunition** item (1 gp,
  2 slots) the weapons point at. The Boat sheet gains a **Weapons** tab: drag a
  siege weapon from a compendium onto it to mount it (kept out of the Cargo tab),
  and each mounted weapon has **Attack** and **Damage** roll buttons, so a boat
  fights with its weapons like any other actor. **Attack** rolls as a crew member:
  add the operator to the boat's Passengers, then Attack rolls `1d20 +` that
  actor's Shadowdark ranged attack bonus (their DEX modifier, plus any attack
  bonuses) — matching the designer's ruling that the operator uses their ranged
  attack bonus. The Attack dialog also picks a roll mode (**Normal / Advantage /
  Disadvantage**); the untrained-**Disadvantage** option supports Kelsey's house
  rule that a character not proficient in all weapons fires a siege weapon at
  disadvantage. **Damage** rolls the weapon's own die, including multi-die
  formulas (e.g. a siege 3d6).
- **Import the Western Reaches boats as ready-made Boat actors.** The Importer
  Hub's Manage tree gains a **Vehicles → Boats** section with an **Import**
  button per boat (Canoe, Galleon, Junk, Longboat, Raft, Rowboat, Sailboat,
  Sloop), cited to *WR pg 118*, plus a macro-friendly
  `game.shadowdarkEnhancer.actors.importBoats()` API for the bulk import. In
  keeping with the suite's sealed-content contract, **no stats are bundled** —
  the importer grabs the boats table from your own Western Reaches PDF and
  parses it (handling the book's split-column table layout), falling back to a
  paste box, then creates the actors in a **Boats** folder (skipping any that
  already exist). Boat actors gained a **cost** field, shown on the sheet.

### Changed
- **The Boat actor sheet now matches the system's own sheets.** It was a plain
  ApplicationV2 window that followed the client's dark theme; it now wears the
  ShadowDark chrome — parchment body, black `SD-header` with the ShadowDark
  logo and the vessel name, `SD-nav` tabs, and `SD-box` sections — with the
  vital stats (HP / AC / Movement / Passengers) as their own boxes down a left
  rail and the detail sections filling the right. The window is titled by the
  vessel's name and carries inline **Sheet** and **Prototype Token** header
  buttons, so a Boat reads as the real actor it is.

### Fixed
- **Dragging an item onto the canvas left a second, purposeless image beside
  the pickup token.** The item-drop handler ran too late in Foundry's
  `dropCanvasData` chain and returned its "handled — stop here" signal from an
  `async` function, which Foundry cannot honour (a Promise is never the literal
  `false` the hook checks for). Another module's item-drop handler (Monk's
  Active Tiles, with its *drop item → tile* option enabled) had already fired
  and dropped a stray **Tile**. The handler is now synchronous and hoists
  itself to the front of the drop chain, so it claims the drops it owns and no
  duplicate image appears; item drops the enhancer doesn't handle fall through
  untouched.

### Added
- **A new world's shop is stocked out of the box.** "The Merchant - Base" is
  loaded as the live shop the first time a world loads, so the **Buy** tab has
  the core gear in it before you configure anything. This happens once: a world
  that already has stock is left alone, and once you've emptied or replaced the
  shop it stays that way. Load either shipped merchant again whenever you like
  from **Manage → Saved Merchants**.
- **Gamble can roll on any table you own, not just world tables.** The source
  picker now lists every roll table in the world *and* in every compendium —
  including the suite's own `sde-tables` — grouped by where they live and
  labelled with the package they came from. (The dead "Loot Level 1–10" options,
  inherited from a loot generator this module has no equivalent for, are gone.)
- **Table rows that print a family of objects now roll out to the actual
  object.** A treasure row like *"Meteorite 1d4: 1. lute, 2. viol, 3. harp,
  4. flute"* is not an item — it's a prefix plus a die that picks which item.
  Both the Gamble and the Loot Generator now roll that die and hand over
  *Meteorite harp* as a real treasure item. A comma before the die marks the
  option as a property rather than the noun, matching how the books print it, so
  *"Mithral Bottle, 1d4: 1. wine…"* gives *Mithral Bottle (wine)*.
- **Double-click a book in Source PDFs to read it.** Every other Open-PDF button
  needs a page cite, so the library itself — the one screen listing your books —
  had no way to just open one. Now it opens at page one in Foundry's viewer.
- **Source PDFs takes books that aren't Shadowdark's.** Pick **➕ Another book…**,
  name it, upload: a third-party adventure, a homebrew supplement, anything you
  want to read or pull text from inside Foundry. Your books sit in the library
  beside the rest, open on double-click, and appear in **Extract from PDF**.
  Re-uploading under the same name replaces that book rather than adding a
  second; to remove one, delete its page from the **Shadowdark Source PDFs**
  journal.
- **Double-click anything in the Manage tree to open it.** An imported table,
  item, class, monster or boat opens its own sheet, so the library is somewhere
  you can actually reach your content from rather than a list to read.
- **Filter the Manage tree to what you still need.** New **All · Still locked ·
  Imported** buttons above the tree. *Still locked* drops every row you've
  already imported — and the folders that are left empty by it — so what remains
  is exactly your to-import list; *Imported* does the reverse for reviewing what
  you have. When a filter leaves nothing, it tells you ("Nothing left to unlock
  — everything in this list is imported") instead of showing a blank panel.
  Switching filters is instant: it reshapes the view without re-running a census.
- **A Cartesian import now tells you what it's about to create.** Cartesian and
  Compound share a preview, and it described only the Compound behaviour — the
  opposite of what Cartesian does — while never saying how big the result would
  be. In Cartesian mode the section is now labelled as such and each table shows
  *"Expands to 36 rows (6 × 6), rolled as 1d36 — one row per combination"*, with
  the note making clear that the grid above is the columns you're combining, not
  the table that gets created.

### Fixed
- **Gambling on a table of text rows paid out nothing.** The gamble read each
  drawn row through a field that is empty on tables which store their text the
  way Foundry now expects, so every text row came through blank — no coins, and
  no items at all. Rows are now folded into loot with **the Loot Generator's own
  rules**, so a table gives the same thing however you roll it: linked items,
  coins parsed out of currency rows, priced valuables fabricated as treasure,
  and anything else printed on the card as what you rolled instead of a bare
  *"No items"*.
- **A gamble could charge for a table that no longer exists.** The table was
  resolved *after* the cost was deducted, so a source pointing into an
  uninstalled compendium took the player's gold and delivered nothing. The table
  is resolved before any money moves, and a draw that fails refunds the cost.
- **Gamble entries in the shop log wore the shopping cart.** They're logged as
  purchases so the session recap still totals the spend, but the log now marks
  them with dice. Existing log entries pick this up too.
- **The importer's Tools menu was unreadable, then unreachable.** Each item's
  hint overflowed its own button and was drawn on top of the next one, so
  nothing looked like it belonged to anything; items now size to their content,
  with the hint aligned under its own title and the PDF actions separated from
  the backup pair. The menu was also clipped by the hub's scroll container
  whenever the window was shorter than the menu — with Manage collapsed, the
  bottom items simply vanished — so it now renders above everything, flipping
  above the button when there's more room there.
- **The Source PDFs window opened nearly as wide as the screen** (its widest
  line was a long PDF filename). It opens at a sane width, is resizable, and
  each book's filename sits under its name instead of stretching the window.
- **The Western Reaches and Cursed Scroll 6 carousing tables were missing, and
  the Core one had no row at all.** All three books print a *Carousing Event* and
  a *Carousing Outcome*, but only CS6's Outcome was listed — WR's two were left
  out deliberately, because the census matched tables by name alone and one
  book's copy would have marked another book's row as imported. The census now
  reads the source off the table's name, so every book lists its own: **Core**
  (pg 92 / 93), **Western Reaches** (pg 236 / 237) and **Cursed Scroll 6**
  (pg 28 / 29), each with the parsing recipe its layout needs — WR and CS6 print
  a ten-row Event table (30 gp → 4,000 gp) where Core prints seven.

  Which book a table came from is read from the **flag stamped on it at import**,
  not from its name, so a table you imported before any of this still counts for
  its own book however it's named. Only a table with no flag *and* a name several
  books share can't be attributed — rename it `<Book> - <Table>` or re-import it.
- **Importing a table two books both print offered to replace the other book's
  copy.** Sixty-seven catalog entries share a name with another entry —
  *Carousing Event* is in three books, *Rumors* in all seven, and Core alone
  prints *Wealth* twice (NPCs, Rival Crawlers). Every one was created under the
  bare printed name, so the second import landed on the first's table and the
  commit dialog asked whether to **replace** it. Say yes and one book's rows
  overwrote another's. Each now imports under a name that identifies it —
  *"Western Reaches - Carousing Event"*, *"Cursed Scroll #1 - The Gloaming
  Rumors"*, *"Core Rulebook - NPC Wealth"* — gaining only as much as it needs to
  be distinct, and the conflict check no longer treats a different book's table
  as the one you're importing. Names no other entry uses are untouched.

  The same guard sits at the **commit** now, not just in the catalog window: a
  table whose name is already taken by another book is filed under its own book
  whichever screen you imported it from, so a plain paste with a Source set
  behaves like a catalogued import.
- **A book's table could be reported missing, or open the wrong book's copy.**
  One book was spelled four ways across the code and the data — `pgwr`,
  `Western Reaches`, `Cursed Scroll #6` (with a #), `Cursed Scroll 6` — and each
  screen knew a different subset. A Cursed Scroll 6 table imported and stamped
  as such read as **missing** because neither its flag nor its name matched what
  the census recognised, and double-clicking Western Reaches' row in the Manage
  tree opened Cursed Scroll 6's table instead. All four spellings now resolve to
  one key, and a row opens the table stamped with **its** book — which is also
  the only way to find a copy imported before the naming convention, since those
  carry no book in the name at all.
- **The Carousing Outcome table lost every row with a "–" in it.** Roughly half
  the table: on *Western Reaches* pg 237 and *Cursed Scroll 6* pg 29 the rows
  where a character takes no mishap read `5 - 1 -10 3`, and the leading `5 -` was
  parsed as a die range (5 to 1) rather than "roll 5, no mishap". Those rows
  landed nowhere, and the importer reported the gaps without being able to
  explain them. Both books' tables now import complete — 25 rows, no warnings —
  which also retires a standing note that Cursed Scroll 6's copy needed hand
  fixing after every import.
- **The Core Rulebook's Carousing Event table imported as seven empty rows.**
  Its Cost column comes out of the PDF as one block, separated from the events
  by a page number and an entire sidebar, so a cost-anchored parse produced
  *"30 gp | |"* seven times with the page furniture swept into the last row. It
  now reads the page by column position, and — because that table has no die
  column — uses the shape's own idea of what a row looks like to tell a real row
  from a wrapped line. All seven rows import with their cost, their full event
  text (which wraps both above and below the cost line in the book), and their
  bonus.
- **The importer's "should be full die coverage" warning cried wolf, and said
  nothing useful when it didn't.** A complete table was reported as broken
  because the parser had noted what it did with the paste's heading lines —
  those notes no longer count against correctness. When something *is* wrong the
  banner now names it: *"values 49, 97-100 have no row"*, *"rows 3 and 4
  overlap"* — rather than a fixed phrase sitting next to a row count that looks
  perfectly correct.

### Changed
- **The Party XP window's Label field lost its "(shown on the chat card)"
  hint** — the chat card shows it, which the card itself makes obvious.

## [0.12.0] — 2026-07-22

### Added
- **Monster Creator level guidelines, in-place editing, and a token-HUD quick
  adjust.** The Creator now answers "what should a level-N Shadowdark monster
  look like?" A new **Level Baseline** section shows the target AC, HP, attack
  count/bonus, damage die, and ability band for the chosen level, computed from
  the 244 monsters in `shadowdark.monsters` (a settings menu lets a GM view and
  **Recalculate** the guidelines against their own world — shipped defaults and
  a GM rescan run the same algorithm). **Open in Creator** hands an existing
  monster to the full editor and **Save** now writes back to that actor instead
  of making a copy — items reconcile by type and name, so an untouched attack
  keeps its id. A token-HUD **quick adjust** panel re-levels a selected monster
  in place — shifting its ability scores into the target level's band and
  rewriting the printed stat block — with a one-click **Revert** that restores
  the actor exactly.
- **Party delivery in the Loot Generator — no more forced recipient.** Each
  rolled result's **Give** dropdown now defaults to **Party (claim in chat)**
  (Give then posts the shared claim card instead of requiring a player), and a
  new **Drop on Ground** button puts the whole result on the canvas — every
  item becomes a pickup-able token and the coins a pile, clustered at your
  controlled token or view centre — so the players decide who takes what. It
  replaces the per-result coins-only **Drop Coins** button (the toolbar's
  **Drop Coins…** prompt is unchanged).
- **Real controls for loot drops.** A world **Loot drop chance (%)** setting
  (default `50`) replaces the hard-coded 50% roll, and every NPC sheet gains a
  GM-only **Loot** header button (visible while the feature is on) to pick a
  specific loot table and/or a per-NPC drop-chance override — the actor flags
  the feature always read but that previously had no UI.
- **Loot drop mode.** Choose between the classic **per defeated NPC** drops
  and **per encounter (one card)**: a single chance roll and at most one card
  for the whole combat, generated at the highest-level defeated NPC's level
  (that NPC's per-NPC overrides apply, so a boss's custom table wins). The
  card's source line lists the defeated monsters.

### Fixed
- **The Encounter Roller's default source list pointed at a compendium that no
  longer exists.** Shadowdark 4.x renamed its bundled monster pack
  `shadowdark.bestiary` → `shadowdark.monsters`, so a fresh world's Browse NPCs
  tab started with one dead source that silently contributed no monsters. The
  default now names the real pack, and worlds that had already toggled their
  source pills — whose stored list still names the old pack — are repaired
  automatically at load. The repair preserves your pill order and collapses the
  entry if you had already added `shadowdark.monsters` by hand, so nothing gets
  browsed twice.
- **Combat-end loot drops no longer double-post in multi-GM worlds.** The
  drop handler ran on every GM-level client (including an always-on assistant
  GM), so each rolled and posted its own cards; it now runs only on the
  active GM, matching the guard the loot claim, merchant, and session-recap
  handlers already used.
- **The Magic Item Forge window scrolls again when Core-mode content is taller
  than the screen** (window capped at 95vh with the root column scrolling,
  matching the importer hub).
- **Selling to a merchant now restocks correctly when the GM has no shop
  window open.** The restock step read the shop mode from the GM's own open
  window instead of the published transaction context, so a headless active GM
  (window closed, or a second GM serving a player's sell request) filed an
  actor-mode sale into the compendium shop inventory instead of back onto the
  merchant. Restock now uses the same authoritative context as stock updates.
- **Monster census category filter regained its word boundaries.** The
  "zone … encounters" category-row filter contained literal backspace bytes
  where `\b` regex word boundaries were intended, so that half of the filter
  could never match; junk gap rows it should have suppressed could slip
  through.
- **The class importer's stage-2 paste hint no longer renders a dangling
  sentence.** Before a class exists its internal name is empty, so the hint
  showed "it attaches to ." — it now uses the same display-name fallback the
  Attach button does.

### Changed
- **Dead enemies leave the crawl strip.** An NPC combatant that is marked
  defeated or drops to 0 HP no longer takes up a card in combat mode — the
  strip shows who is still standing. The combatant stays in the combat
  tracker untouched, so end-of-combat loot drops and the session recap still
  see it, and healing the NPC above 0 HP (or clearing the defeated marker)
  brings the card back.
- **Loot drops on combat end are now opt-in (default off)** — automatic loot
  cards don't fit every Shadowdark table. The setting was also renamed from
  "Enable loot drops" to **"Loot drops on combat end"** and its description
  now says what it actually gates (it previously described the coin-pile /
  canvas feature). Worlds that stored the old value keep their choice.
- **PDF table imports got dramatically more faithful on wrapped layouts.** The
  extractor's coverage audit went from 19 tables needing review to 2: all
  eight Western Reaches prayer generators now reconstruct 6/6/6 (wrapped cells
  that print at the page margin are routed by their terminators instead of
  dropped), the four Wizards & Thieves stakes tables and six Core magic-item
  attribute tables (Type/Qualities/Personality, Tier 1, Curses/Benefits,
  Weapon Bonus) gained parsing recipes, cross-reference matrices recover cells
  that print only one space apart (Interesting Customer), and Core Carousing
  Outcome parses 13 of its 14 rows word-perfectly — the one genuinely
  ambiguous row is now flagged by number instead of committing silently.
- **Magic Forge effects use the Foundry v14 change format.** Forged weapon
  bonuses now author the string `type: "add"` instead of the legacy numeric
  `mode`, eliminating a batch of deprecation warnings (numeric modes are
  removed in Foundry v16). Existing forged items keep working — dedup matches
  by flag, not change shape.
- **Faster startup: heavy tools load on first open.** The importer hub,
  character builder, magic forge, loot generator/setup, encounter roller, and
  token-art manager now parse when first opened instead of at world load. API
  `open()` calls are now async; `api.charBuilder.app` became the async
  `api.charBuilder.appClass()` (see docs/API.md).
- **The Foundry package-browser description now covers the whole suite** (it
  still described only the Crawl Strip).
- **Internal: three new in-client Quench regression batches** — importer
  commit round-trip (never-overwrite/replace-in-place invariants), merchant
  transactions (coin conservation, refusal, restock), and movement budget +
  turn-start rollback. Dev installs with Quench get them automatically;
  release installs are unaffected.
- **Internal: the importer hub was split into paste/commit/manage/shared
  modules** (one ApplicationV2 across five files; behavior unchanged), the
  132-warning lint backlog was cleared and CI now fails on any new warning,
  and `verify.sh` lost its stale sibling-module checks.
- **Internal: in-client regression tests for the combat state machine.** A
  Quench batch (`shadowdark-enhancer.combat-state`) now covers the three
  combat-start flows and asserts every crawl member joins the tracker exactly
  once — the invariant the v0.11.1 fix restored. Dev installs with the Quench
  module get it automatically; release installs are unaffected (the test
  directory doesn't ship, and the loader quietly no-ops).

## [0.11.1] — 2026-07-21

### Fixed
- **Starting combat no longer double-adds the party.** Starting combat from the
  Crawl Bar duplicated every crawl member in the combat tracker (each player
  token appeared twice): the bar's own "add all PC tokens" step raced the new
  v0.11.0 auto-enroll that keeps the party on the strip when combat starts, and
  each side checked for existing combatants before the other's write had
  landed. Combats the bar creates are now flagged so auto-enroll leaves them
  alone (the bar already adds the whole party), and auto-enroll additionally
  self-heals the reverse overlap — if a member token ends up with two
  combatants because the GM toggled party tokens into an external combat,
  the extra copy is removed automatically.

## [0.11.0] — 2026-07-21

### Added
- **Advance the crawl turn from the Crawl Strip.** The out-of-combat turn counter on the left of the strip is now a live control for the GM — the same **Next Turn** advance that lived only on the Crawl Bar. A small arrow beneath the turn number bumps the crawl forward (committing state and capturing fresh movement anchors exactly as the bar does), so you can keep the round moving without leaving the strip. Players still see a read-only counter.
- **Light sources on the Crawl Strip.** Each player card now shows a small flame, just below the character's name, when that character is carrying a light source — so you can see at a glance who has a torch or lantern going. A **burning** source glows (the flame itself, no box), warming from gold toward red as it nears the end of its hour, with the minutes remaining in the tooltip (players see the countdown only where the system's *"show light remaining"* setting already allows it). An **unlit** source shows a dim ember. Click the flame to light or snuff it: a character's owner (or the GM) can light a carried torch, or put out the one that's burning, right from the strip — if several unlit sources are carried, a quick chooser asks which to light. Toggling runs through Shadowdark's own light flow, so the token's light, the chat notice, and the Light Tracker all update exactly as they do from the sheet, and only one source burns at a time. Cards for characters you don't own show the flame as a read-only indicator.

### Changed
- **Internal: the module's source tree is reorganized by feature.** `scripts/` now
  mirrors the feature list — `crawl-strip/`, `crawl-bar/`, `encounter/`,
  `monster-creator/`, `loot/`, `magic-forge/`, `merchant/`, `party-xp/`,
  `session-recap/`, `importer/` (with `char-content/`, `spells/`, `tables/`,
  `monsters/`, `items/`), `actors/`, `char-builder/`, `monster-art/`,
  `pdf-export/`, and a `shared/` folder for cross-feature infrastructure —
  instead of one 90-file `encounter/` catch-all. 102 files moved with history
  preserved; no behavior change. Nothing user-facing moves: templates, styles,
  assets, settings keys, flags, and the `game.shadowdarkEnhancer` API are all
  unchanged.
- **The bundled art is much smaller, and the unsourced class photos are gone.**
  The Kobold, Halfling, and Human ancestry portraits were resized (≤1024 px)
  and re-encoded to WebP with camera metadata stripped — every bundled
  ancestry portrait is now a compact WebP. The eleven photographed class portraits in
  `assets/classes/` were **removed** — their sourcing was never recorded, and
  the character builder has used the gold game-icons class emblems since
  0.10.0, so nothing in the UI referenced them beyond the optional portrait
  gallery. Together this cuts roughly 14 MB from the module download. The
  gallery's default folders now list only `assets/portraits` and
  `assets/ancestries`; a world that saved the old folder list is unaffected
  (missing folders are skipped).
- **Crawl-strip cards show more of the portrait.** The initiative number, the light flame, and the roll-initiative button now sit just below the character's name (level with the AC line) instead of overlapping the name in the top corners. The initiative number and the luck/movement footer lost their solid backgrounds — they read as text straight over the portrait, matching the flame — and the footer's padding was trimmed, so more of each character's art shows.

### Fixed
- **Re-forging an already-magic item stacked the bonus into its name.** Forging a `+2 Longsword` again — a supported path, and how you upgrade an item — produced `+2 +2 Longsword`, because the new bonus was prefixed onto a name that already carried one. The name is now re-derived from the plain base item, so re-forging that sword at +3 gives `+3 Longsword`, and forging it back down to +0 gives plain `Longsword` rather than a name promising a bonus the item no longer has. Names already doubled by the old behaviour are cleaned up the next time the item is forged. A `+1` that isn't the leading part of the name (a "Sword of +1 Smiting") is left exactly as written. The item's mechanics were never affected — the bonus effects themselves have never stacked.
- **The Crawl Strip's party now follows you across scenes.** Player cards added to a crawl used to be pinned to the scene they were added on — switching to another scene emptied the strip. Membership is now tracked by character rather than by that scene's token, so the same party stays on the strip on every scene, each card binding to that character's token on the scene you're currently viewing. A party member who has no token placed on the new scene still shows a card (as a read-only marker). Out-of-combat initiative rolls follow the party the same way, so the marching order survives a scene change.
- **Wizard-variant caster classes now cast their own short list, not all of Wizard's.** Some Western Reaches classes cast a Wizard *variant* list — the Green Knight "casts druid spells," which in Shadowdark are the Neutral-aligned Wizard spells. The importer used to wire these classes to the **full** Wizard spell list with Wizard's Intelligence, so a level-up Green Knight was offered the whole wizard spellbook cast off INT instead of its ~16 druid spells cast off Wisdom. Such a class is now imported as a **self-contained own-list caster**: it keeps its own casting ability, and the importer tags exactly its variant's alignment-matched spells to the class while **preserving** their Wizard link — so the class's level-up spellbook offers only that list, while the real Wizard (and the spell-list census) are left unchanged. The tagging is **import-order independent** — it runs after class import, after each spell batch, and once on world load, so it also self-heals worlds imported before this fix. Classes whose list names a **real** class (e.g. Knight of St. Ydris → Witch) still borrow that whole class's list as before.
- **Awkward monster statblocks import correctly instead of quietly mangling.** Five gaps found by testing against real core-book statblocks: a **Ch** that your PDF copies out as an `X` or `Z` glyph (`X +2, AL L`) is now read as Charisma — but only where an ability belongs, so a weapon named "X" in an attack line can't be mistaken for one. A **variable statblock** (`LV *`, `HP *` — the Hydra) now ends the statline where it should, instead of swallowing the monster's features while hunting for a number, and flags the field for you to set by hand. A **two-form monster** (the Air Elemental's `AC 17/19, HP 29/42, LV 6/9`) imports as its first form and warns per field with the alternate value, rather than picking one arbitrarily. **Unsigned ability modifiers** (`S 3, D 0`, as the Knight prints them) read as positive instead of failing, and the movement clause survives alongside them. Finally, a monster whose **name wraps across two lines** in all-caps is joined back together, including across a hyphen (`SHIELD-` + `BEARER` → `SHIELD-BEARER`), instead of importing one half-named monster and discarding the other half as an unrecognised block.
- **The Azer and the Salamander imported with no weapon damage at all.** Where a statblock separates a damage die from its rider with a **comma** rather than a plus — the Azer's `(1d10, ignites flammables)` and the Salamander's `(1d6, ignites flammables)` — the importer couldn't read the die, so each monster's *main* attack arrived with an empty damage field while its secondary attack (the crossbow, the iron longbow) came through fine. It flagged the field for review rather than failing outright, so it was easy to miss. Commas are now read the same as pluses, and the rider keeps whichever punctuation the book printed. Checked against 279 real statblocks: those two were the only monsters affected in the whole bestiary. **Monsters imported before this fix are not corrected automatically** — re-import the Azer and the Salamander, or set their damage by hand.
- **The mid-phrase split that 0.10.0 left open in narrow three-column tables is fixed.** 0.10.0 shipped a partial fix and named the case still broken: a row importing as `60 gp | You make | a friend   +2`. The cause was a cell wider than its header — a `1,200 gp` cost under a narrow **Cost** heading — which pushes that row's later columns to the right of where the importer was looking, so it gave up and cut the next cell mid-phrase. The importer now tracks how far a row has drifted from its headers and looks in the shifted position, so the row reads `60 gp | You make a friend | +2`. Blank cells in the mix-and-match grid shapes (Traps / Hazards / Secrets, the Core name generators) are handled correctly, including on the narrow four-column name grids. One case remains where a row can still come through shifted: if a paste's header spacing is too irregular for the importer to read the column positions at all, it falls back to a simpler split that can move a value left when the row above it left a column empty. That fallback reports itself — the preview flags the row (`Roll 2: fewer than 3 columns`) and the grid's filled-cell count comes up short — so review any grid table that flags rows before committing it.
- **Pasting certain lookup tables did nothing at all.** A regression in 0.10.0: if any row of a lookup table (Carousing Outcome and its kin) had fewer columns than the table's header — which happens routinely when a row wraps in a PDF copy, so the second column lands on the next line — parsing crashed outright. The paste box simply sat there: no table, no error, no explanation. This was doubly awkward because the 0.10.0 notes ask you to re-import some tables, and re-importing a lookup table is exactly what triggered it. Short rows now import with the missing cells left blank and the affected row named in a warning.
- **Rollback Movement left the undone path drawn on the map.** After a rollback the token snapped back to its turn-start square, but the movement trail it had just made stayed painted across the scene — the next move looked like it started from the old, already-cancelled position. The rollback now clears the token's recorded movement history (and the leftover ruler drawing) so the map shows a fresh start. Out-of-combat crawl moves, which record no history, are unaffected.
- **Rollback Movement could do nothing, or send a token to the wrong place, when a second GM was signed in.** 0.10.0 made a single GM responsible for answering rollback requests, but the "where the token started this turn" position was only ever remembered by whichever GM's screen advanced the turn — often a different one. A player clicking **Rollback Movement** could get silence, and a co-GM clicking it could send the token to a position left over from an earlier turn while refunding a full move. The starting position is now stored on the token itself, so any GM can undo a move correctly. It also records elevation, so on a multi-level map a rollback returns the token to the floor it started on rather than the right spot on the wrong floor.
- **The Spell Importer remembered the last class you bulk-imported.** After importing a preset spell list (say the Priest list), the class name stayed in the *"These spells are:"* box behind the scenes. Clicking **Unlock** on a different class's spell then tagged the new spells with the old class — the *"import the class the book says"* behaviour restored in 0.10.0 was quietly overridden, and because the stale class resolved fine, nothing warned about it. Starting a fresh unlock now clears the box; choosing a preset list still fills it in as before.

## [0.10.0] — 2026-07-19

**Source-guided PDF import** — the importer recognizes a large range of *Cursed Scroll* and *Western Reaches* content (classes, ancestries, backgrounds, spells, gear, monsters, roll tables) from **your own PDF paste** and files it cleanly, without hand-fixing the text. The module ships only names, source/page citations, formulas, and parsing structure — no rules text, no prepared documents, nothing encrypted. Plus **dedicated Class & Spell Importer workspaces**, **source-PDF deep links**, a much smarter **table importer**, and follow-ups to the **Monster Token Art Manager**.

### Added
- **Magic Item Forge — Core Rulebook tables (Phase 1: weapons & armor).** The Forge gains a **Core Rulebook tables** mode (alongside the unchanged Manual mode) that reads your **own imported** Core magic-item tables from the managed `sde-tables` compendium — exactly like the Monster Generator unlock. Each set shows a live readiness badge (`locked` / `partial` / `ready` / `ambiguous` / `invalid`) with actionable diagnostics and an **Import … from Core Rulebook…** button that opens the seeded Importer Hub (Open PDF / Grab text / preview / strict persistence gate). Phase-1 sets: **Weapon** and **Armor** base recipes (Type + Bonus + Feature), independent **Benefit** and **Curse** riders, and independent **Item Virtue / Item Flaw / Personality Trait** details. Roll (real dice, posted to chat), pick from a dropdown, re-roll, or clear each table; the roll domain is validated range-aware (`1d20`=1..20, `1d16`=1..16, `1d12`=1..12, `2d6`=2..12) with complete, gapless, non-overlapping coverage. Only an **unambiguous whole-result +N (0..3)** from a Bonus table is mechanized — weapons get exactly two transferring Active Effects (`system.roll.attack.bonus.this` / `system.roll.attack.damage.this`, mode ADD), armor sets `system.ac.modifier`; a re-forged base never stacks duplicate bonus effects. Every other selection (Feature/Benefit/Curse/Virtue/Flaw/Personality) is appended as **escaped descriptive text with a visible "apply at the table" marker**; the rolled **Type** is a base-selector *hint only* and is never written into the item. Forged items record **provenance v2** — stable references only (`{manifestId, tableUuid, resultId, range}` + automation summary), never source prose. Base recipes import **all-or-nothing** (a missing/invalid/duplicate child table creates nothing — enforced at the persistence choke point behind both *Commit Tables* and *Commit All*); selections are re-validated against the live pack immediately before creation and any stale/changed selection blocks the forge, leaving state intact. Manual Weapon/Armor/Scroll/Wand forging is unchanged. Potion, Utility, Scroll, and Wand Core-table automation are intentionally **not** part of this phase.
- **Treasure/Loot → Forge handoff.** Loot placeholders now carry a **stable `forgeType`** derived from the item's real Shadowdark type (not just its name), threaded into the Forge seed; legacy cards fall back to name inference for the initial seed only. Cancelling or a failed forge leaves the card unchanged; a successful forge swaps `uuid`/`name`/`img` and clears `forgeable`. Claiming/giving copies the full forged item (effects, identification, provenance, description, properties) exactly once.
- **API (`game.shadowdarkEnhancer.forge`).** New read-only helpers: `forge.catalog()` (async live readiness), `forge.sets()` (set metadata), `forge.buildSetSeed(setKey)` / `forge.buildChildSeed(manifestId)` (Importer-Hub seeds). No persistent raw-prose API is exposed — result text is only ever your own imported content, read live.
- **Metadata fix.** The `core-item-flaw` table manifest page was corrected from `395` to `295`.
- **Export a character sheet to PDF.** Owned Shadowdark player sheets get an **Export to PDF** button in the sheet header (GM or the character's owner only) that fills a bundled form-fillable character sheet with the actor's data — abilities (including active-effect bonuses), attacks, gear and slot usage, spells, talents, languages, and features — and hands you a saved or downloaded PDF. Everything happens **locally**: the file is written through the browser's Save dialog (with a plain download fallback), and nothing is uploaded or sent anywhere beyond loading the module's own bundled template and library. Character data is read from the Shadowdark data model's own computed getters and parsed inertly, so a player's notes can never run code during export.
- **Real Weapon & Armor stats on import.** A dedicated gear parser reads the book tables' actual stat columns — armor AC (worn base / shield modifier / DEX attribute) and weapon damage dice (versatile pairs and two-handed-only included), range, melee/ranged type, and the letter-coded **Properties** column (the WR legend: Sundering, Finesse, Loading, …) — and resolves properties to the `shadowdark.properties` documents the data model stores; codes with no core equivalent (Mount, Charge, Devastating, Obsidian, Sniper) are flagged for review, never silently dropped. All three paste shapes parse: reflowed PDF-viewer copies, comma-separated rows, and the space-separated table columns a single-column PDF extract really produces — table headers, page-footer numbers, and the property-definitions prose are skipped and reported, never minted as items. The **Item Builder** uses it end to end for Weapons/Armor, so the guided Import flow creates mechanically complete gear: stats, matched descriptions, resolved properties, and the char-builder's `source.title` stamp together.
- **Always-on Crawl Bar.** The crawl bar is always present with a Start/End toggle — the separate Start-Crawl screen is gone.
- **Gold class emblems.** The char-builder's class list, header, and preview use gold game-icons.net emblems (CC-BY, per-artist credits in CREDITS.md) instead of photo portraits.
- **Dedicated Class Importer workspace.** Classes — the most complex import type — get their own guided, single-view workspace instead of the generic paste box: the class being built is pinned at the top, **Stage 1** pastes the writeup (name field seeded from the Import click, flavor preserved), **Stage 2** has per-part paste zones for the **talent table**, **titles** (always hand-editable band editor), **spells known**, and **extra tables** (e.g. Corruption) — any paste is routed to the right slot automatically. One **Create** imports everything captured; **Add … to <Class>** attaches tables to an already-created class. A green checklist shows exactly what's on the class.
- **Dedicated Spell Importer workspace.** Spells import organized by the three axes that matter: **Class → Tier → Alignment** ("druid spells are Wizard spells with Neutral alignment"). A bulk "These spells are: [Class][Alignment]" bar, per-spell overrides, a grouped preview, and import writes `system.class`, tier, and the alignment flag the char-builder's spell picker filters on — filed under Spells → Class → Tier → Alignment.
- **Source-PDF deep links.** Unlock buttons and the Class Importer open **your own uploaded PDF** of the cited book at the cited page, inside Foundry's native viewer — writeup pages and the WR titles appendix are both mapped. A **Source PDFs** manager uploads and links a PDF per book (files stay in your world; nothing leaves your machine), with shared `assets/` defaults for every source.
- **Table importer: shape-directed parsing.** Each unlockable table can carry a parsing recipe, so messy PDF copies parse deterministically: **prayer generators** (3-column 3d6 compounds, cartesian-expanded to a visible flat table), **Carousing** lookups (wrapped cells, cost-indexed rows, pattern-anchored columns), **grid shapes** for mix-and-match tables (Traps / Hazards / Secrets, Core name generators), and reflowed single-spaced pastes. A **Cartesian (expand)** button flattens compound generators on demand; a typed `|` always wins over inferred column splits.
- **Table filing overhaul.** Category-first folders (with a custom-folder dropdown), a dedicated *Wizards and Thieves* Core folder, ancestry name tables imported as **"Character Names: <Source> <Ancestry>"** (visible in the char-builder dropdown), and the Talents pack filed under a **Character Options** folder with per-class sub-folders.
- **Shikashi spell icons.** Imported spells get matched icons from the sliced Shikashi set by default.
- **Crawl strip: configurable GM avatar** — click the portrait (or use the setting) to pick the face the strip shows for the GM.
- **Content you import from your own books.** For CS4–CS6 and the *Player's Guide to the Western Reaches*, the module knows the **structure** of the content — names, source/page citations, dice formulas, and parsing/table layout — and **nothing else**: **no readable rules text, no prepared documents, and nothing encrypted are bundled**. You paste the matching section from **your own PDF**; the module recognizes it, applies the right parsing recipe, remaps intra-content links, and imports it idempotently (re-importing never duplicates). Covers **spells** (CS4/5/6 lists, WR Necromancer + Priest lists), **monsters** (CS4/5 bestiaries), **gear** (WR Mithral shields, boats, siege, weapons; CS5 gear), **roll tables** (CS6 Carousing/encounters, WR ancestry Name/Trinket tables, spell-mishap tables, Warbands), the **Half-Elf ancestry**, and the 9 WR **classes** (with titles) + backgrounds. Content shared across books (Delver/Wyrdling/Duelist classes; the CS spells reprinted in WR) can be imported from **either** source's paste. Content the Shadowdark **system already ships** (core spells, base bestiary, legacy Bard) is skipped — you already have it.
- **Imported monsters get token art too.** The compendium-art overlay now skins the enhancer's own imported-monsters pack (the suite `sde-actors` pack, or the legacy `world.shadowdark-enhancer--actors` pack) alongside `shadowdark.monsters`, discovered live — so monsters you import (Cursed Scrolls, Western Reaches, …) can carry token art like the base bestiary. Imported rows are tagged in the manager, and the overlay writes one mapping entry per pack.
- **Visual image browser.** A **Browse** button on every monster opens a searchable grid of *every* token across all installed sources (Monster Manual, Paizo Monster Core, Forgotten Adventures, Community Tokens — 2,000+ files), so a monster with no automatic name-match can still be skinned by hand. A hand-picked image wins over source priority and overrides. The browser **groups by source** (collapsible sections with sticky headers), **zooms** (slider, `Ctrl`+scroll, `Ctrl +` / `Ctrl −`, `Ctrl 0` to reset), filters as you type with a **clear (×)** button, and shows the hovered token's **source · filename**.
- **Pathfinder iconics + auto-detected token modules.** The pf2e game system's 59 **iconic** PC/companion portraits (Amiri, Ezren, Droogami…) are browsable (browser-only — the pf2e *system* ships no monster tokens), and any installed **`pf2e-tokens-*`** module is auto-added to the browser.
- **Per-source token scale.** Each art source is scaled so its tokens fill the grid the way the art intends. Dynamic-ring sources (**Monster Manual**, **Paizo**) are tuned independently on the token Scale-Ratio and the ring-subject fit; flat sources (**Forgotten Adventures**) by a single factor; **Community** art is left at its native scale. Every creature keeps its relative framing — a large monster stays proportionally larger than a small one.

### Changed
- **Generator & Mutator now read your own imported Core Rulebook tables — no shipped catalogue.** The Monster Creator's mutation panel no longer ships a static, source-derived list of effects. Instead it reads the GM's **own imported** *Monster Generator* (d20 × 4 columns) and *Make It Weird* monster-mutations (d12 × 3 columns) matrices from the managed `sde-tables` compendium (via `scripts/encounter/monster-table-runtime.mjs`), matched by the exact per-column `manifestId` flags the importer already stamps (`core-monster-generator:combat/quality/strength/weakness`, `core-monster-mutations:mutation-1/2/3`). Each set unlocks **independently** and only when all of its columns resolve to exactly one valid table (correct `1d20`/`1d12` formula, exact `20`/`12` non-overlapping rows, no empty results); incomplete, ambiguous (duplicate flag), or invalid columns are shown as actionable diagnostics with an **Import from Core Rulebook…** button that opens the seeded importer. Rolled or manually-selected results are applied **conservatively** — exactly one descriptive `NPC Feature` per result, with the text normalized to safe plain text and persisted as escaped HTML. HP, AC, abilities, attacks, movement, name, and spellcasting are **never** inferred or changed. Existing features are preserved.
- **API (`game.shadowdarkEnhancer.mutator`).** `mutator.catalog()` is now **async** and returns the structured `{ generator, mutations }` state (`locked` / `partial` / `ready` / `ambiguous` / `invalid`) with dynamic columns/results instead of a flat array of effects. `mutator.create(baseUuid, resultRefs, customName?)` now takes validated imported-result references `{ manifestId, tableUuid, resultId }` (an optional `createFromResults` alias exists); passing the old static string ids throws a clear deprecation error **before** anything is persisted. "Create Mutated Copy" is now **Create Variant Copy**. New mutated actors record **provenance version 2** — stable references only (`manifestId`, `tableUuid`, `resultId`, `range`, plus `baseUuid`/`baseName`/`createdAt`), never source prose. Old version-1 provenance on existing actors is left untouched and never reinterpreted.
- **Maintenance is automatic now.** Imported-table re-linking sweeps automatically after every monster/item commit (debounced, silent unless rows changed), and the monster backfill runs once per module version on world load. The Manage strip's manual **Re-link / Migrate / Backfill** buttons — and the pre-suite world-migration tools (world tables → suite pack, legacy Loot-pack fold, world-actors migration UI) — were removed. `game.shadowdarkEnhancer.monsters.migrateSuite` remains as a headless API; a world still on a pre-suite layout should run that once (or pass through a 0.9.x release) before relying on 0.10 imports.

### Fixed
- **Magic Item Forge — "Armor Curse" imported the Benefit table and wouldn't validate.** Two bugs: (1) the Importer Hub is a single reused window, and opening it for a new unlock kept the previous unlock's parsed tables, so importing **Armor Curse** right after **Armor Benefit** still showed (and would have committed) the Benefit rows — opening now clears the prior drafts. (2) The `core-armor-curse` manifest listed **11** rows, but the printed table has **12**, so a correct import validated as `invalid` ("Expected 11, found 12") and the Forge refused it — the count is corrected (and its content hash regenerated). Applies to any set the hub is reused for, not just armor.
- **The automatic monster backfill ran once per connected GM.** After a module update, the one-off sweep that brings already-imported monsters up to current import fidelity was gated on "is a GM" rather than "is *the* active GM". On a table with a second GM signed in — including an always-on relay or bridge client — every GM ran the sweep simultaneously, each writing to the same compendium pack and stamping the same world setting. It now runs only on the single active GM, matching the spell↔class sweep beside it.
- **Movement was reset twice per turn, and rollbacks fired twice, when a second GM was signed in.** The movement tracker's combat hooks and its rollback relay ran on every connected GM rather than on the active one. With a second GM online — again including an always-on relay or bridge client — every round or turn change wrote each token's movement flags twice, and a player using **Rollback Movement** had their token teleported back twice and their spent movement refunded twice — writing the same values twice rather than compounding them — with every signed-in GM seeing a duplicate "rolled back to turn start" notification. All three now run on the single active GM. Direct GM actions are deliberately unchanged: starting a crawl, **Next Turn**, and adding members are one physical click by whichever GM made it, so any GM may still perform them.
- **Imported content filed under a shouted source name, and the Manage tree never cleared.** Choosing a book from the **Source** dropdown — or clicking **Unlock**, which fills it in for you — stamped the long label ("Cursed Scroll 1"), while the Manage tree's source list is keyed by the short code ("CS1"). The two never matched: importing the 14 CS1 monsters left the CS1 row still reading *0 of 14* with every Unlock button lit, and added a second, all-caps "CURSED SCROLL 1" row beside it. All eight sources in the dropdown were affected. (This wasn't wholly new in 0.10.0: at 0.9.5 the field was free text suggesting "CS1", which matched, but clicking **Unlock** already stamped the long label even then — 0.10.0 widened the mismatch to every source.) The long labels now fold to the same codes the tree uses, and the Manage tree's counts heal for content imported earlier without needing a re-import. Note the **compendium folders** created by those earlier imports keep their old shouted names — new imports file under the short code, so a world that imported before this fix will see both folders side by side until you merge them by hand.
- **Every imported spell came in as a Wizard spell.** The Spell Importer's *"These spells are: [Class]"* box defaulted to **Wizard** instead of starting empty, and that default silently overrode the class the parser had read from each spell's "Tier N, *class*" line. Pasting the Western Reaches Necromancer list and pressing Import produced Necromancer spells tagged as Wizard, filed under *Spells / Wizard*, and offered to every Wizard in the character builder. The box now starts empty so the parsed class wins; typing a class — or unlocking a preset spell list, which fills the box for you — still applies to the whole batch exactly as before.
- **An Unlock whose PDF grab broke down mid-way failed silently.** Clicking **Unlock** on a class or a gear entry opens the matching workspace and immediately pulls the writeup, price table, or descriptions out of your linked source PDF. The common stumbles already reported themselves — a scanned page with no selectable text, an unreadable file, no page mapped for that book. What said nothing at all was an unexpected error *after* that point (a failure while parsing or matching what had been grabbed): the workspace sat there empty while the hub looked as though the unlock had worked. Those are now reported too, telling you to paste that section by hand, with the details in the console. One gap remains: for a book with no source PDF linked at all, the class workspace still opens without explaining why nothing was grabbed.
- **A blank cell in a multi-column table pushed every later column one place left.** On grid pages where one column is empty for a row — the Core Rulebook's **FOOD** page is the clearest example — the importer couldn't see the gap, so it packed the remaining values leftward: that row's *Wealthy* dish was imported as its *Standard* dish, and *Wealthy* lost the row entirely. Nothing flagged it. Only the last column ever reported a missing row, so the wrong table looked clean on review. The importer now reads the column positions from the rows that *did* come through intact and puts the blank where it belongs; when a table has too few intact rows to work that out, the affected rows are named in a warning rather than committed quietly. **Tables imported before this fix are not corrected automatically** — if you imported a grid page that has blank cells, re-import it or spot-check those rows against the book.
- **Three-column lookup tables could import with the middle column empty.** On a layout-preserved paste of a narrow table like **Carousing Event** (Cost / Event / Bonus), two column boundaries sitting close together could both snap to the same gap in the text. The middle column came out blank and its text was swept into the last one — `30 gp |  | You win at cards   +1` instead of `30 gp | You win at cards | +1`. Column boundaries are now resolved in order, so no two columns can land on the same split point. **Partial fix:** a row whose column gap falls just outside the matcher's search window can still be cut mid-phrase (`60 gp | You make | a friend   +2`). That is a separate problem — a wide cell early in the row pushes the later columns out of reach — and it is still open, so check narrow three-column tables after importing them.
- **Spellcasting printed after the talents box is captured.** Some Western Reaches casters (e.g. the Green Knight) print their "Spellcasting…" paragraph *after* the talent table in column reading order. The parser used to glue that line into the last talent row, so the class imported as a **non-caster** with no level-up spell choices. It now recognizes the post-table feature — while still preserving talent effects that merely *look* like a feature heading ("Weapon Mastery. Choose one weapon to master."), so the whole talent table survives intact.
- **Imported spells and classes link up in either order.** Whether you import a class before or after its spells, the two now associate: a spell with no live caster-class link is re-linked as soon as its class exists (by its stored class name, or its `Spells / <Class>` folder for older imports), and the sweep runs automatically after class import and once on load. Spells already linked elsewhere — borrowed or multi-class lists — are never overwritten.
- **The "Searching Distant Lands…" spinner can no longer get stuck.** If the system's item-sheet loading throws a transient error (occasionally seen right after importing a class into the compendium), the spinner used to stay up until a refresh and block viewing anything in the compendium. The module now dismisses the orphaned spinner and bounds the close so it can't hang, logging the underlying error for diagnosis.
- **Readable dropdowns in the character builder's dark theme.** Native `<select>` menus (e.g. Fighter → Weapon Mastery) rendered white-on-white in the core dark theme and near-black-on-black in the light theme; the builder now pins its own dark color scheme and explicit option colors so the choices are legible in both.
- **Guided Weapon/Armor imports keep their combat statistics.** The Item Builder previously rebuilt name/cost/slots-only drafts at create time, so Weapons and Armor imported through the Manage tree lost damage, AC, range, type, and properties; the full parsed stat draft now rides through description matching and creation.
- **Multi-row gear pastes no longer collapse into one malformed item.** Record splitting recognizes runs of one-item-per-line rows without requiring blank lines between them; stray symbols, bare page numbers, lone material words, and prose blocks are dropped and reported instead of minting phantom items (the item literally named "+").
- **Imported plain gear no longer defaults to `treasure: true`.** Only actual treasure is flagged; Weapons/Armor never carry the field.
- **Re-importing just a class writeup no longer erases its talent table and titles.** A body-only (Stage 1) re-import used to replace the whole class document with empty roll-table fields; the attached talent table, titles, and spells-known are now carried forward from the existing class.
- **Unlocking a second class or spell starts from a clean workspace.** The Class/Spell Importer singletons kept the previous unlock's parsed results and target class, so a second unlock could attach tables to the wrong class or import a stale spell batch — each Unlock now resets the workspace before seeding.
- **Prayer-generator results read as a sentence.** Cartesian-expanded compound tables hardcoded a `" | "` separator, so prayers rolled as "Alpha, | beta will | gamma!"; the configured separator (a single space for prayers) is now honored. Prayer chat cards also report the human roll (3d6), not a per-column 1d6.
- **Table paste parsing hardened.** Wrapped-grid rows no longer silently drop cell continuations; reflowed PDF-viewer copies (single-spaced) parse via reflow boundaries; cost-indexed lookup pastes with `|` number rows in order; an ellipsis header ("Played For…") no longer fakes a matrix split; Carousing page-swap and false coverage warnings fixed.
- **Import HTML sanitation fails closed.** If Foundry's sanitizer is ever unavailable, pasted/edited description HTML is escaped rather than persisted raw.
- **Source-PDF link status is verified.** The Source PDFs manager HEAD-checks the shared default paths instead of reporting them linked unseen, and labels defaults separately from your own uploads — a clean install no longer claims dead links are live.
- **Clearing a per-monster override (and "Reset picks") did nothing.** Removing one override, or resetting all of them, silently no-op'd because saved state was recursively merged instead of replaced (`mergeObject` keeps keys absent from the patch). Both now clear as expected — including hand-picked images.
- **Reordering source priority didn't take effect until the manager was reopened.** The resolved art, "chosen" highlight, and per-source tallies now refresh immediately on reorder.
- **"Re-skin placed" now honors your multi-source picks.** The button re-skins already-placed tokens with the manager's resolved blend (Monster Manual / Paizo / Forgotten Adventures / Community, per monster) instead of the old single-source matcher — with a fuzzy fallback so renamed or homebrew actors still match.
- **Switching a placed token to flat art (Forgotten Adventures / Community) no longer shrinks it.** A leftover dynamic ring from the previous art was squeezing the new flat art into its ring subject; re-skin now turns the ring off for flat sources so the art fills the tile.

### Removed
- **`scripts/encounter/mutation-data.mjs`.** The static mutation catalogue and its `applyMutations` / `generateMutatedName` / `getConflict` helpers are deleted outright (no compatibility stub). All consumers were migrated to the imported-table runtime above.
- **Retired sealed-content architecture.** Removed the unused AES-GCM seal/unseal runtime, its development builder and procedure, and the obsolete sealing plan. Source-guided parse-and-author import was already the only active path, so this removes dead code without changing importer behavior.
- **Retired Fighter portrait duplicate.** Removed the unused `assets/classes/_retured/fighter.JPG`; the active Fighter portrait remains unchanged.

### Notes
- Verified live against Foundry VTT **14.364** and Shadowdark **4.0.6**.
- All art is still referenced from disk by path — nothing is copied or bundled. Imported-monster art draws from name-matched sources (curated id-keyed maps such as Community Tokens cover the base bestiary only).

## [0.9.5] — 2026-07-08

Two art features: a **Monster Token Art Manager** that skins the Shadowdark monster compendium with token art you already own, and **character portrait + token art** in the builder — with paths that work even for players who hold no file permissions.

### Added
- **Monster Token Art Manager.** A GM-only **Monster Art** button on the Actors sidebar opens a manager that re-skins the `shadowdark.monsters` compendium through Foundry's core compendium-art system — it **references locally-installed art by path and never copies or bundles any artwork**. Art sources are auto-discovered from whatever you have installed: **Monster Manual** (with its dynamic ring + per-token scale), **Pathfinder/Paizo** (`pf2e-tokens`), **Forgotten Adventures** (`dnd5e`), and **Community Tokens**. Drag to order **source priority**, or pick art per-monster; the blend applies at runtime with no world relaunch (Apply / Re-skin placed tokens / Turn off). **Semantic aliases** map Shadowdark's reflavoured monsters to the right art (Brain Eater → Mind Flayer, Stingbat → Stirge, Grimlow → Grimlock, and more), and Shadowdark-original monsters are pinned to Community art. Scriptable via `game.shadowdarkEnhancer.tokenArt`.
- **Portrait + token artwork on the Preview step.** Every build gets an **Artwork** card before *Create Character*, with four ways to set it, in ascending permission cost:
  - **Use Suggested Art** — one click applies the bundled class/ancestry portrait. No permissions, no setup.
  - **From URL…** — paste a link to any image (or a path in your world). Works for every player with **no file permission and no GM online**, because a portrait is just a stored path.
  - **Curated gallery** — pick from a GM-nominated folder. The browse runs on the GM's client, so permission-less players choose art without the file browser and without seeing the rest of your data directory. Defaults to the module's **own bundled portraits** (`assets/portraits`, plus the class/ancestry art), so it works out of the box with no other module.
  - **File browser** — the normal FilePicker, for anyone with the *Use File Browser* permission.
- **Gallery folder setting** (*Character Builder — portrait/token art folders*): a comma-separated folder list. Add your own folders (including a Tokenizer save directory) to offer more art; leave blank to hide the gallery.

### Changed
- **The Character Builder opens from the Actors sidebar**, a single entry point shown to every user. The redundant launch button on each Player sheet's header is removed (build-in-place is still reachable via `game.shadowdarkEnhancer.charBuilder.open({ actor })`).
- **shadowdark-extras integration — spells surfaced in the Medkit.** When *shadowdark-extras* is present, the enhancer registers its `world.spells` pack with SDX's Medkit on ready, so a spell already learned from a plain copy can be updated to the enhancer's automated version. Registration polls briefly for the SDX API (it initializes on its own `ready`, which may fire after ours) and is a silent no-op when SDX isn't installed.

### Notes
- Verified live against Foundry VTT **14.364** and Shadowdark **4.0.6**.
- The Monster Token Art Manager only lists sources whose art modules are installed (Monster Manual, `pf2e-tokens`, `dnd5e`, Community Tokens); it references that art by path and ships none of it, so nothing appears for a source you don't own.
- Remote (URL) portraits stay on their host site — if it goes offline, the image won't load. The gallery needs a GM online for players who lack the *Use File Browser* permission.
- The new gallery-folder default applies to fresh worlds; existing worlds keep whatever value they saved.

## [0.9.4] — 2026-07-06

Character-builder polish — table sources now "just work" with no setting, and class feature text reads cleanly — plus a rebuilt importer Manage strip.

### Changed
- **Ancestry Names/Trinkets and Background/Deity tables are auto-discovered** — the Character Builder finds every installed table that fits (ancestry Names/Trinkets that name a known ancestry; Background/Deity tables) from the world directory and all compendium packs. The **Table Sources settings menu is gone** — imported Western Reaches or homebrew tables work with zero configuration.
- **Importer Hub — Manage strip rebuilt** as an unlock/lock review tree.

### Fixed
- **Duplicate class features.** A feature that is both a Talent and its activatable Class Ability (Pit Fighter's Relentless/Flourish, Ras-Godai's Smoke Step, the Western Reaches pairs) is now listed once in the class detail instead of twice. Display-only — the built character still gets both.
- **Class feature paragraphs.** Multi-paragraph features (Spellcasting, Omen, and similar) no longer clump onto one line — paragraphs break with proper spacing, matching the book's layout.

### Notes
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**. Removing the Table Sources setting leaves prior stored values orphaned in existing worlds (harmless; ignored).

## [0.9.3] — 2026-07-06

### Fixed
- **v13 deprecation warning on compendium creation.** `ensurePack` / `ensureMonsterPack` accessed the global `CompendiumCollection` (deprecated since v13, removed in v15). They now use `foundry.documents.collections.CompendiumCollection` with a legacy fallback — no more warning when the suite/monster packs are first created (e.g. during a bundle import on a fresh world).

## [0.9.2] — 2026-07-06

Rounds out the *Western Reaches* character-builder content, makes the whole suite portable (a full compendium export/import **and** refreshed unlock bundles), and adds merchant-shop quality-of-life on top of key character-builder fixes.

### Added
- **Western Reaches content, as unlockable units.** The nine WR classes (Delver, Duelist, Green Knight, Kyzian Archer, Monk of Yag-Kesh, Necromancer, Paladin, Roustabout, Wyrdling) with their talents, activatable **Class Abilities**, spell lists and title tables; the Half-Elf ancestry; the full background set; WR gear (weapons, mithral shields); and the Necromancer / Diabolical spell-mishap tables. Shipped **encrypted** — book owners unlock by pasting the matching book text; no readable rules text ships in the module.
- **Character-content unlock dashboard.** The Importer Hub reconciles a metadata manifest of the CS4–6 / *Western Reaches* character content against your world and offers a one-click **Unlock** for missing entries.
- **Portable suite bundle.** Export/import now covers every Character-Options pack (classes, talents, class abilities, spells, backgrounds, ancestries) alongside items and tables, so an entire suite moves to another world with all cross-references intact.
- **Merchant shop — collapsible category sections.** The Buy tab groups stock into Basic Gear / Weapons / Armor / Scrolls / Wands / Potions / Poisons sections that collapse in place; the open/closed state survives buys and restocks.
- **Two shipped default merchants.** *The Merchant - Base* (core Shadowdark gear) and *The Merchant - Western Reaches* (base gear + the enhancer item pack) seed automatically and self-heal as content is imported.
- **Dynamic Class Ability uses.** Abilities whose daily uses scale with level (Still the Heart) or are boosted by talents (Hawk Eye, Parry, Sun on the Water) recompute their `uses.max` automatically.

### Fixed
- **Spellcaster character creation.** The class spell picker's alignment gate now reads each spell's alignment (it was reading an unindexed field and never filtered), and selecting a spell registers again (a cache-key mismatch had made it a silent no-op) — casters can be built once more.
- **Half-Elf grants its ancestry talent** (Adaptable) — a stale cross-pack reference plus a mis-set talent-choice count had dropped it.

### Changed
- **Sealed content re-sealed** from the current suite and updated to file unlocked documents into their type-specific packs; each unit keeps its existing anchors, so the same unlock text still works. Units remain ciphertext-only.
- **Character-content dashboard** reconciled to the built suite — no more false "missing" rows.

### Notes
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**.

## [0.9.0] — 2026-07-05

Introduces the guided Character Builder, hardens the player-facing socket paths (shop, loot, drops) against crafted payloads and duplicate processing, and moves releases to a tag-driven GitHub workflow.

### Added
- **Character Builder.** A guided, rulebook-styled character creator: Abilities → Ancestry → Origins (Background / Alignment / Deity) → Class → HP & Gold → Gear → Preview. Highlights: ancestry pages with book-style trait text and one-click trait picks; inline spell previews; a categorized, class-restricted gear shop with a coin budget; **talent choices made inside the builder** (Weapon Mastery, Armor Mastery, etc. — no system dialog at create); bonus creation rolls (Human Ambitious, patron boons, talent-linked tables); ancestry effects honored structurally (e.g. Dwarf Stout rolls HP with advantage and gets +2 max HP without double-counting); GM-configurable Name / Trinket / Background / Deity roll-table sources via a settings menu; and a GM hand-off when the player lacks actor-create permission — now with a clear error when no GM is online.
- **Development tooling.** `package.json`, ESLint (flat config with Foundry globals), a node test suite for the pure helpers (coins, statblock parser, session recap, party XP, forge), and GitHub Actions **CI** (lint + test on every push).
- **Tag-driven releases.** Pushing a `vX.Y.Z` tag stamps the version into `module.json`, builds `module.zip`, and publishes the GitHub release the manifest URLs point at.

### Security
- **Player socket requests are validated GM-side.** Item drops re-read the item from the source actor instead of trusting the payload (no fabricated items or inflated quantities); pickups, buys, sells, and gambles verify the requesting user owns the actor; shop prices, multipliers, and toggles come from the GM's authoritative state, never the client payload; catalog purchases are restricted to the published catalog packs; actor/effect/item names are HTML-escaped in chat cards and the crawl strip.
- **Only the active GM processes socket requests.** A second logged-in GM or an always-on relay client no longer double-creates drop tokens, purchases, or chat cards.

### Fixed
- **Money and loot races.** Shop transactions are serialized through a single queue; loot claims and canvas pickups take an in-flight lock; Session Recap writes go through a write queue — two near-simultaneous clicks can no longer double-spend, double-claim a pile, or silently drop recap increments.
- **Coin denominations are preserved.** Paying or receiving coins now does purse-aware math (spend cp → sp → gp, breaking coins only as needed) instead of collapsing the whole purse to canonical gp/sp/cp on every transaction.
- **Out-of-combat initiative sync is live from load** — a player rolling initiative before the GM ever opens the crawl strip no longer loses the roll.
- **Movement deduction fires once** (on the moving user's client) instead of on every connected client.
- **Encounter Browse cache invalidates** when NPC actors are created, updated, or deleted — no more stale bestiary list until reload.
- **Crawl bar renders once per burst** of combat updates (party-wide initiative no longer rebuilds it per combatant).
- **Roll-table select after "Create Roll Table"** in the encounter roller now shows the new table selected.
- **Character commit is atomic** — if embedding talents/gear fails, the half-created actor is rolled back instead of left behind.
- **Western Reaches table manifests** reconciled to the live table shape (status chips no longer misreport imported tables).

### Docs
- **README and API reference** document the Character Builder.

### Notes
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**. Socket hardening is best-effort within Foundry's module-socket model (sender identity is payload-supplied); a future release may migrate the player→GM relays to the authenticated Queries API.

## [0.8.2] — 2026-06-30

Rebuilds the Magic Item Forge so forged items actually apply their bonuses, adds item & coin drops with canvas pickup, and introduces Mount & Boat actor sheets.

### Added
- **Item & coin drops with canvas pickup.** Drag an inventory item onto the canvas to spawn a pickup-able token; another character grabs it from a **Token HUD** button. Stackable drops prompt for a quantity and auto-stack onto a matching item on pickup (by name + type) instead of creating a duplicate. The GM can also drop items straight from the world or a compendium (no owning actor, no inventory decrement). Coins get a GM **"Drop Coins…"** button on the Loot Generator (plus a per-result button when a rolled result contains coins) — pickup **adds** to the recipient's `system.coins`. Ported from Vagabond Crawler and re-adapted to Shadowdark (physical-item whitelist, light sources excluded, drops logged to Session Recap).
- **Mount & Boat actor sub-types.** Two new Actor types — `mount` and `boat` — with dedicated sheets and shared Occupants / Inventory / Description tabs, for the *Western Reaches* mounts, warband units, boats, and siege vehicles. The Mount type reuses the Shadowdark system's own NPC data model and sheet.
- **Magic Item Forge — per-class spell folders, tier filter, and spell pop-out.** The scroll/wand spell selector now groups its spells into collapsible **per-class folders** (with count badges and persisted open/closed state), adds a **tier (level) filter** chip row that composes with the text search, and gives each spell row a **pop-out** button that opens the spell's sheet so you can read it before picking.

### Fixed
- **Forged magic items now actually work.** The old forge wrote weapon `+N` as Active Effects the Shadowdark 4.0.6 rules engine rejects, so forged weapons silently applied no bonus. The forge was rebuilt around mechanically-correct types: weapon/armor `+N` forged onto a real base item using the system's current effect keys, and scrolls/wands as proper spell references (the system owns casting, DC, expend, and break). Live-verified a `+2` weapon resolving to `+2` attack and `+2` damage through the system's own roll pipeline, and `+1` armor raising AC.
- **Pickup stacking respects Max per Slot.** Auto-stacking now tops off partial stacks up to `system.slots.per_slot` and spills overflow into new stacks (e.g. `3/3 + 2/3`) instead of producing oversized single stacks.
- **Forge tier filter no longer force-expands every class folder.** Selecting a tier narrows the rows in place and leaves each folder's open/closed state untouched; only the text search auto-expands.
- **Forge tier-chip row renders on a single row** regardless of Foundry's generic button styling.

### Removed
- **The non-functional Rest placeholder button** was removed from the crawl bar (it was a dimmed "coming later" stub that did nothing).

### Docs
- **README rewritten** for the current feature set — crawl strip/bar, random encounters, Monster Creator, importer hub, loot / forge / merchant, party XP, session recap, and mounts & boats — with corrected compatibility, a full settings table, and the public API surface. Dropped the stale v0.1.0 content.

### Notes
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**.

## [0.8.1] — 2026-06-29

Rebuilds the Importer as a single-view tool, adds spell import, and trims the crawl bar.

### Added
- **Import spells from pasted text.** Paste a Shadowdark spell block (name, `Tier N, Class`, `Duration:`, `Range:`, and its description) and it becomes a real **Spell** item in your `sde-items` compendium — tier, range, and duration mapped to the system's fields, the class name resolved to your installed class (system packs first; left unlinked with a notice if it isn't found), and a damage roll picked up when the text says e.g. "deals 1d6 damage". Spells parse alongside monsters / items / tables in a mixed paste, or on their own. Edit any field in the preview before committing.

### Changed
- **The Importer is now a single view instead of tabs.** One paste box with an **"Importing:"** selector — **Auto-detect** sorts a mixed dump, or pick **Monsters / Items / Spells / Tables** to force the type (with an optional item-type override). Each preview section appears only when it has parsed content. The maintenance tools — census, duplicate-cull, relink/migrate tables, fold legacy loot, backfill, migrate-to-suite — moved into a collapsible **Manage & cleanup** strip that loads on demand.
- **Crawl bar tidied.** The out-of-combat **Reset Initiative** action moved into a right-click menu on the **Add Tokens** button; the dimmed **Lights** placeholder and the **Recap** button were removed from the bar (Session Recap itself is unchanged and still opens via `game.shadowdarkEnhancer.recap.open()`).

### Fixed
- **Importer view switching is no longer laggy.** The Tables reconcile (a full compendium scan) used to run on every tab change; it — and the per-section census — now run once on demand and are cached, so the window stays responsive.

### Removed
- **The Cursed Scroll / Western Reaches adventure-import pipeline left the importer.** The Journal and Scenes tabs (hex / numbered-location keying → journal deploy → map-scene building) and the CS1–6 / WR content-manifest dashboards were set aside to keep the importer focused on Monsters / Items / Spells / Tables. The code is preserved on a branch for a future revisit, and your already-built world content (journals, scenes, actors, items) is untouched.

### Notes
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**.

## [0.8.0] — 2026-06-24

Adds three player-facing systems — a **Merchant Shop**, a **Party XP** award tool, and a per-session **Session Recap** — plus multi-GM correctness fixes.

### Added
- **Merchant Shop.** A GM-run shop (crawl bar → **Forge & Loot → Merchant Shop**, or the crawl strip's **Merchant** button) that opens for every player at once. Two inventory modes — a compendium-backed catalog (gear + magic items) or an NPC actor's own inventory. Players **buy** (coins deducted, item created) and **sell** (item removed, coins added at a configurable sell ratio) against their character's `system.coins`, with a per-transaction log exportable to Discord. Ported from Vagabond Crawler and re-adapted to Shadowdark currency (1gp = 10sp = 100cp).
- **Party XP award tool.** A standalone GM window (crawl bar → **Forge & Loot → Party XP**, or `game.shadowdarkEnhancer.partyXp.open()`) that awards XP to the whole party at once. Drag any item onto it to use its XP value — a value you've tagged on the item wins, otherwise it falls back to the loot-quality score (Poor 0 / Normal 1 / Fabulous 3 / Legendary 10) — or just type an amount. Tick **Save this XP value onto the item** to remember it on the item for next time. The full amount is granted to **each** selected character (Shadowdark RAW — treasure XP isn't split); a chat card summarizes old→new XP and flags anyone who's reached the 10-XP level-up threshold. Writes only `system.level.xp` (never auto-levels). Fires a `shadowdark-enhancer.partyXpAwarded` hook.
- **Session Recap.** A per-session tracker (crawl bar → **Recap**, or `game.shadowdarkEnhancer.recap.open()`) with a tabbed window — Overview / Combat / Loot / XP / History — and a **Copy for Discord** markdown export. Tracking is tied to the crawl: starting a crawl offers to begin/continue a session, ending it offers to save/pause/discard (saved sessions go to History). It captures, with no extra clicks: **loot** claims per player, **XP** awards (from the Party XP tool), **combat** encounters (rounds, enemy rosters, defeated, participants), **per-PC roll stats** (hit-rate, nat 20/1, avg d20, check pass-rate — read from Shadowdark's structured roll data), **damage & kills** (via the Damage Log module), **merchant** sales/purchases, and random-**encounter checks**. In multi-GM worlds only the active GM records (no double-counting).

### Fixed
- **Loot claims no longer double-process in multi-GM worlds.** A player claiming an item or coins from a loot card is now handled only by the active GM. Previously every connected GM ran the claim, so a world with two GMs (e.g. a human GM plus an always-on bridge/relay client) created the claimed item — and added the coins — twice on the character.

### Notes
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**.

## [0.7.0] — 2026-06-20

Adds **Western Reaches (Player's Guide)** coverage to the importer catalog, plus reconcile fixes.

### Added
- **Western Reaches (Player's Guide) catalog.** All six importer tabs now cover the *Player's Guide to the Western Reaches*: its spells, gear / weapons / armor / poisons / boats / siege, mounts & warband units, lore / deity / patron / gameplay journal sections, the 9 new classes + Half-Elf ancestry, and its random tables (ancestry names & trinkets, backgrounds, secrets, faction generator, spell mishaps, carousing, and the per-class talent tables). Each row reconciles against your world into **in-system / imported / missing** like the rest of the catalog. New `pgwr` source id with its own "Western Reaches" source-filter chip.

### Fixed
- **Western Reaches tables now appear in the Tables tab.** Catalog rows use the reserved `pgwr` source id, so the "Western Reaches" filter chip resolves them (it previously counted 0 because the rows were tagged with an unrecognized source).
- **Items tab spell reconcile.** The Items reconcile now also indexes the system spells compendium, so spell entries (the Western Reaches and Cursed Scroll spell lists) that ship in the base system no longer read "missing".
- **Journal catalog matches page names.** Grouped lore entries (e.g. a single "Gods" entry with a page per deity) now reconcile their per-page manifest rows, not just the entry name.
- **Class talent-table names** aligned to the system's `Class Talents: X` convention so they resolve in the class sheet's talent-table picker and reconcile in the Tables catalog.

### Notes
- Catalog manifests ship **metadata only** — names + approximate pages, no statblocks, spell/item text, table rows, or map images (same copyright stance as the existing catalog). The actual Western Reaches documents are built into your own world from your copy of the book; they are **not** distributed with the module.
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**.

## [0.6.0] — 2026-06-18

Bundles the previously-unreleased v0.5 (importer hub completion) and v0.6 (catalog-driven dashboards) work.

### Added
- **Six-tab importer hub.** The hub now carries a management dashboard for every document type — **Import / Tables / Monsters / Items / Journal / Scenes** — replacing the earlier Import + Tables + Monsters layout. Journal and Scenes tabs show per-crawl deploy/backup and pin-resolution status above their catalogs.
- **Catalog-driven dashboards (Monsters / Items / Journal / Scenes).** Each tab now works like the Tables tab: a content-free DRAFT manifest of what each Cursed Scroll contains is reconciled against your world (system compendia + the managed suite) into **in-system / imported / missing**, shown as collapsible source→category groups with status-filter chips. Missing rows carry an **Import** button that seeds the Import-tab paste box. Loose name matching lets a DRAFT name still resolve to a differently-dressed world document.
- **Global source filter.** A source-facet filter below the tabs scopes every dashboard at once (Core / CS1–CS6 / Western Reaches).
- **Double-click a catalog row to open its document.** On the Monsters / Items / Journal / Scenes tabs, double-clicking (or pressing Enter on) any in-system or imported row opens that actor / item / journal / scene sheet — the same affordance the Tables tab already had.
- **Per-item Items catalog.** The Items catalog now enumerates the individual contents of each Cursed Scroll's item sets — poisons (CS2), new weapons (CS4), new gear (CS5), and the druid/sorcerer/mage spell lists (CS4–CS6) — as individual rows instead of single aggregate "Item Set" entries, so each shows its own in-system / imported / missing status.

### Fixed
- **Journal prose enrichment over-linking.** The "Re-link journal pages" sweep now scopes prose auto-linking to the system + managed-suite packs with a homograph stoplist, so it no longer links incidental words (e.g. "bears") to unrelated compendium items.

### Notes
- Catalog manifests ship **metadata only** (names + approximate pages) — no statblocks, item text, or map images, the same copyright stance as the table manifest. They remain a DRAFT and are flagged as such in the UI.
- Verified against Foundry VTT **14.364** and Shadowdark **4.0.6**.

## [0.4.0] — 2026-06-17

### Added
- **Cursed Scroll adventure import.** Paste a hexcrawl key and the importer recognizes per-hex entries (clustered statblock/lore anchors), builds editable drafts, and commits them as a "Hexcrawl" journal entry in the managed suite — with real page-UUID `@UUID` cross-links between hexes (out-of-set references stay plain text).
- **Scene builder & map pins.** A GM uploads an adventure map and the module deploys a calibrated gridless Scene (Level-document background) with Note pins bound to the imported journal pages, using a two-click calibration against the map's own hex lattice. Multi-row maps split into linked North/South scenes.
- **Numbered location maps & cross-linking.** City and keyed-location maps support numbered location pins with a journal-page cross-link sweep that mirrors the table re-link pass (idempotent, link-preserving), plus a bundle round-trip proof for the new content.

### Fixed
- Keyed location cards render with the correct layout in the importer dashboard.
- Dashboard previews are scrollable.

### Chores
- Enforce LF line endings via `.gitattributes` to prevent CRLF working-tree churn from non-Unix editors/sync tools.

## [0.3.0] — 2026-06-11

### Added
- **Managed compendium suite.** The module now owns one world compendium per imported document type (Actors / Items / Roll Tables / Journals / Scenes) under a "Shadowdark Enhancer" sidebar folder, organized by source (CS1–CS6, Custom). ALL imported content lives in the suite and is rolled/read directly from the packs — nothing materializes into the world, keeping player load times lean. One-click migrations move pre-existing imported actors and tables into the suite (originals preserved in `_Backup (pre-suite)` folders — never deleted).
- **Importer hub.** The crawl-bar "Roll Tables" button is now **Importer**: a three-tab hub (Import / Tables / Monsters). The Import tab is a universal paste box — Ctrl+A an entire PDF, paste once, and a deterministic segmenter routes statblocks to a Monsters grid, dice tables to a Tables preview, and item entries to an Items grid, with an always-visible Skipped list (nothing silently dropped). Per-section commits or one Import-all.
- **Bulk items importer.** Magic items (recognized by Benefit/Bonus/Curse/Personality riders) and gear lines (recognized by cost patterns) parse into editable drafts and commit to the items compendium with conflict handling. Imported items resolve in loot/treasure linking the same way imported monsters resolve in encounters (system compendium wins on name clash).
- **Monsters dashboard.** Per-source census of imported monsters vs. what your imported tables reference, gap lists with one-click "seed the paste box" shortcuts, and a guided duplicate-cull workflow (confirm-gated, pack copies only).
- **Tables dashboard absorbed into the hub** with source filter chips (Core / CS1–CS6 / Western Reaches) and per-row import seeding.
- **"Re-link pack tables" maintenance action.** Re-links every compendium table to your imported monsters and items — tables imported before newer content pick up the new links. Idempotent and link-preserving.
- **"Fold legacy Loot pack into Items" maintenance action.** Copies the legacy Loot pack's items into the managed items compendium (originals stay; the legacy pack is locked as a backup).

### Changed
- **Loot fabrication and the loot catalog now persist to the managed items compendium** instead of the legacy world "Loot" pack.
- **Uniform encounter-table categorization.** All monster-encounter tables across CS1–CS6 are now categorized as Random Encounter Tables; rumors, zone pickers, weather, and keyed-adventure tables stay under Hexcrawl/Adventure.

### Fixed
- Treasure-table re-linking no longer rewrites content-identical tables (row-order churn eliminated; re-runs are exact no-ops).
- Compendium ownership is applied correctly on v14 (players can observe imported monsters; GM-only packs stay GM-only).
- ALL-CAPS magic-item blocks pasted alongside statblocks are no longer mistaken for monster lore and skipped.
- Gear names imported from cost lines no longer retain their price text ("Probe Rope, 5 gp, 1 slot" imports as "Probe Rope").

## [0.2.3] — 2026-06-10

### Added
- **Bulk Monster Importer.** Paste a raw statblock dump (even a full-PDF Ctrl+A copy) into the new importer: a deterministic local parser turns it into per-monster editable drafts (low-confidence fields flagged), a preview/edit grid lets the GM correct anything, and a visible "skipped blocks" list shows everything the parser left out — nothing is silently dropped. Creating files the NPCs into a managed world compendium with per-name conflict handling.
- **Imported monsters auto-link in encounter tables.** `MonsterLinker` now indexes the imported world pack alongside the system bestiary (Core wins on name clash), so Cursed Scroll / Western Reaches encounter tables resolve `@UUID` links to your imported monsters automatically.
- **In-place backfill for previously imported monsters.** A new "Backfill existing…" action on the importer (plus a headless `game.shadowdarkEnhancer.monsters.backfill()` API) upgrades already-imported NPC actors to full fidelity — Title-Cased attack names, system-default icons, real functional Spell items, auto-resolved art, and the complete stat-block Description — without re-importing and without touching user edits. Dry-run preview first, idempotent on re-run, never deletes a pack.

### Changed
- **Imported/created NPCs now match base-system fidelity.** Attack item names are Title-Cased, items get the system-default icons, spellcasters get working Spell items, art auto-resolves where available, and the full stat block lands in the actor Description.
- **UI polish batch (audit P1+P2).** Accessibility (focus visibility, form labels, icon-button names), WCAG contrast fixes, gold-palette unification, more legible HP bars, parchment texture on GM windows/cards, light-theme coverage, and emoji→Font Awesome icon migration in chat templates.

### Fixed
- **NPC sheet crash on plain-text item descriptions.** Every renderable NPC item description (Feature, Special Attack, Spell — including spells matched from third-party packs) is now stored as HTML, fixing the `unrecognized expression` crash when opening affected sheets.
- **Statblock parser hardening** for real-world PDF dumps: wrapped stat lines, page numbers, lore blocks, and section headers no longer corrupt adjacent monsters.

## [0.2.2] — 2026-06-08

### Added
- **Roll Tables hub: catalog extended through Cursed Scroll #1–#6.** The shipped table manifest grows from 162 (Core only) to **268** canonical tables — adding Cursed Scroll #1 (18), #2 (32), #3 (14), #4 (20), #5 (11), and #6 (11). The hub's source chips now populate `CS1`–`CS6` with their counts, and every CS table shows its status (in-system / imported / missing) and page · die · source like the Core entries.

### Changed
- **Every matrix table now carries real column names.** Multi-column tables (encounter zones, NPC names, pit-fight grids, district encounters, etc.) ship their actual column labels instead of placeholder `Roll 1..N` — including correctly-split multi-word columns such as `Wealthy District` / `Working District` / `Poor District` and `% Modifier`. So a one-paste import of a CS encounter matrix splits into the right per-column tables (e.g. `Encounter Zone → Sea / River / Mountain / Forest`).
- **Table Registry classifier seed updated for Cursed Scroll #3–#6**, so `tables.organize()` files the new CS tables into the correct category folders.

## [0.2.1] — 2026-06-07

### Added
- **Roll Tables hub: Import moved in as a second tab.** The hub is now a two-tab window — **Dashboard** + **Import**. The paste-parse-preview-create importer (and its matrix/grid splitting, loot-row linking, and manifest seeding) moved out of the Encounter Roller into the hub; a Dashboard row's **Import** button opens the Import tab pre-seeded, in-window. The Encounter Roller drops back to four tabs and the old cross-window bridge is retired.
- **Roll Tables hub: search box.** A search field filters the dashboard by name, source, category, sub-category, and page. It composes with the status and source chips and hides non-matching rows (and now-empty sub-categories/categories).
- **Roll Tables hub: collapsible sub-categories.** Each sub-category is now its own `<details>` with a caret and a count, so it can be folded independently — matching the category sections.
- **Roll Tables hub: source in the row meta line.** Each row now reads `p270 · d100 · Core` (a short per-source label: `core`→Core, `cs1`–`cs6`→CS1–CS6, the Western Reaches guides→PG WR / GM WR).
- **Roll Tables hub: live auto-refresh.** The dashboard re-renders automatically whenever the world's roll tables change. Verified via MCP that adding/editing/deleting a row fires only the `*TableResult` hooks (not `updateRollTable`), so the hub subscribes to all six table/result hooks, coalesced through one debounced render — the `N/expected rows` verify chips now stay live.
- **Automatic enrichment on import.** Importing an encounter or treasure table now links it to the compendium automatically (encounter → monster `@UUID` links + inline-roll counts; treasure → real items) — folded into `TableImporter.createTable`, so the hub importer, the plain importer, and Loot Setup all enrich without a manual step. The Treasure 0-3 tier table auto-links the moment it's bound.
- **Loot card: player-claimable coins.** The coin pile gets a **Claim** button — the first player to click it has the gp/sp/cp added to their character. It shares the assignment lock with the GM **Assign** dropdown (which is kept), so coins still go to exactly one actor, first-come.
- **Loot Setup: "Use Shadowdark's Treasure 0-3".** A one-click button on the 0-3 slot copies the Shadowdark system compendium's built-in `Treasure 0-3` into the world (filed under Imported Tables/Loot), enhances it, and binds it as the tier 0-3 loot table. Re-running reuses the existing import instead of duplicating.

### Changed
- **Roll Tables hub: manual Link buttons removed.** With enrichment now automatic on import, the per-row **Link** button and the bulk **Link encounters / Link treasure** buttons are gone.
- **Roll Tables hub: "Refresh" relabeled "Re-check compendiums".** In-world table edits now update the dashboard automatically, so the manual button's remaining job is re-scanning the system compendium / forcing a full re-check; its label and tooltip say so.
- **`LootCatalog.linkTableItems` is now non-destructive.** Rows already linked to a document are preserved verbatim instead of being re-resolved by name — confirmed via MCP that re-resolving would otherwise drop links the item index doesn't cover (e.g. the system Treasure 0-3's `shadowdark.magic-items` rows). This also makes the auto-enrich-on-import path idempotent.

### Fixed
- **Roll Tables hub search no longer scrambles typed text.** Typing "Treasure" could come out as "urereasT" — the window re-rendered on every keystroke, rebuilding the input and resetting the caret. Search is now a pure client-side row filter with no re-render, so the input keeps focus and the caret stays put.

## [0.2.0] — 2026-06-06

### Added
- **Random Encounter system — Phase 1 Slices 1a + 1b.** New `Encounter` button on the Crawl Bar (replaces the disabled placeholder); the old `shadowdark-crawl-helper` module is no longer needed.
  - **Left-click** opens the Encounter Roller window (4-tab ApplicationV2 — Roll Tables tab functional in 1b; Build Table / Browse NPCs / Monster Creator render as labeled stubs so the UI shape is locked from day one).
  - **Right-click** opens a custom context menu with the Encounter Check, an adjustable d6 threshold (1–5 in 6), and the current active-table label with a clear button.
  - **Dragging a `RollTable`** onto the button sets it as the active encounter table.
  - The check itself rolls a real `Roll("1d6")` and posts a HIT/MISS chat card via `Roll#toMessage` so Dice So Nice fires and the roll is persisted. On HIT, the game pauses (configurable), the roller auto-opens, and the active table auto-rolls.
  - Result card shows monster + count, plus three per-Shadowdark-RAW facets: **Distance** (1d6 → Close/Near/Far), **Activity** (2d6 → Hunting/Eating/Building·nesting/Socializing·playing/Guarding/Sleeping), and **Reaction** (2d6 + CHA → Hostile/Suspicious/Neutral/Curious/Friendly). Each facet has its own re-roll button. A CHA-modifier stepper (clamped ±5) recalculates the Reaction band without re-rolling.
  - **Post** posts the full card to chat; **Place** drops N tokens of the rolled monster on canvas (snapped to grid, offset in a row to avoid stacking, ESC cancels).
  - Window position persists per-user across sessions.
  - **Table preview** — selecting a table shows its contents inline (roll range, monster name, appearing formula) so you can see what's in the table before rolling, not after.
  - **Per-row Post + Place buttons in the preview** — pick a specific entry from the table without rolling. Click 📋 to post that entry to chat (with Distance / Activity / Reaction facets rolled like a normal encounter), or 🎯 to skip to token placement. Useful for "I want a Beastman here, not a random roll." Flavor rows get Post only (nothing to place).
  - **Flavor entries supported in result + preview.** Roll tables often mix monster entries with pure flavor lines (e.g. "A dry gust of wind extinguishes all torches and lamps."). The preview now shows flavor rows italicized with a 📜 prefix and wraps long text; rolling a flavor row produces a clean text-only result card (no Distance/Activity/Reaction, no Place button, just Post-to-chat). Previously a flavor roll showed "Table draw produced no monster" as if it were an error.
  - 10 new world settings: `encounterThreshold`, `encounterTableUuid`, `encounterRollGMOnly`, `pauseOnEncounter`, `autoRollActiveTable`, `encounterSources`, and others for customizing encounter behavior.
  - **Browse NPCs tab — Slice 1d.** Filter and explore Shadowdark NPC sources (world actors, current scene, `shadowdark.bestiary`, and any installed Actor compendium packs). Source-toggle pills at top let you pick which packs feed the list. Search by name, filter by alignment (L/N/C) and level range, sort by any column. NPC rows are draggable with the standard Foundry Actor payload — drag onto the canvas to drop a token, or (when Slice 1c lands) into a Build Table slot.
  - **Browse NPCs v2 — sidebar layout + integration with Build Table.** Repositioned filters into a left sidebar (matches Vagabond's layout density). Added filters for **Movement** type (close/near/etc.), **Dark-Adapted**, **Spellcaster**, and **Abilities** (text-search NPC Feature names — e.g. type "petrify" to find every NPC with a Petrify feature). New **Attack column** shows the per-round attack count plus icons for melee/ranged/spellcaster/dark-adapted. New **`+` button** per row adds that NPC to the next empty Build Table slot and jumps to the Build tab. Compendium NPCs are now deep-loaded on first source-activation (cached for the session) so feature/attack data is available for filtering and display. Window widened to 920px to fit the new sidebar without crushing the results table.
  - **Monster Creator tab — Slice 1e-v.** Added **Bestiary Loader** popover with real-time search. GMs can now load any NPC from world or compendium sources directly into the creator. The loader uses smart art resolution (handling community token mappings) and maps existing item data (Attacks, Specials, Features) into editable creator cards. This allows for rapid monster variants by loading a base creature, tweaking its stats/actions, and saving it as a new world actor.
  - **Monster Creator tab — Slice 1e-iv.** Added **Features** section with a Quick-Pick catalog of 14 common monster features (Magic Resistance, Pack Tactics, Regenerate, Undead, etc.). GM can author multiple "NPC Feature" items per monster, either from the catalog or as custom entries. Features are automatically created as embedded documents when saving. Refined the Quick Add UI with micro-labels and better tooltips. Improved the Save logic with more robust Shadowdark schema mapping for all item types.
  - **Monster Creator tab — Slice 1e-iii.** Added **Actions** section with a Quick-Pick catalog of common monster attacks (Fist, Bite, Claw, etc.) and special actions (Breath Weapon, Poison, etc.). GM can now author multiple "NPC Attack" items (specifying count, bonus, damage, and range) and "NPC Special Attack" items per monster. These items are automatically created as embedded documents when the NPC is saved to the world.
  - **Monster Creator tab — Slice 1e-ii.** Added **Stats** (HP, AC, Ability modifiers, Dark-Adapted), **Movement** (Type, Note), and **Spellcasting** (Ability, Atk Bonus) sections. The Save action now maps these fields to the created world NPC actor's system data. Section collapse state and text-input cursor focus continue to be preserved across renders.
  - **Monster Creator tab — Slice 1e-i.** Author a Shadowdark NPC from scratch via the new fourth tab in the Encounter Roller. Sub-slice 1e-i ships the shell + Identity + Description sections and a working Save (writes a new world Actor with name, alignment, level, portrait, token image, and description). Section collapse state is preserved across renders. Subsequent sub-slices will add Stats, Movement, Spellcasting, Actions, Features, and a Bestiary loader.
  - **Build Table tab — Slice 1c.** Author your own encounter tables in the Encounter Roller. Pick a die (d4, d6, d8, d10, d12, or 2d6), name the table, then drag NPCs from Browse / sidebar / compendium onto numbered slots — or click an empty slot and type freeform flavor text (e.g. "A dry gust extinguishes torches"). Each slot has editable min/max range inputs so 2d6 (and other multi-dice) tables can group outcomes into bands. Per-slot Post / Place icons let you use a specific entry without saving the table; the per-slot Clear ✕ button blanks one slot, and the Remove button deletes the slot entirely. "+ Slot" appends a new slot at the next free face. Save as Roll Table writes a world `RollTable` with one `TableResult` per non-empty slot (appearing formula stored on `flags["shadowdark-enhancer"].appearing`); the save does NOT change the active encounter table — that stays under your control. Inline warnings flag gaps and overlaps in your slot ranges; errors block save.
- **Init result badge on cards** — once a combatant has an initiative value (combat or out-of-combat), the dice button position is replaced by a small gold-bordered badge showing the rolled number. So you can see at a glance who's rolled and what they got.
- **Thrown weapons appear as dual entries in the action menu.** Weapons with the `thrown` property (Spear, Dagger, etc.) now show up twice in the Weapons tab — once as their native melee variant and once as a `(thrown)` ranged variant. Clicking the thrown variant passes `attack: { type: "ranged" }` to `actor.system.rollAttack`, so the system's roll generator uses the ranged ability mod (DEX) and the weapon's thrown range. Mirrors the character sheet's RANGED ATTACKS section, which already lists thrown weapons alongside true ranged weapons.
- **Melee vs ranged at-a-glance icons on weapon entries.** Each weapon row in the action menu now shows a small color-coded prefix icon — warm-red crossed swords (`fa-swords`) for melee, cool-blue crosshairs (`fa-crosshairs`) for ranged — so you can tell attack mode without reading the damage label or the `(thrown)` suffix. Applies to both PC weapons and any other weapon-kind entries.
- **NPC attack count prefix (×N) for multi-attack monsters.** Shadowdark NPC stat blocks list attacks like "2 fist +4 (1d6)" or "4 tendril +4" to indicate attacks-per-round. The action menu now reads `system.attack.num` and prefixes entries with `×N` when greater than 1 (`×2 Fist`, `×4 Tendril`), so the GM sees the per-round count at a glance. Clicking a multi-count entry rolls N attacks back-to-back — one chat card per swing.
- **NPC attack description shows range, modifier, and special** in the stat-block format. Each NPC Attack entry's right-side label is now `(Range) +Bonus Damage [+ special]` — e.g. `(Close) +4 1d6` for a Fist, `(Far) +4 2d6` for a thrown Rock, `(Close) +0 1 + disease` for a Giant Rat bite. Reads the same way as the monster manual entry, so a GM doesn't have to remember which fields the menu was showing.
- **PC weapon entries now show the to-hit modifier** in the same stat-block format — e.g. `(Close) +3 1d8` for a longsword, `(Near) +1 1d6` for a thrown dagger. The bonus is sourced from the system's own `actor.system.getAttacks()`, so it reflects ability mod, magic AE bonuses (e.g. a +1 longsword), talents, and any other Active Effects — same value that lands on the actual attack roll. As a side effect, thrown-weapon dual entries (melee + ranged) are now produced directly by the system rather than hand-rolled, so they stay correct if the system updates its rules.
- **Import Tables tab: paste book/zine text into a Roll Table.** A new Import Tables tab in the Encounter Roller turns text copied from a Shadowdark book or zine into a real `RollTable`. Paste into the textarea and click Parse: the parser (`table-importer.mjs`) splits the paste into blocks on blank lines, reads leading die tokens of the form `N` or `N-M` (hyphen, en-dash, or em-dash; zero-padding allowed), and folds non-token continuation lines into the previous row so wrapped result text reassembles. It infers the formula from a `dN` header line when present, otherwise from the highest range value, and falls back to numbering each line `1..n` when a block has no range tokens at all. Each parsed table renders as an editable preview grid where the GM can fix the name, formula, replacement toggle, individual row ranges and result text, add rows, and delete rows before anything is written. Parse also surfaces non-blocking warnings for range gaps, overlapping rows, and rows that reach past the formula's die size.
- **GM-gated table creation with rename/replace conflict handling.** Create writes one reviewed preview table to the world; Create all iterates every parsed table. Creation is gated to the GM (`game.user.isGM`) and warns non-GMs rather than failing silently. When a world table of the same name already exists, a three-button DialogV2 offers Create as Copy (the default, which suffixes a unique ` (N)` name), Replace Existing (deletes the old table first), or Cancel; dismissing the dialog is treated as Cancel. Tables are created with `displayRoll: false` so Dice So Nice can animate roll-table draws (which it requires, alongside core "Animate Roll Table Roll" being off). Successfully created tables drop out of the preview list, and Create all reports how many of the batch were written.
- **Category classifier files imported tables into Imported Tables/<type> folders.** Imported tables are auto-sorted into a folder tree under a top-level `Imported Tables` folder. A pure, priority-ordered keyword classifier (`table-categories.mjs`) guesses each table's category from its name across a Shadowdark-grounded taxonomy — Something Happens!, Random Encounter, Character Names, NPCs, Monsters, Traps, Hazards, Rumors, Carousing, Adventures, Talents, Background, Titles, Loot, and an Other fallback — with ordering rules so that, for example, "NPC Names" lands under Character Names while a table literally named "NPCs" lands under NPCs. The preview head exposes the guess as a type dropdown the GM can override, plus a Custom option that reveals a free-form folder-name field. On create, the resolved category label becomes the destination subfolder and is stamped onto the table as a `shadowdark-enhancer.tableType` flag.
- **Multi-column matrix tables split into one table per column.** A `dN Col Col Col` header whose data rows are grid-like is detected as a matrix and split into one preview table per column rather than one table with a multi-word name. The detector (`looksLikeMatrix`) only treats a block as a matrix when at least half its data rows have a cell-token count equal to the column count, so a prose table such as "d6 Probe Encounters" with sentence rows stays a single-die table instead of being shredded into columns. Matrix-derived tables are flagged best-effort in the preview ("Best-effort column split — check the cells") because multi-word cells can't always be cleanly separated; surplus tokens fold into the last column for the GM to verify.
- **Auto-link loot rows to compendium items with a link badge and unlink.** When a parsed table's category is Loot, each row's result text is matched against an index of installed compendium items (`loot-linker.mjs`, restricted to Weapon/Armor/Potion/Basic types, deduped longest-name-first and session-cached). A confident whole-word match — names of four or more characters, tolerant of a trailing plural "s" — links the row to that item. Linked rows show a chain-link badge with the item name in the preview and an unlink button to drop the link. On create, the matched phrase in the result text is rewritten to a clickable `@UUID[...]{...}` enrichment so the row draws as a real item link in chat; unlinking a row, or editing the text so the matched phrase is gone, leaves the row as plain text. Re-categorizing a table to Loot after Parse does not retro-link — Parse must be re-run.
- **Table Registry: auto-sort imported RollTables into 12 numbered category folders.** Adds a `TableRegistry` (scripts/encounter/table-registry.mjs) that reads every RollTable in the world, parses each name into `{source, page, displayName, subCategory}` — recognizing Core PDF, Cursed Scroll, and Lost Citadel naming conventions plus the source folder it sits in — and assigns it to one of twelve Codex groups (classes, creation, magic, downtime, encounters, hazards, npcs, adventure, settlements, monsters, treasure, misc). Classification is two-tier: a curated 246-entry seed map keyed on lowercased `displayName` is consulted first, falling back to an ordered keyword classifier (`classifyByKeyword`) that resolves overlaps like "Settlement: Slums" vs "Slums Encounters" by checking structural-generator keywords before encounter keywords. Calling `game.shadowdarkEnhancer.tables.organize()` files tables from the known source folders (Shadowdark Core PDF Tables, Cursed Scroll PDF Tables, Loot) into numbered folders like "05 Encounters, Rumors, Weather & Event Prompts" — numbered so the sidebar sorts in group order — and is idempotent: it skips tables already moved out of a source folder, only creates folders for groups that actually have moves, and supports `{ dryRun: true }` to return a plan summary (with per-group counts and seed-vs-classifier tallies) without writing. Query helpers `all()`, `byGroup(id)`, `encounterTables()`, `groups()` (group ids, labels, and counts), and `lootTables()` are exposed under `game.shadowdarkEnhancer.tables`, all backed by a build cache that auto-invalidates on `createRollTable`, `deleteRollTable`, and `updateRollTable`.
- **Right-click Mark / Unmark as Loot Table on RollTables.** Adds a RollTable directory context-menu toggle (scripts/encounter/loot-table-tag.mjs) so a GM can flag any table as loot via right-click. "Mark as Loot Table" sets `flags.shadowdark-enhancer.isLootTable` and "Unmark as Loot Table" clears it, with the two entries shown mutually exclusively based on the target row's current state and gated to GMs. The Loot Generator picker now sources its options from tables that are either marked this way OR were filed as `tableType:"loot"` by the Roll Table Importer, so Importer-tagged tables appear automatically; when no table is marked yet the picker falls back to listing all tables and flags `noneMarked` to drive a curation hint, so the window is never empty. Marking or unmarking re-renders the Loot Generator window if it is open, and `organize()` additionally auto-marks the known hoard tables (Treasure 0-3 through 10+, Diabolical Treasure, Sea Wolf Plunder) as loot so they surface in the picker without manual tagging.
- **Loot generation engine — roll a treasure tier into a claimable hoard card.** A new `lootTierTables` world setting maps each of the four Shadowdark treasure bands (levels 0-3, 4-6, 7-9, 10+, defined as metadata-only records in `treasure-data.mjs`) to a GM-supplied `RollTable` uuid, and `LootGenerator.tierForLevel` / `tableForLevel` resolve a character level to the right band and its bound table. `generate(level, {rolls, tableUuid})` draws that table the requested number of times via `table.draw({displayChat:false})` and classifies each drawn `TableResult` (read from `_source.documentUuid` / `_source.name` to dodge v13 deprecation getters that throw on text rows): a linked-document result resolves to a compendium item, coin text aggregates into a `{gp,sp,cp}` total, and everything else becomes a flavor note. The resulting batch is posted as a claimable loot chat card through the `generateHoard` API, which warns and bails when no table is mapped for the rolled tier. The window can also roll a hand-picked table at its real tier via `tierForTable` (its `lootTierTables` binding, else inferred from the table name) and `levelForTier`, instead of defaulting to level 0.
- **Priced text rows resolve into real items instead of dead flavor text.** A drawn text row like "Fragment of a sapphire (30 gp)" used to fall through to an unclaimable note; now the roll path runs a link-or-fabricate chain. For each text row the generator first tries `LootLinker.findLink` against an index of existing Weapon, Armor, Potion, and Basic items across installed packs (which includes the `world.loot` catalog), and on a hit links the real document; otherwise, if the row carries a parseable price (or names a deferred/magic type), it calls `fabricateTreasureItem` to build a real Basic treasure Item from the stripped name and parsed value, picking a category-appropriate Foundry core icon (gem, jewelry, scroll, wand, potion, weapon, ring, vessel, book, and so on) via `pickTreasureIcon`. Delivery resolves either a linked `uuid` or a stored `fabricate` spec through `_resolveItemData` when an item is claimed, given, or deposited, and stamps the rolled gp onto the created item's `system.cost` whenever the rolled value exceeds the linked document's own gp cost — so a claimed item is never worth less than what the card showed. The companion `linkTables` API rewrites a GM loot table's rows into draggable DOCUMENT results in place, preserving each row's range and weight while keeping coin entries as text.
- **gp value and XP-tier scoring with adjustable thresholds.** Each generated item is scored for gold value and an XP tier through the pure helpers in `loot-value.mjs`: `itemValueGp` reads a document's `system.cost`, `parseValueGp` falls back to the price in the row text, `bonusOf` reads a magic `+N`, and `isMagicItem` flags magic by type or a tight name regex. `scoreItem` then maps the result onto Shadowdark's quality tiers — Poor (0 XP), Normal (1), Fabulous (3), Legendary (10) — where magic items land at Fabulous or, at `+3` and above, Legendary, and mundane items cross from Poor to Normal to Fabulous at two `world`-scoped thresholds, `xpThresholdNormal` (default 10 gp) and `xpThresholdFabulous` (default 150 gp). The batch carries a per-item value and tier plus a rolled-up `totalGp` / `totalXp` (coins included), the loot card shows a per-row gp tag and a "Hoard: N gp · N XP" footer, and posting the card fires a `shadowdark-enhancer.lootScored` hook with the totals, items, and source for other modules to consume.
- **Unique Feature attachment on rolled valuables.** Non-magic valuables can pick up a cosmetic Unique Feature when generated — both catalog items drawn from the `world.loot` pack and treasure Items fabricated from a priced row. The generator finds a feature table from the `uniqueFeatureTableUuid` setting (or any world table whose name matches "unique feature"), and for each qualifying item rolls `1d100` against the `uniqueFeatureChance` setting (default 100%); on success it draws one feature string from that table. The feature is shown on the loot card next to the item name and is appended to the item's description as an italic "Unique feature: …" line when the item is claimed, given, or deposited, so the flavor travels onto the real Item the player ends up holding.
- **Auto-drop hoard cards for defeated NPCs on combat end.** A new `deleteCombat` hook (gated to the GM and the `lootDropEnabled` setting, on by default) scans the ending combat for defeated NPCs — flagged defeated or at zero HP — and rolls loot for each. The table used is the NPC's own `lootTable` flag if set, otherwise the tier table for the NPC's level, and the drop is gated by the NPC's `lootDropChance` flag (default 50%) against a `1d100` roll. Each successful drop generates a one-roll batch tagged with the NPC's name as its source and posts it as its own claimable hoard card.
- **Loot delivery chat card.** A generated loot batch posts as a single shared chat card listing each rolled item plus a coin pile. Players claim items with a `Claim` button: the claim is first-claim-wins and routed through the module's raw socket to the GM as the single authoritative writer, which marks the item's flag claimed first (optimistic lock) before creating the real Item on the claiming character (`game.user.character`, or the first owned `Player` actor). Coins are GM-assigned — a dropdown of `Player` actors plus an `Assign` button adds the gp/sp/cp directly to the chosen actor's `system.coins`. Card state (tier, coins, per-item `claimedBy`/`claimedByName`, `coinsAssigned`) lives in the message's `shadowdark-enhancer` flags, so every client renders the same card and re-renders on each claim. Posting the card also fires the `shadowdark-enhancer.lootScored` hook with the hoard's gp and XP totals.
- **GM Give-to-Player control on the delivery card.** Alongside each unclaimed item the GM sees a `Give` button that hands the item to any player character without waiting for a claim. It opens a DialogV2 recipient picker listing `Player` actors that have a player owner, then marks the item claimed (under a `gm:<actorId>` sentinel) and creates the Item on the selected actor. The control is GM-only — non-GM clients have the `.sde-loot-gm` elements stripped at render time.
- **Loot Generator window.** The crawl bar's `Forge & Loot` button (a disabled placeholder before) now opens a Forge & Loot menu whose `Loot Generator` entry launches the Loot Generator window — an ApplicationV2 singleton also reachable via `game.shadowdarkEnhancer.loot.open()`. The window offers a table picker, a `Roll Loot` button that appends the result to a newest-first roll history, and a `Roll for Selected Token` button that whispers a claimable delivery card privately to the controlled token's owners plus all GMs. Each history entry shows its items, coins, and notes, and carries its own actions: `Post to Chat` (posts the batch as a shared delivery card tagged with the table name) and `Give` (deposits the batch's items and coins straight onto a chosen recipient with no card). A `Clear History` button empties the list.
- **Loot Generator table picker filtered to loot-marked tables.** The window's table dropdown is scoped to RollTables marked as loot (including any auto-tagged `loot` by the Roll Table Importer) rather than every table in the world. When no tables are marked yet it falls back to listing all tables and shows a hint to right-click a table in the sidebar and choose Mark as Loot Table to narrow the list; when the world has no RollTables at all it shows a note to load a loot table from a PDF or build one via the Roll Table Importer. Rolling the selected table labels it at its real loot tier — the picked table's UUID is resolved to its tier (via its tier-table binding or its name) and then to that band's representative level.
- **Magic Item Forge — roll-then-refine magic-item assembler.** A new `MagicForgeApp` window (ApplicationV2 singleton, opened via `game.shadowdarkEnhancer.forge.open()`) assembles a magic item from the GM's loaded attribute tables. Clicking Forge calls `MagicForge.rollDraft`, which picks a type with a d6 (armor, weapon, potion, scroll, wand, or utility), draws descriptive text for the base, feature, benefit, curse, and personality lines from the matching world RollTables named in `TYPE_TABLES`/`PERSONALITY_TABLES`, and applies the module's own count/bonus curves: `bonusFromRoll` maps 1d12 to a 0–3 enhancement, `benefitCountFromRoll` yields 0–2 benefits, and curse and personality each gate on a d6. The window exposes every part as an editable field with a per-row reroll die (`MagicForge.rerollPart`), add/remove-benefit controls, and curse/personality toggles. Create Item assembles the data via `assembleItemData` (building the description HTML and a Shadowdark `Weapon`/`Armor`/`Basic` type), applies the +N bonus, and drops the result into a find-or-create "Forged Items" folder. The bonus mechanic follows the live-verified Shadowdark shape: weapons get two non-transferred `add` ActiveEffects on `system.bonuses.attackBonus` and `system.bonuses.damageBonus` plus `system.magicItem`, while armor sets `system.ac.modifier` directly. A `forgeTableOverrides` world setting lets the GM point an attribute slot at a specific table UUID instead of relying on name matching.
- **Forge & Loot menu on the crawl bar.** The crawl strip's Forge & Loot button now opens a small popover menu offering Loot Generator and Magic Item Forge, wired to `game.shadowdarkEnhancer.loot.open()` and `game.shadowdarkEnhancer.forge.open()`. The menu is GM-only, positioned above the button, and dismisses on outside click. The button's left-click originally jumped straight into the Loot Generator (with the menu only reachable via right-click), but `6796492` repointed the primary left-click handler at the menu so both tools are offered without a hidden context menu; right-click still opens the same menu.
- **Forge the loot — upgrade a placeholder into a real +N item in place.** Loot rows that resolve to a magic placeholder (an item flagged magic whose document carries the module's `needsRefinement` flag) are tagged `forgeable`, and the GM gets a Forge button beside them — on both the loot delivery chat card and the Loot Generator's roll history. Clicking it opens the Magic Item Forge pre-seeded from the placeholder's name: `inferSeedFromName` parses the type from keywords (sword/axe/bow → weapon, mail/plate/shield → armor, plus scroll/wand/potion, defaulting to utility) and reads the bonus from a `+N` in the name, and `rollDraft` honors that seed instead of rerolling type and bonus. When the GM hits Create Item, an `onCreate` callback rewrites the original loot entry in place — repointing its `uuid`, `name`, and `img` at the freshly forged item and clearing the `forgeable` flag — so the card's Claim/Give flow now hands out the real, working +N item rather than the placeholder. On the chat card this is guarded against forging an already-claimed entry, both by the template (the Forge button only renders for unclaimed rows) and by `_handleForgedReplace` bailing when the entry is already claimed.
- **Loot Setup onboarding screen for binding your own treasure tables.** A guided `LootSetupApp` window (ApplicationV2, single-instance) presents four labeled slots — Treasure Levels 0-3, 4-6, 7-9, and 10+ — each annotated with its Shadowdark Core Rulebook page reference and a synthetic format hint. Because the actual treasure tables are The Arcane Library's content, the module ships none of it; instead each slot has a textarea where the GM pastes the table from their own copy (or the free Quickstart Set). "Import & bind" runs the pasted text through `TableImporter.parse`, creates a world RollTable named for the slot and filed under Imported Tables/Loot with a `loot` category tag, and writes the new table's UUID into the `lootTierTables` setting keyed by that tier. A progress line reports how many of the four tables are ready, and bound slots show a green check badge with the table name. All write actions are GM-gated and re-render on success; empty or unparseable input raises a warning notification instead of binding.
- **Bind an already-imported world table to a loot tier.** When the world already contains RollTables, each slot in the Loot Setup screen also offers a "Use an existing table…" dropdown (alphabetized, with the currently-bound table preselected) and a Bind button, so a GM who has already imported their treasure tables can wire them to a tier without re-pasting. Selecting a table and clicking Bind writes its UUID into `lootTierTables` for that tier and re-renders.
- **Set up loot tables button, first-run GM nudge, and openSetup API.** The Loot Generator window gains a "Set up loot tables" button (after Roll for Selected Token) that opens the Loot Setup screen; the button gets a `needs-setup` highlight outline whenever fewer than all four tiers are bound. On the first `ready` after install, a GM whose `lootTierTables` has fewer than four bound tiers sees a one-time info notification pointing them to that button, tracked by a new world-scoped `lootSetupSeen` boolean so it never fires twice. The screen is also exposed programmatically as `game.shadowdarkEnhancer.loot.openSetup()`.
- **Roll Tables hub — a status dashboard for every canonical Shadowdark table.** A new Roll Tables button on the crawl bar (and `game.shadowdarkEnhancer.tables.openHub()`) opens `RollTablesApp`, an ApplicationV2 dashboard that reconciles the shipped table catalog against the live world. `TableHub.buildRows()` walks the manifest and classifies each entry as `system` (the Shadowdark compendium `shadowdark.rollable-tables` ships it), `imported` (a matching RollTable exists in this world), or `missing` (neither — the GM must add it from their own book). Rows are grouped into collapsible category/sub-category sections mirroring the Core Rulebook's own organization, each with a summary tally. World tables are matched EXACTLY when they carry the module's `manifestId` flag, and best-effort by normalized name for tables imported before this feature — with a source-hint guard (`worldSourceHint`) that rejects cross-book false matches so a Core entry won't bind to a same-named Cursed Scroll table.
- **Row-count verification against shipped fingerprints.** The manifest ships a content-free fingerprint per table — `rows` (expected result count) and an optional one-way `hash` — and never any book text. For each imported table the hub runs the pure `verify()` comparison (`table.results.size` vs. the expected `rows`) and shows an `N/expected rows` chip that turns from green to amber when the counts disagree, surfacing a Re-import button so the GM can re-paste from their copy. Row count is the load-bearing signal; hash comparison only fires when both sides carry a hash, otherwise it's skipped and not required to pass.
- **Status and source filter chips.** The summary tally doubles as a status filter: clicking the All / In system / Imported / Partial / Missing chips toggles the visible rows, and a second row of source chips (Core, CS1–CS6, Western Reaches) filters by book — the two Western Reaches guides stay distinct in the data but share one chip via its `match` list. The two filters compose, and the status counts re-scope to the active source so the chip numbers stay honest. Double-clicking any row that resolves to a real table opens its RollTable sheet to roll or review.
- **Seeded Missing→Import that stamps a manifestId flag.** Each Missing (or row-count-mismatched) entry gets an Import button that opens the existing Roll Table Importer pre-filled from the manifest — name, die, page, inferred `formula` (via `formulaFromDie`), the entry's Category and Sub-category, and its `manifestId`, plus matrix/grid metadata. When that import is created, the importer assembles a Category/Sub-category folder path and `createTable` files the table under nested `Imported Tables` folders matching the hub's layout, then stamps the `shadowdark-enhancer.manifestId` flag onto the new RollTable, so the hub thereafter matches it exactly by flag instead of by fuzzy name. The GM only has to paste the rows.
- **Matrix and grid auto-split with shipped per-cell width fingerprints.** Manifest entries that are multi-column grids (e.g. NPC Qualities, the Adventure Generator, Rival Crawler party names) carry `matrix: true` with a `columns` list, and the importer's `parseMatrixByColumns` splits one pasted grid into N per-column RollTables, each stamped with a per-column manifestId (`columnManifestId` → `entryId:column-slug`). Such entries show a status of `partial` until all N sub-tables exist, with a `present/total imported` badge. To make the split deterministic even from a single-spaced PDF copy where column alignment is lost, the manifest ships a `widths` fingerprint — the per-row word count of each cell (a count, never the words themselves) — and when a row's widths sum to its token count the parser slices cells by those counts authoritatively, falling back to delimiter/token heuristics with a per-row warning otherwise.
- **Table enrichment — monster @UUID links and treasure compendium items.** Imported encounter and treasure tables can be linked to their compendia via per-row Link buttons and the hub's Link encounters / Link treasure bulk actions (also `game.shadowdarkEnhancer.tables.enrich(uuid, kind)`). For encounter tables — bringing them up to the system's Ruin-Encounters standard — `enrichEncounterText` rewrites each result's text into the standard `description` field, wraps bare dice counts in inline rolls (`2d4` → `[[/r 2d4]]`), and embeds `@UUID` links to monsters found in the world's `shadowdark.monsters` compendium — matching whole words case-insensitively, longest-name-first, non-overlapping, and preserving the text's own casing and plural. For treasure tables it links each row into a real compendium Item through the loot catalog. Enrichment is GM-only, idempotent (already-linked spans and inline rolls are protected so re-running never double-links), and ships no content — it only wires the GM's own tables to compendia already in their world.
- **Monster Mutator: clone an NPC, apply mutations, spawn a mutated copy.** A new mutation pipeline (`scripts/encounter/monster-mutator.mjs` + `mutation-data.mjs`) carries a 76-entry catalog drawn from Shadowdark's own tables — "Make it Weird" splits into Physical Form, Combat, and Mind & Magic (12 each), and the Monster Generator supplies 20 Strengths and 20 Weaknesses. Each mutation's `apply(draft)` rewrites the Creator's draft model in place against real NPC schema fields: AC and level deltas, new `NPC Attack` / `NPC Special Attack` actions, innate spellcasting (`_makeSpellcaster` sets the spell-attack bonus to track level per RAW), ability-modifier bumps, and movement notes for flight/swim/burrow/teleport; everything abstract (immunities, gazes, senses, behaviors, damage vulnerabilities) becomes a free-form `NPC Feature`. `createMutatedActor(baseUuid, mutationIds, customName)` clones a compendium-or-world source via the Creator's `actorToDraft`, applies the mutations, and builds a brand-new world actor through `draftToActorData` so the original is never touched, stamping provenance under `flags[MODULE_ID].mutation` (base UUID, base name, mutation IDs, timestamp) and posting a chat card that lists the applied mutations. It is exposed at `game.shadowdarkEnhancer.mutator.create`.
- **Mutations section in the Monster Creator.** The Creator gained an in-window Mutations panel: category pills filter the 76 boon/bane cards, clicking a card toggles it into the selection, and a live preview shows the mutated name assembled from each mutation's prefix/suffix fragments (`generateMutatedName` guards against re-stacking a prefix the base name already leads with). "Apply to Draft" mutates the in-progress draft in place, while "Create Mutated Copy" deep-clones the draft and spins off a new world actor without disturbing the draft you're still editing — both paths run the exact same `applyMutations` engine so a mutation is defined only once. A "Clear" action drops the current selection. A `getConflict`/`conflictGroup` machinery is wired for future mutually-exclusive mutations, though no current RAW entry declares one.
- **Shared NPC index behind Browse and the bestiary loader.** A common row model (`scripts/encounter/npc-index.mjs`) now converts Shadowdark NPC actors into a compact, browse-friendly shape using native stats — level, current/max HP, AC, alignment code, movement with notes, summarized attacks, feature names, spellcasting, and dark-adapted — rather than a ported Vagabond model. `createNpcIndexRow` summarizes attacks across `NPC Attack` and `NPC Special Attack` items (per-attack count, best attack bonus, melee/ranged/special kinds, and a DPR estimate computed by `averageDice` from the damage formula). `filterNpcIndexRows` supports name search, alignment, level/HP/AC ranges, movement type, dark-adapted, spellcaster, ability/feature search, and attack-kind filters, and `sortNpcIndexRows` handles numeric columns with NaN sorted last. Both the Browse NPC window and the Creator's bestiary-loader sidebar draw from this single index (the loader routes through the same EncounterBrowse load/filter/sort pipeline) so their filtering and sorting behave identically across world, scene, and compendium sources.
- **Spell picker attaches real rollable spells to an NPC.** The Spellcasting section gains a compendium-backed picker built on a new `spell-index` data layer that reads compendium and world `Spell` items by index (not full documents) so searching hundreds of spells stays fast. Type a name or pick a tier and matching spells appear (capped at 40, sorted by tier then name); clicking + attaches one, with already-attached spells flagged and shown as removable chips. Attaching resolves the full spell source via `fromUuid` and stashes its `toObject()` so save pushes it verbatim as a fresh embedded copy. Loading an existing NPC that already carries Spell items round-trips them back into the picker.

### Changed
- **Bundled Shadowdark treasure tables stripped for copyright.** The four Shadowdark treasure tables previously shipped verbatim in `treasure-data.mjs` and were reachable at runtime through `loot-catalog.buildCatalog` and the `game.shadowdarkEnhancer.loot.buildCatalog` API. That bundled text is gone: `TREASURE_TABLES` is now metadata-only band records (`{id, min, max, label}`) used purely for level→tier resolution, `buildCatalog` and its API entry are retired, and the now-unused `parseTables` / `TREASURE_TABLES` imports were dropped from `loot-catalog.mjs`. The generation engine instead draws from GM-supplied tables (loaded from the GM's own rules via the Roll Table Importer or Loot Setup) and fabricates a real item at roll time whenever a row isn't already catalogued, so generation still yields claimable items with zero bundled rules content.
- **Delivery card header now names the loot's source.** The chat card header prepends the batch source — typically the rolled table name (or, for combat-end drops, the defeated NPC's name) — ahead of the "Loot — Treasure {tier}" label. The source is persisted into the card's message flags so it survives re-renders after claims and coin assignment.

### Fixed
- **Roll Tables: active table now persists across window close/reopen.** The constructor was reading `encounterTableUuid` (a full UUID like `"RollTable.abc123"`) into `_selectedTableId` and then treating it as a bare table ID for `game.tables.get(...)` — the lookup always failed, so the dropdown fell back to "-- Select Table --" on every reopen even though the active table was still configured. Now resolves UUID → ID at construction via `fromUuidSync`. Also replaced the non-standard `game.tables.getByUUID(...)` call in `rollActiveTable` with `fromUuidSync` for consistency.
- **Roll Tables: Place button now places tokens one at a time at the cursor.** Original implementation used `ev.data.getLocalPosition(...)` (PIXI v6 API) — broken on Foundry v13 / PIXI v7+ where federated events have no `.data` field, so the handler threw silently and nothing placed. First fix swapped to camera-viewport-center placement; this revision restores per-click placement (better UX, more like Vagabond's drag-from-sidebar feel) using DOM-level `pointerdown` + `canvas.mousePosition` instead of the PIXI federated event chain — capture-phase + `stopPropagation` so Foundry's TokenLayer doesn't intercept. Click N times to place all N tokens; press Esc to cancel the remainder; toast shows progress between clicks. Compendium actors are still imported as world actors first.
- **Roll Tables: placed tokens now show the correct image.** Many `shadowdark.bestiary` NPCs have their illustration in `actor.img` while their `prototypeToken.texture.src` is the default mystery-man path — so `actor.getTokenDocument()` returned a blank-looking token. Detect that case and fall back to `actor.img` for the placed token's texture so the placed token matches what you see in the table preview and on the actor sheet.
- **Action menu dropdown was unselectable** after the click-transparency fix below. The dropdown panel is mounted as a sibling of `.sde-strip-inner` (not a descendant), so it inherited `pointer-events: none` from the wrapper. Added explicit `pointer-events: auto` on `.sde-strip-action-panel` so the tabs and item buttons inside it receive clicks again.
- **Top strip no longer eats clicks meant for other modules' UI.** The strip's outer positioning wrapper (`#shadowdark-enhancer-strip`) spans the full top region of the viewport for layout purposes but is mostly empty visual space — only `.sde-strip-inner` (cards + gradient) is actually visible. The `.sde-strip-visible` modifier was overriding the base `pointer-events: none` back to `auto`, which made the entire 1253×140 wrapper rectangle a click trap. Now the wrapper stays click-transparent always; `.sde-strip-inner` carries `pointer-events: auto` so the visible content still receives clicks. Also lowered `z-index` from `65` to `50` so we sit appropriately above the canvas but below Foundry's sidebar/hotbar and other module overlays. Fixes a conflict where shadowdark-extras' tray handle couldn't be clicked to close once expanded.
- **OoC initiative now includes DEX modifier** (matching the combat tracker). Previously the formula was `1d20 + roll.initiative.bonus`, which is just the extra-bonus field most PCs leave at 0 — so a DEX 14 PC was rolling a flat d20. Now mirrors the system's `_ActorBaseSD._modifyRollData` exactly: `1d20 + abilities.dex.mod + roll.initiative.bonus`, advantage applied via `shadowdark.dice.applyAdvantage`. OoC and in-combat initiative now produce identical totals for the same actor.
- **OoC initiative chat card now uses the Shadowdark system's native roll-card style** — same look as the system's Attack Roll / Damage Roll cards, including the reroll-icon affordance and prominent total. The InitiativeManager dispatches through `shadowdark.dice.rollFromConfig` (which is what `actor.system.rollAttack` / `castSpell` use internally) instead of the generic `Roll#toMessage`. Falls back to the generic path if the system API isn't available.
- **Reroll button now syncs the new total back to the strip.** The system's reroll-icon creates a fresh chat message via `rollFromConfig` rather than updating the original, so previously the strip's badge kept the old number. The rollConfig now carries a `sdeOocTokenId` tag; a `createChatMessage` hook reads the new total from any message bearing that tag and updates `CrawlState.oocInitiative` so the badge re-renders to match.
- **Out-of-combat initiative wasn't cleared between crawl sessions.** `startCrawl` and `endCrawl` now wipe `oocInitiative` so a fresh crawl always starts clean — previously a roll from an earlier session lingered and hid the dice button on the card.
- **Import-tab context always populated and conflict-dialog name always escaped.** The `importData` context block is now assembled on every render instead of only when the Import tab is active, because the import-tab markup lives in the DOM on all tabs and a null context would dereference `importData.*` and break the template. The name shown in the "Table Already Exists" conflict dialog is now run through `foundry.utils.escapeHTML` unconditionally (previously a `?.` optional call that fell back to the raw string), so a table name containing markup can't inject HTML into the dialog.
- **Loot rolls never yield "(nothing)" from blank table rows.** PDF-imported loot tables often carry empty TEXT rows with no text and no document link, and a draw landing on one produced an empty result. Each of the requested rolls now re-draws (up to 12 attempts) until the draw produces actual content — a linked item, a non-zero coin amount, or real flavor text — and a zero-sum coin result no longer counts as content, so a roll always returns something meaningful while a mostly-empty table still can't loop forever.
- **Give recipient picker uses DialogV2.wait().** The Give-to-Player recipient dialog was rewritten from a hand-rolled `new DialogV2(...).render()` wrapped in a Promise to the module's proven `DialogV2.wait()` pattern. The chosen actor id flows out of the OK button's callback return; Cancel and closing the dialog resolve to null, so a dismissed picker no longer gives the item to anyone.
- **Readable Claim/Give/Assign buttons on the dark loot card.** The card's buttons inherited Foundry's default chat-button styling, which rendered the labels dark-on-dark and unreadable against the card's dark background. The Claim, Give, and Assign buttons are now styled with element+class selectors specific enough to win the cascade — a solid accent-colored Claim, an outlined Give, and a hover brightening — so the labels stay legible.
- **Loot card item name no longer stacks one letter per line.** In a narrow chat sidebar the non-wrapping flex row let the fixed-width Claim/Give/Forge buttons consume all the space, squeezing the item name down to roughly one character and stacking it vertically. The row now wraps and the name has a 6rem flex basis and min-width with `overflow-wrap: anywhere`, so the buttons drop to a second line and the name wraps at word boundaries.
- **Rolled loot resolves to real Items, not self-referencing TableResults.** Reading the linked item UUID had fallen back to the TableResult's own id, so every text row was treated as a document pointing at itself — claiming produced nothing real. The document UUID is now read only from `_source.documentUuid`; rows with no linked document (plain text rows) fall through to the link/fabricate path that builds a real claimable Item. Rolls now resolve to actual Items and a claim creates a real item on the actor.
- **TableResult uuid read avoids the v13 deprecation getter.** Resolving a result's document previously read `documentCollection`/`documentId`, which trip the v13 `TableResult#documentCollection` deprecation getter on every document-result roll. The lookup now prefers `documentUuid`/`uuid` and reads the underlying collection/id from `_source`, and the result classifier likewise checks `_source`, so live rolls are warning-free.
- **Forge drew empty attribute text after the v13 TableResult split.** `MagicForge._drawText` read each drawn row's content from the deprecated `TableResult#text` getter, which in Foundry v13 returns the (usually empty) description half of the old field — so every base, feature, benefit, curse, and personality line came back blank, leaving the forge composing generic names like "+1 Weapon" and logging a v15-breaking deprecation warning on each draw. It now reads `name || description`, restoring real table text (e.g. composing "+1 Greatsword" from the base-weapon table) and silencing the warning.
- **Loot Generator window rolls and labels a picked table at its real tier.** The window's roll path always passed level 0 to `LootGenerator.generate`, so hand-picking a Levels 10+ treasure table still produced a card labeled tier 0-3 / level 0 — the visible GM workflow ignored the tier bindings entirely. New `LootGenerator.tierForTable` resolves a table's tier by reverse-lookup in `lootTierTables` first, then falls back to inferring it from the table name, and `levelForTier` returns that band's minimum character level; the window now rolls at the resolved level. Each of the 0-3, 4-6, 7-9, and 10+ tables now labels as its own tier, and an unbound table falls back to level 0 without error.
- **Use-existing controls in Loot Setup never rendered.** The existing-table dropdown and Bind button were gated by `{{#if hasTables}}` inside the per-slot `{{#each slots}}` loop, where `hasTables` resolved against the slot context — which has no such property — and was always falsy, so the entire bind-existing path shipped invisible and non-functional. The guard now reads `@root.hasTables`, restoring the select and Bind button on every slot when the world has tables.
- **Escape world- and table-derived text in hand-built HTML (XSS hardening).** Several paths built markup by interpolating untrusted strings — actor and token names, portrait `img` src paths, table-derived row text, forged item feature/benefit/curse/virtue/flaw/trait copy, and loot unique-feature text — directly into `innerHTML`, chat cards, and item descriptions. A determined value like `<img src=x onerror=...>` would have executed. All of these now route through a new `util/esc.mjs` `esc()` helper that encodes `& < > " '`, covering the magic-item forge descriptions, both loot-delivery create paths plus the recipient option label, the crawl-strip member name and portrait, the monster-mutator actor name and portrait, and the NPC action-menu item label.
- **Gate raw-socket move rollback and crawl-state pushes on sender identity.** The `movement-tracker` move-rollback handler and the `crawl-state` state-push handler previously acted on any inbound socket message, relying only on UI gating. Both emitters now stamp the sender's `userId` on the message, and the receivers validate it: a rollback request is honored only when the claimed sender is a GM or an owner of the token's actor, and a crawl-state push is accepted only when the claimed sender is a GM. Note that raw `game.socket` sender ids are advisory rather than authenticated, so this stops casual and accidental cross-client misuse rather than a forged-id attack; the GM-only world setting remains the authoritative store for crawl state.
- **Migrate TableResult field reads to the v13 API (no more deprecation warnings).** Foundry v13 deprecated `TableResult#text`, `#documentCollection`, and `#documentId`, emitting a console warning on every read — which fired each time the Encounter Roller opened with an active table. The roller now resolves body text through a new `_resultBody(r)` helper that reads `description || name || text` (v13-first, keeping the legacy `text` fallback for unmigrated tables) and treats `TableResult#uuid` as the canonical document-reference check in the table preview, monster parsing, and roll-count scans. Saving a built encounter as a Roll Table now writes each result's title to `name` instead of `text`, round-tripping cleanly with the new read path.

## [0.1.22] — 2026-05-15

### Added
- **Out-of-combat initiative during crawl rounds.** Each PC card in crawl mode now shows the same per-card blue d20 dice button — click rolls `1d20 + system.roll.initiative.bonus` (advantage applied via the system helper) through `Roll#toMessage`, so the chat card and Dice So Nice both fire just like a combat initiative roll. Result stored in `CrawlState.oocInitiative` and the strip cards reorder by initiative descending. Useful for surprise/reaction order, marching order checks, anything that needs initiative without firing up the combat tracker.
- **"Reset Init" button on the crawl bar** (visible only when at least one OoC initiative roll is stored). Clears `oocInitiative` so the dice buttons return on each card for a fresh round.

## [0.1.21] — 2026-05-15

### Changed
- **Action menu (Weapons / Spells / Abilities) now available in crawl mode too.** Previously the hover-tab dropdown was combat-only. Players need to cast utility spells, browse weapons, or trigger class abilities during exploration too — the gate has been dropped, so any card the user owns shows its action menu in any mode.

## [0.1.20] — 2026-05-15

### Fixed
- **Crawl-strip initiative dice click now triggers chat cards and Dice So Nice.** Previous version called `Combatant#rollInitiative()` directly which bypasses Foundry's message pipeline (no chat, no 3D dice). Now routes through `Combat#rollInitiative([id])` which is the same path Foundry's sidebar combat tracker uses — generates the "Avorn rolls for Initiative!" chat message and Dice So Nice picks up the 3D roll automatically.

## [0.1.19] — 2026-05-15

### Fixed
- **Roll Initiative dice button could stay visible after rolling** in some edge cases (slow hooks, custom dialog flows, etc.). Added a defensive explicit `queueRender()` after the dice click — the existing `updateCombatant` hook already covers the normal path, but this guarantees the dice icon refreshes once the roll commits, even if a third-party module delays the hook.

## [0.1.18] — 2026-05-15

### Added
- **Per-card Roll Initiative dice button.** In combat, every combatant card whose `initiative` is null and whose actor the user owns (or the GM) now shows a glowing blue d20 in the top-right corner. Clicking it calls `combatant.rollInitiative()` and the button disappears once an initiative is set. Pulses gently to invite the click.

## [0.1.17] — 2026-05-15

### Fixed
- **Luck pill showed `1` instead of `0` in Pulp Mode when the count was actually zero.** Shadowdark's Pulp Mode (`shadowdark.usePulpMode` setting) makes Luck numeric and ignores the classic-mode `available` boolean. The strip was reading `available: true` (leftover from before pulp mode was enabled) and showing 1 even when `remaining === 0`. Now the display gates on the setting: pulp mode shows `remaining` directly; classic mode keeps the existing `remaining > 0 ? remaining : available ? 1 : 0` logic.

## [0.1.16] — 2026-05-15

### Fixed
- **Active-turn highlight stuck on the wrong token after rolling initiative mid-combat.** When the GM starts combat BEFORE rolling initiative (a common mis-step), the active-turn pointer sticks on whoever was first by default order. Once initiative gets rolled, Foundry re-sorts `combat.turns` but preserves the previously-active combatant's index — so the highlight stayed on the wrong token even though the cards visually reordered. Now: on any initiative change in round 1, once every combatant has an initiative, the active turn snaps to position 0 (the actual top of the order). Debounced so a `rollAll()` burst lands once.

## [0.1.15] — 2026-05-15

### Fixed
- **Bar didn't show the "Begin Encounter" intermediate state when you pressed Combat.** The bar's render logic already had the right branches, but `CrawlState` only listened for `combatStart` (fires after `startCombat()`), so after the Combat button created+activated the encounter the mode stayed `crawl`/`off` and the bar rendered the crawl branch. CrawlState now also listens for `createCombat` — pressing Combat flips mode to `combat` immediately, the bar renders `Begin Encounter | Add Tokens | Delete Encounter`, and clicking Begin Encounter calls `combat.startCombat()` which swaps the button to `End Encounter`.

## [0.1.14] — 2026-05-15

### Changed
- **PC Abilities tab now lists only `Class Ability` items** (the "Special Abilities" section on the character sheet — e.g. Avorn's Petrifying Gaze). Excludes passive Talents (Stone Skin, Ambitious, etc.) which belonged in the sheet's Talents block, not Special Abilities.

## [0.1.13] — 2026-05-15

### Changed
- **AC moved out of the pill row, now displays as a small badge directly beneath the actor's name.** Frees up horizontal space on the bottom pill row, which was getting crowded with Luck + Movement on PC cards.

## [0.1.12] — 2026-05-15

### Fixed
- **Luck pill never showed 1 when the actor had an unspent base Luck Token.** `_extractData` was reading `system.luck.remaining` first — but the base Shadowdark Luck Token lives at `system.luck.available: true` with `remaining: 0`. So a fresh PC with one unspent token displayed 0. Now: `remaining > 0` → show remaining; else if `available` → show 1; else 0.
- **Luck pill is now click-to-spend.** Clicking the shamrock pill on the strip calls `actor.system.useLuckToken()` and re-renders. Cursor + hover styling applied only when there's actually a token to spend.

### Added
- **AC pill on every card** (PC + NPC). Reads `actor.system.attributes.ac.value`. Renders as a small `AC 16` pill before the Luck/Movement pills. NPCs without AC fall back gracefully (no pill rendered).
- **PC Abilities tab** in the per-combatant action menu. New third tab (after Weapons / Spells) listing `Talent` and `Class Ability` items. Clicking dispatches to `actor.system.useAbility(itemUuid)` — passive talents (like "Ambitious") open a description card, active ones (like Avorn's "Petrifying Gaze") trigger their roll/check. Tabs hide when empty, so a Cleric without spells shows only Weapons + Abilities.

## [0.1.11] — 2026-05-15

### Changed
- **`far` mapping updated to 120 ft** (was 60 ft in v0.1.10). Far is "very long distance per turn" — distinct from `doubleNear` (60 ft). `special` and missing values still fall back to `combatMovementDefault` (30 ft).

## [0.1.10] — 2026-05-15

### Added
- **Per-NPC combat speed from `actor.system.move`.** NPCs in combat now use their statblock movement enum to compute the budget instead of the flat `combatMovementDefault` (30 ft) that PCs use. Mapping (from `shadowdark.config.NPC_MOVES`):

  | `system.move` | ft |
  |---|---|
  | `none` | 0 |
  | `close` | 5 |
  | `near` | 30 |
  | `doubleNear` | 60 |
  | `tripleNear` | 90 |
  | `far` | 60 |
  | `special` / missing | falls back to `combatMovementDefault` |

  Player Characters always use the module setting (Shadowdark has no per-PC speed). Crawl mode keeps the flat budget for everyone (overland pace, NPCs travel with the party).

### Changed
- **`MovementTracker.budgetFor(mode, tokenDoc?)` is now actor-aware.** When a `tokenDoc` is passed, the budget is computed from `_getBaseSpeed(actor, tokenDoc)` which reads the per-NPC enum; otherwise falls back to the mode setting. Strip's `_extractData` now passes the tokenDoc so an Acolyte's `60/60ft` reflects its `doubleNear` and a Snow Ape's `90/90ft` reflects its `tripleNear`. PCs still show `30/30ft`.
- **`remainingFor` fallback** now uses the same actor-aware budget when no `moveRemaining` flag is stored — so newly placed NPC tokens display their correct budget immediately, without needing to be added to a roster or move once.

## [0.1.9] — 2026-05-15

### Changed
- **Movement readout now shows over-cap overflow as a negative.** Previous versions floored `moveRemaining` at 0 once a token exceeded its budget — losing the information about how far over they went. When enforcement is off (the default for combat), the strip now displays the overflow as a negative number: e.g. moved 50 ft with a 30 ft budget renders as `-20/30ft` in red. Crawl enforcement (on by default) still blocks moves that would exceed budget, so crawl mode rarely goes negative unless the GM turns enforcement off.

### Added
- `.sde-strip-pill-over` CSS class — applied to the Mv pill when `moveRemaining < 0`. Red text, soft red background, bold weight, red walking icon. Stands out at a glance vs. the normal green pill.

## [0.1.8] — 2026-05-15

### Changed
- **Movement tracker rewritten as a faithful Vagabond Crawler port (deduction model).** The previous cumulative-`usedMovement` accumulator is replaced with Vagabond's `moveRemaining` deduction pipeline:
  - Each tracked token carries a `moveRemaining` flag (feet left this turn). Reset to full budget on `combatStart`, on every combat round/turn change, and at `startCrawl` / `nextCrawlTurn` / when added mid-crawl.
  - `preUpdateToken` computes the segment distance from `_source.x/y` (avoids Foundry v14's animation interpolation) and caches it in `_pendingDeduct[tokenId]`. `updateToken` reads the cache, subtracts from `moveRemaining`, deletes the entry, and re-renders the strip.
  - 5-ft rounding applied at every distance computation.
- **`SDETokenRuler` subclass (ported from Vagabond's `VCSTokenRuler`).** Extends `foundry.canvas.placeables.tokens.TokenRuler`. Walks the waypoint `previous` linked list summing pending `cost`, then colors segments + grid highlights green within budget, red over. Registered via `CONFIG.Token.rulerClass` for new tokens; explicitly installed on existing canvas tokens via `_installRulers()` from `init()` and on every `canvasReady`.
- **Rollback teleports + refunds.** The "Rollback Movement" token-HUD button teleports the token back to its turn-start position (with `teleport: true, animate: false` to bypass walls and skip movement accounting) and refunds the full base speed. Player clicks relay to the GM over the module socket.

### Added
- **`combatEnforceBudget` setting** (default `false`). Mirrors `oocEnforceBudget` for combat mode. Off by default — Shadowdark combat traditionally relies on player honesty, not hard enforcement.
- **`MovementTracker.remainingFor(tokenDoc, mode)`** — reads the per-token `moveRemaining` flag directly, falling back to the full mode budget when unset. The strip's `_extractData` now uses this instead of computing `budget - used`.
- **`controlToken` hook** clears stale ruler ghosts when token selection changes.

### Adaptations from Vagabond
- No per-actor speed lookup — budget comes from module settings (`combatMovementDefault` / `oocMovementBudget`).
- No Rush mechanic (combat caps at `moveRemaining`, floors at 0). No overloaded check. No terrain difficulty regions.
- No fly/swim/climb effective-mode resolution.
- Actor types `Player` / `NPC` (capitalized).
- `CrawlState.members` is a flat array of token IDs (Vagabond uses `[{actorId, tokenId, type}]`).
- `moveRemaining` stored on the **token** (not actor), since members are tracked by tokenId and the same actor may have multiple tokens.

## [0.1.7] — 2026-05-15

### Fixed
- **Movement tracker now counts cumulative path, not displacement from origin.** Previous versions measured straight-line Chebyshev distance from a fixed anchor to the token's current position — so moving forward 3 squares then back 2 displayed `1 square used` even though the player actually moved 5 squares. The tracker now accumulates the delta of every position change into a `usedMovement` flag per token, matching how TTRPG movement actually works:
  - Forward 3 → +15 ft
  - Back 2 → +10 ft (total 25 ft used, not 5 ft)
  - Back 1 more (returned to origin) → 30 ft used
- **Resets**:
  - Crawl: `Start Crawl`, `Next Crawl Turn`, and adding new members all reset `usedMovement` to 0 for the affected tokens.
  - Combat: `combatStart` resets all combatants; `combatTurn` resets only the new active combatant.
  - `Rollback to Turn Start` also resets `usedMovement` to 0 (you're back at the start of your turn).
- **Enforcement now uses cumulative.** With `oocEnforceBudget` on, a proposed move is refused if `currentUsed + delta > budget` — so the 90 ft crawl budget applies to total movement across the whole turn, not just current displacement.

## [0.1.6] — 2026-05-15

### Fixed
- **Movement tracker no longer reports fluctuating/random distances.** Foundry v14's TokenDocument `.x/.y` properties interpolate during the canvas movement animation — reading them mid-flight returned an in-between coordinate. The strip's render hooks fire many times during a drag, so the displayed "used" number bounced around and snapped to weird values. Movement tracker now reads `tokenDoc._source.x/y` (the data-model coords) for both anchor capture AND distance computation. The displayed used/budget is now stable from the moment the move commits.
- **Newly added crawl members had no anchor.** When the GM clicked "Add Tokens" mid-crawl to add a token that wasn't on the scene at `Start Crawl` time, the new token had no `crawlAnchor` flag → `usedFor` returned 0 → movement display stuck at full budget regardless of how far the token moved. `addMembers` now calls `MovementTracker.captureCrawlAnchorsFor(newIds)` so anchors are captured at the moment of joining.

## [0.1.5] — 2026-05-15

### Added
- **Game Master card in crawl mode** — out-of-combat strip now always renders a synthetic GM card at the end of the heroes row (cowled figure + crown badge). Represents the GM's turn in the crawl loop (encounter rolls, light ticks, etc.). Hidden in combat mode where Foundry's tracker drives turn order.

## [0.1.4] — 2026-05-15

### Fixed
- **PC weapon click did nothing.** `actor.system.rollAttack(weaponUuid)` takes a UUID, not an item ID — the menu was passing the ID so `fromUuid()` returned null silently. Now passes `item.uuid`.
- **PC spell click threw an error.** Same root cause for `actor.system.castSpell(spellUuid)`. Now passes `item.uuid`.
- **Strip render starved when canvas idle.** Reverted from `requestAnimationFrame` to microtask debounce (`Promise.resolve().then`) for the render queue. Foundry's canvas can pause rAF callbacks when the scene is idle, which prevented state-mutation re-renders (e.g. members added via Add Tokens) from landing without a manual refresh. Same fix as v0.1.0; regressed in v0.1.2's Vagabond port and now back.

### Changed
- **Strip combat order now mirrors initiative order, not heroes/NPCs split.** Combatants render as a single flat list in `game.combat.turns` order (respects the system's Clockwise Initiative setting). The `HEROES` and `NPCS` section labels are dropped in combat mode. Crawl mode still shows a `HEROES` group for clarity since it's PCs-only.
- **Crawl-mode strip is now opt-in via Add Tokens.** Previously the strip auto-included every Player token on the scene. Now `CrawlState.members` holds the explicit roster, populated by the bar's "Add Tokens" button when in crawl mode (mode-aware: combat mode still adds to the combat tracker). Starting a Crawl initializes with an empty roster; Ending a Crawl clears it.

### Added
- `CrawlState.members` (array of token IDs) + `addMembers(ids)` / `removeMember(id)` / `clearMembers()` mutators.

## [0.1.3] — 2026-05-15

### Added

- **Action menu HUD dropdown** (ported from Vagabond Crawler's `npc-action-menu.mjs` UI shell). During combat, each owned combatant card shows a hover-revealed tab strip BELOW the card:
  - **NPCs** → `[Actions] [Abilities]` — Actions tab lists `NPC Attack` + `NPC Special Attack` items (with damage label, e.g. "Claws  1d4 piercing"); Abilities tab lists `NPC Feature` items.
  - **Players** → `[Weapons] [Spells]` — Weapons tab lists equipped `Weapon` items (with `system.damage.oneHanded`/`twoHanded` + `system.range`); Spells tab lists known `Spell` items (not lost) with `T{tier} {damageType}` label.
- **Click-to-act dispatch** routes through Shadowdark actor methods:
  - PC weapon → `actor.system.rollAttack(itemId)`
  - PC spell → `actor.system.castSpell(itemId)`
  - NPC attack → `actor.rollAttack(itemId)` / `actor.system.rollAttack(itemId)` / item-sheet fallback
  - NPC feature → opens item sheet (passive description)
- **Floating panel** is appended to `#shadowdark-enhancer-strip` (not the card) so it escapes parent `overflow:hidden` clipping. Hover behavior preserves Vagabond's grace-timeout pattern (200ms) so moving from the card to the panel doesn't dismiss it.
- **Auto-close** on combat turn change.
- **CSS hooks** for the menu — `.sde-strip-action-tabs`, `.sde-strip-atab`, `.sde-strip-action-panel`, `.sde-strip-ptab`, `.sde-strip-panel-{item,name,body,empty}`, `.sde-strip-menu-dmg` — all using existing `--sde-bar-*` palette variables.

### Notes

- The full ~500-line `CrawlerSpellDialog` from Vagabond was intentionally dropped — Shadowdark has no mana system, no spell delivery types, no template placement workflow, and no Vagabond Character Enhancer integration (alchemy/beast-form/Step Up/Virtuoso/Summon/Gold Sink/Talents). Casting a Shadowdark spell defers entirely to `actor.system.castSpell(itemId)` which the system already provides.
- NPC type detection uses `actor.type !== "Player"` (Shadowdark uses `Player` and `NPC` actor types).

## [0.1.2] — 2026-05-15

### Changed

- **Faithful Vagabond Crawler port** of the top strip + bottom crawl bar. The previous Shadowdark-Enhancer-original strip/bar styling has been replaced with a verbatim duplicate of Vagabond Crawler's visual contract: gold tabletop accent palette, dark/light theme variables, wall-to-wall portrait cards (130x160), HP gradient bar with overlay label, luck/movement pills with shamrock + walking-person icons, vertical HEROES/NPCS group labels, dimmed inactive cards with `is-turn` pulse animation, and the same bottom-bar button gradients (start, next, combat, danger).
- **CSS namespace migration**: `vc-` → `sde-`, `vcb-` → `sde-bar-`, `vcs-` → `sde-strip-`, `--vc-*` → `--sde-*`, `--vcb-*` → `--sde-bar-*`. `vagabond-crawler-*` IDs → `shadowdark-enhancer-*`.
- **Bottom bar** mounts into `#ui-middle` (natural block flow, no `position:fixed`). Shows Start Crawl in off mode; phase badge + Next Turn + Add Tokens + Combat + M2 placeholders + End in crawl mode; Begin/End Encounter + Add Tokens + Delete Encounter in combat mode.
- **Top strip** mounts into `#interface` with dynamic left/right edge calculation against scene-nav + sidebar (faithful to Vagabond).
- **Single crawl turn counter** displayed in the strip's left badge in crawl mode (replaces Vagabond's heroes/gm phase model — Shadowdark uses one counter).
- **Icon registry**: ported `scripts/icons.mjs` from Vagabond verbatim, paths fixed to `modules/shadowdark-enhancer/icons/`. Added `icons/dragon-head.svg`, `icons/light-sabers.svg`, `icons/shamrock.svg`.

### Added

- **M2 placeholder buttons** (Encounter, Lights, Rest, Forge & Loot) rendered in the crawl bar with the `.sde-bar-disabled` class — dimmed but visible to preserve the bar's visual rhythm. Clicking shows a "coming in a later milestone" notification.
- **Combat-mode strip controls** in the left badge: prev/next round + prev/next turn buttons stacked around the round number.
- **Activate / End Turn buttons** on combatant cards (GM only), revealed on hover.

### Removed

- `templates/bottom-strip.hbs`, `templates/npc-action-menu.hbs` — Vagabond builds DOM imperatively in JS, so these handlebars templates are no longer needed.
- `scripts/stat-panels/{hp-panel,movement-panel,luck-panel}.mjs` — Vagabond inlines stat HTML into the card's overlay; the panel modules are obsolete.
- `scripts/npc-action-menu.mjs` — the per-card HUD dropdown is replaced by Vagabond's hover-revealed action tabs (currently rendered as just `.sde-strip-card-wrap`; full dropdown content deferred).

### Notes

- The strip's data extraction reads `actor.system.luck.{remaining,available}` (with fallback) instead of Vagabond's `actor.system.currentLuck`. Shadowdark schema parity.
- Movement display always uses the module setting (`combatMovementDefault` / `oocMovementBudget`) since Shadowdark PCs have no per-actor speed field, and NPC `system.move` is a string we don't parse yet.

## [0.1.1] — 2026-05-14

### Changed
- **Layout split**: PC/combatant cards now live in a TOP bar; mode pill + action buttons live in a BOTTOM bar. Matches Vagabond Crawler's two-bar pattern.
- **HP visualization**: replaced text `HP n/max` with a green progress bar + value overlay (red gradient when value <= 0).
- **Movement visualization**: inline walking-person SVG icon + `used/budget ft`.
- **Section grouping**: top bar now shows `HEROES` (green) and `NPCs` (red) section labels with colored borders separating the two card groups in combat mode.
- **Round badge**: standalone circular badge on the far left of the top bar in combat mode; bottom bar's Turn counter shows just `Turn N/M` (round moved out).
- **HUD dropdown direction**: combat HUD now opens BELOW the active combatant's card (cards live at viewport top); trigger label flipped to "▼ HUD ▼".

## [0.1.0] — 2026-05-14

First milestone: bottom-anchored Crawl Strip for Shadowdark RPG.

### Added

- Bottom-anchored Crawl Strip mounted at the bottom of the canvas. Mode-aware header (off / CRAWL / COMBAT).
- Three-state mode model (`off` / `crawl` / `combat`) with world-setting persistence + socket sync. Custom `sde.stateChanged` hook for subscribers.
- HP, Movement, and Luck stat cells per card. HP cell + Movement cell turn red when at zero / over budget.
- Luck pips read `actor.system.luck` (Shadowdark base system fields). Click a filled pip to spend via `actor.system.useLuckToken()`. NPCs render `—`.
- Out-of-combat marching-order initiative (`1d20 + bonus`, advantage via system's `applyAdvantage`); manual GM reset; result whispered to GM in chat.
- Crawl turn counter with per-token `crawlAnchor` capture; optional movement-budget enforcement (default 90 ft) via `preUpdateToken` hook.
- Combat-mode per-combatant cards in `game.combat.turns` order with active-combatant highlight and hidden-NPC filter (gated by setting).
- Bidirectional `token.hidden ↔ combatant.hidden` sync (GM-only).
- Movement tracker with `turnStart` flag capture on `combatStart` / `combatTurn`; cleared on `deleteCombat`. Chebyshev-distance grid math.
- Per-active-combatant HUD dropdown opening ABOVE the card: Status (HP ±1/±5, Spend Luck), Actions (Open Sheet passthrough), Movement (Rollback to Turn Start). Closes on outside-click and on `combatTurn`.
- HTML-escape helper (`scripts/util/esc.mjs`) used for actor name and portrait img-src interpolation.
- Coexistence warning notification when `shadowdark-crawl-helper` is enabled (suppressible via setting).
- Shadowdark-flavored palette (parchment/iron/torchlight) via CSS variables.

### Architectural decisions

- `MODULE_ID` lives in its own file (`scripts/module-id.mjs`) so other modules can import it at top level without participating in a circular-import temporal-dead-zone trap with the entry point.
- Render queue uses microtask debounce (`Promise.resolve().then(...)`) rather than `requestAnimationFrame` because Foundry's canvas pauses rAF callbacks when idle, starving renders.
- `oocInitiative` keyed by `tokenId` (not actorId) so duplicate-actor tokens in one scene get distinct rolls.

### Known limitations

- NPC `system.move` string ("near", "double near", "far", "near (fly)") not yet parsed; flat 30-ft combat budget for all NPCs.
- On-canvas ruler color does not turn red when over budget (Foundry v14 TokenRuler subclass API parity deferred). The strip's Movement cell turning red is the over-budget signal.
- If multiple `Combat` documents are created in quick succession the strip may briefly show "Round 0 / Turn 0/0" until the active combat settles.
