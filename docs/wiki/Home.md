# Shadowdark Enhancer — Wiki

A GM companion suite for [Shadowdark RPG](https://www.thearcanelibrary.com/pages/shadowdark)
on Foundry VTT.

This wiki is the full manual. The [README](../../README.md) is the short pitch;
everything below is the detail.

---

## Start here

If you have just installed the module, read these three in order:

1. **[Installation & Setup](Installation-and-Setup.md)** — install, first-run
   checklist, what to turn on before your first session.
2. **[Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md)** — the always-on
   party display and the bar every other tool launches from.
3. **[Compendium Packs](Compendium-Packs.md)** — where the module keeps content
   it creates, and the never-overwrite rules it follows.

Everything else can wait until you need it.

---

## At the table

Tools you use while a session is running.

| Page | What it covers |
|---|---|
| [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) | Party HP / movement / Luck at a glance, marching order, crawl turns, the combat HUD |
| [Movement Budgets](Movement-Budgets.md) | Per-turn movement allowances, over-budget enforcement, rollback to turn start |
| [Random Encounters](Random-Encounters.md) | The `1d6` encounter check, the Encounter Roller, placing the result on the map |
| [Loot & Treasure](Loot-and-Treasure.md) | Hoard generation, claimable chat cards, opt-in loot drops on combat end, coin piles |
| [Merchant Shop](Merchant-Shop.md) | A shop window open to every player at once, buying and selling against `system.coins` |
| [Party XP](Party-XP.md) | Awarding XP to the whole party, Shadowdark treasure-XP rules |
| [Session Recap](Session-Recap.md) | Automatic session log — loot, XP, combats, rolls, kills — with a Discord export |

## Building content

Tools you use in prep, between sessions.

| Page | What it covers |
|---|---|
| [Importer Hub](Importer-Hub.md) | The single front door: paste from your own PDF, preview, commit into the suite packs |
| [Class & Spell Importers](Class-and-Spell-Importers.md) | The two dedicated workspaces for the hardest content types |
| [Table Import & Shapes](Table-Import-and-Shapes.md) | How messy PDF tables are parsed deterministically, and how to add a recipe |
| [Monster Creator](Monster-Creator.md) | Author a Shadowdark NPC from scratch, or remix an existing one |
| [Monster Level Guidelines](Monster-Level-Guidelines.md) | What a level-N monster should look like — the editable table, and the token button that re-levels a creature |
| [Monster Token Art](Monster-Token-Art.md) | Re-skin the bestiary using art you already own — referenced, never copied |
| [Magic Item Forge](Magic-Item-Forge.md) | Roll or hand-build magic items, including from your own imported Core tables |

## Characters

| Page | What it covers |
|---|---|
| [Character Builder](Character-Builder.md) | The guided, ordered level-1 character creation wizard |
| [Export to PDF](Export-to-PDF.md) | Fill a real Shadowdark character sheet PDF from an actor |
| [Mounts & Boats](Mounts-and-Boats.md) | The Mount and Boat actor sub-types and their sheets |

## Reference

| Page | What it covers |
|---|---|
| [Settings Reference](Settings-Reference.md) | Every setting, its default, and what it actually does |
| [Compendium Packs](Compendium-Packs.md) | `sde-actors` / `sde-items` / `sde-tables`, and the content contract |
| [Troubleshooting](Troubleshooting.md) | Symptoms, causes, fixes |
| [API for developers](../API.md) | `game.shadowdarkEnhancer` — the public, versioned surface |

---

## Two things worth knowing up front

**You bring your own books.** The module ships no sourcebook prose. For the
*Cursed Scrolls* and the *Player's Guide to the Western Reaches* it knows the
**structure** of the content — names, page citations, dice formulas, table
layouts — and nothing else. You paste the text from your own PDF and the module
parses and files it. See [Importer Hub](Importer-Hub.md).

**Nothing is overwritten or deleted.** Every document-creating entry point is
GM-only and follows a never-overwrite, never-delete contract. Re-importing the
same content is idempotent. See [Compendium Packs](Compendium-Packs.md).

---

## Getting help

- **Bugs and feature requests:** [GitHub issues](https://github.com/DimitroffVodka/shadowdark-enhancer/issues)
- **Release history:** [CHANGELOG.md](../../CHANGELOG.md)
- **Credits and third-party assets:** [CREDITS.md](../../CREDITS.md)
