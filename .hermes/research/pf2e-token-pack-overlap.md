# PF2e official token-pack overlap

**Question:** Does owning **Pathfinder Tokens: Character Gallery** plus **Pathfinder Tokens: Monster Core** make **Pathfinder Tokens: Bestiaries** or **Pathfinder Tokens: NPC Core** redundant?

**Answer:** No.[1][2][4]
Monster Core currently supplies art mappings for **376 of the 1,207 legacy Bestiary actors (31.2%)**, leaving **831** Bestiary actors uncovered.[1][2][8]
Character Gallery currently supplies art mappings for **82 of NPC Core's 270 listed actors (30.4%)**, leaving **188** NPC Core actors uncovered.[4][7]
Bestiaries is the larger coverage gain; NPC Core is still a substantial, focused gain for humanoid/NPC encounters.[1][2][4]

## Method and counting rules

- Product scope and published totals come from Foundry VTT's first-party package pages and Paizo announcements.[1][3][4]
- The exact overlap counts come from the two licensed packages already installed locally: Character Gallery **1.3.0** and Monster Core **14.1.0**, matching their current public manifests.[7][8]
- “Mapped actor” means a specific PF2e compendium actor UUID targeted by a module's `compendiumArtMappings` file.[7][8][9] This avoids treating renamed remaster equivalents as unrelated merely because their display names differ.
- NPC Core's official page says “over 250”; its complete first-party name list contains **270** entries when counted. Monster Core's page publishes **491** entries, although its current 14.1.0 installed mapping contains **492** Monster Core UUIDs; this report preserves the published product count and calls out the mapping-version discrepancy rather than silently choosing one.[2][4]

## What each pack actually covers

| Pack | Source scope | Published content count | Practical actor mapping scope |
|---|---|---:|---|
| **Bestiaries** | Every creature/statblock in **Pathfinder Bestiary, Bestiary 2, and Bestiary 3**. Paizo describes it as covering every creature in all three books.[1][5] | **1,207 actors**; some variants, such as spellcaster dragons, share art.[1] | All three legacy Bestiary compendia. |
| **Monster Core** | Every creature/statblock in the remastered **Monster Core**, including unillustrated entries, variants, and the eight remastered dragon families.[2] | **491 listed actors**; the current local 14.1.0 map has 492 UUID mappings and 467 distinct portrait paths. A small number of variants share art.[2][8] | All Monster Core actors, plus automatic mappings to equivalent creatures in Bestiary 1–3.[2] |
| **Character Gallery** | A general-purpose PC/NPC portrait library, **not** a single rules book. Its nine key sources contribute 1,150 pieces: Player Character Pawn Collection (237), Gamemastery Guide NPC Pawn Collection (108), *Absalom* (106), *Ancestry Guide* (112), *Character Guide* (86), *Grand Bazaar* (39), *Impossible Lands* (163), *The Mwangi Expanse* (127), and *Tian Xia World Guide* (172), plus small selections from other books/APs.[3] | About **1,200 unique portraits/tokens** and advertised seamless replacement for about 100 PF2e actors.[3][6] | Current 1.3.0 mapping: 139 actor UUIDs total, using 112 distinct assets; importantly, **82 are NPC Core actors**.[7] |
| **NPC Core** | Every character/statblock in the remastered **NPC Core** compendium, including previously unillustrated NPCs.[4] | Marketed as “over 250”; the complete official list contains **270 named entries**.[4] | Every NPC Core actor, and its entire art datasheet is added to Character Gallery when both modules are active.[4][9] |

## Exact overlap that matters to this purchase

### Monster Core vs. Bestiaries

The current Monster Core 14.1.0 map targets **376 legacy Bestiary actors** in addition to its Monster Core mappings.[8]

| Legacy compendium | Actors already receiving Monster Core art |
|---|---:|
| Bestiary | 313 |
| Bestiary 2 | 45 |
| Bestiary 3 | 18 |
| **Total** | **376 / 1,207 (31.2%)** |

Those 376 legacy mappings reuse the corresponding Monster Core portrait files; they are not 376 extra legacy-art images bundled separately.[8] This implements the official promise that Monster Core automatically maps art onto creatures that also appear in the three Bestiary compendia.[2]

Buying Bestiaries therefore adds guaranteed mapping coverage for the other **831 legacy actors (68.8%)**.[1][2][8]
It also supplies the Bestiary-era collection for all 1,207 actors.[1]
Foundry's FAQ explicitly says one pack alone covers its own compendium(s) plus shared creatures, while owning both covers every actor in all four compendia.[2]

### Character Gallery vs. NPC Core

Character Gallery 1.3.0 already maps **82 NPC Core UUIDs**, each to a distinct Character Gallery asset.[7] NPC Core's complete list has 270 actors, so Character Gallery currently covers **82 / 270 (30.4%)** and NPC Core adds guaranteed statblock-specific coverage for the other **188 (69.6%)**.[4][7]

With both modules active, those 82 actors are mapped by two modules: Character Gallery's existing artwork and NPC Core's dedicated artwork.[4][7][9]
NPC Core also contributes all of its tokens and portraits as a separate searchable Character Gallery datasheet.[4][9]

### Other pairings

The inspected Character Gallery and Monster Core maps target disjoint compendium actor UUID sets, so there is **no direct same-actor mapping overlap between the two packs the user already owns**.[7][8]
Character Gallery's ability to display Bestiaries, Monster Core, and NPC Core datasheets is integration: it makes those separately owned assets searchable in one browser; it does not mean Character Gallery already bundles those packs' files.[2][3][4]

## Duplicate art vs. alternative art

- **Within Bestiaries and Monster Core:** both official pages warn that a small number of variant statblocks share one artwork, with spellcaster dragon variants given as the example.[1][2] In the current Monster Core map, 492 Monster Core UUID mappings resolve to 467 distinct portrait paths, i.e. **25 additional mappings reuse an existing portrait**.[8]
- **Monster Core mapped onto legacy Bestiary actors:** the same Monster Core image file is deliberately reused for each matched legacy actor.[8]
  Buying Bestiaries adds a second, Bestiary-sourced art collection for the shared creature set, but the publisher does **not** publish an image-hash comparison or promise that every one of the 376 shared mappings is visually different.[1][2]
  The Monster Core FAQ only promises an “entirely new collection” containing “numerous” pieces of brand-new art, not 100% distinct art for every overlap.[2]
- **Character Gallery and NPC Core:** the 82 shared NPC Core actors have two mapping sources when both modules are enabled, and NPC Core's art is also exposed as its own gallery datasheet.[4][7][9]
  No first-party source publishes an image-level duplicate count between the two protected packages, so it would be unsafe to claim all 82 are either identical or distinct.[4][7][9]
- Foundry's package pages do not document which module wins when two active compendium-art mappings target the same actor.[2][3][4]
  Treat the overlapping art as selectable/searchable alternatives in the gallery, not as a guaranteed automatic multi-portrait chooser.[3][4]

## Purchase recommendation

1. **Bestiaries: not redundant; highest raw coverage value.** Buy it if the campaign uses any pre-remaster Bestiary 1–3 creatures.[1][2]
   Monster Core leaves **831** of those actors without premium mapped art.[1][2][8]
   Skip it only if the table intentionally uses Monster Core creatures exclusively and does not care about legacy/OGL creatures or Bestiary-era alternatives.[1][2]
2. **NPC Core: not redundant, but more use-case dependent.** Buy it if NPC Core statblocks are used regularly or if a consistent dedicated NPC set is valuable.[4]
   It adds **188** currently uncovered actors and a complete searchable 270-entry NPC Core collection.[4][7][9]
   It is lower priority if Character Gallery's generic portraits are sufficient and NPC Core statblocks are rarely used.[3][4]
3. **Owning Characters + Monster Core does not form a substitute bundle.** They cover a broad portrait library plus the remastered monster book; they do not supply complete legacy-bestiary or remastered-NPC coverage.[1][2][4]

## Sources

[1] https://foundryvtt.com/packages/pf2e-tokens-bestiaries — Pathfinder Tokens: Bestiaries
[2] https://foundryvtt.com/packages/pf2e-tokens-monster-core — Pathfinder Tokens: Monster Core
[3] https://foundryvtt.com/packages/pf2e-tokens-characters — Pathfinder Tokens: Character Gallery
[4] https://foundryvtt.com/packages/pf2e-tokens-npc-core — Pathfinder Tokens: NPC Core
[5] https://paizo.com/blog/pathfinder-bestiary-token-pack-for-foundry-vtt — Pathfinder Bestiary Token Pack for Foundry VTT
[6] https://paizo.com/blog/inside-pathfinder-tokens-character-gallery-for-foundry-vtt — Inside Pathfinder Tokens: Character Gallery for Foundry VTT
[7] https://r2.foundryvtt.com/packages-public/pf2e-tokens-characters/module.json — Character Gallery module manifest
[8] https://cdn.paizo.com/foundry/modules/pf2e-tokens-monster-core/module.json — Monster Core module manifest
[9] https://cdn.paizo.com/foundry/modules/pf2e-tokens-npc-core/module.json — NPC Core module manifest
