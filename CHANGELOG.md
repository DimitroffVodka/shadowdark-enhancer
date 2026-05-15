# Changelog

## [Unreleased]

### Added
- **Init result badge on cards** — once a combatant has an initiative value (combat or out-of-combat), the dice button position is replaced by a small gold-bordered badge showing the rolled number. So you can see at a glance who's rolled and what they got.
- **Thrown weapons appear as dual entries in the action menu.** Weapons with the `thrown` property (Spear, Dagger, etc.) now show up twice in the Weapons tab — once as their native melee variant and once as a `(thrown)` ranged variant. Clicking the thrown variant passes `attack: { type: "ranged" }` to `actor.system.rollAttack`, so the system's roll generator uses the ranged ability mod (DEX) and the weapon's thrown range. Mirrors the character sheet's RANGED ATTACKS section, which already lists thrown weapons alongside true ranged weapons.
- **Melee vs ranged at-a-glance icons on weapon entries.** Each weapon row in the action menu now shows a small color-coded prefix icon — warm-red crossed swords (`fa-swords`) for melee, cool-blue crosshairs (`fa-crosshairs`) for ranged — so you can tell attack mode without reading the damage label or the `(thrown)` suffix. Applies to both PC weapons and any other weapon-kind entries.

### Fixed
- **OoC initiative now includes DEX modifier** (matching the combat tracker). Previously the formula was `1d20 + roll.initiative.bonus`, which is just the extra-bonus field most PCs leave at 0 — so a DEX 14 PC was rolling a flat d20. Now mirrors the system's `_ActorBaseSD._modifyRollData` exactly: `1d20 + abilities.dex.mod + roll.initiative.bonus`, advantage applied via `shadowdark.dice.applyAdvantage`. OoC and in-combat initiative now produce identical totals for the same actor.
- **OoC initiative chat card now uses the Shadowdark system's native roll-card style** — same look as the system's Attack Roll / Damage Roll cards, including the reroll-icon affordance and prominent total. The InitiativeManager dispatches through `shadowdark.dice.rollFromConfig` (which is what `actor.system.rollAttack` / `castSpell` use internally) instead of the generic `Roll#toMessage`. Falls back to the generic path if the system API isn't available.
- **Reroll button now syncs the new total back to the strip.** The system's reroll-icon creates a fresh chat message via `rollFromConfig` rather than updating the original, so previously the strip's badge kept the old number. The rollConfig now carries a `sdeOocTokenId` tag; a `createChatMessage` hook reads the new total from any message bearing that tag and updates `CrawlState.oocInitiative` so the badge re-renders to match.
- **Out-of-combat initiative wasn't cleared between crawl sessions.** `startCrawl` and `endCrawl` now wipe `oocInitiative` so a fresh crawl always starts clean — previously a roll from an earlier session lingered and hid the dice button on the card.

## [0.1.22] — 2026-05-15

### Added
- **Out-of-combat initiative during crawl rounds.** Each PC card in crawl mode now shows the same per-card blue d20 dice button — click rolls `1d20 + system.roll.initiative.bonus` (advantage applied via the system helper) through `Roll#toMessage`, so the chat card and Dice So Nice both fire just like a combat initiative roll. Result stored in `CrawlState.oocInitiative` and the strip cards reorder by initiative descending. Useful for surprise/reaction order, marching order checks, anything that needs initiative without firing up the combat tracker.
- **"Reset Init" button on the crawl bar** (visible only when at least one OoC initiative roll is stored). Clears `oocInitiative` so the dice buttons return on each card for a fresh round.

## [0.1.21] — 2026-05-15

### Changed
- **Action menu (Weapons / Spells / Abilities) now available in crawl mode too.** Previously the hover-tab dropdown was combat-only. Players need to cast utility spells, browse weapons, or trigger class abilities during exploration too — the gate has been dropped, so any card the user owns shows its action menu in any mode.

## [0.1.20] — 2026-05-15

### Fixed
- **Crawl-strip initiative dice click now triggers chat cards and Dice So Nice.** Previous version called `Combatant#rollInitiative()` directly which bypasses Foundry's message pipeline (no chat, no 3D dice). Now routes through `Combat#rollInitiative([id])` which is the same path Foundry's sidebar combat tracker uses — generates the "Avorn rolls for Initiative!" chat message and Dice So Nice picks up the 3D roll automatically.

## [0.1.19] — 2026-05-15

### Fixed
- **Roll Initiative dice button could stay visible after rolling** in some edge cases (slow hooks, custom dialog flows, etc.). Added a defensive explicit `queueRender()` after the dice click — the existing `updateCombatant` hook already covers the normal path, but this guarantees the dice icon refreshes once the roll commits, even if a third-party module delays the hook.

## [0.1.18] — 2026-05-15

### Added
- **Per-card Roll Initiative dice button.** In combat, every combatant card whose `initiative` is null and whose actor the user owns (or the GM) now shows a glowing blue d20 in the top-right corner. Clicking it calls `combatant.rollInitiative()` and the button disappears once an initiative is set. Pulses gently to invite the click.

## [0.1.17] — 2026-05-15

### Fixed
- **Luck pill showed `1` instead of `0` in Pulp Mode when the count was actually zero.** Shadowdark's Pulp Mode (`shadowdark.usePulpMode` setting) makes Luck numeric and ignores the classic-mode `available` boolean. The strip was reading `available: true` (leftover from before pulp mode was enabled) and showing 1 even when `remaining === 0`. Now the display gates on the setting: pulp mode shows `remaining` directly; classic mode keeps the existing `remaining > 0 ? remaining : available ? 1 : 0` logic.

## [0.1.16] — 2026-05-15

### Fixed
- **Active-turn highlight stuck on the wrong token after rolling initiative mid-combat.** When the GM starts combat BEFORE rolling initiative (a common mis-step), the active-turn pointer sticks on whoever was first by default order. Once initiative gets rolled, Foundry re-sorts `combat.turns` but preserves the previously-active combatant's index — so the highlight stayed on the wrong token even though the cards visually reordered. Now: on any initiative change in round 1, once every combatant has an initiative, the active turn snaps to position 0 (the actual top of the order). Debounced so a `rollAll()` burst lands once.

## [0.1.15] — 2026-05-15

### Fixed
- **Bar didn't show the "Begin Encounter" intermediate state when you pressed Combat.** The bar's render logic already had the right branches, but `CrawlState` only listened for `combatStart` (fires after `startCombat()`), so after the Combat button created+activated the encounter the mode stayed `crawl`/`off` and the bar rendered the crawl branch. CrawlState now also listens for `createCombat` — pressing Combat flips mode to `combat` immediately, the bar renders `Begin Encounter | Add Tokens | Delete Encounter`, and clicking Begin Encounter calls `combat.startCombat()` which swaps the button to `End Encounter`.

## [0.1.14] — 2026-05-15

### Changed
- **PC Abilities tab now lists only `Class Ability` items** (the "Special Abilities" section on the character sheet — e.g. Avorn's Petrifying Gaze). Excludes passive Talents (Stone Skin, Ambitious, etc.) which belonged in the sheet's Talents block, not Special Abilities.

## [0.1.13] — 2026-05-15

### Changed
- **AC moved out of the pill row, now displays as a small badge directly beneath the actor's name.** Frees up horizontal space on the bottom pill row, which was getting crowded with Luck + Movement on PC cards.

## [0.1.12] — 2026-05-15

### Fixed
- **Luck pill never showed 1 when the actor had an unspent base Luck Token.** `_extractData` was reading `system.luck.remaining` first — but the base Shadowdark Luck Token lives at `system.luck.available: true` with `remaining: 0`. So a fresh PC with one unspent token displayed 0. Now: `remaining > 0` → show remaining; else if `available` → show 1; else 0.
- **Luck pill is now click-to-spend.** Clicking the shamrock pill on the strip calls `actor.system.useLuckToken()` and re-renders. Cursor + hover styling applied only when there's actually a token to spend.

### Added
- **AC pill on every card** (PC + NPC). Reads `actor.system.attributes.ac.value`. Renders as a small `AC 16` pill before the Luck/Movement pills. NPCs without AC fall back gracefully (no pill rendered).
- **PC Abilities tab** in the per-combatant action menu. New third tab (after Weapons / Spells) listing `Talent` and `Class Ability` items. Clicking dispatches to `actor.system.useAbility(itemUuid)` — passive talents (like "Ambitious") open a description card, active ones (like Avorn's "Petrifying Gaze") trigger their roll/check. Tabs hide when empty, so a Cleric without spells shows only Weapons + Abilities.

## [0.1.11] — 2026-05-15

### Changed
- **`far` mapping updated to 120 ft** (was 60 ft in v0.1.10). Far is "very long distance per turn" — distinct from `doubleNear` (60 ft). `special` and missing values still fall back to `combatMovementDefault` (30 ft).

## [0.1.10] — 2026-05-15

### Added
- **Per-NPC combat speed from `actor.system.move`.** NPCs in combat now use their statblock movement enum to compute the budget instead of the flat `combatMovementDefault` (30 ft) that PCs use. Mapping (from `shadowdark.config.NPC_MOVES`):

  | `system.move` | ft |
  |---|---|
  | `none` | 0 |
  | `close` | 5 |
  | `near` | 30 |
  | `doubleNear` | 60 |
  | `tripleNear` | 90 |
  | `far` | 60 |
  | `special` / missing | falls back to `combatMovementDefault` |

  Player Characters always use the module setting (Shadowdark has no per-PC speed). Crawl mode keeps the flat budget for everyone (overland pace, NPCs travel with the party).

### Changed
- **`MovementTracker.budgetFor(mode, tokenDoc?)` is now actor-aware.** When a `tokenDoc` is passed, the budget is computed from `_getBaseSpeed(actor, tokenDoc)` which reads the per-NPC enum; otherwise falls back to the mode setting. Strip's `_extractData` now passes the tokenDoc so an Acolyte's `60/60ft` reflects its `doubleNear` and a Snow Ape's `90/90ft` reflects its `tripleNear`. PCs still show `30/30ft`.
- **`remainingFor` fallback** now uses the same actor-aware budget when no `moveRemaining` flag is stored — so newly placed NPC tokens display their correct budget immediately, without needing to be added to a roster or move once.

## [0.1.9] — 2026-05-15

### Changed
- **Movement readout now shows over-cap overflow as a negative.** Previous versions floored `moveRemaining` at 0 once a token exceeded its budget — losing the information about how far over they went. When enforcement is off (the default for combat), the strip now displays the overflow as a negative number: e.g. moved 50 ft with a 30 ft budget renders as `-20/30ft` in red. Crawl enforcement (on by default) still blocks moves that would exceed budget, so crawl mode rarely goes negative unless the GM turns enforcement off.

### Added
- `.sde-strip-pill-over` CSS class — applied to the Mv pill when `moveRemaining < 0`. Red text, soft red background, bold weight, red walking icon. Stands out at a glance vs. the normal green pill.

## [0.1.8] — 2026-05-15

### Changed
- **Movement tracker rewritten as a faithful Vagabond Crawler port (deduction model).** The previous cumulative-`usedMovement` accumulator is replaced with Vagabond's `moveRemaining` deduction pipeline:
  - Each tracked token carries a `moveRemaining` flag (feet left this turn). Reset to full budget on `combatStart`, on every combat round/turn change, and at `startCrawl` / `nextCrawlTurn` / when added mid-crawl.
  - `preUpdateToken` computes the segment distance from `_source.x/y` (avoids Foundry v14's animation interpolation) and caches it in `_pendingDeduct[tokenId]`. `updateToken` reads the cache, subtracts from `moveRemaining`, deletes the entry, and re-renders the strip.
  - 5-ft rounding applied at every distance computation.
- **`SDETokenRuler` subclass (ported from Vagabond's `VCSTokenRuler`).** Extends `foundry.canvas.placeables.tokens.TokenRuler`. Walks the waypoint `previous` linked list summing pending `cost`, then colors segments + grid highlights green within budget, red over. Registered via `CONFIG.Token.rulerClass` for new tokens; explicitly installed on existing canvas tokens via `_installRulers()` from `init()` and on every `canvasReady`.
- **Rollback teleports + refunds.** The "Rollback Movement" token-HUD button teleports the token back to its turn-start position (with `teleport: true, animate: false` to bypass walls and skip movement accounting) and refunds the full base speed. Player clicks relay to the GM over the module socket.

### Added
- **`combatEnforceBudget` setting** (default `false`). Mirrors `oocEnforceBudget` for combat mode. Off by default — Shadowdark combat traditionally relies on player honesty, not hard enforcement.
- **`MovementTracker.remainingFor(tokenDoc, mode)`** — reads the per-token `moveRemaining` flag directly, falling back to the full mode budget when unset. The strip's `_extractData` now uses this instead of computing `budget - used`.
- **`controlToken` hook** clears stale ruler ghosts when token selection changes.

### Adaptations from Vagabond
- No per-actor speed lookup — budget comes from module settings (`combatMovementDefault` / `oocMovementBudget`).
- No Rush mechanic (combat caps at `moveRemaining`, floors at 0). No overloaded check. No terrain difficulty regions.
- No fly/swim/climb effective-mode resolution.
- Actor types `Player` / `NPC` (capitalized).
- `CrawlState.members` is a flat array of token IDs (Vagabond uses `[{actorId, tokenId, type}]`).
- `moveRemaining` stored on the **token** (not actor), since members are tracked by tokenId and the same actor may have multiple tokens.

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
