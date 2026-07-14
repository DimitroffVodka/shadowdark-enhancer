/**
 * Shadowdark Enhancer — Item Builder (ApplicationV2).
 *
 * The items analogue of the Class Builder: a guided, multi-stage workspace that
 * turns a book's equipment section into FINISHED items — not cost-only stubs.
 * The book splits an item across two sections (a price TABLE and a separate
 * two-column DESCRIPTIONS block), so this app builds them in three steps and
 * combines them:
 *
 *   ① Table        — paste/grab the price table → one row per item with its
 *                    cost + slots (reviewable/editable).
 *   ② Descriptions — paste/grab the descriptions section → matched to the ①
 *                    rows BY NAME, filling each item's description (editable;
 *                    the two-column source is imperfect, so hand-fixing is a
 *                    first-class step, not a failure).
 *   ③ Combine      — create the items in sde-items with cost, slots, AND
 *                    description together.
 *
 * Reuses the pure parsers (itemRecognizer force-parse for the table,
 * splitDescriptionsByNames for the descriptions) and the Foundry-bound importer
 * (ItemImporter.createItems) — this app is only the workspace UI + state.
 */
import { itemRecognizer, splitDescriptionsByNames } from "./item-parser.mjs";
import { ItemImporter } from "./item-importer.mjs";
import { sourcePdfTarget, sourcePdfHref } from "./source-pdf-registry.mjs";
import { CHAR_SOURCES } from "./char-content-manifest.mjs";
import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Source labels offered as datalist suggestions (mirrors the hub/class builder). */
const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];

/** Gear types this builder handles, with a friendly label. */
const GEAR_TYPES = [
  { value: "Basic",  label: "Basic Gear" },
  { value: "Weapon", label: "Weapons" },
  { value: "Armor",  label: "Armor" },
];

/**
 * Per-source, per-type page cites: the TABLE page range (single-column, rows
 * "Name cost qty slot") and the DESCRIPTIONS page range (two-column "Name.
 * text"). Only what's verified is listed; anything absent falls back to a manual
 * paste (the Grab buttons just hide). Western Reaches Basic Gear verified live:
 * table 106-107, descriptions 107-109 (107 mixes the table + first descriptions
 * so those come out partial — hand-fixable in stage ②).
 */
const GEAR_PAGES = {
  WR: {
    Basic:  { table: "106-107", desc: "107-109" },
    Weapon: { table: "110-111", desc: "111-113" },
    Armor:  { table: "112",     desc: "112-113" },
  },
};

const _strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const _norm  = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export class ItemBuilderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-item-builder",
    window: { title: "Item Builder", icon: "fa-solid fa-boxes-stacked", resizable: true },
    position: { width: 760, height: 820 },
    actions: {
      ibGrabTable:  ItemBuilderApp.prototype._onGrabTable,
      ibParseTable: ItemBuilderApp.prototype._onParseTable,
      ibGrabDesc:   ItemBuilderApp.prototype._onGrabDesc,
      ibMatchDesc:  ItemBuilderApp.prototype._onMatchDesc,
      ibOpenPdf:    ItemBuilderApp.prototype._onOpenPdf,
      ibRowDel:     ItemBuilderApp.prototype._onRowDel,
      ibCreate:     ItemBuilderApp.prototype._onCreate,
      ibStartOver:  ItemBuilderApp.prototype._onStartOver,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/item-builder.hbs", scrollable: [""] },
  };

  // ── State ──────────────────────────────────────────────────────────────────
  _source = "Western Reaches";
  _gearType = "Basic";
  _tableText = "";
  _descText = "";
  // Working set — the combined items. Each: { name, cost:{gp,sp,cp},
  // slots:{free_carry,per_slot,slots_used}, description }.
  _items = [];
  _lastReport = null;
  // Paste-box focus preservation.
  _focused = null;

  // ── Singleton ──────────────────────────────────────────────────────────────
  static _instance = null;
  static open() {
    if (!this._instance) this._instance = new ItemBuilderApp();
    const inst = this._instance;
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }
  async close(options = {}) {
    ItemBuilderApp._instance = null;
    return super.close(options);
  }

  _reset() {
    this._tableText = ""; this._descText = ""; this._items = [];
    this._lastReport = null; this._focused = null;
  }
  _onStartOver() { this._reset(); this.render(); }

  // ── Source / page helpers ────────────────────────────────────────────────────
  /** Map the free-text source to a CHAR_SOURCES key (WR / CS4 …), or null. */
  _sourceKey() {
    const s = this._source.trim().toLowerCase();
    if (!s) return null;
    for (const [key, meta] of Object.entries(CHAR_SOURCES))
      if (key.toLowerCase() === s || meta.label?.toLowerCase() === s || meta.book?.toLowerCase() === s) return key;
    return null;
  }
  _pages() {
    const key = this._sourceKey();
    return (key && GEAR_PAGES[key]?.[this._gearType]) || null;
  }

  // ── Context ────────────────────────────────────────────────────────────────
  async _prepareContext() {
    const pages = this._pages();
    const key = this._sourceKey();
    const withDesc = this._items.filter((i) => _strip(i.description).length > 0).length;
    // Source-PDF deep links — so the GM can open the book to the exact page and
    // drag-select the descriptions the two-column auto-grab couldn't recover.
    const firstPage = (spec) => String(spec ?? "").split(/[-,\s]/).filter(Boolean)[0];
    return {
      source: this._source,
      sourceList: SOURCE_SUGGESTIONS,
      gearType: this._gearType,
      gearTypes: GEAR_TYPES.map((g) => ({ ...g, selected: g.value === this._gearType })),
      typeLabel: GEAR_TYPES.find((g) => g.value === this._gearType)?.label ?? "Items",
      tableText: this._tableText,
      descText: this._descText,
      tablePage: pages?.table ?? null,
      descPage: pages?.desc ?? null,
      tablePdf: (key && pages?.table) ? sourcePdfHref(key, firstPage(pages.table)) : null,
      descPdf:  (key && pages?.desc)  ? sourcePdfHref(key, firstPage(pages.desc))  : null,
      items: this._items.map((it, i) => ({
        idx: i,
        name: it.name,
        cost: this._costLabel(it.cost),
        slots: it.slots?.slots_used ?? 1,
        description: _strip(it.description),
        hasDesc: _strip(it.description).length > 0,
      })),
      itemCount: this._items.length,
      withDesc,
      needDesc: this._items.length - withDesc,
      report: this._lastReport,
    };
  }

  _costLabel(cost) {
    const parts = [];
    if (cost?.gp) parts.push(`${cost.gp} gp`);
    if (cost?.sp) parts.push(`${cost.sp} sp`);
    if (cost?.cp) parts.push(`${cost.cp} cp`);
    return parts.join(" ") || "0 gp";
  }

  // ── Render wiring ────────────────────────────────────────────────────────────
  _onRender() {
    const el = this.element;
    const bind = (sel, set, key) => {
      const node = el.querySelector(sel);
      if (!node) return;
      if (this._focused === key) node.focus();
      node.addEventListener("input", (ev) => { set(ev.target.value); });
      node.addEventListener("focus", () => { this._focused = key; });
      node.addEventListener("blur", () => { if (this._focused === key) this._focused = null; });
    };
    bind("input[data-ib-source]", (v) => { this._source = v; }, "source");
    bind("textarea[data-ib-table]", (v) => { this._tableText = v; }, "table");
    bind("textarea[data-ib-desc]", (v) => { this._descText = v; }, "desc");

    const typeSel = el.querySelector("select[data-ib-type]");
    if (typeSel) typeSel.addEventListener("change", (ev) => { this._gearType = ev.target.value; this.render(); });

    // Per-item editable fields (name / cost / description). No re-render on edit
    // (preserve cursor) — structural changes (delete) re-render.
    el.querySelectorAll("[data-ib-row]").forEach((row) => {
      const it = this._items[Number(row.dataset.ibRow)];
      if (!it) return;
      row.querySelectorAll("[data-ib-field]").forEach((input) => {
        input.addEventListener("change", (ev) => {
          const f = ev.target.dataset.ibField, v = ev.target.value;
          if (f === "name") it.name = v.trim() || it.name;
          else if (f === "cost") it.cost = _parseCost(v);
          else if (f === "description") it.description = v.trim() ? `<p>${_escape(v.trim())}</p>` : "";
        });
      });
    });
  }

  // ── Stage ① · Table ──────────────────────────────────────────────────────────
  async _onGrabTable() {
    const key = this._sourceKey();
    const pages = this._pages();
    const target = (key && pages?.table) ? sourcePdfTarget(key, pages.table) : null;
    if (!target) { ui.notifications?.warn("No source PDF / table page for this source + type — paste the table below."); return; }
    const text = await this._grab(key, target.file, pages.table, "1");   // table is single-column
    if (text == null) return;
    this._tableText = this._append(this._tableText, text);
    this.render();
    this._onParseTable();   // one press: grab + parse
  }

  _onParseTable() {
    const { claimed } = itemRecognizer.claim(this._tableText, { force: true });
    const drafts = itemRecognizer.parse(claimed, { force: true }).map((r) => r.draft);
    if (!drafts.length) { ui.notifications?.warn("No priced item rows found — is this the price table (Name cost qty slot)?"); return; }
    // Merge into the working set: new names add a row (name+cost+slots),
    // existing names refresh cost/slots but KEEP any description already matched.
    for (const d of drafts) {
      const existing = this._items.find((it) => _norm(it.name) === _norm(d.name));
      if (existing) { existing.cost = d.cost; existing.slots = d.slots; }
      else this._items.push({ name: d.name, cost: d.cost, slots: d.slots, description: "" });
    }
    ui.notifications?.info(`Table parsed — ${this._items.length} item(s). Now add descriptions in step 2.`);
    this.render();
  }

  // ── Stage ② · Descriptions ────────────────────────────────────────────────────
  async _onGrabDesc() {
    const key = this._sourceKey();
    const pages = this._pages();
    const target = (key && pages?.desc) ? sourcePdfTarget(key, pages.desc) : null;
    if (!target) { ui.notifications?.warn("No description page for this source + type — paste the descriptions below."); return; }
    const text = await this._grab(key, target.file, pages.desc, "2");   // descriptions are two-column
    if (text == null) return;
    this._descText = this._append(this._descText, text);
    this.render();
    this._onMatchDesc();   // one press: grab + match
  }

  _onMatchDesc() {
    if (!this._items.length) { ui.notifications?.warn("Parse the table first (step 1) — descriptions match to those items by name."); return; }
    const entries = splitDescriptionsByNames(this._descText, this._items.map((it) => it.name));
    let matched = 0;
    for (const e of entries) {
      const it = this._items.find((x) => _norm(x.name) === _norm(e.name));
      if (!it) continue;
      it.description = `<p>${_escape(e.description)}</p>`;
      matched++;
    }
    const missing = this._items.length - this._items.filter((i) => _strip(i.description)).length;
    ui.notifications?.info(`Matched ${matched} description(s).${missing ? ` ${missing} still need one — edit them below.` : ""}`);
    this.render();
  }

  _onRowDel(event, target) {
    const i = Number(target.closest("[data-ib-row]")?.dataset.ibRow);
    if (i >= 0) { this._items.splice(i, 1); this.render(); }
  }

  /** Open the source PDF at a page in Foundry's viewer, so the GM can read /
   *  drag-select the descriptions the two-column auto-grab missed. */
  async _onOpenPdf(event, target) {
    const href = target?.dataset?.href;
    if (!href) return;
    const { SourcePdfViewer } = await import("./source-pdf-viewer.mjs");
    SourcePdfViewer.show(href, target.dataset.title || "Source PDF");
  }

  // ── Stage ③ · Combine & create ────────────────────────────────────────────────
  async _onCreate() {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can create items."); return; }
    if (!this._items.length) { ui.notifications?.warn("Nothing to create — parse the table first."); return; }
    const source = this._source.trim();
    const drafts = this._items.map((it) => ({
      name: it.name,
      type: this._gearType,
      cost: { gp: it.cost?.gp ?? 0, sp: it.cost?.sp ?? 0, cp: it.cost?.cp ?? 0 },
      slots: { free_carry: it.slots?.free_carry ?? 0, per_slot: it.slots?.per_slot ?? 1, slots_used: it.slots?.slots_used ?? 1 },
      description: _strip(it.description) ? it.description : "<p></p>",
      riders: { benefit: [], bonus: "", curse: "", personality: "" },
    }));
    const result = await ItemImporter.createItems(drafts, { source, onConflict: () => "replace" });
    if (!result) return;
    this._lastReport = { created: result.created.length, replaced: (result.replaced ?? []).length, skipped: (result.skipped ?? []).length };
    Hooks.callAll(`${MODULE_ID}.contentUnlocked`);
    ui.notifications?.info(`Created ${this._lastReport.created}${this._lastReport.replaced ? `, updated ${this._lastReport.replaced}` : ""} ${GEAR_TYPES.find((g) => g.value === this._gearType)?.label ?? "item"}(s) in your items compendium.`);
    this.render();
  }

  // ── Shared helpers ────────────────────────────────────────────────────────────
  /** Pull the printed page range `spec` from `file` in `columns` mode, mapping
   *  each printed page through the registry's per-source offset. Text or null. */
  async _grab(srcKey, file, spec, columns) {
    const { extractPdfText, parsePageRange } = await import("./pdf-text-extract.mjs");
    const pdfPages = parsePageRange(spec)
      .map((p) => sourcePdfTarget(srcKey, String(p))?.page)
      .filter((p) => p != null);
    if (!pdfPages.length) { ui.notifications?.warn("Couldn't resolve those pages in the source PDF."); return null; }
    try {
      const { text } = await extractPdfText(file, { pages: pdfPages, columns });
      if (!text) { ui.notifications?.warn("That page has no selectable text."); return null; }
      return text;
    } catch (err) {
      console.error(`${MODULE_ID} | Item Builder — PDF grab failed`, err);
      ui.notifications?.error("Couldn't read text from that PDF page — see the console.");
      return null;
    }
  }
  _append(base, text) {
    const b = (base || "").replace(/\s*$/, "");
    return b ? `${b}\n${text}\n` : `${text}\n`;
  }
}

// ── Module-free helpers ───────────────────────────────────────────────────────

const _escape = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Parse a freeform cost string ("5 sp", "1 gp 5 sp") into {gp,sp,cp}. */
function _parseCost(str) {
  const cost = { gp: 0, sp: 0, cp: 0 };
  for (const m of String(str ?? "").matchAll(/(\d+)\s*(gp|sp|cp)\b/gi)) cost[m[2].toLowerCase()] += Number(m[1]);
  return cost;
}
