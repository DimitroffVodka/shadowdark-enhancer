# Drawing a hex map

[← Wiki home](index.md)

The Enhancer draws a hex map itself: every hex wears a picture of its terrain,
rivers, roads and beaches are laid over the ground, and a keyed hex wears its own
art. It draws from the tags you gave the map in the Hex Tagger, so there is no
paint step: retag a hex and the map redraws it. Shadowdark Extras is not needed.

This page follows the route from a tagged print to a drawn map you play on, and
says at each step what changes and what stays. The tagging itself (the Legend,
Classify, the Brush, the review sheet) is described on [Hex Maps](Hex-Maps.md)
and only linked from here.

## The route at a glance

| Step | You do | What it changes |
|---|---|---|
| 1. Tag the print | **Hex map from image**, then the Legend, Classify, the Brush | The print's tags |
| 2. Draw it | **Build drawn map** on the Tagger's **Use this map** card | A new scene; the print is not changed |
| 3. Another look | **New look** on the drawn scene, or **Build drawn map** again | That scene's deal of pictures |
| 4. Fix a hex | Retag on any scene of the map, or pick its tile in Hex Data | The print and every drawn copy redraw |
| 5. Bake or export | **Bake map** or **Export image** in Hex Data | A new baked scene, or one picture file |

## 1. Tag the print

**Where.** Importer Hub, **Tools**, **Hex map from image**. The Hex Tagger opens
on the new scene. For the Western Reaches A0 map, the tagger's **Map** tab has
**Make this map playable**, which numbers the map, copies terrain and region
borders from another scene of the print and pins the keyed hexes.

**What to tag.**

| You give it | Where it is described | What the drawn map does with it |
|---|---|---|
| Terrain per hex | [The legend](Hex-Maps.md#the-legend), [The review sheet](Hex-Maps.md#the-review-sheet), [the brush](Hex-Maps.md#fixing-a-patch-at-a-time-the-brush) | Which set of pictures the hex is dealt from |
| River, path, coast per hex | [Terrain and features](Hex-Maps.md#terrain-and-features) | River and road pieces joined across hexes; beaches along the water |
| Regions | [Which region is a hex in?](Hex-Maps.md#which-region-is-a-hex-in) | Nothing drawn; the regions keep working for encounters and the Regions picture |
| Keyed hexes | [A whole book's key locations](Hex-Maps.md#a-whole-books-key-locations), then **Keyed hexes from the book** on the **Map** tab | Each wears its own art (see [Keyed hexes](#keyed-hexes)) |

Any numbering draws. The drawn map reads the tags with the same numbering the
tagger wrote them with, so a map numbered from 0001, such as the Cursed Scroll
maps, draws every tagged hex. Nothing is converted, so there is no grid check to
fail.

**How to tell it worked.** The header under the scene's name counts numbered
cells, tagged hexes and hexes to go. The **Data** tab's **Use this map** card
appears once at least one hex is tagged.

## 2. Build drawn map

**Where.** The Tagger's **Data** tab, card **Use this map**, **Build drawn map**.

**What it makes.** A new scene named after the print, such as *Western Reaches
(drawn 1)*. It is a copy of the print's scene: the same grid cell for cell, the
same picture under the art, the same pins and notes, and the print's fog setting.
It has none of the print's tokens or tiles. Each hex is dealt one picture from
its terrain's set.

**What it leaves alone.** The print. Its tags, pins, tokens and picture stay as
they are, and you can keep tagging or playing on it.

**What the drawn copy shares with the print.** A drawn copy and its print keep
three things the same:

- **The tags.** Retag a hex on the print or on any drawn copy, with the Tagger,
  the Brush or Hex Data, and every scene of the map redraws it.
- **The region fixes.** A region you correct in the Tagger or in Hex Data holds
  on every scene of the map.
- **The keyed art.** The **Tile art** you load in the Tagger shows on every
  scene of the map.

**What each scene keeps for itself.** Fog, what each party has discovered, tokens,
and the tiles you chose in Hex Data (see [step 4](#4-fix-a-hex)).

**Clear** (the Tagger's **Danger zone**) clears the print and every drawn
copy together, because they share the tags; the dialog names every scene it will
clear.

## 3. New look

**Where.** Open the Tagger on a drawn scene: the **Use this map** card has **New
look** under **Build drawn map**.

**What it changes.** Every hex is dealt another picture of the same terrain.
Tiles you chose yourself in Hex Data stay. The tags and everything else on the
scene are unchanged.

**Several looks at once.** Press **Build drawn map** again, on the print or on a
drawn copy, and you get another scene, *(drawn 2)*, with a deal of its own. All
of them share the one set of tags, so they never drift apart.

The deal is fixed by the hex number and the scene's own seed, so a drawn map looks
the same every time it is opened, on every computer.

## 4. Fix a hex

**Retag.** Change a hex's terrain or its river, path or coast on any scene of the
map, and every scene of the map redraws that hex and its neighbours.

**Pick its picture.** Double-click a hex on a drawn map to open Hex Data. The
**Tile** card has two buttons:

- **Another tile** deals the hex a different picture from its terrain's set.
- **Choose tile** lists the terrain's pictures, the current one marked. Pick one
  and the map shows it at once.

The choice is saved on this scene only, when you make it, not with **Save cell**.
It lasts while the hex keeps its terrain: retag the hex and the choice lapses with
the old terrain. A hex that wears its own art (a keyed location or a settlement)
shows no buttons.

## Keyed hexes

A keyed hex wears its own picture: the one the **Tile art** file names for that
hex, else, on the Western Reaches print, the hand-picked picture the Enhancer
ships for it. The Western Reaches needs no file: the **Tile art** button reads
**Tile art (270)** from the start, and a file you load replaces that set whole.

**Tile art** is on the Tagger's **Data** tab, card **Other tools**. It takes a
JSON manifest, one entry per hex, either an object keyed by hex number:

```json
{ "643": { "base_hex": "Hexes/Specials/your-tile.webp", "overlay_asset": "" } }
```

or a list of rows headed `Hex #`, `Base Hex` and `Overlay Asset` (`hex_id` or
`num` for the number, and `art` or `icon` for the files, are read too). A path is
read relative to Shadowdark Extras' `assets/` folder, or used as it is when it
starts with `modules/`; a picture the Enhancer ships a copy of is drawn from that
copy, so it shows without Extras. The drawn map does not draw `overlay_asset`.
**Forget the one I loaded** clears the file.

The fog hides keyed art the way it hides a location. A player sees the picture
once the hex's location is found, and ordinary ground before that: a hex tagged
`keyed_location` with no terrain of its own takes the ground most of its
neighbours have. The GM always sees the picture, at half strength until it is
found. Settlements show their settlement picture to everyone, found or not.

## 5. Bake map and Export image

Both are in Hex Data on a drawn map, at the foot of the **Tile** card.

**Bake map** puts the drawn map, as it is now, into a new scene that plays
without being drawn live. Use it for a very large map, or to keep the art showing
if the Enhancer is turned off.

- It takes a minute or more and uses this computer's graphics, so press it in the
  browser tab you play from, with a scene open on screen.
- The new scene is named for the drawn map and the minute, such as *Western
  Reaches (drawn 1) (baked 2026-11-20 19:42)*, and you are asked whether to make
  it the active scene. The drawn map and every scene you already have stay as
  they are.
- Keyed pictures are not baked into the ground. They stay separate pictures, so
  the fog still hides each until its hex is found.
- The baked scene shares the print's tags like a drawn copy, so travel, encounters
  and Hex Data read the same terrain. Its picture does not change when you retag:
  bake again to see changes.
- A bake is a copy, so it starts without the play on the scene it stands in for.
  If the drawn map has recorded hexes or tokens on it, the dialog says how many
  first. Bake before you start playing, or keep playing on the drawn map.
- If a hex picture will not load, nothing is made and the message names the
  files. If a bake stops part way, the message names the folder holding the
  pieces it already wrote, which you can delete.

**Export image** saves the whole drawn map, keyed pictures included, as one
picture file, which works anywhere with no module. A large map is shrunk to at
most 8192 pixels on its longest side. The file is WebP, or PNG on a browser that
cannot write WebP.

## A map Extras already painted

A scene Shadowdark Extras painted with its own tiles keeps them and keeps working
while Extras is installed. To have the Enhancer draw it instead:

1. Double-click any hex to open Hex Data.
2. The **Hex art** card says Extras painted the map. Press **Draw with the
   Enhancer**.

**What it does.** When the map has no tag anchor yet, it numbers the map from
Extras' layout. It brings Extras' terrains into the tags; tags already there
win. Then it switches the drawing on, which hides Extras' painted tiles.

**What it leaves alone.** Extras' tiles are hidden on each computer, never
changed or deleted, and nothing of Extras' is written. **Show Extras' tiles** in
the same card switches back.

Once the Enhancer draws the map, it has the **Tile** card, **Bake map** and
**Export image** like any drawn map. A bake Extras made earlier still draws as
before.

**When it refuses.** "The Enhancer can't number this map from Shadowdark Extras'
layout" means the scene's grid is not one the Enhancer can number from Extras'
data (a layout with a frame row above the first hex, or a grid other than
hexagonal columns with odd columns lowered). Set an anchor in the Tagger first,
then press it again.

## When it does not work

- **A hex draws no picture.** Its terrain has no picture set, or the hex has only
  features (coast or path alone are not ground). A hex with no ground of its own
  takes its neighbours' ground. Give it a terrain in the Tagger.
- **The Tagger lists tags outside the map.** The store holds numbers the map's
  edges no longer cover, usually after the map size changed. The note names them;
  **Remove them** clears them.
- **Import refuses some rows.** Rows whose hex numbers are not on the map are
  refused and named, with the map's first and last hex.
- **A drawn copy shows a hex differently from the print.** Fog and discovery are
  per scene, so a player may see ground where a keyed picture waits, and a tile you
  chose in Hex Data shows only on the scene you chose it on.
- **Bake needs a scene open.** "Baking needs a scene open on this computer's
  screen": open any scene and press **Bake map** again.

## Related pages

- [Hex Maps](Hex-Maps.md): the tagger, classify, regions, keyed locations and the
  hex map toolbar
- [Importer Hub](Importer-Hub.md): getting a book's map and its key into the world
- [Crawl Strip and Crawl Bar](Crawl-Strip-and-Crawl-Bar.md): travel on the map
