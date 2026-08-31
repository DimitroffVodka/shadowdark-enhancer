# Table Import & Shapes

[← Wiki home](Home.md)

Published tables are laid out for a printed page, not for a parser. This page
explains how the module turns a messy PDF copy into a correct RollTable, and how
to teach it a table it doesn't know yet.

---

## The problem

Copy a table out of a PDF and you get, depending on the table:

- three columns interleaved into one stream of text
- cells wrapped across several lines
- the die column vertically centred against a multi-line cell
- an all-caps section caption mashed between stacked columns
- a "roll each column and combine" generator that isn't really one table at all

Row-oriented parsing collapses all of that into nonsense. So instead of guessing,
the module carries a **parsing recipe per table**, a *shape*, for the tables it
knows about.

## Shapes

**129 tables** currently carry a recipe. Each recipe names a shape kind:

| Kind | For |
|---|---|
| `section` | An ordinary single-column table under a caption |
| `banded` | A captioned table whose rows are bands (`2-4`, `14+`) printed around a vertically centred die face |
| `gridcol` | One column of a captioned multi-column grid |
| `compound` + `split: "prayer"` | The Western Reaches god prayer generators: roll `3d6`, one die per column, combine |
| `compound` + `split: "grid"` | Mix-and-match generators: Traps, Hazards, Secrets, name generators |
| `lookup` | Wrapped-cell lookups like the Core *Carousing* tables, indexed by cost or die |
| `matrix` | A `dN, dN` cross-reference matrix (Interesting Customer, Personality Trait) |
| `longtable` | Long single-column tables (up to ~100 rows) |
| `suite` | A whole feature unlocked in one press: several captioned tables across a page range, each with its own shape |

### `banded` — when the die face sits in the middle of its own cell

A table cell taller than one line prints its die face *vertically centred*
against the cell, so the extracted text comes out as wrap, wrap, **face**, wrap,
wrap — not face-first. Attaching a face-less line to the nearest die face gets
this wrong the moment two cells wrap back to back. Cursed Scroll 2's *Twist*
table is the reproduction: `(armor, weapon, spell)` prints one line above the
`6-9` face and two lines below the `2-5` face, and it belongs to `2-5`.

The `banded` parser splits the block into one run of lines per face such that
each run is centred on its face — the same rule the typesetter used. It is exact
rather than heuristic, and it reads bands (`2-4`, `14+`) rather than assuming one
row per die value. Reach for it whenever a table's rows are ranges and its cells
wrap.

### `suite` — one Unlock, many tables

A `suite` recipe lists members as `{ name, shape }` and runs each member's shape
over the same pasted text. Members are caption-bound, so they can share a paste
that holds all of them, and a member that finds nothing is reported **by name**
rather than dropped — "13 of 14 imported" has to be visible or the missing one is
discovered mid-session.

A suite also carries `pageModes`, which is what makes it more than a loop. Every
other recipe grabs its pages under one extraction mode, which is fine for one
table on one page. Cursed Scroll 2's pit-fighting suite prints two-column set-up
pages (21, 24) beside single-column encounter grids (22-23), and either mode
alone shreds the other half — so `pageModes` gives each page range its own.

Some recipes also carry a **`reflow`** hint. A "reflowed" paste is one where the
PDF copy came out single-spaced with the column structure gone. The hint tells
the parser where cell boundaries fall: a capitalisation change, a dice
expression, or an explicit pattern like *"the/a/an" starting a new cell*.

A recipe may also pin **`extractCols`**, which decides how **Grab text** pulls
the page out of the PDF before any parsing happens. The default, `auto`, detects
the page's column gutter. But on a page that prints two prose columns *above* a
full-width table (Core *Traps* p114, *Hazards* p115), that gutter belongs to the
prose, and applying it to the table slices the table in half: the first column
arrives as one die-numbered block and the rest as a second, detached block. Pin
`"layout"` there, which pads every cell to its true x-position so all columns
stay on one line. Pin `"1"` for a table that needs each row glued onto a single
line. Pin `"2mid"` for a two-column page whose gutter detection lands in the
wrong place: it skips detection and splits at the page midline instead. No recipe
currently needs it — detection measures where the page's ink actually is, which
reads a ragged column edge correctly — so reach for it only if you meet a page
that still comes out mis-split. Getting this wrong is rarely
subtle. Cells come out shredded into single words, because the fallback splitter
is left guessing at whitespace.

Every Core d20 × 3-column generator page has this shape (*Tavern* p136, *Shop*
p139, *Adventure* p122, *Adventuring Site Name* p123, *NPC Qualities* p125,
*Party Name* p127, *Magic Item Idea* p283), so all seven pin `"layout"` too.

## A caption bound is not optional on a shared page

Most of those generator pages stack a **second** die table below the generator:
`SHOP GENERATOR` over `INTERESTING CUSTOMER`, `NPC QUALITIES` over `OCCUPATION`,
`PARTY NAME` over `SIGNATURE TACTICS`. A grid recipe runs three split strategies
and keeps the best-filled result, and the page-mate's table can win that vote
outright: *Shop Generator* parsed **60/60 cells with zero warnings**, entirely
from the `INTERESTING CUSTOMER` matrix below it.

So on any shared page, set **`caption`** to the table's own all-caps heading. The
parser slices to that block first and votes only within it.

> **A clean score is not evidence you read the right table.** Filled-cell counts
> and warning counts tell you a parse was *self-consistent*, not that it came
> from the table you asked for. Always read the actual rows back, and check the
> last row as well as the first.

Two failure modes only the rows reveal:

- **A page cite one page short** still parses clean, off the wrong table. Three
  of these entries had exactly that (`Adventuring Site Name` cited p122 when the
  table is on p123, `NPC Qualities` p124 → p125, `Party Name` p126 → p127). Each
  returned a confident full-marks parse of its neighbour.
- **A page-bottom pull quote** gets glued onto the final row. Core pages close
  with a designer quote and attribution printed directly under the table with no
  blank line, and neither line carries a die face, so the wrap grouper files both
  onto the last row. The parser now stops at that trailer, but it is the kind of
  damage that shows up *only* in row 20.

## Compound tables and cartesian expansion

A compound generator (`roll 3d6, take one result per column, combine`) isn't a
single rollable table. At commit time the module **cartesian-expands** it into a
flat table where every combination is its own row, so it becomes something you
can actually roll in Foundry.

There is a **Cartesian (expand)** button to flatten a compound generator on
demand. Two different caps apply: **automatic** expansion at commit is capped at
**2,000 rows** (so a huge auto-detected compound can't silently commit as an
unusable table), while an **explicit** Cartesian request via the button allows
up to **25,000 rows**.

## Automatic range repair

Source PDFs contain real typos in their die ranges. When two consecutive rows
**share a start value** and the later one extends further, the module repairs the
overlap and **tells you it did**:

```
Auto-fixed: row 4 range 21-24 → 23-24 (shared start with row 3).
```

(That example is a real typo in the Western Reaches Dwarf Trinket table.)

The extractor itself stays faithful to the page. It does not silently normalise
what it reads. Repairs are surfaced as warnings on the preview so you can check
them against the book.

## Table naming

Tables that are prone to collision get a `Source - Name` prefix when filed into
`sde-tables` (the same convention the name tables use). This is safe because
lookups match on the table's manifest-id flag, not its display name.

## When a table has no recipe

You get generic parsing. For a clean single-column table that is usually fine.
For anything with columns, expect to fix rows in the preview before committing,
or add a recipe.

## Adding a recipe

Recipes live in `scripts/importer/tables/table-shapes.mjs` as entries in
`CONTENT_ENTRIES`. Each entry pairs a content id (`source/slugged-name`) with a
shape descriptor:

```js
_entry("wr/gede-prayers", "WR", "Gede Prayers", PRAYER(6)),

_entry("core/traps", "CORE", "Traps",
  { kind: "compound", split: "grid", cols: 3, size: 12,
    labels: ["Trap", "Trigger", "Damage or Effect"],
    extractCols: "layout", reflow: ["cap", "dice"] }),

// A d20 generator sharing its page with another die table: GEN3 pins
// extractCols "layout" and binds the caption in one place.
_entry("core/shop-generator", "CORE", "Shop Generator",
  GEN3("SHOP GENERATOR", ["Name 1", "Name 2", "Known For"])),
```

Start by pasting the table and seeing what generic parsing does to it, then pick
the kind that matches its printed layout and set `cols`, `size`, and `labels` to
match the page. Test by re-pasting through the real shape path, never through
generic table parsing, which will give you a different (and misleadingly clean)
result.

Before you call a recipe done, confirm the page cite against the book, dump
**every** row instead of the first, and check whether anything else is printed
on that page. A recipe that scores well can still be reading the wrong table.

---

## Troubleshooting

**A table parsed into one long column of mush.**
It has columns and no recipe, or the wrong recipe. Check whether the table is in
`CONTENT_ENTRIES`. If it is, its `cols` count probably doesn't match your paste.

**Every cell is offset by one row.**
Classic vertically-centred die column against multi-line cells. This needs the
`lookup` kind, which indexes rows by their die or cost value instead of by
position.

**A compound generator committed as three separate tables.**
It wasn't recognised as compound. Force the type to `tables` and confirm the
recipe's `split` is set.

**The expanded table is enormous / got truncated.**
Automatic expansion at commit is capped at 2,000 rows. The explicit **Cartesian
(expand)** button allows up to 25,000 and warns instead of truncating when a
generator would exceed that. Anything bigger is better left compound and rolled
column by column.

**I got an "Auto-fixed" warning I don't agree with.**
Check the row against your book. The repair only fires on a genuine overlap
(two rows sharing a start value), but if your book really does print it that way,
edit the range back in the preview before committing.

**A row is flagged for review and I don't know why.**
Hover the review tag. The reason is in the tooltip, and the specific row is
highlighted, not the whole card.

### Ambiguous/unresolved loot rows stay unlinked (A7)

When the Importer Hub's **Table** preview enriches a RollTable with Item links
(the RollTable catalog, Table Hub preview, and paste-preview paths), rows that
resolve as `ambiguous` or `unresolved` are deliberately left without a `@UUID` —
they remain plain text rather than a wrong link. For specialized source-qualified
tables like *Cursed Scroll 3* p68 *Sea Wolf Plunder From Distant Lands* (D4),
linking routes to a dedicated materializer that mints the 20 managed Items in
`sde-items` under `Cursed Scroll 3 / Treasure` with curated icons and links them
while preserving full priced display text on TableResults; coin entries and
unmapped rows stay plain text. See [Loot & Treasure — How loot rows become Items](Loot-and-Treasure.md#how-loot-rows-become-items-precise-resolution), [Sea Wolf Plunder materialization](Loot-and-Treasure.md#sea-wolf-plunder-materialization-d4), and [API `loot.resolve`](../API.md#loot).

### Contextual check enrichment for Arctic Sea encounters (E1)

When importing or enriching the *Cursed Scroll 3* Arctic Sea Encounters table, the table enricher applies contextual check and dice enrichment (A5). Difficulty class expressions (`DC 15 DEX`) are transformed into clickable `[[check 15 dex]]` buttons and bare dice expressions (`2d4`) become inline rolls (`[[/r 2d4]]`), alongside `@UUID` monster links.

The enricher uses a strict selector (`isArcticSeaEncounterTable`):
- Authoritatively matches tables carrying `flags["shadowdark-enhancer"].manifestId === "cs3-arctic-sea-encounters"`.
- Admits tables with the exact name suffix `Arctic Sea Encounters` when the module source flag is absent (legacy or hand-created copies) or canonicalizes to `cs3`.
- Rejects explicit non-CS3 source stamps (such as Core or CS6 lookalikes) and distinct tables like Core `Arctic Encounters`.

All encounter table paths — single table import (`createTable`), Importer Hub multi-table create/replace (`TableImporter.commitTableBundle`), public `game.shadowdarkEnhancer.tables.enrich(uuid, "encounter")`, manual `relinkAll()`, and debounced sweeps scheduled after monster/item import batches — converge on this selector. Whole-suite backup restore (`applyBundle`) preserves existing documents without re-enrichment. The complete 50-row table (covering 1–100) is idempotent on re-run (`updated: 0` without writing embedded documents). Unrelated encounter tables keep their legacy behavior (`convertDice` and `@UUID` links only), leaving their DC expressions as unmodified prose.

---

**Related:** [Importer Hub](Importer-Hub.md) · [Class & Spell Importers](Class-and-Spell-Importers.md) · [Loot & Treasure](Loot-and-Treasure.md)
