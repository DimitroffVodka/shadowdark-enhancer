/**
 * Shadowdark Enhancer — Monster Importer window (ApplicationV2).
 *
 * Paste a raw PDF monster-statblock dump (from the GM's own book) → deterministic
 * parse (statblock-parser.mjs) → a per-monster preview/edit grid where the GM is
 * the human-in-the-loop that fixes any low-confidence field → create NPC actors
 * into the managed world compendium (monster-importer.mjs), foldered by source.
 *
 * Ships ZERO book content. The GM supplies the text; created actors live only in
 * the GM's local world compendium. GM-only.
 *
 * Launch points: the Monster Creator's "Bulk Import…" button and
 * `game.shadowdarkEnhancer.monsters.openImporter()`.
 */
import { parseStatblocks } from "./statblock-parser.mjs";
import { MonsterImporter } from "./monster-importer.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Common source labels offered as datalist suggestions (free-text — GM may type any). */
const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];

/** Fallback move keys if the system enum isn't present (mirrors the Monster Creator). */
const FALLBACK_MOVES = { close: "", near: "", doubleNear: "", tripleNear: "", far: "", special: "", none: "" };

/**
 * Map a free-text parser warning to the draft field(s) it concerns, so the
 * preview grid can highlight the suspect input. Advisory only — the full warning
 * list is always shown on the card too.
 */
function warnFields(warnings) {
  const f = new Set();
  for (const w of warnings) {
    const s = String(w).toLowerCase();
    if (/\bac\b/.test(s)) f.add("ac");
    if (/\bhp\b/.test(s)) f.add("hp");
    if (/alignment/.test(s)) f.add("alignment");
    if (/\blevel\b/.test(s) || /\blv\b/.test(s)) f.add("level");
    if (/move/.test(s)) f.add("move");
    if (/abilit|s\/d\/c/.test(s)) f.add("abilities");
    if (/attack|\batk\b/.test(s)) f.add("attacks");
    if (/spell/.test(s)) f.add("spellcasting");
  }
  return f;
}

export class MonsterImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-monster-importer",
    window: { title: "Monster Importer", icon: "fas fa-dragon", resizable: true },
    position: { width: 860, height: 780 },
    actions: {
      mimportParse:         MonsterImporterApp.prototype._onParse,
      mimportClear:         MonsterImporterApp.prototype._onClear,
      mimportCreateAll:     MonsterImporterApp.prototype._onCreateAll,
      mimportBackfill:      MonsterImporterApp.prototype._onBackfill,
      mimportRemoveMonster: MonsterImporterApp.prototype._onRemoveMonster,
      mimportAddAttack:     MonsterImporterApp.prototype._onAddAttack,
      mimportAddSpecial:    MonsterImporterApp.prototype._onAddSpecial,
      mimportRemoveAttack:  MonsterImporterApp.prototype._onRemoveAttack,
      mimportAddFeature:    MonsterImporterApp.prototype._onAddFeature,
      mimportRemoveFeature: MonsterImporterApp.prototype._onRemoveFeature,
    },
  };

  static PARTS = { body: { template: "modules/shadowdark-enhancer/templates/monster-importer.hbs" } };

  _text = "";
  _source = "";
  _parsed = [];   // [{ draft, warnings }]
  _skipped = [];  // [{ name, reason }]
  _textFocused = false;
  _textCursor = 0;

  static _instance = null;
  static open() {
    if (!this._instance) this._instance = new MonsterImporterApp();
    const inst = this._instance;
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }
  async close(options = {}) {
    MonsterImporterApp._instance = null;
    return super.close(options);
  }

  async _prepareContext() {
    const moveOptions = Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? FALLBACK_MOVES);

    const monsters = this._parsed.map((p, i) => {
      const wf = warnFields(p.warnings ?? []);
      return {
        idx: i,
        draft: p.draft,
        warnings: p.warnings ?? [],
        hasWarnings: (p.warnings?.length ?? 0) > 0,
        warnCount: p.warnings?.length ?? 0,
        warn: {
          ac: wf.has("ac"), hp: wf.has("hp"), alignment: wf.has("alignment"),
          level: wf.has("level"), move: wf.has("move"), abilities: wf.has("abilities"),
          attacks: wf.has("attacks"), spellcasting: wf.has("spellcasting"),
        },
      };
    });

    return {
      text: this._text,
      source: this._source,
      sourceSuggestions: SOURCE_SUGGESTIONS,
      monsters,
      hasParsed: monsters.length > 0,
      total: monsters.length,
      skipped: this._skipped,
      skippedCount: this._skipped.length,
      alignments: ["L", "N", "C"],
      moveOptions,
      spellAbilities: [
        { value: "", label: "— none —" },
        { value: "int", label: "INT" },
        { value: "wis", label: "WIS" },
        { value: "cha", label: "CHA" },
      ],
      attackTypes: ["NPC Attack", "NPC Special Attack"],
      abilityKeys: [
        { key: "str", label: "STR" }, { key: "dex", label: "DEX" }, { key: "con", label: "CON" },
        { key: "int", label: "INT" }, { key: "wis", label: "WIS" }, { key: "cha", label: "CHA" },
      ],
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._wirePaste();
    this._wireSource();
    this._wireFieldEdits();
  }

  // ─── Input wiring ─────────────────────────────────────────────────

  /** Paste box: debounced stash + cursor preservation (parsing is explicit). */
  _wirePaste() {
    const ta = this.element.querySelector("textarea[data-mimport-text]");
    if (!ta) return;
    if (this._textFocused) {
      ta.focus();
      const pos = this._textCursor ?? ta.value.length;
      try { ta.setSelectionRange(pos, pos); } catch (_) {}
    }
    let t = null;
    ta.addEventListener("input", (ev) => {
      this._textFocused = true;
      this._textCursor = ev.target.selectionStart;
      clearTimeout(t);
      t = setTimeout(() => { this._text = ev.target.value; }, 200);
    });
    ta.addEventListener("blur", () => { this._textFocused = false; this._text = ta.value; });
  }

  /** Source label: a free-text input (folder + per-actor flag). Commit on input. */
  _wireSource() {
    const input = this.element.querySelector("input[data-mimport-source]");
    if (!input) return;
    input.addEventListener("input", (ev) => { this._source = ev.target.value; });
  }

  /**
   * Scalar/row field edits. Commit in place WITHOUT a re-render, so the GM can
   * tab through the whole grid without losing focus. Structural changes (add/
   * remove rows or monsters, parse, clear) are the only re-renders. Editing a
   * flagged field clears its own warning highlight.
   */
  _wireFieldEdits() {
    this.element.querySelectorAll("[data-mimport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const mEl = ev.target.closest("[data-monster-idx]");
        if (!mEl) return;
        const card = this._parsed[Number(mEl.dataset.monsterIdx)];
        if (!card) return;
        const draft = card.draft;
        const field = ev.target.dataset.mimportField;
        const aEl = ev.target.closest("[data-attack-idx]");
        const fEl = ev.target.closest("[data-feature-idx]");
        if (aEl) {
          const a = draft.actions[Number(aEl.dataset.attackIdx)];
          if (a) this._setAttackField(a, field, ev.target);
        } else if (fEl) {
          const ft = draft.features[Number(fEl.dataset.featureIdx)];
          if (ft) {
            if (field === "fName") ft.name = ev.target.value;
            else if (field === "fDesc") ft.description = ev.target.value;
          }
        } else {
          this._setDraftField(draft, field, ev.target);
        }
        ev.target.classList.remove("sde-mimport-warn");
      });
    });
  }

  _setDraftField(draft, field, el) {
    const v = el.value;
    switch (field) {
      case "name": draft.name = v; break;
      case "level": draft.level = Number(v); break;
      case "ac": draft.ac = Number(v); break;
      case "hpValue": draft.hp.value = Number(v); break;
      case "hpMax": draft.hp.max = Number(v); break;
      case "alignment": draft.alignment = v; break;
      case "move": draft.move = v; break;
      case "moveNote": draft.moveNote = v; break;
      case "str": case "dex": case "con": case "int": case "wis": case "cha":
        draft.abilities[field] = Number(v); break;
      case "scAbility": draft.spellcasting.ability = v; break;
      case "scBonus": draft.spellcasting.bonus = Number(v); break;
      case "scAttacks": draft.spellcasting.attacks = Number(v); break;
    }
  }

  _setAttackField(a, field, el) {
    const v = el.value;
    switch (field) {
      case "aNum": a.num = Number(v); break;
      case "aName": a.name = v; break;
      case "aType": a.type = v; break;
      case "aBonus": a.bonus = Number(v); break;
      case "aDamage": a.damage = v; break;
      case "aRanges": a.ranges = v.split(/[,/]/).map((s) => s.trim().toLowerCase()).filter(Boolean); break;
      case "aDesc": a.description = v; break;
    }
  }

  // ─── Action handlers ──────────────────────────────────────────────

  async _onParse() {
    const ta = this.element.querySelector("textarea[data-mimport-text]");
    if (ta) this._text = ta.value;
    const { drafts, skipped } = parseStatblocks(this._text);
    this._parsed = drafts;
    this._skipped = skipped;
    if (!drafts.length) ui.notifications.warn("No monsters found in the pasted text.");
    this.render();
  }

  _onClear() {
    this._text = "";
    this._parsed = [];
    this._skipped = [];
    this.render();
  }

  _onRemoveMonster(event, target) {
    const idx = Number(target.closest("[data-monster-idx]")?.dataset.monsterIdx);
    if (!Number.isFinite(idx)) return;
    this._parsed.splice(idx, 1);
    this.render();
  }

  _onAddAttack(event, target) {
    const draft = this._monsterDraft(target);
    if (!draft) return;
    draft.actions.push({ name: "New Attack", type: "NPC Attack", num: 1, bonus: 0, damage: "1d6", ranges: ["close"], description: "" });
    this.render();
  }

  _onAddSpecial(event, target) {
    const draft = this._monsterDraft(target);
    if (!draft) return;
    draft.actions.push({ name: "New Special", type: "NPC Special Attack", num: 1, bonus: 0, damage: "", ranges: [], description: "" });
    this.render();
  }

  _onRemoveAttack(event, target) {
    const draft = this._monsterDraft(target);
    const aIdx = Number(target.closest("[data-attack-idx]")?.dataset.attackIdx);
    if (!draft || !Number.isFinite(aIdx)) return;
    draft.actions.splice(aIdx, 1);
    this.render();
  }

  _onAddFeature(event, target) {
    const draft = this._monsterDraft(target);
    if (!draft) return;
    draft.features.push({ name: "New Feature", description: "" });
    this.render();
  }

  _onRemoveFeature(event, target) {
    const draft = this._monsterDraft(target);
    const fIdx = Number(target.closest("[data-feature-idx]")?.dataset.featureIdx);
    if (!draft || !Number.isFinite(fIdx)) return;
    draft.features.splice(fIdx, 1);
    this.render();
  }

  /** Resolve the monster draft for a clicked control via its [data-monster-idx] ancestor. */
  _monsterDraft(target) {
    const idx = Number(target.closest("[data-monster-idx]")?.dataset.monsterIdx);
    return this._parsed[idx]?.draft ?? null;
  }

  /** Per-name conflict dialog (skip / replace / rename), mirroring the table importer. */
  _conflictDialog() {
    return async (name) => {
      const safe = foundry.utils.escapeHTML(name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Monster Already Exists" },
        content: `<p>A monster named <strong>${safe}</strong> is already in the imported-monsters compendium. What would you like to do?</p>`,
        buttons: [
          { action: "rename",  label: "Import as Copy", default: true },
          { action: "replace", label: "Replace Existing" },
          { action: "skip",    label: "Skip" },
        ],
        rejectClose: false,
      }).catch(() => "skip");
      return choice ?? "skip";
    };
  }

  /**
   * Backfill existing imported NPCs to fresh-import fidelity.
   * Runs a dry-run preview first, shows the GM a confirm dialog with the per-actor
   * change summary, then commits on confirmation (dry-run-first, D2 human-in-the-loop).
   */
  async _onBackfill() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can run the monster backfill."); return; }
    const { backfillTargets } = await import("./monster-backfill.mjs");

    // ── Preview (dry run) ───────────────────────────────────────────────────
    ui.notifications.info("Scanning imported monsters for upgrades…");
    const preview = await backfillTargets({ scope: "pack", dryRun: true });
    if (!preview) return;

    if (preview.total === 0) {
      ui.notifications.info("No imported-monsters compendium found or it contains no NPC actors.");
      return;
    }

    if (preview.changed.length === 0) {
      ui.notifications.info(`All ${preview.total} actor(s) already at full fidelity — nothing to backfill.`);
      return;
    }

    // Build a human-readable summary of what would change.
    const t = preview.totals;
    const lines = [];
    if (t.descriptionsWrapped) lines.push(`${t.descriptionsWrapped} item description(s) will be HTML-wrapped`);
    if (t.namesCased)          lines.push(`${t.namesCased} attack name(s) will be Title-Cased`);
    if (t.iconsSet)            lines.push(`${t.iconsSet} item icon(s) will be set`);
    if (t.spellsConverted)     lines.push(`${t.spellsConverted} spell feature(s) will become real Spell items`);
    if (t.artAssigned)         lines.push(`${t.artAssigned} portrait/token image(s) will be resolved`);

    const actorList = preview.changed
      .map((r) => `<li>${foundry.utils.escapeHTML(r.actor)}</li>`)
      .join("");
    const content = `
      <p><strong>${preview.changed.length} of ${preview.total}</strong> actor(s) need upgrading:</p>
      <ul style="max-height:160px;overflow-y:auto;margin:.4em 0">${actorList}</ul>
      <p>${lines.join("; ")}.</p>
      <p>This is non-destructive and idempotent. Proceed?</p>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Backfill Imported Monsters" },
      content,
      buttons: [
        { action: "confirm", label: "Backfill", default: true },
        { action: "cancel",  label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");

    if (choice !== "confirm") return;

    // ── Commit ───────────────────────────────────────────────────────────────
    const result = await backfillTargets({ scope: "pack", dryRun: false });
    if (!result) return;

    const rt = result.totals;
    const parts = [];
    if (rt.descriptionsWrapped) parts.push(`${rt.descriptionsWrapped} desc wrapped`);
    if (rt.namesCased)          parts.push(`${rt.namesCased} names cased`);
    if (rt.iconsSet)            parts.push(`${rt.iconsSet} icons set`);
    if (rt.spellsConverted)     parts.push(`${rt.spellsConverted} spells converted`);
    if (rt.artAssigned)         parts.push(`${rt.artAssigned} art assigned`);
    ui.notifications.info(
      `Backfill complete: ${result.changed.length} actor(s) upgraded (${parts.join(", ") || "minor updates"}). ` +
      `${result.unchanged.length} already up to date.`
    );
  }

  async _onCreateAll() {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import monsters."); return; }
    if (!this._parsed.length) return;

    const source = (this._source || "").trim();
    const drafts = this._parsed.map((p) => p.draft);
    const result = await MonsterImporter.createMonsters(drafts, { source, onConflict: this._conflictDialog() });
    if (!result) return;

    const parts = [`${result.created.length} created`];
    if (result.replaced.length) parts.push(`${result.replaced.length} replaced`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    ui.notifications.info(`Monsters: ${parts.join(", ")} → ${MonsterImporter.PACK_LABEL}${source ? ` / ${source}` : ""}.`);

    // The batch is done — clear the preview (paste stays for reference). A
    // newly-created monster is linkable immediately (MonsterImporter invalidated
    // the linker cache).
    this._parsed = [];
    this._skipped = [];
    this.render();
  }
}

/** Public API surface (wired onto game.shadowdarkEnhancer.monsters). */
export const MonsterImporterAPI = {
  /** Open the Monster Importer window. */
  openImporter: () => MonsterImporterApp.open(),
  /**
   * Headless import: parse a raw dump and create the monsters directly (no UI).
   * For power users / other modules. GM-only (enforced in createMonsters).
   * @returns {Promise<object|null>} the createMonsters tally, or null if blocked.
   */
  importDump: (text, source = "") => {
    const { drafts } = parseStatblocks(text);
    return MonsterImporter.createMonsters(drafts.map((d) => d.draft), { source });
  },
  /**
   * Headless backfill: upgrade existing imported NPC actors to fresh-import
   * fidelity. Accepts the same options as backfillTargets (scope, dryRun, etc.).
   * GM-only (enforced in backfillTargets). Example:
   *   await game.shadowdarkEnhancer.monsters.backfill({ scope: "pack" })
   *   await game.shadowdarkEnhancer.monsters.backfill({ scope: "selection", actorUuids: [...], dryRun: true })
   * @returns {Promise<object|null>} the backfillTargets result, or null if blocked.
   */
  backfill: (opts = {}) => import("./monster-backfill.mjs").then((m) => m.backfillTargets(opts)),
};
