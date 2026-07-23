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
the module carries a **parsing recipe per table** — a *shape* — for the tables it
knows about.

## Shapes

**125 tables** currently carry a recipe. Each recipe names a shape kind:

| Kind | For |
|---|---|
| `section` | An ordinary single-column table under a caption |
| `gridcol` | One column of a captioned multi-column grid |
| `compound` + `split: "prayer"` | The Western Reaches god prayer generators — roll `3d6`, one die per column, combine |
| `compound` + `split: "grid"` | Mix-and-match generators: Traps, Hazards, Secrets, name generators |
| `lookup` | Wrapped-cell lookups like the Core *Carousing* tables, indexed by cost or die |
| `matrix` | A `dN, dN` cross-reference matrix (Interesting Customer, Personality Trait) |
| `longtable` | Long single-column tables (up to ~100 rows) |

Some recipes also carry a **`reflow`** hint. A "reflowed" paste is one where the
PDF copy came out single-spaced with the column structure gone; the hint tells
the parser where cell boundaries fall — a capitalisation change, a dice
expression, or an explicit pattern like *"the/a/an" starting a new cell*.

## Compound tables and cartesian expansion

A compound generator (`roll 3d6, take one result per column, combine`) isn't a
single rollable table. At commit time the module **cartesian-expands** it into a
flat table where every combination is its own row — so it becomes something you
can actually roll in Foundry.

There is a **Cartesian (expand)** button to flatten a compound generator on
demand. Two different caps apply: **automatic** expansion at commit is capped at
**2,000 rows** (so a huge auto-detected compound can't silently commit as an
unusable table), while an **explicit** Cartesian request via the button allows
up to **25,000 rows** — a deliberate request gets more headroom.

## Automatic range repair

Source PDFs contain real typos in their die ranges. When two consecutive rows
**share a start value** and the later one extends further, the module repairs the
overlap and **tells you it did**:

```
Auto-fixed: row 4 range 21-24 → 23-24 (shared start with row 3).
```

(That example is a real typo in the Western Reaches Dwarf Trinket table.)

The extractor itself stays faithful to the page — it does not silently normalise
what it reads. Repairs are surfaced as warnings on the preview so you can check
them against the book.

## Table naming

Tables that are prone to collision get a `Source - Name` prefix when filed into
`sde-tables` (the same convention the name tables use). This is safe because
lookups match on the table's manifest-id flag, not its display name.

## When a table has no recipe

You get generic parsing. For a clean single-column table that is usually fine.
For anything with columns, expect to fix rows in the preview before committing —
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
    reflow: ["cap", "dice"] }),
```

The workflow: paste the table, see what generic parsing does to it, then pick the
kind that matches its printed layout and set `cols`, `size`, and `labels` to
match the page. Test by re-pasting through the real shape path — not through
generic table parsing, which will give you a different (and misleadingly clean)
result.

---

## Troubleshooting

**A table parsed into one long column of mush.**
It has columns and no recipe, or the wrong recipe. Check whether the table is in
`CONTENT_ENTRIES`; if it is, its `cols` count probably doesn't match your paste.

**Every cell is offset by one row.**
Classic vertically-centred die column against multi-line cells — this needs the
`lookup` kind, which indexes rows by their die or cost value instead of by
position.

**A compound generator committed as three separate tables.**
It wasn't recognised as compound. Force the type to `tables` and confirm the
recipe's `split` is set.

**The expanded table is enormous / got truncated.**
Automatic expansion at commit is capped at 2,000 rows; the explicit **Cartesian
(expand)** button allows up to 25,000 and warns (rather than truncating) when a
generator would exceed that. Anything bigger is better left compound and rolled
column by column.

**I got an "Auto-fixed" warning I don't agree with.**
Check the row against your book. The repair only fires on a genuine overlap
(two rows sharing a start value), but if your book really does print it that way,
edit the range back in the preview before committing.

**A row is flagged for review and I don't know why.**
Hover the review tag — the reason is in the tooltip, and the specific row is
highlighted rather than the whole card.

---

**Related:** [Importer Hub](Importer-Hub.md) · [Class & Spell Importers](Class-and-Spell-Importers.md)
