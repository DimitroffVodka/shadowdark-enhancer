# Rules Data

[← Wiki home](index.md)

The Western Reaches books keep some rules in tables you look things up in
rather than roll on: what a hex costs to enter, how many hexes a day a party
covers, how far it can see, the climate of each region in each season, and
how big a carousing event or warband a settlement can offer. **Rules data** is
where the module keeps those tables, so overland travel, carousing and hex
visibility all read the same numbers.

Open it from **Configure Settings → Shadowdark Enhancer → Rules data**
(GM only).

**Nothing from the books ships with the module.** Every table starts empty. You
fill them from your own PDFs with one button, or type them in yourself.

---

## Import from GM Guide

Link your books first, in the [Importer Hub](Importer-Hub.md) under
**Tools → Source PDFs**. Then press **Import from GM Guide**. It reads:

| Table | Book | Page |
|---|---|---|
| Hexes per day, Terrain types | Game Master's Guide to the Western Reaches | 40 |
| Hex visibility, Terrain | Game Master's Guide to the Western Reaches | 41 |
| Climate | Game Master's Guide to the Western Reaches | 43 |
| Carousing limits | Game Master's Guide to the Western Reaches | 30 |
| Recruiting limits | Player's Guide to the Western Reaches | 249 |

The tables are cut out of those pages the same way the importer reads every
other Western Reaches table (see [Table Import & Shapes](Table-Import-and-Shapes.md#rules-data-tables)).

- **Anything you already filled in is shown before it is replaced.** If the
  import would change a value you have, a preview lists each one, what it is
  now and what the book says, and you choose **Import and replace** or
  **Cancel**. Empty values are filled without asking.
- **A table it can't find is named.** Without a linked Player's Guide, for
  example, it fills everything else and tells you the recruiting limits were
  not imported.
- **Nothing is kept until you press Save.** The import fills the window;
  **Cancel** throws it away with any other change.

Region names are stored the way the rest of the module spells them: the
climate table's "Bastion Mtns" becomes **Bastion Mountains**, and
"Gloaming, The" becomes **The Gloaming**.

## Editing by hand

Every value is an ordinary field, so a world without the book, or a homebrew
setting, fills the tables in directly.

- **Terrain**: one row per terrain the [Hex Tagger](Hex-Maps.md) knows. Pick a
  type, then give a hex cost, and a cost **with boat** where a boat changes it.
  A terrain with a type and no cost of its own costs what its type does in
  **Terrain types**. Impassable terrain can't be entered, except by boat when
  it has a boat cost.
- **Elevation**: which terrains count as slight or high elevation for hex
  visibility. **Mountain counts as high** until you change it, and nothing
  counts as slight: the Western Reaches has no hills.
- **Climate**: one row per region, with a climate and a harsh marker for each
  season: **In storms** (harsh only in stormy weather) or **Always**. Type a
  name in the empty row at the bottom to add a region; clear a region's name to
  remove its row.
- **Carousing limits** and **Recruiting limits**: leave a settlement empty for
  no limit.

## What reads it

- **Stormy weather** makes normal terrain cost what difficult terrain costs,
  and in a harsh climate makes all terrain impassable for the day.
- Macros and other modules read everything through
  `game.shadowdarkEnhancer.rules`; see the
  [API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md#rules--western-reaches-rules-data).
- The data is the `rulesData` world setting. See the
  [Settings Reference](Settings-Reference.md).
