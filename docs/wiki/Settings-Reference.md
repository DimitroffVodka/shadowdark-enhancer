# Settings Reference

[← Wiki home](Home.md)

Every setting the module registers, its real default, and what it actually does.

All settings are **world-scoped** — they are the GM's, not per-player.

---

## Settings you can see

**Configure Settings → Shadowdark Enhancer.** These are the 20 settings with a
config entry, plus two GM-only menus (*Edit Guidelines Table*, *Manage Extra
Gear*) that open their own editor windows.

### Movement

| Setting | Default | What it does |
|---|---|---|
| **Combat movement default (ft)** | `30` | Default movement budget per combatant turn. The token's ruler turns red past this from the turn-start position. |
| **Out-of-combat movement budget (ft)** | `90` | Default budget per crawl turn. Reset on **Next Turn**. |
| **Enforce out-of-combat movement budget** | **off** | On: refuse moves that exceed the crawl budget. Off: still colours red, but lets the move commit. |
| **Enforce combat movement budget** | **off** | On: refuse combat moves beyond the remaining movement. Off by default — Shadowdark combat traditionally relies on player honesty. |

See [Movement Budgets](Movement-Budgets.md).

### Crawl strip

| Setting | Default | What it does |
|---|---|---|
| **Game Master avatar** | *(blank)* | Image on the GM card. Blank uses the default cowled icon. You can also click the GM card's portrait in the strip. |
| **Warn when shadowdark-crawl-helper is enabled** | on | Load-time notice if Crawl Helper is active. Non-blocking. |

### Encounters

| Setting | Default | What it does |
|---|---|---|
| **Roll Encounters as GM-only** | on | Whisper check results and roller cards to the GM. |
| **Pause game on encounter** | on | Auto-pause when a check hits. |
| **Auto-roll active table on hit** | on | Draw from the active table automatically on a hit. |

> **The encounter threshold is not here.** Set it on the Crawl Bar —
> right-click **Encounter**. See [Random Encounters](Random-Encounters.md).

### Loot & XP

| Setting | Default | What it does |
|---|---|---|
| **Loot drops on combat end** | off | When a combat ends, defeated NPCs have a chance to roll their loot table and post a shared claim card to chat. Per-NPC overrides via the **Loot** button in the NPC sheet header. |
| **Loot drop mode** | `Per defeated NPC` | **Per defeated NPC**: every defeated monster rolls its own chance and can post its own card. **Per encounter (one card)**: one chance roll and at most one card for the whole combat, at the highest-level defeated NPC's level (its per-NPC overrides apply). |
| **Loot drop chance (%)** | `50` | Chance to drop loot when combat ends (per NPC or per encounter, depending on the mode). |
| **Item Drops** | on | Let players drag items from inventory onto the canvas as pickup-able tokens. Light sources are handled by the system and are never dropped this way. |
| **Treasure XP threshold — normal (gp)** | `10` | Minimum gold value for generated treasure to grant normal treasure XP. |
| **Treasure XP threshold — fabulous (gp)** | `150` | Minimum value to count as fabulous (higher XP). |
| **Magic item unique-feature chance (%)** | `100` | Percent chance a generated magic item gains a unique feature. `100` = always. |

### Monster art

| Setting | Default | What it does |
|---|---|---|
| **Monster token-art source module** | `dnd-monster-manual` | Module id whose `assets/tokens` and `assets/portraits` supply monster art. The module must be **installed** under `Data/modules` but does **not** need to be enabled — art is referenced from disk, never copied. |

### Monsters

| Setting | Default | What it does |
|---|---|---|
| **Monster level guidelines** *(menu)* | *(shipped table)* | GM-only editor — **Edit Guidelines Table**. What a monster of each level is expected to have: AC, HP, attacks, ability-modifier band, Talent DC. Drives the Monster Creator's **Level Baseline** section and the token **Adjust monster level** button. Your edits are stored as a sparse diff, so untouched rows still track future module updates. **Recalculate** rebuilds it from the monsters installed in your world. |

See [Monster Level Guidelines](Monster-Level-Guidelines.md).

### Character Builder

| Setting | Default | What it does |
|---|---|---|
| **Ability roll method** | `3d6, Reroll if None ≥ 14` | GM-dictated. Players roll with whatever is set here and cannot change it. Options: *3d6 Down the Line* · *3d6, Reroll if None ≥ 14* · *3d6, Assign as You Like* · *4d6 Drop Lowest, Down the Line* · *4d6 Drop Lowest, Assign as You Like*. |
| **Portrait/token art folders** | the module's own `assets/portraits, assets/ancestries` | Comma-separated folders offered to players as a gallery on the Preview step. **The browse runs on the GM's client**, so players need no file permissions and see only these folders. Add your own (e.g. Tokenizer's save locations). Missing folders are skipped. Blank disables it. |
| **Animate dice (Dice So Nice)** | off | Play the 3D animation for ability, HP, and gold rolls. **The audit chat card posts either way** — this only adds the dice. |
| **Max Level-1 HP** | off | Set Level-1 HP to hit-die maximum + CON instead of rolling. |
| **Fixed starting gold (gp)** | `0` | A fixed amount. `0` rolls the standard `2d6 × 5 gp`. |
| **Extra gear** *(menu)* | *(empty)* | GM-only picker — **Manage Extra Gear**. Grants the builder's shop items beyond its curated starting stock. Extra weapons and armour still respect each class's usable list. |

See [Character Builder](Character-Builder.md).

---

## Settings edited elsewhere

These are real settings, but they are **not in the settings window** — they are
edited through the feature's own UI, which is why you won't find them by
searching Configure Settings.

| Setting | Default | Edited in |
|---|---|---|
| **Merchant Sell Ratio (%)** | `50` (range 0–100, step 5) | The Merchant Shop window |
| **Merchant Shop Name** | `The Merchant` | The Merchant Shop window |
| **Encounter threshold** | `1` | Crawl Bar → right-click **Encounter** |
| **Active encounter table** | *(none)* | Crawl Bar → drag a table onto **Encounter**, or the roller's **Set as Active** |
| **Encounter sources** | `["world", "shadowdark.bestiary"]` — **stale on Shadowdark 4.x**, whose pack is `shadowdark.monsters`; see [Random Encounters](Random-Encounters.md#where-encounters-draw-npcs-from) | API only (see below) |
| **Loot tier tables** | *(empty)* | Loot Generator → **Set up loot tables** |
| **Loot picker tables** | *(empty)* | Loot Setup window |
| **Magic forge table overrides** | *(empty)* | Magic Item Forge |
| **Token art priority / overrides / picks** | *(empty)* | The Monster Art manager |

Set one from a script if you need to:

```js
game.settings.set("shadowdark-enhancer", "encounterSources", ["world", "shadowdark.monsters"]);
```

---

## Internal state

Stored as settings because that is where world-scoped state lives in Foundry.
**Don't edit these by hand** — they are written and read by the module.

| Key | Holds |
|---|---|
| `crawlState` | The crawl state machine — mode, turn counter, roster, out-of-combat initiative |
| `sessionRecap` | The live session recap |
| `sessionHistory` | Saved past sessions |
| `shopInventory` · `shopLog` · `savedShopConfigs` · `shopAvailableToPlayers` · `shopAvailabilityData` · `gambleOptions` | Merchant shop state |
| `tokenArtCompendium` | Whether the compendium-art overlay is on |
| `lootSetupSeen` | Whether the first-run loot nudge has been shown |
| `backfillVersion` | Last module version whose monster backfill ran in this world |
| `uniqueFeatureTableUuid` | The bound unique-feature table |

> **`backfillVersion` is the one worth knowing about.** Clearing it makes the
> automatic monster backfill re-run on the next world load. That sweep is
> idempotent and non-destructive, so re-running it is safe if you suspect
> imported monsters are stale.

---

## Notes

- **Everything is world scope.** There are no client-scoped settings, so a player
  cannot change any of this for themselves.
- **`gambleOptions` ships disabled** — its default sources referenced a loot
  generator this module has no equivalent for. GMs can enable and configure
  Gamble themselves from the shop's Manage tab.
- Ancestry Name/Trinket and Background/Deity tables are **auto-discovered**, not
  configured. There is deliberately no setting.

---

**Related:** [Installation & Setup](Installation-and-Setup.md) · [Troubleshooting](Troubleshooting.md)
