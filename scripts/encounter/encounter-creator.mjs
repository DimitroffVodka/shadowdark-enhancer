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
      creatorAddAction: MonsterCreatorApp.prototype._onAddAction,
      creatorAddSpecial: MonsterCreatorApp.prototype._onAddSpecial,
      creatorRemoveAction: MonsterCreatorApp.prototype._onRemoveAction,
      creatorAddQuickPick: MonsterCreatorApp.prototype._onAddQuickPick,
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
      identity:     true,
      stats:        false,
      movement:     false,
      actions:      false,
      spellcasting: false,
      description:  false,
      // features — added in later sub-slices
    };
    // Text-input focus stashes for cursor preservation across renders.
    this._focused = {};  // { fieldName: {selectionStart} }
    this._lastFocusedField = null;
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
    const input = this.element?.querySelector(`[data-draft-field="${CSS.escape(lastField)}"]`);
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
