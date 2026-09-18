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

## Hex map from image

The short way. Importer Hub → Tools → **Hex map from image**, pick the map
file, and the module does the setup itself:

1. It reads the image in your browser and finds the printed hex grid on its
   own: column and row pitch, where the first cell sits, which columns are
   lowered, and how many columns and rows the map has. Margins and the legend
   are left out; a first row the frame cuts in half still counts.
2. It shows the result over a thumbnail, dots on the cell centres and the four
   corner hexes outlined, with the counts, the lowered parity and the top-left
   cell's number to confirm or correct.
3. It copies the image into the world's `hex-maps` folder, creates a scene
   whose hex grid sits on the print (the image is stretched to Foundry's hex
   proportions, so a print with tall hexes lands on a regular grid), stores
   the anchor and map size, and opens the Hex Tagger on it, ready for
   **Sample scene**.

On the Western Reaches print the grid is found within a pixel of the
hand-calibrated geometry in about five seconds on a laptop. Prints with a
faint or hand-drawn grid get a message instead; those are set up the old way
below.

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

## Classify (stamped maps)

Once a sheet or two is tagged by hand, **Classify** fills in the rest. It only
works well on maps whose terrain icons are stamped, the same pixels in every
cell, like the Western Reaches print; hand-drawn maps get a warning and are
better tagged by hand (they are small).

- Your tagged cells are the examples. Each untagged cell takes the terrain of
  the example it most resembles.
- The terrain's stamp is then subtracted from the cell and whatever ink is left
  decides the overlay: one long stroke reaching two edges is a **river**, a
  chain of short marks is a **path**. Coast is never guessed; tick it by hand.
- Cells the classifier is unsure about, a close call between two terrains or an
  unclear overlay, go to the **Review queue**. Tag those sheets and every answer
  becomes a new example for the next Classify. Keyed hexes are never classified;
  their terrain comes from the book's text.
- **Sensitivity** scales the overlay thresholds: raise it if paths and rivers
  are missed, lower it if plain cells pick up overlays.

Measured in Foundry on the Western Reaches map against a hand-verified table,
with half the map tagged and the other half classified: terrain 96%, rivers
85% precision and 88% recall, paths 77% and 87%; about one cell in nine lands
in the review queue. Choose the crawl entry before classifying: keyed hexes
carry a star or settlement icon that reads as a river, and only the entry
tells the tagger which cells those are.

For your own check, a GM can call
`game.shadowdarkEnhancer.hexMaps.compare(csvText)` after enabling the hidden
client setting `hexMapsDevTools`. It scores the active scene's tags against a
CSV with `hex_id` and `tags` (or `terrain_tags`) columns and returns terrain
accuracy plus river and path precision and recall; players and disabled
developer tools receive no result.

## Import, export and the reference tile

Three more buttons sit in the tagger's header once the scene is sampled.

- **Import** reads a file of tags into the scene: a CSV with `hex_id` and
  `tags` (or `terrain_tags`) columns, semicolon-separated, with an optional
  `source` column (`gm` or `auto`); or a JSON, either one exported here or a
  hexcrawl dataset (its regions, keyed hexes and networks become tags). The
  first tag that is not river, path or coast is the terrain; a row of
  overlays only, such as a hex that is all river, keeps its first tag as the
  terrain. Imported rows replace the cell's tags; other cells are untouched.
  If the JSON carries an anchor and the scene has none, the anchor is taken
  too. A table you built outside Foundry goes in this way and never ships
  with the module.
- **Export** downloads the scene's tags as JSON, the same shape the scene
  flag holds, so a tagging session can be backed up or moved to another
  world and imported there. The dataset itself comes from **Build dataset**.
- **Reference tile** puts this scene's map image on another hex-columns scene
  as one hidden, locked, half-transparent tile, scaled so the print's hex field
  covers that scene's first columns × rows cells (the map size you set). The
  width and height scale separately, so a stretched print lands on a regular
  grid. Pick the scene Shadowdark Extras painted from your dataset and trace
  rivers and roads over it; when Extras exposes its hexcrawl builder, **Send
  to Extras** places the tile on the new scene by itself. Placing it again
  moves the same tile rather than adding another. The tile sits above the
  painted terrain, so it stays visible; if the target lowers the wrong
  columns (odd where the map lowers even, or the reverse) the tagger says so
  and the scene's grid type needs changing.

Delete the reference tile when tracing is done. Hidden tiles are not drawn
for players, but Foundry still sends every client the tile's data, including
the image's URL.

## The dataset

```js
{
  version: 1, name, source,
  grid: { cols, rows, distance: 6, units: "mi", landscape: false, flipX: false, flipY: false },
  terrain: { default: "forest", regions: [ { biome: "mountain", hexes: [1341, ...] } ] },
  hexes:   [ { num: 4541, name, terrain, desc, zone } ],
  networks: { river: [1246, ...], road: [4649, ...] }
}
```

`num` is the published hex number as an integer: the leading digits are the
column, the last two the row, so 1403 is column 14, row 03. Column and row
never appear as fields. The downloaded JSON preserves this column-major
numbering; `grid.landscape: false` is not a transposition instruction. A direct
Extras hand-off is enabled only when the compatible
`game.shadowdarkExtras.hex.buildHexcrawl` contract is present (the current
safe path is the download until that contract lands). The book's **path** tag
becomes Extras' **road** network. Terrain goes out as the book's word
(`salt flat`, `deep tunnels`); Extras keeps that label on the hex record and
chooses the painted biome itself. The summary table's settlement marker has
no field in Extras' contract, so it stays on the crawl entry in the Journals
pack.

## Troubleshooting

- **"Only flat-top column hex grids are supported"** — change the scene's grid
  type to Hexagonal Columns (odd or even) and re-align.
- **"The background image is not same-origin"** — the map must be a file under
  your Foundry data directory, not a link to another site.
- **Numbers are off by one row in every other column** — the anchor was set
  with the wrong **Lowered columns** choice. Clear and set it again.
- **Cells over the legend or margins keep appearing** — set the map size.
- **"No hex grid found on this image"** — the detector needs printed hex
  outlines running across the map; a hand-drawn or very faint grid is set up
  by hand with the tagger instead.
- **"Nothing to import"** — the CSV needs `hex_id` and `tags` (or
  `terrain_tags`) header cells; the JSON must be a tagger export or a dataset.
- **The reference tile's hexes sit half a cell off in every other column** —
  the target scene lowers the other parity of columns; set its grid to
  Hexagonal Columns of the parity the tagger names.
- **The reference tile is missing on the target** — the tagger needs the map
  size set, and the target scene a hexagonal columns grid.
