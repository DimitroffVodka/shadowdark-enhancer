# Dying and Death Timers

[← Wiki home](index.md)

The core rulebook's dying rule (p.89), run for you: a character at 0 HP is
dying, rolls a death timer, gets a chance to rise every turn, and can be
stabilized by a friend. Deadly and Fatality (p.111) change it from the
[Modes of Play](Settings-Reference.md#modes-of-play) window.

Nothing else in a Shadowdark world does this. The system only marks a character
prone and unconscious when damage takes it to 0 HP. Shadowdark Crawl Helper used
to run death timers, and while it is active this module leaves dying alone,
because the two would run two timers. The module's usual Crawl Helper warning
at world load says so (and **Warn when shadowdark-crawl-helper is enabled**
turns it off).

---

## At 0 HP

A player character that reaches 0 HP by any path (damage from a chat card, an
edit on the sheet, an effect) gets the **Dying** status and **unconscious**.
Its death timer is rolled straight away: **1d4 + CON modifier, minimum 1**. The
owning player's client rolls the die, so the dice are theirs, and the GM's
client adds the modifiers; if the player is not connected, the GM's client
rolls. The timer shows on the character's crawl strip card as **Dying: 3**, and
a chat line says how many rounds are left.

The system also marks the character defeated in the combat tracker. On the
strip, a dying or stable character shows the dying badge instead of the skull;
the skull is for the dead, in combat or out of it.

## Each turn

At the start of a dying character's turn, its owner rolls a d20:

- a **natural 20** and the character rises with 1 HP, and all of this clears;
- anything else takes one round off the timer;
- when the timer reaches 0, the character is **dead**: the dead status, marked
  defeated in the tracker, a skull on the strip card, and its turn is skipped
  from then on.

Only a round the character has not rolled in yet counts, and only moving
forward: going back a turn or several rounds and forward again, or Chaos Mode
moving the turn, never costs a round twice. A turn that Foundry's *Skip
Defeated* option jumps over still counts: the round passed. A new combat starts
the count afresh.

**Out of combat** the timer runs on crawl rounds. Every time the crawl round
advances, each dying crawl member rolls as if its turn had started; stepping the
round back and forward again does not roll twice, and a new crawl starts the
count afresh.

A character marked dead any other way (the tracker's skull, a token's dead
status) stops rolling.

## Stabilizing

Another character can stabilize a dying one with an **Intelligence check, DC
15**. Anyone with an Intelligence score can do it, NPC allies included. The
rule's close range is left to the table.

1. Select the helper's token (a player's own character works without selecting).
2. Click the **Dying** badge on the dying character's strip card.
3. Pick **Stabilize with ...**. The system's own check opens, with advantage and
   bonuses as usual, and the DC already set.

On a success the character stops dying: the timer is gone, and it stays at 0 HP,
unconscious, until healed. The badge reads **Stable**. A failed check can be
rerolled with a luck token from its chat card as usual; a reroll that succeeds
stabilizes too.

The GM's client decides: it works out the DC (the helper's own DC, Deadly, a
Draugr within near on the scene the GM is viewing), and it stabilizes when the
check's card shows a total at least that high, from a GM or the helper's own
player.

**Healing above 0 HP** clears everything: dying, stable, unconscious and the
defeated mark.

## The GM's buttons

Clicking the badge as GM also offers the situational rules:

| Button | For |
|---|---|
| **One more round** / **One round fewer** | Pit Fighter's Relentless, a spell that buys time. Never below 1. |
| **Stabilize, no roll** | A potion that stops dying, Last Stand's once-a-day success |
| **Conscious while dying** | The tier-5 necromancer spell's rounds of acting while dying. The timer still runs, and the defeated mark comes off so *Skip Defeated* doesn't skip the turns it acts in. |
| **Rise now, at 1 HP** | Any rule that simply brings the character back |

With two GMs connected, the buttons of the one who is not the active GM are
carried out by the active GM's client, in order with everything else.

## Deadly and Fatality

| Setting | Effect |
|---|---|
| **Death timers are always 1** | Nothing is rolled. This beats every die and bonus below. |
| **Stabilizing is DC 18** | Unless the helper has a stabilize DC of their own, which wins (Heath Witch training keeps 12). |
| **Hidden death timers** | An option, not a Deadly rule. The GM's client rolls the timer blind and the rounds left are whispered to the GM; players see **Dying** with no count. |
| **Characters die at 0 HP** (Fatality) | No dying at all: 0 HP is dead. |

Each works on its own.

## Modifiers

Class features, training and monsters change the rule through Active Effects.
Each modifier is a flag key; put it on an effect on the character (or the
creature) with the change type shown.

| Key | Type | On | Effect | Example |
|---|---|---|---|---|
| `flags.shadowdark-enhancer.dyingTimerDie` | override | the dying character | Die of the death timer | Necromancer, River of Death: `6` |
| `flags.shadowdark-enhancer.dyingTimerBonus` | add | the dying character | Added to the timer roll | Gladiator training: `1` |
| `flags.shadowdark-enhancer.dyingRiseMin` | override | the dying character | Lowest natural d20 that rises | Pit Fighter, Last Stand: `18` |
| `flags.shadowdark-enhancer.dyingRiseMinNear` | override | an ally | The same, for dying allies within near of it (same token disposition), checked at the moment of the roll | Paladin, Inspiring Presence: `18`, or `17` with its talent |
| `flags.shadowdark-enhancer.stabilizeDC` | override | the helper | The DC when this character stabilizes someone; beats everything | Heath Witch training: `12` |
| `flags.shadowdark-enhancer.stabilizeDCNear` | override | a creature | Stabilizing anyone within near of it needs at least this DC | Draugr, Death Chill: `18` |
| `flags.shadowdark-enhancer.noDeathAtZeroCon` | override | the character | `1` (or `true`): CON 0 from [stat damage](Stat-Damage.md) does not kill | Necromancer, River of Death; Ancient Ritual training |

Use `override` rather than `upgrade`/`downgrade`: Foundry's upgrade does
nothing on a flag no effect has set yet. Values are numbers.

The Regional Training benefits **+1 to death timer rolls** (Gladiator),
**Stabilising is always DC 12** (Healer) and **Survive 0 CON** (Ancient Ritual)
carry these effects when taught.

## Limits

- "Within near" (30 feet) is measured on the scene the active GM is viewing,
  for the stabilize DC and the rise range alike.
- The hidden timer hides the count from the table, not from a player who reads
  the character's data in the console.
- Inspiring Presence's healing (the Paladin's CHA bonus in HP on rising) is not
  applied: the character rises at 1 HP and the GM adds the rest.
- A character already at 0 HP before this module version is not dying until its
  HP changes: set it to 1 and back to 0 to start.
- Monsters are not affected; they drop off the strip at 0 HP as before.

For macros and other modules, `game.shadowdarkEnhancer.dying` is described in
the [API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md).
