# Hex Maps

[← Wiki home](index.md)

Turn a published hex map you own into data for Shadowdark Extras' hexcrawl
tools, without the module shipping any of the map. Three pieces, each useful on
its own:

1. **Hex key pages** — the [Importer Hub](Importer-Hub.md) files a pasted hex
   key as one journal page per hex, and the keyed summary table (number,
   region, terrain, name) alongside it.
2. **The Hex Tagger** — a contact sheet over your map scene where you tag each
   hex's terrain and its river, path or coast overlays.
3. **The dataset** — one JSON file (or a direct hand-off to Extras) with the
   keyed hexes, terrain regions and river/road networks, hex numbers only.

Everything is built from your own book text and your own map image in your
browser. Nothing is uploaded, and nothing from a book ships with the module.

## The Hex Tagger

Open it from the Importer Hub's Tools row (**Hex tagger**) or with
`game.shadowdarkEnhancer.hexMaps.openTagger()`. It works on the **active
scene**, which must:

- use a **hexagonal columns** grid (flat-top hexes; pointy-top row grids are
  not supported yet),
- have the map as its **background image**, stored in your Foundry data
  directory (a remote URL cannot be read pixel by pixel),
- be **aligned**: use Foundry's grid configuration tool on the scene so the
  grid sits on the printed hexes. Some prints are stretched — the Western
  Reaches hexes are 5.7% taller than regular — so set the background's
  **scale Y** separately from scale X until the grid fits top to bottom.

Then:

1. **Sample scene.** The tagger reads every cell whose centre lies on the
   image. Nothing is stored yet.
2. **Anchor.** The first sheet shows the top-left cells with a number box each.
   Read the printed hex number off any thumbnail, type it there and click
   **Set**. Every other cell is numbered from that one cell, so the scene's
   grid parity never has to match the map's own column shift. If the map
   lowers its even columns instead of its odd ones, change **Lowered columns**
   before setting the anchor.
3. **Map size.** Type the map's columns and rows (for example 64 × 75) and
   **Apply**, so cells over the margins and the legend are skipped.
4. **Tag sheets.** Each sheet is 40 cells. Pick the terrain, tick river, path
   or coast where the art shows one, and **Apply sheet**. The next sheet loads.
   **Untagged cells** serves cells at random; **Keyed hexes first** serves the
   hexes named in the chosen crawl entry, which doubles as an alignment check
   (they should show a keyed marker); **Review queue** is for the classifier's
   uncertain cells (a later phase).
5. **Download dataset** or **Send to Extras.** Choose the crawl entry filed by
   the importer to include the keyed hexes and their descriptions; without one
   the dataset carries only the terrain and networks you tagged.

Tags live on the scene under the module's flags and survive reloads;
**Clear** removes them and the anchor. Re-sampling never touches tags.

## The dataset

```js
{
  version: 1, name, source,
  grid: { cols, rows, distance: 6, units: "mi", landscape: false, flipX: false, flipY: false, numbering: "column-major" },
  terrain: { default: "forest", regions: [ { biome: "mountain", hexes: [1341, ...] } ] },
  hexes:   [ { num: 4541, name, terrain, desc, zone, icon: "", feature } ],
  networks: { river: [1246, ...], road: [4649, ...] }
}
```

`num` is the published hex number as an integer: the leading digits are the
column, the last two the row, so 1403 is column 14, row 03. Column and row
never appear as fields; Extras reads the digits the other way round and
transposes, and passing a pair between the modules lands on transposed cells.
The book's **path** tag becomes Extras' **road** network.

## Troubleshooting

- **"Only flat-top column hex grids are supported"** — change the scene's grid
  type to Hexagonal Columns (odd or even) and re-align.
- **"The background image is not same-origin"** — the map must be a file under
  your Foundry data directory, not a link to another site.
- **Numbers are off by one row in every other column** — the anchor was set
  with the wrong **Lowered columns** choice. Clear and set it again.
- **Cells over the legend or margins keep appearing** — set the map size.
