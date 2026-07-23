# Installation & Setup

[← Wiki home](Home.md)

---

## Requirements

| | Minimum | Verified |
|---|---|---|
| Foundry VTT | v13 | **v14.365** |
| Shadowdark RPG system | v3.6.2 | **v4.0.6** |

**Recommended, not required:** [shadowdark-extras](https://github.com/DimitroffVodka/shadowdark-extras)
(verified 6.10.45). It powers the automation on imported spells — creature-type
gating, effect application, break-on-damage. Spells still cast without it; you
just apply their effects by hand.

## Install

Paste this manifest URL into Foundry's **Install Module** dialog:

```
https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json
```

Then enable **Shadowdark Enhancer** in **Game Settings → Manage Modules**.

> **Replacing `shadowdark-crawl-helper`?** Disable it. Both modules draw a party
> strip and both hook combat, so running them together produces duplicate UI and
> conflicting initiative state. The module shows a one-time warning at world load
> if it detects Crawl Helper active; you can suppress that warning with the
> **Warn when shadowdark-crawl-helper is enabled** setting.

## What happens the first time you load a world

All of this is automatic and GM-only. You do not have to do anything.

| On load | What it does |
|---|---|
| **Actor sub-types registered** | The **Mount** and **Boat** actor types become available in the Create Actor dialog. See [Mounts & Boats](Mounts-and-Boats.md). |
| **Crawl Strip & Crawl Bar appear** | Pinned to the top of the canvas. See [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md). |
| **Default merchants seeded** | Two saved merchants — *Base* (core system gear) and *Western Reaches* (base + enhancer items). Idempotent; the WR merchant fills in once its item pack exists. See [Merchant Shop](Merchant-Shop.md). |
| **Loot setup nudge** | If fewer than four treasure-tier tables are bound, you get a one-time notification pointing you at the Loot Generator's **Set up loot tables**. Shown once per world. See [Loot & Treasure](Loot-and-Treasure.md). |
| **Spell ↔ class re-link** | A cheap index scan that links imported spells to their caster class, whichever was imported first. Runs every load, silent when there is nothing to do. |
| **Monster backfill after an update** | When the module version changes, already-imported monsters are quietly brought up to current import fidelity (icons, casing, spell items, art). Deferred 5 s, idempotent, non-destructive, and only the single active GM runs it. |

Compendium packs are **not** created until something needs them — the first
import creates them on demand. See [Compendium Packs](Compendium-Packs.md).

## First-session checklist

Do these in order. Only the first is genuinely required.

### 1. Decide your movement rules

**Configure Settings → Shadowdark Enhancer.**

The defaults are deliberately permissive — the strip *shows* movement in red when
someone goes over, but does not stop them:

| Setting | Default |
|---|---|
| Combat movement default (ft) | `30` |
| Out-of-combat movement budget (ft) | `90` |
| Enforce out-of-combat movement budget | **off** |
| Enforce combat movement budget | **off** |

Turn enforcement on if you want over-budget moves *refused* rather than merely
flagged. Combat enforcement is off by default on purpose: Shadowdark combat
traditionally runs on player honesty. Details in
[Movement Budgets](Movement-Budgets.md).

### 2. Set your encounter threshold

The encounter check rolls `1d6` and hits on a result at or below the threshold
(default `1`). It lives on the Crawl Bar's encounter menu, not in the settings
window. See [Random Encounters](Random-Encounters.md).

### 3. Point the loot generator at real tables

Out of the box the Loot Generator has no treasure tables bound — the module ships
none, because they are book content. Open the **Loot Generator → Set up loot
tables** and bind a table per treasure tier. If you have imported the system's
*Treasure 0–3* tables, Loot Setup binds them in one click.
See [Loot & Treasure](Loot-and-Treasure.md).

### 4. Choose the character-builder ability method

If your players will use the [Character Builder](Character-Builder.md), pick the
ability-generation method now — it is **GM-dictated** and shown read-only to
players. Default is *3d6, reroll if none ≥ 14*.

### 5. Import the content you own

This is the big one, and it is optional — the module is fully usable with just
the system's own content. If you own the *Cursed Scrolls* or the *Player's Guide
to the Western Reaches*, the [Importer Hub](Importer-Hub.md) turns a copy-paste
from your PDF into real Foundry documents.

## Uninstalling / disabling

Disabling the module leaves everything it created in place — the `sde-*` world
compendiums, the actors, items and tables inside them, and any characters built
with the builder are all ordinary Foundry documents. Nothing is stored in a
format only this module can read.

The module never calls `deleteCompendium`. If you want the packs gone you delete
them yourself.

## Permissions

| Action | Who can do it |
|---|---|
| Everything that creates or modifies documents | **GM only** |
| Character Builder | Every user (players without actor-create permission are handed off to the GM over the socket automatically) |
| Export to PDF | The character's **owner**, or a GM |
| Spending Luck, claiming loot, buying from a merchant | Players, on characters they own |
| Encounter checks | GM only by default (`Roll Encounters as GM-only`) |

---

**Next:** [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) · [Settings Reference](Settings-Reference.md)
