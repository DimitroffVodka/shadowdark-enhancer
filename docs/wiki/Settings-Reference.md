# Settings Reference

[← Wiki home](Home.md)

Every setting the module registers, its real default, and what it actually does.

All settings are **world-scoped**. They are the GM's, not per-player.

---

## Settings you can see

**Configure Settings → Shadowdark Enhancer.** These are the 26 settings with a
config entry, plus two GM-only menus (*Edit Guidelines Table*, *Manage Extra
Gear*) that open their own editor windows.

### Movement

| Setting | Default | What it does |
|---|---|---|
| **Combat movement default (ft)** | `30` | Default movement budget per combatant turn. The token's ruler turns red past this from the turn-start position. |
| **Out-of-combat movement budget (ft)** | `90` | Default budget per crawl round. Reset on **Next Round**. |
| **Enforce out-of-combat movement budget** | **off** | On: refuse moves that exceed the crawl budget. Off: still colours red, but lets the move commit. |
| **Enforce combat movement budget** | **off** | On: refuse combat moves beyond the remaining movement. Off by default, since Shadowdark combat traditionally relies on player honesty. |
| **Lock movement out of turn** | **off** | On: players can only move a token when it is that token's turn — the current combatant in combat, the holder of the rolled initiative order during a crawl (once every member has rolled). GMs, tokens outside the combat, and tokens off the crawl roster are never locked. |

See [Movement Budgets](Movement-Budgets.md).

### Crawl strip

| Setting | Default | What it does |
|---|---|---|
| **Game Master avatar** | *(blank)* | Image on the GM card. Blank uses the default cowled icon. You can also click the GM card's portrait in the strip. |
| **Warn when shadowdark-crawl-helper is enabled** | on | Load-time notice if Crawl Helper is active. Non-blocking. |

### Luck Reroll

| Setting | Default | What it does |
|---|---|---|
| **Prevent Luck rerolls on natural 1s** | on | When on, Luck tokens cannot be used to reroll attack rolls, checks, or saves that resulted in a natural 1. |

### Spell Mishaps

| Setting | Default | What it does |
|---|---|---|
| **Auto-roll spell mishap tables** | on | When a spellcasting check results in a natural 1 and fails to meet the spell DC, automatically roll the tier-appropriate mishap table for the casting class: Wizard Mishap for wizards and necromancers, Diabolical Mishap for witches. Divine casters (Priest, Green Knight, Seer) are exempt and simply lose the spell per RAW. Wand and scroll casts use the spell behind them, not the wand. |

### Scavenger

Automates the Delver's **Scavenger** talent: *when you expend the last of a
consumable item, roll a d6; on a 5 or 6 you regain one use of that item.*

It fires on the last of a stack going to zero, and on the item being consumed
outright — a potion drunk from the sheet, or a torch the light tracker burns
out. A **stack** thrown away in one go does not count, because nothing was
expended down to its last use. Gear, potions and scrolls are watched; wands are
not. The d6 rolls itself and posts a chat card showing the face, the success
range and the outcome; on a success the item comes back at one use, and a
restored light source comes back unlit with a full burn time.

**Master Scavenger** widens the range: one copy makes it 4-6, a second makes it
3-6, which is where the Delver talent table stops it. A Delver already at 3-6
who rolls 10-11 again should reroll, per the table's own header — that is a
level-up call and stays with the GM.

One rough edge worth knowing: Shadowdark records no difference between using a
consumable up and getting rid of one. Selling, gifting or dropping your *last*
torch looks identical to burning it, so Scavenger can roll and hand it back. It
is uncommon, it is obvious when it happens, and deleting the returned item is
the fix — but it is why the setting below exists.

The talent is recognised by the flag the [Class Importer](Class-and-Spell-Importers.md)
stamps on it, and by name for characters built before that flag existed — so
Delvers already in your world work without a re-import.

| Setting | Default | What it does |
|---|---|---|
| **Automate the Delver's Scavenger** | on | Master switch for everything above. Off, the talent stays on the sheet as rules text and nothing rolls itself. |
| **Scavenger covers ammunition** | on | Whether spending your last arrow or bolt can trigger Scavenger. Ammunition decrements on every ranged attack, so this fires far more often than gear does — turn it off to keep Scavenger to torches, oil, rations and the like. |

### Parry

Automates the Duelist's **Parry**: *once per day, an attack of your choice that
would hit you misses instead.*

Parry is a reaction to a hit you have already seen, so it is a button rather
than anything automatic. When an attack lands on a character who has the
ability, a **Parry this attack** button appears on that attack's chat card for
the character's player and for the GM. Using it spends one of the day's uses,
posts a short card saying the attack missed, and strikes the damage total
through on the original card so nobody applies it out of habit.

If the GM has *already* applied the damage, it is given back — and given back
properly. Shadowdark clamps HP at zero, so a Duelist on 3 HP hit for 7 loses
three points, not seven; Parry restores the three that actually left. If the hit
had dropped them, the downed state goes too: the defeated marker and the
unconscious condition are cleared, while anything that was true *before* the
blow (already prone, already defeated) is left exactly as it was.

Requires the system's **Enable Targeting** setting, since that is what tells the
attack roll whose AC it was rolling against. Without a target on the roll there
is no "you" for the attack to have hit, and no button appears.

The ability is recognised by the flag the [Class Importer](Class-and-Spell-Importers.md)
stamps on it, and by name for characters built before that flag existed — so
Duelists already in your world work without a re-import.

| Setting | Default | What it does |
|---|---|---|
| **Automate the Duelist's Parry** | on | Master switch. Off, no button appears and Parry stays on the sheet as rules text with a use counter the player spends by hand. |

### Taunt

Automates the Duelist's **Taunt**: *when an enemy misses you with an attack, you
have advantage on attacks against that enemy next round.*

An enemy that misses a character with the talent hands them advantage against
that enemy, **until the end of their next turn**, and a short card says so. When
they attack that enemy the advantage is applied to the roll and the reason is
printed on the roll card, so nobody has to remember it or argue about where it
came from. It is not spent by attacking — it lasts the full duration, however
many attacks that covers — and it applies to *that* enemy only, not to its
friends.

Two rulings are baked in, both of which you can turn off with the setting below
if your table reads them differently:

- Advantage and disadvantage **cancel**, per the core rules. A Duelist who is
  also at disadvantage rolls normally rather than having the disadvantage
  quietly replaced.
- A blow turned aside by **Parry** counts as a miss, because the talent says the
  attack *misses instead* — so a parry arms Taunt.

"Until the end of your next turn" is measured against the combat's own turn
order. A miss during your *own* turn does not burn the duration on the turn you
are already in — your next turn is the one after it. Out of combat, the
advantage lasts until the end of the first turn you finish once combat begins,
and any leftover is cleared when a combat ends.

The talent is recognised by the flag the [Class Importer](Class-and-Spell-Importers.md)
stamps on it, and by name for characters built before that flag existed.

| Setting | Default | What it does |
|---|---|---|
| **Automate the Duelist's Taunt** | on | Master switch. Off, nothing is tracked and the talent stays on the sheet as rules text. |

### Renown

| Setting | Default | What it does |
|---|---|---|
| **Starting renown from CHA** | on | Sets a new player character's renown to their Charisma modifier, once. If the character was made before their abilities were rolled, the seed waits for the first Charisma change. It never touches a character whose renown is already non-zero or who already has a renown log entry, so it cannot overwrite a score you have been playing with. See [Renown](Renown.md). |
| **Renown on level-up** | on | Gives a player character a point of renown each time their level goes up. Reaching level 1 is excluded, because character creation writes that value. Every other renown trigger is a judgement call and stays on the **Renown** dialog. See [Renown](Renown.md). |

### PDF Export

| Setting | Default | What it does |
|---|---|---|

### Encounters

| Setting | Default | What it does |
|---|---|---|
| **Roll Encounters as GM-only** | on | Whisper check results and roller cards to the GM. |
| **Pause game on encounter** | on | Auto-pause when a check hits. |
| **Auto-roll active table on hit** | on | Draw from the active table automatically on a hit. |

> **The encounter threshold is not here.** Set it on the Crawl Bar by
> right-clicking **Encounter**. See [Random Encounters](Random-Encounters.md).

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
| **Monster token-art source module** | `dnd-monster-manual` | Module id whose `assets/tokens` and `assets/portraits` supply monster art. The module must be **installed** under `Data/modules` but does **not** need to be enabled, since art is referenced from disk, never copied. |

### Monsters

| Setting | Default | What it does |
|---|---|---|
| **Monster level guidelines** *(menu)* | *(shipped table)* | GM-only editor, **Edit Guidelines Table**. What a monster of each level is expected to have: AC, HP, attacks, ability-modifier band, Talent DC. Drives the Monster Creator's **Level Baseline** section and the token **Adjust monster level** button. Your edits are stored as a sparse diff, so untouched rows still track future module updates. **Recalculate** rebuilds it from the monsters installed in your world. |

See [Monster Level Guidelines](Monster-Level-Guidelines.md).

### Character Builder

| Setting | Default | What it does |
|---|---|---|
| **Ability roll method** | `3d6, Reroll if None ≥ 14` | GM-dictated. Players roll with whatever is set here and cannot change it. Options: *3d6 Down the Line* · *3d6, Reroll if None ≥ 14* · *3d6, Assign as You Like* · *4d6 Drop Lowest, Down the Line* · *4d6 Drop Lowest, Assign as You Like*. |
| **Portrait/token art folders** | the module's own `assets/portraits, assets/ancestries` | Comma-separated folders offered to players as a gallery on the Preview step. **The browse runs on the GM's client**, so players need no file permissions and see only these folders. Add your own (e.g. Tokenizer's save locations). Missing folders are skipped. Blank disables it. |
| **Animate dice (Dice So Nice)** | off | Play the 3D animation for ability, HP, and gold rolls. **The audit chat card posts either way**, and this only adds the dice. |
| **Max Level-1 HP** | off | Set Level-1 HP to hit-die maximum + CON instead of rolling. |
| **Fixed starting gold (gp)** | `0` | A fixed amount. `0` rolls the standard `2d6 × 5 gp`. |
| **Extra gear** *(menu)* | *(empty)* | GM-only picker, **Manage Extra Gear**. Grants the builder's shop items beyond its curated starting stock. Extra weapons and armour still respect each class's usable list. |

See [Character Builder](Character-Builder.md).

---

## Settings edited elsewhere

These are real settings, but they are **not in the settings window**. They are
edited through the feature's own UI, which is why you won't find them by
searching Configure Settings.

| Setting | Default | Edited in |
|---|---|---|
| **Merchant Sell Ratio (%)** | `50` (range 0–100, step 5) | The Merchant Shop window |
| **Merchant Shop Name** | `The Merchant` | The Merchant Shop window |
| **Encounter threshold** | `1` | Crawl Bar → right-click **Encounter** |
| **Active encounter table** | *(none)* | Crawl Bar → drag a table onto **Encounter**, or the roller's **Set as Active** |
| **Encounter sources** | `["world", "shadowdark.bestiary"]`, **stale on Shadowdark 4.x**, whose pack is `shadowdark.monsters`. See [Random Encounters](Random-Encounters.md#where-encounters-draw-npcs-from) | API only (see below) |
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
**Don't edit these by hand.** They are written and read by the module.

| Key | Holds |
|---|---|
| `crawlState` | The crawl state machine: mode, turn counter, roster, out-of-combat initiative |
| `sessionRecap` | The live session recap |
| `sessionHistory` | Saved past sessions |
| `shopInventory` · `shopLog` · `savedShopConfigs` · `shopAvailableToPlayers` · `shopAvailabilityData` · `gambleOptions` · `shopDefaultApplied` | Merchant shop state |
| `tokenArtCompendium` | Whether the compendium-art overlay is on |
| `lootSetupSeen` | Whether the first-run loot nudge has been shown |
| `backfillVersion` | Last module version whose monster backfill ran in this world |
| `downtimeContent` | The downtime outcome text you unlocked, per source book. Written by the Importer's **Downtime** import type, read by the [Downtime](Downtime.md) window |
| `downtimeSession` | The live downtime session: which book, whether picks are still open, and each character's chosen activity and settled result |
| `uniqueFeatureTableUuid` | The bound unique-feature table |

> **`backfillVersion` is the one worth knowing about.** Clearing it makes the
> automatic monster backfill re-run on the next world load. That sweep is
> idempotent and non-destructive, so re-running it is safe if you suspect
> imported monsters are stale.

---

## Notes

- **Everything is world scope.** There are no client-scoped settings, so a player
  cannot change any of this for themselves.
- **`gambleOptions` ships disabled.** Its default sources referenced a loot
  generator this module has no equivalent for. GMs can enable and configure
  Gamble themselves from the shop's Manage tab, picking from any world or
  compendium roll table.
- **`shopDefaultApplied`** latches the one-time load of the shipped
  "The Merchant - Base" stock into a new world's shop. Clearing it makes that
  load happen again on the next world load, but only if the shop is empty at
  the time, so it will not overwrite a shop you have stocked yourself.
- Ancestry Name/Trinket and Background/Deity tables are **auto-discovered**, not
  configured. There is deliberately no setting.

---

**Related:** [Installation & Setup](Installation-and-Setup.md) · [Troubleshooting](Troubleshooting.md)
