# Monster Spell Library

The Monster Spell Library makes monster-only spells searchable in Monster Creator without changing the monsters that supplied them.

## Quick use

1. Open **Monster Creator** and expand **Spellcasting**.
2. Click **Build / Refresh** beside the Spells heading. Only a GM can run it.
3. Select **Shadowdark Core**, **Shadowdark Enhancer — Actors**, or both, then click **Preview**.
4. Read the dry-run totals for additions, updates, unchanged entries, curated conflicts, stale entries, and validation warnings.
5. Click **Build / Refresh** in the confirmation dialog. The module creates generated `Spell` items in **Shadowdark Enhancer — Monster Spells**.
6. Choose **Monster Spells** in the spell-source filter, browse or search the results, and use the arrow button to open a source monster when you need context.
7. Click **+** on a result to attach a full embedded copy to the NPC you are building.

Source Actors keep their embedded spells. The library is a reusable collection of copies, not a set of live references, so an NPC keeps its attached spell even if the library later becomes unavailable.

## What the markers mean

- A branch icon marks a same-name spell whose actual definition differs from another same-name spell. Its display name includes a source monster, such as **Blast — Mage**.
- A pencil icon marks a generated entry with curated edits. Refresh preserves that entry instead of overwriting it.
- A warning triangle marks suspicious source data, such as a stated DC that disagrees with tier + 10, bare dice in prose, a prose duration that disagrees with the structured duration, or damage dice with no formula. Validation reports these problems; it never silently rewrites the source spell.

<details>
<summary>How refresh and reconciliation work</summary>

Each generated spell records the source Actor UUID, embedded Item ID, source pack and versions, a content fingerprint, and every monster that supplied an identical definition.

Refresh matches by that provenance rather than by name. Identical definitions consolidate. Same-name definitions with different data remain distinct. Untouched generated entries update when their source changes. Curated edits become conflicts and are preserved. Entries no longer found in the selected source scan are reported as stale and are not deleted. User-created Items are ignored.

The library is not rebuilt automatically at startup. Only the primary active GM can start the flow, and a same-client lock rejects a second refresh while one is running. The GM must approve the dry run, so loading a world never silently rewrites the managed compendium.

</details>

For the rest of the NPC workflow, see [Monster Creator](Monster-Creator.md). For pack ownership and storage rules, see [Compendium Packs](Compendium-Packs.md).
