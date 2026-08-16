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
for the arena's crowd; import it and roll it yourself when you want it.

You don't have to import anything before you start. Whatever's missing, the window
lists by name with a button through to the importer, and leaves that line blank
rather than making something up. A bout with no Venue table still rolls — you just
get the die total and the row number instead of the description.

---

## Setting up a bout

The window follows the book's own order: **the offer** first, then the secret
twist, and only then who steps up. The offer exists before anyone volunteers,
which is why the stakes are rolled against the **whole party's** average level —
shown at the top as *Party APL*. If that average isn't a whole number it rounds
to nearest and prints the unrounded figure beside it, so you can see what
happened.

**Roll the whole offer** rolls everything at once. Each line can also be rolled
on its own, or picked from its dropdown instead:

| Line | Dice | What it decides |
|---|---|---|
| Venue | 2d6 | Where the fight happens |
| Stakes | Party APL + 1d6 | What it's worth: Low, Mid, High or Epic |
| Size | — | Solo or group, which picks the encounter table |
| Danger | — | How dangerous, which picks the tier |
| Foe | table | Who they face — **Draw** redraws it |
| Twist | 2d6 | Whether something goes sideways — kept hidden |

**Size** is a button, not a consequence. Solo and group are separate tables in
the book, and the offer is made before you know how many will take it, so you
say which kind of bout is on the bill.

**Danger** is the one thing the module won't decide for you. The book gives you
the stakes and the venue and then leaves the call to the GM, so the dropdown
arrives pre-set to what the stakes suggest and you change it if the venue argues
otherwise — a back-alley cellar and a noble's private arena can pay the same and
be nothing alike. Changing it picks a different encounter table, so the foe is
redrawn from the one that now applies.

Then the fighters answer, under **Who steps up** — tick whoever accepts and press
**Accept the bout**, or **Decline**. Declining is recorded rather than swallowed:
CS2 notes that fighters who break their word risk losing future offers, so the
refusal stays on screen against the bout.

---

## Putting it on the table

The foe is drawn as a row of the book's own text — two creatures and a
complication, like `2 hero* | 2 lion | 30' deep pits`. Underneath it the window
lists what that row actually names, with a tick against each creature it can
find in your compendium.

**Place** then drops them on the current scene, one per click, walking the list
in order — two Heroes, then two Lions — with the notification naming what the
next click will drop. Escape stops the rest; whatever you already placed stays.

Names are matched the way the book writes them, which is not the way Shadowdark
files them. `Gt. centipede` finds **Centipede, Giant**; `2 hero*` drops the
pg. 39 footnote star and the count; `Wyvern (chained)` looks for **Wyvern** and
keeps *chained* as a note beside it. Anything it can't find stays in the list,
dimmed and marked *not in your compendium*, and Place simply skips it — a row
reading `2d4 rival crawlers | 2 canyon ape` still gets the apes down. Rival
crawlers are a rival adventuring party rather than a monster, so they never
resolve anywhere, by design.

**Choosing a map.** *Arena map…* lets you pick one of the module's eleven
bundled battle maps — Greybanner Arena or Coliseum, an arena of Earth, a choked
courtyard, a dungeon fighting pit, a Fantasy Stadium, a Tournament Ring, each of
the day/night variants by 2-Minute Tabletop (CC BY-NC 4.0; see CREDITS) — and opens
it as a scene, drawn the first time you ask and reused afterwards. Press the same
map again next session and you get the one you dressed, not a second copy. Each
scene is laid out at night on a grid sized to that map's printed squares, and
Place drops foes on whatever you're looking at. Any other scene works exactly as
well.

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

**The arena monsters are on page 39.** Three of the creatures the encounter
tables name — **Rookie**, **Hero** and **Canyon Ape** — are printed in CS2 itself
rather than in the core rules, marked with a `*` in the tables. Import them from
your own book like any other stat block; until you do, the importer's monster
census lists them under their source as gaps, and the bout window marks them
*not in your compendium* and places the rest.

**Rerolling.** *New offer* clears everything and starts again. Changing the
danger keeps the same dice and only redraws the foe, and **Draw** redraws the foe
alone.

**The bout survives the fight.** Close the window, run the combat, reopen it an
hour later and the offer is still there — the stakes, the venue, the drawn foe,
who accepted, and the prize still to roll. The bout is stored in the world, not
in the window, because closing the window to get at the map is part of running a
pit fight, not the end of one. Only **New offer** throws it away.

---

## See also

- [Renown](Renown.md) — where the fame goes
- [Downtime](Downtime.md) — the book files pit fighting under downtime activities
- [Importer Hub](Importer-Hub.md) — importing the fourteen tables
- [Random Encounters](Random-Encounters.md) — the encounter roller, a separate tool
