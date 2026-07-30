# Pit Fighting

Cursed Scroll 2's pit fights, set up in the book's own order. Roll a venue, roll
the stakes against the fighters' average level, settle how dangerous it is, draw
the foe, and check for a twist you keep to yourself until the fight is on.

Open it from the Crawl Bar's **Forge & Loot** menu → **Pit Fighting**. GM only.

---

## Before you start: import the tables

The roller holds the dice and the thresholds. Everything you can *read* — what
the venue is, what the twist turns out to be, what a tier is fought for, which
creatures you face — lives in RollTables you import from your own copy of CS2,
the same as the rest of [the importer's sealed content](Importer-Hub.md).

The roller reads six of them:

- **Venue** and **Twist** — read at the row your 2d6 landed on
- the six **Pit Fight** encounter tables (solo and group, at each danger tier) —
  one of which is drawn from, whichever the danger level selects
- the four prize tables (**Low**, **Mid**, **High** and **Epic Stakes**) — drawn
  when you roll for the prize

CS2 prints two more that the roller doesn't consult. **Stakes** is a range-to-tier
lookup, and those bands are plain numbers the module already knows, so it rolls
your average level + 1d6 and reads the tier itself. **Tonight's Crowd** is colour
for the Thraxis Arena; import it and roll it yourself when you want it.

You don't have to import anything before you start. Whatever's missing, the window
lists by name with a button through to the importer, and leaves that line blank
rather than making something up. A bout with no Venue table still rolls — you just
get the die total and the row number instead of the description.

---

## Setting up a bout

**Pick who enters the pit.** Everyone is ticked to begin with. Two things follow
from the selection: more than one fighter uses the *group* encounter tables
instead of the solo ones, and the fighters' average level sets the stakes. If
that average isn't a whole number it rounds to nearest, and the window shows you
the unrounded figure beside it so you can see what happened.

**Set up a bout** then rolls three things at once:

| Roll | Dice | What it decides |
|---|---|---|
| Venue | 2d6 | Where the fight happens |
| Stakes | average level + 1d6 | What it's worth: Low, Mid, High or Epic |
| Twist | 2d6 | Whether something goes sideways — kept hidden |

**Danger** is the one thing the module won't decide for you. The book gives you
the stakes and the venue and then leaves the call to the GM, so the dropdown
arrives pre-set to what the stakes suggest and you change it if the venue argues
otherwise — a back-alley cellar and a noble's private arena can pay the same and
be nothing alike. Changing it picks a different encounter table, so the foe is
redrawn from the one that now applies.

Once the danger is settled the fighters accept or decline, and that's a
conversation at the table rather than a button here.

---

## The twist

The twist is rolled during set-up and stays hidden. The window tells you it's
there and nothing else reaches chat, including when the answer is *nothing
happens* — if the hidden line always meant trouble, hiding it would tell the
table something.

Press **Reveal** when it comes out mid-bout and it posts to chat. One band asks
for a second d4 to pick its detail; that's already rolled and comes along with
the reveal.

One band has a mechanical effect the roller applies for you: a donor raising the
stakes a step. That moves the **prize** table up — it does not make the fight
more dangerous. You set the danger and the fighters agreed to it before anyone
mentioned a donor.

---

## Afterwards

Mark the bout **Won** or **Lost**, and roll the prize table for the tier that was
actually fought for (raised, if the twist raised it).

**Renown each** is how much fame every fighter takes away. CS2 says pit fighting
earns treasure, experience and fame, and never says how much fame — so the
default is one point for a win and nothing for a loss, and you should change it
when the fight deserves it. It isn't scaled by stakes on purpose: a ladder would
look like a rule, and there isn't one in the book.

**Apply the result** posts a summary card and puts the renown through the same
single write path everything else uses, so each change is logged to the
[Session Recap](Session-Recap.md) and announced like any other — see
[Renown](Renown.md).

XP and treasure aren't awarded here. Use [Party XP](Party-XP.md) for the
experience and the prize row for what they carried out.

---

## Things worth knowing

**Lethality is yours to set.** The book ties how deadly a bout is to the venue
and the stakes — fights to half HP, to a knockout, occasionally to the death —
and killing humanoids is forbidden in most public venues. None of that is
automated. The danger level is a label the roller uses to pick an encounter
table; what happens when a fighter drops is a ruling at your table.

**The foe is a table row, not an actor.** The encounter tables name creatures and
a complication. If those creature names don't resolve to monsters you own, the
importer's census will list them as gaps — CS2's own arena monsters are on page
39 and import like any other stat block.

**Rerolling.** *Roll a new bout* rolls everything fresh and clears the result
below it. Changing the danger keeps the same dice and only redraws the foe.

---

## See also

- [Renown](Renown.md) — where the fame goes
- [Downtime](Downtime.md) — the book files pit fighting under downtime activities
- [Importer Hub](Importer-Hub.md) — importing the fourteen tables
- [Random Encounters](Random-Encounters.md) — the encounter roller, a separate tool
