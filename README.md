# Shadowdark Enhancer

A GM companion suite for **[Shadowdark RPG](https://www.thearcanelibrary.com/pages/shadowdark)** on Foundry VTT.

It started as a top-anchored **Crawl Strip** — marching order, initiative, and at-a-glance HP / Movement / Luck for the whole party — and has grown into a full toolkit for running a crawl: random encounters, a paste-a-PDF content importer, treasure & magic-item generation, a merchant shop, party XP, a session recap, a guided character builder, and mount/boat vehicle sheets. Everything is driven from a single **Crawl Bar** that lives at the top of the canvas.

> Replaces `shadowdark-crawl-helper`. If you have Crawl Helper enabled you'll get a one-time warning at world load — disable it for best results (the warning can be suppressed in settings).

## Requirements

| | Minimum | Verified |
|---|---|---|
| Foundry VTT | v13 | **v14.364** |
| Shadowdark RPG system | v3.6.2 | **v4.0.6** |

## Installation

Paste this manifest URL into Foundry's **Install Module** dialog:

```
https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json
```

Then enable **Shadowdark Enhancer** in your world's module settings.

---

## Features

### 🧭 Crawl Strip & Crawl Bar

A slim strip pinned to the top of the canvas, with a control **Crawl Bar** for the GM.

- **Out of combat (crawl mode):** players roll for marching order; a turn counter tracks crawl turns. Each card shows the character's live HP, movement used vs. budget, and Luck.
- **In combat:** one card per combatant in initiative order, round/turn pulled live from Foundry's tracker. Respects the system's *Clockwise Initiative* setting automatically.
- **Per-card cells:**
  - **HP** — `attributes.hp.value/max`; turns red at 0 or below.
  - **Movement** — live used-vs-budget; turns red when over. Default **30 ft** per combatant per turn in combat, **90 ft** per crawl turn out of combat.
  - **Luck** — clickable pips for PCs; click a filled pip to spend a Luck token. NPCs show `—`.
  - **AC** and **active-effect icons** render inline.
  - **GM avatar** — the strip's GM face is configurable: click the portrait (or set it in settings) to pick the image shown for the GM.
- **Movement budget enforcement:** out-of-combat over-budget moves are refused before they commit (toggleable); combat enforcement is opt-in. Turn-start positions are captured so a token can be **rolled back to its turn-start position** from the per-combatant HUD.
- **Combat HUD dropdown** on the active card: HP ±1/±5, Spend Luck, Open Sheet, and Rollback-to-turn-start.

The Crawl Bar changes with mode: **Start Crawl** → *Next Turn*, *Begin Encounter / Start Combat*, add selected tokens, plus the tool launchers below. Right-click actions expose extras (e.g. reset out-of-combat initiative; the encounter check menu).

### ⚔️ Random Encounters

- **Encounter check** — rolls `1d6` against an adjustable threshold and posts a HIT/MISS chat card (Dice So Nice fires). On a hit the game can auto-pause, open the roller, and auto-roll the active table.
- **Encounter Roller** — a multi-tab window to roll the active table, browse and filter NPC sources, build your own encounter tables (drag NPCs onto numbered die slots), and author NPCs in the **Monster Creator** (below).
- **Result cards** roll appearing count, distance, activity, and a 2d6+CHA **reaction**, then let you **Post** to chat or **Place** tokens on the canvas (grid-snapped, ESC to cancel). Flavor-only table rows are handled cleanly.

### 👹 Monster Creator

The Encounter Roller's fourth tab is a full NPC authoring panel — build a Shadowdark creature from scratch, remix an existing one, and save it as a real world Actor. Drafts persist when you switch tabs.

- **Every stat-block section is editable:** Identity (name, L/N/C alignment, level), Stats (HP, AC with note, dark-adapted, six ability modifiers), Movement (system move type + free-text note), Spellcasting (ability, spell bonus, spells/round), Actions, Features, and Description.
- **Attacks & specials** are added as removable rows, with a **12-entry quick-pick catalog** (Fist, Bite, Longsword, Breath Weapon, Poison, …) that deep-clones a preset on click — custom entries welcome too.
- **Features** work the same way, with a **14-entry quick-pick catalog** (Magic Resistance, Pack Tactics, Regenerate, Undead, …).
- **Spells** attach via a debounced compendium search + tier filter, shown as removable chips.
- **Portrait & token art** are set through Foundry's FilePicker; leaving token art empty inherits the portrait.
- **Bestiary loader** searches and loads any world or compendium NPC into the draft — the fast path for making variants of an existing creature (with smart art resolution for community token mappings).
- **Generator & Mutator** — reads *your own imported* Core Rulebook *Monster Generator* (d20 × 4 columns) and *Make It Weird* monster-mutations (d12 × 3 columns) tables from the managed pack; each set unlocks independently once all its columns are imported and valid. Roll or pick results per column, then apply them as **descriptive NPC Features only** (stats, attacks, movement, and spellcasting are never changed) or spawn a variant copy. Missing/ambiguous/invalid sets show what to fix and a one-click import.
- **Bulk import** shortcut opens the paste-to-create monster importer.
- **Save** validates the name, creates a `type: "NPC"` world Actor, and embeds the Attack / Special / Feature / Spell items. Open it headlessly with `game.shadowdarkEnhancer.monsterCreator.open()`.

### 🖼️ Monster Token Art

A GM-only **Monster Art** button on the Actors sidebar opens a manager that re-skins the `shadowdark.monsters` compendium through Foundry's core compendium-art system. It **references token art you already have installed — by path — and never copies or bundles any artwork**, so nothing here is redistributed.

- **Sources auto-discovered** from whatever's installed: **Monster Manual** (with its dynamic ring and per-token scale), **Pathfinder/Paizo** (`pf2e-tokens`, plus any `pf2e-tokens-*` module and the 59 pf2e **iconic** PC/companion portraits), **Forgotten Adventures** (`dnd5e`), and **Community Tokens**. A source you don't own simply doesn't appear.
- **Drag to order source priority**, or override the art **per monster**; the chosen blend is written and injected at runtime — no world relaunch. Apply, re-skin already-placed tokens, or turn it off.
- **Imported monsters get art too** — the overlay skins the enhancer's own imported-monsters pack (`sde-actors`, or the legacy `world.shadowdark-enhancer--actors`) alongside `shadowdark.monsters`, so Cursed Scroll / Western Reaches monsters you import can carry token art like the base bestiary.
- **Visual image browser** — a **Browse** button on every monster opens a searchable grid of *every* installed token (2,000+ files across all sources), grouped by source with sticky headers, zoomable (slider / `Ctrl`+scroll / `Ctrl ±` / `Ctrl 0`), and filterable as you type — so a monster with no name-match can still be skinned by hand. A hand-picked image wins over source priority.
- **Correct per-source presentation** — dynamic ring and fill scale are inherited so large art fills its footprint and flat art sits right.
- **Semantic aliases** map Shadowdark's reflavoured monsters to the right art (Brain Eater → Mind Flayer, Stingbat → Stirge, Grimlow → Grimlock, …); Shadowdark-original creatures are pinned to Community art. Scriptable via `game.shadowdarkEnhancer.tokenArt`.

### 📥 Importer Hub

A single ApplicationV2 front door for getting Shadowdark content into your world — **one scrolling view, no tabs**. Paste a PDF dump and it segments it into typed buckets (monsters, items, spells, tables, character content), previews them editably, and commits with rename/replace/skip conflict handling into the managed **suite packs** (`sde-actors` / `sde-items` / `sde-tables`). Nothing is ever silently overwritten or deleted. Imported tables are auto-enriched with `@UUID` monster/item links and inline-roll counts.

- **Manage review tree** — a collapsible, browsable folder/sub-folder tree that reconciles a manifest of what each *Cursed Scroll* (CS1–CS6), the Core rules, and the *Player's Guide to the Western Reaches* contain against your world, marking every entry **have / gap**. It scans lazily (opening the hub never scans the world) and every missing entry carries an **Import** button that seeds the paste box with the right type and source. Suite-wide tools live here too: bundle export/import and the source-PDF library — table re-linking and the monster backfill run **automatically** (after each import commit, and once per module version on load), so there are no manual maintenance buttons to press.
- **Dedicated Class Importer workspace** — classes (the most complex type) get a guided single-view workspace: the class is pinned at the top, **Stage 1** pastes the writeup, **Stage 2** has per-part paste zones for the talent table, titles (hand-editable band editor), spells-known, and extra tables — any paste is routed to the right slot automatically. Re-importing just the writeup no longer erases the attached tables.
- **Dedicated Spell Importer workspace** — spells import organized by **Class → Tier → Alignment** ("druid spells are Wizard spells with Neutral alignment"), writing the alignment flag the char-builder's spell picker filters on.
- **Source-PDF deep links** — Import buttons and the Class Importer open **your own uploaded PDF** of the cited book at the cited page inside Foundry's native viewer; a **Source PDFs** manager links a PDF per book (files stay in your world — nothing leaves your machine).
- **Shape-directed table parsing** — each unlockable table can carry a parsing recipe so messy PDF copies parse deterministically: prayer generators (3d6 compounds, cartesian-expanded to a flat table), Carousing lookups (wrapped cells, cost-indexed rows), grid shapes for mix-and-match tables (Traps / Hazards / Secrets, name generators), and reflowed single-spaced pastes. A **Cartesian (expand)** button flattens compound generators on demand.

#### 📄 Source-guided PDF import (bring your own books)

The Importer Hub is **source-guided**: for the *Cursed Scrolls* and *Western Reaches* it knows the **structure** of the content you own — names, source/page citations, dice formulas, and table/parsing layout — and **nothing else**. **No sourcebook prose or prepared documents are bundled in the module**, and nothing is encrypted; the module ships only citations and parsing structure. **You supply every word** by pasting the matching section from **your own PDF**. The paste is recognized, run through the right parsing recipe, link-remapped, and filed into the suite packs exactly as authored — idempotently, so re-importing never duplicates. Content that appears in more than one book (e.g. the Delver/Wyrdling classes, or the *Cursed Scroll* spells reprinted in *Western Reaches*) can be imported from **either** source's paste. Content the Shadowdark **system already ships** (core spells, the base bestiary, the legacy Bard) is skipped — you already have it.

### 💰 Loot & Magic Items

- **Loot Generator** — generate a treasure hoard for a party level and post a **claimable** chat card; the first player to click **Claim** takes coins/items (coins are added to their character; the assignment is locked so loot goes to exactly one actor).
- **Loot drops on kill** — optional automatic loot when a monster dies, plus a drop-a-coin-pile pickup that players grab from the token HUD.
- **Magic Item Forge** — roll or hand-build a magic item (bonuses, benefits, curses, personality, name composition) and create it as a real Foundry item.
- **Merchant Shop** — a GM-run shop that opens for every player at once, backed by either a compendium catalog or an NPC's own inventory. The buy list is grouped into **collapsible category sections** (Basic Gear / Weapons / Armor / Scrolls / Wands / Potions / Poisons). Players buy and sell against `system.coins` at a configurable sell ratio, with a transaction log exportable to Discord. Ships two **default saved merchants** — *Base* (core system gear) and *Western Reaches* (base + enhancer items) — seeded automatically.
- **Loot Setup** — one-click binding of the system's built-in *Treasure 0–3* table (imported, enhanced, and linked) plus per-tier loot table configuration.

### 🎖️ Party XP & Session Recap

- **Party XP award tool** — award XP to the whole party at once. Drag an item to use its XP value (a tagged value wins, else the loot-quality score) or type an amount. The full amount goes to **each** selected character (Shadowdark RAW — treasure XP isn't split); a chat card summarizes old→new XP and flags anyone at the level-up threshold. Writes only `system.level.xp` — never auto-levels.
- **Session Recap** — a per-session tracker (Overview / Combat / Loot / XP / History) with a **Copy for Discord** markdown export. Tied to the crawl: starting a crawl begins/continues a session, ending it saves/pauses/discards. Captures loot claims, XP awards, combats, per-PC roll stats, damage & kills, merchant activity, and encounter checks — with no extra clicks. In multi-GM worlds only the active GM records, so nothing is double-counted.

### 🧙 Character Builder

A guided, ordered character-creation wizard — a step-by-step replacement for the system's all-random `CharacterGeneratorSD`. Open it from the **Character Builder** button in the **Actors sidebar** header (shown to every user), or headlessly via `game.shadowdarkEnhancer.charBuilder.open()` — pass `{ actor }` to build in place onto an existing sheet. It builds a **complete level-1 character** — hit points rolled and class talent chosen up front — so the sheet never re-prompts with the system's level-up dialog.

Seven tabs, freely navigable, each with a completion check mark. Every tab that can be randomized has a per-section **Random** button, and the first tab offers **full random** for a one-click character.

- **Abilities** — the generation method is **GM-dictated** (world setting, shown read-only to players): `3d6` down the line, `3d6` with the core-rules full-array reroll when nothing reaches 14 (the default), `3d6` assign-to-taste, or `4d6` keep-highest-3 down-the-line / assign. Assign methods roll a visible dice pool you place by clicking a die, then a stat. **Every roll posts a chat card** as an audit trail (with optional Dice So Nice animation), and the tab carries a plain-language reference for what each ability does in Shadowdark.
- **Ancestry** — list/detail browse with bundled portrait art, sourced live from every installed compendium. Multi-talent ancestries (e.g. Elf) present their talent choice right on the tab. **Name** and **Trinket** each offer three inputs: pick from the ancestry's roll table, roll it, or type your own.
- **Origins** — Background, Alignment, and Deity on one tab. Deity's random pick is weighted toward your chosen alignment; Background and Deity randoms can be driven by GM-configured roll tables.
- **Class** — shows the class's level-1 features, then handles everything creation owes you: the **2d6 class-talent-table roll** (posted to chat), talent effect choices (Weapon Mastery weapon, Armor Mastery, spell advantage, …) made inline instead of via the system's pop-up dialog, **bonus creation rolls** (Human *Ambitious* extra talent, *Black Lotus*, patron boons), patron selection where the class wants one, a per-tier **spell picker** that enforces the class's spells-known counts, and language choices (fixed languages plus choose-N picks from the common/rare/select pools).
- **HP & Gold** — roll the class hit die (Constitution applied; talent HP bonuses like Dwarf *Stout* are handled without double-counting), or let the GM setting auto-max level-1 HP. Gold rolls the standard `2d6 × 5 gp`, or uses a GM-fixed starting amount.
- **Gear** — a shop: browse Armor / Weapons / Basic gear from all installed packs, with items your class can't use flagged, and a cart tracked against your starting gold and carry slots. Cart costs are deducted from starting coins on creation.
- **Preview** — a read-only summary of every choice, plus an **Artwork** card for the portrait + token. Four ways to set art, needing progressively more permission: **Use Suggested Art** (the bundled class/ancestry portrait, one click, no permissions); **From URL…** (paste a link to any image — works for every player, no file permission and no GM needed); a **curated gallery** (pick from a GM-nominated folder, browsed on the GM's client so permission-less players never touch the file browser); and the normal **file browser** for anyone with that permission. Art is optional — leave it and the system defaults stand. **Finish** confirms and commits through the system's own creation path: ancestry/class/background/deity stored as references, talents/abilities/spells/gear embedded as real items. Players without actor-create permission are handed off to the GM over the system socket automatically.

Name, Trinket, Background, and Deity rolls draw from installed roll tables **automatically** — the builder discovers any table named for a known ancestry (Names/Trinkets) or a Background/Deity table, so imported Western Reaches or homebrew tables just work with no configuration.

### 📄 Export to PDF

Player character sheets carry an **Export to PDF** button in the sheet-window header, shown only to a character's **owner** (the player who owns it, or a GM). Clicking it fills a bundled form-fillable Shadowdark character sheet with the actor's data — abilities (with active-effect bonuses applied), attacks, gear and slot usage, spells (with lost markers and a short summary), talents, languages, and class/ancestry features — and hands you the finished PDF.

Everything is **local and offline**: the sheet is written to disk through your browser's native *Save As* dialog, falling back to an ordinary download if that isn't available, and **nothing is uploaded or sent to any server** — the only network access is your own browser fetching the module's bundled template and PDF library. Character data is read from the Shadowdark data model's own computed values and any HTML (like your notes) is parsed inertly, so an export can never run code, even for a GM exporting a player's sheet. The bundled PDF library is [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT, © Andrew Dillon).

### 🐴 Mounts & Boats

Two Actor sub-types (**Mount**, **Boat**) with dedicated sheets and shared Occupants / Inventory / Description tabs, for the *Western Reaches* mounts, warband units, boats, and siege vehicles. The Mount type reuses the Shadowdark system's own NPC data model and sheet.

---

## Settings

Configured under **Configure Settings → Shadowdark Enhancer** (world scope). Highlights:

| Setting | Default | Notes |
|---|---|---|
| Combat movement default (ft) | 30 | Per-combatant turn budget. |
| Out-of-combat movement budget (ft) | 90 | Per-crawl-turn budget. |
| Enforce out-of-combat movement budget | on | Over-budget moves are refused. |
| Enforce combat movement budget | off | Opt-in refusal in combat. |
| Hide hidden NPCs from the strip | on | Suppresses `token.hidden` / `combatant.hidden` cards. |
| Warn when shadowdark-crawl-helper is enabled | on | Non-blocking load-time notice. |
| Encounter threshold (1d6) | 1 | Hit on ≤ threshold. |
| Encounter sources | world + bestiary | Which packs feed encounters. |
| GM-only encounter rolls | on | Players can't trigger checks. |
| Pause on encounter | on | Auto-pause the game on a hit. |
| Auto-roll active table | on | Roll the bound table on a hit. |
| Loot drop on kill | on | Auto-loot when a monster dies. |
| XP level-up thresholds / loot XP tiers | 10 / 150 | Used by Party XP and loot valuation. |
| Character Builder: ability method | 3d6, reroll under 14 | GM-dictated; players can't change it in the builder. |
| Character Builder: dice animation | off | Roll chat cards always post; this adds the 3D dice. |
| Character Builder: max level-1 HP | off | Auto-max instead of rolling the class hit die. |
| Character Builder: starting gold (gp) | 0 | 0 = roll the standard 2d6×5 gp. |

---

## API for module developers

A versioned, public API is exposed at `game.shadowdarkEnhancer` and mirrored at
`game.modules.get("shadowdark-enhancer")?.api`. Wait for the ready signal:

```js
Hooks.once("shadowdarkEnhancer.ready", (api) => {
  console.log("SDE API", api.apiVersion); // "1.0.0"
});
```

Namespaces: `import` (universal dump segmentation), `items`, `monsters`,
`linker` (name → compendium resolution), `encounter`, `loot`, `tables`,
`bundle` (suite export/import), `mutator`, `monsterCreator`, `tokenArt`
(monster compendium art skinning), `forge`, and `charBuilder` (guided
character creation).
Document-creating entry points are GM-only and follow a never-overwrite,
never-delete contract. Full reference: **[docs/API.md](docs/API.md)**.

---

## Project layout

```
scripts/
├── shadowdark-enhancer.mjs      # entry: hooks, API surface, partial/actor registration
├── crawl-bar.mjs / crawl-strip.mjs / crawl-state.mjs   # top strip + control bar
├── movement-tracker.mjs / hidden-sync.mjs / initiative-manager.mjs
├── npc-action-menu.mjs          # combat HUD dropdown
├── merchant-shop.mjs
├── settings.mjs / icons.mjs / module-id.mjs
├── actors/                      # Mount & Boat sub-types, sheets, vehicle rolls
├── char-builder/                # guided character-creation wizard + step managers
├── monster-art/                 # Monster Token Art manager + source catalog
└── encounter/                   # importer hub + class/spell importers, roller,
                                 # loot, forge, tables, manage tree, party XP, recap
templates/                       # Handlebars for every window + chat cards + partials
styles/shadowdark-enhancer.css
languages/en.json
docs/API.md
```

See **[CHANGELOG.md](CHANGELOG.md)** for the full release history.

## License

MIT — see [LICENSE](LICENSE).
