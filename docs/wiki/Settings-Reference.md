# Settings Reference

[← Wiki home](index.md)

Every setting the module registers, its real default, and what it actually does.

All settings are **world-scoped**. They are configured by the GM for the whole world.

---

## Settings you can see

Go to **Configure Settings → Shadowdark Enhancer**. These are the 26 configurable
settings, plus two GM-only menus (*Edit Guidelines Table*, *Manage Extra Gear*)
that open their own editor windows.

### Movement

| Setting | Default | What it does |
|---|---|---|
| **Combat movement default (ft)** | `30` | Default movement budget per combatant turn. Rulers turn red past this from turn start. |
| **Out-of-combat movement budget (ft)** | `90` | Default budget per crawl round. Resets on **Next Round**. |
| **Enforce out-of-combat movement budget** | **off** | On: refuses moves exceeding crawl budget. Off: flags red, but allows move. |
| **Enforce combat movement budget** | **off** | On: refuses combat moves past remaining movement. Off relies on player honesty. |
| **Lock movement out of turn** | **off** | Restricts player moves to active turns (in combat or ordered crawl). GMs and unrostered tokens are never locked. |

See [Movement Budgets](Movement-Budgets.md).

### Crawl strip

| Setting | Default | What it does |
|---|---|---|
| **Game Master avatar** | *(blank)* | Image on the GM card. Blank uses the cowled icon. Click the portrait to change. |
| **Warn when shadowdark-crawl-helper is enabled** | on | Non-blocking notice at world load if Crawl Helper is active. |

### Luck Reroll

| Setting | Default | What it does |
|---|---|---|
| **Prevent Luck rerolls on natural 1s** | on | Prevents spending Luck tokens to reroll natural 1 attack rolls, checks, or saves. |

### Spell Mishaps

| Setting | Default | What it does |
|---|---|---|
| **Auto-roll spell mishap tables** | on | Automatically rolls mishap tables on natural 1 spell fumbles (Wizard or Diabolical). Divine casters lose the spell per RAW. |

### Scavenger

Automates the Delver's **Scavenger** talent: *when you expend the last of a
consumable item, roll a d6; on a 5 or 6 you regain one use of that item.*

It fires when the last item in a stack reaches zero, or when an item is consumed
directly (such as drinking a potion or a torch burning out). Discarding a whole
stack does not trigger it. Gear, potions, and scrolls are tracked; wands are
not. The `1d6` rolls automatically and posts a chat card. On success, the item
returns with one use (restored lights return unlit with full burn duration).

**Master Scavenger** widens the range: one copy improves it to 4–6, a second to
3–6, where the Delver talent table caps it.

Shadowdark makes no distinction between using up a consumable and discarding or
selling it. If a Delver sells or drops their last torch, Scavenger may trigger.
If that happens, deleting the returned item resolves it.

The talent is detected by the flag stamped by the [Class Importer](Class-and-Spell-Importers.md),
or by name fallback for existing characters.

| Setting | Default | What it does |
|---|---|---|
| **Automate the Delver's Scavenger** | on | Master toggle. Off leaves the talent as plain text. |
| **Scavenger covers ammunition** | on | Allows spending your last arrow or bolt to trigger Scavenger. Turn off to restrict to gear. |

### Parry

Automates the Duelist's **Parry**: *once per day, an attack of your choice that
would hit you misses instead.*

When an attack lands on a Duelist, a **Parry this attack** button appears on the
chat card for the player and GM. Using it consumes a daily use, strikes through
damage on the original card, and removes damage application buttons.

If the GM already applied the damage, Parry refunds the actual lost HP (taking
into account the 0 HP floor) and clears unconscious or defeated conditions
caused by that strike.

Requires the system's **Enable Targeting** setting so the attack roll knows
which token AC it targeted. Spells targeting a Duelist use caster DCs rather than
weapon attack rolls, so Parry does not trigger on spells.

| Setting | Default | What it does |
|---|---|---|
| **Automate the Duelist's Parry** | on | Master switch for the reaction button and automatic HP refunds. |

### Taunt

Automates the Duelist's **Taunt**: *when an enemy misses you with an attack, you
have advantage on attacks against that enemy next round.*

When an enemy misses a character with Taunt, that character gains advantage
against that specific token until the end of their next turn. A chat card logs
the effect, and attack rolls against that target apply advantage automatically.
Taunt applies only against the specific attacker, not allied enemies.

Two rules interactions are built in:
- Advantage and disadvantage cancel out normally per core rules.
- Attacks turned aside by **Parry** count as misses and arm Taunt.

| Setting | Default | What it does |
|---|---|---|
| **Automate the Duelist's Taunt** | on | Master switch for tracking and applying Taunt advantage. |

### Renown

| Setting | Default | What it does |
|---|---|---|
| **Starting renown from CHA** | on | Seeds new PC renown from CHA modifier once; never touches non-zero or logged renown. See [Renown](Renown.md). |
| **Renown on level-up** | on | Awards 1 renown on level-up (levels 2+). Manual awards stay on the Renown dialog. See [Renown](Renown.md). |

### Encounters

| Setting | Default | What it does |
|---|---|---|
| **Roll Encounters as GM-only** | on | Whispers encounter rolls and roller cards to GM only. |
| **Pause game on encounter** | on | Automatically pauses game when an encounter check hits. |
| **Auto-roll active table on hit** | on | Draws from active encounter table automatically on a hit. |

> **The encounter threshold is set on the Crawl Bar.** Right-click **Encounter**
> on the bar to adjust it. See [Random Encounters](Random-Encounters.md).

### Loot & XP

| Setting | Default | What it does |
|---|---|---|
| **Loot drops on combat end** | off | Defeated NPCs roll loot tables and post shared claim cards to chat. Overridden via NPC sheet header. |
| **Loot drop mode** | `Per defeated NPC` | **Per defeated NPC**: each rolls separately. **Per encounter**: one pooled roll at highest NPC level. |
| **Loot drop chance (%)** | `50` | Drop percentage chance on combat end (mode-dependent). |
| **Item Drops** | on | Allows dragging items from sheets onto the canvas as pickup tokens. |
| **Treasure XP threshold — normal (gp)** | `10` | Minimum gold value for treasure to grant normal XP. |
| **Treasure XP threshold — fabulous (gp)** | `150` | Minimum gold value for treasure to count as fabulous XP. |
| **Magic item unique-feature chance (%)** | `100` | Percent chance generated magic items gain unique features. |

### Monster art

| Setting | Default | What it does |
|---|---|---|
| **Monster token-art source module** | `dnd-monster-manual` | Installed module ID providing token and portrait assets. Referenced directly from disk without copying. |

### Monsters

| Setting | Default | What it does |
|---|---|---|
| **Monster level guidelines** *(menu)* | *(shipped table)* | GM-only editor (**Edit Guidelines Table**) defining baseline stats per level. Stored as a sparse diff. |

See [Monster Level Guidelines](Monster-Level-Guidelines.md).

### Character Builder

| Setting | Default | What it does |
|---|---|---|
| **Ability roll method** | `3d6, Reroll if None ≥ 14` | GM-dictated method (3d6 down/assign/reroll, 4d6k3 down/assign, Standard Array, Point Buy). |
| **Portrait/token art folders** | `assets/portraits, assets/ancestries` | Comma-separated paths for the Preview gallery. Proxied through GM; discovers datasheet manifests. |
| **Animate dice (Dice So Nice)** | off | Plays 3D dice roll animations for builder rolls. Chat audit card posts either way. |
| **Max Level-1 HP** | off | Sets Level-1 HP to maximum hit die + CON instead of rolling. |
| **Fixed starting gold (gp)** | `0` | Flat starting gold amount. `0` rolls standard `2d6 × 5 gp`. |
| **Extra gear** *(menu)* | *(empty)* | GM-only picker (**Manage Extra Gear**) adding custom items to the starting shop. |

See [Character Builder](Character-Builder.md).

---

## Settings edited elsewhere

These settings are edited through their feature interfaces rather than the
main settings menu:

| Setting | Default | Edited in |
|---|---|---|
| **Merchant Sell Ratio (%)** | `50` | Merchant Shop window |
| **Merchant Shop Name** | `The Merchant` | Merchant Shop window |
| **Encounter threshold** | `1` | Crawl Bar → right-click **Encounter** |
| **Active encounter table** | *(none)* | Crawl Bar → drag table onto **Encounter** |
| **Encounter sources** | `["world", "shadowdark.bestiary"]` | Scripting API (use `shadowdark.monsters` on 4.x) |
| **Loot tier tables** | *(empty)* | Loot Generator → **Set up loot tables** |
| **Loot picker tables** | *(empty)* | Loot Setup window |
| **Magic forge table overrides** | *(empty)* | Magic Item Forge |
| **Token art priority / overrides / picks** | *(empty)* | Monster Art manager |

To update encounter sources via script:

```js
game.settings.set("shadowdark-enhancer", "encounterSources", ["world", "shadowdark.monsters"]);
```

---

## Internal state

Stored as world settings for persistence. **Do not edit these manually.**

| Key | Holds |
|---|---|
| `crawlState` | Crawl state machine (mode, turn counter, roster, out-of-combat order) |
| `sessionRecap` | Live session recap log |
| `sessionHistory` | Saved past session recaps |
| `shopInventory` · `shopLog` · `savedShopConfigs` · `shopAvailableToPlayers` · `shopAvailabilityData` · `gambleOptions` · `shopDefaultApplied` | Merchant shop state and player permissions |
| `tokenArtCompendium` | Active state of the compendium art overlay |
| `lootSetupSeen` | Flag marking whether the first-run loot nudge was shown |
| `backfillVersion` | Version stamp for legacy monster backfill |
| `enricherBackfillVersion` | Version stamp for monster text enricher pass in `sde-actors` |
| `creatureTypeBackfillVersion` | Version stamp for monster taxonomy flags |
| `monsterSpellSyncVersion` | Version stamp for Monster Spell Library refresh |
| `downtimeContent` | Unlocked downtime outcome text per book |
| `downtimeSession` | Live downtime session state |
| `uniqueFeatureTableUuid` | Bound UUID for unique magic item features |

> **Version stamps (`backfillVersion`, `enricherBackfillVersion`, `creatureTypeBackfillVersion`, `monsterSpellSyncVersion`):**
> These world settings gate automated, active-GM maintenance sweeps on startup.
> Each sweep is idempotent, preserves existing and custom data, and only
> advances its stamp after a complete successful run. Partial failures retry
> automatically on the next world load.

---

## Notes

- **All settings are world-scoped.** Players cannot alter module settings.
- **`gambleOptions` ships disabled.** Configure and enable Gamble from the
  shop's Manage tab.
- **`shopDefaultApplied`** records the initial load of *The Merchant - Base*
  stock into a new world.
- Ancestry Name/Trinket and Background/Deity tables are **auto-discovered**
  from world and compendium tables by name.

---

**Related:** [Installation & Setup](Installation-and-Setup.md) · [Troubleshooting](Troubleshooting.md)
