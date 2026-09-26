# Importer Hub

[← Wiki home](index.md)

The single front door for getting Shadowdark content into your world.
Upload your official rulebook PDFs, run the one-button batch importer, and
commit cleanly formatted monsters, spells, items, classes, and roll tables into
managed compendium packs.

![The Importer Hub](images/importer-hub.png)

---

## Quick start: the fast path

If you have your book PDFs ready, you do not need to paste hundreds of entries
by hand.

1. **Upload your PDFs:** Go to **Tools → Source PDFs** and link your PDF copies
   of the Core rules, Cursed Scrolls, or Western Reaches.
2. **Click Import everything:** Expand the **Manage** review tree and click
   **Import everything (N)** (or **Import all N in <folder>** for a specific
   book). The runner grabs pages, parses entries, commits clean records,
   closes background workspaces when finished, and gives you a summary report.
3. **Handle any exceptions:** If a row in the report says *Needs your attention*
   or *Import by hand*, click its **Import** button to review the draft in the
   preview, make any adjustments, and commit it manually.

---

## Bring your own books

**The module ships no sourcebook prose.** It knows the structure of the books
(entry names, citations, dice formulas, and table shapes) but no rules text.
Nothing is encrypted or hidden.

**You supply the text** from your own purchased PDFs. The module applies the
correct parsing recipe, enriches internal `@UUID` links, assigns curated
icons, and files documents into organized world compendiums.

- **Content printed across books** (such as spells reprinted in *Western
  Reaches*) can be imported from whichever PDF you own. A reprint is one row,
  not two: it shows the page in each book that prints it, grabs from whichever
  book you have linked, and counts as imported no matter which one you used.
  A table you imported from *Cursed Scroll 1* already satisfies the GM Guide's
  row for it, and a monster imported from either book satisfies both
  bestiaries.
- **Only genuine reprints are linked, and only after checking.** Where two
  books print the same table under the same name but changed the text, they
  stay separate rows: the *Cursed Scroll 6* and *Western Reaches* carousing
  tables are re-skinned for their setting ("the Duke" becomes "a noble"), and
  the Player's Guide rewrote three of the Pit Fighter's five talents. The GM
  Guide's Djurum rumors ARE linked to *Cursed Scroll 2*'s, but only three of
  the ten lines survived the rewrite — importing from the zine gives you the
  older list.
- **Content the base Shadowdark system already ships** (core spells, basic
  bestiary, core gear) is skipped so you never get duplicates.

---

## Opening the Hub

| Route | How |
|---|---|
| **Crawl Bar** | Click the **Importer** button. |
| **API** | `game.shadowdarkEnhancer.tables.openHub()` |

Opening the hub is instant; scanning your world compendiums is lazy and only
runs when you expand the Manage review strip.

---

## The Batch Runner (Import Everything)

Once your source PDFs are registered, click **Import everything** on the Manage
tree toolbar or **Import all N in <folder>** at the top of any folder.

The batch runner executes the same steps you would by hand: it reads cited
pages, runs the appropriate parser, validates the draft, and commits it.

### Batch runner safety rules

Because nobody is supervising every single entry, the batch runner follows
three strict rules:

1. **It never overwrites and never deletes.** Every name collision defaults to
   "keep existing", so running a batch over an already-imported library is safe
   and produces zero duplicates.
2. **It never commits broken data.** Any draft that fails a quality check is
   held in the preview or reported for manual review rather than written to your
   packs.
3. **Every entry is accounted for.** Rows lacking linked PDFs, page citations,
   or automated routes are listed clearly in the final report.

### Workspace cleanup and progress

- **Automatic window management:** The runner opens dedicated workspaces
  (Spell Importer, Class Importer, Item Builder) as needed and **closes them
  automatically when the batch finishes**, leaving only the final report.
- **Progress bar:** A visual indicator displays the current entry, with a
  **Stop** button that safely pauses the run after the active item.
- **End-of-run report:** Results are grouped into *Imported*, *Already in your
  library*, *Needs your attention*, and *Import by hand*.

---

## Manual importing: the step-by-step loop

When you want to import a single item, test a homebrew statblock, or resolve a
row that needs attention:

### 1. Choose a type (or use Auto-detect)

The type selector provides two groups:

- **Universal paste & parse:** `Auto-detect`, `Monsters`, `Items`, `Tables`,
  `Boats`, `Backgrounds`, `Talents`, `Ancestry`, `Compound generator`,
  `Cartesian table`, and `Downtime`.
- **Guided workspaces:** `Spells…` and `Classes…` open dedicated
  [Class & Spell Importers](Class-and-Spell-Importers.md).

`Auto-detect` segments mixed text into typed blocks. Choose an explicit type
when pasting ambiguous text.

> **`Downtime` must be selected explicitly.** Auto-detect will not claim
> downtime tables; selecting Downtime unlocks outcome text into world settings
> for the [Downtime](Downtime.md) sheet.

### 2. Paste or grab text

Paste text directly from your PDF reader, or use **Grab text** if a source PDF
is registered. Any text the parser cannot match lands in a **Skipped** list so
nothing is silently dropped.

### 3. Review the preview

![A parsed table in the preview](images/importer-preview.png)

Parsed entries appear in an editable preview card.

- **In-place editing:** Text edits update without re-rendering, so your cursor
  never jumps.
- **Inline review tags:** Any line the parser is uncertain about is highlighted
  with an inline *review* tag; hover over it to view the explanation.


### 4. Commit

Click **Create** (or **Commit All** to process monsters, items, spells, and
tables in sequence).

- **Conflict handling:** If a document with the same name already exists, you
  can choose to *Rename newcomer*, *Replace existing*, or *Skip*.
- **Monster Spell protection:** Generated monster spells are protected. If a
  standard item import shares a name with an existing generated monster spell,
  *Replace* is automatically downgraded to *Keep both* with an explanatory
  warning.
- **Hex keys:** A pasted hex key (numbered entries such as `1403 Thornmere`,
  three or more in a run) shows a **Hex key** strip with its own **Create hex
  pages** button. It files one journal page per hex into the Journals pack
  under your source, inside a journal entry named after the crawl. The name is
  prefilled from the heading above the first hex; edit it before committing.
  References to other hexes in the same paste (`hex 1403`, `(1403)`) become
  links. Re-pasting the same crawl updates its pages in place and never deletes
  pages that are missing from the new paste. Hex keys are not part of Commit
  All.
- **Keyed summary table:** The keyed-location table some books print ahead of
  the entries (one line per hex: number, region, terrain, name) is recognised
  in the same paste or on its own. Its rows are kept out of the page parser and
  filed on the crawl's journal entry at commit, where they carry each hex's
  region, terrain and settlement size. When grabbing that table from a PDF,
  pick **Single column** in the extractor: **Auto-detect** sees the wide table
  as two columns and separates the names from their rows.
- **Hex crawl hand-off:** After a hex-key commit the hub shows **Hex pages
  filed** with a **Download dataset** button, or **Send to Extras** when
  Shadowdark Extras exposes its hexcrawl builder. Either way the module builds
  one dataset from the filed pages and keyed rows: the keyed hexes with their
  descriptions, terrain regions, and river and road hex lists, using published
  hex numbers only. The download is a JSON file built from your own book text;
  nothing ships with the module.

---

## What happens after you commit

- **Table link sweeps:** Roll table results are automatically enriched with
  `@UUID` links to monsters and items, and dice expressions become inline rolls.
- **Spell ↔ class wiring:** Spells link to their caster classes regardless of
  import order.
- **Art provenance protection:** Custom icons you assign are marked `custom`
  and protected against overwrites. Untouched module-curated icons upgrade
  automatically when new maps ship.
- **Curated item icons:** Mapped weapons, armor, basic gear, and treasure
  receive reviewed Foundry-native icons.
- **Mount & property folders:** Mount actors are organized into a `Mounts`
  folder in `sde-actors`. Canonical Western Reaches weapon properties (*Blast*,
  *Exploding*, and the Lance *Charge*/*Devastating*/*Mounted* triple) are filed
  in `Western Reaches / Weapon Properties`.

---

## The Manage review tree

![The manage review tree](images/importer-manage-tree.png)

A collapsible panel comparing what each supported book contains against what is
currently in your world packs.

- Filter by **All**, **Still locked**, or **Imported**.
- **New (N)** appears after a module update that added content you can import —
  a new book, a bestiary, more roll-table rows. The update is compared against
  the library this world last saw, so only rows that are genuinely new *and*
  not yet in your packs are counted; each one also carries a small **new** tag
  in the tree. The single active GM is asked at world load whether they want to
  see them — **Show me** opens the Hub with the **New** filter already applied,
  **Not now** leaves the rows tagged for whenever you come back. You are asked
  once per module version, so dismissing it costs you nothing.
  A world importing for the first time is told nothing: with no
  earlier library to compare against, everything would be "new". Rows drop off
  the list as you import them, and the list is replaced by the next update's.
- **Search…** narrows the tree to rows whose name, book, or page cite matches
  what you type, and opens the folders holding them so the hits are visible
  without clicking. A folder's own name matches too, so searching *Ancestries*
  returns that whole branch. The filter still applies alongside the search;
  clear the box to get the full tree back.
- Every missing row has an **Import** button that pre-seeds the paste box with
  the correct book, type, and title.
- An imported Western Reaches patron whose Patron Item has no description yet
  (imported before 0.17.2) shows **Fill description**, and its folder shows
  **Fill all N descriptions**. Both read the patron's page from your linked
  Western Reaches PDF; a description you wrote by hand is left alone. The
  buttons disappear once the descriptions are filled.
- The **Downtime** node tracks unlocked book tables in world settings, displaying
  `Unlocked (25/25)`, `Partial`, or `Locked`.

---

## Tools menu & Source PDFs

![The Tools dropdown](images/tools-dropdown.png)

**Hex map from image** takes a map image, finds its hex grid on its own, creates the aligned scene and opens the tagger on it ([Hex Maps](Hex-Maps.md)).

**Hex tagger** opens the [Hex Tagger](Hex-Maps.md) for the active scene: a contact sheet over your hex-map image where you tag terrain and overlays, then hand the result to Shadowdark Extras or download it.

**Key locations** reads a book's whole hex key out of your own PDF in one pass.
Pick the book and it walks the regions, filing each one as its own journal
entry with a page per keyed hex — the full write-up, not the summary line — and
the region's summary table on the entry for the map notes and the dataset. The
Game Master's Guide to the Western Reaches files 270 keyed hexes across 15
regions this way. Run it again whenever you like: pages are matched by their
hex number and updated in place, never duplicated.

**Chapter to journal** turns a range of pages from a linked PDF into one
journal you can read at the table. Pick the book, type the printed pages
(`16-27`) and a name, then press **Preview**. You'll see the page names and a
sample of each before anything is written. Press **Create** to file the journal
in the Journals pack, in the book's folder.

- **Pages** are split at the book's ALL-CAPS headings. Lines are rejoined into
  paragraphs, words broken across lines are mended, and page numbers and page
  titles are dropped.
- **The preset** *Western Reaches GM Guide: the City-States* does it in one
  click. That chapter prints a city's name as a large title rather than a
  heading, so the preset gives each city-state its own page (City of Masks,
  Alkesh, Stonehall, the Kyzian Tribes, Lydonia) plus the introduction before
  them. The headings inside each city (Overview, History, Factions…) become
  sub-headings.
- **The preset** *Cursed Scroll 6: the City of Masks holidays* files pp. 46–47
  as *City of Masks Holidays*, one page per holiday (Lastmoon, Maytide, the
  Night of St. Anton, the Duke's Ball). The book's introduction to the spread
  is left out. Once they're imported, Shadowdark Extras' carousing window can
  apply each holiday's carousing effects and garb questions on its day in the
  City of Masks (the module's `holidays` API; see *API.md*). Maytide falls on
  May 1, the Duke's Ball on June 21 and the Night of St. Anton on September 22,
  read from the world calendar. Lastmoon (the year's last full moon) waits for
  a moon to be tracked, so for now it never falls.
- **Key locations:** a page whose name matches an imported key location links
  to that hex's page, and the hex page links back. If the crawl has been
  pinned on a scene, the link goes to the world copy of the page, so its
  **Jump to Pin** works. Import the key locations first to get these links.
- **Running it again** on the same book and range updates the journal in
  place. Pages you added yourself are left alone.
- **Column warnings:** if the column split was uncertain on a page, the
  preview lists it, so you know which pages to check against the book.
- **What it can't see:** paragraph breaks are worked out from the text, since
  a PDF doesn't mark them. A paragraph whose last line runs almost the full
  column width can merge into the next one. A table inside the range comes
  out as running text.
- Who can read the journal is up to you, through normal journal ownership.

Open the **Tools** dropdown to manage PDFs and world backups:

### Source PDFs

![The Source PDFs library](images/source-pdf.png)

Register uploaded PDF files for Core, both Western Reaches guides, and Cursed
Scrolls 1–6.

The **Game Master's Guide to the Western Reaches** is its own book row, separate
from the Player's Guide, because it is its own PDF. Its printed page numbers
match its PDF pages, and either printing works — the standard one or the
"Horizontal Pages" edition, which marks 39 of its pages as rotated.

- **Deep links:** Import buttons jump directly to cited book pages in Foundry's
  PDF viewer.
- **Grab text:** Extracts clean, column-aware page text directly using
  bundled PDF.js.
- **Custom & homebrew books:** Select **➕ Another book…** to register
  third-party supplements or adventure modules.
- **One copy serves every world.** **Upload & link** stores the book in
  `Data/assets/` on your server under its standard filename, and every world
  there links it on its own (the row reads "default path"). Files you place
  in that folder yourself under the same names work the same way. Hosts that
  keep uploads in an asset library (The Forge, S3) put the file there instead.
  Nothing is sent anywhere else.
- **Link a file on the server** links a PDF that is already on the server
  instead of uploading one — the route to use when your host refuses a
  book-sized upload as "too large" (see
  [Troubleshooting](Troubleshooting.md#uploading-a-book-pdf-is-rejected-as-too-large)).
  Put the file in your Foundry data folder by any route you like, press the
  button and pick it.
- **A link is only as good as the file behind it.** Every linked book is
  checked when the library opens, so one whose file has moved or was never
  written reads as missing rather than linked. Books in a host's asset library
  (The Forge, S3) are taken on trust — the browser cannot check them.

### Bundle export / import

Export your entire managed compendium library to a single JSON file or import a
bundle into a new world. Imports validate data, preserve existing documents, and
rebuild all internal `@UUID` links.

---

## Troubleshooting

**Auto-detect put my text in the wrong bucket.**  
Select the content type explicitly from the dropdown before parsing.

**Half my paste ended up in Skipped.**  
PDF copy-paste often introduces header and footer artifacts. If your PDF is
registered, use **Grab text** instead of copying manually.

**I received a "Column check" warning during text extraction.**  
Advisory notice that a column split was close to text. Check the preview to
confirm no words crossed column boundaries before committing.

**Coin and Gem didn't import with the gear table.**  
Intended behavior. Currency belongs in character purses or loot rather than as
inventory items, so the importer logs them as skipped.

**A description has run on into the next entry.**  
Re-import it. Both gear and spell descriptions used to run past their own entry
— gear into the next item, and the last spell on a page into whatever followed
it, which could be several pages of tables. Both are fixed, so a fresh import
of the same pages gives you clean text.

**Import everything is missing, or its number is lower than the locked count.**  
It only counts rows whose book has a linked PDF and a page citation. Link the
book under **Tools → Source PDFs** and those rows join the count. The report's
*Import these by hand* section lists the rest.

**Re-importing created duplicate documents.**  
Check the conflict dialog selection. The default *Rename newcomer* creates a
second copy. Choose *Skip* to leave existing items untouched.

---

**Related:** [Class & Spell Importers](Class-and-Spell-Importers.md) ·
[Table Import & Shapes](Table-Import-and-Shapes.md) ·
[Compendium Packs](Compendium-Packs.md) ·
[Character Builder](Character-Builder.md)
