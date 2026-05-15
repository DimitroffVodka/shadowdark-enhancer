# Shadowdark Enhancer — Top Crawl Strip (M1/MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `shadowdark-enhancer` v0.1.0 — a Foundry module that mounts a Top Crawl Strip for Shadowdark RPG, replacing `shadowdark-crawl-helper` with Vagabond-Crawler-quality plumbing adapted to Shadowdark mechanics.

**Architecture:** Hybrid hard fork of Vagabond Crawler. Copy proven UI/state/movement plumbing verbatim; rewrite mechanics-bound widgets (HP/Movement/Luck) fresh against Shadowdark's `system.luck.useLuckToken()`, `system.attributes.hp`, and per-token movement-budget flags. Module state is a single world-setting object (`{mode, crawlTurn, oocInitiative}`); per-token movement origin lives in token flags.

**Tech Stack:** Foundry VTT v13+ (verified 14.361) · Shadowdark system v4.0.x · ES modules · Handlebars templates · Foundry sockets · foundry-mcp-bridge for verification

**Spec reference:** `docs/superpowers/specs/2026-05-14-shadowdark-enhancer-top-strip-design.md`

**Vagabond Crawler reference paths** (the "fork source" for each task):
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/crawl-state.mjs`
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/crawl-strip.mjs`
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/movement-tracker.mjs`
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/npc-action-menu.mjs`
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/icons.mjs`
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/dialog-helpers.mjs`
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/styles/vagabond-crawler.css`

**Verification environment:** A live Foundry v14.361 world (`shadowdark-test`) is running locally with `foundry-mcp-bridge` connected as GM. Test actors: `Druchor` (id `fTwJht5Kb0ZVFZXx`) and `Test` (id `3zcjtqaEjJXeoOuD`), both type `Player`; `Acrobat` NPC also available. Use `mcp__foundry-vtt__evaluate`, `mcp__foundry-vtt__reload_foundry`, and `mcp__foundry-vtt__screenshot` for verification.

---

## Task 0: Repo + module skeleton

**Goal:** Module directory has a valid `module.json` that Foundry loads, plus a git repo with `.gitignore` and seed CHANGELOG/README. Foundry shows the module in the manage-modules list. No UI yet.

**Files:**
- Create: `module.json`
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `.gitignore`
- Create: `LICENSE` (MIT, matching Vagabond Crawler's choice — confirm with repo owner before tagging release; not blocking for MVP iteration)
- Create: `scripts/shadowdark-enhancer.mjs` (stub — exports `MODULE_ID`, logs an init line)
- Create: `languages/en.json` (empty `{}`)
- Create: `styles/shadowdark-enhancer.css` (empty)
- Create: `templates/.gitkeep` (placeholder so the dir exists)

**Acceptance Criteria:**
- [ ] `git init` succeeds; working tree clean after first commit
- [ ] Foundry's "Manage Modules" page shows "Shadowdark Enhancer" v0.1.0
- [ ] Activating the module + reloading the world produces a single console line: `shadowdark-enhancer | init`
- [ ] No console errors

**Verify:**
```
mcp__foundry-vtt__evaluate({
  expression: `return { active: game.modules.get("shadowdark-enhancer")?.active, version: game.modules.get("shadowdark-enhancer")?.version }`
})
```
Expected: `{ active: true, version: "0.1.0" }`

**Steps:**

- [ ] **Step 1: Initialize git repo**

Run in PowerShell:
```powershell
cd E:\FoundryVTTv14\Data\modules\shadowdark-enhancer
git init
```

- [ ] **Step 2: Write `.gitignore`**

```
# OS / editor
.DS_Store
Thumbs.db
.vscode/
.idea/

# Build artifacts (none for MVP, but reserve)
dist/
*.tgz
*.zip

# Node (in case we add tooling later)
node_modules/
package-lock.json

# Local development
*.log
```

- [ ] **Step 3: Write `module.json`**

```json
{
  "id": "shadowdark-enhancer",
  "title": "Shadowdark Enhancer",
  "description": "<p>Top Crawl Strip for Shadowdark RPG: out-of-combat marching order, in-combat initiative, HP/Movement/Luck readouts, movement-budget enforcement with turn-start rollback, and per-combatant action HUD.</p>",
  "version": "0.1.0",
  "authors": [
    { "name": "DimitroffVodka", "flags": {} }
  ],
  "compatibility": {
    "minimum": "13",
    "verified": "14.361"
  },
  "relationships": {
    "systems": [
      {
        "id": "shadowdark",
        "type": "system",
        "compatibility": { "minimum": "3.6.2", "verified": "4.0.4" }
      }
    ]
  },
  "esmodules": ["scripts/shadowdark-enhancer.mjs"],
  "styles": [{ "src": "styles/shadowdark-enhancer.css" }],
  "languages": [
    { "lang": "en", "name": "English", "path": "languages/en.json", "flags": {} }
  ],
  "socket": true,
  "url": "https://github.com/DimitroffVodka/shadowdark-enhancer",
  "manifest": "https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json",
  "download": "https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.zip",
  "flags": {}
}
```

- [ ] **Step 4: Write `scripts/shadowdark-enhancer.mjs` (init stub)**

```js
/**
 * Shadowdark Enhancer — entry point
 *
 * Forked patterns from vagabond-crawler. See docs/superpowers/specs/2026-05-14-shadowdark-enhancer-top-strip-design.md
 */

export const MODULE_ID = "shadowdark-enhancer";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});
```

- [ ] **Step 5: Write `README.md`**

```markdown
# Shadowdark Enhancer

Top Crawl Strip for Shadowdark RPG on Foundry VTT — out-of-combat marching order, in-combat initiative, HP/Movement/Luck readouts, movement-budget enforcement, and a per-combatant action HUD.

This module is the first milestone in a larger Shadowdark companion suite (encounters, lights, loot, session tracking — coming later).

## Requirements

- Foundry VTT v13+ (verified v14.361)
- Shadowdark RPG system v3.6.2+ (verified v4.0.4)

## Coexistence

- **`shadowdark-crawl-helper`**: this module is intended to replace it. With Crawl Helper enabled you'll see a warning on world load; disable Crawl Helper for best results.

## Installation

Paste the following manifest URL into Foundry's module installer:

```
https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json
```

## Status

Pre-release. See `CHANGELOG.md`.
```

- [ ] **Step 6: Write `CHANGELOG.md`**

```markdown
# Changelog

## [Unreleased]

### Added
- Initial module scaffold.
```

- [ ] **Step 7: Write `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 DimitroffVodka

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 8: Write `languages/en.json` (empty for now)**

```json
{}
```

- [ ] **Step 9: Write `styles/shadowdark-enhancer.css` (empty for now)**

```css
/* Shadowdark Enhancer styles — populated in later tasks. */
```

- [ ] **Step 10: Verify Foundry loads the module**

In Foundry: Game Settings → Manage Modules → enable "Shadowdark Enhancer" → Save Module Settings (reloads world).

Then run:
```
mcp__foundry-vtt__evaluate({ expression: `return { active: game.modules.get("shadowdark-enhancer")?.active, version: game.modules.get("shadowdark-enhancer")?.version }` })
```
Expected: `{ active: true, version: "0.1.0" }`

Check browser console:
```
mcp__foundry-vtt__evaluate({ expression: `return "see console for 'shadowdark-enhancer | init'"` })
```
(Open the F12 dev tools in Foundry; confirm the init log line is present.)

- [ ] **Step 11: Commit**

```powershell
git add module.json scripts/ styles/ templates/ languages/ README.md CHANGELOG.md LICENSE .gitignore
git commit -m "chore: scaffold module + manifest"
```

---

## Task 1: Settings registration

**Goal:** All five module settings from spec §7.3 are registered at `init` time and visible under Configure Settings → Module Settings → Shadowdark Enhancer.

**Files:**
- Create: `scripts/settings.mjs`
- Modify: `scripts/shadowdark-enhancer.mjs` (import + call `registerSettings()` from `init` hook)
- Modify: `languages/en.json` (add settings labels)

**Acceptance Criteria:**
- [ ] All five settings appear under Configure Settings → Module Settings → Shadowdark Enhancer
- [ ] Default values match spec §7.3 (combat: 30, ooc: 90, enforce: true, hide hidden: true, warn helper: true)
- [ ] Reading any setting via `game.settings.get("shadowdark-enhancer", "<key>")` returns the expected default

**Verify:**
```
mcp__foundry-vtt__evaluate({
  expression: `
    const MODULE_ID = "shadowdark-enhancer";
    return {
      combatMovementDefault: game.settings.get(MODULE_ID, "combatMovementDefault"),
      oocMovementBudget:     game.settings.get(MODULE_ID, "oocMovementBudget"),
      oocEnforceBudget:      game.settings.get(MODULE_ID, "oocEnforceBudget"),
      hideHiddenNpcCards:    game.settings.get(MODULE_ID, "hideHiddenNpcCards"),
      warnIfCrawlHelperEnabled: game.settings.get(MODULE_ID, "warnIfCrawlHelperEnabled"),
    };
  `
})
```
Expected: `{ combatMovementDefault: 30, oocMovementBudget: 90, oocEnforceBudget: true, hideHiddenNpcCards: true, warnIfCrawlHelperEnabled: true }`

**Steps:**

- [ ] **Step 1: Write `scripts/settings.mjs`**

```js
import { MODULE_ID } from "./shadowdark-enhancer.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, "combatMovementDefault", {
    name: "SDE.settings.combatMovementDefault.name",
    hint: "SDE.settings.combatMovementDefault.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 30,
  });

  game.settings.register(MODULE_ID, "oocMovementBudget", {
    name: "SDE.settings.oocMovementBudget.name",
    hint: "SDE.settings.oocMovementBudget.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 90,
  });

  game.settings.register(MODULE_ID, "oocEnforceBudget", {
    name: "SDE.settings.oocEnforceBudget.name",
    hint: "SDE.settings.oocEnforceBudget.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "hideHiddenNpcCards", {
    name: "SDE.settings.hideHiddenNpcCards.name",
    hint: "SDE.settings.hideHiddenNpcCards.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "warnIfCrawlHelperEnabled", {
    name: "SDE.settings.warnIfCrawlHelperEnabled.name",
    hint: "SDE.settings.warnIfCrawlHelperEnabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Internal world setting — not displayed in config UI. Holds the CrawlState singleton.
  game.settings.register(MODULE_ID, "crawlState", {
    scope: "world",
    config: false,
    type: Object,
    default: { mode: "off", crawlTurn: 0, oocInitiative: {} },
  });
}
```

- [ ] **Step 2: Update `scripts/shadowdark-enhancer.mjs`**

```js
export const MODULE_ID = "shadowdark-enhancer";

import { registerSettings } from "./settings.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
});
```

- [ ] **Step 3: Add labels to `languages/en.json`**

```json
{
  "SDE.settings.combatMovementDefault.name": "Combat movement default (ft)",
  "SDE.settings.combatMovementDefault.hint": "Default movement budget per combatant turn. Token's ruler colors red when the move exceeds this from the turn-start position.",
  "SDE.settings.oocMovementBudget.name": "Out-of-combat movement budget (ft)",
  "SDE.settings.oocMovementBudget.hint": "Default movement budget per crawl turn. Reset on Next Crawl Turn.",
  "SDE.settings.oocEnforceBudget.name": "Enforce out-of-combat movement budget",
  "SDE.settings.oocEnforceBudget.hint": "If on, refuse moves that exceed the crawl budget. Off: still colors red but lets the move commit.",
  "SDE.settings.hideHiddenNpcCards.name": "Hide hidden NPCs from the strip",
  "SDE.settings.hideHiddenNpcCards.hint": "If on, combatants with token.hidden or combatant.hidden are suppressed from the strip.",
  "SDE.settings.warnIfCrawlHelperEnabled.name": "Warn when shadowdark-crawl-helper is enabled",
  "SDE.settings.warnIfCrawlHelperEnabled.hint": "Shows a notification at world load if shadowdark-crawl-helper is active. Disable to suppress."
}
```

- [ ] **Step 4: Reload Foundry and verify**

```
mcp__foundry-vtt__reload_foundry({})
```

Then run the verification expression from the **Verify** block above.

- [ ] **Step 5: Commit**

```powershell
git add scripts/settings.mjs scripts/shadowdark-enhancer.mjs languages/en.json
git commit -m "feat: register module settings"
```

---

## Task 2: CrawlState singleton + socket sync

**Goal:** A world-settings-backed singleton holds the 3-state model, broadcasts mutations to all clients via a Foundry socket, and emits a custom hook that the strip will subscribe to.

**Files:**
- Create: `scripts/crawl-state.mjs`
- Modify: `scripts/shadowdark-enhancer.mjs` (init + ready calls into CrawlState; register socket; mode-transition combat hooks)

**Acceptance Criteria:**
- [ ] `CrawlState.mode` getter returns `"off"` after a fresh install
- [ ] `CrawlState.startCrawl()` (GM) flips mode to `"crawl"` and increments nothing; `CrawlState.endCrawl()` returns to `"off"`
- [ ] `CrawlState.nextCrawlTurn()` increments `crawlTurn` by 1 and fires the `sde.stateChanged` hook
- [ ] On `Hooks.on("combatStart")`, mode goes to `"combat"` and remembers the prior mode in `_priorMode` (memory only)
- [ ] On `Hooks.on("deleteCombat")`, mode returns to `_priorMode || "off"`
- [ ] State changes by GM propagate to a second connected client (verified via a second browser tab or MCP-bridge user)

**Verify:**
```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    const log = [];
    log.push({step: "initial", mode: CrawlState.mode, crawlTurn: CrawlState.crawlTurn});
    await CrawlState.startCrawl();
    log.push({step: "afterStart", mode: CrawlState.mode});
    await CrawlState.nextCrawlTurn();
    log.push({step: "afterNext", mode: CrawlState.mode, crawlTurn: CrawlState.crawlTurn});
    await CrawlState.endCrawl();
    log.push({step: "afterEnd", mode: CrawlState.mode, crawlTurn: CrawlState.crawlTurn});
    return log;
  `
})
```
Expected sequence: `off → crawl → crawl (turn=1) → off (turn reset)`

**Steps:**

- [ ] **Step 1: Write `scripts/crawl-state.mjs`**

```js
import { MODULE_ID } from "./shadowdark-enhancer.mjs";

/**
 * CrawlState — single source of truth for the strip's mode.
 *
 * Persists `{mode, crawlTurn, oocInitiative}` to a world setting.
 * Mutations broadcast over the module socket so every client re-renders.
 *
 * Forked pattern from vagabond-crawler/scripts/crawl-state.mjs.
 */

const SOCKET = `module.${MODULE_ID}`;
const SETTING_KEY = "crawlState";
const HOOK_CHANGED = "sde.stateChanged";

function defaultState() {
  return { mode: "off", crawlTurn: 0, oocInitiative: {} };
}

export const CrawlState = {
  _state: defaultState(),
  _priorMode: "off",   // remembers mode before combat for restoration

  // ── Getters ────────────────────────────────────────────────────────────
  get mode()           { return this._state.mode; },
  get crawlTurn()      { return this._state.crawlTurn; },
  get oocInitiative()  { return this._state.oocInitiative ?? {}; },
  get isActive()       { return this._state.mode !== "off"; },

  // ── Bootstrap ──────────────────────────────────────────────────────────
  init() {
    this._state = game.settings.get(MODULE_ID, SETTING_KEY) ?? defaultState();

    // Listen for state pushes from other clients.
    game.socket.on(SOCKET, (msg) => {
      if (msg?.type === "state") {
        this._state = msg.payload;
        Hooks.callAll(HOOK_CHANGED, this._state);
      }
    });

    // Mode-transition driver hooks.
    Hooks.on("combatStart", () => {
      if (!game.user.isGM) return;
      this._priorMode = this._state.mode === "combat" ? "off" : this._state.mode;
      this._update({ mode: "combat" });
    });

    Hooks.on("deleteCombat", () => {
      if (!game.user.isGM) return;
      // Only restore if our state was actually in combat.
      if (this._state.mode !== "combat") return;
      this._update({ mode: this._priorMode ?? "off" });
    });
  },

  // ── Public mutators (GM only) ──────────────────────────────────────────
  async startCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    await this._update({ mode: "crawl" });
  },

  async endCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    await this._update({ mode: "off", crawlTurn: 0 });
  },

  async nextCrawlTurn() {
    if (!game.user.isGM) return;
    if (this._state.mode !== "crawl") return;
    await this._update({ crawlTurn: this._state.crawlTurn + 1 });
  },

  async setOocInitiative(tokenId, entry) {
    if (!game.user.isGM) return;
    const next = { ...this._state.oocInitiative, [tokenId]: entry };
    await this._update({ oocInitiative: next });
  },

  async clearOocInitiative() {
    if (!game.user.isGM) return;
    await this._update({ oocInitiative: {} });
  },

  // ── Internal ───────────────────────────────────────────────────────────
  async _update(patch) {
    this._state = { ...this._state, ...patch };
    await game.settings.set(MODULE_ID, SETTING_KEY, this._state);
    game.socket.emit(SOCKET, { type: "state", payload: this._state });
    Hooks.callAll(HOOK_CHANGED, this._state);
  },

  HOOK_CHANGED,
};
```

- [ ] **Step 2: Wire `CrawlState.init()` into the ready hook**

Replace `scripts/shadowdark-enhancer.mjs` with:

```js
export const MODULE_ID = "shadowdark-enhancer";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
});
```

- [ ] **Step 3: Reload and run the verify probe**

```
mcp__foundry-vtt__reload_foundry({})
```

Then the verify probe block above. Expected log shape:
```
[
  { step: "initial",    mode: "off",   crawlTurn: 0 },
  { step: "afterStart", mode: "crawl"               },
  { step: "afterNext",  mode: "crawl", crawlTurn: 1 },
  { step: "afterEnd",   mode: "off",   crawlTurn: 0 }
]
```

- [ ] **Step 4: Probe combat-transition hooks**

Create a combat encounter manually in Foundry (drop a token, click Combat tracker → Create Combat). Then:

```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    return { mode: CrawlState.mode };
  `
})
```

If a combat is active, expected: `{ mode: "combat" }`. End the combat (Combat tracker → End), then re-probe — expected: `{ mode: "off" }` (or `"crawl"` if crawl was active beforehand).

- [ ] **Step 5: Commit**

```powershell
git add scripts/crawl-state.mjs scripts/shadowdark-enhancer.mjs
git commit -m "feat: CrawlState singleton with socket sync + combat hooks"
```

---

## Task 3: Strip mount + empty header + bounds tracking

**Goal:** A header-only Crawl Strip mounts at the top of the screen for GMs when `CrawlState.mode !== "off"`. Bounds-track sidebar and scene-navigation collapse/expand so the strip doesn't overlap them. Players see nothing yet.

**Files:**
- Create: `scripts/crawl-strip.mjs`
- Create: `templates/crawl-strip.hbs`
- Modify: `styles/shadowdark-enhancer.css`
- Modify: `scripts/shadowdark-enhancer.mjs` (call `CrawlStrip.init()` from ready)

**Acceptance Criteria:**
- [ ] When GM clicks "Start Crawl" via probe (CrawlState.startCrawl), strip appears at the top of the screen with a header reading "Shadowdark Enhancer • CRAWL • Turn 0"
- [ ] Strip is hidden for non-GMs when mode is `"off"` (GM sees a "Start Crawl" pill instead)
- [ ] When mode is `"crawl"`, the header shows "Turn N" and a "Next Crawl Turn" button (GM only)
- [ ] When mode is `"combat"`, the header reads "COMBAT • Round N • Turn N/M"
- [ ] Collapsing the right sidebar moves the strip's right edge in/out
- [ ] No console errors; no listener leaks across re-renders (verified by enabling `Hooks._hooks` count probe)

**Verify:**
1. Visual: screenshot after `CrawlState.startCrawl()` showing strip at top with "CRAWL • Turn 0".
2. Bounds probe:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const el = document.getElementById("shadowdark-enhancer-strip");
    if (!el) return "strip not mounted";
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, height: r.height };
  `
})
```
Expected: a sane rect at top of viewport, right < window.innerWidth.

**Steps:**

- [ ] **Step 1: Write `templates/crawl-strip.hbs`**

```handlebars
<div class="sde-strip-header">
  <span class="sde-strip-badge">SDE</span>

  {{#if (eq mode "off")}}
    {{#if isGM}}
      <button class="sde-btn" data-action="startCrawl">Start Crawl</button>
    {{/if}}
  {{/if}}

  {{#if (eq mode "crawl")}}
    <span class="sde-strip-mode sde-mode-crawl">CRAWL</span>
    <span class="sde-strip-turn">Turn {{crawlTurn}}</span>
    {{#if isGM}}
      <button class="sde-btn" data-action="nextCrawlTurn">Next Crawl Turn</button>
      <button class="sde-btn sde-btn-quiet" data-action="endCrawl">End Crawl</button>
    {{/if}}
  {{/if}}

  {{#if (eq mode "combat")}}
    <span class="sde-strip-mode sde-mode-combat">COMBAT</span>
    <span class="sde-strip-round">Round {{round}} • Turn {{turn}}/{{turns}}</span>
  {{/if}}
</div>

<div class="sde-strip-cards"></div>
```

The `eq` helper is provided by Foundry's Handlebars setup. The Cards row stays empty in this task; populated in later tasks.

- [ ] **Step 2: Write `scripts/crawl-strip.mjs`**

```js
import { MODULE_ID } from "./shadowdark-enhancer.mjs";
import { CrawlState } from "./crawl-state.mjs";

const STRIP_ID = "shadowdark-enhancer-strip";
const TEMPLATE = `modules/${MODULE_ID}/templates/crawl-strip.hbs`;

export const CrawlStrip = {
  _el: null,
  _renderQueued: false,
  _hookIds: [],
  _resizeListener: null,

  init() {
    // Mount once. Re-render on any state/combat change.
    this.mount();

    const queue = () => this.queueRender();
    this._hookIds.push(Hooks.on(CrawlState.HOOK_CHANGED, queue));
    this._hookIds.push(Hooks.on("combatStart", queue));
    this._hookIds.push(Hooks.on("combatRound", queue));
    this._hookIds.push(Hooks.on("combatTurn", queue));
    this._hookIds.push(Hooks.on("deleteCombat", queue));
    this._hookIds.push(Hooks.on("renderSceneNavigation", () => this._updateBounds()));
    this._hookIds.push(Hooks.on("collapseSidebar", () => this._updateBounds()));

    this._resizeListener = () => this._updateBounds();
    window.addEventListener("resize", this._resizeListener);
  },

  dispose() {
    for (const id of this._hookIds) Hooks.off(id);
    this._hookIds = [];
    if (this._resizeListener) window.removeEventListener("resize", this._resizeListener);
    this._resizeListener = null;
    this._el?.remove();
    this._el = null;
  },

  mount() {
    if (document.getElementById(STRIP_ID)) return;
    const strip = document.createElement("div");
    strip.id = STRIP_ID;
    strip.classList.add("sde-strip");

    const iface = document.getElementById("interface");
    if (iface) iface.prepend(strip);
    else document.getElementById("ui-top")?.prepend(strip);

    this._el = strip;
    this._attachDelegatedEvents();
    this.queueRender();
    this._updateBounds();
  },

  queueRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this.render();
    });
  },

  async render() {
    if (!this._el) return;

    const mode = CrawlState.mode;
    const isGM = game.user.isGM;

    // For non-GM in "off" mode, hide entirely.
    if (mode === "off" && !isGM) {
      this._el.style.display = "none";
      return;
    }
    this._el.style.display = "";

    const ctx = {
      mode,
      isGM,
      crawlTurn: CrawlState.crawlTurn,
      round: game.combat?.round ?? 0,
      turn: (game.combat?.turn ?? -1) + 1,   // 1-indexed for display
      turns: game.combat?.turns?.length ?? 0,
    };

    const html = await renderTemplate(TEMPLATE, ctx);
    this._el.innerHTML = html;
  },

  _attachDelegatedEvents() {
    this._el.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      switch (action) {
        case "startCrawl":    return CrawlState.startCrawl();
        case "endCrawl":      return CrawlState.endCrawl();
        case "nextCrawlTurn": return CrawlState.nextCrawlTurn();
      }
    });
  },

  _updateBounds() {
    if (!this._el) return;
    const sceneNav = document.getElementById("scene-navigation");
    const sidebar = document.getElementById("sidebar");
    const navWidth = sceneNav?.getBoundingClientRect()?.width ?? 0;
    const sidebarWidth = sidebar?.getBoundingClientRect()?.width ?? 0;
    this._el.style.left = `${Math.max(0, navWidth + 8)}px`;
    this._el.style.right = `${Math.max(0, sidebarWidth + 8)}px`;
  },
};
```

- [ ] **Step 3: Add base CSS to `styles/shadowdark-enhancer.css`**

```css
/* Shadowdark Enhancer styles */

.sde-strip {
  position: absolute;
  top: 8px;
  left: 0;
  right: 0;
  z-index: 50;
  pointer-events: auto;
  font-family: var(--font-primary, "Signika", sans-serif);
  color: #ddd;
}

.sde-strip-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: rgba(20, 20, 24, 0.85);
  border: 1px solid #444;
  border-radius: 6px;
  backdrop-filter: blur(2px);
}

.sde-strip-badge {
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 2px 8px;
  background: #222;
  border: 1px solid #555;
  border-radius: 3px;
  font-size: 0.85em;
}

.sde-strip-mode {
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.85em;
}

.sde-mode-crawl  { background: #2c3e2c; color: #cfe6cf; }
.sde-mode-combat { background: #6b1f1f; color: #f3cfcf; }

.sde-strip-turn,
.sde-strip-round {
  font-size: 0.9em;
  opacity: 0.9;
}

.sde-btn {
  background: #333;
  border: 1px solid #555;
  color: #ddd;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.85em;
}
.sde-btn:hover { background: #444; }
.sde-btn-quiet { background: transparent; border-color: #444; opacity: 0.7; }

.sde-strip-cards {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  /* populated in later tasks */
}
```

- [ ] **Step 4: Wire `CrawlStrip.init()` from ready**

Update `scripts/shadowdark-enhancer.mjs`:

```js
export const MODULE_ID = "shadowdark-enhancer";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
  CrawlStrip.init();
});
```

- [ ] **Step 5: Reload, mount, and verify**

```
mcp__foundry-vtt__reload_foundry({})
```

```
mcp__foundry-vtt__evaluate({
  expression: `
    const el = document.getElementById("shadowdark-enhancer-strip");
    if (!el) return { mounted: false };
    return { mounted: true, html: el.innerHTML.slice(0, 200), display: getComputedStyle(el).display };
  `
})
```
Expected: `mounted: true`, html contains "Start Crawl" button (GM only).

- [ ] **Step 6: Visual verify**

```
mcp__foundry-vtt__screenshot({})
```

Confirm the strip is visible at top of canvas with a "Start Crawl" button on the right side of the SDE badge.

- [ ] **Step 7: Trigger crawl mode and re-verify**

```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.startCrawl();
    return CrawlState.mode;
  `
})
```
Expected: `"crawl"`. Then `mcp__foundry-vtt__screenshot({})` again — the strip should now show "CRAWL • Turn 0 [Next Crawl Turn] [End Crawl]".

- [ ] **Step 8: Reset state for next task**

```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.endCrawl();
    return CrawlState.mode;
  `
})
```

- [ ] **Step 9: Commit**

```powershell
git add scripts/crawl-strip.mjs templates/crawl-strip.hbs styles/shadowdark-enhancer.css scripts/shadowdark-enhancer.mjs
git commit -m "feat: mount Crawl Strip with mode-aware header"
```

---

## Task 4: Stat panel widgets (HP, Movement, Luck)

**Goal:** Three small ES modules that render one card cell each, conforming to a shared contract: `{ render(actor, ctx) → htmlString }`. They are imported by the strip's card-building code (in the next task) but already proven to produce correct HTML against live actors in this task.

**Files:**
- Create: `scripts/stat-panels/hp-panel.mjs`
- Create: `scripts/stat-panels/movement-panel.mjs`
- Create: `scripts/stat-panels/luck-panel.mjs`
- Modify: `styles/shadowdark-enhancer.css` (card + stat cell styles)

**Acceptance Criteria:**
- [ ] `hpPanel.render(actor)` returns an `<span>` showing `value/max`; cell has class `sde-hp-low` when `value <= 0`
- [ ] `movementPanel.render(actor, { mode, used, budget })` returns `<span>` showing `used/budget`; cell has class `sde-mv-over` when `used > budget`
- [ ] `luckPanel.render(actor)` returns pips for PCs (filled count = `remaining` if `> 0`, else 1 filled pip if `available`, else 1 empty); returns `<span>—</span>` for NPCs
- [ ] Click on a luck pip calls `actor.system.useLuckToken()` (event handler attached via event delegation in the strip in Task 5; this task only exposes the action via a `data-action="spendLuck"` attribute on the pips)

**Verify:**
```
mcp__foundry-vtt__evaluate({
  expression: `
    const { hpPanel }       = await import("/modules/shadowdark-enhancer/scripts/stat-panels/hp-panel.mjs");
    const { movementPanel } = await import("/modules/shadowdark-enhancer/scripts/stat-panels/movement-panel.mjs");
    const { luckPanel }     = await import("/modules/shadowdark-enhancer/scripts/stat-panels/luck-panel.mjs");

    const player = game.actors.get("fTwJht5Kb0ZVFZXx");
    const npc    = game.actors.find(a => a.type === "NPC");

    return {
      hp_player:   hpPanel.render(player),
      hp_npc:      hpPanel.render(npc),
      mv_combat:   movementPanel.render(player, { mode: "combat", used: 35, budget: 30 }),
      mv_crawl_ok: movementPanel.render(player, { mode: "crawl",  used: 20, budget: 90 }),
      luck_player: luckPanel.render(player),
      luck_npc:    luckPanel.render(npc),
    };
  `
})
```

Expected (with Druchor's actual luck = remaining:0, available:false):
- `hp_player`: contains `13/13`
- `hp_npc`: contains `4/4` (Acrobat)
- `mv_combat`: contains `35/30` AND class `sde-mv-over`
- `mv_crawl_ok`: contains `20/90` and no `sde-mv-over` class
- `luck_player`: contains 1 empty pip (`sde-pip sde-pip-empty`)
- `luck_npc`: contains `—`

**Steps:**

- [ ] **Step 1: Write `scripts/stat-panels/hp-panel.mjs`**

```js
export const hpPanel = {
  /**
   * @param {Actor} actor
   * @returns {string} HTML for one cell
   */
  render(actor) {
    const hp = actor?.system?.attributes?.hp ?? { value: 0, max: 0 };
    const low = (hp.value ?? 0) <= 0 ? "sde-hp-low" : "";
    return `<span class="sde-cell sde-hp ${low}">HP ${hp.value ?? 0}/${hp.max ?? 0}</span>`;
  },
};
```

- [ ] **Step 2: Write `scripts/stat-panels/movement-panel.mjs`**

```js
export const movementPanel = {
  /**
   * @param {Actor} actor
   * @param {{ mode: "crawl"|"combat", used: number, budget: number }} ctx
   * @returns {string}
   */
  render(actor, ctx) {
    const used = ctx?.used ?? 0;
    const budget = ctx?.budget ?? 0;
    const over = used > budget ? "sde-mv-over" : "";
    const modeLabel = ctx?.mode === "crawl" ? "Mv" : "Mv";  // same label, kept for future divergence
    return `<span class="sde-cell sde-mv ${over}">${modeLabel} ${used}/${budget}</span>`;
  },
};
```

- [ ] **Step 3: Write `scripts/stat-panels/luck-panel.mjs`**

```js
export const luckPanel = {
  /**
   * @param {Actor} actor
   * @returns {string}
   */
  render(actor) {
    // NPCs in base Shadowdark have no luck schema. See spec R7 / brainstorm MCP probe.
    if (!actor?.system || !Object.prototype.hasOwnProperty.call(actor.system, "luck")) {
      return `<span class="sde-cell sde-luck sde-luck-na">Luck —</span>`;
    }

    const luck = actor.system.luck ?? { available: false, remaining: 0 };
    const hasToken = actor.system.hasLuckToken === true;

    let pipsHtml;
    if (luck.remaining > 0) {
      pipsHtml = Array(luck.remaining).fill(0).map((_, i) =>
        `<span class="sde-pip sde-pip-filled" data-action="spendLuck" data-actor-id="${actor.id}" title="Spend luck (${luck.remaining} left)"></span>`
      ).join("");
    } else if (luck.available) {
      pipsHtml = `<span class="sde-pip sde-pip-filled" data-action="spendLuck" data-actor-id="${actor.id}" title="Spend luck"></span>`;
    } else {
      pipsHtml = `<span class="sde-pip sde-pip-empty" title="No luck token"></span>`;
    }

    const interactive = hasToken ? "sde-luck-interactive" : "";
    return `<span class="sde-cell sde-luck ${interactive}">Luck ${pipsHtml}</span>`;
  },
};
```

- [ ] **Step 4: Add card + cell CSS**

Append to `styles/shadowdark-enhancer.css`:

```css
/* Cards & cells */
.sde-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
  background: rgba(30, 30, 36, 0.85);
  border: 1px solid #444;
  border-radius: 5px;
  min-width: 110px;
}

.sde-card-name {
  font-weight: 600;
  font-size: 0.85em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100px;
}

.sde-card-active {
  border-color: #b08838;
  box-shadow: 0 0 6px rgba(176, 136, 56, 0.6);
}

.sde-cell {
  font-size: 0.75em;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sde-hp-low   { color: #ff7070; font-weight: 700; }
.sde-mv-over  { color: #ff7070; font-weight: 700; }
.sde-luck-na  { opacity: 0.5; }

.sde-pip {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 2px;
  border: 1px solid #888;
}
.sde-pip-filled { background: #d4a548; border-color: #d4a548; cursor: pointer; }
.sde-pip-empty  { background: transparent; }
.sde-luck-interactive .sde-pip-filled:hover { box-shadow: 0 0 4px #f0c87a; }
```

- [ ] **Step 5: Reload and run the verify probe**

```
mcp__foundry-vtt__reload_foundry({})
```

Then the verify probe block above.

Expected: HP rows show "13/13" and "4/4"; Movement rows show "35/30" + `sde-mv-over` and "20/90" without; Luck rows show empty pip for Druchor and `—` for the NPC.

- [ ] **Step 6: Commit**

```powershell
git add scripts/stat-panels/ styles/shadowdark-enhancer.css
git commit -m "feat: HP/Movement/Luck stat panel widgets"
```

---

## Task 5: Crawl-mode card layout

**Goal:** While `mode === "crawl"`, the strip shows one card per Player actor in the active scene with HP, Movement (used 0 / budget 90 — actual measurement comes in Task 10), and Luck. Cards sort by `oocInitiative` descending if available, else by actor name.

**Files:**
- Modify: `scripts/crawl-strip.mjs` (build card list)
- Modify: `templates/crawl-strip.hbs` (render cards from prebuilt HTML)
- Modify: `styles/shadowdark-enhancer.css` (card row layout)

**Acceptance Criteria:**
- [ ] One card per Player actor whose token is in the active scene
- [ ] Each card shows: portrait img, name, HP cell, Movement cell (0/90), Luck cell, "Init —" placeholder
- [ ] Cards sorted alphabetically when no init is set
- [ ] No NPCs render in crawl mode
- [ ] Re-renders when scene changes or actor data updates

**Verify:**
1. `CrawlState.startCrawl()` then screenshot — strip should show 2 PC cards (Druchor, Test) with HP "13/13", Mv "0/90", Luck pip, Init "—".
2. DOM probe:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const cards = document.querySelectorAll("#shadowdark-enhancer-strip .sde-card");
    return { count: cards.length, names: Array.from(cards).map(c => c.querySelector(".sde-card-name")?.textContent) };
  `
})
```
Expected: `{ count: 2, names: ["Druchor", "Test"] }` (order may vary; alphabetical preferred).

**Steps:**

- [ ] **Step 1: Add card-building helper to `crawl-strip.mjs`**

Insert near the top of the file (after the constants):

```js
import { hpPanel }       from "./stat-panels/hp-panel.mjs";
import { movementPanel } from "./stat-panels/movement-panel.mjs";
import { luckPanel }     from "./stat-panels/luck-panel.mjs";
```

Add a method to the `CrawlStrip` object:

```js
  _buildCrawlCards() {
    const tokens = canvas.scene?.tokens?.contents ?? [];
    const playerEntries = tokens
      .map(t => ({ token: t, actor: t.actor }))
      .filter(({ actor }) => actor?.type === "Player");

    const ooc = CrawlState.oocInitiative;

    const sorted = playerEntries.sort((a, b) => {
      const ai = ooc[a.token.id]?.roll;
      const bi = ooc[b.token.id]?.roll;
      if (ai != null && bi != null) return bi - ai;          // both rolled → desc
      if (ai != null)              return -1;
      if (bi != null)              return 1;
      return (a.actor.name ?? "").localeCompare(b.actor.name ?? "");
    });

    const budget = game.settings.get(MODULE_ID, "oocMovementBudget");

    return sorted.map(({ token, actor }) => {
      const init = ooc[token.id]?.roll;
      const initStr = (init == null) ? "—" : init;
      return `
        <div class="sde-card" data-token-id="${token.id}" data-actor-id="${actor.id}">
          <div class="sde-card-name">
            <img class="sde-portrait" src="${actor.img}" alt="" />
            <span>${actor.name}</span>
          </div>
          ${hpPanel.render(actor)}
          ${movementPanel.render(actor, { mode: "crawl", used: 0, budget })}
          ${luckPanel.render(actor)}
          <span class="sde-cell sde-init">Init ${initStr}</span>
        </div>
      `;
    }).join("");
  },
```

- [ ] **Step 2: Update `render()` to inject cards**

Replace the `render` method's body's final block with:

```js
    const html = await renderTemplate(TEMPLATE, ctx);
    this._el.innerHTML = html;

    const cardsRow = this._el.querySelector(".sde-strip-cards");
    if (cardsRow) {
      if (mode === "crawl") {
        cardsRow.innerHTML = this._buildCrawlCards();
      } else {
        cardsRow.innerHTML = "";
      }
    }
```

- [ ] **Step 3: Subscribe to actor/token updates so cards reflect HP changes**

In `init()`, after the existing `Hooks.on` registrations, add:

```js
    this._hookIds.push(Hooks.on("updateActor", () => this.queueRender()));
    this._hookIds.push(Hooks.on("updateToken", () => this.queueRender()));
    this._hookIds.push(Hooks.on("createToken", () => this.queueRender()));
    this._hookIds.push(Hooks.on("deleteToken", () => this.queueRender()));
    this._hookIds.push(Hooks.on("canvasReady", () => this.queueRender()));
```

- [ ] **Step 4: Card row CSS — already added in Task 4. Add portrait + init cell styles**

Append to `styles/shadowdark-enhancer.css`:

```css
.sde-card-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sde-portrait {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid #555;
}
.sde-init { opacity: 0.85; }
```

- [ ] **Step 5: Verify in-world**

```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.startCrawl();
    return CrawlState.mode;
  `
})
```

Then run the DOM probe in the Verify block.

```
mcp__foundry-vtt__screenshot({})
```

Expected: strip shows 2 PC cards. Visually confirm.

- [ ] **Step 6: Reset state**

```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.endCrawl();
    return CrawlState.mode;
  `
})
```

- [ ] **Step 7: Commit**

```powershell
git add scripts/crawl-strip.mjs styles/shadowdark-enhancer.css
git commit -m "feat: render PC cards in crawl mode"
```

---

## Task 6: Out-of-combat initiative — roll & reset

**Goal:** GM (or any user, for their owned actors) can click "Roll Initiative" to roll for all unrolled PCs. Result whispers to GM in chat and persists in `CrawlState.oocInitiative`. GM "Reset Initiative" wipes the map. Cards re-sort by init descending.

**Files:**
- Create: `scripts/initiative-manager.mjs`
- Modify: `scripts/crawl-strip.mjs` (footer buttons + event delegation)
- Modify: `templates/crawl-strip.hbs` (footer)

**Acceptance Criteria:**
- [ ] "Roll Initiative" button appears in crawl-mode footer
- [ ] Clicking it (GM) rolls 1d20 + actor's `system.roll.initiative.bonus`, applying advantage via `globalThis.shadowdark.dice.applyAdvantage` if `system.roll.initiative.advantage` is non-zero
- [ ] Chat message is **whispered to GM only**
- [ ] `CrawlState.oocInitiative` populated with `{ tokenId: { roll, advantage } }` for every unrolled PC in scene
- [ ] Cards re-sort by init descending
- [ ] "Reset Initiative" clears `oocInitiative` (GM only); cards revert to alphabetical
- [ ] Re-clicking "Roll Initiative" with some already rolled only rolls the missing ones

**Verify:**
```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    const { InitiativeManager } = await import("/modules/shadowdark-enhancer/scripts/initiative-manager.mjs");
    await CrawlState.startCrawl();
    await InitiativeManager.rollOocForAll();
    const rolled = CrawlState.oocInitiative;
    const rolls = Object.values(rolled).map(e => e.roll);
    await CrawlState.clearOocInitiative();
    const cleared = Object.keys(CrawlState.oocInitiative).length;
    await CrawlState.endCrawl();
    return { rolled_count: Object.keys(rolled).length, rolls_in_range: rolls.every(r => Number.isFinite(r)), cleared };
  `
})
```
Expected: `{ rolled_count: 2, rolls_in_range: true, cleared: 0 }`

**Steps:**

- [ ] **Step 1: Write `scripts/initiative-manager.mjs`**

```js
import { MODULE_ID } from "./shadowdark-enhancer.mjs";
import { CrawlState } from "./crawl-state.mjs";

export const InitiativeManager = {
  /**
   * Roll OoC initiative for every Player token in the active scene that doesn't
   * already have an entry in CrawlState.oocInitiative.
   *
   * If called by a non-GM, only rolls for actors the user owns.
   */
  async rollOocForAll() {
    const tokens = canvas.scene?.tokens?.contents ?? [];
    const candidates = tokens.filter(t => {
      const actor = t.actor;
      if (!actor || actor.type !== "Player") return false;
      if (CrawlState.oocInitiative[t.id]) return false;
      if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) return false;
      return true;
    });

    if (candidates.length === 0) {
      ui.notifications.info("Shadowdark Enhancer: nothing to roll.");
      return;
    }

    const rolls = [];
    for (const token of candidates) {
      const actor = token.actor;
      const bonus = Number(actor.system?.roll?.initiative?.bonus ?? 0);
      const advantage = Number(actor.system?.roll?.initiative?.advantage ?? 0);

      // Use the system dice helper to apply advantage if available.
      const baseFormula = "1d20";
      const adv = globalThis.shadowdark?.dice?.applyAdvantage;
      const formula = (typeof adv === "function") ? adv(baseFormula, advantage) : baseFormula;
      const full = bonus !== 0 ? `${formula} + ${bonus}` : formula;

      const roll = await new Roll(full).roll();
      rolls.push({ token, actor, roll, advantage });
    }

    // Persist results.
    for (const r of rolls) {
      await CrawlState.setOocInitiative(r.token.id, { roll: r.roll.total, advantage: r.advantage });
    }

    // Build a whisper-to-GM chat message summarizing rolls.
    const lines = rolls.map(r => `<li><strong>${r.actor.name}</strong>: ${r.roll.total}</li>`).join("");
    const html = `<div><h3>Out-of-Combat Initiative</h3><ul>${lines}</ul></div>`;
    await ChatMessage.create({
      content: html,
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    });
  },
};
```

- [ ] **Step 2: Add footer to template**

Update `templates/crawl-strip.hbs` so the crawl block reads:

```handlebars
  {{#if (eq mode "crawl")}}
    <span class="sde-strip-mode sde-mode-crawl">CRAWL</span>
    <span class="sde-strip-turn">Turn {{crawlTurn}}</span>
    {{#if isGM}}
      <button class="sde-btn" data-action="nextCrawlTurn">Next Crawl Turn</button>
      <button class="sde-btn sde-btn-quiet" data-action="endCrawl">End Crawl</button>
    {{/if}}
    <span class="sde-spacer"></span>
    <button class="sde-btn" data-action="rollOocInit">Roll Initiative</button>
    {{#if isGM}}
      <button class="sde-btn sde-btn-quiet" data-action="resetOocInit">Reset</button>
    {{/if}}
  {{/if}}
```

Add `.sde-spacer { flex: 1; }` to `styles/shadowdark-enhancer.css`.

- [ ] **Step 3: Wire button actions in `crawl-strip.mjs`**

At the top of `crawl-strip.mjs`, add:

```js
import { InitiativeManager } from "./initiative-manager.mjs";
```

Extend the `_attachDelegatedEvents` switch:

```js
        case "rollOocInit":   return InitiativeManager.rollOocForAll();
        case "resetOocInit":  return CrawlState.clearOocInitiative();
```

- [ ] **Step 4: Verify**

```
mcp__foundry-vtt__reload_foundry({})
```

Make sure 2 PC tokens (`Druchor`, `Test`) are placed on the active scene. Then run the verify probe block.

Visual:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.startCrawl();
  `
})
```
Click "Roll Initiative" in the strip, then `mcp__foundry-vtt__screenshot({})`. Both PCs should now display "Init <number>" and be sorted descending.

- [ ] **Step 5: Reset state**

```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.clearOocInitiative();
    await CrawlState.endCrawl();
  `
})
```

- [ ] **Step 6: Commit**

```powershell
git add scripts/initiative-manager.mjs scripts/crawl-strip.mjs templates/crawl-strip.hbs styles/shadowdark-enhancer.css
git commit -m "feat: out-of-combat initiative roll + reset"
```

---

## Task 7: Combat-mode card layout + hidden-NPC filter

**Goal:** While `mode === "combat"`, the strip renders one card per combatant in `game.combat.turns` order, hiding combatants where `token.hidden || combatant.hidden` (gated by `hideHiddenNpcCards` setting). Active combatant card has a distinct border. Round/turn counter pulled live from `game.combat`.

**Files:**
- Modify: `scripts/crawl-strip.mjs` (add `_buildCombatCards`; switch in render)

**Acceptance Criteria:**
- [ ] Start a combat with 2 PCs and 2 NPCs (one hidden); strip shows 3 cards (the visible NPC + both PCs)
- [ ] Active combatant card has class `sde-card-active`
- [ ] Round/turn header reads `Round 1 • Turn 1/N`
- [ ] Toggling `hideHiddenNpcCards = false` makes the hidden NPC appear (after re-render)

**Verify:**
1. Programmatically create a combat:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const sceneTokens = canvas.scene.tokens.contents;
    const combat = await Combat.create({ scene: canvas.scene.id });
    for (const t of sceneTokens) await combat.createEmbeddedDocuments("Combatant", [{ tokenId: t.id, sceneId: canvas.scene.id }]);
    await combat.startCombat();
    return { combatId: combat.id, turns: combat.turns.length };
  `
})
```
2. DOM probe:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const cards = document.querySelectorAll("#shadowdark-enhancer-strip .sde-card");
    const active = document.querySelector("#shadowdark-enhancer-strip .sde-card-active");
    return { card_count: cards.length, has_active: !!active };
  `
})
```
Expected: `card_count` = visible combatant count, `has_active: true`.

**Steps:**

- [ ] **Step 1: Add `_buildCombatCards` to `crawl-strip.mjs`**

```js
  _buildCombatCards() {
    const combat = game.combat;
    if (!combat) return "";

    const hideHidden = game.settings.get(MODULE_ID, "hideHiddenNpcCards");
    const combatMv = game.settings.get(MODULE_ID, "combatMovementDefault");
    const turns = combat.turns ?? [];
    const activeId = combat.combatant?.id;

    const visible = turns.filter(c => {
      if (!hideHidden) return true;
      const tokenDoc = c.token;
      if (c.hidden) return false;
      if (tokenDoc?.hidden) return false;
      return true;
    });

    return visible.map(c => {
      const actor = c.actor;
      if (!actor) return "";
      const tokenId = c.token?.id ?? c.tokenId;
      const isActive = c.id === activeId ? "sde-card-active" : "";
      return `
        <div class="sde-card ${isActive}" data-combatant-id="${c.id}" data-token-id="${tokenId}" data-actor-id="${actor.id}">
          <div class="sde-card-name">
            <img class="sde-portrait" src="${actor.img}" alt="" />
            <span>${actor.name}</span>
          </div>
          ${hpPanel.render(actor)}
          ${movementPanel.render(actor, { mode: "combat", used: 0, budget: combatMv })}
          ${luckPanel.render(actor)}
          <span class="sde-cell sde-init">Init ${c.initiative ?? "—"}</span>
        </div>
      `;
    }).join("");
  },
```

- [ ] **Step 2: Update `render()` to branch on mode**

In the cards-row population block (added in Task 5), extend:

```js
    const cardsRow = this._el.querySelector(".sde-strip-cards");
    if (cardsRow) {
      if (mode === "crawl")        cardsRow.innerHTML = this._buildCrawlCards();
      else if (mode === "combat")  cardsRow.innerHTML = this._buildCombatCards();
      else                          cardsRow.innerHTML = "";
    }
```

- [ ] **Step 3: Verify**

Place 2 PC tokens (`Druchor`, `Test`) and 2 NPC tokens (e.g., 2 copies of `Acrobat`) on the active scene. Hide one NPC via the Token HUD eye icon.

```
mcp__foundry-vtt__evaluate({
  expression: `
    // Clean any existing combat
    if (game.combat) await game.combat.delete();
    const sceneTokens = canvas.scene.tokens.contents;
    const combat = await Combat.create({ scene: canvas.scene.id });
    const docs = sceneTokens.map(t => ({ tokenId: t.id, sceneId: canvas.scene.id }));
    await combat.createEmbeddedDocuments("Combatant", docs);
    // Roll for all to get a deterministic order with init values
    await combat.rollAll();
    await combat.startCombat();
    return { turns: combat.turns.length };
  `
})
```

```
mcp__foundry-vtt__screenshot({})
```
Expected: 3 cards (or 4 if no NPC was hidden); active one highlighted; header shows "COMBAT • Round 1 • Turn 1/N".

Re-run the DOM probe from the Verify block.

- [ ] **Step 4: Reset combat for next task**

```
mcp__foundry-vtt__evaluate({
  expression: `if (game.combat) await game.combat.delete(); return "ok";`
})
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/crawl-strip.mjs
git commit -m "feat: combat-mode card layout with hidden-NPC filter"
```

---

## Task 8: Hidden-NPC bidirectional sync hooks

**Goal:** Toggling `token.hidden` on the canvas updates `combatant.hidden` in the active combat, and vice versa. GM-only. Forked verbatim from Vagabond Crawler `crawl-strip.mjs` lines around 512–636.

**Files:**
- Create: `scripts/hidden-sync.mjs`
- Modify: `scripts/shadowdark-enhancer.mjs` (call `registerHiddenSync()` from ready)

**Acceptance Criteria:**
- [ ] In an active combat, toggling a token's hidden flag via the Token HUD eye-icon updates the corresponding combatant's hidden flag within the same tick
- [ ] Toggling a combatant's hidden flag via the Combat tracker eye-icon updates the token's hidden flag
- [ ] No infinite loop when both fire on the same change (the early-return on equal values guards against this)

**Verify:**
Start a combat with at least one NPC, then:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const npc = canvas.scene.tokens.contents.find(t => t.actor?.type === "NPC");
    const combatant = game.combat?.combatants.find(c => c.tokenId === npc.id);
    const beforeToken = npc.hidden;
    const beforeComb  = combatant.hidden;
    await npc.update({ hidden: !npc.hidden });
    // Give the hook a tick to fire
    await new Promise(r => setTimeout(r, 50));
    return {
      before: { tokenHidden: beforeToken, combatantHidden: beforeComb },
      after:  { tokenHidden: npc.hidden, combatantHidden: combatant.hidden },
      synced: npc.hidden === combatant.hidden,
    };
  `
})
```
Expected: `synced: true` after the change.

**Steps:**

- [ ] **Step 1: Write `scripts/hidden-sync.mjs`**

```js
/**
 * Bidirectional token.hidden ↔ combatant.hidden sync.
 *
 * Forked from vagabond-crawler/scripts/crawl-strip.mjs (the `preUpdateToken`
 * and `preUpdateCombatant` sync handlers, ~lines 512–636).
 */

export function registerHiddenSync() {
  Hooks.on("updateToken", async (tokenDoc, changes) => {
    if (!("hidden" in changes)) return;
    if (!game.user.isGM) return;
    if (!game.combat) return;
    const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
    if (!combatant) return;
    if (combatant.hidden === changes.hidden) return;
    await combatant.update({ hidden: changes.hidden });
  });

  Hooks.on("updateCombatant", async (combatant, changes) => {
    if (!("hidden" in changes)) return;
    if (!game.user.isGM) return;
    const tokenDoc = combatant.token;
    if (!tokenDoc) return;
    if (tokenDoc.hidden === changes.hidden) return;
    await tokenDoc.update({ hidden: changes.hidden });
  });
}
```

- [ ] **Step 2: Wire into ready hook**

Update `scripts/shadowdark-enhancer.mjs`:

```js
export const MODULE_ID = "shadowdark-enhancer";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { registerHiddenSync } from "./hidden-sync.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
  registerHiddenSync();
  CrawlStrip.init();
});
```

- [ ] **Step 3: Verify**

Reload, start a combat with at least one NPC, run the verify probe. Then reverse direction:

```
mcp__foundry-vtt__evaluate({
  expression: `
    const npc = canvas.scene.tokens.contents.find(t => t.actor?.type === "NPC");
    const combatant = game.combat?.combatants.find(c => c.tokenId === npc.id);
    await combatant.update({ hidden: !combatant.hidden });
    await new Promise(r => setTimeout(r, 50));
    return { tokenHidden: npc.hidden, combatantHidden: combatant.hidden, synced: npc.hidden === combatant.hidden };
  `
})
```
Expected: `synced: true`.

- [ ] **Step 4: Commit**

```powershell
git add scripts/hidden-sync.mjs scripts/shadowdark-enhancer.mjs
git commit -m "feat: bidirectional hidden flag sync"
```

---

## Task 9: Movement tracker — combat red-line + turn-start capture

**Goal:** A `TokenRuler` subclass colors waypoints green within 30 ft of the active combatant's turn-start position and red over. The `turnStart` flag is captured on `combatStart` and `combatTurn` for the active combatant. The strip's Movement cell shows the live "used" value.

**Files:**
- Create: `scripts/movement-tracker.mjs`
- Modify: `scripts/shadowdark-enhancer.mjs` (call `MovementTracker.init()` from ready)
- Modify: `scripts/crawl-strip.mjs` (read `MovementTracker.usedFor(token, mode)` when building cards)

**Acceptance Criteria:**
- [ ] When a combat starts, every combatant's token has `flags.shadowdark-enhancer.turnStart = { x, y }` matching its current position
- [ ] When the active combatant advances (`combatTurn` fires), the new active combatant's `turnStart` is captured
- [ ] Drag-measuring with the active combatant's token shows green waypoints within 30 ft from `turnStart`, red beyond
- [ ] The strip's Movement cell for the active combatant shows `used/30` and turns red when over

**Verify:**
1. Start combat. Move the active combatant's token. Probe used distance:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const { MovementTracker } = await import("/modules/shadowdark-enhancer/scripts/movement-tracker.mjs");
    const combat = game.combat;
    const c = combat?.combatant;
    const token = c?.token?.object;
    if (!token) return "no active token";
    const used = MovementTracker.usedFor(token.document, "combat");
    const turnStart = token.document.flags?.["shadowdark-enhancer"]?.turnStart;
    return { used, turnStart, tokenPos: { x: token.document.x, y: token.document.y } };
  `
})
```
Expected: `turnStart` non-null, `used` is the Chebyshev/diagonal distance from `turnStart` to current position in feet (Foundry grid square × `canvas.scene.grid.distance`).

2. Visual: drag-measure with a token past 30 ft — ruler waypoints turn red.

**Steps:**

- [ ] **Step 1: Write `scripts/movement-tracker.mjs`**

```js
/**
 * Movement Tracker — combat red-line + crawl-anchor budget tracking.
 *
 * Forked from vagabond-crawler/scripts/movement-tracker.mjs.
 * Key changes vs Vagabond:
 *   - Combat origin is always token.flags[MODULE_ID].turnStart (turn-start capture).
 *   - Crawl origin is always token.flags[MODULE_ID].crawlAnchor (set on Next Crawl Turn).
 *   - No "Rush" speed; flat budget from settings.
 */

import { MODULE_ID } from "./shadowdark-enhancer.mjs";
import { CrawlState } from "./crawl-state.mjs";

const FLAG_TURN_START = "turnStart";
const FLAG_CRAWL_ANCHOR = "crawlAnchor";

export const MovementTracker = {
  init() {
    // Capture turn-start position for each combatant.
    Hooks.on("combatStart", async (combat) => {
      if (!game.user.isGM) return;
      for (const c of combat.turns) {
        const tokenDoc = c.token;
        if (!tokenDoc) continue;
        await this._setFlag(tokenDoc, FLAG_TURN_START, { x: tokenDoc.x, y: tokenDoc.y });
      }
    });

    // On each turn change, refresh active combatant's turn-start.
    Hooks.on("combatTurn", async (combat) => {
      if (!game.user.isGM) return;
      const c = combat.combatant;
      const tokenDoc = c?.token;
      if (!tokenDoc) return;
      await this._setFlag(tokenDoc, FLAG_TURN_START, { x: tokenDoc.x, y: tokenDoc.y });
    });

    // Clear all turn-start flags when combat ends.
    Hooks.on("deleteCombat", async (combat) => {
      if (!game.user.isGM) return;
      for (const c of combat.turns) {
        const tokenDoc = c.token;
        if (!tokenDoc) continue;
        await this._clearFlag(tokenDoc, FLAG_TURN_START);
      }
    });

    // Re-color ruler when token position changes; refresh strip.
    Hooks.on("refreshToken", (token) => {
      // Only re-render when the active combatant or a tracked token moved.
      if (game.combat?.combatant?.tokenId === token.id) Hooks.callAll(CrawlState.HOOK_CHANGED);
    });
  },

  /**
   * Return distance (in feet) from the configured origin to current token position.
   * @param {TokenDocument} tokenDoc
   * @param {"combat"|"crawl"} mode
   * @returns {number}
   */
  usedFor(tokenDoc, mode) {
    const flagKey = mode === "combat" ? FLAG_TURN_START : FLAG_CRAWL_ANCHOR;
    const origin = tokenDoc?.flags?.[MODULE_ID]?.[flagKey];
    if (!origin) return 0;
    return this._gridDistance(origin, { x: tokenDoc.x, y: tokenDoc.y });
  },

  /**
   * Budget in feet for the given mode.
   */
  budgetFor(mode) {
    return mode === "combat"
      ? game.settings.get(MODULE_ID, "combatMovementDefault")
      : game.settings.get(MODULE_ID, "oocMovementBudget");
  },

  /**
   * Move token back to its turnStart position (combat only).
   * @param {TokenDocument} tokenDoc
   */
  async rollbackToTurnStart(tokenDoc) {
    const origin = tokenDoc?.flags?.[MODULE_ID]?.[FLAG_TURN_START];
    if (!origin) {
      ui.notifications.warn("Shadowdark Enhancer: no turn-start recorded for this token.");
      return;
    }
    await tokenDoc.update({ x: origin.x, y: origin.y });
    ui.notifications.info(`${tokenDoc.actor?.name ?? "Token"} rolled back to turn start.`);
  },

  /**
   * Set or clear the crawlAnchor for every token in the active scene.
   */
  async captureCrawlAnchors() {
    if (!game.user.isGM) return;
    const tokens = canvas.scene?.tokens?.contents ?? [];
    for (const t of tokens) {
      await this._setFlag(t, FLAG_CRAWL_ANCHOR, { x: t.x, y: t.y });
    }
  },

  async clearCrawlAnchors() {
    if (!game.user.isGM) return;
    const tokens = canvas.scene?.tokens?.contents ?? [];
    for (const t of tokens) {
      await this._clearFlag(t, FLAG_CRAWL_ANCHOR);
    }
  },

  // ── Internal ───────────────────────────────────────────────────────────
  async _setFlag(tokenDoc, key, value) {
    await tokenDoc.setFlag(MODULE_ID, key, value);
  },

  async _clearFlag(tokenDoc, key) {
    await tokenDoc.unsetFlag(MODULE_ID, key);
  },

  _gridDistance(a, b) {
    // Foundry standard: Chebyshev (king) distance in grid squares × scene grid distance.
    const gridSize = canvas.scene?.grid?.size ?? 100;
    const distFt = canvas.scene?.grid?.distance ?? 5;
    const dx = Math.abs(a.x - b.x) / gridSize;
    const dy = Math.abs(a.y - b.y) / gridSize;
    const squares = Math.max(dx, dy);
    return Math.round(squares * distFt);
  },
};
```

- [ ] **Step 2: Wire into ready**

Update `scripts/shadowdark-enhancer.mjs`:

```js
import { MovementTracker } from "./movement-tracker.mjs";

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
  registerHiddenSync();
  MovementTracker.init();
  CrawlStrip.init();
});
```

- [ ] **Step 3: Use live `used` in card building**

In `crawl-strip.mjs`, import:
```js
import { MovementTracker } from "./movement-tracker.mjs";
```

Update `_buildCrawlCards`:
```js
      const used = MovementTracker.usedFor(token, "crawl");
      const budget = MovementTracker.budgetFor("crawl");
      // …
      ${movementPanel.render(actor, { mode: "crawl", used, budget })}
```

Update `_buildCombatCards`:
```js
      const tokenDoc = c.token;
      const used = MovementTracker.usedFor(tokenDoc, "combat");
      const budget = MovementTracker.budgetFor("combat");
      // …
      ${movementPanel.render(actor, { mode: "combat", used, budget })}
```

(Replace the previous hard-coded `used: 0`.)

- [ ] **Step 4: Verify**

```
mcp__foundry-vtt__reload_foundry({})
```

Start a combat with the test tokens. Move the active combatant some distance. Run the verify probe.

For the visual color verification:
```
mcp__foundry-vtt__screenshot({})
```
The strip's Mv cell on the active combatant should show non-zero used; turn red after the move exceeds 30 ft.

> **Note on ruler color:** Foundry v13/v14 changed the TokenRuler API. Vagabond Crawler's `VCSTokenRuler` subclass approach may need adaptation. If the subclass approach fails to color waypoints, the strip's Mv cell turning red is the MVP fallback — the ruler color is a polish item, not blocking. Capture any errors here and address in Task 13 (polish).

- [ ] **Step 5: Reset**

```
mcp__foundry-vtt__evaluate({
  expression: `if (game.combat) await game.combat.delete(); return "ok";`
})
```

- [ ] **Step 6: Commit**

```powershell
git add scripts/movement-tracker.mjs scripts/shadowdark-enhancer.mjs scripts/crawl-strip.mjs
git commit -m "feat: combat movement tracker with turn-start capture"
```

---

## Task 10: Crawl-anchor capture + OoC budget enforcement

**Goal:** Clicking "Next Crawl Turn" captures the `crawlAnchor` flag on every token in the active scene. The Movement panel shows `used/90` live in crawl mode. When `oocEnforceBudget = true`, a `preUpdateToken` hook refuses moves that would push cumulative distance past 90 ft.

**Files:**
- Modify: `scripts/crawl-state.mjs` (`nextCrawlTurn` calls `MovementTracker.captureCrawlAnchors`; `endCrawl` calls `clearCrawlAnchors`)
- Modify: `scripts/movement-tracker.mjs` (add `preUpdateToken` enforcement hook)

**Acceptance Criteria:**
- [ ] On "Next Crawl Turn", `flags.shadowdark-enhancer.crawlAnchor` is set for every token in the scene to its current `{x, y}`
- [ ] On "End Crawl", `crawlAnchor` is cleared from every token
- [ ] With `oocEnforceBudget = true`, dragging a PC token past 90 ft from its `crawlAnchor` is silently denied; ui notification "movement budget exceeded"
- [ ] With `oocEnforceBudget = false`, the move is allowed but `used` exceeds budget and Mv cell turns red

**Verify:**
```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    const { MovementTracker } = await import("/modules/shadowdark-enhancer/scripts/movement-tracker.mjs");
    await CrawlState.startCrawl();
    await CrawlState.nextCrawlTurn();   // captures anchors

    const t = canvas.scene.tokens.contents.find(t => t.actor?.type === "Player");
    const anchorBefore = t.flags?.["shadowdark-enhancer"]?.crawlAnchor;

    // Attempt to move 1000px (well over 90 ft on standard 100px/5ft grid)
    const farAway = { x: t.x + 2000, y: t.y };
    await t.update(farAway);
    await new Promise(r => setTimeout(r, 50));
    const positionAfter = { x: t.x, y: t.y };

    await CrawlState.endCrawl();
    const anchorAfter = t.flags?.["shadowdark-enhancer"]?.crawlAnchor;
    return { anchorBefore, anchorAfter, blocked: positionAfter.x !== farAway.x };
  `
})
```
Expected: `anchorBefore` non-null, `anchorAfter` is `undefined` (cleared on End), `blocked: true` (move refused).

**Steps:**

- [ ] **Step 1: Hook anchor capture/clear into CrawlState**

Update `scripts/crawl-state.mjs`. At top of file:
```js
import { MovementTracker } from "./movement-tracker.mjs";
```

Modify `nextCrawlTurn`:
```js
  async nextCrawlTurn() {
    if (!game.user.isGM) return;
    if (this._state.mode !== "crawl") return;
    await this._update({ crawlTurn: this._state.crawlTurn + 1 });
    await MovementTracker.captureCrawlAnchors();
  },
```

Modify `startCrawl` to also capture anchors immediately (so the first turn has anchors):
```js
  async startCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    await this._update({ mode: "crawl" });
    await MovementTracker.captureCrawlAnchors();
  },
```

Modify `endCrawl`:
```js
  async endCrawl() {
    if (!game.user.isGM) return;
    if (this._state.mode === "combat") return;
    await this._update({ mode: "off", crawlTurn: 0 });
    await MovementTracker.clearCrawlAnchors();
  },
```

- [ ] **Step 2: Add enforcement hook to MovementTracker.init()**

In `scripts/movement-tracker.mjs`, append to `init()`:

```js
    // Enforce OoC movement budget if enabled.
    Hooks.on("preUpdateToken", (tokenDoc, changes, options, userId) => {
      // Only act on position changes
      if (!("x" in changes) && !("y" in changes)) return;
      // Only in crawl mode
      if (CrawlState.mode !== "crawl") return;
      // Only if enforcement is on
      if (!game.settings.get(MODULE_ID, "oocEnforceBudget")) return;
      // Only PC tokens
      if (tokenDoc.actor?.type !== "Player") return;

      const anchor = tokenDoc.flags?.[MODULE_ID]?.[FLAG_CRAWL_ANCHOR];
      if (!anchor) return;  // no anchor yet = no enforcement

      const proposed = {
        x: changes.x ?? tokenDoc.x,
        y: changes.y ?? tokenDoc.y,
      };
      const proposedDist = this._gridDistance(anchor, proposed);
      const budget = this.budgetFor("crawl");

      if (proposedDist > budget) {
        ui.notifications.warn(
          `${tokenDoc.actor?.name ?? "Token"}: crawl movement budget exceeded (${proposedDist}/${budget} ft).`
        );
        return false;  // cancel the update
      }
    });
```

- [ ] **Step 3: Verify**

```
mcp__foundry-vtt__reload_foundry({})
```

Place 2 PC tokens on the scene. Run the verify probe.

Visual:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.startCrawl();
    await CrawlState.nextCrawlTurn();
    return CrawlState.mode;
  `
})
```

Drag a PC token slowly past the 90 ft mark (~18 grid squares on a standard 5-ft grid). Expected: drop is refused with a "movement budget exceeded" notification.

Then toggle the setting:
```
mcp__foundry-vtt__evaluate({
  expression: `await game.settings.set("shadowdark-enhancer", "oocEnforceBudget", false); return game.settings.get("shadowdark-enhancer", "oocEnforceBudget");`
})
```
Drag past 90 ft again — expected: drop succeeds; strip's Mv cell turns red.

- [ ] **Step 4: Reset**

```
mcp__foundry-vtt__evaluate({
  expression: `
    const { CrawlState } = await import("/modules/shadowdark-enhancer/scripts/crawl-state.mjs");
    await CrawlState.endCrawl();
    await game.settings.set("shadowdark-enhancer", "oocEnforceBudget", true);
    return CrawlState.mode;
  `
})
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/crawl-state.mjs scripts/movement-tracker.mjs
git commit -m "feat: OoC crawl-anchor capture + budget enforcement"
```

---

## Task 11: Luck-spend click + Combat HUD dropdown

**Goal:** Clicking a Luck pip on any PC card calls `actor.system.useLuckToken()` (the system's existing spend method). Active-combatant cards have a "▼ HUD ▼" button that toggles a per-combatant dropdown with three tabs: Status (HP +/−, conditions, spend luck), Actions (passthrough to sheet), Movement (Rollback to Turn Start).

**Files:**
- Create: `scripts/npc-action-menu.mjs`
- Create: `templates/npc-action-menu.hbs`
- Modify: `scripts/crawl-strip.mjs` (add HUD trigger + event delegation for `spendLuck` + `rollbackTurn` + `openSheet` + `hpDelta` + tab toggle)
- Modify: `styles/shadowdark-enhancer.css` (dropdown styles)

**Acceptance Criteria:**
- [ ] Clicking a filled luck pip on a PC card decrements `system.luck.remaining` (or sets `available: false`) — verified by reading luck before/after
- [ ] Active-combatant card shows "▼ HUD ▼" trigger; clicking opens a dropdown beneath the card
- [ ] Dropdown has three tabs; the default tab is Status
- [ ] Status tab: `+1` and `-1` buttons modify HP; spend luck button visible only if `actor.system.hasLuckToken`
- [ ] Actions tab: "Open Sheet" button opens `actor.sheet`
- [ ] Movement tab: "Rollback to Turn Start" button moves the token back to its `turnStart` flag
- [ ] Dropdown closes when clicking outside or when the combat turn changes

**Verify:**
1. Set luck on Druchor manually:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const a = game.actors.get("fTwJht5Kb0ZVFZXx");
    await a.update({ "system.luck.available": true, "system.luck.remaining": 2 });
    return a.system.luck;
  `
})
```
2. Start a combat with that PC as active. Click the leftmost luck pip on its card.
3. Probe:
```
mcp__foundry-vtt__evaluate({
  expression: `
    const a = game.actors.get("fTwJht5Kb0ZVFZXx");
    return a.system.luck;
  `
})
```
Expected: `remaining: 1` (or `0, available: false` if the pip was the last). Repeat clicks until exhausted.

4. Move the active token, then click the Movement tab → "Rollback to Turn Start". Expected: token returns to its turn-start position.

**Steps:**

- [ ] **Step 1: Write `templates/npc-action-menu.hbs`**

```handlebars
<div class="sde-hud-dropdown" data-actor-id="{{actorId}}" data-token-id="{{tokenId}}">
  <div class="sde-hud-tabs">
    <button class="sde-hud-tab {{#if (eq tab "status")}}sde-hud-tab-active{{/if}}" data-action="hudTab" data-tab="status">Status</button>
    <button class="sde-hud-tab {{#if (eq tab "actions")}}sde-hud-tab-active{{/if}}" data-action="hudTab" data-tab="actions">Actions</button>
    <button class="sde-hud-tab {{#if (eq tab "movement")}}sde-hud-tab-active{{/if}}" data-action="hudTab" data-tab="movement">Movement</button>
    <button class="sde-hud-close" data-action="hudClose">×</button>
  </div>

  <div class="sde-hud-body">
    {{#if (eq tab "status")}}
      <div class="sde-hud-row">
        <span>HP {{hp.value}}/{{hp.max}}</span>
        <button class="sde-btn" data-action="hpDelta" data-delta="-1">−1</button>
        <button class="sde-btn" data-action="hpDelta" data-delta="1">+1</button>
        <button class="sde-btn" data-action="hpDelta" data-delta="-5">−5</button>
        <button class="sde-btn" data-action="hpDelta" data-delta="5">+5</button>
      </div>
      {{#if hasLuck}}
        <div class="sde-hud-row">
          <button class="sde-btn" data-action="spendLuck">Spend Luck</button>
        </div>
      {{/if}}
    {{/if}}

    {{#if (eq tab "actions")}}
      <div class="sde-hud-row">
        <button class="sde-btn" data-action="openSheet">Open Sheet</button>
      </div>
    {{/if}}

    {{#if (eq tab "movement")}}
      <div class="sde-hud-row">
        <button class="sde-btn" data-action="rollbackTurn">Rollback to Turn Start</button>
      </div>
    {{/if}}
  </div>
</div>
```

- [ ] **Step 2: Write `scripts/npc-action-menu.mjs`**

```js
import { MODULE_ID } from "./shadowdark-enhancer.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/npc-action-menu.hbs`;

export const NpcActionMenu = {
  _activeActorId: null,
  _activeTab: "status",
  _container: null,

  /**
   * Show dropdown beneath the given card element.
   * @param {HTMLElement} cardEl
   * @param {Actor} actor
   * @param {TokenDocument} tokenDoc
   */
  async open(cardEl, actor, tokenDoc) {
    this.close();
    this._activeActorId = actor.id;

    const ctx = {
      actorId: actor.id,
      tokenId: tokenDoc.id,
      tab: this._activeTab,
      hp: actor.system?.attributes?.hp ?? { value: 0, max: 0 },
      hasLuck: actor.system?.hasLuckToken === true,
    };

    const html = await renderTemplate(TEMPLATE, ctx);
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    const el = div.firstElementChild;
    cardEl.appendChild(el);
    this._container = el;

    // Outside click closes the dropdown
    setTimeout(() => {
      document.addEventListener("click", this._onOutsideClick, { capture: true });
    }, 0);
  },

  close() {
    if (this._container) {
      this._container.remove();
      this._container = null;
      this._activeActorId = null;
      document.removeEventListener("click", this._onOutsideClick, { capture: true });
    }
  },

  setTab(tab) {
    this._activeTab = tab;
    if (this._activeActorId) {
      const cardEl = this._container?.parentElement;
      const actor = game.actors.get(this._activeActorId);
      const tokenDoc = canvas.scene?.tokens.contents.find(t => t.actorId === this._activeActorId);
      if (cardEl && actor && tokenDoc) this.open(cardEl, actor, tokenDoc);
    }
  },

  _onOutsideClick: (ev) => {
    const dropdown = NpcActionMenu._container;
    if (!dropdown) return;
    if (dropdown.contains(ev.target)) return;
    // Don't close when clicking the HUD trigger button itself (it has its own toggle logic)
    if (ev.target.closest('[data-action="hudOpen"]')) return;
    NpcActionMenu.close();
  },
};
```

- [ ] **Step 3: Add HUD trigger to combat card + wire event delegation**

In `crawl-strip.mjs`:

```js
import { NpcActionMenu } from "./npc-action-menu.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
```

In `_buildCombatCards`, add a HUD trigger button inside the active card:

```js
      return `
        <div class="sde-card ${isActive}" data-combatant-id="${c.id}" data-token-id="${tokenId}" data-actor-id="${actor.id}">
          <div class="sde-card-name">
            <img class="sde-portrait" src="${actor.img}" alt="" />
            <span>${actor.name}</span>
          </div>
          ${hpPanel.render(actor)}
          ${movementPanel.render(actor, { mode: "combat", used, budget })}
          ${luckPanel.render(actor)}
          <span class="sde-cell sde-init">Init ${c.initiative ?? "—"}</span>
          ${isActive ? `<button class="sde-btn sde-hud-trigger" data-action="hudOpen">▼ HUD ▼</button>` : ""}
        </div>
      `;
```

Extend `_attachDelegatedEvents`:

```js
        case "spendLuck": {
          const actorId = btn.dataset.actorId ?? btn.closest("[data-actor-id]")?.dataset.actorId;
          const actor = game.actors.get(actorId);
          if (actor?.system?.useLuckToken) await actor.system.useLuckToken();
          return;
        }
        case "hudOpen": {
          const cardEl = btn.closest(".sde-card");
          const actorId = cardEl?.dataset.actorId;
          const tokenId = cardEl?.dataset.tokenId;
          const actor = game.actors.get(actorId);
          const tokenDoc = canvas.scene?.tokens.get(tokenId);
          if (actor && tokenDoc && cardEl) await NpcActionMenu.open(cardEl, actor, tokenDoc);
          return;
        }
        case "hudClose": return NpcActionMenu.close();
        case "hudTab": {
          const tab = btn.dataset.tab;
          if (tab) NpcActionMenu.setTab(tab);
          return;
        }
        case "openSheet": {
          const cardEl = btn.closest(".sde-card");
          const actor = game.actors.get(cardEl?.dataset.actorId);
          actor?.sheet?.render(true);
          return;
        }
        case "hpDelta": {
          const cardEl = btn.closest(".sde-card");
          const actor = game.actors.get(cardEl?.dataset.actorId);
          const delta = Number(btn.dataset.delta ?? 0);
          if (!actor) return;
          const hp = actor.system?.attributes?.hp ?? { value: 0, max: 0 };
          const next = Math.max(0, Math.min((hp.max ?? 0), (hp.value ?? 0) + delta));
          await actor.update({ "system.attributes.hp.value": next });
          return;
        }
        case "rollbackTurn": {
          const cardEl = btn.closest(".sde-card");
          const tokenDoc = canvas.scene?.tokens.get(cardEl?.dataset.tokenId);
          if (tokenDoc) await MovementTracker.rollbackToTurnStart(tokenDoc);
          NpcActionMenu.close();
          return;
        }
```

Add a hook to close the HUD on turn change. In `init()`:

```js
    this._hookIds.push(Hooks.on("combatTurn", () => NpcActionMenu.close()));
```

- [ ] **Step 4: Add dropdown CSS**

Append to `styles/shadowdark-enhancer.css`:

```css
.sde-hud-trigger {
  margin-top: 4px;
  font-size: 0.7em;
  letter-spacing: 0.1em;
}

.sde-hud-dropdown {
  position: absolute;
  margin-top: 4px;
  background: rgba(20, 20, 24, 0.96);
  border: 1px solid #555;
  border-radius: 5px;
  padding: 6px;
  min-width: 220px;
  z-index: 60;
}

.sde-card { position: relative; }

.sde-hud-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #444;
  margin-bottom: 6px;
  padding-bottom: 4px;
}
.sde-hud-tab {
  background: transparent;
  border: 1px solid transparent;
  color: #aaa;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.8em;
}
.sde-hud-tab-active { color: #ddd; border-color: #666; background: #333; }
.sde-hud-close { margin-left: auto; background: transparent; border: 0; color: #888; cursor: pointer; font-size: 1.1em; }

.sde-hud-body { display: flex; flex-direction: column; gap: 4px; }
.sde-hud-row { display: flex; gap: 4px; align-items: center; font-size: 0.85em; }
```

- [ ] **Step 5: Verify**

```
mcp__foundry-vtt__reload_foundry({})
```

Run the verify probes (set luck → start combat → click pip → check before/after).

Visual:
```
mcp__foundry-vtt__screenshot({})
```
Confirm HUD trigger appears on active card. Click it, screenshot shows dropdown with three tabs.

- [ ] **Step 6: Reset luck**

```
mcp__foundry-vtt__evaluate({
  expression: `
    const a = game.actors.get("fTwJht5Kb0ZVFZXx");
    await a.update({ "system.luck.available": false, "system.luck.remaining": 0 });
    return a.system.luck;
  `
})
```

- [ ] **Step 7: Commit**

```powershell
git add scripts/npc-action-menu.mjs templates/npc-action-menu.hbs scripts/crawl-strip.mjs styles/shadowdark-enhancer.css
git commit -m "feat: luck-spend pip + per-combatant HUD dropdown"
```

---

## Task 12: Coexistence warning for shadowdark-crawl-helper

**Goal:** At `ready`, if `shadowdark-crawl-helper` is active and `warnIfCrawlHelperEnabled` is true, show a non-blocking notification recommending the user disable it.

**Files:**
- Modify: `scripts/shadowdark-enhancer.mjs`
- Modify: `languages/en.json` (notification text)

**Acceptance Criteria:**
- [ ] With `shadowdark-crawl-helper` active, the user sees a yellow `ui.notifications.warn` notification at world load
- [ ] With the setting off, no notification
- [ ] With Crawl Helper inactive, no notification

**Verify:**
```
mcp__foundry-vtt__evaluate({
  expression: `
    return {
      crawlHelperActive: game.modules.get("shadowdark-crawl-helper")?.active,
      warnSetting:       game.settings.get("shadowdark-enhancer", "warnIfCrawlHelperEnabled"),
    };
  `
})
```
Manually enable `shadowdark-crawl-helper`, reload, observe the warning notification.

**Steps:**

- [ ] **Step 1: Add coexistence check to ready hook**

Update `scripts/shadowdark-enhancer.mjs`:

```js
Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
  registerHiddenSync();
  MovementTracker.init();
  CrawlStrip.init();
  checkCoexistence();
});

function checkCoexistence() {
  if (!game.settings.get(MODULE_ID, "warnIfCrawlHelperEnabled")) return;
  const crawlHelper = game.modules.get("shadowdark-crawl-helper");
  if (crawlHelper?.active) {
    ui.notifications.warn(game.i18n.localize("SDE.notifications.crawlHelperConflict"));
  }
}
```

- [ ] **Step 2: Add localized text**

Append to `languages/en.json`:

```json
,
  "SDE.notifications.crawlHelperConflict": "Shadowdark Enhancer detected that shadowdark-crawl-helper is also enabled. For best results, disable Crawl Helper. (You can suppress this warning in Module Settings.)"
```

(Make sure the comma comes before the new key inside the existing `{}`.)

- [ ] **Step 3: Verify**

Enable `shadowdark-crawl-helper` via Manage Modules. Reload. Observe yellow warning.

Then disable it, reload — no warning.

- [ ] **Step 4: Commit**

```powershell
git add scripts/shadowdark-enhancer.mjs languages/en.json
git commit -m "feat: warn when shadowdark-crawl-helper is active"
```

---

## Task 13: CSS polish + Shadowdark palette

**Goal:** Replace the placeholder dark palette with a Shadowdark-flavored palette (warm parchment-and-iron tones to evoke torchlight in dungeons). Verify ruler color subclass; if the Foundry v14 TokenRuler API requires adjustment, fix it here. Polish spacing, hover states, and small visual issues.

**Files:**
- Modify: `styles/shadowdark-enhancer.css`
- (Conditional) Modify: `scripts/movement-tracker.mjs` if the TokenRuler subclass needs a real implementation

**Acceptance Criteria:**
- [ ] Strip uses a parchment/iron accent palette (background still dark, accents amber/parchment)
- [ ] Active combatant border uses a warm amber-gold glow
- [ ] All buttons have visible hover states
- [ ] No layout overflow; cards wrap to a second row if more than ~6
- [ ] Ruler color works OR is documented as a follow-up (see note in Task 9 Step 4)

**Verify:** Visual review across crawl mode (4 PC cards) and combat mode (6 combatants, one hidden).

```
mcp__foundry-vtt__screenshot({})
```
Take screenshots in both modes; compare with mockups in spec §6.1 and §6.2.

**Steps:**

- [ ] **Step 1: Refine palette**

Replace the placeholder color values in `styles/shadowdark-enhancer.css` with a Shadowdark-flavored palette. Suggested values:

```css
:root {
  --sde-bg-strip:    rgba(18, 16, 14, 0.88);
  --sde-bg-card:     rgba(28, 24, 20, 0.88);
  --sde-border:      #5a4a3a;
  --sde-accent:      #c8965a;   /* warm torchlight */
  --sde-accent-glow: rgba(200, 150, 90, 0.55);
  --sde-text:        #e6dccc;
  --sde-text-dim:    #a89e8e;
  --sde-danger:      #c44a3a;   /* HP-low / over-budget */
  --sde-crawl:       #4a6a3a;
  --sde-combat:      #6b1f1f;
}

.sde-strip-header { background: var(--sde-bg-strip); border-color: var(--sde-border); color: var(--sde-text); }
.sde-card         { background: var(--sde-bg-card); border-color: var(--sde-border); color: var(--sde-text); }
.sde-card-active  { border-color: var(--sde-accent); box-shadow: 0 0 8px var(--sde-accent-glow); }
.sde-mode-crawl   { background: var(--sde-crawl);  color: #cfe6cf; }
.sde-mode-combat  { background: var(--sde-combat); color: #f3cfcf; }
.sde-btn          { background: #2b261f; border-color: var(--sde-border); color: var(--sde-text); }
.sde-btn:hover    { background: #3c3528; border-color: var(--sde-accent); }
.sde-pip-filled   { background: var(--sde-accent); border-color: var(--sde-accent); }
.sde-hp-low, .sde-mv-over { color: var(--sde-danger); }
.sde-strip-cards  { flex-wrap: wrap; }   /* allow second row */
```

- [ ] **Step 2: Verify visual**

```
mcp__foundry-vtt__reload_foundry({})
```

Enter crawl mode and screenshot. Enter combat with multiple combatants and screenshot.

- [ ] **Step 3: Test ruler color (verify Task 9 carry-over)**

Drag-measure the active combatant past 30 ft. If the ruler's waypoint dots/segments do NOT color red, capture the console error and decide:
- If the error is a missing API on `foundry.canvas.placeables.tokens.TokenRuler`: defer to a follow-up issue (file a TODO comment in `movement-tracker.mjs` and proceed). The strip's Mv cell turning red is the MVP shipping behavior.
- If the error is fixable in <30 minutes: fix it inline.

If skipped, append to README:
> Known issue: in-canvas ruler color does not yet update; the strip's Movement cell shows the red over-budget indicator. To be addressed in a follow-up.

- [ ] **Step 4: Commit**

```powershell
git add styles/shadowdark-enhancer.css README.md
git commit -m "polish: Shadowdark palette + visual tuning"
```

(Add `scripts/movement-tracker.mjs` to the commit if Step 3 modified it.)

---

## Task 14: README + version bump + manual UAT pass

**Goal:** Finalize README documentation for v0.1.0 release; bump manifest version (already 0.1.0; bump CHANGELOG to release); run the full UAT checklist from spec §11. Open issues found.

**Files:**
- Modify: `README.md` (full content)
- Modify: `CHANGELOG.md` (move Unreleased → v0.1.0)
- (Optional) Tag: `v0.1.0`

**Acceptance Criteria:**
- [ ] README documents installation, requirements, features, settings, known issues
- [ ] CHANGELOG has a dated v0.1.0 entry summarizing the milestone
- [ ] All checkboxes in spec §11 (Manual UAT checklist) are passing or have a tracking note (e.g. "deferred to Task 13 follow-up")
- [ ] `git tag v0.1.0` succeeds (or is recorded as a manual step)

**Verify:** Walk through the entire spec §11 checklist in the running world; mark each item ✓ in this plan task's working notes (or in a separate UAT.md if preferred).

**Steps:**

- [ ] **Step 1: Expand README**

Replace `README.md` with the production version:

```markdown
# Shadowdark Enhancer

Top Crawl Strip for Shadowdark RPG on Foundry VTT — out-of-combat marching order, in-combat initiative, HP/Movement/Luck readouts, movement-budget enforcement with turn-start rollback, and a per-combatant action HUD.

This module is the first milestone in a larger Shadowdark companion suite. The bottom bar (encounters, lights, rest, loot, party inventory, session tracker) is planned for subsequent milestones.

## Requirements

- Foundry VTT v13+ (verified v14.361)
- Shadowdark RPG system v3.6.2+ (verified v4.0.4)

## Features (v0.1.0)

- **Crawl mode**: GM-toggleable crawl loop with a turn counter. Players roll initiative for marching order; roll persists until reset. Movement budget (default 90 ft per crawl turn) optionally enforced.
- **Combat mode**: One card per combatant in initiative order. Hidden NPCs are filtered (and Token ↔ Combatant hidden flags stay in sync). Round and turn counter pulled live from Foundry's Combat tracker. Movement red-line at 30 ft (default) from the combatant's turn-start position.
- **Stat cells per card**: HP, Movement budget, Luck (PCs only; reads `system.luck`, click a filled pip to spend via `actor.system.useLuckToken()`).
- **Per-combatant HUD dropdown** on the active combatant in combat: Status (HP +/−), Actions (open sheet), Movement (Rollback to Turn Start).

## Settings

| Setting | Default |
|---|---|
| Combat movement default (ft) | 30 |
| Out-of-combat movement budget (ft) | 90 |
| Enforce out-of-combat movement budget | on |
| Hide hidden NPCs from the strip | on |
| Warn when shadowdark-crawl-helper is enabled | on |

## Coexistence

- **`shadowdark-crawl-helper`**: this module is intended to replace it. With Crawl Helper enabled you'll see a warning on world load; disable Crawl Helper for best results.

## Known issues

- NPCs have `system.move` (string like "near", "double near") in the base system, but v0.1.0 treats all combatants as 30-ft. Follow-up milestone will parse the string for per-NPC budgets.
- In-canvas ruler color update may be a follow-up depending on Foundry v14 ruler-API parity with v13.

## Installation

Paste the following manifest URL into Foundry's module installer:

```
https://github.com/DimitroffVodka/shadowdark-enhancer/releases/latest/download/module.json
```

## License

MIT — see `LICENSE`.
```

- [ ] **Step 2: Update `CHANGELOG.md`**

Replace `CHANGELOG.md` with:

```markdown
# Changelog

## [0.1.0] — 2026-05-14

### Added
- Top Crawl Strip mounted at the top of the canvas.
- Three-state mode model (`off` / `crawl` / `combat`) with world-setting persistence + socket sync.
- HP, Movement, and Luck stat cells per card.
- Out-of-combat marching-order initiative (`1d20 + bonus`, advantage via system helper); manual reset.
- Crawl turn counter with per-token `crawlAnchor` capture; optional movement-budget enforcement (default 90 ft).
- Combat-mode per-combatant cards with active-combatant highlight and hidden-NPC filter.
- Bidirectional `token.hidden ↔ combatant.hidden` sync.
- `VCSTokenRuler`-derived movement tracker with turn-start position capture.
- Per-active-combatant HUD dropdown: Status / Actions / Movement (Rollback to Turn Start).
- Coexistence warning when `shadowdark-crawl-helper` is active.

### Known limitations
- NPC `system.move` string ("near", "double near", "far") not yet parsed; flat 30-ft combat budget for all NPCs.
- In-canvas ruler color update is best-effort under the Foundry v14 ruler API (see README).
```

- [ ] **Step 3: Run the full spec §11 UAT checklist**

Open the spec file: `docs/superpowers/specs/2026-05-14-shadowdark-enhancer-top-strip-design.md`. Walk every checkbox in §11 against the running world, using `mcp__foundry-vtt__screenshot` and `mcp__foundry-vtt__evaluate` as needed. Track results in a working scratchpad.

For each failing item: file a follow-up TODO (in `CHANGELOG.md` "Known limitations" or as a separate issue), but do NOT block v0.1.0 unless the failure is a P0 (strip doesn't mount, world fails to load, errors on every render).

- [ ] **Step 4: Commit + tag**

```powershell
git add README.md CHANGELOG.md
git commit -m "docs: v0.1.0 release notes"
git tag v0.1.0
```

(Pushing to GitHub is out of scope for this plan; the user can `git remote add origin … && git push --tags` when ready.)

---

## Self-Review Notes

After writing this plan, ran the self-review pass:

**Spec coverage:**
- §3 Decisions → covered by Tasks 0–14
- §4 Manifest → Task 0
- §4 File layout → Tasks 0–11
- §5 State model → Tasks 2, 9, 10
- §6 UI Crawl Strip → Tasks 3, 5, 7
- §6.3 Stat panels → Task 4
- §6.6 Combat HUD dropdown → Task 11
- §7 Movement tracking → Tasks 9, 10
- §7.3 Settings → Task 1
- §8 Initiative → Task 6 (OoC); Foundry-native (combat init delegated)
- §9 Coexistence → Task 12
- §11 UAT → Task 14

**Type/method consistency:**
- `CrawlState.HOOK_CHANGED` used in Tasks 3, 9 → defined in Task 2 ✓
- `MovementTracker.usedFor(tokenDoc, mode)` signature used in Tasks 9, 10 → defined in Task 9 ✓
- `MovementTracker.budgetFor(mode)` used in Tasks 5, 7 → defined in Task 9 ✓
- `NpcActionMenu.open(cardEl, actor, tokenDoc)` used in Task 11 → defined in Task 11 ✓
- `actor.system.useLuckToken()` confirmed live (brainstorming MCP probe) ✓
- Data flow: `oocInitiative` keyed by `tokenId` (matches spec correction) ✓

**Placeholder scan:** No "TBD", "implement later", or "similar to Task N" lines. The two soft-deferred items (`MIT license` confirmation, ruler-color fallback in Task 9/13) have explicit fallback behavior documented.

**Scope check:** Plan stays inside MVP scope. All deferred items are in the spec's §10 Out-of-scope list.

No issues to fix.
