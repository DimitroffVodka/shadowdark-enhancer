# Trouble Tracker

[← Wiki home](index.md)

The Western Reaches GM Guide's "Fragile Civilizations" (pp.48–49): while the
party adventures, trouble stirs in real settlements and draws closer week by
week. The tracker keeps that countdown on the world clock and tells you, the
GM, when each trouble moves on.

---

## What it needs

- **The four Trouble tables** from the GM Guide, imported through the
  Importer Hub: *Trouble in the Reaches: Region*, *Trouble in the Reaches:
  Settlement*, *Type of Trouble* and *Trouble Urgency Level*.
- **The Western Reaches key locations** (Hex Maps → import the book's hexes).
  The tracker names a real settlement from them.

Without them, a check says which one to import.

---

## The weekly check

Every time the world clock passes the start of a week, one check runs,
whatever moved the clock: travel, camp, downtime, or you setting the date. A
jump of three weeks runs three checks, each at its own week start.

- A bigger jump checks only its last four weeks, and says so, so setting the
  calendar a year on doesn't stir a dozen troubles at once. **Check for
  trouble** runs more.
- Each week is checked once: setting the clock back and moving it on again
  doesn't check the same weeks twice.
- The checks run only once the tables and key locations below are imported.

- The chance starts at **1-in-6** and grows by one each quiet week: 2-in-6,
  3-in-6, and so on. When trouble stirs, it starts again at 1-in-6.
- Each check is whispered to the GMs, with the roll and next week's chance.
- **Check for trouble**, at the foot of the Journal sidebar (GM only), runs
  the same check by hand, for when you aren't keeping the clock.

---

## When trouble stirs

1. **Where.** The Region table (d20), then the Settlement table (d4: village,
   town, city, city-state). A region with no settlement of that kind rerolls
   the d4, as the book says. The tracker then picks one of the region's
   imported settlements of that kind. Lowland Moor has only a village, so it
   always lands on its one village.
2. **What.** The Type of Trouble table and its detail. A table imported with
   its sub-tables is drawn through them; one imported with the list inline
   ("1d6: 1. … 2. …") rolls the list.
3. **How soon.** The Urgency Level table (2d6): weeks, days, hours away, or
   already happened. The distance is rolled, and so are the days and hours
   before arrival when the next stages begin.

The trouble becomes a page in the **Troubles in the Reaches** journal entry,
which only GMs can see. The page links the settlement's key-location page, and
lists each stage with its date and its symptoms. The tracker writes the text
once, so your notes on the page stay.

---

## The countdown

As the world clock passes each stage's date, the trouble moves from weeks to
days to hours to happened, and the GMs get a whisper with that stage's
symptoms. Several troubles can run at once.

Opened by a GM, each trouble's page shows its stage and two buttons:

| Button | What it does |
|---|---|
| **Mark heard** / **Mark not heard** | Whether the party has heard of it. |
| **Promote to quest** | Makes an Available quest in the [Quest Log](Quest-Log.md), linked back to the trouble, and marks it heard. Once it has one, **Quest Log** opens the log. |
| **Jump to pin** | Pans to the settlement's Hex Tagger pin. |

Completing that quest resolves the trouble and stops its countdown.

Giving rumors ([Rumors](Rumors.md)) hands out unheard troubles first, as the
book's "the next time they learn new rumors" says, and marks them heard.

---

## For macros and modules

`game.shadowdarkEnhancer.troubles`: `check()`, `stir({ region, kind })`,
`list()`, `undiscovered()`, `discover(id)` and `promote(id)`. See
`docs/API.md`.
