# Renown

[← Wiki home](Home.md)

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

A character's renown starts equal to their **CHA modifier**. The dialog's
**Start at CHA mod** button sets it for you; it ignores the Change field.

---

## The four bands

| Renown | Band | Bonus |
|---|---|---|
| 3 or less | Unknown | — |
| 4 to 7 | Locally known | +1 |
| 8 to 11 | Known name | +2 |
| 12 or more | Celebrity | +3 |

By the book, the bonus applies to **reaction rolls** and **carousing event
rolls**. The module automates the reaction roll only — the Encounter Roller's
**Recognised here** toggle is what adds it. Carousing is not automated anywhere
in the module, so if your table uses the carousing tables, add the bonus by hand
when you roll them.

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

The dialog has three parts:

1. **The roster** — every party character, their renown, the band it puts them in,
   what that band means, and the bonus it grants.
2. **The form** — which character, how much (**Change**, negative to dock), and a
   **Reason**. The reason box suggests the book's triggers as you type; you are
   free to write your own.
3. **Apply**, **Start at CHA mod**, **Cancel**.

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

### Level-up is the one automatic trigger

Gaining a level is the only trigger that is not a judgement call, so it is the
only one wired up. When a player character's level goes up, they gain a point of
renown. A two-level jump grants two.

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

Every renown change lands in two places:

- **A chat card**, naming the character, the change, the new total, the band and
  your reason. Public, because renown *is* public reputation — a triumph and a
  humiliation are both things the table watched happen.
- **The [Session Recap](Session-Recap.md)**, on its **XP & Renown** tab, grouped
  by player with a net change per character. The Discord export gains a
  `## Renown` section alongside XP and Downtime.

The recap only records while a session is running, exactly like loot, XP and
purchases. Outside a session the chat card is the record.

There is no separate Renown Log journal. Downtime has one because downtime is
resolved between sessions with no recap running; a renown change happens at the
table, is announced in chat, and any renown change that came from downtime is
already in the Downtime Log.

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
