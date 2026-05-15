# Changelog

## [0.1.7] — 2026-05-15

### Fixed
- **Movement tracker now counts cumulative path, not displacement from origin.** Previous versions measured straight-line Chebyshev distance from a fixed anchor to the token's current position — so moving forward 3 squares then back 2 displayed `1 square used` even though the player actually moved 5 squares. The tracker now accumulates the delta of every position change into a `usedMovement` flag per token, matching how TTRPG movement actually works:
  - Forward 3 → +15 ft
  - Back 2 → +10 ft (total 25 ft used, not 5 ft)
  - Back 1 more (returned to origin) → 30 ft used
- **Resets**:
  - Crawl: `Start Crawl`, `Next Crawl Turn`, and adding new members all reset `usedMovement` to 0 for the affected tokens.
  - Combat: `combatStart` resets all combatants; `combatTurn` resets only the new active combatant.
  - `Rollback to Turn Start` also resets `usedMovement` to 0 (you're back at the start of your turn).
- **Enforcement now uses cumulative.** With `oocEnforceBudget` on, a proposed move is refused if `currentUsed + delta > budget` — so the 90 ft crawl budget applies to total movement across the whole turn, not just current displacement.

## [0.1.6] — 2026-05-15

### Fixed
- **Movement tracker no longer reports fluctuating/random distances.** Foundry v14's TokenDocument `.x/.y` properties interpolate during the canvas movement animation — reading them mid-flight returned an in-between coordinate. The strip's render hooks fire many times during a drag, so the displayed "used" number bounced around and snapped to weird values. Movement tracker now reads `tokenDoc._source.x/y` (the data-model coords) for both anchor capture AND distance computation. The displayed used/budget is now stable from the moment the move commits.
- **Newly added crawl members had no anchor.** When the GM clicked "Add Tokens" mid-crawl to add a token that wasn't on the scene at `Start Crawl` time, the new token had no `crawlAnchor` flag → `usedFor` returned 0 → movement display stuck at full budget regardless of how far the token moved. `addMembers` now calls `MovementTracker.captureCrawlAnchorsFor(newIds)` so anchors are captured at the moment of joining.

## [0.1.5] — 2026-05-15

### Added
- **Game Master card in crawl mode** — out-of-combat strip now always renders a synthetic GM card at the end of the heroes row (cowled figure + crown badge). Represents the GM's turn in the crawl loop (encounter rolls, light ticks, etc.). Hidden in combat mode where Foundry's tracker drives turn order.

## [0.1.4] — 2026-05-15

### Fixed
- **PC weapon click did nothing.** `actor.system.rollAttack(weaponUuid)` takes a UUID, not an item ID — the menu was passing the ID so `fromUuid()` returned null silently. Now passes `item.uuid`.
- **PC spell click threw an error.** Same root cause for `actor.system.castSpell(spellUuid)`. Now passes `item.uuid`.
- **Strip render starved when canvas idle.** Reverted from `requestAnimationFrame` to microtask debounce (`Promise.resolve().then`) for the render queue. Foundry's canvas can pause rAF callbacks when the scene is idle, which prevented state-mutation re-renders (e.g. members added via Add Tokens) from landing without a manual refresh. Same fix as v0.1.0; regressed in v0.1.2's Vagabond port and now back.

### Changed
- **Strip combat order now mirrors initiative order, not heroes/NPCs split.** Combatants render as a single flat list in `game.combat.turns` order (respects the system's Clockwise Initiative setting). The `HEROES` and `NPCS` section labels are dropped in combat mode. Crawl mode still shows a `HEROES` group for clarity since it's PCs-only.
- **Crawl-mode strip is now opt-in via Add Tokens.** Previously the strip auto-included every Player token on the scene. Now `CrawlState.members` holds the explicit roster, populated by the bar's "Add Tokens" button when in crawl mode (mode-aware: combat mode still adds to the combat tracker). Starting a Crawl initializes with an empty roster; Ending a Crawl clears it.

### Added
- `CrawlState.members` (array of token IDs) + `addMembers(ids)` / `removeMember(id)` / `clearMembers()` mutators.

## [0.1.3] — 2026-05-15

### Added

- **Action menu HUD dropdown** (ported from Vagabond Crawler's `npc-action-menu.mjs` UI shell). During combat, each owned combatant card shows a hover-revealed tab strip BELOW the card:
  - **NPCs** → `[Actions] [Abilities]` — Actions tab lists `NPC Attack` + `NPC Special Attack` items (with damage label, e.g. "Claws  1d4 piercing"); Abilities tab lists `NPC Feature` items.
  - **Players** → `[Weapons] [Spells]` — Weapons tab lists equipped `Weapon` items (with `system.damage.oneHanded`/`twoHanded` + `system.range`); Spells tab lists known `Spell` items (not lost) with `T{tier} {damageType}` label.
- **Click-to-act dispatch** routes through Shadowdark actor methods:
  - PC weapon → `actor.system.rollAttack(itemId)`
  - PC spell → `actor.system.castSpell(itemId)`
  - NPC attack → `actor.rollAttack(itemId)` / `actor.system.rollAttack(itemId)` / item-sheet fallback
  - NPC feature → opens item sheet (passive description)
- **Floating panel** is appended to `#shadowdark-enhancer-strip` (not the card) so it escapes parent `overflow:hidden` clipping. Hover behavior preserves Vagabond's grace-timeout pattern (200ms) so moving from the card to the panel doesn't dismiss it.
- **Auto-close** on combat turn change.
- **CSS hooks** for the menu — `.sde-strip-action-tabs`, `.sde-strip-atab`, `.sde-strip-action-panel`, `.sde-strip-ptab`, `.sde-strip-panel-{item,name,body,empty}`, `.sde-strip-menu-dmg` — all using existing `--sde-bar-*` palette variables.

### Notes

- The full ~500-line `CrawlerSpellDialog` from Vagabond was intentionally dropped — Shadowdark has no mana system, no spell delivery types, no template placement workflow, and no Vagabond Character Enhancer integration (alchemy/beast-form/Step Up/Virtuoso/Summon/Gold Sink/Talents). Casting a Shadowdark spell defers entirely to `actor.system.castSpell(itemId)` which the system already provides.
- NPC type detection uses `actor.type !== "Player"` (Shadowdark uses `Player` and `NPC` actor types).

## [0.1.2] — 2026-05-15

### Changed

- **Faithful Vagabond Crawler port** of the top strip + bottom crawl bar. The previous Shadowdark-Enhancer-original strip/bar styling has been replaced with a verbatim duplicate of Vagabond Crawler's visual contract: gold tabletop accent palette, dark/light theme variables, wall-to-wall portrait cards (130x160), HP gradient bar with overlay label, luck/movement pills with shamrock + walking-person icons, vertical HEROES/NPCS group labels, dimmed inactive cards with `is-turn` pulse animation, and the same bottom-bar button gradients (start, next, combat, danger).
- **CSS namespace migration**: `vc-` → `sde-`, `vcb-` → `sde-bar-`, `vcs-` → `sde-strip-`, `--vc-*` → `--sde-*`, `--vcb-*` → `--sde-bar-*`. `vagabond-crawler-*` IDs → `shadowdark-enhancer-*`.
- **Bottom bar** mounts into `#ui-middle` (natural block flow, no `position:fixed`). Shows Start Crawl in off mode; phase badge + Next Turn + Add Tokens + Combat + M2 placeholders + End in crawl mode; Begin/End Encounter + Add Tokens + Delete Encounter in combat mode.
- **Top strip** mounts into `#interface` with dynamic left/right edge calculation against scene-nav + sidebar (faithful to Vagabond).
- **Single crawl turn counter** displayed in the strip's left badge in crawl mode (replaces Vagabond's heroes/gm phase model — Shadowdark uses one counter).
- **Icon registry**: ported `scripts/icons.mjs` from Vagabond verbatim, paths fixed to `modules/shadowdark-enhancer/icons/`. Added `icons/dragon-head.svg`, `icons/light-sabers.svg`, `icons/shamrock.svg`.

### Added

- **M2 placeholder buttons** (Encounter, Lights, Rest, Forge & Loot) rendered in the crawl bar with the `.sde-bar-disabled` class — dimmed but visible to preserve the bar's visual rhythm. Clicking shows a "coming in a later milestone" notification.
- **Combat-mode strip controls** in the left badge: prev/next round + prev/next turn buttons stacked around the round number.
- **Activate / End Turn buttons** on combatant cards (GM only), revealed on hover.

### Removed

- `templates/bottom-strip.hbs`, `templates/npc-action-menu.hbs` — Vagabond builds DOM imperatively in JS, so these handlebars templates are no longer needed.
- `scripts/stat-panels/{hp-panel,movement-panel,luck-panel}.mjs` — Vagabond inlines stat HTML into the card's overlay; the panel modules are obsolete.
- `scripts/npc-action-menu.mjs` — the per-card HUD dropdown is replaced by Vagabond's hover-revealed action tabs (currently rendered as just `.sde-strip-card-wrap`; full dropdown content deferred).

### Notes

- The strip's data extraction reads `actor.system.luck.{remaining,available}` (with fallback) instead of Vagabond's `actor.system.currentLuck`. Shadowdark schema parity.
- Movement display always uses the module setting (`combatMovementDefault` / `oocMovementBudget`) since Shadowdark PCs have no per-actor speed field, and NPC `system.move` is a string we don't parse yet.

## [0.1.1] — 2026-05-14

### Changed
- **Layout split**: PC/combatant cards now live in a TOP bar; mode pill + action buttons live in a BOTTOM bar. Matches Vagabond Crawler's two-bar pattern.
- **HP visualization**: replaced text `HP n/max` with a green progress bar + value overlay (red gradient when value <= 0).
- **Movement visualization**: inline walking-person SVG icon + `used/budget ft`.
- **Section grouping**: top bar now shows `HEROES` (green) and `NPCs` (red) section labels with colored borders separating the two card groups in combat mode.
- **Round badge**: standalone circular badge on the far left of the top bar in combat mode; bottom bar's Turn counter shows just `Turn N/M` (round moved out).
- **HUD dropdown direction**: combat HUD now opens BELOW the active combatant's card (cards live at viewport top); trigger label flipped to "▼ HUD ▼".

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
