# Hex Maps

[← Wiki home](index.md)

Turn a published hex map you own into data for Shadowdark Extras' hexcrawl
tools, without the module shipping any of the map. Three pieces, each useful on
its own:

1. **Hex key pages** — the [Importer Hub](Importer-Hub.md) files a pasted hex
   key as one journal page per hex, and the keyed summary table (number,
   region, terrain, name) alongside it. For a book it has a page map for, it
   reads the whole key — every region's full write-ups — in one pass.
2. **The Hex Tagger** — a contact sheet over your map scene where you tag each
   hex's terrain and its river, path or coast features.
3. **The dataset** — one JSON file (or a direct hand-off to Extras) with the
   keyed hexes, terrain regions and river/road networks, hex numbers only.

Everything is built from your own book text and your own map image in your
browser. Nothing is uploaded, and nothing from a book ships with the module.

## Terrain and features

Every hex has one **terrain** and any number of **features**, and the two are
never mixed up. The word *river* is both, which is why this matters:

| | What it means | Examples |
|---|---|---|
| **Terrain** | What the hex **is**. One word. | forest, mountain, ocean, **river**: a *river tile*, where the whole hex is water |
| **Features** | What **runs through or sits in** a land hex. A list. | **river**: a *river feature*, a river line through a forest hex; **path**; **coast**; a settlement |

- **A river tile is water.** It makes the land hexes beside it coastal, rolls
  on a region's River column, and counts as river terrain for travel.
- **A river feature is not water.** It behaves exactly like a path: it never
  makes a hex wet, never makes a neighbour coastal and never chooses an
  encounter column.
- **Coast is a feature**, worked out from touching water tiles (sea, ocean,
  lake, a river tile), never from a river feature. It is the one feature an
  encounter check listens to: in a region whose table prints a Coast column, a
  coastal hex rolls on it.
- **Only terrain chooses an encounter column**, apart from that coast rule.

So a forest with a river through it is terrain *forest* with a *river*
feature, and a hex that is all river is terrain *river* with no river
feature. Shadowdark Extras gets them the same way: the terrain as the hex's
terrain, and river, path and coast as entries in its feature list, which its
tooltip shows as River, Path and Coast pills.

## The three steps

Most tables want the map that came with the book as their scene, the book's
keyed locations on it, and the terrain of every hex for encounters. That is
three steps, the third optional:

1. **The map.** Importer Hub → Tools → **Hex map from image**: the grid is
   found on the print and a scene is made with a working hex grid (next
   section).
2. **The keyed locations.** Importer Hub → Tools → **Key locations**, pick the
   book, and the whole hex key is filed for you (next section). For a book
   with no page map, or for your own crawl, paste (or **Grab from PDF**) the
   hex key and its keyed-location table and press **Create hex pages**. Then
   **Pin on [scene]**, or the tagger's **Pin keyed hexes**: one map note per
   keyed hex on the scene you are viewing, each opening its journal page (see
   *Keyed locations on the map*).
3. **The terrain**, optional: the tagger's **Legend** names the terrain of
   every hex from one card per glyph (see *The legend*), for encounters and
   for Shadowdark Extras' hex records on this same map (see *Playing on the
   print itself*).

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

## A whole book's key locations

Importer Hub → Tools → **Key locations** does step 2 for a book the module has
a verified page map for. Pick the book and it works through the regions,
reading two things out of *your* PDF for each one: the region's keyed-location
table (number, region, terrain, name) and the pages of write-ups that follow
it, where the book gives each location its own heading and a paragraph or
three. Those write-ups are what you get — the full entry, not the one-line
blurb from the table.

Each region is filed as its own journal entry in the Journals pack, with one
page per keyed hex inside it and the region's summary rows stored on the entry
for the map notes and the dataset. One entry per region keeps the sidebar
readable and still gives every location its own page to pin, link to and edit.

The **Game Master's Guide to the Western Reaches** files 270 keyed hexes across
15 regions. Morzomotha is not among them: the book keys that underworld level
M010, M1004 and so on, which are not coordinates on the surface map, so there
is nowhere to pin them — paste that chapter by hand if you want its pages.

Running it again is safe and is how you pick up a parser improvement: pages are
matched by the hex number on their flag and updated where they sit, so your own
edits to a page's name are kept and nothing is duplicated. Cross-references
between hexes become links inside a region; a reference to a hex in another
region stays as plain text, because the two are separate journal entries.

## Keyed locations on the map

Once the hex key is filed as pages (Importer Hub, **Create hex pages**), the
keyed locations go on the map as Foundry notes: **Pin on [scene]** in the
hub right after filing, or **Pin keyed hexes** in the tagger's header with
the crawl chosen. A book imported per region files more than one crawl, so
the tagger's hex-key picker also offers **(every crawl)** — one press pins
every region of the book, and the same choice makes the keyed sheet, the
terrain answers and the dataset hand-off read all of them together. Each note sits on its printed hex, is labelled with the
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

## Which region is a hex in?

**Hex map from image** reads the region borders while it sets the map up — you
do not have to ask for it, and there is nothing to press.

A hexcrawl map draws its region borders as a **thick line along hex edges**,
against the thin line every other edge gets. The scan reads the edges the same
way you do: it walks the middle of each shared edge and asks how much of it is
inked. A border runs *along* an edge; a river only *crosses* it, which is why
measuring the whole edge tells them apart. The enclosures those borders make
are the regions, and your hex key names them — each enclosure takes the region
of the keyed locations inside it.

So once a book's key locations are imported, **every hex knows its region**,
not just the 270 keyed ones:

```js
await game.shadowdarkEnhancer.hexMaps.regionOf(1403);
// { num: 1403, region: "Isles of Andrik", via: "border", exact: false, distance: 0 }

await game.shadowdarkEnhancer.hexMaps.regions();   // every hex at once
```

`via` says where the answer came from. **`"border"`** means the print drew the
line and the book named what is inside it — nothing was guessed.
**`"nearest"`** is the fallback for a hex the borders could not place: it takes
the region of the nearest keyed hex, which is right about 84% of the time and
worst in open sea. `exact: true` still means the book keyed that hex itself.

On the Game Master's Guide to the Western Reaches the scan finds **84
enclosures**, and **not one of them holds keyed hexes from two different
regions** — that is the check that says no border was missed badly enough to
run two regions together. If any ever do, you are told the count rather than
handed a wrong answer quietly. 98% of its hexes land in an enclosure the hex
key can name; the rest are pieces a coastline or a lake ring carved off, and
those fall back to the nearest keyed hex.

How right is it? The only thing that can answer that is the book, which prints
a region beside each of its 270 keyed locations. Holding each one out in turn
and naming its enclosure from the other 269: **255 right, none wrong**, and 15
where the held-out location was the only keyed hex in its enclosure, so there
was nothing left to name it with. The same test puts the nearest-keyed-hex
fallback at 229 of 270. That measures only the hexes the book keyed, which are
not an even sample of the map — for the rest there is nothing to check against,
which is the honest answer rather than a percentage.

The scan stores only the **shapes**. The names are worked out when you ask, so
importing a book's key locations *after* the map was scanned names every hex
without re-reading the image — and a map scanned before you own the book is not
wasted work.

A map set up before this existed can be scanned on its own:

```js
await game.shadowdarkEnhancer.hexMaps.scanRegions();
```

Near a border the print is still the authority: check it there rather than
trusting a single hex.

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
any point. The rarely used buttons (re-sample, import, export, a painted
map, the reference tile, Clear) sit under **More**.

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

## Another go at the same map

Every hex you tag by hand is an example, and those examples used to die with
the scene: a second attempt at the same print started from nothing and you
re-did work you had already done.

**More → Start from a map you have done** takes every hand tag from another
scene of the same print and brings it in here as a hand tag. Hexes you have
already tagged on this scene are left alone, and hexes the other map has that
this one does not are skipped. Then press **Classify**: your carried-over tags
are its examples, so the more of the map you have ever corrected, the less
there is left to correct.

Hexes are matched by their printed number, so this is for another attempt at
the *same* print — on a different map those numbers mean something else.

## When a card's name looks wrong

Naming a card is one answer for every hex in it, so it is the most expensive
thing on that screen to get wrong — and the easiest, because the cards are
small pictures and two terrains can share a glyph family. On one real run a
390-cell desert card was named jungle: 358 wrong hexes, a quarter of every
error on that map, from one click.

So the cards check each other. A card named jungle should look like the other
cards you named jungle; if it instead looks eight times more like the cards you
named desert, **Apply legend** says so and offers to take you back before
anything is written.

It knows nothing about jungles. It only knows that a name should be used
consistently, which needs no model and no truth. It catches the obvious,
expensive slip; it will not catch naming an ocean card arctic sea, because
those two look alike by construction — which is exactly why they are hard for
you as well.

## The review sheet

After a classify, the sheet shows the hexes the classifier was least sure of,
each one **already filled in with what it guessed**. There is nothing to type
on a hex it got right: change the ones that are wrong, leave the rest, and
press **Confirm these N**. That accepts the whole sheet — the ones you changed
and the ones you left — takes them out of the review queue, and records how
often it was right, which is what the accuracy report is built from.

**Show me others** brings a different N and confirms nothing. You never have to
finish the list; the map is already tagged, and every sheet you do is a bonus.

Beside the terrain words the list also holds what the book keys rather than
what the ground is: **village**, **town**, **city**, **city state** and
**keyed location**. Naming a hex one of those keeps it out of the terrains,
where its star or castle marker would otherwise read as a river.

## What the scan got right on its own

The first time a map is classified, what the module made of it is written down
and never touched again — only the hexes it *guessed*, not the ones your legend
cards named. Every correction after that changes the working tags, so without
that snapshot there is no way to ask how much it had right before anybody
helped.

The answer is not available on the day it is taken; it needs your review to
score against. So review at your own pace, and the tagger reports as you go:

> **The initial scan, scored by you**: of the 431 hexes you have checked so
> far, it had 402 right — 93.3%.

That is what the map would have been worth to somebody who corrected nothing,
and it is the number a change to the module has to move. It is per map, so a
second print gets its own, and the two together are worth far more than either
alone.

## How the module gets better at maps it has never seen

Nothing from your map ships with the module — no tags, no pictures, no tables.
What ships is code, and code is improved by being measured against a map
somebody has already verified.

**Verify one map by hand.** Then, with developer tools on and the tagger open
on it, `game.shadowdarkEnhancer.hexMaps.benchmark()` plays out a whole first
run on it as if you had never tagged anything: it clusters the hexes, names
every card from what its cells actually are, classifies the rest from those
cards, runs the neighbour pass, and scores the result against your verified
tags. Your tags are the answer key and never an example.

That single number — what a first-time user would get — is what any change to
the clustering, the feature, the thresholds or the smoothing has to move. On
the Western Reaches it is what moved the shipped legend from 32 cards of 12
cells to 48 of 40 (92.3% to 93.9%), and what showed that two promising feature
changes were worth nothing.

If you verify a second map, run it there too. A change that helps one print and
hurts another is not an improvement, and only a benchmark on more than one map
can tell you which you have.

## What the classifier's confidence means

When the classifier tags a hex it compares it to the hexes you tagged by hand
and picks the closest. It also notes how much closer that winner was than the
runner-up from a *different* terrain, as a multiple: **2×** means the second
choice was twice as far off — an easy call; **1.05×** means the two were
nearly tied and it effectively guessed. That multiple is what the hover label
shows (*auto 1.16*) and what the **Review queue** sorts on: the queue holds
every automatic hex whose call was closer than the threshold, 1.3× to begin
with, and the map overlay rings those same hexes in amber.

A threshold is a trade. Raise it and more hexes are queued, including ones the
classifier got right; lower it and you see fewer, including ones it got wrong.
Nothing about 1.3 is special — it was a starting guess.

**Classify** is the rescan: press it again after a round of corrections and
every hex you have not touched is re-tagged from your hand tags, corrections
and brush confirmations alike. It samples the scene first if it needs to, and
it leaves everything you tagged yourself alone. Measured on one real map: of
56 hexes the previous run had got wrong, a re-run from the GM's other 55
corrections got 54 right.

Once you have corrected a few dozen hexes, the tagger stops guessing and tells
you what your own corrections say: how many you judged, how many were wrong,
what share of those the current threshold actually caught, and the threshold
that would have caught nine in ten — with the number of hexes each puts in the
queue, so you can see what it costs. The button takes that threshold.

If the classifier is wrong most of the time you check it, the threshold is not
the problem and the note says so: it is working from bad examples, and your
corrections are better ones. **Classify** again and every cell you have not
touched is re-tagged from them.

## Fixing a patch at a time: the brush

Classifier mistakes come in patches — a stretch of arctic sea read as ocean,
a band of forest read as jungle — and clicking through them one dialog at a
time is the wrong shape for that. **Brush** in the tagger's header (or
`game.shadowdarkEnhancer.hexMaps.brush()`) opens a small window: pick the
terrain once, tick river, path or coast if the hexes have them, then click or
drag across the wrong hexes on the map. They take what the brush says.

The brush also **confirms**. A hex that already says what the brush says still
takes the stroke when the classifier is the one who said it: it becomes yours,
leaves the review queue, and is recorded as a confirmation. So a patch the
classifier got right is cleared the same way a patch it got wrong is fixed —
drag over both. Only a hex you have already confirmed by hand is skipped, so
going back over ground you have done costs nothing.

A whole stroke is a single change to the scene however many hexes it covers,
and **Undo last stroke** puts every one of them back exactly as it was,
including whether the classifier had tagged it and how confidently. The button
says how many hexes it would put back.

Every hex you paint over a classifier tag is also recorded as a correction
(see *Reviewing the tags on the map*), so a patch of ocean that should have
been arctic sea is exactly the evidence that moves the review threshold.
Closing the window puts clicks back to the one-hex editor.

## The frame is not the map

A printed hex map is clipped by its own frame, and the two column parities are
clipped at opposite ends: the columns that sit higher lose the top half of
their first row, the lower ones lose the bottom half of their last. On the
Western Reaches print that top half-row is where the column labels (000, 200,
400 …) are printed — margin, with no terrain in it at all.

The module does not number those cells. **Hex map from image** sets it when it
finds the lowered columns ending exactly one row short, which is that same
clip seen from the other end. If your print's first row really is map, untick
**top row is frame** under **More** and press **Apply**; if a map you already
tagged is asking you to tag its margin, tick it there instead — the cells stop
being numbered and any tags they picked up are dropped, which the message
tells you. Only automatic tags can be affected; nothing you tagged by hand
sits in the frame.

## Reviewing the tags on the map

Three pictures of the same map, one button each in the tagger's header.
Pressing the one that is up hides it; pressing another switches to it.

- **Show tags** — every hex in its terrain colour, with dots for river, path
  and coast and an amber ring on the automatic cells the classifier was unsure
  of. Hovering names a hex; clicking edits it.
- **Regions** — every hex in its region's colour, from the borders read off the
  print. One colour per region, worked out from the name, so the same region
  looks the same in every world. This is the quickest way to check the border
  scan: a region that leaked into its neighbour is a stain you can see at the
  whole-map zoom.
- **Encounter zones** — which table a wandering check on this hex would roll
  right now, the same one the check itself picks (see
  [Random Encounters](Random-Encounters.md)). **Green** rolls: that region
  prints a column for this terrain, with day or night read off the world clock
  and the northern or southern half off the region's rows; hovering names the
  column. **Amber** is waiting on the moon: at night, in a region whose grid
  prints a *New Moon* or *Full Moon* column, the world clock cannot say the
  phase yet, so hovering names the column a check rolls meanwhile and the moon
  column it would switch to. **Grey** means that region has no column for this
  terrain, or no encounter grid imported at all. The picture redraws itself at
  dusk and dawn.

Coasts come free with tagging: once the terrain is decided, every land hex
touching sea, lake or a river tile is marked coast in the same pass. A
coastline is a line shared between two hexes and the scanner reads those
badly, while it reads sea and lake well — so the coast is worked out from the
terrain rather than looked for in the ink. A river *feature* is a line through
a hex, like a path, and does not make its neighbours coastal (see *Terrain and
features*). Hexes you tagged yourself get their coast too, and no coast is
ever taken away.

**Clicking a hex edits whatever you are looking at.** On the terrain picture
that is its terrain and features, as before. On the regions picture it is the
region: pick one already on the map or type your own, and if the whole
enclosure is wrong there is a box to move all of it at once rather than a
hex at a time. **(as read off the map)** takes a correction back off again.

Corrections are stored beside the scan rather than inside it, so re-reading
the borders never throws your work away: the enclosures are replaced, the
regions you set by hand stay.

The encounter picture reads whatever you have imported, matching each region's
printed column labels against the terrain on your hexes (and, for a Coast
column, the coast feature), so it gets better as you import more of the book
and needs no per-map setup.


A contact sheet shows forty cells at a time; the print shows all of them at
once. **Show tags** in the tagger's header (or
`game.shadowdarkEnhancer.hexMaps.showTags()`) draws every numbered hex on the
scene in its terrain's colour, with a dot for river, path or coast and an
amber ring inside the cells the classifier was unsure of — the same cells the
Review queue serves. A whole region tagged as the wrong thing is a stain you
can see from the zoomed-out view; a single wrong hex is a dot in the wrong
colour. Terrain the classifier or the legend named itself gets a fixed
colour; terrain you typed yourself gets a colour of its own, so two invented
words never look alike.

Hovering a hex names it: the number, its tags, and whether it was tagged
automatically and how confidently. Clicking one opens a small box — one at a
time: clicking another hex moves the box to it rather than stacking a second
one on top. It opens with a
terrain dropdown and the river, path and coast boxes. The dropdown is
alphabetical and holds every terrain the parser knows plus every word already
used on this map, so your own legend names are in it too, and a letter jumps
to it. **(clear this hex)** removes its tags, and
**other…** opens a box for a word that is not in the list yet. Saving writes
to the scene the same way the tagger does, and the map redraws at once. Tokens and map notes keep their own clicks, and dragging the
map still pans it. Press the button again to hide the tags.

The fills sit at 45% opacity over the print. If that is too much or too little
for your map, show them from the console with your own value:
`game.shadowdarkEnhancer.hexMaps.showTags({ alpha: 0.3 })`. It sticks until
you reload.

## The three words this uses

They get mixed up easily, so, plainly:

**Read the map** takes a small picture of every hex out of the scene's image,
in your browser. That is all it does — it decides no terrain and changes no
tag. Everything below needs those pictures, so it happens first (the buttons
that need it will do it themselves if you have not). It takes about fifteen
seconds on a big print and nothing is uploaded.

**Legend** sorts those pictures into groups of look-alikes and shows one card
per group, with a picture of each kind of cell in that group. Name a card and
every hex in that group takes that terrain. It is the fast way to get a whole
map tagged from nothing.

Name what the pictures have in common. A card showing a mountain, a mountain
with a river and a mountain with a road is a *mountain* card: rivers, paths and
coasts are found cell by cell afterwards, so the boxes beside the name are only
for a card where **every** picture has one.

**Classify** tags every hex *you have not tagged yourself*, by finding
whichever of your own hand-tagged hexes it looks most like and copying that
terrain. Your tags are the examples it works from.

So when you correct a hex — on a review sheet, in the brush, or by clicking it
on the map — you are not classifying. You are writing the examples. Pressing
**Classify** afterwards is what spreads them over the rest of the map, and it
never touches a hex you tagged yourself.

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

1. **Read the map.** The tagger reads every cell whose centre lies on the
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
5. **Send to Extras**, or **Download dataset** without Shadowdark Extras.
   Choose the crawl entry filed by the importer to include the keyed hexes and
   their descriptions; without one only the terrain you tagged goes. **Send to
   Extras** puts the details on this map (see *Playing on the print itself*).

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
  decides the feature: one long stroke reaching two edges is a **river**, a
  chain of short marks is a **path**. Coast is not read from the ink; it is
  worked out from the water around the hex afterwards.
- Cells the classifier is unsure about, a close call between two terrains or an
  unclear river or path, go to the **Review queue**. Tag those sheets and every answer
  becomes a new example for the next Classify. Keyed hexes are never classified;
  their terrain comes from the book's text.
- **Sensitivity** scales the feature thresholds: raise it if paths and rivers
  are missed, lower it if plain cells pick up features.

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
  features only, such as a hex that is all river, keeps its first tag as the
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

## Playing on the print itself

**Send to Extras** puts the hex details on the map you tagged. Shadowdark
Extras takes the scene on as a hexcrawl, and every tagged hex gets its record:
terrain, region and zone colour, and for keyed hexes the name, the
description and the settlement. Nothing is painted, so the publisher's art,
your pins and your notes stay exactly as they are, and Extras' hover tooltip,
hex explorer, fog and coordinates work on the print itself. It needs a
Shadowdark Extras new enough to adopt a map (`hex.adoptHexcrawl`); an older one
is named, not worked round.

- Every hex's river, path and coast go too, as features beside its terrain
  (see *Terrain and features*), so Extras' tooltip shows River, Path and Coast
  pills on the print.
- Send again after retagging and the records update in place. A hex's river,
  path and coast are replaced, so a tag you took off goes (even when you
  cleared the hex's tags completely) and nothing is listed twice; every other
  feature on the hex, such as a dungeon you added in Extras, is left alone.
  Settlements go until they have arrived once, then no more, because Extras
  keeps what the players have discovered on them and sending them again would
  reset it.
- To merge like that, the tagger reads what Extras holds for the map first. If
  it cannot (other than on the very first send, when Extras holds nothing
  yet), the details still go but no features do, and the tagger says so:
  replacing the lists blind would erase discoveries. Send again once the
  records are in.
- Extras' **Hex Editor** does not know river, path and coast yet: saving a hex
  there turns them into *dungeon*
  ([shadowdark-extras#157](https://github.com/DimitroffVodka/shadowdark-extras/issues/157)).
  The next **Send to Extras** puts them back.
- Extras numbers a map from the scene's top-left cell, so the map's first hex
  (`0000`, or `0101` on a map numbered from 1) has to be that cell. A map set
  up through *Hex map from image* already is. If yours is not, the tagger says
  so before anything is written, instead of putting the details on the wrong
  hexes.
- No river or road is painted: the print already shows them.

**Build painted map**, under **More**, is the other way: Extras builds a new
scene painted from your tags, with its own rivers and roads. You can still lay
the print over that scene: **Reference tile**, pick the painted scene, and tick
**Use the print as the map**. The print goes on visible and opaque, stretched
so its hex field lands exactly on the scene's cells (a print whose hexes are
taller than regular is squared up in the process). Hide the tile and the
painted map is back.

## The dataset

```js
{
  version: 1, name, source,
  grid: { cols, rows, distance: 6, units: "mi", landscape: false, flipX: false, flipY: false,
          origin: 0,        // only for a map that numbers its first column and row 0
          rowsLowered: 74 },// only when the lowered columns end one row short
  terrain: { default: "forest", regions: [ { biome: "mountain", hexes: [1346, ...] } ] },
  hexes:   [ { num: 2849, name, terrain: "forest", desc, zone,
               features: [ { id: "settlement-2849", type: "town", name, discovered: false },
                           { id: "river-2849", type: "river", name: "", discovered: true } ] } ],
  networks: { river: [1251, ...], road: [4654, ...], spanning: true }
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
JSON. A hex's river, path and coast features are
entries in its `features` list, one id per kind (`river-2849`), named by
Extras from their type and sent discovered; a river tile is terrain `river`
with no river feature. The summary table's settlement marker (village, town,
city, city state) goes in the same list as `settlement-<num>`, undiscovered.
River and path features are also drawn as networks for the painted build: the
book's **path** becomes Extras' **road** network. Every hex a river or path is
tagged on goes into its network, so `networks.spanning: true` asks Extras to
drop the links that would close a loop between neighbouring tagged hexes.
Terrain goes out as the book's word (`salt flat`, `deep tunnels`); Extras
keeps that label on the hex record and chooses the painted biome itself.

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
