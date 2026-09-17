/**
 * Shadowdark Enhancer — Hex Tagger (Foundry AppV2).
 *
 * A contact sheet over the active hex scene's background image: 40 cells at a
 * time, a terrain select and river/path/coast boxes per cell. Answers live on
 * the scene flag `hexTags` (tag-store.mjs), one write per sheet. Numbering
 * comes from ONE anchor cell whose printed number the GM reads off its
 * thumbnail (geometry.mjs), so the map's own column shift never has to match
 * the scene's grid parity. "Build dataset" folds the tags into the Extras
 * dataset, on top of a filed crawl entry when one is chosen, and hands it over
 * or downloads it (hex-handoff.mjs). Phase 2 of docs/plans/hex-map-dataset.md.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { sceneCells, sourceImage, CellSampler } from "./sampler.mjs";
import { cellNumber } from "./geometry.mjs";
import { decodeTags, encodeTags, nextSheet, applySheet, tagsForDataset, summarize, OVERLAYS } from "./tag-store.mjs";
import { TERRAIN_TAGS } from "../importer/hex/hex-summary.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { datasetFromEntry, handoffDataset, extrasHexApi } from "../importer/hex/hex-handoff.mjs";
import { buildHexDataset, validateHexDataset, hexNum } from "../importer/hex/hex-dataset.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Scene flag key holding the tag store. */
export const TAGS_FLAG = "hexTags";
export const SHEET_SIZE = 40;

export class HexTaggerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-hex-tagger",
    classes: ["shadowdark", "sde-hex-tagger"],
    window: { title: "Hex Tagger", icon: "fa-solid fa-map-location-dot", resizable: true },
    position: { width: 1000, height: 780 },
    actions: {
      hxtSample:       function (...a) { return this._onSample(...a); },
      hxtNextSheet:    function (...a) { return this._onNextSheet(...a); },
      hxtApplySheet:   function (...a) { return this._onApplySheet(...a); },
      hxtSetNumber:    function (...a) { return this._onSetNumber(...a); },
      hxtSetBounds:    function (...a) { return this._onSetBounds(...a); },
      hxtBuildDataset: function (...a) { return this._onBuildDataset(...a); },
      hxtClearTags:    function (...a) { return this._onClearTags(...a); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/hex-tagger.hbs`, scrollable: [".sde-hxt-sheet"] },
  };

  /** GM-only entry point (also game.shadowdarkEnhancer.hexMaps.openTagger). */
  static open() {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can tag hex maps."); return null; }
    const app = new HexTaggerApp();
    app.render(true);
    return app;
  }

  _geom = null;
  _sampler = null;
  _cells = [];
  /** @type {Map<number, object>} published number → cell */
  _numbered = new Map();
  _state = null;
  _sheet = [];
  _mode = "random";
  _entryUuid = "";
  _entries = [];
  _error = "";

  _scene() { return canvas?.scene ?? null; }

  _loadState() { this._state = decodeTags(this._scene()?.getFlag(MODULE_ID, TAGS_FLAG)); }

  /**
   * Replace the stored flag wholesale. setFlag would MERGE the object, so a
   * cell cleared in the app (or a dropped bounds block) would survive in the
   * database — found on the 2026-09-17 live check. `recursive: false` makes
   * the update overwrite the `hexTags` object instead of merging into it.
   */
  async _saveState() {
    await this._scene()?.update({ [`flags.${MODULE_ID}.${TAGS_FLAG}`]: encodeTags(this._state) }, { recursive: false });
  }

  _originForGeometry() {
    const o = this._state?.origin;
    return o ? { cube: { q: o.q, r: o.r }, num: o.num, shifted: o.shifted ?? "odd", bounds: o.bounds } : null;
  }

  _renumber() {
    this._numbered = new Map();
    const origin = this._originForGeometry();
    for (const c of this._cells) {
      if (!origin) { c.num = null; continue; }
      const n = cellNumber(c.cube, origin);
      c.num = n.num; c.col = n.col; c.row = n.row;
      if (n.num !== null) this._numbered.set(n.num, c);
    }
  }

  /** Crawl entries filed by the hex-key importer, for the keyed sheet and the dataset base. */
  async _loadEntries() {
    const pack = findSuitePack("journal");
    if (!pack) { this._entries = []; return; }
    const docs = await pack.getDocuments();
    this._entries = docs.filter((d) => d.getFlag(MODULE_ID, HEX_FLAG)?.crawl).map((d) => ({ uuid: d.uuid, name: d.name, doc: d }));
  }

  _keyedNumbers() {
    const e = this._entries.find((x) => x.uuid === this._entryUuid);
    if (!e) return new Set();
    const out = new Set();
    for (const r of e.doc.getFlag(MODULE_ID, HEX_FLAG)?.keyed ?? []) { const n = hexNum(r.num); if (n !== null) out.add(n); }
    for (const p of e.doc.pages.contents) { const n = hexNum(p.getFlag(MODULE_ID, HEX_FLAG)?.num); if (n !== null) out.add(n); }
    return out;
  }

  async _prepareContext() {
    if (!this._state) this._loadState();
    if (!this._entries.length) await this._loadEntries();
    const scene = this._scene();
    const state = this._state;
    const total = this._numbered.size;
    const origin = state.origin;
    const sampled = this._cells.length > 0;
    const terrainOptions = Object.values(TERRAIN_TAGS).map((t) => ({ value: t, label: t.replace(/_/g, " ") }));

    // The sheet: with no origin, an alignment sheet of the first cells (top-left
    // first) each with a "this hex is number" box; with an origin, the tagging sheet.
    let sheet = [];
    if (sampled && !origin) {
      sheet = this._cells.slice().sort((a, b) => (a.i - b.i) || (a.j - b.j)).slice(0, SHEET_SIZE).map((c) => ({
        i: c.i, j: c.j, thumb: this._thumb(c), align: true,
      }));
    } else if (sampled) {
      const keyed = this._keyedNumbers();
      sheet = this._sheet.map((num) => {
        const c = this._numbered.get(num); const t = state.cells.get(String(num));
        return {
          num, label: String(num).padStart(4, "0"), i: c?.i, j: c?.j, thumb: c ? this._thumb(c) : "",
          terrain: t?.terrain ?? "", source: t?.source ?? "", keyed: keyed.has(num),
          overlays: Object.fromEntries(OVERLAYS.map((o) => [o, !!t?.overlays?.includes(o)])),
          terrainOptions: terrainOptions.map((o) => ({ ...o, selected: o.value === (t?.terrain ?? "") })),
        };
      });
    }
    return {
      sceneName: scene?.name ?? "(no scene)", sampled, cellCount: this._cells.length, numberedCount: total,
      summary: summarize(state, total), origin, originText: origin ? `${String(origin.num).padStart(4, "0")} at grid ${origin.i},${origin.j}` : "",
      boundsCols: origin?.bounds?.cols ?? "", boundsRows: origin?.bounds?.rows ?? "",
      mode: this._mode, modes: [["random", "Untagged cells"], ["keyed", "Keyed hexes first"], ["review", "Review queue"]].map(([v, l]) => ({ value: v, label: l, selected: v === this._mode })),
      entries: this._entries.map((e) => ({ uuid: e.uuid, name: e.name, selected: e.uuid === this._entryUuid })),
      sheet, hasSheet: sheet.length > 0, needsOrigin: sampled && !origin, viaExtras: !!extrasHexApi(), error: this._error,
      overlays: OVERLAYS,
    };
  }

  _thumb(cell) {
    try { return this._sampler?.thumbnail(cell) ?? ""; } catch (_e) { return ""; }
  }

  /** Read the header selects before an action re-renders. */
  _readHeader() {
    const root = this.element;
    this._mode = root?.querySelector("select[data-hxt-mode]")?.value || this._mode;
    this._entryUuid = root?.querySelector("select[data-hxt-entry]")?.value ?? this._entryUuid;
  }

  async _onSample() {
    this._error = "";
    const geom = sceneCells(canvas);
    if (geom.error) { this._error = geom.error; this.render(); return; }
    try {
      const image = await sourceImage(canvas);
      this._sampler = new CellSampler(image, geom);
      this._geom = geom; this._cells = geom.cells;
      this._sampler.bitmap(this._cells[0]);            // tainted-canvas check: throws on a cross-origin image
    } catch (err) {
      this._error = /SecurityError|tainted|insecure/i.test(String(err)) ? "The background image is not same-origin, so its pixels cannot be read. Put the file in your Foundry data directory." : String(err?.message ?? err);
      this._cells = []; this.render(); return;
    }
    this._loadState(); this._renumber();
    if (this._state.origin) this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() });
    this.render();
  }

  async _onNextSheet() {
    this._readHeader();
    if (!this._numbered.size) { ui.notifications?.warn("Sample the scene and set the anchor number first."); return; }
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() });
    if (!this._sheet.length) ui.notifications?.info(this._mode === "random" ? "Every numbered cell is tagged." : "Nothing left in that mode.");
    this.render();
  }

  async _onApplySheet() {
    this._readHeader();
    const answers = {};
    for (const sel of this.element.querySelectorAll("select[data-hxt-terrain]")) {
      const num = sel.dataset.num;
      const overlays = [...this.element.querySelectorAll(`input[data-hxt-overlay][data-num="${num}"]:checked`)].map((i) => i.value);
      answers[num] = { terrain: sel.value, overlays };
    }
    applySheet(this._state, answers);
    await this._saveState();
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() });
    this.render();
  }

  /** Anchor: the GM typed the printed number of one cell on the alignment sheet. */
  async _onSetNumber(event, target) {
    const i = Number(target.dataset.i), j = Number(target.dataset.j);
    const input = this.element.querySelector(`input[data-hxt-number][data-i="${i}"][data-j="${j}"]`);
    const num = String(input?.value ?? "").trim();
    if (!/^\d{3,4}$/.test(num)) { ui.notifications?.warn("Type the printed hex number (3 or 4 digits, e.g. 0000 or 1403)."); return; }
    const cell = this._cells.find((c) => c.i === i && c.j === j);
    if (!cell) return;
    const shifted = this.element.querySelector("select[data-hxt-shifted]")?.value === "even" ? "even" : "odd";
    this._state.origin = { i, j, q: cell.cube.q, r: cell.cube.r, num, shifted, bounds: this._state.origin?.bounds ?? null };
    await this._saveState();
    this._renumber();
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() });
    this.render();
  }

  /** Map size in cells, so cells past the hex field (margins, legend) are skipped. */
  async _onSetBounds() {
    if (!this._state.origin) { ui.notifications?.warn("Set the anchor number first."); return; }
    const cols = parseInt(this.element.querySelector("input[data-hxt-cols]")?.value, 10);
    const rows = parseInt(this.element.querySelector("input[data-hxt-rows]")?.value, 10);
    this._state.origin.bounds = (cols > 0 && rows > 0) ? { cols, rows } : null;
    await this._saveState();
    this._renumber();
    this._sheet = this._sheet.filter((n) => this._numbered.has(n));
    this.render();
  }

  async _onBuildDataset() {
    this._readHeader();
    if (!this._state.origin) { ui.notifications?.warn("Set the anchor number first."); return; }
    const tags = tagsForDataset(this._state);
    const b = this._state.origin.bounds;
    const gridHint = b?.cols ? { cols: b.cols, rows: b.rows } : undefined;
    const entry = this._entries.find((e) => e.uuid === this._entryUuid)?.doc ?? null;
    const dataset = entry ? datasetFromEntry(entry, { tags, gridHint })
      : buildHexDataset({ name: this._scene()?.name ?? "Hex map", source: "", tags, gridHint });
    const check = validateHexDataset(dataset);
    if (!check.ok) { ui.notifications?.error(`Hex dataset failed its contract check: ${check.errors[0]}`); console.warn(`${MODULE_ID} | hex dataset`, check.errors); return; }
    const res = await handoffDataset(dataset);
    const n = Object.keys(tags).length;
    if (res.via === "extras") ui.notifications?.info(`Sent "${dataset.name}" to Shadowdark Extras (${dataset.hexes.length} keyed hexes, ${n} tagged cells).`);
    else if (res.via === "download") ui.notifications?.info(`Downloaded ${res.filename} (${dataset.hexes.length} keyed hexes, ${n} tagged cells).`);
  }

  async _onClearTags() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Clear hex tags" },
      content: `<p>Remove every tag and the anchor from <strong>${foundry.utils.escapeHTML(this._scene()?.name ?? "")}</strong>? The map image and grid are untouched.</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (!ok) return;
    await this._scene()?.unsetFlag(MODULE_ID, TAGS_FLAG);
    this._loadState(); this._renumber(); this._sheet = [];
    this.render();
  }
}
