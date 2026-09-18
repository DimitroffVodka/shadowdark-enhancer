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

## The three steps

Most tables want the map that came with the book as their scene, the book's
keyed locations on it, and the terrain of every hex for encounters. That is
three steps, the third optional:

1. **The map.** Importer Hub → Tools → **Hex map from image**: the grid is
   found on the print and a scene is made with a working hex grid (next
   section).
2. **The keyed locations.** Importer Hub → paste (or **Grab from PDF**) the
   book's hex key and its keyed-location table, **Create hex pages**, then
   **Pin on [scene]**: one map note per keyed hex on the scene you are
   viewing, each opening its journal page (see *Keyed locations on the map*).
3. **The terrain**, optional: the tagger's **Legend** names the terrain of
   every hex from one card per glyph (see *The legend*), for encounters and
   for a painted Shadowdark Extras crawl if you want one.

## Hex map from image

The short way. Importer Hub → Tools → **Hex map from image**, pick the map
file, and the module does the setup itself:

1. It reads the image in your browser and finds the printed hex grid on its
   own: column and row pitch, where the first cell sits, which columns are
   lowered, and how many columns and rows the map has. Margins and the legend
   are left out; a first row the frame cuts in half still counts.
2. It shows the result in a resizable window: the print on the left with
   dots on the cell centres (click it for the full image in a new browser
   tab), and on the right the four corners cut from the print at full
   resolution with the detected hex outlined in blue and its neighbours'
   centres dotted, then the counts, the lowered parity and the top-left
   cell's number to confirm or correct. The module checks those corners
   itself and says so: when all four sit on a printed hex there is nothing
   to do but **Create scene**, and when one does not it names the corner so
   you can compare the crop and fix a count that is off by one.
3. It copies the image into the world's `hex-maps` folder, creates a scene
   whose hex grid sits on the print (the image is stretched to Foundry's hex
   proportions, so a print with tall hexes lands on a regular grid), stores
   the anchor and map size, then opens the Hex Tagger on it, samples the
   cells and shows the **legend** (next section). Name the pictures and the
   map is tagged.

On the Western Reaches print the grid is found within a pixel of the
hand-calibrated geometry in about five seconds on a laptop. Its lowered
columns end one row short of the others (the frame cuts the first row of the
raised columns in half, and the last half cells of the lowered ones hold the
printed column labels); the detector reports that and the tagger skips those
cells. Prints with a faint or hand-drawn grid get a message instead; those
are set up the old way below.

## Keyed locations on the map

Once the hex key is filed as pages (Importer Hub, **Create hex pages**), the
keyed locations go on the map as Foundry notes: **Pin on [scene]** in the
hub right after filing, or **Pin keyed hexes** in the tagger's header with
the crawl chosen. Each note sits on its printed hex, is labelled with the
page name, uses a house, city or castle icon for a village, town, city or
city-state from the keyed table and a book for other locations, and opens
the hex's page on click. Foundry notes can only point at journals in the
world, so the crawl's journal entry is copied from the Journals pack into
your world the first time, ids kept, its cross-links pointing at the copy;
re-filing the crawl and pinning again updates that copy and moves the
existing notes rather than adding more. Keyed hexes the print does not have
are listed in the message and skipped. The scene must be numbered: one made
by Hex map from image is, and any other hex scene is once you have sampled
it in the tagger and set the anchor.

## The legend

The tagger's **Legend** button (the image flow presses it for you) reads
every cell once and groups the cells by their glyph, without knowing what any
glyph means. One card per group follows, biggest groups first: four typical
members pictured and a terrain select. Name the pictures you recognise and
leave the rest on
**(skip)**: the star and castle icons of keyed hexes, margins, and the odd
mixed group. The same glyph often gets two or three cards (a river through
it, a slightly different print position); name each. A river, path or keyed
marker on one picture does not change the name: name the glyph the pictures
share. Tick a card's river, path or coast box only when every picture shows
it; the box then counts as your word for that card's core cells, and the
classifier finds rivers and paths cell by cell everywhere else. **Apply
legend** then

- tags the twelve cells nearest the middle of each named group by hand, as
  if you had tagged them on a sheet, and
- runs **Classify** from those: every other cell takes the terrain of the
  example it most resembles, gets its river or path from the ink left after
  the terrain's stamp, and lands in the Review queue when unsure.

When it is done the tagger says so: the map is tagged, the dataset is ready,
and the cells the classifier was unsure about are listed below for as much
checking as you care to do. Review is optional; **Send to Extras** works at
any point. The rarely used buttons (re-sample, import, export, the reference
tile, Clear) sit under **More**.

Choose the crawl entry first if you have one: keyed hexes then stay out of
the legend and out of the classifier, and take their terrain from the book.
Opening the legend again pre-fills each card with what most of its members
are tagged, so a wrong name is one change. Measured on the Western Reaches
print against the author's table: 32 cards, and naming each by its true
terrain puts 96% of the unkeyed cells in the right group before the
classifier runs, and the whole legend-then-classify pass lands 92% of them
on the table's terrain (97% once ocean, arctic sea and lake count as one:
they share the wave glyph on that print, and only the region tells them
apart, so name the wave cards by the water that covers most of the map and
fix the rest by region). The rest is the Review queue's job. Hand-drawn maps
group poorly (no two cells share a glyph) and are better tagged by sheet.

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
4. **Legend** (stamped maps) or **tag sheets** (hand-drawn ones). The legend
   is the section above: name one picture per glyph and everything is tagged
   from that. A sheet is 40 cells: pick the terrain, tick river, path or
   coast where the art shows one, and **Apply sheet**. The next sheet loads.
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
  grid: { cols, rows, distance: 6, units: "mi", landscape: false, flipX: false, flipY: false,
          origin: 0,        // only for a map that numbers its first column and row 0
          rowsLowered: 74 },// only when the lowered columns end one row short
  terrain: { default: "forest", regions: [ { biome: "mountain", hexes: [1341, ...] } ] },
  hexes:   [ { num: 4541, name, terrain, desc, zone } ],
  networks: { river: [1246, ...], road: [4649, ...] }
}
```

`num` is the published hex number as an integer: the leading digits are the
column, the last two the row, so 1403 is column 14, row 03. Column and row
never appear as fields. Numbering starts at 1 unless the map's own first
column and row are 0, in which case the dataset says so with `grid.origin: 0`
(the Western Reaches has a hex 0000) and Extras places every number as
printed. `grid.rowsLowered` is sent only when the lowered columns end one row
short of the others, so no phantom cells are painted. The downloaded JSON
preserves this column-major numbering; `grid.landscape: false` is not a
transposition instruction. A direct Extras hand-off needs Shadowdark Extras
with `game.shadowdarkExtras.hex.buildHexcrawl` (6.15 or later, with the
origin option for maps numbered from 0); without it the dataset downloads as
JSON. The book's **path** tag
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
