# Modes of Play

[← Wiki home](index.md)

The optional rules from the core rulebook (p.111), and Hard Luck from the Game
Master's Guide to the Western Reaches (p.30), in one window. Every rule is its
own switch, so you can run one rule of a mode without the rest of it.

Everything here is off until you switch it on.

---

## Opening the window

**Configure Settings → Shadowdark Enhancer → Modes of Play**. The button is
GM-only.

Each mode is a box of its own rules. The checkbox in a box's title turns every
rule in that box on or off at once. It shows ticked only when all of them are
on, and a dash when some are. There is no switch for every mode together.

Changes apply when you save the window. Players are not told which modes are
on.

A box can also hold an **option** that is not one of the mode's rules, such as
Chaos's Dice So Nice. The title checkbox leaves options alone.

---

## Blitz

**Light sources last 30 minutes.**

Lighting a torch or lantern sets it to 30 minutes left, or leaves it alone if
it already had less. It works however the light is lit: from the character
sheet, the crawl strip, or Shadowdark Extras' party inventory. A light spell
cast on a character lasts 30 minutes too.

- The torch's own maximum is untouched, so its sheet can read "30 of 60
  minutes". Turning Blitz off leaves no torch short.
- A light already burning when you switch Blitz on keeps its time until it is
  lit again.
- Shadowdark Extras' camping campfire keeps its 8 hours.

---

## Chaos

**Reroll initiative every round.**

At the start of every round after the first, every combatant rolls initiative
again, with the system's own roll and any advantage. The order is rebuilt and
the turn goes to whoever is now on top. A defeated monster that rolls to the
top is skipped as usual. Going back a round does not reroll.

One chat card per round, *Round N: initiative rerolled*, lists the new order.
Hidden combatants are left off it; you still see them in the tracker.

**Show Dice So Nice for Chaos rerolls** is an option: it rolls the 3D dice for
every round's reroll. It is off by default, because dice for the whole tracker
every round get tiresome. The order is posted either way.

Things to know:

- **Chaos does nothing while the system's clockwise initiative is on**, and
  says so once. Clockwise re-sorts the order every time initiative changes, so
  the two cannot run together.
- An effect that lasts "until your next turn" can end early or late, because
  turns move. That is the rule itself.
- Whoever was on top before the reroll has their turn start and end once as
  the order changes, so an effect that ends at the start or end of their turn
  can end a turn early.

---

## Deadly and Fatality

Dying itself (core rulebook p.89) runs whether or not any mode is on, except
while Shadowdark Crawl Helper is active. These two modes change it:

- **Deadly**: **Death timers are always 1** and **Stabilizing is DC 18**.
- **Fatality**: **Characters die at 0 HP**. There is no dying at all.

The Deadly box also holds **Hidden death timers**, an option of the dying rule
that works with or without Deadly: the GM's client rolls each timer out of
sight, and players see that a character is dying but not how long it has left.

See [Dying and Death Timers](Dying-and-Death-Timers.md#deadly-and-fatality) for
how each one plays.

---

## Grinder

Grinder changes how a rest heals, and the only rest in Foundry is Shadowdark
Extras' camping rest. So this box shows Extras' own Grinder settings, and the
hit dice setting appears only while Grinder is on. Without a Shadowdark Extras
that has Grinder Mode, the box says what is needed and nothing else.

Under Grinder, Extras' rest heals 1 point of each damaged ability rather than
all of it (see [Stat Damage](Stat-Damage.md#healing)).

---

## Hunter

**XP for defeated monsters.**

When a combat ends, every character who was in it gets XP for each monster
still down: marked defeated, or at 0 HP.

| Monster level | XP |
|---|---|
| 0 | nothing |
| 1 | 1 |
| 2 or more | half its level, rounded down |

- Each character gets the full total. It is not split, just as treasure XP is
  not.
- A dead character gets nothing. A dying one still gets it.
- Friendly combatants (summons, hirelings) and hidden ones are worth nothing.
- A monster that got back up before the end does not count.
- Monsters killed outside a combat are not counted.

It is paid as one [Party XP](Party-XP.md) card per combat, named *Hunter* and
listing the monsters, with the usual "ready to level up" marker, and it is
logged in [Session Recap](Session-Recap.md).

**Delete Encounter** on the Crawl Bar throws the fight away and pays nothing.
Any other end of the combat pays, including **End Encounter**.

---

## Momentum

The exploding damage switch here is the Shadowdark system's own setting, shown
in this window so it has one home. Advantage on repeating an action that just
failed is granted at the table; nothing tracks it.

If your installed system has no such setting, the box says so.

---

## Pulp

The system's own Pulp Mode setting (no maximum on luck tokens) shows here,
followed by three rules this module adds.

### 1d4 luck at the start of each session

When you start a crawl and choose **Start New Session** in Session Recap's
prompt, every player's assigned character has their luck tokens set to 1d4.
One chat card lists the rolls. **Continue Session** does not roll.

### Spend luck to turn a hit into a critical hit

Once an attack card shows a hit, its owner gets a **Luck: critical hit**
button. Pressing it spends one luck token:

- Damage already on the card keeps its dice and gains what a critical hit adds.
  A 1d8 weapon gets one more d8.
- Damage not rolled yet is rolled once, as a critical hit.

The button is not offered on a miss, on a natural critical hit, or on a card
that already used it. An attack with no target cannot say hit or miss, so the
button trusts the table and shows.

### Spend luck to make the GM reroll

A player whose character has a luck token gets a **Luck: force a reroll**
button on a GM's roll they can see. The roll is redone on the same card, and
the card names who forced it. An attack's damage follows the new result: it is
kept for the same kind of hit, rolled again if the hit became or stopped being
a critical hit, and dropped on a miss.

- Only a roll the player saw: not a blind roll, and not one whispered to
  someone else.
- A Shadowdark roll card, or a plain roll that shows only its total. Never
  initiative, and never a card that dresses its roll in text, such as a table
  draw.
- Once per card.

### How the spending works

Both buttons ask the GM's client, which checks the request, changes the card
and then spends the token. A token is never spent without the effect, so a GM
has to be connected. Only one player at a time can spend on a card. Every
spend is logged in [Session Recap](Session-Recap.md) like any luck reroll.

To spend a token for an extra action, use the luck pill on the
[crawl strip](Crawl-Strip-and-Crawl-Bar.md), which posts the spend to chat.

---

## Hard Luck

From the Game Master's Guide to the Western Reaches (p.30). Both rules refuse a
player's luck reroll from a chat card and say why. Damage rerolls and the GM's
own rerolls are never refused.

- **No luck rerolls on critical failures.** The system decides what a critical
  failure is, so an effect that widens the failure range counts too.
- **No luck rerolls with luck-granting effects.** Luck can't reroll a roll made
  with Bless, a Bard's Inspire, Trance or a Seer's Omen, whatever the result,
  so luck can't be spent to earn more luck. The spell or ability is matched by
  name, and one cast from a scroll or wand counts.

Only a reroll from the chat card can be checked. Luck spent from the crawl
strip or from Shadowdark Extras is not tied to a roll.

> **Upgrading from 0.17.3 or earlier?** The first rule used to be *Prevent
> Luck rerolls on natural 1s* under PC Automation, on by default. A world that
> ever saved that setting keeps its choice. A world that never did now lets
> luck reroll natural 1s until you switch the rule on here.

---

## Settings

Every rule is listed with its default in the
[Settings Reference](Settings-Reference.md#modes-of-play).
