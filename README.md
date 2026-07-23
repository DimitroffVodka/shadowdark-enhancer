<div align="center">

# Shadowdark Enhancer

**A GM companion suite for [Shadowdark RPG](https://www.thearcanelibrary.com/pages/shadowdark) on Foundry VTT.**

[![Foundry](https://img.shields.io/badge/Foundry-v13%2B-informational)](https://foundryvtt.com)
[![System](https://img.shields.io/badge/Shadowdark-v3.6.2%2B-brightgreen)](https://foundryvtt.com/packages/shadowdark)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[Install](#install) · [Features](#what-it-does) · [**Full documentation →**](docs/wiki/Home.md)

</div>

![The Crawl Strip — live HP, movement, Luck and AC for the whole party](docs/wiki/images/crawl-strip.png)

---

Run a crawl without opening a single character sheet.

Shadowdark Enhancer started as a top-anchored **Crawl Strip** — marching order,
initiative, and live HP / Movement / Luck for the whole party — and grew into the
rest of the table: random encounters, treasure, a merchant, party XP, a session
recap that writes itself, a guided character builder, and a content importer that
turns a copy-paste from **your own PDF** into real Foundry documents.

Everything runs from one **Crawl Bar** at the top of the canvas.

## Install

Paste this manifest URL into Foundry's **Install Module** dialog:

```
https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json
```

Then enable **Shadowdark Enhancer** in your world's module settings.

| | Minimum | Verified |
|---|---|---|
| Foundry VTT | v13 | **v14.365** |
| Shadowdark RPG system | v3.6.2 | **v4.0.6** |

> **Replacing `shadowdark-crawl-helper`?** Disable it — both draw a party strip
> and both hook combat. You'll get a one-time warning at world load, which can be
> suppressed in settings.

**Recommended, not required:** [shadowdark-extras](https://github.com/DimitroffVodka/shadowdark-extras)
powers the automation on imported spells. They still cast without it; you just
apply the effects by hand.

New install? Start with **[Installation & Setup](docs/wiki/Installation-and-Setup.md)**.

## What it does

Each row links to its full manual page.

### At the table

| | |
|---|---|
| 🧭 **[Crawl Strip & Crawl Bar](docs/wiki/Crawl-Strip-and-Crawl-Bar.md)** | Live HP, movement, Luck, AC and active effects for the whole party. Marching order out of combat, initiative order in it. Per-actor action menus so players can attack and cast without a sheet. |
| 🏃 **[Movement Budgets](docs/wiki/Movement-Budgets.md)** | A coloured ruler while you drag, per-turn allowances, optional refusal of over-budget moves, and one-click rollback to where a token started its turn. |
| ⚔️ **[Random Encounters](docs/wiki/Random-Encounters.md)** | The `1d6` check, a four-tab roller, and result cards that roll appearing count, distance, activity and a `2d6+CHA` reaction — then place the tokens on the map. |
| 💰 **[Loot & Treasure](docs/wiki/Loot-and-Treasure.md)** | Generate a hoard, then post it as a chat card players race to claim or drop it on the ground as pickup-able tokens — no need to pick a recipient. First claim wins, coins land in the right purse. Opt-in loot drops when combat ends. |
| 🏪 **[Merchant Shop](docs/wiki/Merchant-Shop.md)** | A shop that opens for every player at once, backed by a catalog or an NPC's own inventory. Buying and selling against `system.coins`, serialised so nobody double-spends. |
| 🎖️ **[Party XP](docs/wiki/Party-XP.md)** | Award XP to the whole party at once — full amount to each character, per Shadowdark RAW. Flags who's ready to level; never levels anyone itself. |
| 📜 **[Session Recap](docs/wiki/Session-Recap.md)** | A session log that fills itself in — loot, XP, combats, rolls, kills, merchant activity — with a **Copy for Discord** export. Tied to the crawl, so there's no extra button to remember. |

### Building content

| | |
|---|---|
| 📥 **[Importer Hub](docs/wiki/Importer-Hub.md)** | Paste a section from your own PDF. It's recognised, parsed, previewed editably, and committed into managed packs — never overwriting, never deleting, idempotent on re-import. |
| 🧩 **[Class & Spell Importers](docs/wiki/Class-and-Spell-Importers.md)** | Dedicated workspaces for the two hardest types: per-part paste zones for a class's writeup, talent table and titles; spells organised by Class → Tier → Alignment. |
| 📊 **[Table Import & Shapes](docs/wiki/Table-Import-and-Shapes.md)** | 119 tables carry a parsing recipe, so messy PDF copies parse deterministically — prayer generators, wrapped-cell lookups, mix-and-match grids, reflowed pastes. |
| 👹 **[Monster Creator](docs/wiki/Monster-Creator.md)** | Author a Shadowdark creature from scratch or remix an existing one. Quick-pick catalogs, compendium spell search, and a Generator/Mutator driven by your own imported Core tables. |
| ⚖️ **[Monster Level Guidelines](docs/wiki/Monster-Level-Guidelines.md)** | What a level-N monster should look like, derived from the bestiary rather than guessed. Re-level any creature from its token with a preview, per-stat checkboxes and a full undo. |
| 🖼️ **[Monster Token Art](docs/wiki/Monster-Token-Art.md)** | Re-skin the bestiary with art you already own, **referenced by path and never copied or bundled**. Sources auto-discovered, drag to prioritise, browse 2,000+ tokens by hand. |
| 🔨 **[Magic Item Forge](docs/wiki/Magic-Item-Forge.md)** | Roll or hand-build magic items. Only a whole-result `+N` becomes a real mechanic — everything else stays honest descriptive text. |

### Characters

| | |
|---|---|
| 🧙 **[Character Builder](docs/wiki/Character-Builder.md)** | A guided, ordered replacement for the system's all-random generator. Seven steps, a complete level-1 character, every roll posted to chat as an audit trail. Players can use it without any file permissions. |
| 📄 **[Export to PDF](docs/wiki/Export-to-PDF.md)** | Fill a real form-fillable Shadowdark sheet from an actor. Entirely local — nothing is uploaded anywhere. |
| 🐴 **[Mounts & Boats](docs/wiki/Mounts-and-Boats.md)** | Two Actor sub-types with dedicated sheets for Western Reaches mounts, warbands, boats and siege vehicles. |

---

## Bring your own books

The module ships **no sourcebook prose**. For the *Cursed Scrolls*, the Core
rules, and the *Player's Guide to the Western Reaches* it knows the **structure**
of the content you own — names, page citations, dice formulas, table layout — and
nothing else. Nothing is encrypted; there is simply no text to ship.

**You supply every word** by pasting from your own PDF. The module recognises it,
runs the right parsing recipe, remaps links, and files it. Content the Shadowdark
system already ships is skipped — you already have it.

Register your own PDF per book and the importer will **deep-link to the cited
page** inside Foundry's viewer and extract the text for you, column-aware. Your
PDFs never leave your machine.

## Your data

- **Everything the module creates is an ordinary Foundry document.** Disable the
  module and your content stays readable.
- **Nothing is overwritten silently, and nothing is ever deleted.** The module
  does not call `deleteCompendium`.
- **Every document-creating entry point is GM-only.**
- **No artwork is redistributed.** Token art is referenced from what you have
  installed, by path.

See **[Compendium Packs](docs/wiki/Compendium-Packs.md)**.

## For module developers

A versioned public API at `game.shadowdarkEnhancer`, mirrored at
`game.modules.get("shadowdark-enhancer")?.api`:

```js
Hooks.once("shadowdarkEnhancer.ready", (api) => {
  console.log("SDE API", api.apiVersion); // "1.0.0"
});
```

Namespaces: `import` · `items` · `monsters` · `linker` · `encounter` · `loot` ·
`tables` · `bundle` · `mutator` · `monsterCreator` · `tokenArt` · `forge` ·
`charBuilder` · `merchant` · `partyXp` · `recap`

Full reference: **[docs/API.md](docs/API.md)**.

## Documentation

**[📖 The wiki](docs/wiki/Home.md)** — a manual page per feature, with settings,
walkthroughs and troubleshooting.

| | |
|---|---|
| [Installation & Setup](docs/wiki/Installation-and-Setup.md) | First-run checklist |
| [Settings Reference](docs/wiki/Settings-Reference.md) | Every setting and its real default |
| [Troubleshooting](docs/wiki/Troubleshooting.md) | Symptoms → causes → fixes |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [CREDITS.md](CREDITS.md) | Third-party assets and licences |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the test gates, and the content/docs contracts |

## Contributing

Bug reports and pull requests are welcome — see
**[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, the two gate commands, the
Foundry-specific things that catch people out, and the content contract this
module holds itself to.

## Localization

**English-only by design.** `languages/en.json` exists and some templates use
`localize`, but full string extraction is deliberately deferred: much of the UI
renders GM-imported book content verbatim, so translated chrome around
untranslated content buys little. Contributions should not add translation keys
for their own sake — plain English strings are the house style until a real
localization pass is scheduled.

## License

MIT — see [LICENSE](LICENSE).

Shadowdark RPG is © The Arcane Library. This module is an unofficial,
independent work and is not affiliated with or endorsed by The Arcane Library.
