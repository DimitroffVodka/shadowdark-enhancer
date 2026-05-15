# Shadowdark Enhancer — Top Crawl Strip (MVP) Design

**Status:** Draft for implementation
**Date:** 2026-05-14
**Module:** `shadowdark-enhancer`
**Scope:** Milestone 1 / MVP — Top Crawl Strip only. Bottom bar, lights, rest/rations, encounters, loot, merchant, party inventory, session tracker, PDF export, and character generator are explicitly **out of scope** for this spec and will be addressed in subsequent milestones, each with its own spec.

---

## 1. Goal

Replace `shadowdark-crawl-helper`'s crawl-state surface with a top-of-screen Crawl Strip that matches the production quality of Vagabond Crawler's strip but is built for Shadowdark RPG mechanics. The strip is the single most-visible artifact of the eventual module; shipping it as a polished, stand-alone MVP lets the user disable `shadowdark-crawl-helper` immediately and validates the architectural patterns that later milestones (bottom bar, encounter tools, loot, etc.) will plug into.

The MVP is feature-complete enough to demo at a table without any other bottom-bar features, but is engineered so later milestones add to it rather than rewriting it.

## 2. Non-goals (explicit out-of-scope)

The following are **not** in this spec and will not be implemented as part of M1:

- Bottom bar (Encounter, Lights, Rest, Loot Generator, Merchant Shop, Party Inventory, Session Tracker, drag/drop loot)
- Ration tracker
- Shadowdark light/torch tracker integration (system's `LightSourceTrackerSD` is left untouched)
- Encounter builder/roller, monster creator, browse NPC
- Loot generator, merchant shop, party inventory, session recap, XP-from-loot
- PDF character export, character generator
- Compendium integrations with `shadowdark-extras`, `shadowdark-community-content`, `shadowdark-community-tokens`, `unnatural-selection`
- Automated unit/integration tests — MVP relies on a manual UAT checklist (see §11)

## 3. Decisions locked during brainstorming

| Decision | Value |
|---|---|
| MVP scope | Top Crawl Strip only |
| Code-reuse strategy | Hybrid hard fork — copy proven UI/state/movement plumbing from Vagabond Crawler verbatim; rewrite mechanics-bound widgets fresh for Shadowdark |
| Luck source | Base system fields `actor.system.luck.{available, remaining}` + `actor.system.hasLuckToken` getter; spending goes through `actor.system.useLuckToken()` (confirmed via live MCP probe — no external module dependency) |
| OoC initiative reset | Manual GM button only |
| Combat movement red-line origin | Token's position when its turn started |
| OoC movement budget reset | When GM clicks "Next Crawl Turn" |
| Hidden-NPC filter | Hide combatant card if `token.hidden || combatant.hidden`; keep the two in sync via bidirectional hooks (Vagabond Crawler pattern, ported verbatim) |
| State model | Flat 3-state (`off` / `crawl` / `combat`) + integer `crawlTurn` counter |
| Coexistence with `shadowdark-crawl-helper` | Warn-only at `ready` time; do not block mount |
| Clockwise Initiative system setting | Respect — sort combatants using Foundry's `game.combat.turns` order (which is what the system already reorders when its Clockwise Initiative setting is on) |

## 4. Architecture

### 4.1 Manifest (`module.json`)

```json
{
  "id": "shadowdark-enhancer",
  "title": "Shadowdark Enhancer",
  "description": "Top Crawl Strip for Shadowdark RPG: out-of-combat marching order, in-combat initiative, HP/Movement/Luck readouts, movement-budget enforcement with turn-start rollback, and per-combatant action HUD.",
  "version": "0.1.0",
  "authors": [{ "name": "DimitroffVodka" }],
  "compatibility": { "minimum": "13", "verified": "14" },
  "relationships": {
    "systems": [{ "id": "shadowdark", "type": "system", "compatibility": { "minimum": "3.6.2", "verified": "4.0.4" } }]
  },
  "esmodules": ["scripts/shadowdark-enhancer.mjs"],
  "styles": [{ "src": "styles/shadowdark-enhancer.css" }],
  "languages": [{ "lang": "en", "name": "English", "path": "languages/en.json" }],
  "socket": true,
  "url": "https://github.com/DimitroffVodka/shadowdark-enhancer",
  "manifest": "https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json",
  "download": "https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.zip"
}
```

### 4.2 File layout

```
shadowdark-enhancer/
├── module.json
├── README.md
├── CHANGELOG.md
├── languages/en.json
├── styles/shadowdark-enhancer.css
├── templates/
│   ├── crawl-strip.hbs
│   └── npc-action-menu.hbs
└── scripts/
    ├── shadowdark-enhancer.mjs           # Entry: init / ready hooks, MODULE_ID, settings.register, Strip.init
    ├── crawl-state.mjs                   # Singleton state, world-setting persistence, socket sync
    ├── crawl-strip.mjs                   # Top-bar mount, render queue, hook registration
    ├── initiative-manager.mjs            # OoC roll & reset, combat init helpers, clockwise-respecting sort
    ├── movement-tracker.mjs              # Turn-start capture, ruler color, budget compute, rollback
    ├── npc-action-menu.mjs               # Per-combatant action HUD dropdown
    ├── settings.mjs                      # Settings registration (one place, called from init)
    ├── icons.mjs                         # Inline SVG strings (forked from Vagabond Crawler)
    ├── dialog-helpers.mjs                # Forked dialog wrappers
    └── stat-panels/
        ├── hp-panel.mjs                  # HP widget: read system.attributes.hp.{value,max}; click-to-edit (GM)
        ├── movement-panel.mjs            # Movement widget: budget remaining + red-when-over
        └── luck-panel.mjs                # Luck widget: pips, click-to-spend via system actor method
```

### 4.3 What is hard-forked from Vagabond Crawler

The following Vagabond Crawler scripts are copied as starting points and then refactored:

| Vagabond Crawler file | Shadowdark Enhancer file | Refactor notes |
|---|---|---|
| `scripts/crawl-strip.mjs` | `scripts/crawl-strip.mjs` | Keep: mount logic, render-queue, bounds tracker, sidebar/scene-nav offset math. Replace: hero/gm phase logic, stat panel rendering (delegate to `stat-panels/*`), combatant filter rule kept (uses `token.hidden || combatant.hidden`). |
| `scripts/crawl-state.mjs` | `scripts/crawl-state.mjs` | Keep: world-setting + socket sync pattern, getter/setter shape, init bootstrap. Replace: phase model with 3-state `mode` enum; drop `members`, `elapsedMins`, `clockId` fields. |
| `scripts/movement-tracker.mjs` | `scripts/movement-tracker.mjs` | Keep: `VCSTokenRuler` subclass approach, green/red waypoint color, "rollback to turn start" implementation, hook pattern. Replace: source of "starting position" → always token-turn-start (combat) or crawl-turn-start (OoC); drop Vagabond's "rush" speed concept. |
| `scripts/npc-action-menu.mjs` | `scripts/npc-action-menu.mjs` | Keep: dropdown anchor/positioning, tab strip skeleton, event-binding helpers. Replace: action set (see §5.6). |
| `scripts/combat-helpers.mjs` | (merged into `stat-panels/movement-panel.mjs`) | Vagabond's `getEffectiveMovement` is rewritten for SD; the rest is not relevant. |
| `scripts/icons.mjs` | `scripts/icons.mjs` | Verbatim copy; trim icons we don't use in MVP. |
| `scripts/dialog-helpers.mjs` | `scripts/dialog-helpers.mjs` | Verbatim copy. |
| `styles/vagabond-crawler.css` | `styles/shadowdark-enhancer.css` | Fork; rename all selector prefixes `.vc-*` → `.sde-*`; keep layout/spacing/animation; restyle accent colors to a Shadowdark-flavored palette (TBD palette — implementation detail). |

### 4.4 Mount point

The strip mounts as `<div id="shadowdark-enhancer-strip" class="sde-strip">` prepended to Foundry's `#interface` element. Fall back to prepending to `#ui-top` if `#interface` is unavailable.

The strip listens for `resize` and `renderSceneNavigation` / `collapseSidebar` events and recomputes its left/right bounds so it doesn't overlap the scene navigation or sidebar — same approach as Vagabond Crawler's strip.

## 5. State Model

### 5.1 Singleton: `CrawlState`

```js
// Stored in world setting "shadowdark-enhancer.crawlState"; broadcast via socket on every mutation.
{
  mode: "off" | "crawl" | "combat",
  crawlTurn: 0,                       // integer; increments on "Next Crawl Turn"
  oocInitiative: {                    // empty object when not active; keyed by tokenId (not actorId)
                                      // so duplicate-actor tokens in one scene each get their own roll
    [tokenId]: { roll: number, advantage: -1|0|1 }
  }
}
```

`mode` transitions:

```
            ┌─────────────┐
            │     off     │ ← (GM toggles crawl off, no combat)
            └──────┬──────┘
            GM toggles│      ▲
              crawl on│      │ deleteCombat fires
                     ▼      │ (and no crawl was active)
            ┌─────────────┐ │   ┌──────────────┐
            │    crawl    │─┴──▶│    combat    │
            └─────────────┘     └──────────────┘
                     ▲      combatStart fires
                     │ deleteCombat / combatEnd fires
                     │ (with crawl previously active)
```

- `off` → no strip rendered (or strip in a minimal "Start Crawl" pinned state — see §6.4)
- `crawl` → out-of-combat layout (marching order + OoC movement budget)
- `combat` → in-combat layout (initiative order + round tracker + combat movement red-line)

### 5.2 Per-token flags

Stored as `token.flags["shadowdark-enhancer"]`:

| Flag | Type | Purpose |
|---|---|---|
| `turnStart` | `{x: number, y: number} \| null` | Position when this combatant's turn began. Set on `combatTurn` hook for the active combatant; used by `movement-tracker` to compute the in-combat red-line. Cleared at `deleteCombat`. |
| `crawlAnchor` | `{x: number, y: number} \| null` | Position when current crawl turn began. Set on every token at `crawlTurn` advance and at `crawl-mode-on`; used to compute the OoC 90 ft budget. Cleared when `mode` returns to `off`. |

Rationale for token flags vs. singleton-resident: positions are per-token and updated frequently; storing them in the singleton would force a setting write + socket emit on every token's turn change. Token flags update with the token's own document write (which already broadcasts), so we get the sync for free.

### 5.3 Mode-transition driver hooks

| Hook | Handler |
|---|---|
| `combatStart` | `CrawlState.update({ mode: "combat" })`. Set `turnStart` flag for the first combatant. |
| `combatTurn` | Update `turnStart` flag for the new active combatant; clear ruler for outgoing. |
| `combatRound` | (No state change beyond what `combatTurn` does — round counter is read live from `game.combat.round`.) |
| `deleteCombat` | If a `crawl` toggle was on before combat began, set `mode: "crawl"`; otherwise `mode: "off"`. Clear all `turnStart` flags. |
| `updateToken` (hidden change) | If GM, sync `combatant.hidden ↔ token.hidden`. |
| `updateCombatant` (hidden change) | If GM, sync `token.hidden ↔ combatant.hidden`. |

## 6. UI — Crawl Strip

### 6.1 Layout (mode = `crawl`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [SDE] [Crawl ON ●] [Crawl Turn: 7] [Next Turn]   ··· marching order ···      │
│                                                                              │
│  ┌──── PC ────┐ ┌──── PC ────┐ ┌──── PC ────┐ ┌──── PC ────┐                 │
│  │ Portrait    │ │            │ │            │ │            │                 │
│  │ Name        │ │            │ │            │ │            │                 │
│  │ HP 12 / 18  │ │            │ │            │ │            │                 │
│  │ Mv 60/90    │ │            │ │            │ │            │                 │
│  │ Luck ●○○    │ │            │ │            │ │            │                 │
│  │ Init 14     │ │            │ │            │ │            │                 │
│  └─────────────┘                                                              │
│                                          [Roll Initiative] [Reset] [Settings]│
└──────────────────────────────────────────────────────────────────────────────┘
```

- Header row (left): module badge, mode pill (crawl/combat), crawl turn counter, "Next Crawl Turn" button (GM only).
- Card row: one card per PC, sorted by OoC initiative roll descending. Unrolled PCs render at the right with no init number and a "—" placeholder.
- Footer (right): "Roll Initiative" (rolls for all PCs that don't have an OoC init yet), "Reset Initiative" (GM, clears `oocInitiative`), "Settings" gear (GM, opens module settings).

### 6.2 Layout (mode = `combat`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [SDE] [Combat ●] [Round 3 — Turn 2/5]               ··· initiative order ··· │
│                                                                              │
│  ┌── ACTIVE ──┐ ┌─── PC ────┐ ┌─── NPC ───┐ ┌─── PC ────┐  (hidden NPCs      │
│  │ NPC Goblin  │ │            │ │            │ │            │   suppressed)    │
│  │ HP   4 / 7  │ │            │ │            │ │            │                  │
│  │ Mv  20/30   │ │            │ │            │ │            │                  │
│  │ Luck —      │ │            │ │            │ │            │                  │
│  │ Init 18     │ │            │ │            │ │            │                  │
│  │  ▼ HUD ▼    │ │            │ │            │ │            │                  │
│  └─────────────┘                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Header row (left): module badge, mode pill (`Combat ●`), round + turn counter pulled live from `game.combat.round` / `.turn`.
- Card row: combatants in `game.combat.turns` order. Active combatant highlighted with a distinct border and a "▼ HUD ▼" affordance (the per-combatant dropdown — §5.6).
- Hidden combatants (`token.hidden || combatant.hidden`) are omitted from the card row entirely.
- NPC cards show HP and Movement; Luck cell shows `—` (NPCs don't have luck tokens in SD).
- Footer (right): none in combat (combat tracker provides advance/back controls).

### 6.3 Stat panel widgets

Each stat is a small ES module exporting `{ render(actor, mode) → html, attach(element, actor) }`. Keeps the strip's main render function thin and makes adding new stats later (e.g., from `unnatural-selection`) a single-file change.

| Widget | Reads | Editable |
|---|---|---|
| `hp-panel` | `actor.system.attributes.hp.value`, `.max` | GM click → numeric input popup; sends `actor.update({"system.attributes.hp.value": n})` |
| `movement-panel` | Computed budget (see §7) | No direct edit; click opens settings for default OoC budget |
| `luck-panel` | `actor.system.luck.{available, remaining}` and `actor.system.hasLuckToken` (boolean getter). Schema lives on Player actors only — `actor.system.hasOwnProperty("luck")` is false on NPCs. | Click pip → `await actor.system.useLuckToken()` (confirmed via live MCP probe as the exact spend method on `PlayerSD`). Pip rendered only when `hasLuckToken` is true. NPCs render `—` and have no click handler. |

**Display rules:**

- HP cell turns red when `value <= 0`. No dying/dead distinction at MVP.
- Movement cell turns red when over budget (see §7).
- Luck pips: if `remaining > 0`, render `remaining` filled pips of a Shadowdark-flavored color; else if `available`, render one filled pip; else render one empty pip. NPCs render `—`.

### 6.4 `mode = "off"` strip

When no crawl is active and no combat is running:
- Strip collapses to a single header row with `[Start Crawl]` button (GM only).
- Players see nothing — the strip is hidden for non-GMs in `off` mode.

### 6.5 Render flow

1. Any state mutation, hook fire, or system setting change calls `CrawlStrip.queueRender()`.
2. `queueRender` debounces to next animation frame.
3. `render()` computes the combatant list from current state + `game.combat`, renders the Handlebars template, and re-attaches event listeners.
4. All event listeners are delegated to the strip's root element to avoid leaking listeners on re-render.

### 6.6 Combat HUD dropdown (`npc-action-menu`)

Triggered by the "▼ HUD ▼" affordance on the active combatant's card. Slides down beneath the card. Tabs:

| Tab | Contents |
|---|---|
| **Status** | HP +/− buttons, condition toggles using system condition list, spend Luck button (PCs only) |
| **Actions** | Buttons that invoke `actor.sheet.render(true)` and select the Items tab — passthrough to the existing sheet for attacks/spells. (Deeper in-place attack execution is a follow-up — see §10.) |
| **Movement** | "Rollback to Turn Start" button (combat mode only) — calls `movement-tracker.rollbackToStart(token)` |

The dropdown closes on outside-click and on combatant turn change.

## 7. Movement Tracking

### 7.1 Combat mode (red-line at 30 ft default, from turn-start position)

- On `combatTurn`: capture the active combatant's current canvas position to `token.flags["shadowdark-enhancer"].turnStart`.
- `VCSTokenRuler` subclass (forked from Vagabond): every waypoint added during a measurement is colored green if the cumulative distance from `turnStart` is ≤ `combatMovementDefault` (default 30 ft, module setting), red if over.
- "Rollback to Turn Start" (in HUD dropdown): moves the token back to `turnStart` coordinates with `token.update({x, y})` and resets the ruler.
- Movement in combat is **not enforced** (per user spec) — the ruler just colors red and the strip's Movement cell goes red. Players can still confirm the move.

### 7.2 Crawl mode (90 ft default, resets on crawl-turn advance)

- On `Next Crawl Turn` click (GM only): increment `CrawlState.crawlTurn`, then for every token in the active scene, write `flags["shadowdark-enhancer"].crawlAnchor = { x, y }`.
- Same `VCSTokenRuler`: cumulative distance from `crawlAnchor` measured against `oocMovementBudget` (default 90 ft, module setting). Green within budget, red over.
- Enforcement is **on by default** in crawl mode (per user spec — "Enforce movement speed"): if `oocEnforceBudget` setting is true, the ruler refuses to commit a move that would exceed budget (mirroring Vagabond's enforce logic).
- Setting `oocEnforceBudget` is GM-toggleable. Default: **true**.

### 7.3 Settings

| Setting | Scope | Type | Default |
|---|---|---|---|
| `combatMovementDefault` | world | int (ft) | 30 |
| `oocMovementBudget` | world | int (ft) | 90 |
| `oocEnforceBudget` | world | bool | true |
| `hideHiddenNpcCards` | world | bool | true (matches user spec — hidden NPCs do not show on the strip) |
| `warnIfCrawlHelperEnabled` | world | bool | true |

## 8. Initiative Handling

### 8.1 Out-of-combat (marching order)

- Initiative formula: `1d20` plus the actor's `system.roll.initiative.bonus`, applying `system.roll.initiative.advantage` via the system's existing `applyAdvantage` helper (located in the compiled bundle, grep-confirmed during brainstorming).
- "Roll Initiative" button on the strip footer:
  - GM: rolls for every PC token in the scene that doesn't already have an OoC init in `CrawlState.oocInitiative`. Result is whispered to GM in chat (no spoilers).
  - Player: rolls only for their owned characters.
- "Reset Initiative" button: GM only. Clears `CrawlState.oocInitiative`.
- OoC init is **persisted** in `CrawlState.oocInitiative` until GM clicks Reset. Switching scenes does not auto-clear (per user choice).

### 8.2 In-combat

- Standard Foundry initiative — each combatant rolls individually via the Combat tracker. Strip reads `game.combat.turns` for order.
- "Clockwise Initiative" system setting respected automatically because Foundry's `game.combat.turns` is already in the order the system enforces.
- Strip does **not** re-implement initiative rolling for combat — defers to the Combat tracker.

## 9. Coexistence with `shadowdark-crawl-helper`

At `ready` hook, if `game.modules.get("shadowdark-crawl-helper")?.active === true`:
- Show a non-blocking notification (warn level): "Shadowdark Enhancer detected `shadowdark-crawl-helper` is also enabled. For best results, disable Crawl Helper."
- Notification suppressible via `warnIfCrawlHelperEnabled` setting.
- Mount the strip regardless. No DOM interference logic — if Crawl Helper renders something that overlaps, that's the user's signal to disable it.

## 10. Out-of-scope (deferred to future milestones)

For clarity in the implementation plan and to prevent scope creep:

- **Bottom bar shell** (M2): Add the bottom bar with mode-aware contents but no features wired beyond Begin/Delete Encounter + Add Tokens.
- **Lights** (M3): Tap `LightSourceTrackerSD`; render torch countdowns and per-PC light state.
- **Rest + Ration tracker** (M3): Consume rations on rest; pull rest macro from `shadowdark-community-content` compendium.
- **Encounters** (M4): Build table, browse NPC (incl. `unnatural-selection` packs), roll tables (incl. `shadowdark-extras` rolltables), monster creator.
- **Loot & economy** (M5): Loot generator, merchant shop, party inventory, drag-and-drop from inventory.
- **Session tracker** (M6): Recap, XP-from-loot-value.
- **Long-tail TODOs:** PDF character export (M7), character generator wrapper (system has `CharacterGeneratorSD` built-in — likely just an integration touch, not a rebuild).
- **In-place attack execution from HUD** (post-MVP polish): currently the HUD's Actions tab is a sheet passthrough.
- **Stamina, Boons, or other custom stats from community modules**: stat-panel framework supports them, but no widget shipped for them in M1.

## 11. Manual UAT checklist

Validate in a Foundry v14 world with: shadowdark system v4.0.x + this module + a test scene with at least 2 PCs and 2 NPCs.

### Strip mount & lifecycle
- [ ] Strip appears at top of screen when module loads
- [ ] Strip is hidden for non-GM users when `mode = off`
- [ ] Strip repositions correctly when sidebar is collapsed/expanded
- [ ] Strip repositions correctly when scene navigation expands/collapses
- [ ] No console errors on world load, scene change, or refresh

### Crawl mode
- [ ] GM "Start Crawl" toggles `mode → crawl`; strip switches to crawl layout
- [ ] "Roll Initiative" rolls for all PC tokens lacking an OoC init
- [ ] Reset clears OoC init for all PCs
- [ ] Marching order matches descending OoC init values
- [ ] "Next Crawl Turn" increments counter and resets every token's `crawlAnchor`
- [ ] OoC movement ruler shows green within 90 ft, red over
- [ ] With `oocEnforceBudget = true`, a move past 90 ft refuses to commit
- [ ] With `oocEnforceBudget = false`, the move commits but ruler colors red

### Combat mode
- [ ] `combatStart` flips `mode → combat`; strip switches to combat layout
- [ ] Round + turn counter match `game.combat.round` / `.turn`
- [ ] Hidden NPCs (via `token.hidden` or `combatant.hidden`) are absent from the strip
- [ ] Toggling token.hidden from canvas updates combatant.hidden (and vice versa)
- [ ] Active combatant card is visually distinguished
- [ ] Movement ruler colors green within 30 ft of turn-start, red over
- [ ] "Rollback to Turn Start" button in HUD moves token back to capture point
- [ ] `deleteCombat` restores `mode` to `crawl` (or `off`) and clears `turnStart` flags

### Stat panels
- [ ] HP value/max display correctly for PCs and NPCs
- [ ] HP turns red at value ≤ 0
- [ ] Movement cell shows budget remaining (e.g. "60/90") in crawl, "20/30" in combat
- [ ] Movement cell turns red when over budget
- [ ] Luck pips show `remaining` count for PCs with `remaining > 0`
- [ ] Luck pips show 1 filled pip for PCs with `available = true, remaining = 0`
- [ ] Clicking a Luck pip decrements via the system's luck-spend path; chat message fires
- [ ] NPCs show `—` for Luck

### Combat HUD dropdown
- [ ] "▼ HUD ▼" affordance appears only on the active combatant in combat mode
- [ ] Dropdown opens beneath the card; closes on outside click and on turn change
- [ ] Status tab: HP +/− buttons modify HP correctly
- [ ] Status tab: condition toggles work for SD conditions
- [ ] Status tab: spend Luck button mirrors the click-pip behavior
- [ ] Actions tab: opens the actor sheet
- [ ] Movement tab: rollback works

### Multi-client sync
- [ ] State mutations on GM client propagate to all players via socket
- [ ] OoC init rolls by a player appear on GM's strip without refresh
- [ ] `crawlTurn` advance on GM client updates all players' strips

### Coexistence
- [ ] With `shadowdark-crawl-helper` enabled, a warning notification appears at ready
- [ ] Strip mounts regardless of crawl-helper status

## 12. Risks & open questions

| # | Risk / Question | Mitigation |
|---|---|---|
| R1 | ~~Shadowdark's actor movement field location not yet confirmed~~ **RESOLVED via live MCP probe (2026-05-14):** PC actors have NO movement field at all (no `system.move`, `system.movement`, `system.attributes.movement`, `system.attributes.speed`, or `system.speed`). The strip's combat budget is module-setting-only (default 30 ft) — no per-PC fallback needed. **NPC actors DO have `system.move` as a string ("near", "double near", "near (fly)") plus `system.moveNote`** — see R7 for the deferral. |
| R2 | "Clockwise Initiative" interaction with strip's active-combatant highlighting | We read `game.combat.turns` which is already the clockwise-reordered list; if a bug emerges, the fix is in `applyClockwiseInitiative` handling, not the strip. |
| R3 | Per-token flag writes on every turn change could thrash on long combats | Each `combatTurn` is one flag write per active combatant — minimal. If a perf issue surfaces, move `turnStart` into an in-memory map keyed by token ID. |
| R4 | `VCSTokenRuler` Vagabond subclass tightly couples to specific Foundry ruler internals | Foundry v14 compat is verified on Vagabond Crawler v1.17.0; if v15 changes the ruler API, this is the highest-churn piece. Acceptable risk for MVP. |
| R5 | NPC Luck rendering: are there any SD NPC sheets that *do* have luck (e.g. from unnatural-selection)? | MVP: if `actor.type !== "Player"`, render `—`. If a community module adds NPC luck later, the luck-panel widget already checks `actor.system.luck` and will Just Work; we'd flip the type guard. |
| R6 | OoC initiative bonus + advantage handling for non-standard ancestries/classes | System's `applyAdvantage` helper handles this; we delegate. Edge cases are the system's problem, not ours. Exposed via `globalThis.shadowdark.dice.applyAdvantage` (confirmed via live MCP probe). |
| R7 | NPCs have `system.move` as a string ("near", "double near", "far", "near (fly)") but MVP uses flat 30 ft for all combatants per user spec | **Deferred.** MVP renders all NPCs against the same 30 ft red-line. A "double near" NPC will show a misleading red at 30 ft when its real budget is ~60 ft. This is cosmetic — combat movement is not enforced — and matches the user's stated spec ("default 30 ft, not enforced, just turns red"). Follow-up milestone may add a string→feet mapping (close=5, near=30, double near=60, far=60+) and use it as the per-combatant combat budget. |

## 13. Implementation order (sketch — full plan in writing-plans)

A bite-sized order for the writing-plans skill to refine into discrete tasks:

1. **Skeleton + manifest + init hook + settings stub** — module loads in Foundry, registers an init log line, no UI.
2. **`CrawlState` singleton** — world setting, socket sync, getters/setters, mode transitions wired to combat hooks. No UI yet; verify via console.
3. **Strip mount + empty render** — strip appears at top of screen with header only (mode pill, no cards). Bounds tracking works.
4. **Stat panel widgets (HP, Movement, Luck)** — render against a hand-built fake actor in a test scene.
5. **Crawl-mode layout** — marching order, OoC init roll, reset.
6. **Combat-mode layout** — combatant cards from `game.combat.turns`, hidden filter, round/turn header.
7. **`VCSTokenRuler` fork + turn-start capture + ruler color** — combat red-line.
8. **`crawlAnchor` capture on `Next Crawl Turn` + OoC enforcement** — crawl budget.
9. **Combat HUD dropdown (`npc-action-menu`)** — Status/Actions/Movement tabs.
10. **Hidden-NPC sync hooks** — `token.hidden ↔ combatant.hidden` bidirectional.
11. **Coexistence warning** — `shadowdark-crawl-helper` detection at ready.
12. **CSS polish + Shadowdark palette** — Vagabond CSS forked, recolored, classes renamed.
13. **README + CHANGELOG + manifest version bump to 0.1.0** — ready for first release.
14. **Manual UAT run-through** (§11 checklist) before tagging.

End of design.
