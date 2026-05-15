# Changelog

## [0.1.0] — 2026-05-14

First milestone: bottom-anchored Crawl Strip for Shadowdark RPG.

### Added

- Bottom-anchored Crawl Strip mounted at the bottom of the canvas. Mode-aware header (off / CRAWL / COMBAT).
- Three-state mode model (`off` / `crawl` / `combat`) with world-setting persistence + socket sync. Custom `sde.stateChanged` hook for subscribers.
- HP, Movement, and Luck stat cells per card. HP cell + Movement cell turn red when at zero / over budget.
- Luck pips read `actor.system.luck` (Shadowdark base system fields). Click a filled pip to spend via `actor.system.useLuckToken()`. NPCs render `—`.
- Out-of-combat marching-order initiative (`1d20 + bonus`, advantage via system's `applyAdvantage`); manual GM reset; result whispered to GM in chat.
- Crawl turn counter with per-token `crawlAnchor` capture; optional movement-budget enforcement (default 90 ft) via `preUpdateToken` hook.
- Combat-mode per-combatant cards in `game.combat.turns` order with active-combatant highlight and hidden-NPC filter (gated by setting).
- Bidirectional `token.hidden ↔ combatant.hidden` sync (GM-only).
- Movement tracker with `turnStart` flag capture on `combatStart` / `combatTurn`; cleared on `deleteCombat`. Chebyshev-distance grid math.
- Per-active-combatant HUD dropdown opening ABOVE the card: Status (HP ±1/±5, Spend Luck), Actions (Open Sheet passthrough), Movement (Rollback to Turn Start). Closes on outside-click and on `combatTurn`.
- HTML-escape helper (`scripts/util/esc.mjs`) used for actor name and portrait img-src interpolation.
- Coexistence warning notification when `shadowdark-crawl-helper` is enabled (suppressible via setting).
- Shadowdark-flavored palette (parchment/iron/torchlight) via CSS variables.

### Architectural decisions

- `MODULE_ID` lives in its own file (`scripts/module-id.mjs`) so other modules can import it at top level without participating in a circular-import temporal-dead-zone trap with the entry point.
- Render queue uses microtask debounce (`Promise.resolve().then(...)`) rather than `requestAnimationFrame` because Foundry's canvas pauses rAF callbacks when idle, starving renders.
- `oocInitiative` keyed by `tokenId` (not actorId) so duplicate-actor tokens in one scene get distinct rolls.

### Known limitations

- NPC `system.move` string ("near", "double near", "far", "near (fly)") not yet parsed; flat 30-ft combat budget for all NPCs.
- On-canvas ruler color does not turn red when over budget (Foundry v14 TokenRuler subclass API parity deferred). The strip's Movement cell turning red is the over-budget signal.
- If multiple `Combat` documents are created in quick succession the strip may briefly show "Round 0 / Turn 0/0" until the active combat settles.
