# Importer Hub

[← Wiki home](Home.md)

The single front door for getting Shadowdark content into your world. Paste text
from your own PDF, see what it parsed into, fix anything wrong in place, and
commit it into the managed compendium packs.

![The Importer Hub](images/importer-hub.png)

---

## Bring your own books

**The module ships no sourcebook prose.** For the *Cursed Scrolls* (CS1–CS6), the
Core rules, and the *Player's Guide to the Western Reaches*, it knows the
**structure** of the content you own (entry names, source and page citations,
dice formulas, and table layout) and nothing else. Nothing is encrypted and
nothing is hidden. There is no text to ship.

**You supply every word** by pasting the matching section from your own PDF. The
module reads what kind of content it is, applies the right recipe, remaps the
links, and files the result where it belongs.

Two consequences worth knowing:

- Content printed in more than one book (the Delver and Wyrdling classes, the
  *Cursed Scroll* spells reprinted in *Western Reaches*) can be imported from
  **either** book's paste.
- Content the Shadowdark **system already ships** (core spells, the base
  bestiary, the legacy Bard) is deliberately skipped. You already have it.

## Opening it

| Route | How |
|---|---|
| **Crawl Bar** | The **Importer** button |
| **API** | `game.shadowdarkEnhancer.tables.openHub()` |

One window, one scrolling view, no tabs. Opening it does **not** scan your world.
The census work is lazy and only runs when you expand the Manage strip.

---

## Importing: the basic loop

### 1. Choose a type (or don't)

The type selector has two groups. **Paste & parse here:**

`Auto-detect` · `Monsters` · `Items` · `Tables` · `Boats` · `Backgrounds` ·
`Talents` · `Ancestry` · `Compound generator` · `Cartesian table` · `Downtime`

**Guided workspaces:** `Spells…` and `Classes…`. Picking either opens the
dedicated [Spell or Class Importer](Class-and-Spell-Importers.md) instead of
parsing in the hub.

Leave it on **Auto-detect** and the paste is run through a segmenter that splits
a mixed dump into typed buckets, or choose a specific type so only that
recogniser runs, which is what you want when auto guesses wrong.

Items can additionally be forced to a specific **item subtype**.

> **`Downtime` is the one type Auto-detect will not find.** It has to be picked
> by hand, or seeded for you from the Manage tree. Under **Auto-detect** a
> downtime page lands in **Skipped**.

### The Downtime type

Downtime is the odd one out, because it doesn't create documents. It unlocks the
outcome text for the [Downtime](Downtime.md) window into a world setting, per
book.

Its preview section adds a **Book** picker above the paste box. Switching books
clears the parse, so pick the book first. Arriving through an **Unlock** button
also auto-fills the paste box from the book's registered source PDF, the same
grab the table rows use, so the usual path is just review then Parse.
**Parse** reports
`Matched 25 of 25 slots.`, lists **Still unfilled:** and **Lines nothing
claimed:** underneath, and **Unlock outcomes** writes it, confirming with
`Downtime (Cursed Scroll 6): 25 of 25 entries unlocked.`

This preview is the only place in the module that prints downtime slot labels,
and only for someone who has the book open in front of them. A second unlock of
the same book replaces that book's stored text. The other book is untouched.

### 2. Paste

Paste the section from your PDF into the box. Anything the parser can't claim
lands in a **Skipped** list instead of being silently dropped, so you can see
what didn't make it.

### 3. Review the preview

![A parsed table in the preview: its name, dice formula, Replacement toggle and
folder, above one editable row per result with its range and text](images/importer-preview.png)

Each parsed entry appears as an editable preview. **Field edits apply in place
with no re-render**, so the cursor doesn't jump while you're typing. Structural
changes (adding or removing a row) re-render.

For a table that means the name, the **formula** it rolls on, whether it draws
with **Replacement**, and the **Folder** it will be filed under. Every result
row sits below it as an editable range and text, with **×** to drop one.
Nothing is written until you press **Create** (or **Create tables** for the whole
section).

<!-- TODO screenshot: images/importer-preview-flagged.png — The preview with a flagged row
     How: Paste content the parser is unsure about (e.g. a table with overlapping
     ranges) and Parse; screenshot a row carrying its inline review tag. -->

**Rows the parser is unsure about are marked directly on the row**: highlighted,
with an inline *review* tag and the reason on hover. You are never told "something
in this card needs review" without being shown which line.

### 4. Commit

Commit is **GM-only**. Each type gets a conflict dialog before anything is
written, and the result report tells you what was **created**, **replaced**, and
**skipped**.

| Content | Lands in |
|---|---|
| Monsters | `sde-actors` |
| Items, spells, character content | `sde-items` |
| Tables | `sde-tables` |
| Classes, talents, ancestries, backgrounds | The Character Options packs |
| Downtime outcomes | The `downtimeContent` world setting, not a pack |

**Commit All** runs monsters → items → spells → tables in order.

The **Source** dropdown becomes the per-source folder inside each pack. Its
options are *— none —*, *Core Rulebook*, *Cursed Scroll 1–6*, and
*Western Reaches*.

> **Nothing is ever silently overwritten or deleted.** Re-importing the same
> content is idempotent. The conflict dialog's default is to *rename the
> newcomer*. Choosing *replace* keeps the same document UUID so existing links
> stay valid, and choosing *skip* leaves the existing document byte-identical.

### After a commit, automatically

- **Table re-linking.** Imported tables get `@UUID` monster/item links and
  inline roll counts, swept automatically after each commit.
- **Spell ↔ class linking.** Spells find their caster class whichever was
  imported first.
- **Item art provenance.** When replacing an existing item, art is preserved or
  upgraded according to explicit provenance (`flags["shadowdark-enhancer"].art`)
  rather than image path heuristics:
  - `default`: The module's default pick (e.g. type fallback, treasure/spell icon). Upgradeable on re-import.
  - `imported`: The image from the source text draft, untouched since import. Upgradeable on re-import.
  - `curated`: A deliberate module-curated icon pick (A4). Upgradeable on re-import.
  - `custom`: Art edited or replaced by the GM. Preserved and never overwritten on re-import.

  Any divergence between the stored item's image and the recorded witness path is treated as `custom`.
  Legacy unmarked items are classified conservatively (`default` if matching the module's default today or blank; otherwise `custom`). Once a curated map ships, that classification consults the resolver: a legacy unmarked item wearing the map's current `icons/**.webp` path classifies as `default` (upgradeable) rather than being frozen as `custom`; removing a row later reclassifies it as `custom`, which is the safe direction.
  Generated artifacts in `sde-items` (`world.shadowdark-enhancer--items`) remain governed by the replace-always contract (A7/D6).
  *Note:* This provenance system governs `item-importer` only. Class content re-import art is tracked separately as a known issue (GitHub #89 / A3b), and monster/token art is managed via Monster Token Art (B9/F4/N6).
- **Siege weapon property foldering.** When importing Western Reaches siege
  weapons (via dedicated Items commit or *Import everything* / *Commit All*),
  the materialized *Blast* and *Exploding* weapon property items are filed
  under `Western Reaches / Weapon Properties` in the managed Items pack.
  Pre-existing same-name property documents at the pack root are moved into
  the folder in place, keeping their UUIDs, rule text, and GM edits intact
  while avoiding duplicate folders or items on re-import.
- **Curated-icon resolver — internal contract (A4, zero production maps).** Six future issue paths (weapons, armor, basic gear, sea-wolf plunder, dead-bandit loot, diabolical treasure) currently share one pure, Foundry-free mechanism in `scripts/shared/curated-icons.mjs` instead of per-type name matching. The resolver ships **no production rows** — the generic mechanism and its discovery wiring only. Every lookup returns `null` until D1–D6 register their reviewed maps, so image selection and A3 classification remain unchanged from before.
  - **Two key spaces, split for structural reasons:** Weapons, Armor and Basic Gear are keyed by `curatedNameKey(finalDocument.name)` alone (`normalize(name)` → `bastard sword`); treasure is keyed by `curatedSourcedKey(source, name)` → `<sourceId>:<normalize(name)>` (e.g. `cs3:a golden skull…`). The split is structural, not stylistic: `buildItemData(draft)` — the single item-construction choke point in `scripts/importer/items/item-importer.mjs` — cannot know which book a draft came from (source is a commit-time batch option threaded through `createItems(drafts, {source})` and only afterwards stored as `flags[MODULE_ID].source`), so a gear key requiring the book would be unresolvable at the one place gear art is chosen. Gear names are globally distinct across supported books (N3 verifies), so one mapping applies to every copy. Treasure materializers know exactly which table they are draining and their names are book prose generic enough to collide across Cursed Scrolls, so qualification by book is cheap and forward-proof.
  - **Display-name-derived normalization:** Map keys are derived at load from the display-name string — never hand-written beside it. `curatedNameKey` lowercases with `toLowerCase` (not locale — avoids Turkish `I` → `ı` drift), collapses whitespace, trims, and folds curly quotes (`‘’‚′` → `'`). Punctuation is preserved: commas, apostrophes and parenthesised quantities (`Rope, 60'`, `Miner's putty, jar`, `Arrows` vs `Arrows (20)`) remain distinct keys, because stripping them would collide reviewed rows.
  - **Discovery and registration:** Each reviewed map lives as its own module under `scripts/shared/curated-icon-maps/` and publishes itself by calling `registerCuratedIconMap(label, rows, {space})` at import time. The index `scripts/shared/curated-icon-maps/index.mjs` is side-effect imported once from `scripts/shadowdark-enhancer.mjs` before any item is built. Adding a D-ticket map is one file plus one `import "./<map>.mjs";` line — no shared array literal for tickets to collide on. `defineCuratedIconMap` / `buildCuratedIconRegistry` validate each map; bare names are globally merged, so a cross-map duplicate is a registry-level duplicate even when each map is internally consistent.
  - **Semantic category before broad fallback:** At runtime `_automaticArt` chooses `Spells (Shikashi channel)` → `TYPE_DEFAULT_IMG` for `Background`/`Talent`/`Ancestry`/`Class` → `curatedArtFor({name})` → `pickTreasureIcon(name)`. The curated maps *are* the semantic layer (each entry chosen from the matching `icons/weapons/…`, `icons/equipment/…`, `icons/sundries/…` folder, fallbacks documented in N3). A curated hit returns `{img, artState: "curated"}` and is stamped via `_artStampFor`; the generic keyword/type fallback remains `default`. Both `curated` and `default` are upgradeable under A3 — the distinction records provenance, not preservation — while `custom` (human edit) is never overwritten.
  - **Unmatched falls back quietly:** `resolveCuratedIcon` returns `null` when it has no reviewed pick; the caller keeps its fallback art. No guessing tier — a wrong curated icon looks deliberate and is worse than a generic one.
  - **Target boundary — `world.` allowlist:** `isCuratedApplyTarget(packCollection)` allows only `world.` packs. `LootLinker` resolves plunder rows system-pack-first by design, so a resolved `uuid` may point into `shadowdark.gear`; stamping curated art onto that would mutate the base system compendium. The boundary is deliberately wider than A3's `MANAGED_ITEMS_PACK` (`world.shadowdark-enhancer--items`): curated art may be written to any world pack this module owns content in, but never to a system pack.
  - **Coverage and drift audit:** Construction is total — a duplicate key, blank name, malformed path (`!^icons/[^\\s]+\\.webp$`), `unknown-space` or `unusable-source` never throws; the row is dropped into `problems` and that item keeps fallback art. `auditCuratedIconRegistry()` aggregates `{total, bare, sourced, perMap, problems, crossSpaceNames}` — `problems` empty is the contract, `crossSpaceNames` is informational (a treasure name that also exists as gear resolves qualified-first, counted for visibility). The gate is test-enforced in `test/curated-icons.test.mjs`.
  - **CHANGELOG note:** A4 activates no user-visible map; the first D-ticket that ships a reviewed map owns the user-visible CHANGELOG entry.
- **Book-only weapon and armour properties.** A property code the core system
  has no entry for — the Lance's *Charge*, *Devastating* and *Mounted*, an
  obsidian weapon's *Obsidian*, barding's *Mount* — can't be attached to the
  item, so it is named in the item's **description** instead: *“Properties with
  no core Shadowdark equivalent: Charge, Devastating, Mounted.”* The preview
  flags each one as it parses. Re-importing refreshes that line without
  disturbing a description you wrote yourself.

There are no manual maintenance buttons to press. This is deliberate: the fix
belongs in the import flow, not in a repair tool you have to remember.

---

## The Manage review tree

**Filter it to what you still need.** The tree's toolbar has **All · Still
locked · Imported**. *Still locked* hides everything already in your library,
along with the folders that are now empty, so what's left is your
to-import list. When there's nothing left it says so outright instead of
showing you an empty panel.

![The manage review tree](images/importer-manage-tree.png)

A collapsible `<details>` strip holding a browsable folder tree that reconciles a
manifest of what each book contains against what your world actually has.

- Every entry is marked **have** or **gap**.
- **Scanning is lazy.** The first expand triggers the scan, so opening the hub
  is always instant.
- Expansion state is tracked per node, so a big tree doesn't collapse on you.
- Every missing entry carries an **Import** button that **seeds the paste box**
  with the right type, source label, and entry name, so you paste and commit
  without configuring anything.

The tree covers monsters, items, and the **character-content unlock** rows:
the classes, talents, spells, backgrounds, and gear from CS4–CS6 and Western
Reaches that the core system doesn't ship. The manifest holds names, types and
sources only. No rules text.

### The Downtime node

One node sits apart from the rest, because it is censused from a world setting
rather than from a pack. **Downtime** holds one row per book, showing the book,
its pages, and a state chip: `Unlocked (25/25)`, `Partial (12/25)` or `Locked`.

Counts and nothing else. The row never says what is in the book, before or after
import. Its button reads **Unlock** instead of Import, and it seeds the paste
flow the same way every other row does. Double-clicking a row that is already
unlocked opens the [Downtime](Downtime.md) window, since there is no document
behind it to reveal.

Character content committed here is stamped with a `system.source.title` slug
(e.g. `western-reaches`), because the character builder filters what it offers on
exactly that field. Import a Western Reaches class and it shows up in the builder.

### Import everything

Once your books are uploaded under **Source PDFs**, you do not have to press
Import → Parse → Create two hundred times. The tree's toolbar carries an
**Import everything (N)** button, and opening any folder puts an **Import all N
in <folder>** button at the top of it — the same run, scoped to that branch.

It changes nothing about *how* content is imported. It presses the same buttons
you would: it seeds each unlock, grabs the cited pages out of your own PDF,
parses them, and commits the preview — entry by entry, through the same parsers
and the same commit paths, including the workspaces that own their own flow
(Class Importer, Spell Importer, Item Builder). What it adds is that it does
them in order, without you.

**What it will not do**, because nobody is watching it:

- **It never overwrites and never deletes.** Every name conflict answers "keep
  what's already there", so a second run over the same library creates nothing
  and duplicates nothing. Re-running it is safe.
- **It never commits something broken.** A table or generator that fails the
  quality check is left in the preview, not written. A class that fails its
  quality check is skipped and named in the report.
- **It never guesses at content you don't have.** A row with no linked source
  PDF, no page citation, or no automated route is reported for you to do by
  hand — never silently skipped.

**Before it runs** it tells you how many entries it will import, split by which
workspace drives each one, and how many rows it can't do unattended. Rows that
one press unlocks together — a whole bestiary spread, the eight boats on WR
p118, a gear price table — count as one entry, so the number is the work, not
the row count. Every *selected* Western Reaches mount (WR pp.116–117) is
likewise one entry: the spread is grabbed once and every requested mount is
parsed and committed through the same Mount importer, rather than once per
mount.

**While it runs** a progress bar shows the entry in flight, with a **Stop**
button that ends the run after the current entry finishes. Toasts are collected
rather than stacking hundreds deep.

**When it finishes** you get a report grouped by outcome: *Imported*, *Nothing
to import*, *Needs your attention*, *Not run (cancelled)*, and *Import these by
hand* — each row with the reason. That report is the thing to read; the summary
toast is just the headline. A mounts batch expands the single WR spread job into
one line **per requested mount** — *created*, *already in your library*, or
*not among the statblocks on those pages* — so a partial parse or a rerun no
longer reports as a single success. The batch toast's denominator counts
**requested entries** (mount names), not jobs.

Content it imported flips from gap to have in the tree straight away — the
censuses are rebuilt once at the end of the run rather than after every entry,
so a long batch doesn't spend its time re-scanning your packs.

---

## The Tools menu

The setup and housekeeping actions live behind **Tools**, out of the way of the
everyday paste-and-commit loop.

![The Tools dropdown: Source PDFs and Extract from PDF, then Export bundle and
Import bundle below a divider](images/tools-dropdown.png)

Two groups: working with your **book PDFs**, then **backing up the whole suite**.
Each is covered below.

---

## Source PDFs

You can register **your own uploaded PDF** for each book. Once registered:

- **Import buttons deep-link** to the cited page of the cited book, opening in
  Foundry's native PDF viewer.
- **Grab text** pulls the text out of the open page for you, using Foundry's own
  bundled PDF.js. No external tool, and column-aware, so two-column book pages
  come out in reading order instead of interleaved.

Your PDFs stay in your world. **Nothing leaves your machine.**

Manage them from the hub's Tools menu → **Source PDFs**. **Double-click any
linked book there to open it** at page one, for when you just want to read it
instead of jumping to a cite. The rest of the Open-PDF buttons all need a page.

![The Source PDFs library: each book with the file linked to it, and the Book
selector set to "Another book…" with its name field showing](images/source-pdf.png)

Each row is a book and the file currently linked to it. `(default path)` means
the module's expected filename, checked and found, not something you
uploaded. When that file isn't there the row says **file not found** and asks
you to upload your copy.

### Books that aren't Shadowdark's

The list starts with the Core Rulebook, Western Reaches and Cursed Scroll 1–6,
but you aren't limited to them. Pick **➕ Another book…** in the Book selector,
name it, and upload: a third-party adventure, a homebrew supplement, anything
you want to read or pull text from inside Foundry. Your books appear in the
library alongside the rest, open on double-click, and show up in **Extract from
PDF**.

Re-uploading under the same name replaces that book instead of adding a second
entry. To remove one, delete its page from the **Shadowdark Source PDFs**
journal, which is a real journal on purpose, so the library is yours to edit.

---

## Bundle export / import

Also under Tools. Exports the whole suite (every pack the module manages) as a
single JSON file, and imports it back.

The import **validates, skips anything that already exists, and never
overwrites**. It is a way to move your imported library to another world, not a
sync.

---

## Troubleshooting

**Auto put my content in the wrong bucket.**
Set the type explicitly instead of `auto`. The recogniser order is fixed
(hexcrawl → spell → monster → item → table), so an ambiguous block goes to the
first that claims it.

**Half my paste ended up in Skipped.**
Usually a PDF copy artifact: page headers, footers, or column interleaving mixed
into the text. If you registered a source PDF, use **Grab text** instead of
copying from your PDF reader. It is column-aware.

**I received a "Column check" warning during text extraction.**
Extraction warnings are advisory notices alerting you when a detected column cut
might straddle body words or sit unusually close to text. The layout engine
automatically protects lower full-width tables and handles minor font glyph
metric overhangs without warning, but if a warning does appear, compare the
extracted text in the preview against the PDF page before committing to confirm no
words were transposed across columns.

**A table parsed into nonsense rows.**
Messy PDF tables need a parsing recipe. See
[Table Import & Shapes](Table-Import-and-Shapes.md).

**Coin and Gem didn't import with the rest of the gear table.**
On purpose. Both are currency, not equipment — the gear table prints them with
a *Varies* cost because their worth is whatever you say — so the importer never
makes items of them and `Manage > Items > Basic Gear` never lists them. They
appear in **Skipped** with that reason so you can see they were seen. Track
coin on the character sheet's purse and a gem as treasure or loot instead.
An older import that already created them leaves the items in `sde-items`;
delete them from the compendium if you don't want them.

**Import everything imported almost nothing.**
It only runs entries it can actually read from a book you uploaded. Open the
report's *Import these by hand* group — if it says a PDF isn't linked, add that
book under **Tools → Source PDFs** and run it again. Rows with no page citation
(item census gaps) are always hand-pastes.

**Import everything skipped things it already imported.**
That is the design. Every conflict answers "keep what's there", so nothing you
already have is replaced or duplicated. Those rows show up under *Nothing to
import*.

**An entry came back as "needs your attention".**
Its parse failed a quality check, so nothing was written. The report names the
reason. Open that entry's own **Import** button and finish it by hand — the
batch deliberately won't force a broken table or a half-parsed class into your
packs.

**The Manage tree still shows a gap after I imported it.**
The census matches on name and source folder. Confirm the source label you
committed with matches the book. Importing a CS1 monster under a blank source
files it under *Custom*, and the CS1 node stays at zero.

**Re-importing created duplicates.**
It shouldn't. Check the conflict dialog choice. The default *rename the
newcomer* creates a second copy on purpose. Choose *skip* to leave the existing
one alone.

**The hub is slow to open.**
It shouldn't be. Nothing scans until you expand Manage. If it is, collapse the
Manage strip and reopen.

**Class import lost the tables I attached.**
Use the dedicated class workspace, not a plain paste. See
[Class & Spell Importers](Class-and-Spell-Importers.md).

---

**Related:** [Class & Spell Importers](Class-and-Spell-Importers.md) · [Table Import & Shapes](Table-Import-and-Shapes.md) · [Compendium Packs](Compendium-Packs.md) · [Character Builder](Character-Builder.md)
