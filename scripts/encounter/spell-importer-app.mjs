/**
 * Shadowdark Enhancer — Spell Importer (ApplicationV2).
 *
 * A purpose-built workspace for importing spells organized by the three axes
 * that actually matter in Shadowdark: CLASS (who casts it), TIER, and ALIGNMENT
 * (the WR/CS priest/wizard alignment-restricted lists — e.g. "druid" = Wizard
 * spells tagged Neutral). Paste a spell block, set the class + alignment those
 * spells belong to (bulk, with per-spell overrides), review them grouped by
 * Class → Tier → Alignment, then import — tagging each spell's `system.class`,
 * `system.tier`, and `flags["shadowdark-extras"].alignment` so the char-builder's
 * spell picker offers the right spells to the right caster and alignment.
 *
 * Reuses the pure spell parser (spellRecognizer/parseSpell) and the Foundry-bound
 * importer (ItemImporter.createItems → world.spells, Spells → Class → Tier →
 * Alignment folders, alignment flag written by buildItemData). This app is only
 * the workspace UI + state.
 */
import { spellRecognizer } from "./spell-parser.mjs";
import { SPELL_LISTS, CHAR_SOURCES } from "./char-content-manifest.mjs";
import { sourcePdfHref } from "./source-pdf-registry.mjs";
import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];
const ALIGNMENTS = [
  { value: "", label: "Universal (any alignment)" },
  { value: "lawful", label: "Lawful" },
  { value: "neutral", label: "Neutral" },
  { value: "chaotic", label: "Chaotic" },
];
const _strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const _titleCase = (s) => String(s ?? "").replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export class SpellImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-spell-importer",
    window: { title: "Spell Importer", icon: "fa-solid fa-wand-sparkles", resizable: true },
    position: { width: 760, height: 820 },
    actions: {
      siParse:     SpellImporterApp.prototype._onParse,
      siApplyBulk: SpellImporterApp.prototype._onApplyBulk,
      siImport:    SpellImporterApp.prototype._onImport,
      siRemove:    SpellImporterApp.prototype._onRemove,
      siStartOver: SpellImporterApp.prototype._onStartOver,
      siOpenPdf:   SpellImporterApp.prototype._onOpenPdf,
    },
  };
  static PARTS = { body: { template: "modules/shadowdark-enhancer/templates/spell-importer.hbs", scrollable: [""] } };

  // ── State ──────────────────────────────────────────────────────────────────
  _source = "Western Reaches";
  _pasteText = "";
  _listKey = "";               // selected preset spell list (SPELL_LISTS[].key), or ""
  _bulkClass = "Wizard";       // the class these spells belong to (name → resolved to uuid)
  _bulkAlignment = "";         // "" = universal; else lawful/neutral/chaotic
  _spells = [];                // parsed drafts + {className, alignment} (editable)
  _imported = null;            // green-check summary
  _pasteFocused = false; _pasteCursor = 0;

  // ── Singleton ──────────────────────────────────────────────────────────────
  static _instance = null;
  static open() {
    if (!this._instance) this._instance = new SpellImporterApp();
    const inst = this._instance;
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }
  async close(options = {}) { SpellImporterApp._instance = null; return super.close(options); }

  // ── Context ────────────────────────────────────────────────────────────────
  async _prepareContext() {
    // Group the parsed spells by Class → Tier → Alignment for the "broken up" view.
    const groups = new Map();
    this._spells.forEach((s, idx) => {
      const cls = (s.className || "").trim() || "(unclassed)";
      const al = s.alignment || "";
      const key = `${cls.toLowerCase()}||${s.tier}||${al}`;
      if (!groups.has(key)) groups.set(key, {
        class: _titleCase(cls), tier: s.tier,
        alignmentLabel: (ALIGNMENTS.find((a) => a.value === al) ?? ALIGNMENTS[0]).label,
        spells: [],
      });
      groups.get(key).spells.push({
        idx, name: s.name, tier: s.tier, className: s.className ?? "", alignment: s.alignment ?? "",
        desc: _strip(s.description).slice(0, 90),
        alignOptions: ALIGNMENTS.map((a) => ({ ...a, selected: (s.alignment || "") === a.value })),
        warn: (s.warnings?.length ?? 0) > 0,
      });
    });
    const groupList = [...groups.values()].sort((a, b) =>
      a.class.localeCompare(b.class) || Number(a.tier) - Number(b.tier) || a.alignmentLabel.localeCompare(b.alignmentLabel));

    // Preset spell-list picker (Druid/Sorcerer/Mage → Wizard+alignment, WR Priest
    // by alignment, Necromancer): sets class+alignment+source and a source-PDF link.
    const list = this._selectedList();
    const listPdf = list ? sourcePdfHref(list.source, list.page) : null;

    return {
      source: this._source,
      sourceList: SOURCE_SUGGESTIONS,
      spellLists: SPELL_LISTS.map((l) => ({ key: l.key, label: l.label, selected: this._listKey === l.key })),
      listPdf, listPage: list?.page ?? null, listLabel: list?.label ?? null,
      pasteText: this._pasteText,
      bulkClass: this._bulkClass,
      bulkAlignOptions: ALIGNMENTS.map((a) => ({ ...a, selected: this._bulkAlignment === a.value })),
      spellCount: this._spells.length,
      groups: groupList,
      summary: this._summary(),
      imported: this._imported,
    };
  }

  /** The selected preset spell list, or null. */
  _selectedList() {
    return SPELL_LISTS.find((l) => l.key === this._listKey) ?? null;
  }

  _summary() {
    if (!this._spells.length) return null;
    const classes = [...new Set(this._spells.map((s) => (s.className || "").trim()).filter(Boolean))];
    const tiers = [...new Set(this._spells.map((s) => Number(s.tier)).filter(Boolean))].sort((a, b) => a - b);
    const aligns = [...new Set(this._spells.map((s) => s.alignment || "universal"))];
    return `${this._spells.length} spell${this._spells.length === 1 ? "" : "s"} · ${classes.map(_titleCase).join(", ") || "unclassed"} · tier${tiers.length > 1 ? "s" : ""} ${tiers.join(", ") || "?"} · ${aligns.map((a) => a === "universal" ? "universal" : _titleCase(a)).join(", ")}`;
  }

  // ── Render wiring ──────────────────────────────────────────────────────────
  _onRender() {
    const el = this.element;
    const src = el.querySelector("input[data-si-source]");
    if (src) src.addEventListener("input", (ev) => { this._source = ev.target.value; });

    const paste = el.querySelector("textarea[data-si-paste]");
    if (paste) {
      if (this._pasteFocused) { paste.focus(); try { paste.setSelectionRange(this._pasteCursor, this._pasteCursor); } catch (_e) {} }
      paste.addEventListener("input", (ev) => { this._pasteText = ev.target.value; this._pasteCursor = ev.target.selectionStart ?? 0; });
      paste.addEventListener("focus", () => { this._pasteFocused = true; });
      paste.addEventListener("blur", () => { this._pasteFocused = false; });
    }

    // Preset spell-list picker — applies class + alignment + source in one go and
    // opens the source PDF at the list's page (one-click flow like the other importers).
    const listSel = el.querySelector("select[data-si-list]");
    if (listSel) listSel.addEventListener("change", (ev) => this._onSelectList(ev.target.value));

    const bulkCls = el.querySelector("input[data-si-bulkclass]");
    if (bulkCls) bulkCls.addEventListener("input", (ev) => { this._bulkClass = ev.target.value; });
    const bulkAl = el.querySelector("select[data-si-bulkalign]");
    if (bulkAl) bulkAl.addEventListener("change", (ev) => { this._bulkAlignment = ev.target.value; });

    // Per-spell field edits (tier / class / alignment) — mutate the draft, re-render
    // so the Class → Tier → Alignment grouping updates.
    el.querySelectorAll("[data-si-spell] [data-si-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const s = this._spells[Number(ev.target.closest("[data-si-spell]")?.dataset.siSpell)];
        if (!s) return;
        const f = ev.target.dataset.siField;
        const v = ev.target.value;
        if (f === "tier") { const n = Number(v); s.tier = Number.isFinite(n) && n > 0 ? n : s.tier; }
        else if (f === "class") s.className = v.trim();
        else if (f === "alignment") s.alignment = v;
        this.render();
      });
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  _onParse() {
    const { claimed } = spellRecognizer.claim(this._pasteText);
    const results = spellRecognizer.parse(claimed);
    if (!results.length) {
      ui.notifications?.warn("No spells found — each spell needs a name line, a 'Tier N' line, and a Range/Duration line.");
      return;
    }
    // Default each spell's class + alignment from the bulk bar (editable per-spell).
    this._spells = results.map((r) => ({
      ...r.draft,
      className: (this._bulkClass.trim() || r.draft.className || ""),
      alignment: this._bulkAlignment || "",
      warnings: r.warnings ?? [],
    }));
    this._imported = null;
    this.render();
  }

  /** Choosing a preset list presets class + alignment + source, applies them to
   *  any already-parsed spells, and opens the source PDF at the list's page. */
  _onSelectList(key) {
    this._listKey = key;
    const list = this._selectedList();
    if (list) {
      this._bulkClass = list.casterClass;
      this._bulkAlignment = list.alignment || "";
      this._source = CHAR_SOURCES[list.source]?.label ?? this._source;
      if (this._spells.length) this._onApplyBulk();   // re-tag anything already parsed
      const href = sourcePdfHref(list.source, list.page);
      if (href) this._showPdf(href, `${list.label}${list.page ? ` — p.${list.page}` : ""}`);
    }
    this.render();
  }

  /** Open the source PDF for the selected list (button re-open). */
  _onOpenPdf() {
    const list = this._selectedList();
    if (!list) return;
    const href = sourcePdfHref(list.source, list.page);
    if (href) this._showPdf(href, `${list.label}${list.page ? ` — p.${list.page}` : ""}`);
    else ui.notifications?.warn(`No uploaded PDF for ${CHAR_SOURCES[list.source]?.label ?? list.source} — add it in the hub's Source PDFs manager.`);
  }

  async _showPdf(href, title) {
    const { SourcePdfViewer } = await import("./source-pdf-viewer.mjs");
    SourcePdfViewer.show(href, title);
  }

  /** Re-apply the bulk Class + Alignment to every parsed spell. */
  _onApplyBulk() {
    for (const s of this._spells) {
      if (this._bulkClass.trim()) s.className = this._bulkClass.trim();
      s.alignment = this._bulkAlignment || "";
    }
    this.render();
  }

  _onRemove(event, target) {
    const idx = Number(target.closest("[data-si-spell]")?.dataset.siSpell);
    if (idx >= 0) { this._spells.splice(idx, 1); this.render(); }
  }

  async _onImport() {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import spells."); return; }
    if (!this._spells.length) { ui.notifications?.warn("Parse some spells first."); return; }
    const { ItemImporter } = await import("./item-importer.mjs");
    const { resolveSpellClass, ClassIndex } = await import("./class-index.mjs");
    ClassIndex.invalidate();   // a class imported this session (e.g. Necromancer) must resolve
    const source = this._source.trim();
    const sourceTitle = _sourceTitle(source);

    // Build clean drafts for the importer: reset class (resolveSpellClass fills it
    // from className), carry alignment (buildItemData writes the flag) + source.
    const drafts = this._spells.map((s) => ({
      ...s, class: [], source: { title: sourceTitle }, alignment: s.alignment || "",
    }));
    const unresolved = [];
    for (const d of drafts) { const w = await resolveSpellClass(d); if (w) unresolved.push(d.name); }

    const result = await ItemImporter.createItems(drafts, { source, onConflict: () => "skip" });
    if (!result) return;

    this._imported = {
      created: result.created.length,
      skipped: result.skipped.length,
      classes: [...new Set(this._spells.map((s) => _titleCase((s.className || "").trim())).filter(Boolean))].join(", "),
      alignments: [...new Set(this._spells.map((s) => s.alignment || "universal"))].map((a) => a === "universal" ? "universal" : _titleCase(a)).join(", "),
    };
    const parts = [`${result.created.length} created`];
    if (result.skipped.length) parts.push(`${result.skipped.length} already existed`);
    if (unresolved.length) parts.push(`${unresolved.length} without a class link`);
    ui.notifications?.info(`Spells: ${parts.join(", ")} → world.spells.`);
    if (unresolved.length) console.warn(`${MODULE_ID} | Spell Importer — no class link for: ${unresolved.join(", ")}`);
    // Tell any open Character Builder / Importer Hub to drop caches + re-render so
    // the newly-imported spells flip from gap→have without a close/reopen.
    if (result.created.length) Hooks.callAll(`${MODULE_ID}.contentUnlocked`);
    this.render();
  }

  /** Clear the parsed batch + summary (no render). Shared by "Start over" and the
   *  hub's per-unlock seed path, so a second Unlock never imports a stale batch
   *  under the newly selected source. (review 2026-07-12 #2) */
  _reset() {
    this._pasteText = ""; this._spells = []; this._imported = null; this._listKey = "";
  }
  _onStartOver() {
    this._reset();
    this.render();
  }
}

/** Free-text source label → char-builder source slug (mirrors the other importers). */
function _sourceTitle(source) {
  return ({
    "cursed scroll 4": "cursed-scroll-4", "cursed scroll 5": "cursed-scroll-5", "cursed scroll 6": "cursed-scroll-6",
    "cs4": "cursed-scroll-4", "cs5": "cursed-scroll-5", "cs6": "cursed-scroll-6",
    "western reaches": "western-reaches",
  })[String(source).toLowerCase()] ?? String(source).toLowerCase().replace(/\s+/g, "-");
}
