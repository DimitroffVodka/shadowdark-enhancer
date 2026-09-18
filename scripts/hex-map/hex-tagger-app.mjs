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
 * Phase 4 adds the side doors (Import a CSV or JSON of tags, Export the tag
 * flag) and the hidden reference tile: the print placed on the painted scene,
 * automatically after an Extras hand-off (the builder's summary carries the
 * scene id) or by hand on any hex-columns scene (reference-tile.mjs). Phase 5
 * adds the legend: every cell grouped by glyph (legend.mjs), one card per
 * group to name; the named groups' cores become the hand tags and the rest is
 * classified from them, so the first sheets of hand tagging go away.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { sceneCells, sourceImage, CellSampler } from "./sampler.mjs";
import { cellNumber } from "./geometry.mjs";
import { decodeTags, encodeTags, nextSheet, applySheet, tagsForDataset, summarize, importTags, rowsFromJson, OVERLAYS } from "./tag-store.mjs";
import { cellBoxOf, referenceTilePlacement, gridCellBox, loweredColumns, placeReferenceTile } from "./reference-tile.mjs";
import { createClassifier, compareTags, parseTruthCsv } from "./classify.mjs";
import { buildLegend } from "./legend.mjs";
import { TERRAIN_TAGS } from "../importer/hex/hex-summary.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { datasetFromEntry, handoffDataset, extrasHexApi } from "../importer/hex/hex-handoff.mjs";
import { buildHexDataset, validateHexDataset, hexNum } from "../importer/hex/hex-dataset.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Scene flag key holding the tag store. */
export const TAGS_FLAG = "hexTags";
export const SHEET_SIZE = 40;
/** Cell bitmap width for classification (height follows the cell's aspect); the calibration cell was 95×87. */
export const BITMAP_SIZE = 96;

/**
 * Dev check: score a scene's tags against a truth CSV (see classify.mjs).
 * Exposed as game.shadowdarkEnhancer.hexMaps.compare; ships no data.
 */
export function compareSceneTags(scene, csvText, { sources } = {}) {
  let enabled = false;
  try { enabled = !!globalThis.game?.settings?.get?.(MODULE_ID, "hexMapsDevTools"); } catch (_err) { /* setting not registered yet */ }
  if (!globalThis.game?.user?.isGM || !enabled) {
    globalThis.ui?.notifications?.warn("Hex map developer tools are disabled.");
    return null;
  }
  const state = decodeTags(scene?.getFlag(MODULE_ID, TAGS_FLAG));
  return compareTags(state.cells, parseTruthCsv(csvText), { sources });
}

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
      hxtClassify:     function (...a) { return this._onClassify(...a); },
      hxtImport:       function (...a) { return this._onImport(...a); },
      hxtExport:       function (...a) { return this._onExport(...a); },
      hxtReference:    function (...a) { return this._onReferenceTile(...a); },
      hxtLegend:       function (...a) { return this._onLegend(...a); },
      hxtPinKeyed:     function (...a) { return this._onPinKeyed(...a); },
      hxtApplyLegend:  function (...a) { return this._onApplyLegend(...a); },
      hxtCancelLegend: function () { this._legend = null; this.render(); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/hex-tagger.hbs`, scrollable: [".sde-hxt-sheet"] },
  };

  /**
   * GM-only entry point (also game.shadowdarkEnhancer.hexMaps.openTagger).
   * `legend` samples the scene and opens the legend at once (the image flow).
   */
  static open({ legend = false } = {}) {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can tag hex maps."); return null; }
    const app = new HexTaggerApp();
    app._autoLegend = legend;
    app.render(true);
    return app;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // The free-text terrain box shows only for "other…".
    for (const sel of this.element.querySelectorAll("select[data-hxt-terrain], select[data-hxt-legend]")) {
      sel.addEventListener("change", () => {
        const inp = sel.dataset.num !== undefined
          ? this.element.querySelector(`input[data-hxt-terrain-other][data-num="${sel.dataset.num}"]`)
          : this.element.querySelector(`input[data-hxt-legend-other][data-idx="${sel.dataset.idx}"]`);
        if (!inp) return;
        inp.hidden = sel.value !== "__other";
        if (!inp.hidden) inp.focus();
      });
    }
    if (!this._autoLegend) return;
    this._autoLegend = false;
    this._onSample().then(() => { if (this._cells.length && this._state?.origin) return this._onLegend(); }).catch((err) => console.warn(`${MODULE_ID} | legend`, err));
  }

  _geom = null;
  _sampler = null;
  _cells = [];
  /** @type {Map<number, object>} published number → cell */
  _numbered = new Map();
  _state = null;
  _stateSceneId = undefined;
  _sheet = [];
  _mode = "random";
  _entryUuid = "";
  _entries = [];
  _error = "";
  /** @type {Map<number, {w:number,h:number,data:Uint8Array}>} published number → cell bitmap, filled on Classify */
  _bitmaps = new Map();
  _sensitivity = 1;
  _progress = "";
  /** @type {Array<{size:number, members:number[], core:number[], samples:number[]}>|null} the legend's cards while they are shown */
  _legend = null;
  _autoLegend = false;

  _scene() { return canvas?.scene ?? null; }

  _loadState() {
    const scene = this._scene();
    this._state = decodeTags(scene?.getFlag(MODULE_ID, TAGS_FLAG));
    this._stateSceneId = scene?.id ?? null;
  }

  /** Drop in-memory samples when the active scene changes under the open app. */
  _syncScene() {
    const id = this._scene()?.id ?? null;
    if (this._stateSceneId === undefined || id === this._stateSceneId) return false;
    this._loadState();
    this._geom = null; this._sampler = null; this._cells = [];
    this._numbered = new Map(); this._bitmaps.clear(); this._sheet = []; this._legend = null;
    return true;
  }

  _requireCurrentScene() {
    if (!this._syncScene()) return true;
    ui.notifications?.warn("The active scene changed. Sample it before continuing.");
    this.render();
    return false;
  }

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
    // One filed crawl is the obvious choice; the GM can still pick (none).
    if (this._entries.length === 1 && !this._entryUuid) this._entryUuid = this._entries[0].uuid;
  }

  /** Keyed hexes of the chosen crawl as map notes on this scene (hex-pins.mjs). */
  async _onPinKeyed() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    const entry = this._entries.find((e) => e.uuid === this._entryUuid)?.doc;
    if (!entry) { ui.notifications?.warn("Choose the crawl entry (the hex pages filed by the importer) in the header first."); return; }
    const { pinCrawlOnActiveScene } = await import("./hex-pins.mjs");
    this._setProgress("Pinning keyed hexes…");
    const res = await pinCrawlOnActiveScene(entry).catch((err) => { console.error(`${MODULE_ID} | pin keyed hexes`, err); ui.notifications?.error(`Pinning failed: ${err.message}`); return null; });
    this._setProgress("");
    if (!res) return;
    const bits = [`${res.created} pinned`];
    if (res.moved) bits.push(`${res.moved} moved`);
    if (res.missing.length) bits.push(`${res.missing.length} not on this map`);
    ui.notifications?.info(`Keyed hexes on "${this._scene()?.name}": ${bits.join(", ")}. Each note opens its page of "${res.journal.name}".`);
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
    this._syncScene();
    if (!this._state) this._loadState();
    if (!this._entries.length) await this._loadEntries();
    const scene = this._scene();
    const state = this._state;
    const total = this._numbered.size;
    const origin = state.origin;
    const sampled = this._cells.length > 0;
    const terrainValues = Object.values(TERRAIN_TAGS);
    const terrainOptions = terrainValues.map((t) => ({ value: t, label: t.replace(/_/g, " ") }));

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
        const terrainOther = t?.terrain && !terrainValues.includes(t.terrain) ? t.terrain : "";
        return {
          num, label: String(num).padStart(4, "0"), i: c?.i, j: c?.j, thumb: c ? this._thumb(c) : "",
          terrain: t?.terrain ?? "", source: t?.source ?? "", keyed: keyed.has(num),
          margin: t?.margin !== undefined ? Number(t.margin).toFixed(2) : "", review: !!t?.review,
          overlays: Object.fromEntries(OVERLAYS.map((o) => [o, !!t?.overlays?.includes(o)])),
          terrainOther,
          terrainOptions: [...terrainOptions, { value: "__other", label: "other…", selected: !!terrainOther }]
            .map((o) => ({ ...o, selected: o.value === (terrainOther ? "__other" : (t?.terrain ?? "")) })),
        };
      });
    }
    // The legend's cards: a few member pictures each, the select pre-filled
    // with what most of its members are tagged already (a re-run after fixes).
    const legend = this._legend?.map((cl, idx) => {
      const counts = new Map(), overlayCounts = Object.fromEntries(OVERLAYS.map((o) => [o, 0]));
      for (const n of cl.members) {
        const t = state.cells.get(String(n)); if (!t?.terrain) continue;
        counts.set(t.terrain, (counts.get(t.terrain) ?? 0) + 1);
        for (const o of t.overlays ?? []) if (o in overlayCounts) overlayCounts[o]++;
      }
      const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const terrainOther = majority && !terrainValues.includes(majority) ? majority : "";
      return {
        idx, size: cl.size, terrainOther,
        overlays: Object.fromEntries(OVERLAYS.map((o) => [o, overlayCounts[o] * 2 > cl.size])),
        thumbs: cl.samples.map((n) => { const c = this._numbered.get(n); return c ? this._thumb(c) : ""; }).filter(Boolean),
        terrainOptions: [...terrainOptions, { value: "__other", label: "other…" }].map((o) => ({ ...o, selected: o.value === (terrainOther ? "__other" : majority) })),
      };
    }) ?? null;
    // What to do next: nothing, once every numbered cell is tagged; the review queue is optional.
    const summary = summarize(state, total);
    let reviewCount = 0;
    for (const n of this._numbered.keys()) { const c = state.cells.get(String(n)); if (c && c.source === "auto" && (c.review || (c.margin !== undefined && c.margin < 1.3))) reviewCount++; }
    return {
      legend, hasLegend: !!legend,
      done: total > 0 && summary.untagged === 0, reviewCount, noCrawl: this._entries.length > 0 && !this._entryUuid,
      sceneName: scene?.name ?? "(no scene)", sampled, cellCount: this._cells.length, numberedCount: total,
      summary, origin, originText: origin ? `${String(origin.num).padStart(4, "0")} at grid ${origin.i},${origin.j}` : "",
      boundsCols: origin?.bounds?.cols ?? "", boundsRows: origin?.bounds?.rows ?? "",
      mode: this._mode, modes: [["random", "Untagged cells"], ["keyed", "Keyed hexes first"], ["review", "Review queue"]].map(([v, l]) => ({ value: v, label: l, selected: v === this._mode })),
      entries: this._entries.map((e) => ({ uuid: e.uuid, name: e.name, selected: e.uuid === this._entryUuid })),
      sheet, hasSheet: sheet.length > 0, needsOrigin: sampled && !origin, viaExtras: !!extrasHexApi(), error: this._error,
      overlays: OVERLAYS,
      canClassify: !!origin && summarize(state, total).gm > 0, sensitivity: this._sensitivity, progress: this._progress,
    };
  }

  _setProgress(text) {
    this._progress = text;
    const el = this.element?.querySelector("[data-hxt-progress]");
    if (el) el.textContent = text;
  }

  /** Cell bitmaps for every numbered cell, read once and kept until re-sampling. */
  async _ensureBitmaps() {
    let k = 0; const total = this._numbered.size;
    for (const [num, cell] of this._numbered) {
      if (this._bitmaps.has(num)) continue;
      this._bitmaps.set(num, this._sampler.bitmap(cell));
      if (++k % 200 === 0) { this._setProgress(`Reading cells ${k} of ${total}…`); await new Promise((r) => setTimeout(r, 0)); }
    }
    this._setProgress("");
  }

  /**
   * Classify every cell without a hand tag from the hand-tagged ones; unsure
   * results are marked for the Review queue. Keyed hexes are left alone.
   */
  async _onClassify() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    if (!this._state.origin) { ui.notifications?.warn("Set the anchor number first."); return; }
    const sens = parseFloat(this.element.querySelector("input[data-hxt-sensitivity]")?.value);
    this._sensitivity = Number.isFinite(sens) && sens > 0 ? sens : 1;
    await this._classify();
  }

  /**
   * The classifier run behind Classify and Apply legend. `overlayOnly` names
   * hand-tagged cells whose overlays are still unknown (the legend's cores):
   * they keep their terrain and take the classifier's river or path.
   * @returns {Promise<boolean>} whether the run completed and saved
   */
  async _classify(overlayOnly = new Set()) {
    const keyed = this._keyedNumbers();
    const gm = [...this._state.cells.entries()].filter(([num, c]) => c.source !== "auto" && !keyed.has(Number(num)));
    if (!gm.length) { ui.notifications?.warn("Tag a sheet by hand first; those cells are the examples."); return false; }
    await this._ensureBitmaps();
    if (!this._requireCurrentScene()) return false;
    // Keyed hexes carry a star or settlement icon over their glyph, which the
    // residual reads as a river (120 of 144 on the live check). Their terrain
    // comes from the book's text, so they must be left out — and that needs the
    // crawl entry to be chosen.
    if (!keyed.size && this._entries.length) ui.notifications?.warn("No crawl chosen: keyed hexes will be classified too, and their icons read as rivers. Pick the crawl entry and classify again to leave them to the book.");
    const exemplars = gm.map(([num, c]) => ({ num: Number(num), tag: c.terrain, overlays: c.overlays ?? [], bitmap: this._bitmaps.get(Number(num)) })).filter((e) => e.bitmap);
    const cells = [...this._numbered.keys()]
      .filter((n) => !keyed.has(n) && (overlayOnly.has(n) || (this._state.cells.get(String(n))?.source ?? "auto") === "auto"))
      .map((n) => ({ num: n, bitmap: this._bitmaps.get(n) })).filter((c) => c.bitmap);
    this._setProgress(`Preparing ${exemplars.length} examples…`); await new Promise((r) => setTimeout(r, 0));
    const clf = createClassifier({ exemplars, allBitmaps: [...this._bitmaps.values()], thresholds: { sensitivity: this._sensitivity } });
    if (!clf.ready) { for (const w of clf.warnings) ui.notifications?.warn(w); this._setProgress(""); return false; }
    let done = 0, auto = 0, review = 0;
    for (const c of cells) {
      const r = clf.classify(c);
      const kept = overlayOnly.has(c.num) ? this._state.cells.get(String(c.num)) : null;
      if (kept) kept.overlays = r.overlays;
      else {
        this._state.cells.set(String(c.num), { terrain: r.terrain, overlays: r.overlays, source: "auto", margin: Number.isFinite(r.margin) ? Math.min(r.margin, 99) : 99, review: r.ambiguous });
        auto++; if (r.ambiguous) review++;
      }
      // Yield so the browser (and Foundry's socket heartbeat) keeps breathing on big maps.
      if (++done % 100 === 0) { this._setProgress(`Classifying ${done} of ${cells.length}…`); await new Promise((r) => setTimeout(r, 0)); }
    }
    if (!this._requireCurrentScene()) return false;
    await this._saveState();
    this._setProgress("");
    this._mode = "review";
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: "review" });
    ui.notifications?.info(`Classified ${auto} cells from ${exemplars.length} hand-tagged examples; ${review} queued for review.`);
    for (const w of clf.warnings) ui.notifications?.warn(w);
    this.render();
    return true;
  }

  /**
   * The legend: every numbered cell grouped by glyph, one card per group to
   * name (legend.mjs). Keyed hexes stay out when a crawl is chosen: their
   * icons would only make cards nobody can name.
   */
  async _onLegend() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    if (!this._state.origin) { ui.notifications?.warn("Set the anchor number first."); return; }
    if (!this._numbered.size) { ui.notifications?.warn("Sample the scene first."); return; }
    await this._ensureBitmaps();
    if (!this._requireCurrentScene()) return;
    const keyed = this._keyedNumbers();
    const cells = [...this._numbered.keys()].filter((n) => !keyed.has(n)).map((n) => ({ num: n, bitmap: this._bitmaps.get(n) }));
    const { clusters } = await buildLegend(cells, { onProgress: async (text) => { this._setProgress(text); await new Promise((r) => setTimeout(r, 0)); } });
    if (!this._requireCurrentScene()) return;
    this._setProgress("");
    this._legend = clusters;
    this.render();
  }

  /**
   * Each named card's core becomes hand tags, then everything else is
   * classified from them. A ticked river/path/coast box is the GM's word for
   * the whole core; an unticked card leaves its cores' overlays to the classifier.
   */
  async _onApplyLegend() {
    if (!this._requireCurrentScene() || !this._legend) return;
    this._readHeader();
    const answers = {}, cores = new Set();
    for (const sel of this.element.querySelectorAll("select[data-hxt-legend]")) {
      const idx = Number(sel.dataset.idx), card = this._legend[idx];
      const other = this.element.querySelector(`input[data-hxt-legend-other][data-idx="${idx}"]`)?.value.trim();
      const terrain = sel.value === "__other" ? other : sel.value;
      if (!terrain || !card) continue;
      const overlays = [...this.element.querySelectorAll(`input[data-hxt-legend-overlay][data-idx="${idx}"]:checked`)].map((i) => i.value);
      for (const n of card.core) { answers[n] = { terrain, overlays }; if (!overlays.length) cores.add(n); }
    }
    if (!cores.size) { ui.notifications?.warn("Name at least one picture, or Cancel."); return; }
    applySheet(this._state, answers);
    await this._saveState();
    this._legend = null;
    if (!(await this._classify(cores))) {
      this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() });
      this.render();
    }
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
    this._syncScene();
    this._error = "";
    const geom = sceneCells(canvas);
    if (geom.error) { this._error = geom.error; this.render(); return; }
    try {
      const image = await sourceImage(canvas);
      if (!this._requireCurrentScene()) return;
      this._sampler = new CellSampler(image, geom, { size: BITMAP_SIZE });
      this._geom = geom; this._cells = geom.cells; this._bitmaps = new Map(); this._legend = null;
      if (!this._cells.length) throw new Error("No grid cells overlap the background image.");
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
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    if (!this._numbered.size) { ui.notifications?.warn("Sample the scene and set the anchor number first."); return; }
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() });
    if (!this._sheet.length) ui.notifications?.info(this._mode === "random" ? "Every numbered cell is tagged." : "Nothing left in that mode.");
    this.render();
  }

  async _onApplySheet() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    const answers = {};
    for (const sel of this.element.querySelectorAll("select[data-hxt-terrain]")) {
      const num = sel.dataset.num;
      const overlays = [...this.element.querySelectorAll(`input[data-hxt-overlay][data-num="${num}"]:checked`)].map((i) => i.value);
      const other = this.element.querySelector(`input[data-hxt-terrain-other][data-num="${num}"]`)?.value.trim();
      answers[num] = { terrain: sel.value === "__other" ? other : sel.value, overlays };
    }
    applySheet(this._state, answers);
    await this._saveState();
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() });
    this.render();
  }

  /** Anchor: the GM typed the printed number of one cell on the alignment sheet. */
  async _onSetNumber(event, target) {
    if (!this._requireCurrentScene()) return;
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
    if (!this._requireCurrentScene()) return;
    if (!this._state.origin) { ui.notifications?.warn("Set the anchor number first."); return; }
    const cols = parseInt(this.element.querySelector("input[data-hxt-cols]")?.value, 10);
    const rows = parseInt(this.element.querySelector("input[data-hxt-rows]")?.value, 10);
    // The lowered columns keep ending the same number of rows short (the image flow found that).
    const old = this._state.origin.bounds;
    const short = old?.rowsLowered && old.rows ? old.rows - old.rowsLowered : 0;
    this._state.origin.bounds = (cols > 0 && rows > 0) ? { cols, rows, ...(short > 0 && rows > short ? { rowsLowered: rows - short } : {}) } : null;
    await this._saveState();
    this._renumber();
    this._sheet = this._sheet.filter((n) => this._numbered.has(n));
    this.render();
  }

  async _onBuildDataset() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    if (!this._state.origin) { ui.notifications?.warn("Set the anchor number first."); return; }
    const tags = tagsForDataset(this._state);
    const b = this._state.origin.bounds;
    // The map's own numbering origin: 0 when a numbered cell sits in column 0 or row 0 (hex 0000 exists).
    const numberingOrigin = [...this._numbered.values()].some((c) => c.col === 0 || c.row === 0) ? 0 : 1;
    const gridHint = b?.cols ? { cols: b.cols, rows: b.rows, rowsLowered: b.rowsLowered, origin: numberingOrigin } : { origin: numberingOrigin };
    const entry = this._entries.find((e) => e.uuid === this._entryUuid)?.doc ?? null;
    const dataset = entry ? datasetFromEntry(entry, { tags, gridHint })
      : buildHexDataset({ name: this._scene()?.name ?? "Hex map", source: "", tags, gridHint });
    const check = validateHexDataset(dataset);
    if (!check.ok) { ui.notifications?.error(`Hex dataset failed its contract check: ${check.errors[0]}`); console.warn(`${MODULE_ID} | hex dataset`, check.errors); return; }
    if (Object.values(tags).some((t) => t.overlays?.includes("coast"))) {
      ui.notifications?.warn("Coast tags stay on the scene; this dataset format exports river and road networks only.");
    }
    const referenceSrc = this._scene()?.background?.src;
    // The painted scene must not share the print scene's name.
    const res = await handoffDataset(dataset, { sceneName: entry ? dataset.name : `${dataset.name} (painted)` });
    const n = Object.keys(tags).length;
    if (res.via === "extras") ui.notifications?.info(`Sent "${dataset.name}" to Shadowdark Extras (${dataset.hexes.length} keyed hexes, ${n} tagged cells).`);
    else if (res.via === "download") ui.notifications?.info(`Downloaded ${res.filename} (${dataset.hexes.length} keyed hexes, ${n} tagged cells).`);
    // The builder's summary names the scene it painted; put the print on it for tracing.
    const built = res.via === "extras" ? game.scenes?.get(res.summary?.sceneId) : null;
    if (built && b?.cols) await this._placeReferenceOn(built, referenceSrc).catch((err) => console.warn(`${MODULE_ID} | reference tile`, err));
  }

  /** Side door in: a CSV (hex_id, tags or terrain_tags, source) or a JSON (the exported tag flag, or a dataset). */
  async _onImport() {
    if (!this._requireCurrentScene()) return;
    const file = await foundry.applications.api.DialogV2.wait({
      window: { title: "Import hex tags" },
      content: `<p>A CSV with <code>hex_id</code> and <code>tags</code> columns (semicolon-separated, <code>source</code> optional), or a JSON exported by this tagger or a hexcrawl dataset. Imported rows replace the cell's tags.</p>
        <input type="file" name="hex-tags-file" accept=".csv,.json,text/csv,application/json">`,
      buttons: [
        { action: "load", label: "Import", default: true, callback: (ev, button, dialog) => (dialog.element ?? dialog)?.querySelector?.("input[name='hex-tags-file']")?.files?.[0] ?? null },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!file || file === "cancel") return;
    let text;
    try { text = await file.text(); } catch (err) { ui.notifications?.error(`Could not read ${file.name}: ${err.message}`); return; }
    let rows, origin = null;
    if (/^\s*[{[]/.test(text)) {
      let obj;
      try { obj = JSON.parse(text); } catch (_e) { ui.notifications?.error(`${file.name} is not valid JSON.`); return; }
      ({ rows, origin } = rowsFromJson(obj));
    } else {
      rows = parseTruthCsv(text);
    }
    if (!rows.length) { ui.notifications?.warn(`Nothing to import from ${file.name}: no hex_id/tags columns, tag flag or dataset found.`); return; }
    if (!this._requireCurrentScene()) return;
    const n = importTags(this._state, rows, { origin });
    await this._saveState();
    this._renumber();
    this._sheet = this._numbered.size ? nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() }) : [];
    ui.notifications?.info(`Imported ${n} tagged cells from ${file.name}.`);
    this.render();
  }

  /** Side door out: the raw tag flag as JSON (re-importable here; the dataset is Build dataset's job). */
  _onExport() {
    if (!this._requireCurrentScene()) return;
    const scene = this._scene();
    if (!this._state.cells.size) { ui.notifications?.warn("No tags to export yet."); return; }
    const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
    save(JSON.stringify(encodeTags(this._state), null, 2), "text/json", `${(scene?.name ?? "hex-map").slugify()}-hex-tags.json`);
  }

  /** Image-pixel box of the numbered cells: the print's hex field. */
  _imageCellBox() {
    if (!this._geom) return null;
    return cellBoxOf([...this._numbered.values()].map((c) => ({ x: c.u, y: c.v })), this._geom.cellW, this._geom.cellH);
  }

  /** Put this scene's print on `target` so the hex field covers its first cols × rows cells. */
  async _placeReferenceOn(target, src = this._scene()?.background?.src) {
    const b = this._state.origin?.bounds;
    const imageBox = this._imageCellBox();
    if (!b?.cols || !imageBox) { ui.notifications?.warn("Sample the scene, set the anchor and the map size first."); return null; }
    if (!src) { ui.notifications?.warn("The source scene has no map background to place."); return null; }
    const sceneBox = gridCellBox(target, b.cols, b.rows);
    if (!sceneBox) { ui.notifications?.warn(`"${target.name}" has no hexagonal columns grid.`); return null; }
    const tf = this._geom.transform;
    const placement = referenceTilePlacement({ x: 0, y: 0, w: tf.texW, h: tf.texH }, imageBox, sceneBox);
    const tile = await placeReferenceTile(target, src, placement);
    const shifted = this._state.origin.shifted ?? "odd", lowered = loweredColumns(target);
    if (lowered !== shifted) ui.notifications?.warn(`"${target.name}" lowers its ${lowered} columns but the map lowers its ${shifted} ones; set its grid to Hexagonal Columns (${shifted}) so the hexes line up.`);
    ui.notifications?.info(`Reference tile placed on "${target.name}", hidden and locked. Delete it when tracing is done: hidden tiles still reach player clients with the image's URL.`);
    return tile;
  }

  /** By hand: pick any other hex-columns scene (the one Extras built from the downloaded dataset, say). */
  async _onReferenceTile() {
    if (!this._requireCurrentScene()) return;
    const here = this._scene();
    const targets = game.scenes.filter((s) => s.id !== here?.id && s.grid?.isHexagonal && s.grid.columns).sort((a, b) => a.name.localeCompare(b.name));
    if (!targets.length) { ui.notifications?.warn("No other scene with a hexagonal columns grid to place the print on."); return; }
    const options = targets.map((s) => `<option value="${s.id}">${foundry.utils.escapeHTML(s.name)}</option>`).join("");
    const id = await foundry.applications.api.DialogV2.wait({
      window: { title: "Reference tile" },
      content: `<p>Place this scene's map image on another scene as a hidden, locked, half-transparent tile, scaled so its hex field covers that scene's first ${this._state.origin?.bounds?.cols ?? "?"} × ${this._state.origin?.bounds?.rows ?? "?"} cells.</p>
        <label>Scene <select name="hex-ref-target">${options}</select></label>`,
      buttons: [
        { action: "place", label: "Place", default: true, callback: (ev, button, dialog) => (dialog.element ?? dialog)?.querySelector?.("select[name='hex-ref-target']")?.value ?? null },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!id || id === "cancel") return;
    if (!this._requireCurrentScene()) return;
    const target = game.scenes.get(id);
    if (target) await this._placeReferenceOn(target);
  }

  async _onClearTags() {
    if (!this._requireCurrentScene()) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Clear hex tags" },
      content: `<p>Remove every tag and the anchor from <strong>${foundry.utils.escapeHTML(this._scene()?.name ?? "")}</strong>? The map image and grid are untouched.</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (!ok) return;
    if (!this._requireCurrentScene()) return;
    await this._scene()?.unsetFlag(MODULE_ID, TAGS_FLAG);
    this._loadState(); this._bitmaps.clear(); this._renumber(); this._sheet = []; this._legend = null;
    this.render();
  }
}
