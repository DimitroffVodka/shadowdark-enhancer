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
