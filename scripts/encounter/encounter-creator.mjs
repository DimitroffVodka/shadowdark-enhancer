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
import { ACTION_QUICK_PICKS } from "./action-templates.mjs";
import { FEATURE_QUICK_PICKS } from "./feature-templates.mjs";

const { renderTemplate } = foundry.applications.handlebars;

const TEMPLATE_PATH = "modules/shadowdark-enhancer/templates/encounter-creator.hbs";

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
    hp: { value: 1, max: 1 },
    ac: 10,
    darkAdapted: false,
    abilities: {
      str: 0, dex: 0, con: 0,
      int: 0, wis: 0, cha: 0
    },
    // Movement
    move:     "near",        // close/near/far
    moveNote: "",            // e.g. "climb", "swim"
    // Spellcasting
    spellcasting: {
      ability: "",           // "" (none) / int / wis / cha — lowercase to match
                             //   abilities object keys and Shadowdark schema
      bonus:   0,
      attacks: 0,            // spells-per-round; Browse NPCs filter requires >0
                             //   for "is a spellcaster"
    },
    // Items — Sub-slice 1e-iii / 1e-iv
    actions:  [],            // each: {id, name, type, num, bonus, damage, ranges, description}
    features: [],            // each: {id, name, description}
  };
}

/**
 * Plain class — NOT extending ApplicationV2.
 *
 * We tried mounting an ApplicationV2 subclass into an external host
 * div via overridden _replaceHTML, but the framework simultaneously
 * creates its own `content` element that conflicts with our manual
 * mount target — `this.element` ends up pointing to an empty,
 * never-displayed div, so subsequent querySelectorAll(...) finds
 * nothing and the visible host stays blank.
 *
 * For a panel that lives inside another app's DOM (mounted into the
 * EncounterRollerApp's creator tab), the simpler pattern is to
 * manage the DOM lifecycle ourselves: render template → set
 * host.innerHTML → wire events. ~30 lines, no framework surprises.
 */
export class MonsterCreatorApp {

  /** Click-action handler map. Each entry's value is called as
   *  `handler.call(this, event, target)` from _wireActions when a
   *  `[data-action]` element is clicked. Same shape ApplicationV2
   *  uses for its actions map, just dispatched manually. */
  static ACTIONS = {
    sectionToggle:              MonsterCreatorApp.prototype._onSectionToggle,
    pickImg:                    MonsterCreatorApp.prototype._onPickImg,
    pickTokenSrc:               MonsterCreatorApp.prototype._onPickTokenSrc,
    creatorAddAction:           MonsterCreatorApp.prototype._onAddAction,
    creatorAddSpecial:          MonsterCreatorApp.prototype._onAddSpecial,
    creatorRemoveAction:        MonsterCreatorApp.prototype._onRemoveAction,
    creatorAddQuickPick:        MonsterCreatorApp.prototype._onAddQuickPick,
    creatorAddFeature:          MonsterCreatorApp.prototype._onAddFeature,
    creatorRemoveFeature:       MonsterCreatorApp.prototype._onRemoveFeature,
    creatorAddFeatureQuickPick: MonsterCreatorApp.prototype._onAddFeatureQuickPick,
    creatorToggleLoader:        MonsterCreatorApp.prototype._onToggleLoader,
    creatorLoaderPick:          MonsterCreatorApp.prototype._onLoaderPick,
    save:                       MonsterCreatorApp.prototype._onSave,
  };

  constructor() {
    this._draft = _defaultDraft();
    // Section open/closed state — survives renders. Default: Identity open.
    this._sectionOpen = {
      identity:     true,
      stats:        false,
      movement:     false,
      actions:      false,
      features:     false,
      spellcasting: false,
      description:  false,
    };
    // Text-input focus stashes for cursor preservation across renders.
    this._focused = {};  // { fieldName: {selectionStart} }
    this._lastFocusedField = null;

    // Bestiary Loader state (1e-v)
    this._loaderOpen   = false;
    this._loaderSearch = "";
    this._loaderRows   = [];   // Array of {name, level, alignment, uuid, img}
  }

  // ─── Singleton + mount/unmount ────────────────────────────────────

  static _instance = null;

  static get instance() {
    if (!this._instance) this._instance = new MonsterCreatorApp();
    return this._instance;
  }

  /** Mounts the creator panel inside the given host element. Called by
   *  EncounterRollerApp when the creator tab is opened. Idempotent —
   *  re-calling with the same host just re-renders. */
  static async mountPanel(host) {
    const inst = this.instance;
    inst._mountHost = host;
    await inst.render();
  }

  /** Unmounts the panel without destroying its state. Called when the
   *  user switches to another tab. State is preserved on the singleton
   *  so reopening the creator tab restores in-progress edits. */
  static unmountPanel() {
    if (this._instance?._mountHost) {
      this._instance._mountHost.innerHTML = "";
      this._instance._mountHost = null;
    }
  }

  /** Open the Encounter Roller directly on the creator tab. */
  static async open() {
    const mod = await import("./encounter-roller-app.mjs");
    return mod.EncounterRollerApp.open("creator");
  }

  // ─── Render lifecycle ────────────────────────────────────────────
  //
  // No ApplicationV2 inheritance — we manage the DOM directly inside
  // the host div EncounterRollerApp gives us. render() is the single
  // entry point; everything else (input wiring, action dispatch, focus
  // restoration) runs from _onRender after the HTML is in place.

  async render() {
    if (!this._mountHost) return;
    const context = await this._prepareContext();
    const html = await renderTemplate(TEMPLATE_PATH, context);
    this._mountHost.innerHTML = html;
    this._onRender(context);
  }

  async _prepareContext() {
    // Bestiary loader (1e-v): pre-filter rows here so the template
    // doesn't need exotic Handlebars helpers like (lower) / (or) /
    // (not) — we only ship `includes`, `array`, `isFinite` from the
    // entry point, and trying to call missing helpers throws at
    // render time. JS filter + a flat array → trivial template.
    const needle = (this._loaderSearch ?? "").trim().toLowerCase();
    const loaderRowsFiltered = needle
      ? this._loaderRows.filter(r => r.name?.toLowerCase().includes(needle))
      : this._loaderRows;

    return {
      draft:       this._draft,
      sectionOpen: this._sectionOpen,
      alignments:  ["L", "N", "C"],
      // Movement options come from the system's NPC_MOVES enum — the
      // full set (close/near/doubleNear/tripleNear/far/special/none),
      // not just close/near/far. Read at render-time so we follow any
      // future system additions automatically.
      moveOptions: Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? {
        close: "", near: "", doubleNear: "", tripleNear: "",
        far: "", special: "", none: "",
      }),
      // Lowercase ability keys to match the system schema. The
      // Spellcasting ability dropdown stores these directly into
      // system.spellcasting.ability, which expects lowercase.
      spellAbilities: ["int", "wis", "cha"],
      // 1e-iii
      ACTION_QUICK_PICKS,
      ranges: Object.keys(CONFIG.SHADOWDARK?.RANGES ?? {
        close: "", near: "", far: "", nearLine: "",
      }),
      // 1e-iv
      FEATURE_QUICK_PICKS,
      // 1e-v — Bestiary Loader state. _loaderOpen / _loaderSearch /
      // _loaderRowsFiltered MUST be exposed here for the template to
      // see them; private instance fields like `this._loaderOpen` are
      // invisible to Handlebars.
      _loaderOpen:    this._loaderOpen,
      _loaderSearch:  this._loaderSearch,
      _loaderRows:    loaderRowsFiltered,
      _loaderEmpty:   loaderRowsFiltered.length === 0,
    };
  }

  _onRender(context) {
    this._restoreFocus();
    this._wireActions();
    this._wireFieldInputs();
    this._wireLoaderSearch();
  }

  /** Manually dispatch clicks on `[data-action="..."]` elements to the
   *  matching handler in ACTIONS. Replaces ApplicationV2's framework
   *  wiring since we no longer extend it. */
  _wireActions() {
    if (!this._mountHost) return;
    this._mountHost.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const action = ev.currentTarget.dataset.action;
        const handler = MonsterCreatorApp.ACTIONS[action];
        if (handler) handler.call(this, ev, ev.currentTarget);
      });
    });
  }

  /**
   * Wire the Bestiary-Loader search input.
   *
   * Why this isn't a `data-draft-field` — that handler writes via
   * `_setDraft()`, which walks down from `this._draft`. A path of
   * "_loaderSearch" would set `this._draft._loaderSearch`, which
   * never reaches `_prepareContext`'s loader filtering. The search
   * input has to write to `this._loaderSearch` directly, which we
   * do here. Debounced so each keystroke doesn't trigger a re-render
   * (re-render rebuilds the popover and loses input focus).
   */
  _wireLoaderSearch() {
    const input = this._mountHost?.querySelector("input[data-loader-search]");
    if (!input) return;

    let t = null;
    input.addEventListener("input", ev => {
      // Stash focus so _restoreFocus puts the cursor back after render.
      this._focused["__loaderSearch"] = { selectionStart: ev.target.selectionStart };
      this._lastFocusedField = "__loaderSearch";
      clearTimeout(t);
      t = setTimeout(() => {
        this._loaderSearch = ev.target.value;
        this.render();
      }, 150);
    });
    input.addEventListener("blur", () => {
      if (this._lastFocusedField === "__loaderSearch") this._lastFocusedField = null;
    });
  }

  // ─── Field wiring (text/number inputs use change-events to limit re-renders) ─

  _wireFieldInputs() {
    if (!this._mountHost) return;

    // Generic field-binder: every input with [data-draft-field="path.to.field"]
    // updates this._draft on change. Uses dot-path so we can wire nested
    // fields later (system.attributes.hp.max etc.) the same way.
    this._mountHost.querySelectorAll("[data-draft-field]").forEach(input => {
      input.addEventListener("change", ev => {
        const path = ev.target.dataset.draftField;
        // Array-valued checkbox groups (e.g. actions.N.ranges) — the
        // checkbox has a `value` attribute holding the string we want
        // to add/remove from the existing array. Toggling replaces the
        // array with [oldValues ± value] instead of clobbering it
        // with the checkbox's boolean `checked` state.
        if (ev.target.type === "checkbox" && ev.target.hasAttribute("value")) {
          const tag = ev.target.value;
          const cur = this._getDraft(path);
          const arr = Array.isArray(cur) ? [...cur] : [];
          const at  = arr.indexOf(tag);
          if (ev.target.checked && at === -1) arr.push(tag);
          else if (!ev.target.checked && at !== -1) arr.splice(at, 1);
          this._setDraft(path, arr);
          return;
        }
        let value;
        if (ev.target.type === "checkbox") {
          value = ev.target.checked;
        } else if (ev.target.type === "number") {
          value = Number(ev.target.value);
        } else {
          value = ev.target.value;
        }
        this._setDraft(path, value);
      });
      // For text/textarea inputs, also stash cursor on input so we can
      // restore after re-render. Renders are change-event-driven though,
      // so this is only a safety net for re-renders triggered by other paths.
      if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", ev => {
          const path = ev.target.dataset.draftField;
          this._focused[path] = {
            selectionStart: ev.target.selectionStart,
          };
          this._lastFocusedField = path;
        });
        input.addEventListener("focus", ev => {
          this._lastFocusedField = ev.target.dataset.draftField;
        });
      }
    });
  }

  _restoreFocus() {
    // Re-focus the most recently focused field after re-render, putting
    // the cursor back where the user left it. Avoids the cursor-jumps-
    // to-end issue ApplicationV2 has on full re-renders.
    const lastField = this._lastFocusedField;
    if (!lastField) return;
    // Special case: loader search uses `data-loader-search` (not a
    // draft field — see _wireLoaderSearch for why).
    const selector = lastField === "__loaderSearch"
      ? "input[data-loader-search]"
      : `[data-draft-field="${CSS.escape(lastField)}"]`;
    const input = this._mountHost?.querySelector(selector);
    if (input) {
      input.focus();
      const pos = this._focused[lastField]?.selectionStart ?? input.value.length;
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

  /** Dot-path reader, mirror of _setDraft. Returns undefined if any
   *  segment is missing. Used by the array-checkbox toggle path so we
   *  can read the existing array, mutate, and write back. */
  _getDraft(path) {
    const parts = path.split(".");
    let obj = this._draft;
    for (const key of parts) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  }

  // ─── Action handlers ──────────────────────────────────────────────

  _onSectionToggle(event, target) {
    const section = target.dataset.section;
    if (!section) return;
    this._sectionOpen[section] = !this._sectionOpen[section];
    this.render();
  }

  _onAddAction() {
    this._draft.actions.push({
      id: foundry.utils.randomID(),
      name: "New Attack",
      type: "NPC Attack",
      num: 1,
      bonus: 0,
      damage: "1d6",
      ranges: ["close"],
      description: "",
    });
    this._sectionOpen.actions = true;
    this.render();
  }

  _onAddSpecial() {
    this._draft.actions.push({
      id: foundry.utils.randomID(),
      name: "New Special",
      type: "NPC Special Attack",
      description: "Description of the special effect.",
    });
    this._sectionOpen.actions = true;
    this.render();
  }

  _onRemoveAction(event, target) {
    const id = target.dataset.id;
    this._draft.actions = this._draft.actions.filter(a => a.id !== id);
    this.render();
  }

  _onAddQuickPick(event, target) {
    const idx = Number(target.dataset.index);
    const template = ACTION_QUICK_PICKS[idx];
    if (!template) return;

    this._draft.actions.push({
      ...foundry.utils.deepClone(template),
      id: foundry.utils.randomID(),
    });
    this._sectionOpen.actions = true;
    this.render();
  }

  _onAddFeature() {
    this._draft.features.push({
      id: foundry.utils.randomID(),
      name: "New Feature",
      description: "Description of the feature.",
    });
    this._sectionOpen.features = true;
    this.render();
  }

  _onRemoveFeature(event, target) {
    const id = target.dataset.id;
    this._draft.features = this._draft.features.filter(f => f.id !== id);
    this.render();
  }

  _onAddFeatureQuickPick(event, target) {
    const idx = Number(target.dataset.index);
    const template = FEATURE_QUICK_PICKS[idx];
    if (!template) return;

    this._draft.features.push({
      ...foundry.utils.deepClone(template),
      id: foundry.utils.randomID(),
    });
    this._sectionOpen.features = true;
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

  async _onToggleLoader() {
    this._loaderOpen = !this._loaderOpen;
    if (this._loaderOpen) {
      // Lazy load NPCs on open
      const { EncounterBrowse } = await import("./encounter-browse.mjs");
      const sources = game.settings.get(MODULE_ID, "encounterSources");
      this._loaderRows = await EncounterBrowse.loadNPCs(sources);
    }
    this.render();
  }

  async _onLoaderPick(event, target) {
    const uuid = target.dataset.uuid;
    const actor = await fromUuid(uuid);
    if (actor) {
      await this._draftFromActor(actor);
      this._loaderOpen = false;
      this.render();
    }
  }

  async _draftFromActor(actor) {
    const s = actor.system;
    const { img, tokenSrc } = await _bestArtForActor(actor);

    const draft = {
      name:        actor.name,
      alignment:   s.alignment || "N",
      level:       s.level || 1,
      img:         img || "icons/svg/mystery-man.svg",
      tokenSrc:    tokenSrc || "",
      description: s.notes || "",
      hp: {
        value: s.attributes?.hp?.value ?? 1,
        max:   s.attributes?.hp?.max   ?? 1,
      },
      ac: s.attributes?.ac?.value ?? 10,
      darkAdapted: !!s.darkAdapted,
      abilities: {
        str: s.abilities?.str?.mod ?? 0,
        dex: s.abilities?.dex?.mod ?? 0,
        con: s.abilities?.con?.mod ?? 0,
        int: s.abilities?.int?.mod ?? 0,
        wis: s.abilities?.wis?.mod ?? 0,
        cha: s.abilities?.cha?.mod ?? 0,
      },
      move:     s.move || "near",
      moveNote: s.moveNote || "",
      spellcasting: {
        ability: s.spellcasting?.ability || "",
        bonus:   s.spellcasting?.bonus   || 0,
        attacks: s.spellcasting?.attacks || 0,
      },
      actions:  [],
      features: [],
    };

    // Split items into Actions and Features
    for (const item of actor.items) {
      if (item.type === "NPC Attack" || item.type === "NPC Special Attack") {
        draft.actions.push({
          id:     foundry.utils.randomID(),
          name:   item.name,
          type:   item.type,
          num:    item.system.attack?.num ?? 1,
          bonus:  item.system.bonuses?.attackBonus ?? 0,
          damage: item.system.damage?.value || "",
          ranges: item.system.ranges || [],
          description: item.system.description || item.system.damage?.special || "",
        });
      } else if (item.type === "NPC Feature") {
        draft.features.push({
          id:     foundry.utils.randomID(),
          name:   item.name,
          description: item.system.description || "",
        });
      }
    }

    this._draft = draft;
    // Open sections that have content
    this._sectionOpen.stats = true;
    this._sectionOpen.actions = draft.actions.length > 0;
    this._sectionOpen.features = draft.features.length > 0;
    this._sectionOpen.spellcasting = !!draft.spellcasting.ability;
    this._sectionOpen.description = !!draft.description;
  }

  async _onSave() {
    const d = this._draft;
    if (!d.name?.trim()) {
      ui.notifications.warn("Monster needs a name before it can be saved.");
      return;
    }

    const actorData = {
      name: d.name.trim(),
      type: "NPC",
      img: d.img || "icons/svg/mystery-man.svg",
      system: {
        alignment: d.alignment ?? "N",
        level:     Number(d.level ?? 1),
        notes:     d.description ?? "",
        // Stats — 1e-ii
        attributes: {
          hp: {
            value: Number(d.hp.value ?? 1),
            max:   Number(d.hp.max ?? 1),
          },
          ac: { value: Number(d.ac ?? 10), attribute: "" },
        },
        abilities: {
          str: { mod: Number(d.abilities.str ?? 0) },
          dex: { mod: Number(d.abilities.dex ?? 0) },
          con: { mod: Number(d.abilities.con ?? 0) },
          int: { mod: Number(d.abilities.int ?? 0) },
          wis: { mod: Number(d.abilities.wis ?? 0) },
          cha: { mod: Number(d.abilities.cha ?? 0) },
        },
        darkAdapted: !!d.darkAdapted,
        // Movement — 1e-ii
        move:     d.move || "near",
        moveNote: d.moveNote || "",
        // Spellcasting — 1e-ii
        // Schema is `system.spellcasting.{ability, bonus, attacks}`.
        // Writing the legacy `spellcastingAbility` / `spellAttackBonus`
        // fields would round-trip through NpcSD.migrateData() — clean
        // creates should use the new shape directly.
        spellcasting: {
          ability: d.spellcasting.ability || "",
          bonus:   Number(d.spellcasting.bonus ?? 0),
          attacks: Number(d.spellcasting.attacks ?? 0),
        },
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

      // ─── Create Action Items (1e-iii) ─────────────────────────────
      // Schema (NpcAttackSD.mjs):
      //   system.attack:   { num }                                — count only
      //   system.bonuses:  { attackBonus, damageBonus, critical } — sibling, NOT under attack
      //   system.damage:   { numDice, special, value }            — `special` is the rider text
      //   system.ranges:   array of CONFIG.SHADOWDARK.RANGES keys
      // We mirror `description` into `damage.special` for NPC Attack so the
      // action menu's stat-block renderer (which reads damage.special for
      // the "+ rider" inline display, slice 1a) shows it correctly. The
      // long-form copy stays in `system.description` for the item sheet.
      const itemData = d.actions.map(a => {
        const base = {
          name: a.name.trim() || "New Action",
          type: a.type,
          system: {
            description: a.description || "",
          },
        };
        if (a.type === "NPC Attack") {
          base.system.attack  = { num: Number(a.num ?? 1) };
          base.system.bonuses = { attackBonus: Number(a.bonus ?? 0) };
          base.system.damage  = {
            value:   a.damage || "1d6",
            special: a.description || "",
          };
          base.system.ranges  = Array.isArray(a.ranges) && a.ranges.length
            ? a.ranges
            : ["close"];
        } else if (a.type === "NPC Special Attack") {
          // NPC Special Attack shares the same schema shape; set
          // sensible defaults so the system's roll pipeline doesn't
          // hit missing fields if the user later edits the item.
          base.system.attack  = { num: Number(a.num ?? 1) };
          base.system.bonuses = { attackBonus: Number(a.bonus ?? 0) };
        }
        return base;
      });
      if (itemData.length) {
        await actor.createEmbeddedDocuments("Item", itemData);
      }

      // ─── Create Feature Items (1e-iv) ──────────────────────────────
      const featureData = d.features.map(f => ({
        name: f.name.trim() || "New Feature",
        type: "NPC Feature",
        system: {
          description: f.description || "",
        },
      }));
      if (featureData.length) {
        await actor.createEmbeddedDocuments("Item", featureData);
      }

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
