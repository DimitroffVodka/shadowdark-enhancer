# Monster Spell Library

The Monster Spell Library makes monster-only spells searchable in Monster Creator without changing the monsters that supplied them.

## Quick use

1. Activate Shadowdark Enhancer or load the world as the primary GM. The module automatically syncs Shadowdark Core monster spells into **Shadowdark Enhancer — Items** under **Monster Spells / CORE** (or the respective source folder).
2. Import monsters through **Importer Hub** as usual. Importer Hub automatically syncs their embedded spells into the same library after the monsters are created or replaced.
3. Open the **Shadowdark Enhancer — Items** compendium and navigate to the **Monster Spells** folder to browse the generated library. Every entry uses **Spell Name - Monster Name**, such as **Blast - Mage**.
4. Open **Monster Creator**, expand **Spellcasting**, and choose **Monster Spells** in the source filter.
5. Browse or search the results, then use the arrow button to open a source monster when you need context.
6. Click **+** on a result to attach a full embedded copy to the NPC you are building.
7. If you need to reconcile selected sources manually, click **Build / Refresh**, choose the sources, review the dry run, and confirm it. Only the primary active GM can run this flow.

Source Actors keep their embedded spells. The library is a reusable collection of copies, not a set of live references, so an NPC keeps its attached spell even if the library later becomes unavailable.

## What the markers mean

- Automatically maintained generated entries show their source monster using **Spell Name - Monster Name**. A branch icon marks a same-name spell whose actual definition differs from another same-name spell; tier or source details are added when needed to keep variants unambiguous. A curated conflict keeps the GM's edited name as well as its content.
- Core-system entries and monster spells from **Cursed Scrolls 3, 4, and 5** use visually matched Foundry-native icons from the built-in `public/icons/` collection. Source Actor spells are never modified; generated entries from other imported sources keep their imported icon.
- A pencil icon marks a generated entry with curated edits. Refresh preserves that entry instead of overwriting it.
- A warning triangle marks suspicious source data, such as a stated DC that disagrees with tier + 10, bare dice in prose, a prose duration that disagrees with the structured duration, or damage dice with no formula. Validation reports these problems; it never silently rewrites the source spell.

<details>
<summary>How refresh and reconciliation work</summary>

Each generated spell records the source Actor UUID, embedded Item ID, source pack and versions, a content fingerprint, and every monster that supplied an identical definition.

Generated spells live in `Shadowdark Enhancer — Items / Monster Spells / <source>`. Any existing world containing the legacy `world.shadowdark-enhancer--monster-spells` compendium is automatically migrated on activation by the primary GM: generated copies are consolidated, hand-authored GM content is moved to `Monster Spells / Other Sources`, existing curated edits and custom art are preserved, and the legacy pack is emptied while remaining present for one release. Re-running the migration or refresh is safe and idempotent.

Refresh matches by that provenance rather than by name. Identical definitions consolidate. Same-name definitions with different data remain distinct. Untouched generated entries update when their source changes. Curated edits become conflicts and are preserved. Entries no longer found in the selected source scan are reported as stale and are not deleted. User-created Items are ignored.

On each world activation, the primary active GM performs an idempotent Shadowdark Core sync. A successful Importer Hub monster create/replace performs the same focused sync for the managed Enhancer Actors pack. These automatic paths do not show a confirmation dialog; reconciliation still preserves curated conflicts and stale entries. Automatic syncs queue behind an in-progress refresh so imported spells are not lost. The manual **Build / Refresh** flow remains available for selected-source recovery and keeps its source picker, reviewed dry run, primary-GM guard, and same-client refresh lock.

</details>

For the rest of the NPC workflow, see [Monster Creator](Monster-Creator.md). For pack ownership and storage rules, see [Compendium Packs](Compendium-Packs.md).
