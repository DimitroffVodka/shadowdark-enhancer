# Slice 1d — Browse NPCs Tab Implementation Plan

> **For agentic workers (Gemini, Claude, anyone):** This plan is self-contained. Execute it task-by-task. Each task ends with a `git commit` step. Don't merge tasks; don't skip the smoke-test steps; don't invent new features. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Browse NPCs tab (tab 2 of 4) in the existing Encounter Roller window, so a GM can filter and explore Shadowdark NPC sources (system bestiary, world actors, scene tokens, installed community packs) and drag NPCs out to the canvas or — when Slice 1c lands — into Build Table slots.

**Architecture:** New file `scripts/encounter/encounter-browse.mjs` holds the tab's logic (data store, filter/sort, drag payload). The existing `EncounterRollerApp` (already a 4-tab `HandlebarsApplicationMixin(ApplicationV2)`) currently renders the Browse NPCs tab as a disabled stub — Task 4 swaps the stub for the live tab. Source list is configurable via a new world setting `encounterSources`. NPC index data is cached per-source per-session so re-renders don't hammer compendium reads.

**Tech Stack:** Foundry VTT v13/v14, Shadowdark system v4+, ApplicationV2 + Handlebars (already in use), no external libs.

---

## Important context before you start

1. **Read these existing files first** (each is small — under 320 LOC):
   - `scripts/encounter/encounter-roller-app.mjs` — the parent app you're plugging into
   - `templates/encounter-roller.hbs` — the 4-tab template
   - `scripts/encounter/encounter-result.mjs` — pattern reference (small)
   - `scripts/settings.mjs` — how settings are registered in this module
   - `styles/shadowdark-enhancer.css` — search for `.sde-encounter-roller` to see existing tab/control styling you should match
   - `docs/superpowers/specs/2026-05-15-encounter-system-phase1-design.md` — design context for the encounter system

2. **Vagabond Crawler reference** (the system this is ported from): `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/encounter-tools.mjs`. Search for `_browseSource`, `_browseSearch`, `_browseType`, `_browseTlMin`, `_browseSortCol`, `_browseCache`, `_renderBrowseTab` for the original UX patterns. You're porting the *intent*, not the code — Shadowdark NPCs have a different schema (no Threat Level, no creature `beingType`, has Level + Alignment instead).

3. **Existing conventions in this module:**
   - All scripts use `MODULE_ID` from `scripts/module-id.mjs` — never hardcode `"shadowdark-enhancer"`.
   - Templates use Foundry's namespaced `foundry.applications.handlebars.renderTemplate`, NOT the deprecated global.
   - CSS classes use the `sde-` prefix.
   - Existing tab CSS lives under `.sde-encounter-roller .sde-tabs` — match that visual style.
   - Inline comments explain *why*, not *what*.

4. **Shadowdark NPC schema** (read from `actor.system` where `actor.type === "NPC"`):
   - `level` (number, can be `"--"` or 0 for level-0 mooks — coerce to number with fallback)
   - `alignment` (`"L"`, `"N"`, or `"C"`)
   - `attributes.hp.value` and `attributes.hp.max` (numbers)
   - `attributes.ac.value` (number)
   - `move` (string enum: `"close"`, `"near"`, `"doubleNear"`, `"tripleNear"`, `"far"`, `"special"`, `"none"`)
   - There is **no** formal `creatureType` field — don't add a type filter.

5. **What this slice does NOT touch:**
   - Build Table tab (Slice 1c — separate work, may not exist yet when you run this)
   - Monster Creator tab (Slice 1e)
   - The Roll Tables tab
   - The Encounter Check flow on the Crawl Bar

6. **Build Table integration:** Build Table tab does not exist yet. Do NOT add a "+" button that targets Build Table — instead, make each NPC row **draggable** with the standard Foundry drag payload `{type: "Actor", uuid: actor.uuid}`. Build Table (Slice 1c) will accept those drops natively. This keeps 1c and 1d independent.

---

## Task 0: Register `encounterSources` setting + auto-detect helper

**Goal:** Add a world setting that stores which Foundry sources (compendium packs + virtual `world` / `scene` keys) the Browse tab reads from, and a helper that lists all *available* NPC sources for the picker UI.

**Files:**
- Modify: `scripts/settings.mjs` (add one `game.settings.register` call)
- Modify: `languages/en.json` (add name/hint i18n keys)

**Acceptance Criteria:**
- [ ] `game.settings.get("shadowdark-enhancer", "encounterSources")` returns an array of source IDs.
- [ ] Default value is `["world", "shadowdark.bestiary"]`.
- [ ] Setting is `scope: "world"`, `config: false` (we manage it via the Browse tab UI, not Foundry's settings menu).

**Verify:** Reload Foundry → open browser console → `game.settings.get("shadowdark-enhancer", "encounterSources")` returns `["world", "shadowdark.bestiary"]`.

**Steps:**

- [ ] **Step 1: Open `scripts/settings.mjs` and add the new setting after the existing `autoRollActiveTable` registration:**

```js
game.settings.register(MODULE_ID, "encounterSources", {
  scope: "world",
  config: false,
  type: Array,
  default: ["world", "shadowdark.bestiary"],
});
```

- [ ] **Step 2: Add i18n strings to `languages/en.json` (append before the closing brace of the root object):**

```json
"SDE.encounter.browse.source.world": "World Actors",
"SDE.encounter.browse.source.scene": "Current Scene",
"SDE.encounter.browse.search.placeholder": "Search by name…",
"SDE.encounter.browse.empty": "No matching NPCs.",
"SDE.encounter.browse.sources.empty": "No sources selected. Configure at the top of this tab."
```

- [ ] **Step 3: Commit.**

```bash
git add scripts/settings.mjs languages/en.json
git commit -m "chore: register encounterSources setting for Browse NPCs tab

Stores the list of source pack IDs (plus virtual 'world' / 'scene'
keys) the Browse NPCs tab reads from. Default includes the world
actors collection and shadowdark.bestiary.

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

## Task 1: Create the data layer in `encounter-browse.mjs`

**Goal:** A standalone module that lists available sources, loads NPCs from selected sources (with caching), and exposes filter/sort/search helpers. Pure data — no DOM, no Application logic.

**Files:**
- Create: `scripts/encounter/encounter-browse.mjs`

**Acceptance Criteria:**
- [ ] `EncounterBrowse.listAvailableSources()` returns an array of `{id, label, type}` covering: `world`, `scene`, plus every installed compendium pack whose `metadata.type === "Actor"`.
- [ ] `EncounterBrowse.loadNPCs(sourceIds)` returns a Promise resolving to an array of plain row objects (see schema below). Caches per source ID for the session.
- [ ] `EncounterBrowse.applyFilters(rows, {search, alignment, levelMin, levelMax})` returns the filtered subset.
- [ ] `EncounterBrowse.applySort(rows, {column, ascending})` returns the sorted array.
- [ ] All async-loading actors are skipped if actor type is not `"NPC"`.

**Row schema** (one per NPC):
```js
{
  uuid: "Compendium.shadowdark.bestiary.Actor.xyz",  // string
  id:   "xyz",                                       // short id (last segment)
  name: "Beastman",                                  // string
  img:  "icons/svg/mystery-man.svg",                 // string (with fallback)
  level: 1,                                          // number (NaN if missing)
  alignment: "C",                                    // "L" | "N" | "C" | ""
  hp:   5,                                           // number (uses .max, fallback .value, fallback 0)
  ac:   12,                                          // number (fallback 10)
  move: "near",                                      // string enum
  sourceId: "shadowdark.bestiary",                   // string — which source this came from
  sourceLabel: "Shadowdark Bestiary",                // string — pretty label for that source
}
```

**Verify:**
```bash
node --check scripts/encounter/encounter-browse.mjs && echo "OK"
```
Plus in Foundry console:
```js
const m = await import("/modules/shadowdark-enhancer/scripts/encounter/encounter-browse.mjs");
console.log(m.EncounterBrowse.listAvailableSources());
console.log(await m.EncounterBrowse.loadNPCs(["world", "shadowdark.bestiary"]));
```
Expected: source list includes `world`, `scene`, `shadowdark.bestiary`, and any other Actor packs installed. NPC list has objects matching the row schema.

**Steps:**

- [ ] **Step 1: Create `scripts/encounter/encounter-browse.mjs` with this exact content:**

```js
/**
 * Shadowdark Enhancer — Encounter Browse data layer
 * Slice 1d: source listing, NPC loading + caching, filter/sort helpers.
 *
 * Pure data module — no DOM, no Application logic. The Browse NPCs tab
 * inside EncounterRollerApp calls into this module for its data needs.
 */

import { MODULE_ID } from "../module-id.mjs";

// In-memory cache: sourceId → array<row>. Cleared on browser refresh.
const _cache = new Map();

export const EncounterBrowse = {

  /**
   * Lists every source the Browse tab can read NPCs from.
   * Always includes the virtual `world` and `scene` entries plus every
   * installed compendium pack whose metadata.type === "Actor".
   *
   * @returns {Array<{id: string, label: string, type: "virtual" | "pack"}>}
   */
  listAvailableSources() {
    const sources = [
      { id: "world", label: "World Actors", type: "virtual" },
      { id: "scene", label: "Current Scene", type: "virtual" },
    ];
    for (const pack of game.packs) {
      if (pack.metadata.type !== "Actor") continue;
      sources.push({
        id: pack.collection,           // e.g. "shadowdark.bestiary"
        label: pack.metadata.label,    // e.g. "Shadowdark Bestiary"
        type: "pack",
      });
    }
    return sources;
  },

  /**
   * Load NPC rows from the given source IDs. Results are cached per
   * source for the session, so re-renders don't re-read compendium
   * indices.
   *
   * @param {Array<string>} sourceIds
   * @returns {Promise<Array<object>>} flattened rows
   */
  async loadNPCs(sourceIds = []) {
    const out = [];
    for (const id of sourceIds) {
      if (_cache.has(id)) {
        out.push(..._cache.get(id));
        continue;
      }
      const rows = await this._loadFromSource(id);
      _cache.set(id, rows);
      out.push(...rows);
    }
    return out;
  },

  /**
   * Drop the cache for one source (or all). Useful when the world
   * actors collection changes — call this from a createActor /
   * deleteActor hook in the orchestrating tab if you want live updates.
   * For Slice 1d we don't wire that hook; the cache lives until reload.
   *
   * @param {string|null} sourceId
   */
  invalidateCache(sourceId = null) {
    if (sourceId) _cache.delete(sourceId);
    else _cache.clear();
  },

  /**
   * Filter rows by search text, alignment whitelist, and level range.
   * All filters are AND-combined. Empty/falsy filter values are skipped.
   *
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {string} [opts.search]       — case-insensitive substring on name
   * @param {Array<string>} [opts.alignment] — e.g. ["L", "N"] (empty = all)
   * @param {number} [opts.levelMin]
   * @param {number} [opts.levelMax]
   * @returns {Array<object>}
   */
  applyFilters(rows, { search = "", alignment = [], levelMin = null, levelMax = null } = {}) {
    const needle = search.trim().toLowerCase();
    return rows.filter(r => {
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      if (alignment.length && !alignment.includes(r.alignment)) return false;
      if (levelMin != null && Number.isFinite(r.level) && r.level < levelMin) return false;
      if (levelMax != null && Number.isFinite(r.level) && r.level > levelMax) return false;
      return true;
    });
  },

  /**
   * Sort rows in place by the given column ascending/descending.
   * Numeric columns (level, hp, ac) use numeric comparison; everything
   * else uses string comparison.
   *
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {string} opts.column      — one of: name, level, alignment, hp, ac, move, sourceLabel
   * @param {boolean} opts.ascending
   * @returns {Array<object>} returns the same array, sorted
   */
  applySort(rows, { column = "name", ascending = true } = {}) {
    const numeric = ["level", "hp", "ac"].includes(column);
    rows.sort((a, b) => {
      const av = a[column] ?? (numeric ? 0 : "");
      const bv = b[column] ?? (numeric ? 0 : "");
      const cmp = numeric ? (av - bv) : String(av).localeCompare(String(bv));
      return ascending ? cmp : -cmp;
    });
    return rows;
  },

  // ───── Internal ────────────────────────────────────────────────────

  /**
   * Load NPC rows from a single source.
   * @private
   */
  async _loadFromSource(id) {
    if (id === "world")  return this._loadFromWorld();
    if (id === "scene")  return this._loadFromScene();
    return this._loadFromPack(id);
  },

  _loadFromWorld() {
    const rows = [];
    for (const actor of game.actors) {
      if (actor.type !== "NPC") continue;
      rows.push(this._actorToRow(actor, "world", "World Actors"));
    }
    return rows;
  },

  _loadFromScene() {
    const scene = canvas.scene;
    if (!scene) return [];
    const seen = new Set();
    const rows = [];
    for (const tok of scene.tokens) {
      const actor = tok.actor;
      if (!actor || actor.type !== "NPC") continue;
      if (seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      rows.push(this._actorToRow(actor, "scene", "Current Scene"));
    }
    return rows;
  },

  async _loadFromPack(packId) {
    const pack = game.packs.get(packId);
    if (!pack) return [];
    const label = pack.metadata.label;
    // getIndex with fields keeps memory down — we read the full doc
    // only when needed (which for the table view is never).
    const index = await pack.getIndex({
      fields: [
        "system.level",
        "system.alignment",
        "system.attributes.hp.value",
        "system.attributes.hp.max",
        "system.attributes.ac.value",
        "system.move",
      ],
    });
    const rows = [];
    for (const entry of index) {
      // Pack indices include items + actors; filter to actors only.
      // We don't have a `type` field in the index by default for some
      // packs, so we infer: actor entries have a `system.attributes` shape.
      const sys = entry.system ?? {};
      if (!sys.attributes) continue;
      rows.push({
        uuid: `Compendium.${packId}.Actor.${entry._id}`,
        id: entry._id,
        name: entry.name ?? "Unknown",
        img: entry.img ?? "icons/svg/mystery-man.svg",
        level: Number(sys.level ?? NaN),
        alignment: sys.alignment ?? "",
        hp: Number(sys.attributes?.hp?.max ?? sys.attributes?.hp?.value ?? 0),
        ac: Number(sys.attributes?.ac?.value ?? 10),
        move: sys.move ?? "near",
        sourceId: packId,
        sourceLabel: label,
      });
    }
    return rows;
  },

  _actorToRow(actor, sourceId, sourceLabel) {
    const sys = actor.system ?? {};
    return {
      uuid: actor.uuid,
      id: actor.id,
      name: actor.name ?? "Unknown",
      img: actor.img ?? "icons/svg/mystery-man.svg",
      level: Number(sys.level ?? NaN),
      alignment: sys.alignment ?? "",
      hp: Number(sys.attributes?.hp?.max ?? sys.attributes?.hp?.value ?? 0),
      ac: Number(sys.attributes?.ac?.value ?? 10),
      move: sys.move ?? "near",
      sourceId,
      sourceLabel,
    };
  },
};
```

- [ ] **Step 2: Syntax check.**

```bash
node --check scripts/encounter/encounter-browse.mjs && echo "OK"
```
Expected: `OK`

- [ ] **Step 3: Commit.**

```bash
git add scripts/encounter/encounter-browse.mjs
git commit -m "feat(1d): encounter-browse data layer — sources, loading, filter, sort

Pure data module that powers the Browse NPCs tab:
- listAvailableSources: enumerates world, scene, and Actor compendium packs
- loadNPCs(sourceIds): loads + caches NPC rows from each selected source
- applyFilters: search text, alignment whitelist, level range
- applySort: by name / level / alignment / hp / ac / move / sourceLabel

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

## Task 2: Wire the data layer into `EncounterRollerApp`

**Goal:** Extend `EncounterRollerApp` with browse-tab state (selected sources, filters, sort) and have `_prepareContext` provide the filtered + sorted row list when the active tab is `browse`.

**Files:**
- Modify: `scripts/encounter/encounter-roller-app.mjs`

**Acceptance Criteria:**
- [ ] Constructor initializes `this._browseSources` from `encounterSources` setting, plus `_browseSearch=""`, `_browseAlignment=[]`, `_browseLevelMin=null`, `_browseLevelMax=null`, `_browseSortCol="name"`, `_browseSortAsc=true`.
- [ ] `_prepareContext` when on the browse tab returns `availableSources`, `selectedSources`, `browseRows` (filtered + sorted), and the current filter state.
- [ ] Loading source data is gated on `activeTab === "browse"` so we don't load when on other tabs.

**Verify:** `node --check scripts/encounter/encounter-roller-app.mjs` returns OK. Open Foundry, open the Encounter Roller, click the Browse NPCs tab (still a stub at this point) — no console errors.

**Steps:**

- [ ] **Step 1: Add the import at the top of `scripts/encounter/encounter-roller-app.mjs` (under the existing imports):**

```js
import { EncounterBrowse } from "./encounter-browse.mjs";
```

- [ ] **Step 2: Extend the constructor. Find the existing `constructor(options = {}) {` block and add these initializations AFTER `this._placeAbort = null;`:**

```js
    // Browse NPCs tab state. Loaded lazily — only when the user actually
    // opens the Browse tab do we read from compendium packs.
    this._browseSources    = game.settings.get(MODULE_ID, "encounterSources") ?? ["world", "shadowdark.bestiary"];
    this._browseSearch     = "";
    this._browseAlignment  = []; // empty array = all alignments pass
    this._browseLevelMin   = null;
    this._browseLevelMax   = null;
    this._browseSortCol    = "name";
    this._browseSortAsc    = true;
```

- [ ] **Step 3: Extend `_prepareContext`. Find the existing `async _prepareContext(options) {` method. AFTER the existing `tablePreview` line and BEFORE the `return { ... };` block, add this:**

```js
    // Browse NPCs tab — load + filter + sort, but only when the tab is
    // active so other tabs don't pay the cost.
    let browseData = null;
    if (this._activeTab === "browse") {
      const all = await EncounterBrowse.loadNPCs(this._browseSources);
      const filtered = EncounterBrowse.applyFilters(all, {
        search:    this._browseSearch,
        alignment: this._browseAlignment,
        levelMin:  this._browseLevelMin,
        levelMax:  this._browseLevelMax,
      });
      EncounterBrowse.applySort(filtered, {
        column:    this._browseSortCol,
        ascending: this._browseSortAsc,
      });
      browseData = {
        availableSources: EncounterBrowse.listAvailableSources(),
        selectedSources:  this._browseSources,
        rows:             filtered,
        totalCount:       all.length,
        filteredCount:    filtered.length,
        search:           this._browseSearch,
        alignment:        this._browseAlignment,
        levelMin:         this._browseLevelMin,
        levelMax:         this._browseLevelMax,
        sortCol:          this._browseSortCol,
        sortAsc:          this._browseSortAsc,
      };
    }
```

- [ ] **Step 4: Add `browseData` to the return object. Change the existing `return { ... }` to include the new key. Final return statement looks like:**

```js
    return {
      activeTab: this._activeTab,
      selectedTableId: this._selectedTableId,
      tableGroups,
      tablePreview,
      lastResult: this._lastResult,
      browseData,
    };
```

- [ ] **Step 5: Add action handlers in the `static DEFAULT_OPTIONS.actions` map (find the existing `actions: { ... }` block and add these entries):**

```js
      browseToggleSource: EncounterRollerApp.prototype._onBrowseToggleSource,
      browseSort:         EncounterRollerApp.prototype._onBrowseSort,
      browseToggleAlign:  EncounterRollerApp.prototype._onBrowseToggleAlign,
```

- [ ] **Step 6: Add the handler methods. Place them as new instance methods on `EncounterRollerApp` (after `_onPreviewPlace` is a good spot):**

```js
  async _onBrowseToggleSource(event, target) {
    const id = target.dataset.sourceId;
    if (!id) return;
    const set = new Set(this._browseSources);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this._browseSources = [...set];
    EncounterBrowse.invalidateCache();    // selected sources changed
    await game.settings.set(MODULE_ID, "encounterSources", this._browseSources);
    this.render();
  }

  _onBrowseSort(event, target) {
    const col = target.dataset.column;
    if (!col) return;
    if (col === this._browseSortCol) {
      this._browseSortAsc = !this._browseSortAsc;
    } else {
      this._browseSortCol = col;
      this._browseSortAsc = true;
    }
    this.render();
  }

  _onBrowseToggleAlign(event, target) {
    const a = target.dataset.alignment;
    if (!a) return;
    const set = new Set(this._browseAlignment);
    if (set.has(a)) set.delete(a);
    else set.add(a);
    this._browseAlignment = [...set];
    this.render();
  }
```

- [ ] **Step 7: Wire the search input + level range inputs in `_onRender`. Find the existing `_onRender(context, options) { super._onRender(context, options); ... }` block and append AFTER the existing table-select listener:**

```js
    // Browse tab: search input, level min/max
    const searchInput = this.element.querySelector("input[name='browseSearch']");
    if (searchInput) {
      // Debounce so we don't render on every keystroke
      let timeout = null;
      searchInput.addEventListener("input", ev => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          this._browseSearch = ev.target.value;
          this.render();
        }, 200);
      });
    }
    const minInput = this.element.querySelector("input[name='browseLevelMin']");
    if (minInput) {
      minInput.addEventListener("change", ev => {
        const v = ev.target.value;
        this._browseLevelMin = v === "" ? null : Number(v);
        this.render();
      });
    }
    const maxInput = this.element.querySelector("input[name='browseLevelMax']");
    if (maxInput) {
      maxInput.addEventListener("change", ev => {
        const v = ev.target.value;
        this._browseLevelMax = v === "" ? null : Number(v);
        this.render();
      });
    }
```

- [ ] **Step 8: Syntax check.**

```bash
node --check scripts/encounter/encounter-roller-app.mjs && echo "OK"
```

- [ ] **Step 9: Commit.**

```bash
git add scripts/encounter/encounter-roller-app.mjs
git commit -m "feat(1d): wire Browse NPCs state + handlers into EncounterRollerApp

Adds browse-tab state (sources, search, alignment, level range, sort),
action handlers, and DOM event wiring. _prepareContext lazily loads
the NPC list only when the Browse tab is active.

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

## Task 3: Replace the Browse NPCs tab stub with the live template

**Goal:** Render the Browse NPCs UI — source-pill toggles at top, search + alignment + level filters, sortable table of NPCs with draggable rows.

**Files:**
- Modify: `templates/encounter-roller.hbs`

**Acceptance Criteria:**
- [ ] When `browseData` is null (other tab active) the tab content is empty (no crash).
- [ ] Source pills render one per `availableSources` entry, with `.is-active` class when included in `selectedSources`. Clicking calls `browseToggleSource` action.
- [ ] Search input is wired to `name="browseSearch"`, initial value = `browseData.search`.
- [ ] Alignment toggle group (L / N / C) — each is a button with `.is-active` when included in `browseData.alignment`. Calls `browseToggleAlign`.
- [ ] Level min/max number inputs `name="browseLevelMin"` / `name="browseLevelMax"`, initial values from `browseData.levelMin/Max` (empty string when null).
- [ ] Table headers (Name / Level / Align / HP / AC / Move / Source) are buttons that call `browseSort` with `data-column`. Active sort column shows a ▲ or ▼ glyph based on `sortAsc`.
- [ ] Each row has `draggable="true"` and `data-uuid="{{this.uuid}}"`.
- [ ] Empty state when `filteredCount === 0` and `totalCount > 0`: "No matching NPCs."
- [ ] Empty state when `selectedSources.length === 0`: "No sources selected. Configure at the top of this tab."
- [ ] Row count badge under the controls: `"{{filteredCount}} of {{totalCount}}"`.

**Verify:** Open Encounter Roller in Foundry, click Browse NPCs tab. UI renders with sources, filters, and an NPC table. Console: no errors. Clicking column headers re-sorts. Typing in search filters. Toggling alignment filters works.

**Steps:**

- [ ] **Step 1: Find this section in `templates/encounter-roller.hbs`:**

```hbs
    {{!-- Disabled Tabs --}}
    <div class="tab" data-tab="build">Coming in a later slice</div>
    <div class="tab" data-tab="browse">Coming in a later slice</div>
    <div class="tab" data-tab="creator">Coming in a later slice</div>
```

- [ ] **Step 2: Replace it with this (keeps the Build and Creator stubs, replaces only the browse stub):**

```hbs
    {{!-- Disabled Tabs --}}
    <div class="tab {{#if (eq activeTab 'build')}}active{{/if}}" data-tab="build">Coming in a later slice</div>

    {{!-- Browse NPCs Tab --}}
    <div class="tab {{#if (eq activeTab 'browse')}}active{{/if}}" data-tab="browse">
      {{#if browseData}}

        <div class="sde-browse-sources">
          {{#each browseData.availableSources}}
            <button type="button"
                    class="sde-browse-source-pill {{#if (includes ../browseData.selectedSources this.id)}}is-active{{/if}}"
                    data-action="browseToggleSource"
                    data-source-id="{{this.id}}"
                    title="{{this.label}}">
              {{this.label}}
            </button>
          {{/each}}
        </div>

        <div class="sde-browse-controls">
          <input type="text"
                 name="browseSearch"
                 class="sde-browse-search"
                 placeholder="{{localize 'SDE.encounter.browse.search.placeholder'}}"
                 value="{{browseData.search}}">

          <div class="sde-browse-align-group">
            <span class="sde-browse-control-label">Alignment:</span>
            {{#each (array "L" "N" "C")}}
              <button type="button"
                      class="sde-browse-align-pill {{#if (includes ../browseData.alignment this)}}is-active{{/if}}"
                      data-action="browseToggleAlign"
                      data-alignment="{{this}}">{{this}}</button>
            {{/each}}
          </div>

          <div class="sde-browse-level-group">
            <span class="sde-browse-control-label">Level:</span>
            <input type="number" name="browseLevelMin" class="sde-browse-level-input" placeholder="min" value="{{#if browseData.levelMin}}{{browseData.levelMin}}{{/if}}">
            <span class="sde-browse-level-sep">–</span>
            <input type="number" name="browseLevelMax" class="sde-browse-level-input" placeholder="max" value="{{#if browseData.levelMax}}{{browseData.levelMax}}{{/if}}">
          </div>
        </div>

        <div class="sde-browse-count">
          {{browseData.filteredCount}} of {{browseData.totalCount}}
        </div>

        {{#if (eq browseData.selectedSources.length 0)}}
          <div class="sde-empty-state">{{localize 'SDE.encounter.browse.sources.empty'}}</div>
        {{else if (eq browseData.filteredCount 0)}}
          <div class="sde-empty-state">{{localize 'SDE.encounter.browse.empty'}}</div>
        {{else}}
          <table class="sde-browse-table">
            <thead>
              <tr>
                <th></th>
                {{#each (array
                  (hash key="name"        label="Name")
                  (hash key="level"       label="LV")
                  (hash key="alignment"   label="Al")
                  (hash key="hp"          label="HP")
                  (hash key="ac"          label="AC")
                  (hash key="move"        label="Move")
                  (hash key="sourceLabel" label="Source")
                )}}
                  <th>
                    <button type="button" data-action="browseSort" data-column="{{this.key}}">
                      {{this.label}}
                      {{#if (eq ../browseData.sortCol this.key)}}
                        {{#if ../browseData.sortAsc}}▲{{else}}▼{{/if}}
                      {{/if}}
                    </button>
                  </th>
                {{/each}}
              </tr>
            </thead>
            <tbody>
              {{#each browseData.rows}}
                <tr class="sde-browse-row" draggable="true" data-uuid="{{this.uuid}}">
                  <td><img src="{{this.img}}" width="24" height="24" alt="" /></td>
                  <td class="sde-browse-name">{{this.name}}</td>
                  <td>{{this.level}}</td>
                  <td>{{this.alignment}}</td>
                  <td>{{this.hp}}</td>
                  <td>{{this.ac}}</td>
                  <td>{{this.move}}</td>
                  <td class="sde-browse-source-cell">{{this.sourceLabel}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        {{/if}}

      {{else}}
        {{!-- Tab not active — render nothing. --}}
      {{/if}}
    </div>

    <div class="tab {{#if (eq activeTab 'creator')}}active{{/if}}" data-tab="creator">Coming in a later slice</div>
```

- [ ] **Step 3: Smoke test.** Reload Foundry, open the Encounter Roller, click the Browse NPCs tab. The UI should render. The table should populate with NPCs from your world + `shadowdark.bestiary`. Note: drag isn't wired yet (Task 4) — it'll do nothing on drop for now. If you see "No matching NPCs" but expect to see them, check the browser console for errors and verify your world has NPC actors.

- [ ] **Step 4: Commit.**

```bash
git add templates/encounter-roller.hbs
git commit -m "feat(1d): Browse NPCs tab template — source pills, filters, sortable table

Replaces the disabled stub. Renders source-toggle pills, search +
alignment + level filters, a row count badge, and a sortable table.
Each NPC row is draggable=true with data-uuid — drag wiring lands in
the next task.

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

## Task 4: Wire native HTML5 drag from NPC rows

**Goal:** When the GM drags an NPC row, the drag carries the standard Foundry payload `{type: "Actor", uuid: "..."}` so drop targets (canvas, Build Table in Slice 1c, sidebar, other modules) accept it natively.

**Files:**
- Modify: `scripts/encounter/encounter-roller-app.mjs`

**Acceptance Criteria:**
- [ ] Each `.sde-browse-row` has a `dragstart` listener that sets `ev.dataTransfer.setData("text/plain", JSON.stringify({type: "Actor", uuid}))`.
- [ ] Dragging a row to the canvas drops a token of that NPC (Foundry's default Actor-drop behavior on the canvas does this for free once the drag payload is correct).

**Verify:** Open Encounter Roller → Browse NPCs tab → drag an NPC row onto the canvas. A token of that NPC should appear at the cursor. No console errors during drag.

**Steps:**

- [ ] **Step 1: In `_onRender`, after the existing browse listeners you added in Task 2 Step 7, append:**

```js
    // Drag-to-canvas (and to anything else that accepts Foundry's Actor
    // drag payload — sidebar, other modules, future Build Table tab).
    this.element.querySelectorAll(".sde-browse-row[draggable='true']").forEach(row => {
      row.addEventListener("dragstart", ev => {
        const uuid = row.dataset.uuid;
        if (!uuid) return;
        ev.dataTransfer.setData("text/plain", JSON.stringify({
          type: "Actor",
          uuid,
        }));
        ev.dataTransfer.effectAllowed = "copy";
      });
    });
```

- [ ] **Step 2: Syntax check.**

```bash
node --check scripts/encounter/encounter-roller-app.mjs && echo "OK"
```

- [ ] **Step 3: Smoke test in Foundry.** Open the Encounter Roller, switch to Browse NPCs, drag a row onto the canvas. A token of that NPC should drop at the cursor position. Repeat with an NPC from `shadowdark.bestiary` (compendium source) — should also work because the UUID is the canonical compendium UUID.

- [ ] **Step 4: Commit.**

```bash
git add scripts/encounter/encounter-roller-app.mjs
git commit -m "feat(1d): NPC rows draggable with standard Foundry Actor payload

Wires the rows' dragstart event to emit {type: 'Actor', uuid: ...}
on the dataTransfer. Foundry's canvas accepts this natively to drop
a token; the future Build Table tab (Slice 1c) will accept it as a
slot-fill.

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

## Task 5: CSS polish — match the existing roller's visual language

**Goal:** Style the Browse tab so it looks at home alongside the Roll Tables tab — matching the gold-accent palette, panel backgrounds, and font sizes already established.

**Files:**
- Modify: `styles/shadowdark-enhancer.css`

**Acceptance Criteria:**
- [ ] Source pills look like the existing `.sde-bar-btn` style — small, dark, with hover/active states.
- [ ] Search input matches `.sde-control-row select` styling (dark bg, border).
- [ ] Alignment pills are small square buttons (L / N / C), active state uses the gold accent.
- [ ] Level inputs are narrow (~50px wide), match other inputs.
- [ ] Table rows have alternating row tint and hover highlight.
- [ ] Active sort column header is colored with the gold accent.
- [ ] Drag cursor on rows (`cursor: grab` / `cursor: grabbing`).

**Verify:** Open the Browse tab — it should visually fit alongside the Roll Tables tab. No layout overflow at 720px window width. Hover states feel responsive.

**Steps:**

- [ ] **Step 1: Find the end of the encounter-roller CSS block** — search the file for `.sde-encounter-roller hr` to anchor. Append this block AFTER the existing `.sde-stepper button:hover` rule (search for that line):

```css
/* ── Browse NPCs tab ─────────────────────────────────────────────────────── */

.sde-browse-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.sde-browse-source-pill {
  background: var(--sde-bar-btn-2);
  border: 1px solid var(--sde-bar-border);
  border-radius: var(--sde-bar-radius);
  color: var(--sde-bar-text-muted);
  font-family: var(--sde-bar-font);
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
  transition: all 0.12s;
}
.sde-browse-source-pill:hover {
  background: var(--sde-bar-bg-hover);
  color: var(--sde-bar-text);
}
.sde-browse-source-pill.is-active {
  background: var(--sde-bar-accent-dark);
  color: #f5eccc;
  border-color: var(--sde-bar-accent);
}

.sde-browse-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
  padding: 6px;
  background: var(--sde-bar-bg-alt);
  border: 1px solid var(--sde-bar-border);
  border-radius: var(--sde-bar-radius);
}
.sde-browse-search {
  flex: 1;
  min-width: 180px;
  background: var(--sde-bar-input-bg);
  color: var(--sde-bar-text);
  border: 1px solid var(--sde-bar-border);
  font-family: var(--sde-bar-font);
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 2px;
}
.sde-browse-control-label {
  font-size: 12px;
  color: var(--sde-bar-text-muted);
  font-weight: 700;
}
.sde-browse-align-group,
.sde-browse-level-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sde-browse-align-pill {
  background: var(--sde-bar-btn-2);
  border: 1px solid var(--sde-bar-border);
  color: var(--sde-bar-text-muted);
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  width: 24px;
  height: 24px;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.12s;
}
.sde-browse-align-pill:hover {
  background: var(--sde-bar-bg-hover);
  color: var(--sde-bar-text);
}
.sde-browse-align-pill.is-active {
  background: var(--sde-bar-accent-dark);
  color: #f5eccc;
  border-color: var(--sde-bar-accent);
}
.sde-browse-level-input {
  width: 50px;
  background: var(--sde-bar-input-bg);
  color: var(--sde-bar-text);
  border: 1px solid var(--sde-bar-border);
  font-size: 12px;
  padding: 2px 4px;
  text-align: center;
  border-radius: 2px;
}
.sde-browse-level-sep {
  color: var(--sde-bar-text-muted);
}

.sde-browse-count {
  font-size: 11px;
  color: var(--sde-bar-text-muted);
  text-align: right;
  margin-bottom: 4px;
}

.sde-browse-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.sde-browse-table th {
  text-align: left;
  padding: 0;
  border-bottom: 1px solid var(--sde-bar-accent-dark);
}
.sde-browse-table th button {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--sde-bar-text-dim);
  font-family: var(--sde-bar-font);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 6px;
  text-align: left;
  cursor: pointer;
}
.sde-browse-table th button:hover {
  color: var(--sde-bar-accent);
}
.sde-browse-table td {
  padding: 3px 6px;
  border-bottom: 1px solid var(--sde-bar-border);
  vertical-align: middle;
}
.sde-browse-row {
  cursor: grab;
  transition: background 0.1s;
}
.sde-browse-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}
.sde-browse-row:hover {
  background: var(--sde-bar-bg-hover);
}
.sde-browse-row:active {
  cursor: grabbing;
}
.sde-browse-row img {
  border: 1px solid var(--sde-bar-accent-dark);
  border-radius: 2px;
}
.sde-browse-name {
  font-weight: 700;
  color: var(--sde-bar-text-bright);
}
.sde-browse-source-cell {
  color: var(--sde-bar-text-muted);
  font-size: 11px;
  font-style: italic;
}
```

- [ ] **Step 2: Smoke test.** Reload Foundry, open the Browse tab. The UI should look polished and consistent with the Roll Tables tab. Source pills toggle visually on click. Alignment pills (L/N/C) toggle. Sort header arrows appear on the active column. Drag cursor shows on row hover.

- [ ] **Step 3: Commit.**

```bash
git add styles/shadowdark-enhancer.css
git commit -m "feat(1d): Browse NPCs tab styling — pills, table, drag cursor

Matches the existing roller-window palette and font sizes. Source +
alignment pills use the gold accent for active state. Table has
alternating row tint and hover highlight. Drag cursor on rows.

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

## Task 6: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

**Steps:**

- [ ] **Step 1: Open `CHANGELOG.md`. In the `## [Unreleased]` section, under the "Added" subsection, find the existing encounter-system bullet that starts with `**Random Encounter system — Phase 1 Slices 1a + 1b.**`. Add this new sub-bullet at the BOTTOM of that bullet's nested list (right before `5 new world settings`):**

```md
  - **Browse NPCs tab — Slice 1d.** Filter and explore Shadowdark NPC sources (world actors, current scene, `shadowdark.bestiary`, and any installed Actor compendium packs). Source-toggle pills at top let you pick which packs feed the list. Search by name, filter by alignment (L/N/C) and level range, sort by any column. NPC rows are draggable with the standard Foundry Actor payload — drag onto the canvas to drop a token, or (when Slice 1c lands) into a Build Table slot.
```

- [ ] **Step 2: Commit.**

```bash
git add CHANGELOG.md
git commit -m "docs(1d): CHANGELOG entry for Browse NPCs tab

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

## Final smoke test (do this after all tasks land)

In Foundry, with the shadowdark-enhancer module enabled:

1. Start a crawl (Crawl Bar → Start Crawl).
2. Click the Encounter button on the Crawl Bar — Roller opens on Roll Tables tab.
3. Click the **Browse NPCs** tab.
4. **Sources:** Toggle each available source pill — list updates, source pill shows active gold styling, `encounterSources` setting persists across reload.
5. **Search:** Type a name fragment — table filters; row count badge updates; clearing the search restores all rows.
6. **Alignment:** Click `C` — only Chaotic NPCs show. Click `C` again — all show.
7. **Level range:** Set min=1, max=3 — only NPCs in that level band show. Clear both — all show.
8. **Sort:** Click each column header — table re-sorts; clicking the active column flips ascending/descending; arrow indicator follows the active column.
9. **Drag:** Drag a row onto the canvas — a token of that NPC drops at the cursor.
10. Close + reopen the Roller — your source selections persist; filters reset (intentional — filter state is per-session).
11. Console: no errors throughout.

---

## Explicit non-goals (don't add these)

- **Build Table integration ("+" button).** Build Table doesn't exist yet (Slice 1c). NPC rows are draggable — that's the integration.
- **Per-row Post / Place quick actions.** Roll Tables tab has these for rolling random encounters; Browse NPCs is a different paradigm (explore + drag-out). Don't add them here.
- **Pagination / virtualization.** Even huge bestiaries are a few hundred entries — the table renders fine without it.
- **Auto-refresh on actor create/delete.** Cache is per-session, invalidated on source change. World actor mutations are rare during play; manual reload is fine.
- **Bulk drag (multi-select).** One NPC per drag.
- **Source-pack drag-import.** Just clicking a source pill to add it is enough — don't add a "drag a compendium pack onto the tab to add as source" affordance.
- **Editing NPCs in place.** Read-only browse — editing happens via Foundry's normal actor sheet.

---

## Pitfalls / known gotchas

1. **Foundry's `getIndex({fields})` may not populate every field.** Some packs strip system fields out of the index. The `_loadFromPack` code handles missing fields with fallbacks (`?? NaN`, `?? 0`, `?? "near"`). Don't assume any field is present.

2. **`actor.system.level` can be a string** like `"--"` for level-0 monsters in some bestiaries. Coercing via `Number(...)` yields `NaN`, which the filter skips (the `Number.isFinite(r.level)` guard). That's correct — level filter shouldn't crash on bad data.

3. **Compendium packs include items, scenes, etc. — not just actors.** Filter by `pack.metadata.type !== "Actor"` (already done in `listAvailableSources`) and also infer-filter in `_loadFromPack` by checking for `system.attributes` (since item indices don't have it).

4. **The `localize` and `array` and `hash` helpers used in the template are standard Foundry Handlebars helpers.** `includes` is also standard (Foundry registers it). If any of these resolve as undefined at render time, double-check Foundry version — they all exist in v13+.

5. **The actions handler signature is `(event, target)`** where `target` is the element with `data-action`. The `closest("[data-...]")` trick used elsewhere in this app works here too for finding data attributes on parent elements.

6. **The `EncounterRollerApp` singleton pattern is already established** — don't add a new instance. Just extend the existing instance fields and prepareContext.

---

## Token budget guidance

If you're using a token-conscious LLM (Gemini CLI counts), this plan is sized to run end-to-end in one session without re-reading large files. Estimated:
- Existing files to read: ~1500 lines total (encounter-roller-app.mjs 380, encounter-roller.hbs 130, encounter-result.mjs 32, settings.mjs 100, css ~1400 but you only need 100 lines of it)
- New file you write: ~180 lines
- Modifications to existing files: ~80 lines added across 4 files
- Total session output: ~300 lines of code

Don't refactor things outside the listed files. Don't add features outside the acceptance criteria. If you spot a bug in existing code, note it in a comment and continue — don't fix it in this slice.
