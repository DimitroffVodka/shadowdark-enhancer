# Compendium Packs

[← Wiki home](index.md)

Where the module stores imported and generated content, and how it protects
your world data.

---

## The content contract

Four core rules apply across all module operations:

1. **Document creation is GM-only.** Players cannot trigger imports or create
   compendium entries.
2. **Nothing is overwritten silently.** Conflict dialogs prompt you whenever an
   imported entry shares a name with existing content.
3. **Nothing is deleted automatically.** The module never deletes entire
   compendiums, and guided deduplication only removes copies inside module-managed
   packs.
4. **Re-importing is idempotent.** Committing the same PDF text multiple times
   will not create duplicate documents.

Everything the module creates is a standard Foundry VTT document. If you
disable or remove the module, all your imported content remains completely
functional and readable.

---

## The packs

Packs are standard world compendiums created automatically on demand when you
first import content. They appear in your sidebar organized under a
**Shadowdark Enhancer** folder.

The export/import bundle includes all suite packs, so curated items, generated
entries, and conflict states transfer cleanly between worlds.

### Generated artifacts and replace-always boundary

Documents created by module generation pipelines inside the managed Items pack
(`world.shadowdark-enhancer--items` / `sde-items`) that carry the explicit
`flags[\"shadowdark-enhancer\"].generated === true` flag follow the
*replace-always* contract: re-running their generator completely updates the
document, including art and properties.

Documents created by the Monster Spell Library also live in `sde-items` (under
`Monster Spells / <source>`) with
`flags[\"shadowdark-enhancer\"].monsterSpell.generated`. These do **not**
replace unconditionally; the module detects manual GM edits, flags them as
curated conflicts, and preserves your changes. See
[Monster Spell Library](Monster-Spell-Library.md).

### Managed RollTables in `sde-tables`

Beyond your imported PDF tables, the managed Roll Tables pack
(`world.shadowdark-enhancer--roll-tables` / `sde-tables`) maintains
internal tables:

- **Derived Rival Classes Table:** Stored under
  `flags[\"shadowdark-enhancer\"].forgeLoot.rivalClassTable`, this table stays
  synchronized with class readiness data. Same-name collisions resolve with
  Core rules precedence. On regeneration, compendium IDs are preserved and any
  manual row edits trigger a visible warning.
- **Supporting Table Manifest Stamps:** Supporting roll tables for NPC
  generation (including NPC Qualities, Party Name, Renown, Secret, Wealth, and
  Signature Tactics) are stamped with explicit manifest identifiers in
  `flags[\"shadowdark-enhancer\"]`. Lookups resolve by stamped identity, so you
  can freely rename tables without breaking generator lookups.

---

## Curated icon resolver

The module provides a built-in curated icon resolver that automatically assigns
high-quality, Foundry-native icons to imported items across weapons, armor,
basic gear, and book-specific treasure tables.

The registry currently contains **154 curated entries** across two key spaces:

- **Bare names (94 rows):** Source-agnostic items matching standard gear names
  across any book.
- **Sourced names (60 rows):** Sourced treasure tables from specific Cursed
  Scrolls.

### Active curated icon sets

| Category | Rows | Scope | Key details |
|---|---|---|---|
| **Weapons** | 37 | Bare | Full weapon census including distinct semantic picks for Lance, Morningstar, and Strikes. |
| **Armor** | 13 | Bare | 9 canonical armors plus 4 mithral spelling aliases sharing reviewed icon paths. |
| **Basic Gear** | 44 | Bare | 37 canonical gear items plus 7 quantity/spelling aliases (e.g. *Arrows (20)*, *Rations (3)*). |
| **Sea Wolf Plunder** | 20 | `cs3` | Specialized treasure from *Cursed Scroll 3* p68. |
| **Dead Bandit Loot** | 20 | `cs2` | Specialized loot from *Cursed Scroll 2* p68. |
| **Diabolical Treasure** | 20 | `cs1` | Magic treasure items from *Cursed Scroll 1* p68. |

### Art provenance and upgrade rules

When you import or re-import items, art is managed using explicit provenance flags
(`flags[\"shadowdark-enhancer\"].art`):

- **`custom`:** Any icon you manually assign or edit is stamped as custom.
  It is protected and **never overwritten** during future re-imports.
- **`curated`:** An icon assigned from the module's curated maps. If the
  module ships an updated icon in a future release, untouched curated items
  upgrade automatically on re-import.
- **`imported`:** Art extracted from a source text draft. Upgradeable on
  re-import.
- **`default`:** Standard generic type fallbacks. Upgradeable on re-import.

---

## Suite packs

| Pack id | Type | Label | Holds |
|---|---|---|---|
| `sde-actors` | Actor | Shadowdark Enhancer — Actors | Imported monsters and mounts |
| `sde-items` | Item | Shadowdark Enhancer — Items | Imported items, spells, gear, generated Monster Spells, and treasure |
| `sde-tables` | RollTable | Shadowdark Enhancer — Roll Tables | Imported tables and managed roll tables |
| `sde-journal` | JournalEntry | Shadowdark Enhancer — Journals | *(structural)* |
| `sde-scenes` | Scene | Shadowdark Enhancer — Scenes | *(structural)* |

> **Monster Spells consolidation:** Generated monster spells are stored inside
> `sde-items` under `Monster Spells / <source>` (such as `Monster Spells / CORE`
> or `Monster Spells / CS3`). Any content from older separate monster spell packs
> is automatically migrated into `sde-items` by the GM on world load, preserving
> custom edits.

### Character Options packs

Nested under a **Character Options** folder in the sidebar, matching the
system's grouping:

| Pack id | Label |
|---|---|
| `classes` | Classes |
| `talents` | Talents |
| `class-abilties` | Class Abilties |
| `spells` | Spells |
| `background` | Background |
| `ancestries` | Ancestries |

The collection labels and IDs (including the `Class Abilties` spelling) are
deliberately fixed because pack labels slugify to collection IDs
(`Classes` → `world.classes`). This ensures cross-pack `@UUID` links (such as
class → talent and spell → class) survive bundle exports across worlds.

The unused `patrons-and-deities` and `languages` packs have been retired. Gods
and patrons are imported as roll tables in `sde-tables` under
`Character Content > Patrons & Deities`, while languages link directly to the
core system's items. Any empty legacy copies in your world are removed on load.

---

## Source folders

Inside each pack, imported documents are filed into folders matching their
source book:

| You type | Folder |
|---|---|
| `cs1` … `cs6`, or `Cursed Scroll 1` … `6` | `CS1` … `CS6` |
| `pgwr`, `gmgwr`, `wr`, `Western Reaches` | `Western Reaches` |
| `core`, `Core Rulebook` | `CORE` |
| *(blank)* or `custom` | `Custom` |
| anything else | Upper-cased |

Both short codes and full names resolve to the identical folder, keeping the
Manage review tree's censuses consistent.

Specialized sub-folders are created under their source roots when needed:
- **`Monster Spells / <source>`** in `sde-items` for generated monster spells.
- **`Western Reaches / Weapon Properties`** in `sde-items` for canonical
  Western Reaches weapon Property documents (*Blast*, *Exploding*, and the Lance
  triple *Charge*/*Devastating*/*Mounted*).

---

## Link resolution

When resolving `@UUID` references, the module checks the **system's core
`shadowdark.*` packs first**, falling back to module world packs. This ensures
imported content links to core rulebook items whenever possible rather than
creating duplicates.

---

## Ownership permissions

- **`sde-actors`:** Configured with **Observer** permission for players so
  monster links display properly on player-facing sheets and cards.
- **All other packs:** Set to **None** for players (GM-only). Player-facing
  tools like the Character Builder and Merchant Shop access this data through
  GM-mediated helper routines.

---

## Moving content between worlds

Use the **Bundle export / import** tools in the Importer Hub's **Tools** menu.
This exports all managed packs into a single JSON file.

When imported into a new world, the bundle validates content, creates missing
items, and skips existing entries without overwriting. Because pack IDs match
standard slugified names, all internal `@UUID` links remain intact.

---

## Troubleshooting

**The packs don't exist yet.**  
Packs are created on demand. Import any entry and the relevant packs appear in
your sidebar.

**Content landed in a `Custom` folder.**  
The import was committed without a source label. Choose the appropriate book
from the Source dropdown before committing.

**A duplicate all-caps folder appeared (e.g. `CURSED SCROLL 1` beside `CS1`).**  
An unrecognized source label was used. Move the documents into the standard
folder; future imports using recognized labels will file correctly.

**Links broke after importing a bundle into a new world.**  
Confirm that Character Options packs retained their original labels during
import. Collection IDs derive directly from those labels.

**I want to delete a pack.**  
You can delete packs directly from Foundry's compendium sidebar. The module
never deletes non-empty compendiums automatically.

---

**Related:** [Importer Hub](Importer-Hub.md) · [Monster Token Art](Monster-Token-Art.md) · [API](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md)
