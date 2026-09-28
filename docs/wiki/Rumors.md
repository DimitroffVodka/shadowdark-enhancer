# Rumors

[← Wiki home](index.md)

The Western Reaches GM Guide's rumor tables, given out so nothing is heard
twice, and a **Rumors Heard** journal your players can read: everything they
have heard, where, and when.

---

## What it needs

The rumor tables from the GM Guide, imported through the Importer Hub:
**Rumors in the Reaches** (d100) and each region's own (*Sablewood Rumors*,
*The Last Sea Rumors*, and so on). Troubles come from the
[Trouble Tracker](Trouble-Tracker.md) when you use it.

---

## Giving rumors

**Crawl Bar → Forge & Loot → Give Rumors…** (GM only) asks:

| Field | What it does |
|---|---|
| **How many** | Rumors to give (2 by default). |
| **Region** | The party's region, when the party token stands on a scanned hex map or the party is travelling (else the last hex it travelled to). **None** gives only Rumors in the Reaches. |
| **Heard by** | The characters who hear them. Ticked: your players' own characters who are online, else the player characters on the active scene. |

Then:

1. **Troubles first.** Troubles the party hasn't heard of are given before
   any table rumor, oldest first, and marked heard. The book says the party
   hears of trouble "the next time they learn new rumors".
2. **Then the tables, in turn:** the region's table, then Rumors in the
   Reaches, and so on. When one has nothing left, the rest come from the
   other.
3. The rumors go on the ledger, into the Session Recap, and into one chat
   card for everyone.

---

## Never twice

A rumor given once is never given again, anywhere in the world: its row is
marked drawn on the imported table. Opening a rumor table shows what has
been given (the drawn rows) and what is left.

- **Rolled by hand:** a rumor table you roll yourself from its sheet or the
  sidebar marks its row drawn too, so the generator won't give it. It isn't
  added to the ledger.
- **Reset** on a table's sheet makes its rumors available again.
- **Re-importing** a rumor table makes its rows new. Rows already given from
  it still count as given; the generator matches them by the ledger.
- The tables are the ones in the module's compendium; a copy of one in your
  world's Roll Tables is a separate pool.
- When the tables run out, it gives what it can and says so.

---

## The Rumors Heard journal

One journal entry, **Rumors Heard**, with a **General** page (Rumors in the
Reaches) and a page per region. Each rumor shows its text, the in-game date
and the real date it was heard, and who heard it, newest first.

- **Players can read it, and only GMs can edit it.**
- **The pages are rewritten** from the rumors given each time one is added,
  so edits you make to a page are replaced. A GM-only line on each page says
  so. Adjust who heard a rumor in the dialog before giving it.
- **Promote to quest.** Each rumor has a button, for the GM only, that makes
  an Available quest in the [Quest Log](Quest-Log.md). The quest links back
  to the rumor's page. Once a rumor has a quest, the button opens the Quest Log.
  - A rumor about a trouble promotes the trouble itself, so completing the
    quest resolves the trouble. That quest links to the trouble's page,
    which only GMs see.

---

## For macros and modules

`game.shadowdarkEnhancer.rumors.give({ count, region, heardBy })` and
`rumors.heard({ region })`; the hook `shadowdark-enhancer.rumorsChanged`.
See `docs/API.md`.
