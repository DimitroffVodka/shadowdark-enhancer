# Random Encounter System — Phase 1 Slices 1a + 1b

**Date:** 2026-05-15
**Status:** Design approved — ready for implementation plan
**Scope:** Slice 1a (Encounter Check button + flow) + Slice 1b (Encounter Roller window shell + Roll Tables tab + Result card)
**Replaces:** `shadowdark-crawl-helper` module (functionally — user disables the other module manually)

---

## Goal

Bring Vagabond Crawler's Random Encounter system to Shadowdark Enhancer, adapted to Shadowdark's rules-as-written. Phase 1 delivers the player-facing encounter loop in two slices:

- **Slice 1a:** The "Encounter Check" affordance on the Crawl Bar — a one-click d6 roll against an adjustable threshold, with chat result and optional auto-pause on hit.
- **Slice 1b:** The Encounter Roller window — a 4-tab Application that auto-opens on a hit. Only the **Roll Tables** tab is functional in 1b (Build Table, Browse NPCs, Monster Creator ship as disabled stubs so the UI shape is locked from day one). The result card displays Distance, Activity, and Reaction rolls per Shadowdark RAW with per-facet re-roll.

Together these two slices give a working encounter loop: any existing world `RollTable` can be wired as the active encounter table; one click runs the check, auto-opens the roller, auto-rolls the table, and produces a fully populated result card.

---

## Why this scope

Vagabond's encounter system is 5400+ LOC across encounter-tools (1153) and Monster Creator (2400+). Shipping it as a single slice would be a multi-week effort with no intermediate deliverables. Slice 1a+1b is the smallest cut that produces a usable feature:

- 1a alone gives players "I can click this and roll a d6 with a chat result" — useful but limited.
- 1b adds the visual roller with full RAW results — completes the per-round loop.
- Authoring tools (Build Table, Browse NPCs) and Monster Creator follow in later slices but aren't blocking the everyday GM workflow.

---

## What it replaces

- **`shadowdark-crawl-helper`** module — covers similar ground (crawl combat document type, encounter helpers). User states it is inactive; no detect-and-warn needed.
- Existing **disabled "Encounter" placeholder** on the Crawl Bar (`crawl-bar.mjs:136`) becomes the live button.

---

## Architecture

### File layout

```
scripts/encounter/
  encounter-check.mjs       # NEW — Slice 1a: d6 roll, chat post, on-hit branch
  encounter-roller-app.mjs  # NEW — Slice 1b: ApplicationV2 window shell + 4 tabs
  encounter-result.mjs      # NEW — Slice 1b: Distance/Activity/Reaction roll helpers + lookups
  encounter-tables.mjs      # NEW — Slice 1b: Roll Tables tab implementation
templates/
  encounter-roller.hbs      # NEW — Slice 1b: single Handlebars template covering all 4 tabs
styles/shadowdark-enhancer.css   # MODIFY — add `.sde-encounter-*` rules
scripts/crawl-bar.mjs       # MODIFY — wire Encounter button (left-click + right-click menu) and RollTable drop target
scripts/settings.mjs        # MODIFY — register 5 new settings
scripts/shadowdark-enhancer.mjs   # MODIFY — import encounter module, expose API
```

The `scripts/encounter/` subfolder gives later slices (1c Build Table, 1d Browse NPCs, 1e Monster Creator) a home without growing existing files. Templates folder gets one shared `.hbs` file covering all four tabs — same pattern Vagabond uses.

### Public API

Exposed on `game.shadowdarkEnhancer.encounter`:

| Method | Purpose |
|---|---|
| `check()` | Perform one encounter check (1d6 vs threshold). Returns roll total + hit boolean. |
| `openRoller(initialTab = "tables")` | Open the roller window. Idempotent — reuses existing instance, brings to front, switches to requested tab. |
| `setActiveTable(uuid \| null)` | Settings shortcut. Pass `null` to clear. |
| `getThreshold()` / `setThreshold(n)` | Settings shortcuts for the d6 threshold (1–5). |

### Settings (registered in `scripts/settings.mjs`)

All `scope: "world"`, namespace `shadowdark-enhancer`:

| Key | Type | Default | UI surface |
|---|---|---|---|
| `encounterThreshold` | Number 1–5 | `1` | Right-click menu on Encounter button |
| `encounterTableUuid` | String | `""` | "Set as Active" button in Roll Tables tab; drag RollTable onto Encounter button; ✕ clear button in right-click menu |
| `encounterRollGMOnly` | Boolean | `true` | Foundry settings menu |
| `pauseOnEncounter` | Boolean | `true` | Foundry settings menu |
| `autoRollActiveTable` | Boolean | `true` | Foundry settings menu. If `false`, hit opens the roller but doesn't auto-roll — GM picks. |

---

## Slice 1a — Encounter Check button + flow

### Crawl Bar button

The disabled placeholder at `crawl-bar.mjs:136` becomes live:

- **Position:** unchanged — same slot in the active-crawl button row.
- **Icon:** `fa-dice-d6`
- **Label:** `Encounter`
- **Class:** drop `sde-bar-disabled`
- **Tooltip:** `Left-click: open Encounter Roller · Right-click: menu`
- **Drop target:** accepts a `RollTable` drag; on drop, sets `encounterTableUuid` and toasts the table name.

### Click model

| Click | Action |
|---|---|
| Left-click | `EncounterCheck.openRoller("tables")` — opens the roller on the Roll Tables tab |
| Right-click | Opens custom context menu (DOM popover styled with `--sde-bar-*` tokens — not the browser context menu) |
| Drag-drop a RollTable | Writes `encounterTableUuid`, toasts confirmation |

### Right-click menu structure

```
┌─ Encounter ──────────────────┐
│ 🎲 Encounter Check           │  ← runs check, closes menu
├──────────────────────────────┤
│ Threshold (current: 1 in 6)  │  ← header, non-clickable
│  ● 1 in 6 (RAW default)      │
│  ○ 2 in 6                    │
│  ○ 3 in 6                    │
│  ○ 4 in 6                    │
│  ○ 5 in 6                    │
├──────────────────────────────┤
│ Active Table: Forest d6 ✕    │  ← name + clear button, or "(none)"
└──────────────────────────────┘
```

- Selected threshold shows a filled radio.
- Clicking a radio writes the setting immediately and updates the dot live (no Save button).
- ✕ next to the active-table name clears `encounterTableUuid` and updates the label to `(none)`.
- Clicking outside the menu closes it.
- The whole menu is suppressed for non-GM users.

### Check flow (end-to-end)

```
1. User right-clicks Encounter button → menu
2. Clicks "Encounter Check"
3. Roll new Roll("1d6").evaluate()
4. Compare total <= encounterThreshold
5. ChatMessage.create() with:
   HIT  → "🎲 Encounter Check — rolled 1, encounter occurs (threshold 1-in-6)"
   MISS → "🎲 Encounter Check — rolled 4, the dungeon is quiet (threshold 1-in-6)"
   - Whispered to GM only if encounterRollGMOnly === true
   - Card uses red accent border for HIT, muted gray for MISS
6. If MISS → done.
7. If HIT:
   a. If pauseOnEncounter → game.togglePause(true)
   b. openRoller("tables")
   c. If autoRollActiveTable AND encounterTableUuid set:
      → setTimeout(200ms, let window paint) → roller.rollActiveTable()
   d. If no active table set → roller opens on Roll Tables tab, result panel shows:
      "No active table — pick one and click Roll, or right-click the Encounter button to set one"
```

### Chat card formatting

Routes through `shadowdark.dice.rollFromConfig` for visual consistency with system chat cards, falling back to plain `Roll#toMessage` if the system API is unavailable. Single line of flavor + the roll display. HIT/MISS distinguished by a CSS border-color rule on the card container.

---

## Slice 1b — Encounter Roller window + Roll Tables tab + Result card

### Window shell

`EncounterRollerApp` extends `HandlebarsApplicationMixin(ApplicationV2)`. Singleton — `openRoller()` reuses the existing instance if rendered, otherwise creates one.

- **Width:** 720px
- **Height:** auto
- **Position:** restored from per-user `flags.shadowdark-enhancer.encounterRollerPosition` (left/top) on render; saved on close
- **Header title:** "Random Encounter"
- **Header close button:** standard Foundry close

### Tab bar

Four buttons under the header, matching the screenshot exactly:

| Tab key | Label | FontAwesome icon | 1b state |
|---|---|---|---|
| `tables` | Roll Tables | `fa-table-list` | ✅ Functional |
| `build` | Build Table | `fa-hammer` | ⚠️ Disabled stub ("Coming in a later slice") |
| `browse` | Browse NPCs | `fa-user-group` | ⚠️ Disabled stub |
| `creator` | Monster Creator | `fa-wand-magic-sparkles` | ⚠️ Disabled stub |

**Why ship disabled stubs from day one:** the UI shape is locked, the user can see what's coming, and adding a tab in a later slice is purely "remove `disabled` attribute + wire the panel" with no shell refactor.

**Tab switching:** clicking sets `this._mode` and calls `this.render()`. State (`_mode`, `_selectedTableId`, `_lastResult`) lives as instance fields — survives re-renders, lost on close. Matches Vagabond's pattern.

### Roll Tables tab

**Top control row:**

- **Folder-grouped table picker** — `<select>` of every world `RollTable`, grouped with `<optgroup>` by Foundry folder. The currently-active table is marked with a ★ prefix in its option label.
- **Set as Active button** — writes the selected table's UUID to `encounterTableUuid`, toasts confirmation, refreshes the ★ marker.
- **Roll button** — calls `table.draw({displayChat: false, resetTable: false})`, parses the result, populates the Result Panel below.

**Result Panel** sits below the controls. Empty state: "Roll a table to see the result."

**Folder-exclusion feature** (settings + dialog to hide noise folders): **deferred** to a later slice. For 1b every world table is listed.

### Result card

The card renders when a table draw produces a monster entry:

```
┌─ Encounter Result ───────────────────── 📋 Post  🎯 Place ┐
│                                                            │
│  🐺  3 × Wolf                                             │  ← monster + count
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                            │
│  📏 Distance     1d6 = 2   →  Near       🔄              │
│  🎭 Activity    2d6 = 7   →  Building/nesting   🔄       │
│  💬 Reaction    2d6+CHA   = 4 + (0)  → Hostile   🔄      │
│                                                            │
│     Apply CHA mod: [ 0 ▲▼ ]   ← optional, recalcs band   │
└────────────────────────────────────────────────────────────┘
```

**Components:**

- **Monster + count row** — actor portrait, count, name. Count rolled from the slot's `appearing` formula (see "Count parsing" below) or defaults to 1.
- **Distance row** — 1d6, RAW table (1=Close, 2–4=Near, 5–6=Far), individual 🔄 re-roll.
- **Activity row** — 2d6, RAW table (2–4 Hunting, 5–6 Eating, 7–8 Building/nesting, 9–10 Socializing/playing, 11 Guarding, 12 Sleeping), individual 🔄 re-roll.
- **Reaction row** — 2d6, RAW band table (≤6 Hostile, 7–8 Suspicious, 9 Neutral, 10–11 Curious, ≥12 Friendly). Shows raw roll + applied CHA mod in parentheses.
- **CHA mod stepper** — number input, default 0. Changes recalculate the attitude band without consuming a re-roll (RAW: "may add Charisma modifier to the *check*" — recalc is correct).
- **Header actions:**
  - 📋 **Post** — emits a formatted `ChatMessage` with the full card content. Honors `encounterRollGMOnly`.
  - 🎯 **Place** — closes the window, enters token-placement mode. Click on canvas to drop N copies of the monster's prototype token. Uses `Actor#getTokenDocument()` + `TokenDocument#create()`.

**Per-facet re-roll behavior:** re-rolling Distance does not touch Activity or Reaction. Each facet is independent. The card re-renders just the affected row (or the whole card — implementation detail) with the new roll values.

### Count parsing

For 1b we read the appearing count in this priority order:

1. `flags["shadowdark-enhancer"].appearing` on the table result (set by later Build Table slice)
2. Inline `[[/r N]]` formula in `result.description` (Foundry convention)
3. Default: `1`

If priority 1 or 2 yields a roll formula (e.g. `1d4`), evaluate it to get the count. Otherwise treat as literal integer.

### Lookup tables

In `encounter-result.mjs` as plain JS objects, sourced from `F:/Obsidian/Shadowdark/Rules/6) Game Master/Random Encounters.md`:

```js
export const DISTANCE = {
  1: "Close",
  2: "Near", 3: "Near", 4: "Near",
  5: "Far",  6: "Far",
};

export const ACTIVITY = {
  2: "Hunting", 3: "Hunting", 4: "Hunting",
  5: "Eating", 6: "Eating",
  7: "Building/nesting", 8: "Building/nesting",
  9: "Socializing/playing", 10: "Socializing/playing",
  11: "Guarding",
  12: "Sleeping",
};

export function reactionBand(total) {
  if (total <= 6)  return "Hostile";
  if (total <= 8)  return "Suspicious";
  if (total === 9) return "Neutral";
  if (total <= 11) return "Curious";
  return "Friendly";
}
```

### Edge cases handled in 1b

| Case | Behavior |
|---|---|
| Empty table draw (no monster UUID) | Card shows "Table draw produced no monster — check the table contents" with no facet rolls |
| Multi-group entries (`@UUID[…]{…}` in description) | Out of scope for 1b. Single-monster entries only. Treat extra UUIDs as plain text. |
| Roller already open when check hits | `openRoller()` is idempotent. Brings to front, switches to `tables` tab, runs `rollActiveTable()` if appropriate. |
| Active-table UUID points to a deleted table | Show "Active table not found — clear and pick again". Don't auto-clear (could be a sync issue). |
| Place Tokens with no active scene | Toast "No active scene" and abort. |

---

## Explicit non-goals (Slice 1b)

These are deferred to later slices or skipped entirely:

- **Build Table tab** (Slice 1c)
- **Browse NPCs tab** (Slice 1d)
- **Monster Creator tab** (Slice 1e — multi-part)
- **Excluded-folders dialog** (later slice)
- **Multi-group encounter parsing** (later enhancement)
- **Treasure 50% roll** (Phase 3 / loot slice)
- **Automatic encounter check on round end** (cadence-based: Unsafe/Risky/Deadly) — manual only for now
- **Coexistence detection for `shadowdark-crawl-helper`** — user disables manually

---

## Future enhancements (captured for later)

These came up during brainstorming and are explicitly out of Phase 1 Slice 1a/1b. They live here so they aren't lost:

| Enhancement | Where it fits | Notes |
|---|---|---|
| **PDF/text paste-import for Roll Tables** | Slice 1c or after | Add "📋 Import from text" button on Build Table tab. Textarea → parse common formats (`1-2 Goblin`, `3 Wolf`, etc.) → name-resolve monsters via compendium search → preview → create RollTable. Check `shadowdark-pdf-importer` first to see if it already handles tables — integrate rather than duplicate if so. |
| **Multi-group encounter entry parsing** | Result card enhancement | Support `@UUID[…]{…}` references in table-result descriptions for multi-monster encounters. |
| **Excluded-folders dialog** | Roll Tables tab | Settings dialog + folder picker to hide noise tables (loot, etc.) from the dropdown. |
| **Treasure 50% roll** | Result card | Per RAW: "50% chance a randomly encountered creature has no treasure." Show as a fourth facet on the card with re-roll. Pairs with Phase 3 loot integration. |
| **Automatic encounter check on round end** | Crawl-loop integration | Setting for cadence: every round / every 2 rounds / every 3 rounds (matches RAW Unsafe / Risky / Deadly). Auto-fires on `CrawlState.nextRound()`. |
| **Roll-on-spawn HP for NPCs** | Phase 2 (combat polish) | Re-roll NPC HP from level when token dropped, for variety across multiples. |

---

## Open follow-up work (later in Phase 1)

| Slice | What it adds | Size estimate |
|---|---|---|
| **1c — Build Table tab** | Drag NPCs onto numbered slots, per-slot appearing formula, save as world RollTable | Medium — ~350 LOC + drag-drop |
| **1d — Browse NPCs tab** | Compendium source filter, name search, sort columns, "+" add to Build Table slots | Medium — ~400 LOC + cache. **Good Gemini handoff candidate** (mechanical) |
| **1e-i Monster Creator: shell + Identity + Images + Save** | Inline-mounted creator, save to world Actor (Shadowdark NPC schema) | Medium |
| **1e-ii MC: Stats + Resistances** | HP/Level/AC, damage/condition immunities (Shadowdark vocabulary) | Medium |
| **1e-iii MC: Actions** | NPC Attack + NPC Special Attack items, Quick-Pick library | Medium-Large |
| **1e-iv MC: Abilities** | NPC Feature items, Quick-Pick library | Medium |
| **1e-v MC: Bestiary loader** | Load from `shadowdark.bestiary` to pre-fill | Small |
| **1e-vi MC: Mutations** | **Likely skipped or deferred** — depends on Threat Level which doesn't exist in Shadowdark | n/a |

---

## Acceptance criteria for Slice 1a + 1b

When this design is implemented, all of the following must be true:

**Slice 1a:**
- [ ] Encounter button on Crawl Bar is live (no longer disabled) when crawl is active
- [ ] Left-click opens the roller on Roll Tables tab
- [ ] Right-click opens the custom menu with Check + threshold radios + active-table row
- [ ] Selecting a threshold radio updates the setting immediately
- [ ] Clicking "Encounter Check" rolls 1d6 and posts a chat card (HIT or MISS styled appropriately)
- [ ] GM-only whisper honored when `encounterRollGMOnly === true`
- [ ] `game.togglePause(true)` fires on HIT when `pauseOnEncounter === true`
- [ ] Dragging a RollTable onto the button sets `encounterTableUuid` and toasts
- [ ] Right-click menu suppressed for non-GM users

**Slice 1b:**
- [ ] Encounter Roller window opens with 4 tab buttons (Tables active, others disabled)
- [ ] Roll Tables tab shows all world RollTables grouped by folder
- [ ] Active table marked with ★ in the dropdown
- [ ] "Set as Active" writes `encounterTableUuid`
- [ ] "Roll" button draws the table and shows the result card
- [ ] Result card shows: monster portrait + count, Distance row, Activity row, Reaction row, CHA stepper
- [ ] Each facet has its own working 🔄 re-roll button
- [ ] CHA stepper changes recalculate Reaction band without re-rolling
- [ ] Distance lookup matches RAW (1=Close, 2–4=Near, 5–6=Far)
- [ ] Activity lookup matches RAW (all 6 outcomes)
- [ ] Reaction band matches RAW (5 tiers)
- [ ] 📋 Post posts the full card to chat
- [ ] 🎯 Place enters token-placement mode and drops N tokens on click
- [ ] HIT on encounter check auto-opens roller and auto-rolls active table (200ms delay)
- [ ] Roller is idempotent — re-opening doesn't create duplicates
- [ ] Window position persists across sessions
