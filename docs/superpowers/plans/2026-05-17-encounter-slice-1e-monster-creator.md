# Slice 1e — Monster Creator Implementation Plan

> **For agentic workers (Gemini, Claude, anyone):** This plan is self-contained. Execute it sub-slice by sub-slice. Each sub-slice ends with a `git commit` step. Don't merge sub-slices; don't skip the smoke-test steps; don't invent new features. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Monster Creator (tab 4 of 4) in the existing Encounter Roller window — a multi-section authoring tool for Shadowdark NPC actors. Users can either load an existing bestiary entry as a template OR build from scratch, edit identity / stats / movement / spellcasting / actions / features / description sections, and save the result as a new world Actor.

**Architecture:** New file `scripts/encounter/encounter-creator.mjs` houses the standalone `MonsterCreatorApp` class. The existing `EncounterRollerApp` mounts/unmounts it inside the `creator` tab content via a `<div id="sde-monster-creator-host">` (Vagabond's mountPanel pattern). The creator manages its own state, per-section collapsibles, and rendering. On Save, it writes a new world Actor via `Actor.implementation.create()` and notifies the user; nothing else in the roller window changes.

**Tech Stack:** Foundry VTT v13+, Shadowdark system v4+, ApplicationV2 + Handlebars, no external libs. Uses existing helpers from `encounter-roller-app.mjs` (`_bestArtForActor`, `_isPlaceholderArt`, `_firstNonPlaceholder`) which should be **moved to a shared `scripts/encounter/art-utils.mjs`** as Sub-slice 1e-0.

---

## CRITICAL — Read these first

**You MUST read these files in full before touching anything:**

1. `docs/superpowers/specs/2026-05-15-encounter-system-phase1-design.md` — the encounter-system design doc
2. `scripts/encounter/encounter-roller-app.mjs` — the parent app you're plugging into. Note especially:
   - The singleton pattern (`static _instance`, `static async open()`)
   - The `_onRender` lifecycle and input-cursor-preservation pattern for text inputs
   - The `_bestArtForActor`, `_isPlaceholderArt`, `_firstNonPlaceholder` helpers at the file bottom — you'll be reusing these (after Sub-slice 1e-0 moves them to art-utils.mjs)
   - The `actions` map convention (`actionName: ClassName.prototype._handler`)
3. `scripts/encounter/encounter-browse.mjs` — pattern reference for compendium scanning (`pack.getDocuments()`, deep-load caching)
4. `scripts/encounter/encounter-build.mjs` — pattern reference for data-layer helpers, validation, save-to-world
5. `templates/encounter-roller.hbs` — the host template (find the `data-tab="creator"` stub you'll replace)
6. `styles/shadowdark-enhancer.css` — search for `.sde-encounter-roller` and `.sde-browse-` and `.sde-build-` to match the visual language

## VAGABOND CRAWLER — the design source

**This port is faithful to Vagabond Crawler's Monster Creator.** When in doubt about UX/section layout/Quick Pick philosophy, look at:

- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/monster-creator/monster-creator-app.mjs` (~2400 LOC) — the original
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/monster-creator/action-templates.mjs` — Quick Pick shape reference
- `E:/FoundryVTTv14/Data/modules/vagabond-crawler/scripts/monster-creator/ability-templates.mjs` — Quick Pick shape reference

Important: **the structure is faithfully ported, but most field mappings change** because Shadowdark's NPC schema is much leaner than Vagabond's. Specifically:

| Vagabond concept | Shadowdark equivalent | Action |
|---|---|---|
| `beingType` (Cryptid / Outers / etc.) | ❌ no field | **Drop the section entirely** |
| Threat Level (TL) | ❌ uses `level` only | **Drop — show Level only, never compute TL** |
| DPR computation | ❌ no equivalent | **Drop** |
| Structured immunities / weaknesses / statusImmunities | ❌ free-text in description | **Drop as separate sections** — let the user write to the description text instead |
| Senses checklist (Darksight, Allsight, etc.) | only `darkAdapted` boolean | **One checkbox: Dark-Adapted** |
| Token vision sub-config | Foundry's standard `prototypeToken.sight` | **Skip — use Foundry's default sheet for this** |
| Mutations (64 templates with TL deltas) | n/a | **Drop entirely from this slice** — Vagabond-specific, depends on TL, not worth porting |
| Action `causedStatuses` / `critCausedStatuses` riders | ❌ no automation layer | **Drop — Shadowdark stores rider text in `damage.special`** |
| `attack.num` (Vagabond) | ✅ same field name in Shadowdark NPC Attack | Keep |

**What IS faithfully ported from Vagabond's UX:**

- Collapsible sections, state preserved across renders (Vagabond's `_sectionOpen{}` pattern)
- Bestiary loader to pre-fill from any installed Actor compendium pack
- Quick Picks for actions + features (curated catalogs)
- Inline preview of computed values (HP, AC) as user edits stats
- "Save creates a new world actor, never modifies the source compendium"
- Panel-mode: mounted inside a host div (`mountPanel(container)` / `unmountPanel()`)

## Shadowdark NPC schema (the target shape)

Every saved actor has this shape on `system`. Read `E:/FoundryVTTv14/Data/systems/shadowdark/src/models/NpcSD.mjs` for the authoritative schema.

```js
{
  alignment: "L" | "N" | "C",     // single-char string
  level: number,                    // 0 = mook, supports any positive int
  darkAdapted: boolean,
  move: "close" | "near" | "doubleNear" | "tripleNear" | "far" | "special" | "none",
  moveNote: string,                 // free-text qualifier ("burrow", "fly", etc.)
  spellcasting: {
    ability: "str" | "dex" | "con" | "int" | "wis" | "cha" | "",
    bonus: number,                  // spell attack bonus
    attacks: number,                // spells-per-round (>0 means is-spellcaster)
  },
  abilities: {                      // simplified for NPCs — just modifiers
    str: { mod: number },
    dex: { mod: number },
    con: { mod: number },
    int: { mod: number },
    wis: { mod: number },
    cha: { mod: number },
  },
  attributes: {                     // inherited from ActorBaseSD
    hp: { value: number, max: number, temp: number },
    ac: { value: number, attribute: "" },   // attribute always "" for NPCs
  },
}
```

Plus three item types stored in `actor.items`:

- **`NPC Attack`** items — regular attacks (Bite, Claw, Bow, etc.). Schema in `E:/FoundryVTTv14/Data/systems/shadowdark/src/models/items/NpcAttackSD.mjs`. Key fields:
  - `system.attack.num` (integer, default 1) — attacks per round
  - `system.bonuses.attackBonus` (int)
  - `system.bonuses.damageBonus` (int)
  - `system.damage.value` (string, e.g. `"1d6"`)
  - `system.damage.numDice` (int)
  - `system.damage.special` (string — "+ poison", "+ grab", etc.)
  - `system.ranges` (array of strings from `["close", "near", "far"]`)
- **`NPC Special Attack`** items — special attacks (Petrify gaze, Breath weapon). Similar schema, see `NpcSpecialAttackSD.mjs`.
- **`NPC Feature`** items — special abilities, traits (Magic Resistance, Pack Tactics). Just `name` + `description` (HTML).

## Conventions in this module — DO NOT VIOLATE

1. Use `MODULE_ID` from `scripts/module-id.mjs` — never hardcode `"shadowdark-enhancer"`.
2. Use the v13/v14 namespaced helpers, NOT the deprecated globals:
   - `const { renderTemplate } = foundry.applications.handlebars;`
   - `const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;`
3. CSS class prefix is `sde-`. New classes for this slice should use `sde-creator-*`.
4. Inline comments explain *why*, not *what*. Match the comment density in `encounter-roller-app.mjs`.
5. Match the actions-map convention: `actions: { actionName: ClassName.prototype._handler }`.
6. Text inputs need cursor preservation (focus + selectionStart stash on input, restore in `_onRender`). See `_browseSearchFocused` pattern in `encounter-roller-app.mjs`.
7. `TableResult` field reads on v13 use `name` / `description`, NOT `text`. (Probably not relevant for this slice but worth knowing.)
8. **CHANGELOG entries.** Every sub-slice updates `CHANGELOG.md` under the `[Unreleased]` section.

## What this slice does NOT touch

- The Encounter Check button on the Crawl Bar
- Roll Tables tab / Build Table tab / Browse NPCs tab — all already shipped
- The settings module (no new world settings)
- The `encounter-build.mjs` data layer

---

# Sub-slice 1e-0 — Move art helpers to a shared module

**Goal:** Move `_isPlaceholderArt`, `_firstNonPlaceholder`, `_getCompendiumArtFor`, `_bestArtForActor`, `_findCompendiumActorByName`, and the `_nameToCompendiumUuid` cache from `encounter-roller-app.mjs` to a new shared module `scripts/encounter/art-utils.mjs`. Re-export from both. Monster Creator (and any future slice) imports from the new location.

**Files:**
- Create: `scripts/encounter/art-utils.mjs`
- Modify: `scripts/encounter/encounter-roller-app.mjs` (move helpers out, import them back in)

**Acceptance Criteria:**
- [ ] `node --check scripts/encounter/art-utils.mjs` returns OK
- [ ] `node --check scripts/encounter/encounter-roller-app.mjs` returns OK
- [ ] All existing roller-app uses of `_bestArtForActor` etc. continue to work
- [ ] Foundry loads without errors; Place tokens still resolves art correctly (smoke test: place a Beastman, verify the warrior token art still appears)

**Verify:**
```bash
node --check scripts/encounter/art-utils.mjs && node --check scripts/encounter/encounter-roller-app.mjs && echo "OK"
```
Plus manual Foundry test: Place a Beastman from the Roll Tables result → token should appear with the community-tokens warrior art.

**Steps:**

- [ ] **Step 1: Create `scripts/encounter/art-utils.mjs`** with all 5 helpers moved over verbatim (including JSDoc comments). The `_nameToCompendiumUuid` Map declaration moves too. Export all five functions.

- [ ] **Step 2: In `scripts/encounter/encounter-roller-app.mjs`**, delete the helper definitions at the bottom of the file, and add an import at the top:
```js
import {
  _isPlaceholderArt, _firstNonPlaceholder,
  _getCompendiumArtFor, _bestArtForActor,
  _findCompendiumActorByName,
} from "./art-utils.mjs";
```
Note: leave `_resultBody` in encounter-roller-app.mjs — it's TableResult-specific, not art-related.

- [ ] **Step 3: Smoke test in Foundry.** Reload, Place a Beastman, verify warrior token art appears.

- [ ] **Step 4: Commit.**
```bash
git add scripts/encounter/art-utils.mjs scripts/encounter/encounter-roller-app.mjs
git commit -m "refactor(1e-0): move art-resolution helpers to shared art-utils.mjs

No behavior change. Extracts _isPlaceholderArt, _firstNonPlaceholder,
_getCompendiumArtFor, _bestArtForActor, _findCompendiumActorByName,
and the _nameToCompendiumUuid cache out of encounter-roller-app.mjs
into a new scripts/encounter/art-utils.mjs module.

Prep for Slice 1e (Monster Creator) which needs the same helpers for
its bestiary-loader thumbnails and image-field placeholder detection.

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

# Sub-slice 1e-i — MonsterCreatorApp shell + Identity + Description + Save

**Goal:** Scaffold the `MonsterCreatorApp` class, mount it as a sub-app inside the existing Encounter Roller's `creator` tab, and implement the **Identity** + **Description** sections plus a working **Save** that writes a world Actor.

This sub-slice is the structural foundation. After 1e-i lands, the user can already create a basic NPC (name + alignment + level + description + portrait/token images) and save it. Subsequent sub-slices add the meatier sections (Stats, Actions, Features, Bestiary loader).

**Files:**
- Create: `scripts/encounter/encounter-creator.mjs` (new — the MonsterCreatorApp class + the data layer)
- Create: `templates/encounter-creator.hbs` (new — the creator's section markup)
- Modify: `templates/encounter-roller.hbs` (replace the `data-tab="creator"` stub with a mount host div)
- Modify: `scripts/encounter/encounter-roller-app.mjs` (wire `MonsterCreator.mountPanel(host)` when the creator tab is opened; `MonsterCreator.unmountPanel()` when switching away)
- Modify: `scripts/shadowdark-enhancer.mjs` (import + expose on `game.shadowdarkEnhancer.monsterCreator`)
- Modify: `styles/shadowdark-enhancer.css` (add `.sde-creator-*` classes)
- Modify: `CHANGELOG.md`

**Acceptance Criteria:**
- [ ] Click the **Monster Creator** tab in the Encounter Roller — the panel mounts and shows the Identity and Description sections (collapsible).
- [ ] Identity section has: Name (text), Alignment (radio L/N/C), Level (number), Portrait image picker (FilePicker), Token image picker (FilePicker).
- [ ] Description section has: a textarea for free-text flavor/description (no rich text editor in 1e-i — that's a later polish).
- [ ] Section collapsed/expanded state survives re-renders (the `_sectionOpen{}` Vagabond pattern).
- [ ] **Save** button at the bottom: writes a new world Actor with `type: "NPC"`, `name`, `system.alignment`, `system.level`, `img`, `prototypeToken.texture.src`, and `system.description` (Foundry's standard description field) set. Toasts the new actor name on success.
- [ ] After save, the actor appears in the sidebar Actors list. Open the actor sheet — Name, alignment, level, portrait, token image are all set correctly. Description shows the text the user typed.
- [ ] Switching to another tab (e.g. Roll Tables) and back to Monster Creator preserves the in-progress fields (state lives on the singleton instance).
- [ ] Closing the Roller window discards the in-progress creator state (singleton is destroyed).
- [ ] `game.shadowdarkEnhancer.monsterCreator.open()` opens the roller directly to the Creator tab.

**Verify:**
```bash
node --check scripts/encounter/encounter-creator.mjs && echo "OK"
```
Plus manual Foundry test (steps above).

**Steps:**

- [ ] **Step 1: Create `scripts/encounter/encounter-creator.mjs`** with the basic class shell and data layer:

```js
/**
 * Shadowdark Enhancer — Monster Creator
 * Slice 1e: a multi-section authoring tool for Shadowdark NPC actors.
 *
 * Mounted inside the Encounter Roller's "creator" tab as a sub-app
 * (Vagabond's mountPanel pattern). Each section is collapsible with
 * state preserved across re-renders.
 *
 * Sub-slice 1e-i: shell + Identity + Description sections + Save.
 * Sub-slice 1e-ii: Stats + Movement + Spellcasting sections.
 * Sub-slice 1e-iii: Actions section (NPC Attack + NPC Special Attack).
 * Sub-slice 1e-iv: Features section (NPC Feature items).
 * Sub-slice 1e-v: Bestiary loader.
 */

import { MODULE_ID } from "../module-id.mjs";
import { _bestArtForActor, _isPlaceholderArt } from "./art-utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Default shape for a fresh-from-scratch monster. Mirrors the
 * Shadowdark NpcSD schema fields we expose for editing in 1e-i, plus
 * fields reserved for later sub-slices (kept commented out).
 */
function _defaultDraft() {
  return {
    name:        "",
    alignment:   "N",        // L/N/C
    level:       1,
    img:         "icons/svg/mystery-man.svg",
    tokenSrc:    "",         // empty = inherit from img on save
    description: "",
    // Stats — Sub-slice 1e-ii
    // hp: { value: 1, max: 1 }, ac: 10, darkAdapted: false,
    // abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    // move: "near", moveNote: "",
    // spellcasting: { ability: "", bonus: 0, attacks: 0 },
    // Items — Sub-slice 1e-iii / 1e-iv
    // attacks: [],   // each: {name, type, num, attackBonus, damage, ranges, special}
    // features: [],  // each: {name, description}
  };
}

export class MonsterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sde-monster-creator",
    tag: "div",
    window: { frame: false },   // mounted inline; no window chrome
    actions: {
      sectionToggle:    MonsterCreatorApp.prototype._onSectionToggle,
      pickImg:          MonsterCreatorApp.prototype._onPickImg,
      pickTokenSrc:     MonsterCreatorApp.prototype._onPickTokenSrc,
      save:             MonsterCreatorApp.prototype._onSave,
    },
  };

  static PARTS = {
    main: { template: "modules/shadowdark-enhancer/templates/encounter-creator.hbs" },
  };

  constructor(options = {}) {
    super(options);
    this._draft = _defaultDraft();
    // Section open/closed state — survives renders. Default: Identity open.
    this._sectionOpen = {
      identity:    true,
      description: false,
      // stats, movement, spellcasting, actions, features — added in later sub-slices
    };
    // Text-input focus stashes for cursor preservation across renders.
    this._focused = {};  // { fieldName: {selectionStart} }
  }

  // ─── Singleton + mount/unmount ────────────────────────────────────

  static _instance = null;

  static get instance() {
    if (!this._instance) this._instance = new MonsterCreatorApp();
    return this._instance;
  }

  /** Mounts the creator panel inside the given host element. Called by
   *  EncounterRollerApp when the creator tab is opened. */
  static async mountPanel(host) {
    const inst = this.instance;
    inst._mountHost = host;
    await inst.render(true);
  }

  /** Unmounts the panel without destroying its state. Called when the
   *  user switches to another tab. State is preserved on the singleton
   *  so reopening the creator tab restores in-progress edits. */
  static unmountPanel() {
    if (this._instance?.rendered) {
      this._instance.element?.remove?.();
      this._instance._mountHost = null;
    }
  }

  /** Open the Encounter Roller directly on the creator tab. */
  static async open() {
    const mod = await import("./encounter-roller-app.mjs");
    return mod.EncounterRollerApp.open("creator");
  }

  // ─── ApplicationV2 lifecycle ──────────────────────────────────────

  async _renderHTML(context, options) {
    return renderTemplate(this.constructor.PARTS.main.template, context);
  }

  _replaceHTML(result, content, options) {
    // Mount into the host div provided by EncounterRollerApp instead of
    // letting ApplicationV2 manage its own DOM. Standard pattern for
    // panel-mode mounting.
    if (this._mountHost) {
      this._mountHost.innerHTML = result;
      this._element = this._mountHost.firstElementChild ?? this._mountHost;
    } else {
      content.innerHTML = result;
    }
  }

  async _prepareContext(options) {
    return {
      draft:       this._draft,
      sectionOpen: this._sectionOpen,
      alignments:  ["L", "N", "C"],
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._restoreFocus();
    this._wireFieldInputs();
  }

  // ─── Field wiring (text/number inputs use change-events to limit re-renders) ─

  _wireFieldInputs() {
    if (!this.element) return;

    // Generic field-binder: every input with [data-draft-field="path.to.field"]
    // updates this._draft on change. Uses dot-path so we can wire nested
    // fields later (system.attributes.hp.max etc.) the same way.
    this.element.querySelectorAll("[data-draft-field]").forEach(input => {
      input.addEventListener("change", ev => {
        const path = ev.target.dataset.draftField;
        const raw  = ev.target.type === "number" ? Number(ev.target.value) : ev.target.value;
        this._setDraft(path, raw);
      });
      // For text/textarea inputs, also stash cursor on input so we can
      // restore after re-render. Renders are change-event-driven though,
      // so this is only a safety net for re-renders triggered by other paths.
      if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", ev => {
          this._focused[ev.target.dataset.draftField] = {
            selectionStart: ev.target.selectionStart,
          };
        });
      }
    });
  }

  _restoreFocus() {
    // Re-focus the most recently focused field after re-render, putting
    // the cursor back where the user left it. Avoids the cursor-jumps-
    // to-end issue ApplicationV2 has on full re-renders.
    const lastField = Object.keys(this._focused).pop();
    if (!lastField) return;
    const input = this.element?.querySelector(`[data-draft-field="${CSS.escape(lastField)}"]`);
    if (input) {
      input.focus();
      const pos = this._focused[lastField].selectionStart ?? input.value.length;
      try { input.setSelectionRange(pos, pos); } catch (_) {}
    }
  }

  _setDraft(path, value) {
    // Dot-path setter — handles top-level fields in 1e-i and nested
    // ones (e.g. "hp.max") in later sub-slices without refactoring.
    const parts = path.split(".");
    let obj = this._draft;
    while (parts.length > 1) {
      const key = parts.shift();
      obj[key] ??= {};
      obj = obj[key];
    }
    obj[parts[0]] = value;
    this.render();
  }

  // ─── Action handlers ──────────────────────────────────────────────

  _onSectionToggle(event, target) {
    const section = target.dataset.section;
    if (!section) return;
    this._sectionOpen[section] = !this._sectionOpen[section];
    this.render();
  }

  async _onPickImg() {
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: this._draft.img,
      callback: (path) => { this._draft.img = path; this.render(); },
    });
    fp.render(true);
  }

  async _onPickTokenSrc() {
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: this._draft.tokenSrc || this._draft.img,
      callback: (path) => { this._draft.tokenSrc = path; this.render(); },
    });
    fp.render(true);
  }

  async _onSave() {
    const d = this._draft;
    if (!d.name?.trim()) {
      ui.notifications.warn("Monster needs a name before it can be saved.");
      return;
    }

    // Sub-slice 1e-i: minimal NPC. Later sub-slices extend this with
    // stats, items, etc. via _draftToActorData(d).
    const actorData = {
      name: d.name.trim(),
      type: "NPC",
      img: d.img || "icons/svg/mystery-man.svg",
      system: {
        alignment: d.alignment ?? "N",
        level:     Number(d.level ?? 1),
        notes:     d.description ?? "",   // Shadowdark NPCs use system.notes for description
      },
      prototypeToken: {
        name: d.name.trim(),
        texture: {
          src: d.tokenSrc || d.img || "icons/svg/mystery-man.svg",
        },
      },
    };

    try {
      const actor = await Actor.implementation.create(actorData);
      ui.notifications.info(`Created NPC: ${actor.name}`);
      // Reset the draft so the form is ready for the next monster.
      this._draft = _defaultDraft();
      this.render();
    } catch (err) {
      console.error(MODULE_ID, "Monster Creator save failed:", err);
      ui.notifications.error(`Failed to save monster: ${err.message}`);
    }
  }
}

// Convenience accessor — same shape as EncounterRollerApp's API
// exposure in shadowdark-enhancer.mjs.
export const MonsterCreator = MonsterCreatorApp;
```

Note about `system.notes`: Shadowdark NPCs use `system.notes` for the description field (NOT `system.description`). Verify by inspecting an existing NPC in the world: `game.actors.find(a => a.type === "NPC").system.notes`.

- [ ] **Step 2: Create `templates/encounter-creator.hbs`:**

```hbs
<div class="sde-creator">

  {{!-- ═══ Identity Section ═══ --}}
  <details class="sde-creator-section" {{#if sectionOpen.identity}}open{{/if}}>
    <summary data-action="sectionToggle" data-section="identity">
      <i class="fas fa-id-card"></i> Identity
    </summary>
    <div class="sde-creator-section-body">

      <div class="sde-creator-row">
        <label>Name</label>
        <input type="text" data-draft-field="name" value="{{draft.name}}" placeholder="e.g. Frost Goblin">
      </div>

      <div class="sde-creator-row">
        <label>Alignment</label>
        <div class="sde-creator-align-group">
          {{#each alignments}}
            <label class="sde-creator-radio-label">
              <input type="radio" name="alignment" value="{{this}}"
                     {{#if (eq this ../draft.alignment)}}checked{{/if}}
                     data-draft-field="alignment">
              {{this}}
            </label>
          {{/each}}
        </div>
      </div>

      <div class="sde-creator-row">
        <label>Level</label>
        <input type="number" data-draft-field="level" value="{{draft.level}}" min="0" max="30">
      </div>

      <div class="sde-creator-row">
        <label>Portrait</label>
        <div class="sde-creator-img-picker">
          <img src="{{draft.img}}" width="48" height="48" alt="" />
          <input type="text" data-draft-field="img" value="{{draft.img}}" class="sde-creator-img-path">
          <button type="button" data-action="pickImg" title="Browse"><i class="fas fa-folder-open"></i></button>
        </div>
      </div>

      <div class="sde-creator-row">
        <label>Token image</label>
        <div class="sde-creator-img-picker">
          <img src="{{#if draft.tokenSrc}}{{draft.tokenSrc}}{{else}}{{draft.img}}{{/if}}" width="48" height="48" alt="" />
          <input type="text" data-draft-field="tokenSrc" value="{{draft.tokenSrc}}" placeholder="(inherits from portrait)" class="sde-creator-img-path">
          <button type="button" data-action="pickTokenSrc" title="Browse"><i class="fas fa-folder-open"></i></button>
        </div>
      </div>

    </div>
  </details>

  {{!-- ═══ Description Section ═══ --}}
  <details class="sde-creator-section" {{#if sectionOpen.description}}open{{/if}}>
    <summary data-action="sectionToggle" data-section="description">
      <i class="fas fa-book-open"></i> Description
    </summary>
    <div class="sde-creator-section-body">
      <textarea data-draft-field="description" rows="6"
                placeholder="A short description and any flavor/special-ability text. Goes into the NPC's notes field on the actor sheet.">{{draft.description}}</textarea>
    </div>
  </details>

  {{!-- ═══ Save bar (sticky at bottom of panel) ═══ --}}
  <div class="sde-creator-footer">
    <button type="button" class="sde-creator-save-btn" data-action="save">
      <i class="fas fa-floppy-disk"></i> Create World Actor
    </button>
  </div>

</div>
```

- [ ] **Step 3: Replace the creator stub in `templates/encounter-roller.hbs`.** Find:
```hbs
    <div class="tab {{#if (eq activeTab 'creator')}}active{{/if}}" data-tab="creator">Coming in a later slice</div>
```
Replace with:
```hbs
    {{!-- Monster Creator Tab — mounted inline by EncounterRollerApp --}}
    <div class="tab {{#if (eq activeTab 'creator')}}active{{/if}}" data-tab="creator">
      <div id="sde-monster-creator-host"></div>
    </div>
```

- [ ] **Step 4: Wire mount/unmount in `scripts/encounter/encounter-roller-app.mjs`.**
  - Add import at top:
    ```js
    import { MonsterCreator } from "./encounter-creator.mjs";
    ```
  - In `_onRender`, after the existing tab/select wiring, add:
    ```js
    // Mount the Monster Creator into the creator tab's host div when
    // the creator tab is active. Unmount when not. State is preserved
    // on the singleton so switching back restores in-progress edits.
    const creatorHost = this.element.querySelector("#sde-monster-creator-host");
    if (creatorHost && this._activeTab === "creator") {
      MonsterCreator.mountPanel(creatorHost);
    } else {
      MonsterCreator.unmountPanel();
    }
    ```
  - In `close()`, before the `super.close(options)` call, add:
    ```js
    MonsterCreator.unmountPanel();
    ```

- [ ] **Step 5: Expose the API in `scripts/shadowdark-enhancer.mjs`.** Find the `game.shadowdarkEnhancer = { encounter: { ... } }` block and add a sibling:
```js
import { MonsterCreator } from "./encounter/encounter-creator.mjs";
// ...
game.shadowdarkEnhancer = {
  encounter: { /* existing */ },
  monsterCreator: {
    open: () => MonsterCreator.open(),
  },
};
```

- [ ] **Step 6: Add CSS** to `styles/shadowdark-enhancer.css`. Insert after the Build Table tab styles (search for `/* ── Build Table tab — Slice 1c` to find the right spot):

```css
/* ── Monster Creator tab — Slice 1e ────────────────────────────────────
   Multi-section authoring panel mounted inline in the creator tab. Each
   section is a <details> collapsible; visual language mirrors the Build
   Table tab. */

.sde-creator {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

.sde-creator-section {
  background: var(--sde-bar-bg-alt);
  border: 1px solid var(--sde-bar-border);
  border-radius: var(--sde-bar-radius);
}
.sde-creator-section > summary {
  padding: 6px 12px;
  font-family: "Eskapade", serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--sde-bar-accent);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.sde-creator-section > summary::-webkit-details-marker { display: none; }
.sde-creator-section > summary:hover { color: var(--sde-bar-text-bright); }
.sde-creator-section-body {
  padding: 10px 14px;
  border-top: 1px solid var(--sde-bar-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sde-creator-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px;
  align-items: center;
}
.sde-creator-row > label {
  font-size: 13px;
  color: var(--sde-bar-text-muted);
  font-weight: 700;
}
.sde-creator-row > input[type="text"],
.sde-creator-row > input[type="number"] {
  background: var(--sde-bar-input-bg);
  color: var(--sde-bar-text);
  border: 1px solid var(--sde-bar-border);
  font-family: var(--sde-bar-font);
  font-size: 14px;
  padding: 5px 10px;
  border-radius: 2px;
}
.sde-creator-row > input[type="number"] { width: 80px; }

.sde-creator-align-group {
  display: flex;
  gap: 12px;
}
.sde-creator-radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-family: monospace;
  font-size: 14px;
}

.sde-creator-img-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sde-creator-img-picker img {
  border: 1px solid var(--sde-bar-accent-dark);
  border-radius: 3px;
  flex-shrink: 0;
}
.sde-creator-img-path {
  flex: 1;
  background: var(--sde-bar-input-bg);
  color: var(--sde-bar-text);
  border: 1px solid var(--sde-bar-border);
  font-family: monospace;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 2px;
}
.sde-creator-img-picker button {
  background: var(--sde-bar-btn-2);
  border: 1px solid var(--sde-bar-border);
  color: var(--sde-bar-text);
  padding: 4px 8px;
  border-radius: 2px;
  cursor: pointer;
}
.sde-creator-img-picker button:hover { background: var(--sde-bar-bg-hover); }

.sde-creator-section-body textarea {
  background: var(--sde-bar-input-bg);
  color: var(--sde-bar-text);
  border: 1px solid var(--sde-bar-border);
  font-family: var(--sde-bar-font);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 2px;
  resize: vertical;
}

.sde-creator-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid var(--sde-bar-border);
  margin-top: 6px;
}
.sde-creator-save-btn {
  background: linear-gradient(135deg, var(--sde-bar-accent-dim) 0%, var(--sde-bar-accent-dark) 100%);
  color: #f5eccc;
  border: 1px solid var(--sde-bar-accent);
  border-radius: var(--sde-bar-radius);
  font-family: var(--sde-bar-font);
  font-size: 14px;
  font-weight: 700;
  padding: 6px 16px;
  cursor: pointer;
  transition: filter 0.12s;
}
.sde-creator-save-btn:hover:not(:disabled) { filter: brightness(1.2); }
.sde-creator-save-btn:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 7: Smoke test.** Reload Foundry, open the Encounter Roller, click the Monster Creator tab. Verify:
  - Identity section is open by default
  - Type a name → it persists when you click another section
  - Pick an alignment radio → persists
  - Click the portrait Browse button → FilePicker opens
  - Click "Create World Actor" with a name set → toast confirms, actor appears in sidebar
  - Open the new actor's sheet → name, alignment, level match what you entered; portrait + token image too
  - Click "Create World Actor" with no name → toast warns "needs a name"

- [ ] **Step 8: Update CHANGELOG.md** under `[Unreleased]` → `Added`. Insert under the existing encounter-system bullet's nested list (right before the `5 new world settings` / `10 new world settings` line):
```md
  - **Monster Creator tab — Slice 1e-i.** Author a Shadowdark NPC from scratch via the new fourth tab in the Encounter Roller. Sub-slice 1e-i ships the shell + Identity + Description sections and a working Save (writes a new world Actor with name, alignment, level, portrait, token image, and description). Section collapse state is preserved across renders. Subsequent sub-slices will add Stats, Movement, Spellcasting, Actions, Features, and a Bestiary loader.
```

- [ ] **Step 9: Commit.**
```bash
git add scripts/encounter/encounter-creator.mjs scripts/shadowdark-enhancer.mjs scripts/encounter/encounter-roller-app.mjs templates/encounter-creator.hbs templates/encounter-roller.hbs styles/shadowdark-enhancer.css CHANGELOG.md
git commit -m "feat(1e-i): Monster Creator shell + Identity + Description + Save

Adds MonsterCreatorApp as a sub-app mounted inside the Encounter
Roller's creator tab. Implements the Identity (name, alignment, level,
portrait + token image) and Description sections, plus a Save button
that writes a new world Actor (type: NPC) with all 1e-i fields.

Architecture matches Vagabond Crawler's mountPanel pattern:
- MonsterCreatorApp is a singleton with mountPanel(host) / unmountPanel()
- State (draft + section open/closed) lives on the singleton, so
  switching away from the creator tab and back preserves in-progress
  edits.
- Closing the roller window discards state.

Section collapsibles use native <details> with state stored in
this._sectionOpen{}. Text inputs use change events to limit re-renders
and stash focus/cursor on input for restore after render.

Exposes game.shadowdarkEnhancer.monsterCreator.open() as a public
API entry point.

Co-Authored-By: Gemini CLI <noreply@google.com>"
```

---

# Sub-slice 1e-ii — Stats + Movement + Spellcasting sections

**Goal:** Add three more sections to the Creator: **Stats** (HP, AC, ability mods, dark-adapted toggle), **Movement** (move enum + note), and **Spellcasting** (ability/bonus/attacks — only relevant when attacks > 0). Wire the draft → `actorData` conversion to include all the new fields.

**Files:**
- Modify: `scripts/encounter/encounter-creator.mjs` (extend draft default + actorData builder + sectionOpen)
- Modify: `templates/encounter-creator.hbs` (add three section blocks)
- Modify: `styles/shadowdark-enhancer.css` (add `.sde-creator-stats-grid`, `.sde-creator-ability-grid`)
- Modify: `CHANGELOG.md`

**Acceptance Criteria:**
- [ ] **Stats section:** HP (value + max), AC (number), 6 ability modifiers in a 3×2 grid (str/dex/con/int/wis/cha), Dark-Adapted checkbox. Live HP-value-clamps-to-max validation.
- [ ] **Movement section:** Move dropdown (close / near / doubleNear / tripleNear / far / special / none from `CONFIG.SHADOWDARK.NPC_MOVES`), Move Note text field (free text, e.g. "burrow", "swim").
- [ ] **Spellcasting section:** Ability dropdown (none / str / dex / con / int / wis / cha), Bonus (number), Attacks per round (number). The Bonus and Attacks fields disable visually when Ability is "none".
- [ ] All new draft fields persist across re-renders and section collapse/expand.
- [ ] On Save, the new world Actor has `system.attributes.hp`, `system.attributes.ac.value`, `system.abilities.*.mod`, `system.darkAdapted`, `system.move`, `system.moveNote`, `system.spellcasting.*` all set correctly.
- [ ] Foundry compatibility: `CONFIG.SHADOWDARK.NPC_MOVES` is read at template render time (in `_prepareContext`), not hardcoded.

**Verify:**
```bash
node --check scripts/encounter/encounter-creator.mjs && echo "OK"
```
Manual: create a Frost Goblin NPC with HP 5/5, AC 12, DEX +2, STR +1, Dark-Adapted, move = close, note = "burrow", spellcasting ability = wis, bonus = 1, attacks = 1. Save. Open the sheet — all fields populated correctly.

**Steps:**

- [ ] **Step 1: Extend `_defaultDraft()` in encounter-creator.mjs:**

```js
function _defaultDraft() {
  return {
    name:        "",
    alignment:   "N",
    level:       1,
    img:         "icons/svg/mystery-man.svg",
    tokenSrc:    "",
    description: "",
    // Stats (1e-ii)
    hp:          { value: 1, max: 1 },
    ac:          10,
    darkAdapted: false,
    abilities:   { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    // Movement (1e-ii)
    move:        "near",
    moveNote:    "",
    // Spellcasting (1e-ii)
    spellcasting: { ability: "", bonus: 0, attacks: 0 },
  };
}
```

- [ ] **Step 2: Extend `_sectionOpen` defaults** in the constructor to include `stats: false, movement: false, spellcasting: false`.

- [ ] **Step 3: Extend `_prepareContext`** to expose the move and ability lists:

```js
async _prepareContext(options) {
  return {
    draft:       this._draft,
    sectionOpen: this._sectionOpen,
    alignments:  ["L", "N", "C"],
    moveOptions: Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? {
      close: "", near: "", doubleNear: "", tripleNear: "", far: "", special: "", none: "",
    }),
    abilityKeys: ["str", "dex", "con", "int", "wis", "cha"],
  };
}
```

- [ ] **Step 4: Add a clamp-HP helper** in `_setDraft` — when the user sets `hp.value`, clamp it to `[0, hp.max]`:

```js
_setDraft(path, value) {
  const parts = path.split(".");
  let obj = this._draft;
  while (parts.length > 1) {
    const key = parts.shift();
    obj[key] ??= {};
    obj = obj[key];
  }
  obj[parts[0]] = value;
  // HP value clamped to max — keeps the UI sane during editing.
  if (path === "hp.max") {
    this._draft.hp.value = Math.min(this._draft.hp.value, this._draft.hp.max);
  } else if (path === "hp.value") {
    this._draft.hp.value = Math.min(value, this._draft.hp.max);
  }
  this.render();
}
```

- [ ] **Step 5: Extend `_onSave`'s `actorData` build** with the new fields:

```js
const actorData = {
  name: d.name.trim(),
  type: "NPC",
  img: d.img || "icons/svg/mystery-man.svg",
  system: {
    alignment:   d.alignment ?? "N",
    level:       Number(d.level ?? 1),
    darkAdapted: !!d.darkAdapted,
    move:        d.move ?? "near",
    moveNote:    d.moveNote ?? "",
    notes:       d.description ?? "",
    attributes: {
      hp: { value: Number(d.hp.value), max: Number(d.hp.max) },
      ac: { value: Number(d.ac), attribute: "" },
    },
    abilities: {
      str: { mod: Number(d.abilities.str) },
      dex: { mod: Number(d.abilities.dex) },
      con: { mod: Number(d.abilities.con) },
      int: { mod: Number(d.abilities.int) },
      wis: { mod: Number(d.abilities.wis) },
      cha: { mod: Number(d.abilities.cha) },
    },
    spellcasting: {
      ability: d.spellcasting.ability ?? "",
      bonus:   Number(d.spellcasting.bonus ?? 0),
      attacks: Number(d.spellcasting.attacks ?? 0),
    },
  },
  prototypeToken: {
    name: d.name.trim(),
    texture: { src: d.tokenSrc || d.img || "icons/svg/mystery-man.svg" },
  },
};
```

- [ ] **Step 6: Add three new section blocks** to `templates/encounter-creator.hbs`, BETWEEN the Identity and Description sections (so the order is Identity → Stats → Movement → Spellcasting → Description → Save):

```hbs
{{!-- ═══ Stats Section ═══ --}}
<details class="sde-creator-section" {{#if sectionOpen.stats}}open{{/if}}>
  <summary data-action="sectionToggle" data-section="stats">
    <i class="fas fa-heart-pulse"></i> Stats
  </summary>
  <div class="sde-creator-section-body">

    <div class="sde-creator-row">
      <label>HP</label>
      <div class="sde-creator-hp-pair">
        <input type="number" data-draft-field="hp.value" value="{{draft.hp.value}}" min="0">
        <span>/</span>
        <input type="number" data-draft-field="hp.max" value="{{draft.hp.max}}" min="1">
      </div>
    </div>

    <div class="sde-creator-row">
      <label>AC</label>
      <input type="number" data-draft-field="ac" value="{{draft.ac}}" min="0">
    </div>

    <div class="sde-creator-row">
      <label>Ability mods</label>
      <div class="sde-creator-ability-grid">
        {{#each abilityKeys}}
          <label class="sde-creator-ability-cell">
            <span class="sde-creator-ability-label">{{this}}</span>
            <input type="number" data-draft-field="abilities.{{this}}" value="{{lookup ../draft.abilities this}}">
          </label>
        {{/each}}
      </div>
    </div>

    <div class="sde-creator-row">
      <label>Dark-Adapted</label>
      <input type="checkbox" data-draft-field="darkAdapted" {{#if draft.darkAdapted}}checked{{/if}}>
    </div>

  </div>
</details>

{{!-- ═══ Movement Section ═══ --}}
<details class="sde-creator-section" {{#if sectionOpen.movement}}open{{/if}}>
  <summary data-action="sectionToggle" data-section="movement">
    <i class="fas fa-shoe-prints"></i> Movement
  </summary>
  <div class="sde-creator-section-body">

    <div class="sde-creator-row">
      <label>Move</label>
      <select data-draft-field="move">
        {{#each moveOptions}}
          <option value="{{this}}" {{#if (eq this ../draft.move)}}selected{{/if}}>{{this}}</option>
        {{/each}}
      </select>
    </div>

    <div class="sde-creator-row">
      <label>Note</label>
      <input type="text" data-draft-field="moveNote" value="{{draft.moveNote}}" placeholder="e.g. burrow, fly, swim">
    </div>

  </div>
</details>

{{!-- ═══ Spellcasting Section ═══ --}}
<details class="sde-creator-section" {{#if sectionOpen.spellcasting}}open{{/if}}>
  <summary data-action="sectionToggle" data-section="spellcasting">
    <i class="fas fa-wand-sparkles"></i> Spellcasting
  </summary>
  <div class="sde-creator-section-body">

    <div class="sde-creator-row">
      <label>Ability</label>
      <select data-draft-field="spellcasting.ability">
        <option value="" {{#unless draft.spellcasting.ability}}selected{{/unless}}>— None —</option>
        {{#each abilityKeys}}
          <option value="{{this}}" {{#if (eq this ../draft.spellcasting.ability)}}selected{{/if}}>{{this}}</option>
        {{/each}}
      </select>
    </div>

    <div class="sde-creator-row">
      <label>Bonus</label>
      <input type="number" data-draft-field="spellcasting.bonus" value="{{draft.spellcasting.bonus}}" {{#unless draft.spellcasting.ability}}disabled{{/unless}}>
    </div>

    <div class="sde-creator-row">
      <label>Attacks/round</label>
      <input type="number" data-draft-field="spellcasting.attacks" value="{{draft.spellcasting.attacks}}" min="0" {{#unless draft.spellcasting.ability}}disabled{{/unless}}>
    </div>

  </div>
</details>
```

- [ ] **Step 7: Wire the checkbox handler.** The generic `_wireFieldInputs` reads `ev.target.value` which is "on"/"off" for checkboxes — wrong shape. Extend the binder:

```js
_wireFieldInputs() {
  if (!this.element) return;
  this.element.querySelectorAll("[data-draft-field]").forEach(input => {
    input.addEventListener("change", ev => {
      const path = ev.target.dataset.draftField;
      let val;
      if (ev.target.type === "checkbox")    val = ev.target.checked;
      else if (ev.target.type === "number") val = Number(ev.target.value);
      else                                  val = ev.target.value;
      this._setDraft(path, val);
    });
    // ... (rest unchanged)
  });
}
```

- [ ] **Step 8: Add CSS** for the new layouts. Append after the existing `.sde-creator-img-picker button:hover` rule:

```css
.sde-creator-hp-pair {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sde-creator-hp-pair input { width: 60px; }

.sde-creator-ability-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}
.sde-creator-ability-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.sde-creator-ability-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--sde-bar-text-muted);
  letter-spacing: 0.5px;
}
.sde-creator-ability-cell input {
  width: 50px;
  text-align: center;
  background: var(--sde-bar-input-bg);
  color: var(--sde-bar-text);
  border: 1px solid var(--sde-bar-border);
  font-family: monospace;
  font-size: 14px;
  padding: 3px 4px;
  border-radius: 2px;
}

.sde-creator-section-body select {
  background: var(--sde-bar-input-bg);
  color: var(--sde-bar-text);
  border: 1px solid var(--sde-bar-border);
  font-family: var(--sde-bar-font);
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 2px;
}
```

- [ ] **Step 9: Smoke test.** Set all stat / movement / spellcasting fields on a draft, save, verify sheet shows everything correctly. Also: set Ability = "none" on Spellcasting → Bonus and Attacks fields should visually disable.

- [ ] **Step 10: CHANGELOG entry under 1e-ii**, and commit. Same pattern as Sub-slice 1e-i.

---

# Sub-slice 1e-iii — Actions section (NPC Attacks)

**Goal:** Add an **Actions** section that lets the user build the NPC's attack list. Each entry is an in-memory action object (no item docs created until Save). Supports two item types: regular `NPC Attack` and `NPC Special Attack`. Includes a Quick Pick gallery of curated common Shadowdark attacks (Bite, Claw, Slam, Spear, Bow, etc.) the user can click to insert.

**Files:**
- Modify: `scripts/encounter/encounter-creator.mjs` (add attacks state + action handlers + save logic)
- Create: `scripts/encounter/action-templates.mjs` (Quick Pick catalog — patterned after Vagabond's `action-templates.mjs`)
- Modify: `templates/encounter-creator.hbs` (add Actions section)
- Modify: `styles/shadowdark-enhancer.css` (add `.sde-creator-action-*` rules)
- Modify: `CHANGELOG.md`

**Acceptance Criteria:**
- [ ] Actions section lists each action with: type (regular / special), name, attacks-per-round, attack bonus, damage formula, damage bonus, ranges (close/near/far multi-select), special-text field.
- [ ] "+ Add Action" button creates a blank regular-type entry. "+ Add Special Attack" creates a blank special-type entry.
- [ ] Each row has a ✕ remove button.
- [ ] Quick Pick gallery: ~12-15 curated Shadowdark attacks. Click → inserts as a new action with all fields pre-filled.
- [ ] On Save, each action becomes an `NPC Attack` or `NPC Special Attack` item on the world actor. Item fields match the Shadowdark schema (see `NpcAttackSD.mjs` for canonical shape).
- [ ] Edit values on existing items via change-event inputs (same data-draft-field pattern).
- [ ] After save, open the actor sheet — Attacks section shows all the created NPC Attack items with the right names, bonuses, damage formulas.

**Verify:**
```bash
node --check scripts/encounter/encounter-creator.mjs && node --check scripts/encounter/action-templates.mjs && echo "OK"
```
Manual: create a Frost Goblin with Bite Quick Pick + a custom Spear attack (close/near, 1d6+1, +2 attack bonus). Save. Verify both appear in the actor sheet's Attacks section.

**Steps:**

- [ ] **Step 1: Curate the Quick Pick catalog** in `scripts/encounter/action-templates.mjs`. Shape per entry:
```js
{
  name: "Bite",
  kind: "regular",        // "regular" or "special"
  attackBonus: 1,
  num: 1,
  damage: "1d4",
  damageBonus: 0,
  ranges: ["close"],
  special: "",
}
```

Author 12–15 entries covering common Shadowdark patterns. Reference the Shadowdark bestiary at `F:/Obsidian/Shadowdark/Shadowdark/Master Core Rulebook/05 - Bestiary.md` to mine common attacks. Starter set:
- Bite (close, 1d4)
- Claw (close, 1d4)
- Slam (close, 1d6)
- Spear (close/near, 1d6)
- Sword (close, 1d6)
- Greatsword (close, 1d8)
- Greataxe (close, 1d8)
- Mace (close, 1d6)
- Club (close, 1d4)
- Dagger (close/near, 1d4)
- Bow (far, 1d6)
- Crossbow (far, 1d8)
- Sling (far, 1d4)
- Javelin (close/far, 1d4)
- Spell Attack (far, 1d6 — kind: "special")

Export a default `ACTION_QUICK_PICKS` array.

- [ ] **Step 2: Extend draft + sectionOpen** in encounter-creator.mjs: add `actions: []` to `_defaultDraft()` and `actions: false` to `_sectionOpen`.

- [ ] **Step 3: Add action handlers** for `creatorAddAction`, `creatorAddSpecial`, `creatorRemoveAction`, `creatorAddQuickPick`. The remove handler reads `data-action-idx` from the closest container.

- [ ] **Step 4: Extend `_onSave`** to create one NPC Attack or NPC Special Attack item per draft action. Use `actor.createEmbeddedDocuments("Item", [...])` AFTER the actor is created. Schema:
```js
{
  name: action.name,
  type: action.kind === "special" ? "NPC Special Attack" : "NPC Attack",
  system: {
    attack: { num: Number(action.num) },
    bonuses: {
      attackBonus: Number(action.attackBonus),
      damageBonus: Number(action.damageBonus),
    },
    damage: {
      value: action.damage,
      numDice: 1,         // 1e-iii ships single-die; multi-die formulas can be entered in the damage string ("2d6")
      special: action.special,
    },
    ranges: action.ranges,
  },
}
```

- [ ] **Step 5: Add the Actions section** to the template — between Movement and Spellcasting (the order is now Identity → Stats → Movement → Actions → Spellcasting → Description → Save).

Template should iterate `draft.actions` and render each row with all editable fields. Below the list, a row of Quick Pick buttons (rendered from `ACTION_QUICK_PICKS`), then the "+ Add Action" / "+ Add Special Attack" buttons.

- [ ] **Step 6: Wire range checkboxes specially.** Ranges are an array of strings (`["close", "near"]`). Three checkboxes (close/near/far) per action row; toggling updates `draft.actions[idx].ranges`.

- [ ] **Step 7: Add CSS** for the action list — make each row a card with sub-grid for the numeric fields, and the Quick Picks a flex-wrap gallery.

- [ ] **Step 8: Smoke test** — see acceptance criteria.

- [ ] **Step 9: CHANGELOG entry** + commit.

---

# Sub-slice 1e-iv — Features section (NPC Features)

**Goal:** Add a **Features** section that lets the user add NPC Feature items (special abilities, traits, lore — e.g. Magic Resistance, Pack Tactics, Petrify gaze). Each feature has just `name` + `description` (HTML). Includes a Quick Pick gallery patterned after Sub-slice 1e-iii.

**Files:**
- Modify: `scripts/encounter/encounter-creator.mjs`
- Create: `scripts/encounter/feature-templates.mjs`
- Modify: `templates/encounter-creator.hbs`
- Modify: `styles/shadowdark-enhancer.css`
- Modify: `CHANGELOG.md`

**Acceptance Criteria:**
- [ ] Features section lists each feature with: name (input) + description (textarea).
- [ ] "+ Add Feature" button creates a blank entry.
- [ ] ✕ remove per row.
- [ ] Quick Pick gallery of ~12–15 common Shadowdark features.
- [ ] On Save, each feature becomes an `NPC Feature` item on the actor (`type: "NPC Feature"`, `name`, `system.description`).

**Quick Pick starter list** (curate from the bestiary):
- Magic Resistance
- Mob (+1 dmg when beside ally)
- Pack Tactics
- Pack Hunter
- Petrify (gaze)
- Regenerate 5 HP/round
- Rage (+1d4 dmg)
- Brutal (+1 dmg with melee)
- Ambush (+1 die when undetected)
- Keen Senses (can't be surprised)
- Dodge (1/day, missed attack)
- Burrow
- Blood Drain (auto-hit next round)
- Disease (DC 12 CON)
- Poison (DC 12 CON or paralyzed 1d4 rds)

**Steps:**

- [ ] **Step 1–9** follow the same pattern as Sub-slice 1e-iii (templates → draft state → actions → save logic → template → CSS → smoke test → CHANGELOG → commit).

---

# Sub-slice 1e-v — Bestiary Loader

**Goal:** Add a **Load From Bestiary** affordance at the top of the Creator. When clicked, opens a small picker (similar to Browse NPCs' table layout) showing every NPC in installed Actor compendium packs. Selecting one pre-fills every Creator section with that monster's data — including items (attacks + features), portrait + token images (using the `_bestArtForActor` lookup chain). User can then edit and Save as a new world Actor (the source compendium is never modified).

**Files:**
- Modify: `scripts/encounter/encounter-creator.mjs` (add loader state + handlers + draft-from-actor converter)
- Modify: `templates/encounter-creator.hbs` (add "Load From Bestiary" button + modal/popover)
- Modify: `styles/shadowdark-enhancer.css`
- Modify: `CHANGELOG.md`

**Acceptance Criteria:**
- [ ] Top of Creator panel has a "📚 Load From Bestiary…" button.
- [ ] Click → opens a popover/modal listing NPCs from currently-selected sources (reuse `encounter-browse.mjs`'s `EncounterBrowse.loadNPCs(sourceIds)` + the `encounterSources` setting).
- [ ] Picker is filterable by name (single text input — keep this slice simple).
- [ ] Click an NPC in the picker → all Creator sections pre-fill: name, alignment, level, abilities, hp/ac, move, spellcasting, attacks, features, portrait, token image (via `_bestArtForActor`).
- [ ] User can edit anything after loading; Save creates a NEW world Actor (does not overwrite the loaded source).
- [ ] Loaded actor's items (NPC Attacks + NPC Features) become draft entries the user can edit/remove.

**Verify:**
```bash
node --check scripts/encounter/encounter-creator.mjs && echo "OK"
```
Manual: open Creator → Load From Bestiary → pick "Beastman" → all sections populate (alignment C, level 1, Spear attack, Brutal feature, etc.). Edit name to "Bartender Beastman", Save. Verify two Beastman actors now in world (the original + the new one).

**Steps:**

- [ ] **Step 1: Add `_loaderOpen`, `_loaderSearch`, `_loaderRows` state** to the constructor.

- [ ] **Step 2: Add `_onLoadFromBestiary`** handler that toggles `_loaderOpen` and triggers an async load of NPCs from `encounterSources` setting. Use `EncounterBrowse.loadNPCs()` for the deep-load.

- [ ] **Step 3: Add `_onLoaderPick(uuid)`** handler — `await fromUuid(uuid)`, then call `_draftFromActor(actor)` which converts the actor's full data into a draft object. Set `this._draft = newDraft` and `this._loaderOpen = false`, then render.

- [ ] **Step 4: Implement `_draftFromActor(actor)`** carefully:
  - Use `_bestArtForActor(actor)` to resolve img and tokenSrc (don't just use `actor.img` — handles the community-tokens case)
  - Walk `actor.items` and split by type into `attacks` (NPC Attack + NPC Special Attack) and `features` (NPC Feature)
  - For each attack, extract the right schema fields back into the draft shape
  - Read `system.notes` for description (NOT `system.description`)

- [ ] **Step 5: Add the loader UI** — a popover overlay anchored to the Load button. Search input + scrollable list of NPC rows (name + level + alignment + source pack badge).

- [ ] **Step 6: Add CSS** for the loader popover.

- [ ] **Step 7: Smoke test** — see acceptance criteria.

- [ ] **Step 8: CHANGELOG entry** + commit.

---

# Final acceptance criteria for the whole Slice 1e

When all five sub-slices land, ALL of the following must be true:

**Functional:**
- [ ] Monster Creator tab in Encounter Roller is fully functional (no "Coming in a later slice" stub).
- [ ] Identity, Stats, Movement, Spellcasting, Actions, Features, Description sections all editable and persist across re-renders / section toggles / tab switches.
- [ ] Save writes a complete NPC Actor with all fields + all items, type `NPC`, into the world Actors collection.
- [ ] Load From Bestiary pre-fills the draft from any installed Actor compendium pack, with art correctly resolved via `_bestArtForActor`.
- [ ] After save, the new actor:
  - Shows correctly on the Shadowdark NPC actor sheet (all stat blocks, attacks, features visible)
  - Can be dragged onto canvas to create a token with the right image
  - Can be drag-dropped onto a Build Table slot
  - Is searchable via Browse NPCs tab in the encounter roller

**No regressions:**
- [ ] Roll Tables / Build Table / Browse NPCs tabs all still work as before.
- [ ] `_bestArtForActor` and friends still work for Place tokens.
- [ ] All previous CHANGELOG `[Unreleased]` bullets remain intact.

**Convention compliance:**
- [ ] No deprecated Foundry API calls (use namespaced `foundry.applications.handlebars.renderTemplate`, etc.).
- [ ] All new CSS classes use `sde-creator-*` prefix.
- [ ] All comments explain *why*, not *what*.
- [ ] One commit per sub-slice with the exact message format shown.

---

## Explicit non-goals (don't add these to this slice)

- **Mutations system** — Vagabond ports 64 mutation templates with TL deltas. Shadowdark has no TL; mutations don't map cleanly. Defer indefinitely.
- **Action `causedStatuses` / `critCausedStatuses`** — Vagabond's automation-layer riders. Shadowdark stores rider text in `damage.special` as free text; nothing to automate.
- **Token vision sub-config (sight modes, range)** — let users configure this via Foundry's standard prototypeToken UI on the actor sheet.
- **Threat Level / DPR computation** — Vagabond concepts that don't apply.
- **Structured weaknesses / immunities / status immunities** — Shadowdark uses description text. Users put this info in the Description section.
- **vtta-tokenizer integration** — Vagabond has a "Tokenize…" button. Skip; users can run vtta-tokenizer from the saved actor's sheet if installed.
- **AI art prompt generator** — Vagabond's `generatePrompt()`. Skip.
- **Real-time live preview of computed HP / DPR** — no Shadowdark formula to compute these from base stats. Just edit the values directly.
- **Mounting the Creator as a standalone window** — only mounted inside the Encounter Roller for this slice.

---

## Pitfalls / known gotchas

1. **Don't use `Hooks.once("init")` for ApplicationV2 instantiation.** ApplicationV2 needs `game` and `canvas` to exist. Always wait for `ready` or instantiate lazily (which `MonsterCreator.instance` already does).

2. **`system.notes` not `system.description`.** Shadowdark NPCs store flavor text in `system.notes`. Easy mistake — both fields commonly exist on other systems' NPCs.

3. **`Actor.implementation.create(data)` is correct — not `Actor.create(data)`.** The latter is deprecated; `implementation` returns the system's actor subclass.

4. **Compendium pack `documentName === "Actor"`** — Browse uses this filter, Creator's bestiary loader should too. Item packs would otherwise pollute the list.

5. **Section state persists on the singleton.** Don't reset `_sectionOpen` on render or you'll close everything on every input change.

6. **`<details>` summary needs `cursor: pointer`** and the toggle handler should call `ev.preventDefault()` so the browser's default toggle doesn't fight your state-driven `open` attribute.

7. **The `_wireFieldInputs` change-event binder fires for `<select>` too** — make sure your binder reads `.value` correctly for selects (it does; just verify when wiring).

8. **Reuse art helpers from `art-utils.mjs`** — don't duplicate `_isPlaceholderArt` etc. inside encounter-creator.mjs.

9. **Quick Pick clicks should `ev.preventDefault()` and stop propagation** — they're inside the `<details>` body and clicking them shouldn't bubble to the summary and close the section.

10. **`CONFIG.SHADOWDARK.NPC_MOVES` might not be populated until `init` finishes.** Always read it inside `_prepareContext`, not at module top-level.

11. **Don't try to use `_bestArtForActor` inside `_prepareContext` synchronously** — it's async. Call it BEFORE render (in the loader pick handler) and store the resolved values on the draft.

---

## Token budget guidance

If you're using a token-conscious LLM (Gemini CLI counts), this plan is sized to run sub-slice-by-sub-slice. Per-sub-slice budget:

- **1e-0** (refactor): ~150 lines moved, ~30 minutes
- **1e-i** (shell + Identity + Description + Save): ~400 LOC new, ~1 hour
- **1e-ii** (Stats + Movement + Spellcasting): ~200 LOC added, ~30 minutes
- **1e-iii** (Actions): ~350 LOC + ~200 LOC quick picks file, ~1.5 hours
- **1e-iv** (Features): ~200 LOC + ~150 LOC quick picks file, ~1 hour
- **1e-v** (Bestiary loader): ~250 LOC, ~1 hour

Total: ~1700 LOC, ~5 hours. Substantially less than Vagabond's 2400+ LOC because we skip the Mutations / Threat Level / structured-immunity sections entirely.

Don't refactor things outside the listed files. Don't add features outside the acceptance criteria. If you spot a bug in existing code, note it in a comment and continue — don't fix it in this slice.
