# Dying and Death Timers

[← Wiki home](index.md)

The core rulebook's dying rule (p.89), run for you: a character at 0 HP is
dying, rolls a death timer, gets a chance to rise every turn, and can be
stabilized by a friend. Deadly and Fatality (p.111) change it from the
[Modes of Play](Settings-Reference.md#modes-of-play) window.

Nothing else in a Shadowdark world does this. The system only marks a character
prone and unconscious when damage takes it to 0 HP. Shadowdark Crawl Helper used
to run death timers, and while it is active this module leaves dying alone and
tells the GM so, because the two would run two timers.

---

## At 0 HP

A player character that reaches 0 HP by any path (damage from a chat card, an
edit on the sheet, an effect) gets the **Dying** status and **unconscious**.
Its death timer is rolled straight away: **1d4 + CON modifier, minimum 1**. The
owning player's client rolls it, so the dice are theirs; if they are not
connected, the GM's client rolls. The timer shows on the character's crawl strip
card as **Dying: 3**, and a chat line says how many rounds are left.

The system also marks the character defeated in the combat tracker. On the
strip, a dying or stable character shows the dying badge instead of the skull;
the skull is for the dead.

## Each turn

At the start of a dying character's turn, its owner rolls a d20:

- a **natural 20** and the character rises with 1 HP, and all of this clears;
- anything else takes one round off the timer;
- when the timer reaches 0, the character is **dead**: the dead status, marked
  defeated in the tracker, a skull on the strip card, and its turn is skipped
  from then on.

A turn counts once per round, so going back a turn and forward again, or Chaos
Mode moving the turn, never costs a second round. A turn that Foundry's *Skip
Defeated* option jumps over still counts: the round passed.

**Out of combat** the timer runs on crawl rounds. Every time the crawl round
advances, each dying crawl member rolls as if its turn had started.

## Stabilizing

Another character can stabilize a dying one with an **Intelligence check, DC
15**. Anyone with an Intelligence score can do it, NPC allies included. The
rule's close range is left to the table.

1. Select the helper's token (a player's own character works without selecting).
2. Click the **Dying** badge on the dying character's strip card.
3. Pick **Stabilize with ...**. The system's own check opens, with advantage and
   bonuses as usual, and the DC already set.

On a success the character stops dying: the timer is gone, and it stays at 0 HP,
unconscious, until healed. The badge reads **Stable**.

**Healing above 0 HP** clears everything: dying, stable, unconscious and the
defeated mark.

## The GM's buttons

Clicking the badge as GM also offers the situational rules:

| Button | For |
|---|---|
| **One more round** / **One round fewer** | Pit Fighter's Relentless, a spell that buys time. Never below 1. |
| **Stabilize, no roll** | A potion that stops dying, Last Stand's once-a-day success |
| **Conscious while dying** | The tier-5 necromancer spell's rounds of acting while dying. The timer still runs. |
| **Rise now, at 1 HP** | Any rule that simply brings the character back |

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
| `flags.shadowdark-enhancer.noDeathAtZeroCon` | override | the character | `true`: CON 0 does not kill (for stat damage) | Necromancer, River of Death |

Use `override` rather than `upgrade`/`downgrade`: Foundry's upgrade does
nothing on a flag no effect has set yet. Values are numbers.

The Regional Training benefits **+1 to death timer rolls** (Gladiator) and
**Stabilising is always DC 12** (Healer) carry these effects when taught.

## Limits

- "Within near" (30 feet) is measured on the scene the GM is viewing.
- The hidden timer hides the count from the table, not from a player who reads
  the character's data in the console.
- Inspiring Presence's healing (the Paladin's CHA bonus in HP on rising) is not
  applied: the character rises at 1 HP and the GM adds the rest.
- A character already at 0 HP before this module version is not dying until its
  HP changes: set it to 1 and back to 0 to start.
- Monsters are not affected; they drop off the strip at 0 HP as before.

For macros and other modules, `game.shadowdarkEnhancer.dying` is described in
the [API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md).
