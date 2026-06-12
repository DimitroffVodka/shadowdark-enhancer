# Shadowdark Enhancer

Bottom-anchored Crawl Strip for **Shadowdark RPG** on Foundry VTT — out-of-combat marching order, in-combat initiative, HP/Movement/Luck readouts, movement-budget enforcement with turn-start rollback, and a per-combatant action HUD.

This module is the first milestone in a larger Shadowdark companion suite. The bottom-bar feature set (encounters, lights, rest, loot, party inventory, session tracker) is planned for subsequent milestones.

## Requirements

- Foundry VTT v13+ (verified v14.361)
- Shadowdark RPG system v3.6.2+ (verified v4.0.4)

## Features (v0.1.0)

### Crawl mode

- GM-toggleable crawl loop with a manual turn counter.
- Players roll initiative for marching order; the roll persists until reset.
- Movement budget (default **90 ft per crawl turn**) optionally enforced — over-budget moves are refused before they commit. Anchors captured on `Next Crawl Turn`.

### Combat mode

- One card per combatant in initiative order. Hidden NPCs are filtered (and Token ↔ Combatant hidden flags stay bidirectionally in sync).
- Round and turn counter pulled live from Foundry's Combat tracker.
- Per-combatant movement red-line at **30 ft** (default) from the combatant's turn-start position. Strip's Movement cell turns red when over budget.
- "Clockwise Initiative" system setting is respected automatically because the strip reads `game.combat.turns` directly.

### Per-card stat cells

| Stat | Source |
|---|---|
| HP | `actor.system.attributes.hp.{value,max}`. Cell turns red at `value <= 0`. |
| Movement | Live used vs budget (combat or crawl). Cell turns red when over. |
| Luck | `actor.system.luck.{available, remaining}` + `actor.system.hasLuckToken`. PCs only. Click a filled pip to spend via `actor.system.useLuckToken()`. NPCs show `—`. |

### Combat HUD dropdown

Click the **▲ HUD ▲** trigger on the active combatant's card to open a per-combatant dropdown with three tabs:

- **Status**: HP ±1 / ±5 buttons; "Spend Luck" button (PCs with available luck only).
- **Actions**: "Open Sheet" passthrough.
- **Movement**: "Rollback to Turn Start" — moves the token back to where it was at the start of its turn.

The dropdown closes on outside-click and on combat turn change.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Combat movement default (ft) | 30 | Per-combatant turn budget. |
| Out-of-combat movement budget (ft) | 90 | Per-crawl-turn budget. |
| Enforce out-of-combat movement budget | on | When on, moves past the budget are refused. |
| Hide hidden NPCs from the strip | on | Suppresses combatants where `token.hidden` or `combatant.hidden` is true. |
| Warn when shadowdark-crawl-helper is enabled | on | Non-blocking notification at world load. |

## Coexistence

- **`shadowdark-crawl-helper`**: this module is intended to replace it. With Crawl Helper enabled you'll see a warning notification at world load; disable Crawl Helper for best results. You can suppress the warning in Module Settings.

## Known limitations (v0.1.0)

- **NPC movement strings.** Shadowdark NPCs have `system.move` as a string (e.g. `"near"`, `"double near"`, `"near (fly)"`) in the base system, but this MVP treats all combatants as 30 ft. A follow-up milestone will parse the string for per-NPC combat budgets.
- **In-canvas ruler color.** Foundry's TokenRuler subclass API in v14 is volatile, so v0.1.0 does NOT color the on-canvas drag ruler red when you exceed budget. The strip's Movement cell turning red is the over-budget signal. Will revisit when the v14 ruler API stabilizes.

## Installation

Paste the following manifest URL into Foundry's module installer:

```
https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json
```

(The GitHub URL in `module.json` is a placeholder pending repo creation by the author.)

## Architecture (quick map)

```
scripts/
├── shadowdark-enhancer.mjs   # entry: init/ready hooks
├── module-id.mjs             # MODULE_ID constant (avoids circular import)
├── settings.mjs              # all module settings
├── crawl-state.mjs           # singleton {mode, crawlTurn, oocInitiative} + socket sync
├── crawl-strip.mjs           # DOM mount + render + bounds tracking
├── initiative-manager.mjs    # OoC marching-order rolling
├── movement-tracker.mjs      # turn-start / crawl-anchor flags + enforcement hook
├── hidden-sync.mjs           # token.hidden ↔ combatant.hidden sync
├── npc-action-menu.mjs       # combat HUD dropdown
├── stat-panels/{hp,movement,luck}-panel.mjs
└── util/esc.mjs              # HTML escape helper
templates/
├── crawl-strip.hbs
└── npc-action-menu.hbs
styles/shadowdark-enhancer.css
languages/en.json
```

## API for module developers

A versioned public API (`game.shadowdarkEnhancer`, mirrored at
`game.modules.get("shadowdark-enhancer")?.api`) exposes the importer,
linker, encounter, loot, table, and bundle features for other modules and
macros. See [docs/API.md](docs/API.md).

## License

MIT — see `LICENSE`.

## Acknowledgements

Forked patterns and lessons-learned from [Vagabond Crawler](https://github.com/DimitroffVodka/vagabond-crawler), the author's earlier crawl-helper module for the Vagabond system.
