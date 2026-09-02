# Table Import & Shapes

[← Wiki home](index.md)

Published tables are designed for a printed page, not a parser. This guide
explains how the module transforms raw PDF text into clean, rollable
Foundry RollTables, and how you can add recipes for new tables.

---

## The problem

Copying a table straight out of a PDF often produces formatting chaos:

- Multi-column tables interleaved into a single continuous stream of text.
- Text cells wrapped across multiple lines.
- Die roll numbers vertically centered beside multi-line cell text.
- All-caps section headings spliced into the middle of table columns.
- Multi-column roll-and-combine generators that are actually several distinct
  tables.

Simple row-by-row parsing cannot handle these variations. Instead of guessing,
the module uses a **parsing recipe per table** (called a *shape*) for all
supported books.

---

## Shapes

**133 tables** currently carry a recipe. Each recipe specifies a shape kind:

| Kind | For |
|---|---|
| `section` | Standard single-column table beneath a section header. |
| `banded` | Captioned table whose rows are ranges (`2-4`, `14+`) centered vertically beside the die face. |
| `gridcol` | A single column extracted from a multi-column grid. |
| `compound` + `split: "prayer"` | Western Reaches deity prayer generators (roll `3d6`, one die per column, combine). |
| `compound` + `split: "grid"` | Mix-and-match generators (Traps, Hazards, Secrets, names). |
| `lookup` | Wrapped-cell lookups like Core *Carousing* tables, indexed by cost or die result. |
| `matrix` | A `dN, dN` cross-reference grid (e.g. Interesting Customer, Personality Trait). |
| `longtable` | Extended single-column tables (up to ~100 rows). |
| `suite` | Multi-table features unlocked in a single action across a page range. |

### `banded` — when the die face sits in the middle of its cell

When a table cell spans several lines, typesetters often place the die roll
vertically centered in the row. Raw text extraction extracts this as
*text wrap*, *text wrap*, **die number**, *text wrap*.

Attaching lines to the nearest number fails when multiple wrapped cells
sit next to each other. The `banded` parser groups lines so each entry is
centered on its die roll, matching how the page was typeset. It also parses
bands (`2-4`, `14+`) accurately.

### `suite` — one unlock, multiple tables

A `suite` recipe lists individual tables as `{ name, shape }` and parses each
from the same shared text paste. Missing entries are reported by name rather
than quietly omitted.

Suites also define `pageModes` to give different page ranges their own
extraction settings. For example, a two-column setup page can be extracted
differently from an adjacent full-width encounter grid.

### Reflow and column hints

Some recipes include extra tuning options:

- **`reflow`**: Used when PDF copy-paste loses all column spacing. Hints tell
  the parser where cell boundaries start (e.g., capital letters, dice
  expressions, or leading articles like *a/an/the*).
- **`extractCols`**: Configures how **Grab text** extracts the page from the PDF.
  The default (`auto`) detects column gutters.
  - Pin `\"layout\"` for pages with two prose columns above a full-width table
    (e.g., Core *Traps* p114, *Hazards* p115) so the table is not split in half.
  - Pin `\"1\"` for tables requiring each row on a single line.
  - Pin `\"2mid\"` if column detection misplaces the gutter, forcing a midline
    split.

All seven Core `d20 × 3-column` generator pages (*Tavern*, *Shop*, *Adventure*,
*Adventuring Site Name*, *NPC Qualities*, *Party Name*, *Magic Item Idea*)
pin `\"layout\"`.

---

## Captions on shared pages

Many generator pages stack a secondary table below the main generator:
`SHOP GENERATOR` over `INTERESTING CUSTOMER`, or `PARTY NAME` over
`SIGNATURE TACTICS`.

Setting **`caption`** to the table's exact heading constrains the parser to that
specific block so it does not mistakenly parse the neighboring table.

> **A clean parse score does not prove you read the right table.** Always review
> the preview rows — especially the first and last row — to confirm the right
> content was captured.

Watch out for two common edge cases:

- **Page citations off by one page:** A neighboring table may parse cleanly
  with zero warnings while belonging to a completely different generator.
- **Bottom pull quotes:** Quotes at the foot of a page can get attached to the
  final table row if they lack a blank line separator.

---

## Compound tables and cartesian expansion

Compound generators (*roll 3d6, take one result per column, combine*) are
not native Foundry roll tables. When committed, the module
**cartesian-expands** them into a single flat table where every combination
is its own distinct rollable row.

For shared grids, a compound recipe can restrict columns with
`columns: [\"Col A\", \"Col B\"]` to keep generators distinct.

You can also click the **Cartesian (expand)** button in the preview:

- **Automatic expansion** on commit is capped at **2,000 rows** to avoid
  creating unwieldy tables accidentally.
- **Explicit expansion** via the button supports up to **25,000 rows**.

---

## Automatic range repair

PDF source text occasionally contains printed errors in die ranges (such as two
consecutive rows sharing a start value). When detected, the parser repairs the
overlap automatically and flags the change in the preview:

```
Auto-fixed: row 4 range 21-24 → 23-24 (shared start with row 3).
```

You can review and adjust any corrected ranges in the preview before saving.

---

## Table naming and folders

Tables prone to name collisions receive a `Source - Name` prefix in `sde-tables`.
Lookups match on internal manifest IDs rather than display names, so you can
rename tables in your world without breaking lookups.

In the Manage tree:
- **Adventure Generator** and **Adventuring Site Name** are grouped under the
  **Adventure Generator** folder.
- **NPC Qualities**, **Party Name**, **Renown**, **Secret**, and **Wealth**
  maintain distinct identities for supporting generator registries.

---

## Supporting tables and manifest stamps

Tables imported into `sde-tables` receive manifest and source stamps in
`flags[\"shadowdark-enhancer\"]`. The supporting-table registry uses these
stamps to identify tables:

- **Renames survive:** Renaming a table in Foundry does not break lookups
  because identification relies on stamped flags rather than display names.
- **Fail-closed resolution:** Missing, unstamped, or duplicate tables report
  clear diagnostics rather than guessing or substituting wrong tables.
- **Core system fallbacks:** Ancestry and Alignment fall back to core system
  UUIDs (`shadowdark.ancestries`, `shadowdark.alignments`), while all other
  tables resolve from `sde-tables`.
- **Derived Rival Classes Table:** Maintained in `sde-tables` and synced from
  class readiness data.

### Source provenance and matrix splits

When matrix tables (like *Signature Tactics*) split into per-column tables:

- Child tables inherit the parent's `source` and base `manifestId` before
  receiving column-specific stamps.
- Singleton and matrix import paths stamp the seeded source (`CORE`, `CS1`–`CS6`,
  `WR`).
- Unknown sources are left empty rather than inferred from folder names,
  preserving the distinction between book content and GM-authored tables.
- Existing world tables are never silently rewritten or reclassified.

---

## Adding a custom recipe

Recipes live in `scripts/importer/tables/table-shapes.mjs` within
`CONTENT_ENTRIES`. Each entry pairs a content identifier (`source/slugged-name`)
with a shape definition:

```js
_entry("wr/gede-prayers", "WR", "Gede Prayers", PRAYER(6)),

_entry("core/traps", "CORE", "Traps",
  { kind: "compound", split: "grid", cols: 3, size: 12,
    labels: ["Trap", "Trigger", "Damage or Effect"],
    extractCols: "layout", reflow: ["cap", "dice"] }),

_entry("core/shop-generator", "CORE", "Shop Generator",
  GEN3("SHOP GENERATOR", ["Name 1", "Name 2", "Known For"])),
```

When building a new recipe:

1. Paste the table text into the importer to see what generic parsing produces.
2. Select the shape kind matching the printed layout and configure `cols`,
   `size`, and `labels`.
3. Test by pasting through the recipe path.
4. Verify all rows against the physical book.

---

## Troubleshooting

**A table parsed into one long column of mush.**  
The table has columns but no recipe (or an incorrect `cols` count). Check
`CONTENT_ENTRIES` in `table-shapes.mjs`.

**Every cell is offset by one row.**  
A multi-line cell had a vertically centered die roll. Use the `lookup` shape
kind, which indexes rows by die or cost values rather than row position.

**A compound generator committed as three separate tables.**  
The table was not recognized as compound. Set the type to `tables` and ensure
the recipe specifies a `split` strategy.

**The expanded table is enormous or was truncated.**  
Automatic commit expansion caps at 2,000 rows. The **Cartesian (expand)** button
permits up to 25,000 rows. For larger sets, consider rolling columns separately.

**An "Auto-fixed" warning appeared.**  
Two consecutive rows shared a start value. Check your book; if the printed
source intended that range, edit the row in the preview before committing.

**A row is flagged for review.**  
Hover over the *review* tag to see the exact reason in the tooltip.

### Unresolved loot rows remain unlinked

When table rows reference items, rows resolving as `ambiguous` or `unresolved`
remain plain text rather than creating broken `@UUID` links.

Specialized treasure tables — *Cursed Scroll 3* Sea Wolf Plunder, *Cursed
Scroll 2* Dead Bandit Loot, and *Cursed Scroll 1* Diabolical Treasure — route
through dedicated materializers in `sde-items` with curated icons and exact
source phrasing. Currency entries and unmapped rows remain clean plain text.
See [Loot & Treasure](Loot-and-Treasure.md).

### Arctic Sea encounter checks and dice

When importing the *Cursed Scroll 3* Arctic Sea Encounters table, DC expressions
(such as `DC 15 DEX`) become interactive `[[check 15 dex]]` buttons and dice
formulas (`2d4`) become clickable inline rolls (`[[/r 2d4]]`), alongside
`@UUID` monster links. Re-importing the table is idempotent and will not
duplicate entries.

---

**Related:** [Importer Hub](Importer-Hub.md) · [Class & Spell Importers](Class-and-Spell-Importers.md) · [Loot & Treasure](Loot-and-Treasure.md)
