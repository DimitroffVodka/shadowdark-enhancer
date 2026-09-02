# Shadowdark Enhancer Wiki

A GM companion suite for [Shadowdark RPG](https://www.thearcanelibrary.com/pages/shadowdark)
on Foundry VTT.

This wiki is your complete manual. The [README](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/README.md)
gives you the quick summary, while everything below covers the details.

---

## Start here

If you just installed the module, read these three in order:

1. **[Installation & Setup](Installation-and-Setup.md)**: install steps,
   first-run checklist, and what to configure before your first session.
2. **[Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md)**: the always-on
   party display and the launcher bar for your table tools.
3. **[Compendium Packs](Compendium-Packs.md)**: where your created content lives
   and the never-overwrite rules the suite follows.

Everything else can wait until you need it at the table or during prep.

---

## At the table

Tools you run during an active game session.

| Page | What it covers |
|---|---|
| [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) | Party HP, movement, and Luck at a glance, marching order, crawl rounds, combat HUD |
| [Movement Budgets](Movement-Budgets.md) | Turn movement allowances, over-budget warnings or enforcement, rollback to turn start |
| [Random Encounters](Random-Encounters.md) | The `1d6` encounter check, the Encounter Roller, placing results directly on the map |
| [Loot & Treasure](Loot-and-Treasure.md) | Hoard rolls, claimable chat cards, opt-in loot drops on combat end, coin piles |
| [Merchant Shop](Merchant-Shop.md) | A live shop window for the whole party, buying and selling against `system.coins` |
| [Party XP](Party-XP.md) | Whole-party XP awards and Shadowdark treasure-XP rules |
| [Downtime](Downtime.md) | Between-crawl activities, the DC step-down ladder, per-attempt costs from your books |
| [Renown](Renown.md) | The fame track, its four bands, reaction-roll bonuses, awarding and docking points |
| [Pit Fighting](Pit-Fighting.md) | Cursed Scroll 2 bouts: venues, stakes scaled to party level, danger calls, twists |
| [Session Recap](Session-Recap.md) | Automatic session log (loot, XP, combats, rolls, kills) with Discord export |

## Building content

Tools you use in prep between sessions.

| Page | What it covers |
|---|---|
| [Importer Hub](Importer-Hub.md) | The front door: paste from your own PDF, preview, commit into suite compendiums |
| [Class & Spell Importers](Class-and-Spell-Importers.md) | Dedicated workspaces for complex class and spell statblocks |
| [Table Import & Shapes](Table-Import-and-Shapes.md) | How PDF tables parse deterministically and how to add parsing recipes |
| [Monster Creator](Monster-Creator.md) | Author a Shadowdark monster or NPC from scratch, or remix an existing statblock |
| [Monster Spell Library](Monster-Spell-Library.md) | Extract embedded monster spells into a searchable GM library with source links |
| [Monster Level Guidelines](Monster-Level-Guidelines.md) | Target stats for level-N monsters: editable baseline table and token re-leveling |
| [Monster Token Art](Monster-Token-Art.md) | Re-skin your bestiary using token art you already own, referenced and never copied |
| [Magic Item Forge](Magic-Item-Forge.md) | Roll or hand-build magic items using imported Core tables |
| [Forge & Loot](Forge-and-Loot.md) | Developer preview shell for planned NPC and Rival Crawler generation (console only) |

## Characters

| Page | What it covers |
|---|---|
| [Character Builder](Character-Builder.md) | Guided, ordered level-1 character creation wizard with token art gallery |
| [Export to PDF](Export-to-PDF.md) | Fill and download official Shadowdark character sheet PDFs directly from an actor |
| [Mounts & Boats](Mounts-and-Boats.md) | Dedicated Mount and Boat actor types and sheets for Western Reaches travel |

## Reference

| Page | What it covers |
|---|---|
| [Settings Reference](Settings-Reference.md) | Every setting, default value, and what it does in your world |
| [Compendium Packs](Compendium-Packs.md) | `sde-actors`, `sde-items`, `sde-tables`, and the content contract |
| [Troubleshooting](Troubleshooting.md) | Symptoms, causes, and fixes for common table issues |
| [API for developers](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md) | `game.shadowdarkEnhancer` public scripting API |

---

## Two things worth knowing up front

**You bring your own books.** The module ships no copyright sourcebook prose.
For *Cursed Scroll* zines and the *Player's Guide to the Western Reaches*, it
understands the **structure** of the content (names, page citations, dice
formulas, table layouts). You paste text from your own PDF, and the module
parses and files it into Foundry documents. See [Importer Hub](Importer-Hub.md).

**Nothing is overwritten or deleted.** Every document-creating entry point is
GM-only and follows a strict never-overwrite, never-delete contract. Re-importing
the same content is idempotent and safe. See [Compendium Packs](Compendium-Packs.md).

---

## Getting help

- **Bugs and feature requests:** [GitHub issues](https://github.com/DimitroffVodka/shadowdark-enhancer/issues)
- **Release history:** [CHANGELOG.md](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/CHANGELOG.md)
- **Credits and third-party assets:** [CREDITS.md](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/CREDITS.md)
