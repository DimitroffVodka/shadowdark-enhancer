| **Monster loot overrides** *(menu)* | — | GM-only list (**Review Monsters**) of every world NPC with its loot table and drop chance, editable inline. |
| **Lock HP rolls** | on | Hides Roll Again, Take Max and Random for players once Level-1 HP is rolled. GMs are never locked. |
| **Lock gold rolls** | on | Hides Roll Again and Random for players once starting gold is rolled. GMs are never locked and keep the manual gp box. |
| **Lock ability rolls** | on | Hides Roll Again, Reset and Random for players once abilities are rolled. The 3d6 under-14 reroll stays. GMs are never locked. |
| **Lock talent rolls** | on | Hides Reroll for players once a class or bonus talent is rolled. Duplicates the rules say to reroll stay rerollable. GMs are never locked. |
# Settings Reference

[← Wiki home](index.md)

Every setting the module registers, its real default, and what it actually does.

All settings are **world-scoped**. They are configured by the GM for the whole world.

---

## Settings you can see

Go to **Configure Settings → Shadowdark Enhancer**. Every setting lives in one of eight
pop-out windows, one per feature, each opened by its own **Configure** button:
Character Builder, Monsters, PC Automation, Modes of Play, Movement, Crawl Strip,
Encounters, and Loot & XP.

### Character Builder

| Setting | Default | What it does |
|---|---|---|
| **Ability roll method** | `3d6, Reroll if None ≥ 14` | GM-dictated method (3d6 down/assign/reroll, 4d6k3 down/assign, Standard Array, Point Buy). |
| **Portrait/token art folders** | `assets/portraits, assets/ancestries` | Folders offered as the Preview gallery, picked with Foundry's folder browser. Browsed through the GM; discovers datasheet manifests. |
| **Animate dice (Dice So Nice)** | off | Plays 3D dice roll animations for builder rolls. Chat audit card posts either way. |
| **Max Level-1 HP** | off | Sets HP to maximum hit die + CON instead of rolling. Above level 1, every level's die is maxed. |
| **Fixed starting gold (gp)** | `0` | Flat starting gold amount. `0` rolls standard `2d6 × 5 gp`. |
| **Extra gear** *(menu)* | *(empty)* | GM-only picker (**Manage Extra Gear**) adding custom items to the starting shop. |

See [Character Builder](Character-Builder.md).

---

### Monsters

| Setting | Default | What it does |
|---|---|---|
| **Monster Spell library** *(menu)* | *(compendium)* | GM-only (**Build / Refresh Library**) generating a rollable Spell item for every spell embedded in your monsters, filed under Monster Spells in the module's compendium. |
| **Monster level guidelines** *(menu)* | *(shipped table)* | GM-only editor (**Edit Guidelines Table**) defining baseline stats per level. Stored as a sparse diff. |

See [Monster Level Guidelines](Monster-Level-Guidelines.md).

### PC Automation

Automation for player-character rules. The pop-out keeps each class and the
renown switches under their own collapsible headings, closed by default, so the
list stays short as classes are added.

#### Spell Mishaps

| Setting | Default | What it does |
|---|---|---|
| **Auto-roll spell mishap tables** | on | Automatically rolls mishap tables on natural 1 spell fumbles (Wizard or Diabolical). Divine casters lose the spell per RAW. |

#### Duelist — Taunt

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

#### Duelist — Parry

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

#### Delver — Scavenger

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

#### Renown

| Setting | Default | What it does |
|---|---|---|
| **Starting renown from CHA** | on | Seeds new PC renown from CHA modifier once; never touches non-zero or logged renown. See [Renown](Renown.md). |
| **Renown on level-up** | on | Awards 1 renown on level-up (levels 2+). Manual awards stay on the Renown dialog. See [Renown](Renown.md). |

### Modes of Play

The optional rules from the core rulebook (p.111), and Hard Luck from the Game
Master's Guide to the Western Reaches (p.30). Each mode is a box of its own
rules, and every rule switches on by itself: Deadly's death timer of 1 can run
without its DC 18 stabilize, for example. Each box has a switch that turns all
of that mode's rules on or off at once; it shows as on only when all of them
are. There is no switch for every mode together. Players are not told which
modes are on.

A rule marked **Not automated yet** can already be switched on and is saved,
but nothing acts on it until the update that builds it. The same words show
under its checkbox in the window.

| Mode | Setting | Default | What it does |
|---|---|---|---|
| Blitz | **Light sources last 30 minutes** | off | Lighting a torch or lantern sets it to 30 minutes left (less if it already had less), and a light spell lasts 30 minutes. The item's own maximum is untouched, so its sheet can read "30 of 60 minutes". Shadowdark Extras' camping campfire keeps its 8 hours. |
| Chaos | **Reroll initiative every round** | off | At the start of every round after the first, everyone rolls initiative again (the system's roll, with any advantage) and the turn goes to the new top; a defeated monster on top is skipped as usual. One chat card per round lists the new order, without hidden combatants. Does nothing while the system's clockwise initiative is on, and says so once. An effect lasting "until the start of your next turn" can end early or late, because turns move. Whoever was on top before the reroll has their turn start and end once as the order changes, so an effect that ends at the start or end of their turn can end a turn early. |
| Chaos | **Show Dice So Nice for Chaos rerolls** | off | An option, not a rule, so the Chaos switch leaves it alone: shows the 3D dice for every round's reroll. |
| Deadly | **Death timers are always 1** | off | *Not automated yet.* A dying character has 1 round to live, whatever their Constitution. |
| Deadly | **Stabilizing is DC 18** | off | *Not automated yet.* Stabilizing a dying character is an Intelligence check at DC 18 instead of 15. |
| Fatality | **Characters die at 0 HP** | off | *Not automated yet.* There is no dying: a character reduced to 0 HP is dead. |
| Grinder | Shadowdark Extras' Grinder settings | off | Shown here when Shadowdark Extras has them (`shadowdark-extras.grinderMode`, and `grinderHitDice`, shown only while Grinder is on); its camping rest is where Grinder takes effect. Without them, the box says what is needed. |
| Hunter | **XP for defeated monsters** | off | When a combat ends, every character in it gets XP for each monster still marked defeated: half its level, rounded down, 1 for a level 1 monster, nothing for level 0. One Party XP card per combat, logged in Session Recap. Monsters killed outside a combat aren't counted. |
| Momentum | the system's exploding damage setting | off | Shown here; it is the Shadowdark system's own setting. Advantage on repeating a failed action is granted at the table. |
| Pulp | the system's Pulp Mode setting | off | Shown here; it is the Shadowdark system's own setting (no maximum on luck tokens). |
| Pulp | **1d4 luck at the start of each session** | off | Choosing **Start New Session** in Session Recap's prompt when a crawl starts sets each player's character to 1d4 luck tokens (Continue Session doesn't), as the system's own luck macro does, and posts one card with the rolls. |
| Pulp | **Spend luck to turn a hit into a critical hit** | off | Once an attack card shows a hit, its owner gets a **Luck: critical hit** button. Damage already on the card keeps its dice and gains what a critical hit adds; damage not rolled yet is rolled once as a critical hit. Costs one luck token. |
| Pulp | **Spend luck to make the GM reroll** | off | A player whose character has luck gets a **Luck: force a reroll** button on a GM's roll they can see (not blind, not whispered to others): a Shadowdark roll card, or a plain roll showing just its total, never initiative. The roll is redone on the same card, which names who forced it; an attack's damage follows the new result. Costs one luck token, logged in Session Recap. |
| Hard Luck | **No luck rerolls on critical failures** | off | Luck tokens can't reroll a critical failure, by the system's own rule, so an effect that widens the failure range counts too. Damage rerolls and the GM's own rerolls are never refused. Before the Modes of Play window it sat under PC Automation and was on by default. |
| Hard Luck | **No luck rerolls with luck-granting effects** | off | Luck can't reroll a roll made with Bless, a Bard's Inspire, Trance or a Seer's Omen, whatever the result. Matched by the spell's or ability's name; a spell cast from a scroll or wand counts. Only the chat card's reroll can be checked: luck spent from the crawl strip or Shadowdark Extras isn't tied to a roll. |

### Movement

| Setting | Default | What it does |
|---|---|---|
| **Combat movement default (ft)** | `30` | Default movement budget per combatant turn. Rulers turn red past this from turn start. |
| **Out-of-combat movement budget (ft)** | `90` | Default budget per crawl round. Resets on **Next Round**. |
| **Enforce out-of-combat movement budget** | **off** | On: refuses moves exceeding crawl budget. Off: flags red, but allows move. |
| **Enforce combat movement budget** | **off** | On: refuses combat moves past remaining movement. Off relies on player honesty. |
| **Lock movement out of turn** | **off** | Restricts player moves to active turns (in combat or ordered crawl). GMs and unrostered tokens are never locked. |

See [Movement Budgets](Movement-Budgets.md).

### Crawl Strip

| Setting | Default | What it does |
|---|---|---|
| **Game Master avatar** | `assets/gm-avatar.jpg` (bundled) | Portrait on the Game Master card in the crawl strip. Blank shows a plain cowled icon; click the card's portrait in the strip to change it. |
| **Warn when shadowdark-crawl-helper is enabled** | on | Non-blocking notice at world load if Crawl Helper is active. |

### Loot & XP

| Setting | Default | What it does |
|---|---|---|
| **Loot drops on combat end** | off | Defeated NPCs roll loot tables and post shared claim cards to chat. Overridden via NPC sheet header. |
| **Loot drop mode** | `Per defeated NPC` | **Per defeated NPC**: each rolls separately. **Per encounter**: one pooled roll at highest NPC level. |
| **Loot drop chance (%)** | `50` | Drop percentage chance on combat end (mode-dependent). |
| **Item Drops** | on | Allows dragging items from sheets onto the canvas as pickup tokens. |
| **Treasure XP threshold — normal (gp)** | `10` | Loot worth at least this much is suggested as 1 XP when dragged into Party XP. Nothing is awarded automatically. |
| **Treasure XP threshold — fabulous (gp)** | `150` | Loot worth at least this much is suggested as 3 XP in Party XP. Magic items count as fabulous regardless of value. |
| **Magic item unique-feature chance (%)** | `100` | Percent chance generated magic items gain unique features. |

### Encounters

| Setting | Default | What it does |
|---|---|---|
| **Roll Encounters as GM-only** | on | Whispers encounter rolls and roller cards to GM only. |
| **Pause game on encounter** | on | Automatically pauses game when an encounter check hits. |
| **Auto-roll active table on hit** | on | Draws from active encounter table automatically on a hit. |

> **The encounter threshold and check frequency are set on the Crawl Bar.**
> Right-click **Encounter** on the bar to adjust either. See
> [Random Encounters](Random-Encounters.md).

## Settings edited elsewhere

These settings are edited through their feature interfaces rather than the
main settings menu:

| Setting | Default | Edited in |
|---|---|---|
| **Merchant Sell Ratio (%)** | `50` | Merchant Shop window |
| **Merchant Shop Name** | `The Merchant` | Merchant Shop window |
| **Encounter threshold** | `1` | Crawl Bar → right-click **Encounter** |
| **Encounter check frequency** | `1` (every crawl round) | Crawl Bar → right-click **Encounter** → **Check Frequency** — counted from the last check, so a mid-crawl change applies from where you stand |
| **Active encounter table** | *(none)* | Crawl Bar → drag table onto **Encounter** |
| **Encounter sources** | `["world", "shadowdark.bestiary"]` | Scripting API (use `shadowdark.monsters` on 4.x) |
| **Loot tier tables** | *(empty)* | Loot Generator → **Set up loot tables** |
| **Loot picker tables** | *(empty)* | Loot Setup window |
| **Magic forge table overrides** | *(empty)* | Magic Item Forge |
| **Token art priority / overrides / picks** | *(empty)* | Monster Art manager |
| **Hex map developer tools** (`hexMapsDevTools`, per client) | `false` | Script only; unlocks `game.shadowdarkEnhancer.hexMaps.compare` for the GM (see [Hex Maps](Hex-Maps.md)) |

To update encounter sources via script:

```js
game.settings.set("shadowdark-enhancer", "encounterSources", ["world", "shadowdark.monsters"]);
```

To enable the hex-map comparison check on your own client:

```js
game.settings.set("shadowdark-enhancer", "hexMapsDevTools", true);
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
