# Monster Spell Library

[← Wiki home](index.md)

The Monster Spell Library extracts monster-only spells from bestiary stat
blocks and makes them searchable in the Monster Creator—without altering the
monsters that supplied them.

---

## What the library is for

In Shadowdark, many monsters cast spells that do not exist in the standard
player spell list (such as a Naga's *Hypnotize* or a Lich's *Doom*). These
spells normally live only as embedded items inside individual monster stat
blocks.

The Monster Spell Library automatically extracts and indexes those spells into
a reusable compendium folder. When authoring an NPC in **Monster Creator**, you
can search and attach any monster spell with a single click.

---

## Where the spells land

All generated monster spells live inside the **Shadowdark Enhancer — Items**
compendium (`sde-items`), organized by source folder:

```
Shadowdark Enhancer — Items
└── Monster Spells
    ├── Shadowdark Core
    ├── Cursed Scroll 1
    ├── Western Reaches
    └── Other Sources
```

Generated entries use the naming convention **`Spell Name - Monster Name`**
(for example, **`Blast - Mage`**).

Source Actors keep their embedded spells. The library contains standalone copies
rather than live links, so an NPC you create retains its attached spell even if
the source monster is modified or removed.

---

## Quick use

1. **Automatic sync on load:** When you log in as the primary GM, the module
   automatically syncs Shadowdark Core and the managed Enhancer Actors pack
   (`sde-actors`) into the Items compendium. This sync runs once per module
   version.
2. **Importing monsters:** Importer Hub automatically syncs their embedded
   spells into the library after monsters are created or replaced.
3. **Browsing the library:** Open the **Shadowdark Enhancer — Items** compendium
   and navigate to the **Monster Spells** folder to inspect any generated entry.
4. **Using spells in Monster Creator:** Open **Monster Creator**, expand the
   **Spellcasting** section, and select **Monster Spells** in the source filter.
5. **Context and preview:** Search or filter the list. Click the arrow button on
   any entry to open the source monster sheet for context.
6. **Attach to draft:** Click **+** on a spell to attach a full embedded copy to
   your NPC draft.
7. **Manual sync:** To reconcile specific sources by hand, click
   **Build / Refresh**, choose your sources, review the dry run, and confirm.
   (GM-only).

---

## What the markers mean

When browsing monster spells in the Creator or compendium, several icons provide
status and validation hints:

* **Branch icon (Variant):** Marks a same-name spell whose mechanical definition
  differs from another spell with the same name. Tier or source details are
  appended to keep variants distinct.
* **Pencil icon (Curated edit):** Marks a generated entry with curated edits.
  A library refresh will preserve your custom version as a curated conflict
  rather than overwriting it.
* **Warning triangle (Data issue):** Marks suspicious source data in the original
  stat block, such as:
  * A stated DC that disagrees with `Tier + 10`
  * Bare dice notations written in prose instead of structured fields
  * A prose duration that contradicts the structured duration
  * Damage dice missing a roll formula
  * *Note: Validation reports these issues for your review; it never silently
    alters the source spell.*
* **Native icons:** Core-system entries and monster spells from
  Cursed Scrolls 3, 4, and 5 use visually matched Foundry-native icons from the
  built-in icon collection. Other imported sources retain their imported art.

---

## Document protection and safety

Generated spells carry the `monsterSpell.generated` flag to protect them from
accidental overwrites:

* **Import collision protection:** If you import an item pack that happens to
  contain an item with the same name as a generated spell, selecting **Replace
  existing** in the conflict dialog is safely downgraded to **Keep both**. Your
  imported item is created under an available name, and a warning notification
  names the protected spell.
* **Deleting generated spells:** If you intentionally want a generated spell
  replaced with a custom item, delete the generated spell from the compendium
  first, then re-import.
* **Curated conflict preservation:** Hand-edited spells survive subsequent
  library refreshes. The refresh resolves items by `libraryId`, so your curated
  edits remain intact and are reported during dry runs (e.g., `0 added, 0
  updated, 1 curated conflict preserved`).

---

<details>
<summary>How refresh, migration, and reconciliation work</summary>

### Provenance tracking

Each generated spell document stores metadata linking it back to its origin:
* Source Actor UUID and embedded Item ID
* Source compendium pack and package versions
* Content fingerprint of the spell mechanics
* List of all monster stat blocks providing an identical definition

### Refresh matching rules

Refresh matching relies on provenance rather than bare item names:
* **Consolidation:** Identical spell definitions from multiple monsters
  consolidate into a single library entry.
* **Variants:** Spells sharing a name but having different rules remain distinct.
* **Updates:** Untouched generated entries update automatically when their
  source monster changes.
* **Curated preservation:** Entries with hand-edited content become protected
  conflicts and are preserved.
* **Stale entries:** Spells no longer present in source monsters are reported as
  stale during scans but are not deleted automatically.
* **User items:** Hand-authored items created directly in the folder are ignored.

### Version-gated automatic refresh

On world activation, the primary GM client compares the
`monsterSpellSyncVersion` world setting against the module's version:
* If the setting matches the module version, the automatic refresh is skipped.
* If the module has updated (or on a fresh world), the GM client automatically
  refreshes spells from Shadowdark Core and the managed Actors pack (`sde-actors`).
* The version setting advances only after a complete, successful sync. If a sync
  fails or is aborted, the stamp remains unchanged to retry on the next load.

### Legacy pack migration and safety net

Earlier releases stored monster spells in a dedicated
`world.shadowdark-enhancer--monster-spells` compendium. This pack is
automatically migrated into `sde-items` on world load:
* Generated spells consolidate into `Monster Spells / <source>`.
* Custom GM-authored spells move to `Monster Spells / Other Sources`.
* Hand edits and custom art assignments are preserved.
* The legacy pack is emptied and retained as a deprecated shell.

If migration fails or cannot verify all copies, automatic refresh is deferred
to prevent new spells from colliding with unmigrated originals. A warning
notification prompts the GM to run a manual **Build / Refresh**.

### Focused Importer Hub syncs

When you create or replace monsters in the Importer Hub, a focused sync runs
specifically for the managed Enhancer Actors pack. Focused syncs queue behind
any running background refresh so no spells are missed.

### Manual Build / Refresh

The manual **Build / Refresh** dialog lets you selectively re-index chosen
sources at any time. It includes a source picker, dry-run preview, primary-GM
execution lock, and does not alter the automatic `monsterSpellSyncVersion`
stamp.

</details>

---

**Related:** [Monster Creator](Monster-Creator.md) · [Compendium Packs](Compendium-Packs.md) · [Importer Hub](Importer-Hub.md)
