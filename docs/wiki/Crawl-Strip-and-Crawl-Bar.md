# Crawl Strip & Crawl Bar

[← Wiki home](index.md)

The always-on party display pinned to the top of your canvas, and the control
bar that launches the rest of the suite.

![The Crawl Strip during a crawl, showing four party members and the GM card](images/crawl-strip.png)

---

## What it does

The **Crawl Strip** is a horizontal row of cards—one per party member—showing
live HP, movement budgets, Luck tokens, AC, and active status effects without
opening a character sheet.

The **Crawl Bar** sits directly underneath, changing controls based on whether
you are exploring or in combat.

The strip switches modes automatically:

| Mode | Cards shown | Order |
|---|---|---|
| **Crawl** (out of combat) | Party members added to the roster | Out-of-combat initiative order |
| **Combat** | All active combatants | Foundry initiative tracker order |

The module honors the Shadowdark system's *Clockwise Initiative* setting
automatically.

## Opening it

You do not need to open it manually. The strip and bar install themselves when
your world loads and stay pinned to the top of the canvas. The strip hides
itself when there are no active members to show.

---

## The Crawl Bar

### In crawl mode

![Crawl Bar, crawl mode](images/crawl-bar-crawl.png)

| Control | Left-click | Right-click |
|---|---|---|
| **Crawl · Round #** | Shows current crawl round | — |
| **Next Round** | Advances round and refills movement budgets | — |
| **Add Tokens** | Adds selected tokens to crawl roster | **Reset Initiative** (clears roll order) |
| **Combat** | Starts a combat encounter from current state | — |
| **Encounter** | Opens [Encounter Roller](Random-Encounters.md) | Encounter menu (check, threshold, frequency, table) |
| **Forge & Loot** | Opens the tools menu: [Loot Generator](Loot-and-Treasure.md), [Magic Item Forge](Magic-Item-Forge.md), [Merchant Shop](Merchant-Shop.md), [Party XP](Party-XP.md), [Downtime](Downtime.md), [Pit Fighting](Pit-Fighting.md), [Regional Training](Regional-Training.md), [Renown](Renown.md), [Session Recap](Session-Recap.md) | Same menu |
| **Importer** | Opens [Importer Hub](Importer-Hub.md) | — |
| **Start / End** | Starts or ends the crawl session | — |

You can also **drag a RollTable from the sidebar directly onto the Encounter
button** to set it as your active random encounter table.

> **Add Tokens adds only Player actors to the crawl roster.** Selected NPC
> tokens are ignored with a notice. Membership is stored by **actor ID**, so
> characters remain on the strip when switching scenes.

### In combat mode

![Crawl Bar, combat mode](images/crawl-bar-combat.png)

| Control | What it does |
|---|---|
| **Begin / End Encounter** | Starts or ends combat round structure |
| **Add Tokens** | Adds selected tokens to combat tracker |
| **Delete Encounter** | Deletes the combat and throws the fight away: no Hunter XP, no loot drops, no Session Recap entry |

In combat, the strip displays one card per combatant in initiative order:

![The crawl strip in combat mode](images/crawl-strip-combat.png)

- **Dead enemies leave the strip:** Defeated NPCs and monsters dropped to 0 HP
  are removed from the strip automatically. They remain in the combat tracker so
  loot generators and session recaps can still count them. Healing an enemy
  above 0 HP returns its card.
- **Downed PCs stay on the strip:** A player character at 0 HP shows a
  **Dying** badge with its death timer (or **Stable**), and a dead one a skull.
  See [Dying and Death Timers](Dying-and-Death-Timers.md).
- **Dead PCs' turns are skipped:** A dead character keeps its card but no
  longer takes a turn.
- **Dead turns are skipped automatically:** When an enemy dies, the module
  skips their turn in the tracker automatically to keep combat moving.

---

## Starting and ending a crawl

- **Start:** Begins a crawl session and starts (or resumes) a
  [Session Recap](Session-Recap.md).
- **End:** Ends the crawl and prompts you to save, pause, or discard the recap.
- **Next Round:** Advances the round counter and refills out-of-combat movement
  budgets. See [Movement Budgets](Movement-Budgets.md).

### Rolling party initiative

Each card displays a d20 button when initiative is unrolled.

In crawl mode, GMs get a **group dice button** above the round number on the
left of the strip. One click rolls out-of-combat initiative for **all members
who have not rolled yet**. Characters who already rolled are skipped.

| Detail | Behavior |
|---|---|
| **Visibility** | GM only. Players roll using their own card's d20 button. |
| **When shown** | In crawl mode while at least one member still owes a roll. |
| **When hidden** | Hides once all roster members have rolled. |
| **Resetting** | Click **Reset Initiative** (↺) at the bottom of the same column to clear rolls. Right-clicking **Add Tokens** on the bar does the same. |

Once everyone has rolled, the GM's column also gets **Previous player's
turn** (⏪) above the round number and **Next player's turn** (⏩) below it,
like Previous Turn and Next Turn in combat. Stepping back past the top of the
order steps the crawl round back too.

### The Crawl Order sidebar tab

During a crawl, a **Crawl Order** tab appears in Foundry's sidebar directly
beneath the Combat tracker icon. It functions like an out-of-combat turn
tracker:

| Section | Content |
|---|---|
| **Header** | Group roll button, round title, and Reset Initiative |
| **Rows** | Portrait, name, and initiative value or roll button |
| **Footer** | Turn and round controls (players see a single **End Turn** button) |
| **Popout** | Right-click sidebar icon for a floating window |

Clicking a row selects that token; players get a pan-to control on their row.

Differences from combat:

- **Next round** advances the crawl round, rolls the wandering encounter check
  when [Check Frequency](Random-Encounters.md#setting-the-frequency) says the
  round is due, and refills movement budgets.
- **Previous round** adjusts the round counter back without reverting rolls.

---

## Overland travel

On a tagged hex map the Crawl Bar also offers **Travel**. It starts overland
travel instead of a crawl. Overland is being built in pieces (#192). So far it
switches the mode, keeps the travel state, rolls the weather, and charges each
move of the travel token against the day's hexes, moving the clock with it.

- **Which token travels.** The Shadowdark Extras party token, when exactly one
  is on the map. Otherwise select the one token that travels before pressing
  **Travel**.
- **Who travels.** That party's members, or every player-owned character.
- **While travelling** the Crawl Strip is off and the crawl's movement isn't
  tracked. The bar shows **Overland**, today's weather once it's rolled, and the
  hexes left, followed by **Start day**, **Weather** and **End travel**. A combat started while travelling takes over as usual and
  hands back to travel when it ends.
- **Weather** rolls today's weather and posts it to chat. It holds until the
  next dawn, so pressing it again the same day only reminds you what it is.
  With the Western Reaches rule (the default) a 1 is stormy and a 6 is
  excellent, which gives the next day's roll advantage. With the core rule a 1
  is a storm for 1d4 days, with no roll while it lasts. Pick the rule under
  **Configure Settings → Shadowdark Enhancer → Overland**. A storm makes
  normal terrain difficult, and a storm in a harsh climate stops travel
  altogether.
- **Start day** opens a travel day. Pick walking, mounted or sailing, and a
  boat actor to sail aboard. Tick **Push on** for half as many hexes again,
  at the same pace. The weather is rolled first if today's hasn't been. The
  hexes per day come from **Edit Rules Data**, or from the boat's speed.
- **Moving the travel token** costs each hex's terrain cost from the day's
  hexes, and moves the world clock: a travel day is 8 hours, so walking costs
  2 hours per point. Following a path from one path hex to the next costs 1.
  A move the day can't pay for bounces, with a message saying why. To
  reposition the token without spending anything, move it with the
  **Displace** movement action.
- **End travel** stops travelling but keeps where the party is and the day's
  progress, so **Travel** later picks up where it left off.
- **Start** still begins a crawl, for example when the party reaches a dungeon.
  To travel again after a crawl, end the crawl first.

Encounter checks, foraging, rations and camp come with the next pieces.

## The party cards

![A single crawl strip card](images/crawl-strip-card.png)

Each card displays live actor data:

| Element | Detail |
|---|---|
| **Portrait & name** | Drawn from the actor document |
| **HP bar** | Current/Max HP with color bands (Green >75%, Yellow ≤75%, Orange ≤50%, Red ≤25%, Black ≤0) |
| **AC** | Displayed as `AC n` |
| **Luck pill** | PCs only. On your own PC: left-click spends a token, right-click adds one (the GM can do both on any PC). On another player's PC: left- or right-click gives them one of yours. Each posts a chat card. |
| **Movement pill** | `remaining / budget ft`. Turns red when over budget. |
| **Active effects** | Icons for current effects with hover tooltips for duration |
| **Light source** | PC cards: click to toggle character light source |
| **Initiative** | d20 button when unrolled; badge showing result once rolled |
| **Current turn** | Active combatant card is outlined in accent color; others dim |
| **Dying badge** | A PC at 0 HP: **Dying** with the rounds left (no count for players under hidden timers) or **Stable**. Click it to stabilize with your selected character, or, as GM, for the dying buttons |
| **Skull** | Marks a dead PC, or a defeated combatant |
| **Eye-slash** | Marks a combatant hidden from players |

Players see only the HP bar on a hostile NPC's card: no HP numbers, no AC, and
no movement pill. The same applies to an NPC whose token disposition is
**Secret**. The GM always sees the full card.

### The GM card

The strip includes a **Game Master** card. Click its portrait to open a file
picker and set your avatar, or configure it under **Configure Settings → Shadowdark Enhancer → Crawl Strip →
Game Master avatar**.

### The Merchant Shop button

In crawl mode, the **PARTY** plate on the left includes a shop button. Click it
to open [Merchant Shop](Merchant-Shop.md). This button disappears in combat.

### Activating turns (GM)

In combat, each card includes a GM-only button to activate or end that
combatant's turn manually.

---

## The action menu

Cards you own display an action tab strip underneath. Hovering a tab opens a
panel organized in Shadowdark stat-block layout so players can act without
opening their sheets:

| Actor type | Tabs available | Contents |
|---|---|---|
| **NPC** | Actions · Abilities | Attacks, special attacks, and features |
| **PC** | Weapons · Spells · Abilities | Equipped weapons, spells/wands/scrolls, and class abilities |

- **Weapons & attacks:** Shows damage inline with melee/ranged icons. Click to
  roll using standard system attack rolls.
- **Spells:** Lists memorized spells, wands, and scrolls. Wand charges and
  scroll consumption follow system rules.
- **Hidden items:** The menu automatically hides lost spells, spent wand
  charges, broken wands, and stashed or unidentified items.
- **Abilities & features:** Click to open the item sheet for full rules text.

---

## Hidden combatants

The module automatically synchronizes `token.hidden` and `combatant.hidden`:

- Tokens hidden on the canvas produce hidden tracker combatants.
- Initiative rolls for hidden combatants are suppressed entirely from player
  chat, avoiding spoiler roll notifications.

---

## Troubleshooting

**The strip is empty in crawl mode.**  
Select your player tokens on the canvas and click **Add Tokens** on the crawl
bar. Only `Player` actors are added.

**A player card disappeared after changing scenes.**  
Cards require an active token on the current scene to calculate movement
budgets. Place the player's token on the scene.

**An enemy disappeared from the strip during combat.**  
Monsters and NPCs at 0 HP or marked defeated leave the strip automatically.
Healing them or clearing the defeated marker brings them back.

**The combat tracker jumped past a turn automatically.**  
The module automatically advances past dead combatants. Use the strip's
**Previous Turn** button if you need to take an action on that turn.

**No card is highlighted and it looks like nobody's turn.**  
The active turn pointer landed on a defeated combatant. On GM screens, this
advances automatically. If all enemies are dead, end the combat encounter.

**Two party strips appear on screen.**  
Disable the legacy `shadowdark-crawl-helper` module in your world.

**Clicking a Luck pill does nothing.**  
The character has 0 Luck tokens remaining, or the world is in classic mode where
Luck caps at 1.

---

**Related:** [Movement Budgets](Movement-Budgets.md) · [Random Encounters](Random-Encounters.md) · [Session Recap](Session-Recap.md) · [Settings Reference](Settings-Reference.md)
