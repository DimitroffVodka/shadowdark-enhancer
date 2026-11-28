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

**Crawl Bar → Tools → Rumors** (GM only) asks how to give them:

| Give | What you fill in |
|---|---|
| **A random draw** | **How many** (2 by default) and the **Region**: the party's region, when the party token stands on a scanned hex map or the party is travelling (else the last hex it travelled to). **General** gives only Rumors in the Reaches. |
| **Rumors I pick from the tables** | Tick the rumors not yet given, listed by table: Rumors in the Reaches and the party's region open first. Rumors on a locked compendium are shown but can't be ticked; unlock it to give them. |
| **A rumor I write** | The rumor's text and the **Region** whose page it goes on. Pick a region that has a rumor table, or type any name, your own homebrew region included; leave it empty for the General page. Use it for your own adventures, or for what an NPC told the party. |

For all three:

| Field | What it does |
|---|---|
| **Heard by** | The characters who hear them. Ticked: your players' own characters who are online, else the player characters on the active scene, else every player character. |
| **Post them to chat** | Ticked, the rumors go into one chat card for everyone. Untick it to record rumors the players already heard at the table. |

A random draw then:

1. **Troubles first.** Troubles the party hasn't heard of are given before
   any table rumor, oldest first, and marked heard. The book says the party
   hears of trouble "the next time they learn new rumors".
2. **Then the tables, in turn:** the region's table, then Rumors in the
   Reaches, and so on. When one has nothing left, the rest come from the
   other.
3. The rumors go on the ledger, into one chat card for everyone (unless
   **Post them to chat** is unticked), and into the
   [Session Recap](Session-Recap.md) while a session is running.

Rumors you pick or write skip the troubles: they give only what you chose.
They go on the ledger, the chat card and the Session Recap the same way, and
a rumor you pick is marked given on its table, so a random draw never gives
it again.

---

## Never twice

A rumor given once is never given again, anywhere in the world: its row is
marked drawn on the imported table. Opening a rumor table shows what has
been given (the drawn rows) and what is left.

- **Rolled by hand:** a rumor table you roll yourself (its sheet's Roll, the
  sidebar's Draw Result, a macro) marks its row drawn too, so the generator
  won't give it. It isn't added to the ledger.
- **Reset** on a table's sheet makes its rumors available again.
- **Re-importing** a rumor table makes its rows new. Rows already given from
  it still count as given; the generator matches them by the ledger. Those
  rows stay given even after a Reset.
- **A table that won't take the change.** If a rumor goes on the Rumors Heard
  journal but its table refuses to mark it drawn, you're told so, and it
  still counts as given: no draw or pick gives it again, and the next rumor
  given from that table marks it. Like a re-imported row, it stays given
  even after a Reset.
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
- **Quests from rumors.** Every rumor you give also gets a **Hidden** quest in
  the [Quest Log](Quest-Log.md), for you alone: its text is the quest's
  description and it links back to the rumor's page. Players never see a
  Hidden quest. Move one to **Available** when you want to offer it. Turn
  this off with **Draft a quest for each rumor given** in Configure Settings.
  - **From rumors**, in the Quest Log's header, drafts the same Hidden quests
    for rumors given before this was on. A rumor whose quest you deleted is
    left without one. When every rumor already has a quest, it takes you to
    those Hidden quests while one of them is still Hidden, and otherwise only
    says so.
  - **Promote to quest.** Each rumor also has a button, for the GM only, that
    makes an **Available** quest at once. Once a rumor has a quest, the button
    opens that quest in the Quest Log.
  - A rumor about a trouble uses the trouble itself, so completing the quest
    resolves the trouble. That quest links to the trouble's page, which only
    GMs see.

---

## For macros and modules

`game.shadowdarkEnhancer.rumors.give({ count, region, heardBy })`,
`rumors.tell({ text, region })`, `rumors.pick({ results })` and
`rumors.heard({ region })`; the hook `shadowdark-enhancer.rumorsChanged`.
See `docs/API.md`.
