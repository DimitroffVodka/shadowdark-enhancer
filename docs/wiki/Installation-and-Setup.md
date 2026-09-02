# Installation & Setup

[← Wiki home](index.md)

---

## Requirements

| | Minimum | Verified |
|---|---|---|
| Foundry VTT | v13 | **v14.365** |
| Shadowdark RPG system | v3.6.2 | **v4.0.6** |

**Recommended, not required:** [shadowdark-extras](https://github.com/DimitroffVodka/shadowdark-extras)
(verified 6.10.45). It automates imported spells: creature-type gating,
effect application, and break-on-damage. Spells still cast without it; you
just apply their effects by hand.

## Install

Paste this manifest URL into Foundry's **Install Module** dialog:

```
https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json
```

Then enable **Shadowdark Enhancer** in **Game Settings → Manage Modules**.

> **Replacing `shadowdark-crawl-helper`?** Disable it. Both modules draw a party
> strip and hook combat, so running them together produces duplicate UI and
> conflicting initiative state. The module warns you once at world load if
> Crawl Helper is active. You can suppress that warning in settings.

## What happens the first time you load a world

Everything here runs automatically for the active GM:

| On load | What it does |
|---|---|
| **Actor sub-types registered** | **Mount** and **Boat** appear in Create Actor. See [Mounts & Boats](Mounts-and-Boats.md). |
| **Crawl Strip & Crawl Bar appear** | Pinned to top of canvas. See [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md). |
| **Default merchants seeded** | Seeds *Base* and *Western Reaches* shops. See [Merchant Shop](Merchant-Shop.md). |
| **Loot setup nudge** | Alerts you once if fewer than four loot tiers are bound. See [Loot & Treasure](Loot-and-Treasure.md). |
| **Spell ↔ class re-link** | Links imported spells to their caster classes on load. Silent when up to date. |
| **Monster backfills after update** | Upgrades `sde-actors` across versions (cleanup, notes, taxonomy). Active-GM only. |

Compendium packs are **not** created until you need them. Your first import
creates them on demand. See [Compendium Packs](Compendium-Packs.md).

## First-session checklist

Follow these steps in order. Only the first is required to get started.

### 1. Decide your movement rules

Go to **Configure Settings → Shadowdark Enhancer**.

Defaults are deliberately permissive: the strip flags over-budget movement
in red, but does not block token movement.

| Setting | Default |
|---|---|
| Combat movement default (ft) | `30` |
| Out-of-combat movement budget (ft) | `90` |
| Enforce out-of-combat movement budget | **off** |
| Enforce combat movement budget | **off** |

Turn enforcement on if you want over-budget moves rejected instead of flagged.
Combat enforcement defaults to off because Shadowdark combat traditionally
runs on player honesty. Details in [Movement Budgets](Movement-Budgets.md).

### 2. Set your encounter threshold

The encounter check rolls `1d6` and hits on a result at or below your threshold
(default `1`). You configure this directly from the Crawl Bar's encounter menu
rather than the settings window. See [Random Encounters](Random-Encounters.md).

### 3. Point the loot generator at real tables

Out of the box, the Loot Generator has no treasure tables bound because the
module ships no copyright text. Open **Loot Generator → Set up loot tables**
and bind a table for each tier. If you imported the system's *Treasure 0–3*
tables, Loot Setup binds them in one click. See [Loot & Treasure](Loot-and-Treasure.md).

### 4. Choose the character-builder ability method

If your players will use the [Character Builder](Character-Builder.md), pick
your ability generation method now. It is GM-dictated and shown read-only to
players. The default is *3d6, reroll if none ≥ 14*.

### 5. Import the content you own

This step is optional. The module works out of the box with the core system.
If you own *Cursed Scroll* zines or the *Player's Guide to the Western Reaches*,
the [Importer Hub](Importer-Hub.md) converts copy-pasted PDF text into
native Foundry documents.

## Disabling or uninstalling

Disabling the module leaves all your created content intact: `sde-*` world
compendiums, actors, items, tables, and characters built with the wizard remain
ordinary Foundry documents. Nothing uses a locked proprietary format.

The module never calls `deleteCompendium`. If you want packs removed, you delete
them yourself from Foundry's compendium sidebar.

## Permissions

| Action | Who can do it |
|---|---|
| Creating or modifying documents | **GM only** |
| Character Builder | All users (unprivileged players hand off creation to the GM over sockets) |
| Export to PDF | The character's **owner** or a GM |
| Spending Luck, claiming loot, buying from shop | Players on characters they own |
| Encounter checks | GM only by default (`Roll Encounters as GM-only`) |

---

**Next:** [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) · [Settings Reference](Settings-Reference.md)
