# Making a colour map with Extras

[← Wiki home](index.md)

A **colour map** is what this module calls a **painted map**: your hexcrawl
map redrawn by Shadowdark Extras in its coloured hex tiles from the terrain you
tagged, with rivers, roads and beaches, and the book's keyed hexes on it as map
notes. This page follows the whole route, from the book's map on a scene to a
painted map you play on, and says at each step what it changes and what it
leaves alone. After this paragraph it says *painted map* and uses the button
names.

The tagging itself (the Legend, Classify, the Brush, the review sheet) is
described on [Hex Maps](Hex-Maps.md) and is only linked from here.

## What you get and what you need

The same tags give you two things, and you can use both. **Send to Extras**
puts each hex's details on the map you tagged, so the print itself becomes an
Extras hexcrawl and nothing is painted over it. **Build painted map** makes a
new scene, painted in Extras' tiles. On either scene the travel, fog, Hex Data
and encounter tools are this module's own.

| What | Needed for | Notes |
|---|---|---|
| Foundry VTT and the Shadowdark system | Everything | Versions are on [Installation & Setup](Installation-and-Setup.md). |
| Shadowdark Enhancer | Everything on this page | Extras is not required for the Enhancer itself (see below). |
| A print whose first hex (**0000**, or **0101** on a map numbered from 1) is the scene's top-left cell, on a grid of hexagonal columns with odd columns shifted down | **Send to Extras**, and the copy of the tags onto a painted scene (step 8) | **Hex map from image** makes a scene like this when the print allows it. A map numbered another way, such as the Cursed Scroll maps that start at 0001, can be tagged and played but not sent: see [When it does not work](#when-it-does-not-work). |
| Numbers Extras can express: columns and rows both counted from 0, or both from 1 | **Build painted map**, **Update painted map** | A map numbered from 0001 (columns from 0, rows from 1) fits neither. The tagger's contract check refuses it when any hex sits in its last row. |
| Shadowdark Extras with its hex hand-off API (`game.shadowdarkExtras.hex`), which first shipped in the 6.16.0 tag, and its **Hex Painter** feature on | **Send to Extras**, **Build painted map**, **Update painted map** | Extras leaves the builder calls out when Hex Painter is off. Without them the Data tab offers **Download dataset** instead of the three buttons. |
| Extras commit 19c00ddf (in the 6.16.0 tag) | The journal map notes on a painted map's keyed hexes | An untagged Extras build that has the hex API but not this commit refuses the whole build when a hex carries a journal page. |
| Extras' **Drawing Tools** feature on | The rivers and roads of a painted map to be drawn | Extras draws them as permanent map drawings, and its Developer API page says they need Drawing Tools. |
| Your own PDFs | The keyed hexes' names, descriptions and pages | Imported through the [Importer Hub](Importer-Hub.md). The module ships no book text. |
| The map image | The print | The module ships none. |
| A tile-art file, if you want one | Hand-picked tiles on a painted map | A JSON file you make yourself. See [step 3](#3-load-your-tile-art-optional). |

**What works without Extras.** Everything up to the choice at step 4: reading
the map, the Legend, Classify, the Brush, review, the region borders, the
Terrain, Regions and Encounter zones pictures, the pins, Export and Import of
tags, and on the tagged print Hex Data, fog, travel and encounters. The Data
tab then shows **Download dataset**, which saves the dataset as one JSON file
(see [The dataset](Hex-Maps.md#the-dataset)). The Enhancer finds Extras by its
`hex` namespace and never requires it.

## The whole flow at a glance

| Step | You do | The Enhancer does | Extras does |
|---|---|---|---|
| 1. The map on a scene, tagged | **Hex map from image** (or **Make this map playable** for the Western Reaches A0 map); name the Legend's cards, Classify, Brush; pick the hex key | Finds the grid, makes the scene, stores the anchor and map size, reads the region borders, files the keyed hexes | Nothing |
| 2. Review | Sheet tab, **Confirm these N** | Updates the tags | Nothing |
| 3. Tile art | Data tab, **Tile art**, **Load** | Keeps the manifest on the print scene | Nothing yet |
| 4. Choose | The **Use this map** card | Builds and checks the dataset | Nothing |
| 5. Send to Extras | **Send to Extras** | Checks the numbering, calls Extras, merges the features | Adopts the print, writes a record per hex |
| 6. Build painted map | **Build painted map** | Copies missing crawl journal entries into the world, calls Extras | Makes a new scene: tiles, beaches, icons, rivers and roads, records, journal notes |
| 7. Journal map notes | Nothing | Puts each keyed hex's journal page in the dataset | Places a map note for each page the world holds |
| 8. First open | Open the painted scene | Reads Extras' records once, copies the print's tags and borders | Nothing |
| 9. Fog and Hex Data | The **Hex map** toolbar group, double-click a hex | Runs its own fog and Hex Data on the scene | Its fog, hover card and editor stand down |
| 10. Play | **Travel** on the clock bar | Prices, encounters and fog read the tags and records | The tiles are the picture |
| 11. Retag | Fix the print's tags, **Update painted map** | Lists the hexes whose terrain differs, asks, calls Extras | Replaces those hexes' tiles, redoes the beaches, rewrites the terrain word |

Where the data lives and moves:

```
 your PDFs                    your map image
     |                              |
 Key locations              Hex map from image
     |                              |
     v                              v
 Journals pack:             PRINT SCENE (the tagged map)
 one entry per region,        flag hexTags    anchor, map size, terrain + river/path/coast per hex
 a page per keyed hex,        flag hexRegions region border scan
 summary rows on the entry    flag hexArt     tile-art manifest you loaded
     |                              |
     +--------------+---------------+
                    |
                    v
          DATASET (built in memory each time)
          grid, terrain regions, hexes[], networks
                    |
     +--------------+---------------+--------------------+
     |              |               |                    |
 Download       Send to Extras   Build painted map   Update painted map
 dataset            |               |                    |
     |              v               v                    v
  JSON file    Extras layout    NEW PAINTED SCENE     tiles + terrain word
               flag + hex       tiles, beaches,       of the changed hexes
               records on       icons, rivers/roads,  on the painted scene
               the print        hex records,          only
               (nothing         journal map notes
               painted)              |
                                     | first open by the GM:
                                     | Enhancer adopts the records once, then
                                     | copies hexTags + hexRegions from the print
                                     v
                          fog, Hex Data, travel, encounters
                          (the Enhancer's own records)
```

## Step by step

### 1. Put the map on a scene and tag it

**Where.** Importer Hub, **Tools**, **Hex map from image**. The Hex Tagger
opens on the new scene and shows the Legend. For the Western Reaches A0 map,
the tagger's **Map** tab has **Make this map playable**, which numbers the
map, copies terrain and borders from another scene of the print, pins the keyed
hexes and, when every hex has terrain and Extras is on, does step 5 for you.

**What the scene must be for Extras.** Extras numbers a map from the scene's
top-left cell, and its grid must be hexagonal columns with odd columns shifted
down. **Hex map from image** keeps the print's first hex on that cell when the
print is numbered 0000 or 0101 and can be taken as it stands; set **Top-left
hex is number** to match the print. A print numbered otherwise, or one that
lowers the other columns, still gets a working scene for tagging, pins, fog and
travel, but **Send to Extras** refuses it.

**What to tag.** See [Hex Maps](Hex-Maps.md):

| You give it | Where it is described | What it becomes in Extras |
|---|---|---|
| Terrain per hex | [The legend](Hex-Maps.md#the-legend), [The review sheet](Hex-Maps.md#the-review-sheet), [the brush](Hex-Maps.md#fixing-a-patch-at-a-time-the-brush) | The hex record's terrain word, and which tile is painted |
| River, path, coast per hex | [Terrain and features](Hex-Maps.md#terrain-and-features) | Entries in the record's feature list. River and path also become lines on a painted map (path becomes Extras' road) |
| Regions | [Which region is a hex in?](Hex-Maps.md#which-region-is-a-hex-in), read automatically by **Hex map from image** | The record's zone name and zone colour |
| Keyed hexes: names, descriptions, settlements | [A whole book's key locations](Hex-Maps.md#a-whole-books-key-locations), then **Keyed hexes from the book** on the **Map** tab | The record's name and a hidden GM description note. A village, town, city or city state becomes a settlement feature. On a painted map, also a journal map note |

**Choose the hex key.** Once a crawl is filed, the **Map** tab has **Keyed
hexes from the book**, listing the crawls plus **Every crawl in the book** when
there are several. One filed crawl is chosen for you; several default to
**Every crawl in the book**. With **(none)**, only what you tagged, the region
zones and any tile art go to Extras: no names, descriptions, settlements or
journal notes.

**How to tell it worked.** The header under the scene's name counts numbered
cells, tagged hexes and hexes to go. The Data tab's **Use this map** card
appears once at least one hex is tagged.

### 2. Review the tags (optional)

**Where.** The **Sheet** tab: **Show** set to **Most likely wrong**, change the
hexes that are wrong, then **Confirm these N** (or **Show me others** for a
different set). The **Hex map** toolbar's **Review the hexes most likely
wrong** opens the same sheet.

**What it changes.** The print's tags and its review queue, nothing else. A hex
you leave alone is accepted as it reads.

**What it leaves alone.** Extras, and every painted scene: nothing is sent.
Review is optional; **Send to Extras** works with the tags as they are.

### 3. Load your tile art (optional)

The Western Reaches print needs no file: from 0.18.1 the Enhancer carries that map's hand-picked tiles, and the button reads **Tile art (270)** from the start. A file you load replaces them whole.

Only a painted map uses this. Skip it and Extras chooses every tile from the
hex's terrain (see *How a tile is chosen* below).

**Where.** The **Data** tab, card **Other tools**, **Tile art**. A dialog,
"Tile art for this map", takes one file.

**The file.** A JSON manifest, one entry per hex. Either an object keyed by hex
number:

```json
{ "643": { "base_hex": "Hexes/Specials/your-tile.webp", "overlay_asset": "" } }
```

or a list of rows with the headings `Hex #`, `Base Hex` and `Overlay Asset`
(`hex_id` or `num` for the number, and `art` or `icon` for the files, are
accepted too). `base_hex` is the tile; `overlay_asset` is an optional icon
drawn on top. A path is read relative to Shadowdark Extras' `assets/` folder,
or used as it is when it starts with `modules/`. A row with no tile, or whose
id is not a three or four digit hex number (an underworld key such as M104), is
skipped. A row whose number is a hex number but lies off this map is kept, and
then every send fails the contract check until you take it out of the file and
load it again.

**What happens.** **Load** keeps the normalised manifest on the print scene;
the button then reads **Tile art (N)**. The notification says how many rows
were kept and how many have an icon. **Forget the one I loaded** clears it.

**What Extras does with it.** At build time a hex's tile is the one the
manifest names. It wins over everything else, it must be a tile in Extras' own
catalogue (anything else makes Extras refuse the whole build), and the same
tile may be used on as many hexes as you like. The icon is placed centred on
the hex as its own tile. Extras never keeps `art` or `icon` on a hex record.

**What it leaves alone.** Loading art changes no scene. **Send to Extras** never
sends it, because it paints nothing. **Build painted map** uses it for every
hex it names; **Update painted map** uses it only for the hexes it repaints.

**How a tile is chosen when no art is assigned.** Extras works from the hex's
terrain word:

1. Several words are first mapped to one of Extras' own terrains: arctic sea,
   lake, ocean and river to water; canyon to hills; coast, grassland and path
   to plains; jungle to forest; deep tunnels, lava and mountain to mountains;
   salt flat to desert. Forest, plains, hills, desert, swamp, mountains and
   water stand as they are.
2. A word with no match, such as one you typed yourself, is painted with the
   dataset's default terrain: the word used on the most hexes. An untagged hex
   takes that terrain too.
3. A few words draw from a pool of their own and fall back to an older pool if
   Extras' tile catalogue predates it: arctic sea, lake and river each have a
   water pool; canyon, jungle, lava and salt flat have their own; deep tunnels
   uses the rocky mountain tiles; volcano uses the Specials tiles named for
   it. The jungle pool leaves out Extras' weak dark recolour, the desert pool
   leaves out salt-flat art, and the mountain pool leaves out bridge and spike
   tiles. Hand-picked art can still name any of them.
4. A keyed hex with a village, town, city or city state is painted with that
   settlement's Specials tile instead of its terrain tile.
5. Among the tiles that fit, the one used depends only on the hex's place on
   the scene, so building twice gives the same picture and nothing is random.

### 4. Choose what to send, and where

The **Use this map** card is on the **Data** tab. It shows only when the map is
numbered and at least one hex is tagged. A few messages, and older text in
[Hex Maps](Hex-Maps.md), say these buttons are "under More"; in this version
they are on the **Data** tab, and **Other tools** on the same tab holds the
rarely used ones.

| You want | Press | What you get |
|---|---|---|
| The tagged print to play as an Extras hexcrawl, its art and pins untouched | **Send to Extras** | Hex records on the print: terrain, regions, names, descriptions, features |
| A new painted scene in Extras' tiles | **Build painted map** | A new scene painted from the tags, with its own rivers, roads and notes |
| Corrections from retagging onto a painted scene you already have | **Update painted map** | Only the hexes whose terrain changed are repainted |
| The data without Extras, or to move it | **Download dataset** | A JSON file, `<name>-hexcrawl.json` |

The first button reads **Send to Extras** when Extras' hex API is present and
**Download dataset** when it is not. **Build painted map** and **Update painted
map** are shown only when the API is present. **Download dataset** is not
offered beside **Send to Extras**; with Extras present a dataset downloads on
its own only when Extras refuses a build (step 6).

To use a downloaded file in Extras, a macro passes it to
`game.shadowdarkExtras.hex.buildHexcrawl`, as Extras' Developer API page
describes. The file also goes back into this module's **Import** button (the
**Back up and share** card), which turns its regions, keyed hexes and networks
into tags.

The Importer Hub's manual flow has its own **Send to Extras** (or **Download
dataset**) under "Hex pages filed", after you press **Create hex pages**. It
builds a painted scene from the filed keyed hexes alone, with none of your tags,
so it is not the route on this page.

### 5. Send to Extras: details onto the print

**Where.** **Data** tab, **Use this map**, **Send to Extras**.

**Checks, in this order, before anything is written.**

1. The map must have its anchor ("Set the anchor number first.").
2. The dataset must pass the module's own contract check ("Hex dataset failed
   its contract check: ...").
3. The map's first hex must be the scene's top-left cell, with the columns
   Extras lowers (the "numbers a map from the scene's top-left cell" message
   below).
4. Extras must be able to adopt a map ("This version of Shadowdark Extras can't
   put hex details on a map you already have. ...").

**What happens.**

1. Extras adopts the print: it stores its hexcrawl layout on the scene and
   nothing else. No tiles, records, notes or background change. Adopting the
   same layout again changes nothing.
2. The tagger reads what Extras already holds for the map, so it can merge
   instead of replace.
3. Every hex in the dataset gets a record: name, terrain, description, zone and
   zone colour, and its feature list.

**What it changes.** Extras' layout flag on the print, and Extras' hex records
for the print. This module also marks on the print that the settlements have
been sent.

**What it leaves alone.**

- The print's art, pins, notes, tokens, walls, lights and fog, and your tags.
- Extras-side record fields the send does not carry (exploration, cleared,
  claimed, travel, roll tables), and every note except the one description
  note it owns.
- A hex you never tagged keeps the terrain Extras holds for it; so does a hex
  whose tags you cleared completely.
- Features: a river, path or coast is replaced to match the tags now, so a tag
  you took off goes. A settlement is added the first time only; after that
  Extras' copy stays exactly as it is, so what the players discovered survives.
  Any other feature, such as a dungeon you added in Extras, is kept.

One thing it does overwrite: a tagged hex whose tags name no ground (coast
alone) clears the terrain Extras holds for it, whether an earlier send left it
or you typed it there. Give the hex its ground in the tagger.

**How to tell it worked.** The first time: "This map is now a Shadowdark Extras
hexcrawl: {hexes} hexes sent with their terrain, regions and descriptions.
Nothing was painted over the print." After that: "Updated {hexes} hexes on
this map in Shadowdark Extras."

**Messages you may see.**

| Message | Meaning |
|---|---|
| Set the anchor number first. | The map has no numbering yet. Settings tab, **Anchor hex**, or set the map up with **Hex map from image**. |
| Hex dataset failed its contract check: ... | A number in the dataset does not fit the grid it declares; the first problem is named. |
| Shadowdark Extras numbers a map from the scene's top-left cell, and this map's hex 0000 isn't there, so the details would land on the wrong hexes. Use Build painted map under More instead. | The print's first hex is not the scene's top-left cell, or it lowers the other columns. "0000" reads "0101" on a map numbered from 1. Nothing was written. The message still says "under More"; the button is on the **Data** tab, in **Use this map**. |
| This version of Shadowdark Extras can't put hex details on a map you already have. Update it, or use Build painted map under More. | Extras has no `adoptHexcrawl` or `upsertHexRecords`. |
| Shadowdark Extras wouldn't take this map: {error} | Extras refused to adopt it. See the table under [When it does not work](#when-it-does-not-work). |
| The hex details are on the map, but no river, path, coast or settlement features went with them: ... Send again once the records are in. | The send could not read Extras' records, and replacing the feature lists blind would erase discoveries. The details went; the features did not. |

### 6. Build painted map: a new painted scene

**Where.** **Data** tab, **Use this map**, **Build painted map**.

**What happens.**

1. If a hex's journal page is in a crawl entry the world does not have, the
   entry is copied from the Journals pack into the world with its ids kept (see
   step 7).
2. Extras creates a new scene, named after the crawl (the book's name when
   several are chosen) or, with no hex key chosen, after the print scene plus
   "(painted)". Every hex of the map gets a tile (settlements get their
   Specials tile). Extras places the icons from your tile art, writes the
   records, places the journal notes, adds beaches along the water and ice on
   arctic sea, and draws the rivers and roads.
3. Your screen switches to the new scene. It is not made the active scene for
   players.

**What it changes.** A new scene with its tiles, notes, drawings and records;
the world's journal entries only when one was missing.

**What it leaves alone.** The print and everything on it, and every other
scene, including an earlier painted scene.

**How to tell it worked.** "Sent "{name}" to Shadowdark Extras ({hexes} keyed
hexes, {cells} tagged cells{art})." and Extras' own "Hexcrawl built: ..." line.

**If it fails.** "Shadowdark Extras could not build this hex dataset;
downloading the JSON instead." The Extras error is in the browser console
(F12). Extras says a failure may leave a partly built new scene; delete it.

### 7. Journal map notes on the keyed hexes

These come with **Build painted map**. **Send to Extras** places none: the
print keeps the Enhancer's own pins (the tagger's **Pin keyed hexes**).

- Each keyed hex's dataset entry carries the journal entry and page it opens.
  The Enhancer copies the crawl's entry into the world first, when the world
  has no entry with that id. An entry the world already has is left alone, so
  a build does not rewrite your edits to its pages.
- Extras places a map note on each hex whose page the world holds, labelled
  with the hex number and name, with a book icon. A page the world does not
  hold gets no note and no error.
- The notes belong to the painted scene. The print's pins are not copied.

### 8. The painted scene takes the print's tags and numbering

A painted scene holds Extras' records but none of the tags, so without this
step its Terrain, Regions and Zones pictures, hex numbers and encounter columns
would be empty. The Enhancer fills them in itself.

**When it happens.** On the active GM's client, whenever the scene is seen: as
the world loads, when the scene is created, when it is opened, and when its
tags change. Normally that is straight after the build, because Extras shows
the new scene to you. The first look that finds Extras' records for the scene
adopts them (the Enhancer reads them once into its own records), and the copy
follows.

**What it copies.** The print's tags, with its anchor and map size, and its
region borders (the borders only when the painted scene has none).

**When it deliberately does not.**

- The painted scene already has tags of its own.
- No print fits, or two do. The print is found by its map size, its top-row and
  lowered-column settings and its grid type, and the painted scene must not be
  mirrored or transposed. With two matching prints it will not choose.
- The print's first hex is not the scene's top-left cell with Extras' lowered
  columns. A print numbered from anywhere else would carry Extras' numbers to
  the wrong hexes.
- The scene is not one Extras built with a published layout (a scene made by
  hand or by an older macro).
- Adoption was skipped. A warning names why, for example two stores claiming
  the scene.

It is a copy taken once. Retagging the print afterwards does not change the
painted scene's copy, and **Update painted map** does not either; build the
painted map again if you want the pictures to follow.

The print's first row has to agree with Extras' layout too. Both leave the
value out when it is the map's origin row, so a layout that names no first row
matches a print whose stored first row is that origin row: a full top row on a
map numbered from 0000, a frame top row on one numbered from 0101. A print
whose first row differs from the layout's is not a match.

**Reading the map on a painted map.** A painted map is tiles with no picture
under it, so **Read the map** has nothing to read there and says so. The
terrain comes from the print: tag the print, then build the painted map again,
or keep exactly one tagged print of that size in the world so this step can
find it.

**How to tell it worked.** The **Hex map** toolbar group gains the terrain
picture (and the regions and zones pictures when the print has a region scan),
the brush, the review button and the tagger button beside the fog buttons, and
the hexes have their printed numbers.

### 9. Fog and Hex Data on the painted map

- **Fog.** The Enhancer's fog runs on every adopted hex scene unless the GM has
  switched it off there, and Extras' fog stands down (Extras does this itself,
  with nothing for you to switch). A new painted scene starts unexplored: none
  of the print's fog or travel is copied.
- **The toolbar.** Until step 8's copy has happened, the **Hex map** group on a
  painted scene shows only **See the fog as the players do**, **Hide the fog to
  review the map (your screen only)**, **Reset the fog: hide hexes again** and
  **Hide the hex hover card**.
- **Hex Data.** Double-click a hex (GM) to open **Hex Data**. Its terrain edit
  changes the Enhancer's tags on that scene, which is what travel prices and
  encounters read. It does not repaint a tile: retag on the print and use
  **Update painted map** for that.
- **Coordinates.** Extras' coordinate labels stand down where your **Show hex
  coordinates** setting is on for a scene the Enhancer has numbered. See
  [Settings Reference](Settings-Reference.md#hex-coordinates-per-user).

### 10. Play on it

Put the party on the map with the **Travel** button on the clock bar (the other
pages call it Start travel; see [Clock and Calendar](Clock-and-Calendar.md) and
[Party](Party.md)). Fog, Hex Data, travel prices and encounter checks read the
scene's tags and records, as on any adopted hex scene; see
[Native coordinates, Hex Data and fog](Hex-Maps.md#native-coordinates-hex-data-and-fog)
and [Random Encounters](Random-Encounters.md).

To put the publisher's own print under the table you can play on the print,
which Extras has adopted, or lay the print over the painted scene with
**Reference tile** and **Use the print as the map, not as a tracing aid** (see
[Playing on the print itself](Hex-Maps.md#playing-on-the-print-itself)).
Placing the tile again moves the same tile; hiding it brings the painted map
back.

### 11. Update painted map: after retagging

**Where.** **Data** tab, **Use this map**, **Update painted map**.

**What happens.**

1. The tagger builds the dataset from the print's current tags.
2. It lists the painted scenes it can update: built by **Build painted map**,
   the same size and numbering, and not the print. With one it uses it; with
   several it asks which.
3. It reads that scene's records and lists every hex whose terrain now
   differs. A dialog shows up to 15 as "{num}: {was} to {terrain}" with "And
   {n} more.", and asks **Repaint**.
4. On yes it repaints those hexes first, then writes their terrain word.

**What it changes.** For each listed hex: its painted tile (a tile you placed
by hand on that hex is replaced; that is the point), the beaches and ice around
it, and the terrain word Extras holds.

**What it leaves alone.** Hexes that still agree, names, descriptions, zones
and features, tokens, pins, notes, fog, feature icons, rivers and roads, and
the print. Only terrain is carried: a river, path or coast you changed does not
reach the painted scene.

**How to tell it worked.** For example "Updated 12 hexes, repainted 12." If
nothing differs: "{scene} already shows these terrains. Nothing to repaint."

## Doing it again safely

| Action | Overwritten | Kept | Asks first |
|---|---|---|---|
| **Send to Extras** again | For every tagged or keyed hex: name, terrain, description note, zone and zone colour (the dataset's text replaces an edit made in Extras), and its river, path and coast features. A tagged hex that names no ground loses Extras' terrain word. | Tiles, art, pins, notes, tokens, walls, lights, fog; hexes you never tagged; settlements once sent; other features; other Extras fields and notes | Nothing |
| **Build painted map** again | Nothing: it makes another scene, and two scenes may share a name | The earlier painted scene with everything on it; the print; world journals the world already has | Nothing |
| **Update painted map** | Tiles of the listed hexes (hand-placed ones included), the beaches around them, those hexes' terrain word | Everything else on the painted scene, as step 11 lists | Lists the hexes and asks **Repaint**; asks which scene when several match |
| Retagging the print | The tags you change. **Classify** re-tags only hexes you have not tagged yourself; **Import** replaces the tags of the cells in the file | Extras' records and every painted scene: nothing flows until you send or update | Nothing, except **Clear** ("Remove every tag and the anchor ... The map image and grid are untouched.": **Clear tags** or **Keep them**) |
| Loading or forgetting tile art | The manifest kept on the print | Every scene | Nothing |
| Opening a painted scene again | Nothing: the copy of the print's tags is made once, and only while the painted scene has none | Its tags, edits made there included | Nothing |
| Importer Hub, **Key locations** again | The pages in the Journals pack: each existing page's name and text are written again from your PDF, so edits to those pages go. Pages are matched by hex number; nothing is duplicated. | Pages for hexes not in the new read; the world copy until you pin | Nothing. The import wizard does not rewrite pages already filed |
| **Pin keyed hexes** again | The world copy of the crawl's journal: matching pages take the Journals pack's name and text again (your edits to them go). Existing notes are moved, not duplicated | Pages that exist only in the world copy | Nothing |

## When it does not work

Extras prefixes its own errors with `SDX | Hexcrawl:`; the table leaves that
off. Problems that are not specific to this route are on
[Troubleshooting](Troubleshooting.md).

| Symptom | Cause | Fix |
|---|---|---|
| The Data tab offers **Download dataset**, with no **Send to Extras**, **Build painted map** or **Update painted map** | The Enhancer found no `game.shadowdarkExtras.hex.buildHexcrawl`: Extras is absent, is older than the 6.16.0 tag, or has **Hex Painter** off | Install or update Extras, turn Hex Painter on, reopen the tagger |
| No **Use this map** card on the Data tab | No hex is tagged yet, or the map has no anchor | Tag some hexes; set the anchor on the Settings tab |
| Hex dataset failed its contract check: "{n} hexes outside the {cols}×{rows} grid (origin 0): ..." | The map's numbers start from 0001 (columns from 0, rows from 1, as on the Cursed Scroll maps), which Extras' two conventions (0000 or 0101) cannot express; or a number in the dataset lies off the map, most often a tile-art row | For a 0001 map nothing in the window fixes it, and renumbering would make the numbers disagree with the book: tag and play on the print, which Extras cannot take. For an art row, take it out of the file and **Load** it again |
| Hex dataset failed its contract check: "grid.firstRow must be origin or origin + 1" | A limit at this version: a map numbered from 0101 whose top row is full hexes stores its first row as 0, and the dataset passes that on as Extras' absolute first row | No fix in the window. A map numbered from 0000 does not hit this message |
| **Read the map** on a painted map says "A painted map has no image to read." | A painted map is tiles; the picture is the print's | Read the map on the print. If the painted map shows no terrain or numbers, no tags were copied: see [step 8](#8-the-painted-scene-takes-the-prints-tags-and-numbering) for the conditions, keep exactly one tagged print of that size in the world, and build again |
| "Shadowdark Extras numbers a map from the scene's top-left cell ..." | The print's first hex is not on the scene's top-left cell, or the print lowers the other columns | Make the scene again with **Hex map from image** and **Top-left hex is number**, or use **Build painted map**, which does not need the print on Extras' cell (step 8's copy then will not happen) |
| "This version of Shadowdark Extras can't put hex details on a map you already have." | Extras has no `adoptHexcrawl` or `upsertHexRecords` | Update Extras |
| "Shadowdark Extras wouldn't take this map: scene already has a different hexcrawl layout" | The print was adopted before with another map size, row setting or numbering, and Extras will not change a stored layout | Put the map size and anchor back as they were when you first sent, or use **Build painted map** |
| "Shadowdark Extras wouldn't take this map: hex {num} falls outside the scene; the first published hex must be the scene's top-left cell" | A published hex's centre is off the scene | Check **Map size** and **Anchor hex**; the print must fill the scene from its top-left cell |
| "Shadowdark Extras wouldn't take this map: scene grid must be hexagonal columns with odd columns shifted down (HEXODDQ)" | The scene's grid is another hex type | Set the scene's grid to hexagonal columns with odd columns shifted down and align the map again |
| "Shadowdark Extras refused the hex details: unsupported hex field {key}; identify cells by num only" | A record carried a field Extras does not take on an existing scene | The module sends only name, terrain, desc, zone, zoneColor and features, so this means a macro sent more |
| "Shadowdark Extras refused the hex details: scene has no published layout; ..." | The scene was not built or adopted through Extras' published API | Send to the print, or build again |
| "Shadowdark Extras refused the hex details: unknown art {path} on hex {num}; use a tile from getColoredTiles()" (during **Update painted map**) | The manifest names a tile Extras' catalogue does not have. Nothing was repainted | Correct the path in the manifest (relative to Extras' `assets/`) and **Load** it again |
| "Shadowdark Extras could not build this hex dataset; downloading the JSON instead." and a JSON file | Extras threw during **Build painted map**. The reason is in the console, for example `unknown art ...` (a tile-art path not in Extras' catalogue) or `unsupported hex field journal` (an Extras older than commit 19c00ddf) | Fix the path or update Extras, then build again. Delete any half-built scene |
| "No painted Extras map of this size to update. Make one first with Build painted map under More." | No scene has Extras' hex scene flag and published layout with this print's columns, rows and numbering: not built yet, built by an older macro, or the print's size changed | Use **Build painted map** |
| "Could not read the hex records on {scene}, so nothing was changed." | Extras returned no hex records for that scene | Build the painted map again |
| A hex you cleared in the tagger is not in the repaint list | Extras refuses a repaint with no terrain ("hex {num} needs a terrain to repaint"), so the tagger leaves such a hex out | Give the hex a terrain, or accept its old tile |
| "Shadowdark Extras is not available, or is too old to update hex details." | The Extras on this world has no `repaintHexTiles` (or no `upsertHexRecords`) | Update Extras |
| The painted scene's Terrain, Regions and Zones pictures are empty and the hexes have no numbers | The copy in step 8 did not happen | Fix the cause in step 8's list (for example two prints of the same size), then reopen the scene |
| No journal notes on the painted scene | No hex key was chosen at build time, the pages were not in the world, or Extras is older than commit 19c00ddf | Choose **Keyed hexes from the book**, build again |
| Rivers and roads are missing on the painted scene | Extras' Drawing Tools feature is off, or no river or path was tagged | Turn Drawing Tools on; tag the features and build again |
| "Nothing usable in {file}: no rows with a hex number and a tile." | The manifest has no row with a hex number and a tile | Use one of the shapes in step 3 |

## Under the hood (for developers)

### The contract

Extras is detected by `game.shadowdarkExtras.hex`. `extrasHexApi()` in
`scripts/importer/hex/hex-handoff.mjs` returns it only when `buildHexcrawl` is a
function. The raw `module.api.buildHexcrawl` (the legacy dataset layout) is
never used. Each further call is feature-detected with `typeof` where it is
used.

| Extras call | Made by | Arguments | Returns, or throws |
|---|---|---|---|
| `hex.buildHexcrawl(dataset, { sceneName? })` | `handoffDataset` | The dataset. Only `sceneName`; never `overwrite`, so a build always makes a new scene | `{ sceneId, sceneName, terrainTiles, featureTiles, records, journalNotes? }`. Throws on validation: caught, a `buildFailed` notification, the JSON downloaded |
| `hex.adoptHexcrawl(sceneId, { grid })` | `handoffToPrint` | `grid` is the dataset's grid | `{ sceneId, adopted }`, with `adopted` false for a no-op. Throws on a different stored layout, a hex off the scene or a non-HEXODDQ grid: returned as `reason: "extras-error"` with the message |
| `hex.getHexRecords(sceneId)` | `extrasHexRecords` | The scene id | Records by published number; `null` without a layout, `{}` with none. Absent in an older Extras: its private store is read instead |
| `hex.upsertHexRecords(sceneId, records)` | `importDatasetRecords` | `[{ num, ...fields }]` | `{ sceneId, records }`. Throws `unsupported hex field` for any field outside the accepted list, taking the whole batch |
| `hex.repaintHexTiles(sceneId, [{ num, terrain, art? }])` | `importDatasetRecords`, `_onUpdatePainted` | `terrain` is required | `{ sceneId, repainted, removed }`. Throws for a missing terrain or an unknown art |
| `hex.setFogEnabled(sceneId, on)`, `hex.isFogEnabled(sceneId)` | `makePlayable` (A0 map only) | | Optional: used only when both exist |
| `hex.getZoneColors()` | `tag-overlay.mjs` | | A copy of Extras' zone swatches; a built-in copy is used without it |

Extras' private store is the `hexData` flag on the journal `__sdx_hex_data__`,
keyed by scene id and then `"i_j"`. `extras-records.mjs` and `hex-adoption.mjs`
read it; nothing here writes it.

### Which dataset fields are accepted where

Extras' validator (`validateRecords` in `scripts/hex/HexcrawlBuilderSD.mjs`) is
fail-closed: an unlisted key throws `unsupported hex field {key}; identify
cells by num only` for the whole batch.

| Field | At build | At record update | What the Enhancer sends on update |
|---|---|---|---|
| `num` | yes | yes | always |
| `name`, `terrain`, `desc`, `zone`, `zoneColor` | yes | yes (`RECORD_FIELDS`) | yes (`UPSERT_FIELDS`); `zoneColor` only when it matches `#rrggbb` |
| `features` | yes | yes | only from **Send to Extras**, already merged with Extras' list |
| `notes`, `travel`, `revealCells`, `rollTable`, `exploration`, `cleared`, `claimed`, ... | yes | yes | never |
| `art`, `icon`, `special` | yes (`BUILD_ONLY_FIELDS`) | **no** | never; `art` goes to `repaintHexTiles` instead |
| `journal` `{ entryId, pageId }` | yes (`JOURNAL_FIELD`) | **no** | never |

**Update painted map** sends `{ num, terrain }` per hex, after `repaintHexTiles`.

### The grid and the origin

`buildHexDataset` takes `cols`, `rows`, `firstRow` and `rowsLowered` from the
tagger's bounds. `grid.origin` is 0 when any hex sits in column 0 or row 0,
else 1. Extras refuses a grid key outside `GRID_FIELDS`, and a `firstRow` other
than `origin` or `origin + 1`. The tagger stores its first-row value as 0 or 1
counted from the map's first number, while Extras' is absolute. That is the
cause of the limit in the troubleshooting table. Step 8's search for the print
compares the two the way the dataset sends them: a first row equal to the origin
is left out on both sides.

### Order of operations

- **Send to Extras** (`handoffToPrint`): adopt, read Extras' features, merge,
  `upsertHexRecords` with `features`, then mark `extrasSettlementsSent` on the
  print, only once a write carrying settlements has succeeded.
- **Update painted map** (`_onUpdatePainted`): repaint first, then records.
  Extras refuses a whole batch for one unknown art id; records written ahead of
  that would name the new terrain over the old tiles, and a retry would find
  nothing to do. `importDatasetRecords` has the opposite default (words first)
  and is what `hexMaps.importDetails` uses.
- **Build painted map** (`handoffDataset`): `deployReferencedCrawls`, then
  `buildHexcrawl`; on a throw, the download.

### What this module relies on in Extras

1. The hex API: the builder entry point (shadowdark-extras#141, as cited in
   `hex-handoff.mjs`), `adoptHexcrawl` (#147, as cited in `geometry.mjs`) and
   the repaint, which shipped in commit 2866dc1c (#153), and `getHexRecords`
   (#157, commit 1725bfdb).
2. Commit 19c00ddf: the `journal` field with its map notes, and the canyon,
   jungle, lava and salt flat tile pools.
3. #205, defer to the Enhancer (merged as d96a64ad): with both active, Extras'
   fog, hover card and double-click editor, and its map coordinates while
   **Show hex coordinates** is on, stand down on scenes the Enhancer owns
   (`owns("hex.fog", scene)`, `owns("hex.tooltip", scene)`).

All of these are in the 6.16.0 tag.

### Where to find it

| Concern | File and function |
|---|---|
| The calls above, dataset to records, merge | `scripts/importer/hex/hex-handoff.mjs`: `extrasHexApi`, `datasetFromEntries`, `importDatasetRecords`, `handoffToPrint`, `handoffDataset`, `paintedScenesFor`, `terrainCorrections` |
| The Extras read side | `scripts/hex-map/extras-records.mjs`: `extrasRecordsByOffset` |
| The buttons | `scripts/hex-map/hex-tagger-app.mjs`: `_handoffDataset`, `_onBuildDataset`, `_onBuildPainted`, `_onUpdatePainted`, `_onArtManifest` |
| Dataset and validator | `scripts/importer/hex/hex-dataset.mjs`: `buildHexDataset`, `validateHexDataset`, `assignmentsFromManifest`, `mergeFeatures` |
| Adoption and the copy | `scripts/hex-map/hex-adoption.mjs`: `adoptHexScene`, `printFor`, `seedFromPrint` |
| Numbering check | `scripts/hex-map/geometry.mjs`: `extrasNumbersAlike` |
| Journal deploy | `scripts/hex-map/hex-pins.mjs`: `deployCrawlJournal` |
| Extras' builder | `scripts/hex/HexcrawlBuilderSD.mjs` in Extras: `installHexcrawlApi`, `buildPublishedHexcrawl`, `adoptHexcrawl`, `upsertHexRecords`, `getHexRecords`, `repaintHexTiles`, `BIOME_TILES`, `TERRAIN_BIOMES`, `TERRAIN_COLORED_RULES` |

The scripting side is in the
[API for developers](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md)
under `hexMaps`: `buildDataset`, `handoff`, `importDetails`, `adopt`,
`isAdopted`, `numberAt`.

## Related pages

**Related:** [Hex Maps](Hex-Maps.md) · [Importer Hub](Importer-Hub.md) ·
[Settings Reference](Settings-Reference.md) ·
[Installation & Setup](Installation-and-Setup.md) ·
[Random Encounters](Random-Encounters.md) · [Party](Party.md) ·
[Clock and Calendar](Clock-and-Calendar.md) · [Troubleshooting](Troubleshooting.md)
