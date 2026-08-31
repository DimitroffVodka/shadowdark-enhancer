# Renown

[← Wiki home](index.md)

Renown is how well known a character is — fame or infamy, from a Western Reaches
rule (p233). The Shadowdark system already stores the number on the player sheet;
what the module adds is the band ladder that gives the number meaning, one place
that every change goes through, and the toggle that folds a renown bonus into a
reaction roll when the party is somewhere it would be recognised.

<!-- TODO screenshot: images/renown.png — the Renown dialog, roster on top
     How: Crawl Bar → right-click Forge & Loot → Renown, with 3+ party PCs whose
     renown values land in different bands. -->

---

## Opening it

| Route | How |
|---|---|
| **Crawl Bar** | Right-click **Forge & Loot** → **Renown** |
| **API** | `game.shadowdarkEnhancer.renown.open()` |

GM only. Renown changes write the session recap, which a player client cannot do.

---

## Where the number lives

`system.renown`, on the Shadowdark **Player** actor. The module does not define
it and does not migrate it — the system ships both the field and a sheet input
for it, and this feature reads and writes that same value. Anything you set by
hand on the sheet is picked up everywhere below.

**Renown may go negative.** A character with a poor CHA modifier starts below
zero, and the docking triggers can push anyone there.

A character's renown starts equal to their **CHA modifier**, and a new character
is seeded automatically — see below.

---

## The four bands

| Renown | Band | Bonus |
|---|---|---|
| 3 or less | Unknown | — |
| 4 to 7 | Locally known | +1 |
| 8 to 11 | Known name | +2 |
| 12 or more | Celebrity | +3 |

By the book, the bonus applies to **reaction rolls** and **carousing event
rolls**. This module automates the reaction roll — the Encounter Roller's
**Recognised here** toggle is what adds it.

**Carousing is not this module's feature, and you should not add the bonus by
hand for it.** Carousing lives in **Shadowdark Extras**, which already adds the
same bonus off the same ladder (`getRenownBonus` in its `CarousingSD.mjs`) when
you drop a character on a carousing tier. Adding it again yourself would double
it. Only add it by hand if you are rolling carousing straight from the book with
Shadowdark Extras not installed.

Each band carries a one-line note about how people treat you, shown beside the
band in the Renown dialog and on the Encounter Roller. Those notes are the
module's own summary, not the book's text — the book's own descriptions of each
band are longer and stay in the book.

The band shows up in three places, all of them somewhere renown was already on
screen:

- the **Renown dialog** — the whole party, with values, bands, meanings and bonuses
- the **Downtime** window's purse strip, beside the crown icon
- the **Encounter Roller**, on the reaction row, when the bonus is in play

---

## Reaction rolls

The Encounter Roller rolls `2d6` for reaction and lets you dial in a CHA modifier.
Renown adds a second, conditional modifier.

Under the CHA stepper:

- **Recognised here** — a toggle, **off by default**. The bonus is not automatic:
  a character adds it only where they would plausibly be known, and only you can
  say whether this tavern, this road or this backwater is such a place.
- a **picker** for whose renown applies. It defaults to the party's *most*
  renowned character, because one reaction roll covers the whole encounter and
  the party is effectively putting its best-known face forward. Change it if
  someone else is doing the talking.

With the toggle on, the reaction row shows the arithmetic and the reason:

```
Reaction   2d6+CHA = 7 + (0) + 2   →   Neutral
           Renown +2 — Eliara is Known name here (9 renown)
```

The same line rides along on the chat card, so the table can see why the
reaction landed where it did.

> **Double 1s are always hostile.** Two 1s on the reaction dice mean a hostile
> reaction no matter what the CHA modifier and the renown bonus add up to. The
> roller says so on the card when it happens. (Before this feature the module did
> not apply that rule at all — a `2` with a `+5` CHA modifier came out
> *Suspicious*.)

The picker and the toggle only appear when the world has player characters —
Player actors with a player owner, the same party definition Party XP and
Downtime use.

---

## Awarding and docking

Most renown triggers are a call you make at the table, so the affordance is a
dialog rather than automation.

The dialog has four parts:

1. **The roster** — every party character, their renown, the band it puts them in,
   what that band means, and the bonus it grants.
2. **The form** — which character, how much (**Change**, negative to dock), and a
   **Reason**. The reason box suggests the book's triggers as you type; you are
   free to write your own.
3. **Renown log** — collapsed by default. Every recorded change, grouped by
   player. See [What gets recorded](#what-gets-recorded).
4. **Apply**, **Start at CHA mod**, **Cancel**.

The suggested triggers:

| Gains | Losses |
|---|---|
| Gained a level | Public humiliation |
| Honoured in public | Trouble with the law |
| Lavish public spending | A fashion misstep |
| A major triumph | A cultural blunder |
| | Offended someone grander |

The character is pre-selected from your currently selected token, if that token
is a party character; otherwise it starts on whoever has the most renown.

### Starting renown is set for you

A new player character's renown is set to their **CHA modifier**, once, with no
click. A CHA modifier of -1 starts them on -1.

The seed is attempted when the character is created and again the first time their
Charisma changes, because the two ways a character comes into a world differ:

- The **Character Builder** and the **level-0 funnel** write the abilities as part
  of creating the actor, so the seed lands immediately.
- **Create Actor** makes a character on the model's default 10s (CHA modifier 0)
  and gets its real scores minutes later, by hand. A seed of exactly +0 does not
  count as spent, so that character is still seeded when its Charisma arrives.

It runs **once per character, ever**, and it refuses to touch a character whose
renown is already non-zero or who already has a renown log entry. A stat fix or a
curse years into a campaign cannot reset somebody's fame.

Turn it off with **Starting renown from CHA** in
[Settings Reference](Settings-Reference.md#renown).

**To seed a character made before this existed**, or one whose CHA has since
changed, use the dialog's **Start at CHA mod** button — an explicit click
overrides both the setting and the once-only rule, and posts a chat card. It sets
renown to the CHA modifier rather than adding to it, and ignores the Change field.

### Level-up is the other automatic trigger

Gaining a level is the only other trigger that is not a judgement call, so it is
the only other one wired up. When a player character's level goes up, they gain a
point of renown. A two-level jump grants two.

Reaching **level 1 is excluded**. The Character Builder and the level-0 funnel
both write the level as part of creating the character, and renown already starts
at the CHA modifier, so awarding there would hand every new character a free
point.

Turn it off with **Renown on level-up** in
[Settings Reference](Settings-Reference.md#renown).

### Downtime writes renown too

Two [Downtime](Downtime.md) outcomes move renown — gaining favour with a church,
and starting a rumour about someone. Both now go through the same write path, so
they are logged like every other change. They do **not** post a second chat card,
because the downtime result card already reports what happened.

---

## What gets recorded

Every renown change lands in three places:

- **The renown log on the character.** Permanent, the only one of the three that
  does not depend on anything else being switched on, and the only one that
  records changes this module did not make. Open the **Renown** dialog and expand
  **Renown log** to read it: one collapsible section per player, with their net
  change and every individual change under it — the character, what moved, the
  total it produced, why, and when.
- **A chat card**, naming the character, the change, the new total, the band and
  your reason. Public, because renown *is* public reputation — a triumph and a
  humiliation are both things the table watched happen.
- **The [Session Recap](Session-Recap.md)**, on its **XP & Renown** tab, grouped
  by player with a net change per character. The Discord export gains a
  `## Renown` section alongside XP and Downtime.

The recap only records while a session is running, exactly like loot, XP and
purchases — which is exactly why the log on the character exists. A renown change
made between sessions, or with no recap started, used to survive only as a chat
card, and chat gets cleared.

The log is written in the **same actor update as the number itself**, so the two
cannot disagree: a change that failed to apply leaves no row, and a row always
carries the total it actually produced. Each character keeps its **last 50
changes**; older ones fall off the front, since the log lives on the actor
document and travels with a character export.

Grouping is by the player who owned the character **at the time of the change**,
so handing a character to another player does not rewrite its history.

### Changes made outside the module

`system.renown` belongs to the Shadowdark system, so the sheet's own input, a
macro, and other modules can all write it. Those changes are caught too, and
appear in the log as **Changed outside the module** with the right numbers and
time — they just carry no reason, because nothing supplied one.

Where the writer says what it did, the log says so too: the row shows that
wording, with a small tag naming the cause. **Shadowdark Extras' carousing** does
this — it hands its renown changes to this module, so a carousing mishap reads as
its own sentence tagged **Carousing** rather than as an anonymous adjustment. No
chat card, because SDX's carousing card already reported it.

A writer that cannot do that still gets caught by the watcher; it just shows up as
*Changed outside the module*.

A change made before this existed cannot be recovered — there was no record of it
to read. The value on the sheet is still correct; only the log entry is missing.

There is no separate Renown Log journal. Downtime has one because downtime is
resolved between sessions with no recap running; renown now keeps its own record
on the character instead, and any renown change that came from downtime is also
in the Downtime Log.

**API.** `game.shadowdarkEnhancer.renown.history(actor)` returns one character's
log oldest-first; `historyByPlayer()` returns the whole party's, grouped.

---

## What ships and what doesn't

Band thresholds, bonus numbers and trigger labels are mechanics, and the module
ships them. The book's own descriptions of the four bands are its writing and do
not ship — the one-line meanings in the UI are our compression of what each band
does at the table.

This is a smaller surface than [Downtime](Downtime.md), which unlocks its text
from your own book through the Importer Hub. Renown does not need that: there are
four short lines, and the mechanics behind them cannot be expressed any other way.

---

## Troubleshooting

**The Renown dialog says there are no player characters.**
Renown is tracked on **Player** actors that have a **player owner**. An actor with
no assigned player is not part of the party for this purpose. Same rule as Party
XP and Downtime.

**The Recognised here toggle isn't there.**
It only renders when the party is non-empty, and only on a monster result — a
flavour-text encounter has no reaction roll.

**Levelling up didn't grant renown.**
Check three things: **Renown on level-up** is on; the new level is 2 or higher
(reaching level 1 is deliberately excluded); and the level actually changed on the
actor rather than being typed into a sheet that was then closed without saving.

**Renown changed but nothing appeared in the Session Recap.**
The recap only accepts entries while a session is active. Start one from the Crawl
Bar. The chat card is posted either way.

**A player pressed something and nothing happened.**
Nothing renown-related is player-facing. The dialog is GM-only, and a non-GM call
to `renown.award` is refused with an error rather than partly applied — renown
writes the recap world setting, which a player client cannot do.

---

## See also

- [Random Encounters](Random-Encounters.md) — the Encounter Roller and the reaction roll
- [Downtime](Downtime.md) — the two activities that move renown
- [Session Recap](Session-Recap.md) — where changes are logged
- [Settings Reference](Settings-Reference.md#renown) — the level-up setting
