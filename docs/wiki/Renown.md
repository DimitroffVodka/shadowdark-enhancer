# Renown

[← Wiki home](index.md)

Renown measures how well known a character is—their fame, notoriety, or infamy—
following the Western Reaches rules (page 233).

The Shadowdark system stores the raw number on the character sheet. This module
provides the band ladder that gives that number mechanical meaning, a single
auditable write path for awards and penalties, and a reaction roll modifier for
when the party encounters someone who might recognize them.

<!-- TODO screenshot: images/renown.png — the Renown dialog, roster on top
     How: Crawl Bar → right-click Forge & Loot → Renown, with 3+ party PCs whose
     renown values land in different bands. -->

---

## Opening Renown

| Route | How |
|---|---|
| **Crawl Bar** | Right-click **Forge & Loot** → **Renown** |
| **API** | `game.shadowdarkEnhancer.renown.open()` |

The Renown window is GM-only because adjustments record directly to the session
recap.

---

## Where renown lives

Renown is stored in `system.renown` on Player actors. The core Shadowdark system
ships both the property and a sheet input for it. This module reads and updates
that exact field. Any value you edit manually on a character sheet is recognized
immediately.

- **Negative values are supported:** A character starting with a negative
  Charisma modifier begins below zero, and serious blunders can push renown into
  negative numbers.
- **Starting value:** By default, new characters start with renown equal to
  their **CHA modifier**.

---

## The four renown bands

| Renown score | Status band | Modifier |
|---|---|---|
| **3 or less** | Unknown | — |
| **4 to 7** | Locally known | +1 |
| **8 to 11** | Known name | +2 |
| **12 or more** | Celebrity | +3 |

By the rules, this bonus applies to **reaction rolls** and **carousing event
rolls**.

- **Reaction rolls:** Automated directly in the [Encounter Roller](Random-Encounters.md)
  via the **Recognised here** toggle.
- **Carousing rolls:** If you run the optional **Shadowdark Extras** module, it
  reads this exact ladder and applies the bonus automatically. If you run
  without Extras, you can apply the bonus manually when rolling carousing from
  the book.

Renown bands appear in three places:

1. The **Renown dialog** (party roster with scores, bands, and bonuses).
2. The **Downtime window** purse header (beside the crown icon).
3. The **Encounter Roller** reaction breakdown when a bonus is active.

---

## Reaction rolls

The Encounter Roller rolls `2d6 + CHA` for reaction checks. Renown adds an
optional, situational bonus.

Under the CHA modifier stepper in the Encounter Roller:

- **Recognised here:** Toggle **off by default**. Enable this when the encounter
  takes place in a town, tavern, or region where the character is known.
- **Character picker:** Select which party member's reputation applies. Defaults
  to the most renowned character in the party.

When enabled, the reaction roll displays the full calculation:

```
Reaction   2d6+CHA = 7 + (0) + 2   →   Neutral
           Renown +2 — Eliara is Known name here (9 renown)
```

The breakdown posts directly to chat so the table can see why the reaction
landed where it did.

> **Double 1s are always hostile.** Rolling double 1s on reaction dice always
> results in a Hostile reaction regardless of CHA modifiers or renown bonuses.

---

## Awarding and docking renown

Because most renown changes are table rulings, the primary interface is a
dedicated GM dialog.

The dialog includes:

1. **Party Roster:** Current scores, status bands, and modifiers for all PCs.
2. **Award Form:** Select the character, enter the **Change** (negative numbers
   dock renown), and provide a **Reason**.
3. **Trigger Suggestions:** Quick-fill common book triggers as you type.
4. **Renown Log:** Collapsible per-player ledger of all past changes.

Suggested triggers from the book:

| Gains | Losses |
|---|---|
| Gained a level | Public humiliation |
| Honoured in public | Trouble with the law |
| Lavish public spending | A fashion misstep |
| A major triumph | A cultural blunder |
| — | Offended someone grander |

### Automatic starting seed

When a new player character is created, their starting renown is automatically
set to their **CHA modifier**.

- Runs once per character.
- Won't overwrite existing non-zero renown or existing log entries.
- To re-seed an older character or reflect an updated CHA modifier, click the
  **Start at CHA mod** button in the Renown dialog.

You can disable automatic seeding under **Settings → Starting renown from CHA**.

### Automatic level-up awards

When a character reaches **level 2 or higher**, the module automatically awards
**+1 renown** per level gained.

- Reaching **level 1 is excluded** so new characters don't receive double awards
  alongside their CHA modifier seed.
- Disable automatic level awards under **Settings → Renown on level-up**.

### Downtime renown awards

Activities in [Downtime](Downtime.md) that award or dock renown (such as gaining
favor with a church or spreading rumors) route through this same write path,
logging the event automatically.

---

## What gets recorded

Every renown change is tracked in three locations:

1. **The character's renown log:** Stored on the actor document (`flags["shadowdark-enhancer"].renownLog`),
   preserving the last 50 changes even across exports.
2. **Public chat card:** Posts the character name, change, new score, band, and
   stated reason to chat.
3. **Session Recap:** Logged to the **XP & Renown** tab during active sessions
   and included in Discord recap exports.

### Changes made outside the module

If renown is edited directly on a character sheet, by a macro, or by another
module, the enhancer detects the change automatically and logs it as **Changed
outside the module**.

When external tools (such as Shadowdark Extras carousing) send structured awards
through the enhancer API, the log stamps the specific cause (such as a
**Carousing** tag) without double-posting chat cards.

API helpers:

- `game.shadowdarkEnhancer.renown.history(actor)`: Returns a character's full log.
- `game.shadowdarkEnhancer.renown.historyByPlayer()`: Returns the party log
  grouped by player.

---

## Troubleshooting

**The Renown dialog says there are no player characters.**  
Renown tracks `Player` actors assigned to a player owner. Assign character
ownership in Foundry's user configuration.

**The "Recognised here" toggle is missing in the Encounter Roller.**  
The toggle appears only when player characters are in the world and only on
monster/NPC results that require a reaction roll.

**Levelling up did not award renown.**  
Verify that **Renown on level-up** is enabled in settings, that the character
reached level 2 or higher, and that the new level was saved to the actor.

**Renown changed, but nothing appeared in the Session Recap.**  
Recaps record only while a crawl session is actively running. Start a crawl from
the Crawl Bar.

---

## See also

- [Random Encounters](Random-Encounters.md) — Encounter Roller and reaction rolls
- [Downtime](Downtime.md) — Downtime activities that grant or reduce renown
- [Session Recap](Session-Recap.md) — Session activity log and Discord export
- [Settings Reference](Settings-Reference.md#renown) — Renown world settings
