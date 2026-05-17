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
