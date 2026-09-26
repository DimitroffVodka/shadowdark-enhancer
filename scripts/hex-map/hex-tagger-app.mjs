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
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { sceneCells, sourceImage, CellSampler } from "./sampler.mjs";
import { cellNumber, neighbours, framesTopRow, extrasNumbersAlike } from "./geometry.mjs";
import { decodeTags, encodeTags, nextSheet, applySheet, tagsForDataset, summarize, importTags, rowsFromJson, sheetRisk, deriveCoasts, OVERLAYS } from "./tag-store.mjs";
import { FIXES_FLAG, BASELINE_FLAG, emptyLog, decodeFixes, encodeFixes, recordEdits, recordLegend, legendReport, accuracyReport, encodeBaseline, decodeBaseline, baselineReport } from "./tag-corrections.mjs";
import { cellBoxOf, referenceTilePlacement, gridCellBox, loweredColumns, placeReferenceTile } from "./reference-tile.mjs";
import { createClassifier, compareTags, parseTruthCsv, featureVector, keepMask, scoreClassifier, smoothTerrain } from "./classify.mjs";
import { buildLegend } from "./legend.mjs";
import { scanRegions, encodeRegions, decodeRegions, REGIONS_FLAG } from "./region-scan.mjs";
import { regionSeeds, nameComponents } from "./hex-region.mjs";
import { TERRAIN_TAGS, SETTLEMENTS, rowTag } from "../importer/hex/hex-summary.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { datasetFromEntries, handoffDataset, handoffToPrint, extrasHexApi } from "../importer/hex/hex-handoff.mjs";
import { buildHexDataset, validateHexDataset, hexNum, assignmentsFromManifest } from "../importer/hex/hex-dataset.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Scene flag key holding the tag store. */
export const TAGS_FLAG = "hexTags";
/** The GM's own tile-art manifest for this map. Read at hand-off; never shipped. */
export const ART_FLAG = "hexArt";
/** Hex-key picker value meaning "every filed crawl" — a book keyed per region. */
export const ALL_CRAWLS = "*";

/**
 * One string, from `languages/en.json`.
 *
 * Not `game.i18n.localize` at every call site: this module is imported by the
 * node suites, which stub a `game` with no `i18n` on it, and a UI string is
 * never worth throwing over. Falls back to the key, which is what Foundry shows
 * for a missing translation anyway.
 */
const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};
export const SHEET_SIZE = 40;
/** Legend answer meaning "these pictures are not one thing": break the card up and ask again. */
export const SPLIT = "__split";
/** How many of an opened card's hexes to put in front of the GM. */
export const EXPAND_PICKS = 8;
/**
 * Not a terrain: a hex the book keys. Its star or castle marker is what the
 * classifier would otherwise read as a river, and naming it here keeps those
 * cells out of the terrain classes; the crawl entry's pages say what is there.
 * The same word hex-pins.mjs uses for the icon of a keyed hex with no settlement.
 */
export const KEYED_TERRAIN = "keyed_location";
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
    globalThis.ui?.notifications?.warn(t("SDE.hexMap.dev.disabled"));
    return null;
  }
  const state = decodeTags(scene?.getFlag(MODULE_ID, TAGS_FLAG));
  return compareTags(state.cells, parseTruthCsv(csvText), { sources });
}

/**
 * Score the model on this scene against the GM's own tags, and on the Legend's
 * cards when they are up. Exposed as game.shadowdarkEnhancer.hexMaps.score();
 * developer tool, ships no data, reads only what the GM tagged.
 *
 * This is the loop that was missing: a correction improved the GM's scene and
 * nothing measured whether the MODULE had got any better at the job. Run it
 * before and after a change to classify.mjs or legend.mjs.
 */
export async function scoreSceneModel({ app = null } = {}) {
  let enabled = false;
  try { enabled = !!globalThis.game?.settings?.get?.(MODULE_ID, "hexMapsDevTools"); } catch (_err) { /* not registered yet */ }
  if (!globalThis.game?.user?.isGM || !enabled) { globalThis.ui?.notifications?.warn(t("SDE.hexMap.dev.disabled")); return null; }
  const tagger = app ?? [...foundry.applications.instances.values()].find((a) => a.id === "sde-hex-tagger");
  if (!tagger?._cells?.length) { ui.notifications?.warn(t("SDE.hexMap.dev.openFirst")); return null; }
  await tagger._ensureBitmaps();
  const hand = [];
  for (const [num, c] of tagger._state.cells) {
    if (c.source === "auto" || !c.terrain) continue;
    const bm = tagger._bitmaps.get(Number(num));
    if (bm) hand.push({ num: Number(num), tag: c.terrain, bm });
  }
  if (hand.length < 10) { ui.notifications?.warn(t("SDE.hexMap.dev.tagFirst")); return null; }
  const { cellMasks } = await import("./bitmap.mjs");
  const masks = cellMasks(hand[0].bm.w, hand[0].bm.h);
  const keep = keepMask(hand.map((h) => h.bm), masks);
  const labelled = hand.map((h) => {
    const data = new Uint8Array(h.bm.data.length);
    for (let p = 0; p < data.length; p++) data[p] = h.bm.data[p] && keep[p] ? 1 : 0;
    return { num: h.num, tag: h.tag, vec: featureVector({ w: h.bm.w, h: h.bm.h, data }, 32) };
  });
  const score = scoreClassifier(labelled, tagger._legend);
  console.log(`${MODULE_ID} | model score`, score);
  return score;
}

/**
 * What a FIRST-TIME user would get on this map, with no tags of their own.
 *
 * This is the only measurement that answers "is the module better than it was",
 * as opposed to "is this scene better than it was". It simulates the whole
 * first run on a map the GM has already verified: cluster the cells, name every
 * card from what its core really is (a user who names every card correctly),
 * classify everything else from those cores, run the neighbour pass, and score
 * the lot against the verified tags. No tag of the GM's is used as an example —
 * only as the answer key.
 *
 * So: verify one map by hand, then change the clustering, the feature, the
 * thresholds or the smoothing and run this again. If the number goes up, every
 * user's first run got better, and nothing about the map ships with the module.
 *
 * On the Western Reaches it moved 92.3% → 93.9% when the legend's card count
 * and core size were calibrated against it (LEGEND_DEFAULTS).
 *
 * @param {{k?:number, core?:number, ds?:number, sensitivity?:number, need?:number}} [opts]
 *   overrides for a sweep; omit to measure what currently ships
 */
export async function benchmarkFirstRun(opts = {}) {
  let enabled = false;
  try { enabled = !!globalThis.game?.settings?.get?.(MODULE_ID, "hexMapsDevTools"); } catch (_err) { /* not registered */ }
  if (!globalThis.game?.user?.isGM || !enabled) { ui.notifications?.warn(t("SDE.hexMap.dev.disabled")); return null; }
  const app = [...foundry.applications.instances.values()].find((a) => a.id === "sde-hex-tagger");
  if (!app?._state?.origin) { ui.notifications?.warn(t("SDE.hexMap.dev.verifiedFirst")); return null; }
  const truth = new Map();
  for (const [num, c] of app._state.cells) if (c.terrain && c.source !== "auto") truth.set(num, c.terrain);
  if (truth.size < 200) { ui.notifications?.warn(t("SDE.hexMap.dev.needVerified")); return null; }
  if (!app._cells.length && !(await app._onSample())) return null;
  await app._ensureBitmaps();
  const { buildLegend } = await import("./legend.mjs");
  const cells = [...app._numbered.keys()].map((n) => ({ num: n, bitmap: app._bitmaps.get(n) })).filter((c) => c.bitmap);
  const { clusters } = await buildLegend(cells, { k: opts.k, core: opts.core, ds: opts.ds });
  const state = new Map(), exemplars = [];
  for (const card of clusters) {
    const votes = new Map();
    for (const n of card.core) { const k = truth.get(String(n)); if (k) votes.set(k, (votes.get(k) ?? 0) + 1); }
    const name = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!name) continue;
    for (const n of card.core) {
      state.set(String(n), { terrain: name, source: "gm" });
      const bitmap = app._bitmaps.get(n);
      if (bitmap) exemplars.push({ num: n, tag: name, overlays: [], bitmap });
    }
  }
  const thresholds = { sensitivity: opts.sensitivity ?? 1 };
  if (opts.runOff !== undefined) thresholds.runOff = opts.runOff;
  const clf = createClassifier({ exemplars, allBitmaps: [...app._bitmaps.values()], thresholds });
  if (!clf.ready) { ui.notifications?.error(clf.warnings[0] ?? t("SDE.hexMap.dev.noClassifier")); return null; }
  let n = 0, runOffs = 0;
  for (const c of cells) {
    if (state.has(String(c.num))) continue;
    const r = clf.classify(c);
    if (r.runOff) runOffs++;
    state.set(String(c.num), { terrain: r.terrain, overlays: r.overlays, source: "auto", margin: Number.isFinite(r.margin) ? Math.min(r.margin, 99) : 99, review: r.ambiguous });
    if (++n % 700 === 0) await new Promise((z) => setTimeout(z, 0));
  }
  const pct = (m) => { let j = 0, ok = 0; for (const [num, want] of truth) { const got = m.get(num)?.terrain; if (!got) continue; j++; if (got === want) ok++; } return j ? Math.round(ok / j * 1000) / 10 : null; };
  const before = pct(state);
  const shifted = app._state.origin?.shifted ?? "odd";
  const fixes = smoothTerrain(state, (num) => neighbours(Math.floor(num / 100), num % 100, shifted), { need: opts.need });
  for (const f of fixes) state.get(f.num).terrain = f.to;
  const result = { judged: truth.size, cards: clusters.length, exemplars: exemplars.length, beforeSmoothing: before, afterSmoothing: pct(state), smoothed: fixes.length, runOffs };
  console.log(`${MODULE_ID} | first-run benchmark`, opts, result);
  return result;
}

export class HexTaggerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-hex-tagger",
    classes: ["shadowdark", "sde-hex-tagger"],
    window: { title: "SDE.hexMap.app.title", icon: "fa-solid fa-map-location-dot", resizable: true },
    // Height follows the content: an unsampled scene is a few lines, a sheet is
    // a sheet. A fixed 780 opened every scene as a mostly empty black box.
    position: { width: 980, height: "auto" },
    actions: {
      hxtSample:       function (...a) { return this._onSample(...a); },
      hxtNextSheet:    function (...a) { return this._onNextSheet(...a); },
      hxtApplySheet:   function (...a) { return this._onApplySheet(...a); },
      hxtSetNumber:    function (...a) { return this._onSetNumber(...a); },
      hxtSetBounds:    function (...a) { return this._onSetBounds(...a); },
      hxtBuildDataset: function (...a) { return this._onBuildDataset(...a); },
      hxtBuildPainted: function (...a) { return this._onBuildPainted(...a); },
      hxtClearTags:    function (...a) { return this._onClearTags(...a); },
      hxtClassify:     function (...a) { return this._onClassify(...a); },
      hxtImport:       function (...a) { return this._onImport(...a); },
      hxtExport:       function (...a) { return this._onExport(...a); },
      hxtArt:          function (...a) { return this._onArtManifest(...a); },
      hxtReference:    function (...a) { return this._onReferenceTile(...a); },
      hxtLegend:       function (...a) { return this._onLegend(...a); },
      hxtPinKeyed:     function (...a) { return this._onPinKeyed(...a); },
      hxtShowTags:     function (...a) { return this._onShowTags(...a); },
      hxtUseMargin:    function (...a) { return this._onUseMargin(...a); },
      hxtBrush:        function (...a) { return this._onBrush(...a); },
      hxtMore:         function (...a) { return this._onMore(...a); },
      hxtLearnFrom:    function (...a) { return this._onLearnFrom(...a); },
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
    if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.hexMap.notify.gmOnly")); return null; }
    const app = new HexTaggerApp();
    app._autoLegend = legend;
    app.render(true);
    return app;
  }

  /**
   * Read the active scene's region borders on their own (GM only). The image
   * flow does this without being asked; this is for a map that was set up
   * before the module could read borders, or after the print was replaced.
   * @returns {Promise<number>} enclosures found
   */
  static async scanRegions() {
    const app = HexTaggerApp.open();
    if (!app) return 0;
    if (!(await app._onSample())) return 0;
    return app._onScanRegions();
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // The free-text terrain box shows only for "other…".
    for (const sel of this.element.querySelectorAll("select[data-hxt-terrain], select[data-hxt-legend], select[data-hxt-pick]")) {
      sel.addEventListener("change", () => {
        // "These are not all the same" opens the card THERE AND THEN. It used
        // to wait for Apply legend, which is the round trip the answer exists
        // to avoid: Patrick, choosing it, "I thought when I selected these are
        // not the same it was supposed to allow me to fix it".
        if (sel.hasAttribute("data-hxt-legend") && sel.value === SPLIT) {
          const idx = Number(sel.dataset.idx);
          this._readLegendAnswers();
          this._expandCards([idx]);
          return;
        }
        const inp = sel.hasAttribute("data-hxt-pick")
          ? this.element.querySelector(`input[data-hxt-pick-other][data-num="${sel.dataset.num}"]`)
          : sel.dataset.num !== undefined
            ? this.element.querySelector(`input[data-hxt-terrain-other][data-num="${sel.dataset.num}"]`)
            : this.element.querySelector(`input[data-hxt-legend-other][data-idx="${sel.dataset.idx}"]`);
        // Every legend answer is written down as it is given, not only when
        // something else forces it: a re-render from any direction used to take
        // the unread ones with it.
        if (sel.hasAttribute("data-hxt-legend") || sel.hasAttribute("data-hxt-pick")) this._readLegendAnswers();
        if (!inp) return;
        inp.hidden = sel.value !== "__other";
        if (!inp.hidden) inp.focus();
      });
    }
    if (!this._autoLegend) return;
    this._autoLegend = false;
    this._onSample()
      .then(async () => {
        if (!this._cells.length || !this._state?.origin) return;
        // Regions first: it needs the same cell bitmaps the legend is about to
        // build, and it finishes without asking the GM anything, so the borders
        // are already read by the time they start naming glyphs.
        await this._onScanRegions();
        return this._onLegend();
      })
      .catch((err) => console.warn(`${MODULE_ID} | legend`, err));
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
  /** Which overlay picture is on the map: "", "terrain", "region" or "encounter". */
  _overlayMode = "";

  /**
   * Sampled cells by scene id, kept for the life of the page. They come from
   * reading the scene's image, which takes about fourteen seconds on a print
   * this size, and nothing about them changes while the image does not — so
   * closing the window must not throw them away.
   * @type {Map<string, {geom:object, cells:object[], sampler:object}>}
   */
  static _samples = new Map();

  /** Take back this scene's samples if a previous window read them. */
  _restoreSamples() {
    const cached = HexTaggerApp._samples.get(this._scene()?.id);
    if (!cached || this._cells.length) return false;
    this._geom = cached.geom; this._cells = cached.cells; this._sampler = cached.sampler;
    this._renumber();
    return true;
  }

  _scene() { return canvas?.scene ?? null; }

  /** The scene's correction log: the review margin and the evidence behind it. */
  _log() { return decodeFixes(this._scene()?.getFlag(MODULE_ID, FIXES_FLAG)); }

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
    this._restoreSamples();
    return true;
  }

  _requireCurrentScene() {
    if (!this._syncScene()) return true;
    ui.notifications?.warn(t("SDE.hexMap.notify.sceneChanged"));
    this.render();
    return false;
  }

  /**
   * Replace the stored flag wholesale. setFlag would MERGE the object, so a
   * cell cleared in the app (or a dropped bounds block) would survive in the
   * database — found on the 2026-09-17 live check. replaceModuleFlag deletes
   * the key and sets it, which replaces it without deleting the module's OTHER
   * flags on the scene the way `recursive: false` does (module-flags.mjs).
   */
  async _saveState() {
    const scene = this._scene();
    if (scene) await replaceModuleFlag(scene, TAGS_FLAG, encodeTags(this._state));
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
    // One filed crawl is the obvious choice; several filed crawls are one BOOK
    // imported per region, and the obvious choice there is all of them. Left on
    // "(none)" a whole imported hex key looks like it did not arrive: the Pin
    // button has nothing to pin and says so about a map with 270 keyed hexes
    // sitting in the pack. The GM can still pick (none).
    if (!this._entryUuid) this._entryUuid = this._entries.length === 1 ? this._entries[0].uuid : (this._entries.length ? ALL_CRAWLS : "");
  }

  /**
   * The crawl entries the picker is on: one, all of them, or none. Everything
   * that reads the book's own answers goes through this, so "(every crawl)"
   * means the same thing to the keyed sheet, the pins and the hand-off.
   * @returns {JournalEntry[]}
   */
  _selectedEntries() {
    if (this._entryUuid === ALL_CRAWLS) return this._entries.map((e) => e.doc);
    return [this._entries.find((e) => e.uuid === this._entryUuid)?.doc].filter(Boolean);
  }

  /**
   * Keyed hexes of the chosen crawl as map notes on this scene (hex-pins.mjs).
   *
   * A book whose key locations were imported per region (hex-book-import.mjs)
   * files one crawl entry per region, so "every crawl" pins the whole map in
   * one press instead of fifteen. Each pass matches its own notes by the hex
   * number on their flag, and hex numbers do not repeat across regions, so a
   * later region never moves an earlier one's pin.
   */
  async _onPinKeyed() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    const all = this._entryUuid === ALL_CRAWLS;
    const entries = this._selectedEntries();
    if (!entries.length) { ui.notifications?.warn(t("SDE.hexMap.notify.chooseCrawl")); return; }
    const { pinCrawlOnActiveScene } = await import("./hex-pins.mjs");
    const tally = { created: 0, moved: 0, missing: 0 };
    let last = null;
    for (const [i, entry] of entries.entries()) {
      this._setProgress(all ? t("SDE.hexMap.progress.pinningOf", { name: entry.name, i: i + 1, n: entries.length })
        : t("SDE.hexMap.progress.pinning"));
      const res = await pinCrawlOnActiveScene(entry).catch((err) => { console.error(`${MODULE_ID} | pin keyed hexes`, err); ui.notifications?.error(t("SDE.hexMap.notify.pinFailed", { error: err.message })); return null; });
      if (!res) break;
      tally.created += res.created; tally.moved += res.moved; tally.missing += res.missing.length;
      last = res;
    }
    this._setProgress("");
    if (!last) return;
    const bits = [t("SDE.hexMap.notify.pinnedCount", { n: tally.created })];
    if (tally.moved) bits.push(t("SDE.hexMap.notify.movedCount", { n: tally.moved }));
    if (tally.missing) bits.push(t("SDE.hexMap.notify.offMapCount", { n: tally.missing }));
    ui.notifications?.info(t("SDE.hexMap.notify.pinned", {
      scene: this._scene()?.name, bits: bits.join(", "),
      journal: all ? t("SDE.hexMap.label.allCrawls") : last.journal.name,
    }));
  }

  /**
   * Take the review margin the GM's own corrections suggest. Everything that
   * asks "is this cell worth a second look" reads that number: the Review
   * sheet, the count in the note, and the overlay's ring.
   */
  async _onUseMargin(event, target) {
    if (!this._requireCurrentScene()) return;
    const margin = Number(target?.dataset?.margin);
    if (!Number.isFinite(margin)) return;
    const scene = this._scene();
    const log = this._log();
    log.margin = margin;
    await replaceModuleFlag(scene, FIXES_FLAG, encodeFixes(log));
    this._mode = "review";
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: "review", reviewMargin: margin });
    ui.notifications?.info(t("SDE.hexMap.notify.marginSet", { margin: margin.toFixed(2) }));
    this.render();
  }

  /**
   * More: the rarely used half, in the normal flow under the header. A floating
   * panel was clipped by the window's content box — the window is only as tall
   * as its content, so there is nothing below the button to hang into. Toggling
   * it re-measures the window instead of re-rendering the whole sheet.
   */
  _onMore(event, target) {
    const panel = this.element.querySelector(".sde-hxt-more-panel");
    if (!panel) return;
    this._moreOpen = panel.hidden;
    panel.hidden = !panel.hidden;
    target?.setAttribute("aria-expanded", String(this._moreOpen));
    target?.classList.toggle("sde-hxt-more-on", this._moreOpen);
    this.setPosition({ height: "auto" });
  }

  /**
   * Replace each named card with its own parts, as a legend of that card alone.
   * The card's cells are the only ones re-sorted, so the rest of the legend and
   * every answer already given stay exactly as they are.
   */
  /**
   * "These are not all the same" opens the card up instead of re-clustering it.
   *
   * It used to break the card into four smaller ones and ask again, which meant
   * another round of naming before anything was applied. Patrick: "I should be
   * able to tag what each of the hexes are right then instead of waiting for
   * some kind of other review." So the card now shows a spread of its own hexes,
   * each with its own answer, and those answers are hand tags on exactly those
   * hexes — the rest of the card is left to the classifier, which is what a
   * genuinely mixed card should get anyway.
   *
   * The spread is taken across the card's members rather than off the top:
   * members come nearest-the-centre first, so the first eight would all look
   * alike and show none of the mixing that made the GM say so.
   */
  /** Remember what every card's select currently says, so a re-render keeps it. */
  _readLegendAnswers() {
    for (const sel of this.element.querySelectorAll("select[data-hxt-legend]")) {
      const card = this._legend?.[Number(sel.dataset.idx)];
      if (!card) continue;
      const other = this.element.querySelector(`input[data-hxt-legend-other][data-idx="${sel.dataset.idx}"]`)?.value.trim();
      card.chosen = sel.value === "__other" ? (other || "") : sel.value;
    }
    for (const sel of this.element.querySelectorAll("select[data-hxt-pick]")) {
      const card = this._legend?.[Number(sel.dataset.idx)];
      if (!card) continue;
      const num = Number(sel.dataset.num);
      const other = this.element.querySelector(`input[data-hxt-pick-other][data-num="${num}"]`)?.value.trim();
      (card.picked ??= {})[num] = sel.value === "__other" ? (other || "") : sel.value;
    }
  }

  _expandCards(indices) {
    let opened = 0;
    for (const [idx, card] of this._legend.entries()) {
      if (!indices.includes(idx)) continue;
      const members = card.members ?? [];
      if (members.length < 2) { card.chosen = ""; continue; }
      const want = Math.min(EXPAND_PICKS, members.length);
      const step = members.length / want;
      const picks = [];
      for (let i = 0; i < want; i++) {
        const n = members[Math.min(members.length - 1, Math.floor(i * step))];
        if (!picks.includes(n)) picks.push(n);
      }
      card.expand = true; card.picks = picks; card.chosen = SPLIT;
      opened++;
    }
    if (!opened) ui.notifications?.warn(t("SDE.hexMap.notify.nothingToOpen"));
    else ui.notifications?.info(t("SDE.hexMap.notify.opened"));
    this.render();
  }

  /**
   * Take every hex the GM tagged by hand on ANOTHER scene of the same print and
   * bring it in as hand tags here.
   *
   * This is the feedback loop that was missing. A correction used to improve one
   * scene and die with it: a second go at the same map started from nothing and
   * the GM re-did work they had already done. Hand tags are exactly the
   * classifier's examples, so carrying them across is the whole of "the next
   * take starts better prepared" — the more maps you correct, the less there is
   * to correct.
   *
   * Printed numbers are the key, so this only makes sense between scenes of the
   * SAME print; the dialog says so. Hand tags already here are never overwritten.
   */
  async _onLearnFrom() {
    if (!this._requireCurrentScene()) return;
    const here = this._scene();
    const sources = game.scenes.contents
      .filter((s) => s.id !== here?.id)
      .map((s) => {
        const state = decodeTags(s.getFlag(MODULE_ID, TAGS_FLAG));
        let gm = 0;
        for (const c of state.cells.values()) if (c.source !== "auto" && c.terrain) gm++;
        return { id: s.id, name: s.name, gm, state };
      })
      .filter((s) => s.gm > 0)
      .sort((a, b) => b.gm - a.gm);
    if (!sources.length) { ui.notifications?.warn(t("SDE.hexMap.notify.noOtherScene")); return; }
    const esc = foundry.utils.escapeHTML;
    const chosen = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("SDE.hexMap.learn.title"), icon: "fa-solid fa-graduation-cap" },
      position: { width: 460 },
      content: `<form class="standard-form">
        <div class="form-group"><label>${t("SDE.hexMap.learn.from")}</label><div class="form-fields">
          <select name="scene">${sources.map((s) => `<option value="${s.id}">${t("SDE.hexMap.learn.option", { name: esc(s.name), gm: s.gm })}</option>`).join("")}</select>
        </div></div>
        <p class="hint">${t("SDE.hexMap.learn.hint")}</p>
      </form>`,
      ok: { label: t("SDE.hexMap.learn.ok"), callback: (_e, button) => new FormDataExtended(button.form).object.scene },
      rejectClose: false,
    });
    if (!chosen) return;
    const from = sources.find((s) => s.id === chosen);
    let added = 0, kept = 0;
    for (const [num, cell] of from.state.cells) {
      if (cell.source === "auto" || !cell.terrain) continue;
      if (this._numbered.size && !this._numbered.has(Number(num))) continue;   // not on this map
      const mine = this._state.cells.get(num);
      if (mine && mine.source !== "auto") { kept++; continue; }
      this._state.cells.set(num, { terrain: cell.terrain, overlays: [...(cell.overlays ?? [])], source: "gm" });
      added++;
    }
    if (!added) { ui.notifications?.warn(t("SDE.hexMap.notify.learnNothing", { from: from.name })); return; }
    await this._saveState();
    this._renumber();
    ui.notifications?.info(t("SDE.hexMap.notify.learnDone", { added, from: from.name, kept: kept ? t("SDE.hexMap.notify.learnKept", { kept }) : "" }));
    this.render();
  }

  /** The brush: pick a terrain once, then paint the wrong hexes on the map. */
  async _onBrush() {
    if (!this._requireCurrentScene()) return;
    (await import("./hex-brush-app.mjs")).HexBrushApp.open();
    this._overlayMode = "terrain";
    this.render();
  }

  /**
   * The scene's own answers drawn on the map for review (tag-overlay.mjs).
   *
   * Three pictures of the same map, one button each: the terrain tags, the
   * regions the border scan found, and whether a wandering check on each hex
   * would find a table. Pressing the picture that is up hides it; pressing
   * another switches to it.
   */
  async _onShowTags(event, target) {
    if (!this._requireCurrentScene()) return;
    const mode = target?.dataset?.mode ?? "terrain";
    const { HexTagOverlay } = await import("./tag-overlay.mjs");
    this._overlayMode = (await HexTagOverlay.toggle({ mode })) ? mode : "";
    this.render();
  }

  /**
   * The book's own answer for every keyed hex of the chosen crawl.
   *
   * The keyed summary prints the number, the terrain AND any river or path
   * ("1246  Tallow Jungle  Jungle, path  Bone Choir"), so these hexes never
   * needed guessing from the picture at all. Patrick: "an obvious answer for
   * keyed locations is we just scrape them from the pdf... the main thing with
   * keyed locations is rivers and paths."
   *
   * @returns {Map<number, {terrain:string, overlays:string[]}>}
   */
  _keyedFromBook() {
    const out = new Map();
    for (const doc of this._selectedEntries()) {
      for (const r of doc.getFlag(MODULE_ID, HEX_FLAG)?.keyed ?? []) {
        const n = hexNum(r.num), tag = rowTag(r);
        if (n !== null && tag) out.set(n, tag);
      }
    }
    return out;
  }

  /**
   * Write those answers onto the map, once, without ever overwriting the GM.
   * @returns {number} how many hexes the book answered that were not answered already
   */
  _applyBookKey() {
    let n = 0;
    for (const [num, tag] of this._keyedFromBook()) {
      const key = String(num);
      const had = this._state.cells.get(key);
      if (had?.source && had.source !== "auto" && had.terrain) continue;   // the GM's word wins
      this._state.cells.set(key, { terrain: tag.terrain, overlays: [...tag.overlays], source: "gm" });
      n++;
    }
    return n;
  }

  _keyedNumbers() {
    const out = new Set();
    for (const doc of this._selectedEntries()) {
      for (const r of doc.getFlag(MODULE_ID, HEX_FLAG)?.keyed ?? []) { const n = hexNum(r.num); if (n !== null) out.add(n); }
      for (const p of doc.pages.contents) { const n = hexNum(p.getFlag(MODULE_ID, HEX_FLAG)?.num); if (n !== null) out.add(n); }
    }
    return out;
  }

  async _prepareContext() {
    this._syncScene();
    if (!this._state) this._loadState();
    this._restoreSamples();
    if (!this._entries.length) await this._loadEntries();
    const scene = this._scene();
    const state = this._state;
    const total = this._numbered.size;
    const origin = state.origin;
    const sampled = this._cells.length > 0;
    // The printed terrain words, plus the things a hex can be that are not
    // terrain at all: the book's settlement sizes and a keyed location. The map
    // draws those as their own symbols, so they get their own cards, and having
    // to invent a word for them through "other…" is how "Keyed Location" ended
    // up as a free-text terrain on the first map that met them.
    const terrainValues = [...Object.values(TERRAIN_TAGS), ...Object.values(SETTLEMENTS), KEYED_TERRAIN];
    const terrainOptions = terrainValues.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

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
        const c = this._numbered.get(num); const cell = state.cells.get(String(num));
        const terrainOther = cell?.terrain && !terrainValues.includes(cell.terrain) ? cell.terrain : "";
        return {
          num, label: String(num).padStart(4, "0"), i: c?.i, j: c?.j, thumb: c ? this._thumb(c) : "",
          terrain: cell?.terrain ?? "", source: cell?.source ?? "", keyed: keyed.has(num),
          margin: cell?.margin !== undefined ? Number(cell.margin).toFixed(2) : "", review: !!cell?.review,
          overlays: Object.fromEntries(OVERLAYS.map((o) => [o, !!cell?.overlays?.includes(o)])),
          terrainOther,
          terrainOptions: [...terrainOptions, { value: "__other", label: t("SDE.hexMap.label.otherOption"), selected: !!terrainOther }]
            .map((o) => ({ ...o, selected: o.value === (terrainOther ? "__other" : (cell?.terrain ?? "")) })),
        };
      });
    }
    // The legend's cards: a few member pictures each, the select pre-filled
    // with what most of its members are tagged already (a re-run after fixes).
    const legend = this._legend?.map((cl, idx) => {
      const counts = new Map();
      for (const n of cl.members) {
        const cell = state.cells.get(String(n)); if (!cell?.terrain) continue;
        counts.set(cell.terrain, (counts.get(cell.terrain) ?? 0) + 1);
      }
      // A choice already made survives a split of some OTHER card.
      const majority = cl.chosen ?? ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "");
      const terrainOther = majority && majority !== SPLIT && !terrainValues.includes(majority) ? majority : "";
      const selected = terrainOther ? "__other" : majority;
      const pickOptions = (num) => {
        const was = cl.picked?.[num] ?? state.cells.get(String(num))?.terrain ?? "";
        const isOther = was && !terrainValues.includes(was);
        return [...terrainOptions, { value: "__other", label: t("SDE.hexMap.label.otherOption") }]
          .map((o) => ({ ...o, selected: o.value === (isOther ? "__other" : was) }));
      };
      return {
        idx, size: cl.size, terrainOther, split: cl.split ? cl.split : null,
        expand: !!cl.expand,
        picks: cl.expand ? (cl.picks ?? []).map((num) => {
          const c = this._numbered.get(num);
          const was = cl.picked?.[num] ?? "";
          return c ? { num, thumb: this._thumb(c), terrainOptions: pickOptions(num),
                       other: terrainValues.includes(was) ? "" : was } : null;
        }).filter(Boolean) : [],
        thumbs: cl.samples.map((n) => { const c = this._numbered.get(n); return c ? this._thumb(c) : ""; }).filter(Boolean),
        terrainOptions: [...terrainOptions, { value: "__other", label: t("SDE.hexMap.label.otherOption") }, { value: SPLIT, label: t("SDE.hexMap.label.notAllSame") }]
          .map((o) => ({ ...o, selected: o.value === selected })),
      };
    }) ?? null;
    // What to do next: nothing, once every numbered cell is tagged; the review queue is optional.
    const summary = summarize(state, total);
    let reviewCount = 0;
    const reviewMargin = this._log().margin;
    for (const n of this._numbered.keys()) { const c = state.cells.get(String(n)); if (c && c.source === "auto" && (c.review || (c.margin !== undefined && c.margin < reviewMargin))) reviewCount++; }
    // What the GM's own corrections say about that threshold (tag-corrections.mjs).
    const report = accuracyReport(this._log());
    // What was answered on the legend, so the record is visible rather than
    // buried in a flag: it is the input half of "how did this map go".
    const legendLog = legendReport(this._log());
    // And how the module's own first scan of this map is holding up against the
    // hexes the GM has checked since.
    const baseline = this._scene() ? baselineReport(decodeBaseline(this._scene().getFlag(MODULE_ID, BASELINE_FLAG)), state.cells) : null;
    // What widening it would COST: the queue's size at the suggested margin.
    // "Use 2.3" means nothing without "and the queue goes from 525 to 1514".
    if (report.suggested) {
      let n = 0;
      for (const num of this._numbered.keys()) {
        const c = state.cells.get(String(num));
        if (c && c.source === "auto" && (c.review || (c.margin !== undefined && c.margin < report.suggested))) n++;
      }
      report.suggestedCount = n;
    }
    // Exactly one button is the next thing to do, and it is the only primary
    // one on screen; the rest are there when you want them. Patrick, on the
    // old header: "so cluttered and I honestly have no clue what it is trying
    // to do" — six primary buttons, five of which could not act yet.
    const done = total > 0 && summary.untagged === 0;
    const primary = done ? "build" : (sampled && origin ? "legend" : "sample");
    return {
      legend, hasLegend: !!legend,
      primarySample: primary === "sample", primaryLegend: primary === "legend", primaryBuild: primary === "build",
      showMore: sampled || !!origin, moreOpen: !!this._moreOpen,
      // A control appears when it can do something and not before. Patrick, on
      // a scene with nothing tagged yet: "Half this shit I don't even know what
      // it does." Most of it could not have done anything for him at that point.
      hasTags: summary.tagged > 0,               // tags to draw, paint over or send
      // The region picture needs the scanned enclosures and NOTHING else — not
      // terrain, not a hex key, not even a re-read of the image. Gating it on
      // hasTags hid it on exactly the map it exists to check: one just scanned,
      // with no terrain decided yet.
      hasRegions: decodeRegions(this._scene()?.getFlag(MODULE_ID, REGIONS_FLAG)).size > 0,
      canSheet: summary.untagged > 0 || summary.auto > 0,   // hexes to tag or to check
      hasKey: this._entries.length > 0,          // a book text to attach
      artCount: Object.keys(this._artAssignments()).length,
      done, reviewCount, reviewMargin: reviewMargin.toFixed(2), report: report.judged ? report : null,
      legendLog,
      // The queue is ordered worst-first, so the only question the GM has is
      // when to stop. This answers it: what this sheet is expected to contain.
      sheetExpected: Math.round(sheetRisk(state, this._sheet).expected),
      baseline: baseline?.checked >= 20 ? baseline : null, noCrawl: this._entries.length > 0 && !this._entryUuid,
      sceneName: scene?.name ?? "(no scene)", sampled, cellCount: this._cells.length, numberedCount: total,
      summary, origin, originText: origin ? `${String(origin.num).padStart(4, "0")} at grid ${origin.i},${origin.j}` : "",
      boundsCols: origin?.bounds?.cols ?? "", boundsRows: origin?.bounds?.rows ?? "", skipTopRow: framesTopRow(origin?.bounds),
      mode: this._mode, modes: [["random", "SDE.hexMap.mode.random"], ["keyed", "SDE.hexMap.mode.keyed"], ["review", "SDE.hexMap.mode.review"]]
        .map(([v, k]) => ({ value: v, label: t(k), selected: v === this._mode })),
      entries: this._entries.map((e) => ({ uuid: e.uuid, name: e.name, selected: e.uuid === this._entryUuid })),
      allCrawls: this._entries.length > 1, allSelected: this._entryUuid === ALL_CRAWLS,
      sheet, hasSheet: sheet.length > 0, needsOrigin: sampled && !origin, viaExtras: !!extrasHexApi(), error: this._error,
      overlays: OVERLAYS, overlayShown: !!this._overlayMode, overlayMode: this._overlayMode ?? "",
      canClassify: !!origin && summarize(state, this._numbered.size || state.cells.size).gm > 0, sensitivity: this._sensitivity, progress: this._progress,
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
      if (++k % 200 === 0) { this._setProgress(t("SDE.hexMap.progress.reading", { k, total })); await new Promise((r) => setTimeout(r, 0)); }
    }
    this._setProgress("");
  }

  /**
   * Read the print's region borders and keep the enclosures on the scene.
   *
   * Only the SHAPES are stored. Which region each enclosure is comes from the
   * crawl's keyed rows at read time (hex-region.mjs), so importing a book's key
   * locations after the map was scanned names every hex on it without a
   * re-scan — and a map scanned before the book is imported is not wasted.
   * @returns {Promise<number>} how many enclosures were found
   */
  async _onScanRegions() {
    const scene = this._scene();
    if (!scene || !this._geom || !this._numbered.size) return 0;
    await this._ensureBitmaps();
    this._setProgress(t("SDE.hexMap.progress.regions"));
    const { components } = scanRegions(this._numbered, this._bitmaps, {
      cellW: this._geom.cellW, cellH: this._geom.cellH,
      shifted: this._state?.origin?.shifted ?? "odd",
    });
    this._setProgress("");
    if (!components.size) return 0;
    await replaceModuleFlag(scene, REGIONS_FLAG, encodeRegions(components));
    const total = new Set(components.values()).size;
    // Say what it found in the terms the GM can act on: how many of the
    // enclosures the book can name, and whether any of them ran together.
    const { regions } = nameComponents(components, regionSeeds(this._selectedEntries()));
    const conflicts = [...regions.values()].filter((r) => r.conflict.length).length;
    ui.notifications?.info(t("SDE.hexMap.notify.regionsFound", { total, named: regions.size }));
    if (conflicts) ui.notifications?.warn(t("SDE.hexMap.notify.regionsConflict", { n: conflicts }));
    return total;
  }

  /**
   * Classify every cell without a hand tag from the hand-tagged ones; unsure
   * results are marked for the Review queue. Keyed hexes are left alone.
   */
  async _onClassify() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    if (!this._state.origin) { ui.notifications?.warn(t("SDE.hexMap.notify.setAnchor")); return; }
    const sens = parseFloat(this.element.querySelector("input[data-hxt-sensitivity]")?.value);
    this._sensitivity = Number.isFinite(sens) && sens > 0 ? sens : 1;
    // Sampling is a precondition of classifying, not a decision: do it rather
    // than hide the button behind it. Patrick, with 111 corrections in hand and
    // the note telling him to classify: "I don't see any way to run classify."
    if (!this._cells.length && !(await this._onSample())) return;
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
    // The book answers its own keyed hexes, terrain and overlays both, so they
    // are tagged from the page before anything is guessed from the picture.
    const fromBook = this._applyBookKey();
    if (fromBook) ui.notifications?.info(t(fromBook === 1 ? "SDE.hexMap.notify.bookOne" : "SDE.hexMap.notify.bookMany", { n: fromBook }));
    const gm = [...this._state.cells.entries()].filter(([num, c]) => c.source !== "auto" && !keyed.has(Number(num)));
    if (!gm.length) { ui.notifications?.warn(t("SDE.hexMap.notify.classifyNeedsTags")); return false; }
    await this._ensureBitmaps();
    if (!this._requireCurrentScene()) return false;
    // Keyed hexes carry a star or settlement icon over their glyph, which the
    // residual reads as a river (120 of 144 on the live check). Their terrain
    // comes from the book's text, so they must be left out — and that needs the
    // crawl entry to be chosen.
    if (!keyed.size && this._entries.length) ui.notifications?.warn(t("SDE.hexMap.notify.noHexKey"));
    const exemplars = gm.map(([num, c]) => ({ num: Number(num), tag: c.terrain, overlays: c.overlays ?? [], bitmap: this._bitmaps.get(Number(num)) })).filter((e) => e.bitmap);
    const cells = [...this._numbered.keys()]
      .filter((n) => !keyed.has(n) && (overlayOnly.has(n) || (this._state.cells.get(String(n))?.source ?? "auto") === "auto"))
      .map((n) => ({ num: n, bitmap: this._bitmaps.get(n) })).filter((c) => c.bitmap);
    this._setProgress(t("SDE.hexMap.progress.preparing", { n: exemplars.length })); await new Promise((r) => setTimeout(r, 0));
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
      if (++done % 100 === 0) { this._setProgress(t("SDE.hexMap.progress.classifying", { done, total: cells.length })); await new Promise((r) => setTimeout(r, 0)); }
    }
    if (!this._requireCurrentScene()) return false;
    // Let the map correct the cells: a guess its neighbours all disagree with is
    // almost certainly wrong, and nothing about a single hex can see that.
    const shifted = this._state.origin?.shifted ?? "odd";
    const fixes = smoothTerrain(this._state.cells, (n) => neighbours(Math.floor(n / 100), n % 100, shifted));
    for (const f of fixes) {
      const cell = this._state.cells.get(f.num);
      if (cell) this._state.cells.set(f.num, { ...cell, terrain: f.to });
    }
    // A coastline is a line SHARED between two hexes, so the classifier reads
    // it badly; sea, lake and river it reads well. So the coast is derived from
    // the terrain rather than detected from the ink, once the terrain has
    // settled — after the smoothing, because a hex the neighbours just turned
    // into water makes its neighbours coast too. GM-tagged hexes get it as
    // well: a GM names the terrain, and the coast follows from the neighbours.
    const coasts = deriveCoasts(this._state);
    await this._saveState();
    // The first scan of a map is written down once and never again: it is the
    // only record of what the module made of it unaided, and every correction
    // from here overwrites the working tags.
    const scene = this._scene();
    if (scene && !scene.getFlag(MODULE_ID, BASELINE_FLAG)) {
      await replaceModuleFlag(scene, BASELINE_FLAG, encodeBaseline(this._state.cells, { from: "classify" }));
    }
    // The verdicts describe the run that has just been replaced: its guesses and
    // its margins are gone, so keeping them would report the accuracy of a
    // classifier that no longer exists — and keep advising a re-classify that
    // has already happened. The corrections themselves are not lost; they are
    // the hand tags this run was built from. The review margin is kept.
    const log = this._log();
    if (log.fixes.size || log.seen.size) {
      const fresh = { ...emptyLog(), margin: log.margin };
      await replaceModuleFlag(this._scene(), FIXES_FLAG, encodeFixes(fresh));
    }
    this._setProgress("");
    this._mode = "review";
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: "review", reviewMargin: this._log().margin });
    ui.notifications?.info(t("SDE.hexMap.notify.classified", { auto, examples: exemplars.length, fixes: fixes.length, coasts: coasts.length, review }));
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
    if (!this._state.origin) { ui.notifications?.warn(t("SDE.hexMap.notify.setAnchor")); return; }
    // Reads the map itself when it has to, like Classify. A reload empties the
    // in-page pictures, and a Legend hidden behind that is a Legend the GM
    // cannot get back to — which is exactly how Patrick lost his cards.
    if (!this._numbered.size && !(await this._onSample())) return;
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
    const answers = {}, cores = new Set(), splits = [];
    for (const sel of this.element.querySelectorAll("select[data-hxt-legend]")) {
      const idx = Number(sel.dataset.idx), card = this._legend[idx];
      if (!card) continue;
      const other = this.element.querySelector(`input[data-hxt-legend-other][data-idx="${idx}"]`)?.value.trim();
      const terrain = sel.value === "__other" ? other : sel.value;
      card.chosen = sel.value === "__other" ? (other || "") : sel.value;    // survives a re-render
      if (terrain === SPLIT) { splits.push(idx); continue; }
      if (!terrain) continue;
      // No overlays here: a card is a terrain. Rivers, paths and coasts are
      // found cell by cell by the classifier, and ticking them on a card only
      // stamped its dozen core cells with whatever the pictures happened to show.
      for (const n of card.core) { answers[n] = { terrain, overlays: [] }; cores.add(n); }
    }
    // An opened card's hexes are answered one at a time, and each answer is a
    // hand tag on that hex alone.
    for (const sel of this.element.querySelectorAll("select[data-hxt-pick]")) {
      const num = Number(sel.dataset.num);
      const other = this.element.querySelector(`input[data-hxt-pick-other][data-num="${num}"]`)?.value.trim();
      const terrain = sel.value === "__other" ? other : sel.value;
      const card = this._legend[Number(sel.dataset.idx)];
      if (card) (card.picked ??= {})[num] = sel.value === "__other" ? (other || "") : sel.value;
      if (!terrain || terrain === SPLIT) continue;
      answers[num] = { terrain, overlays: [] }; cores.add(num);
    }
    // "These are not all the same" is the one thing only the GM can see. Take it
    // literally: open that card up so its hexes can be answered individually,
    // applying nothing this pass so no answer is acted on while it is in question.
    if (splits.length) { this._expandCards(splits); return; }
    // What was ANSWERED, written down before anything acts on it. Everything
    // else in the log records what the classifier did; this records what it was
    // told, which is the half that was missing when a run came out badly.
    const answered = this._legend.map((c) => ({
      size: c.size, core: c.core ?? [], opened: !!c.expand,
      name: c.chosen === SPLIT ? "" : (c.chosen ?? ""),
    }));
    this._legendAnswered = answered;
    // A mis-named card is the most expensive mistake on this screen, and the
    // cards can check each other: one named jungle should look like the other
    // jungle cards.
    const { suspectCardNames } = await import("./legend.mjs");
    const suspects = suspectCardNames(this._legend.map((c, idx) => ({ idx, name: c.chosen, size: c.size, centroid: c.centroid })));
    if (suspects.length) {
      const esc = foundry.utils.escapeHTML;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("SDE.hexMap.suspect.title") },
        content: `<p>${t("SDE.hexMap.suspect.lead")}</p>
          <ul>${suspects.map((sp) => `<li>${t("SDE.hexMap.suspect.row", { size: sp.size, name: esc(sp.name), times: sp.times, looksLike: esc(sp.looksLike) })}</li>`).join("")}</ul>
          <p>${t("SDE.hexMap.suspect.why")}</p>`,
        yes: { label: t("SDE.hexMap.btn.applyAnyway") }, no: { label: t("SDE.hexMap.btn.goBackLook") }, rejectClose: false, modal: true,
      });
      if (!ok) return;
    }
    if (!cores.size) { ui.notifications?.warn(t("SDE.hexMap.notify.nameOneCard")); return; }
    // A big card left unnamed is the expensive mistake and it is silent: its
    // cells are guessed from the OTHER cards, so a whole terrain with no card
    // named for it lands on whatever looks closest. On the Western Reaches a
    // card of 165 cells that was 100% river went unnamed, and 149 of those
    // hexes came back as desert.
    // An OPENED card is not unnamed: the GM answered its hexes one by one and
    // meant the rest to be guessed. Warning about it is the false alarm Patrick
    // hit — "Got a pop up about 1 being unnamed but I reviewed twice and they
    // were all named."
    const handled = (c) => (c.chosen && c.chosen !== SPLIT) || c.expand;
    const big = this._legend.filter((c) => !handled(c) && c.size >= Math.max(20, Math.round(this._numbered.size * 0.01)));
    if (big.length) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("SDE.hexMap.unnamed.title") },
        content: `<p>${t(big.length === 1 ? "SDE.hexMap.unnamed.one" : "SDE.hexMap.unnamed.many", { cards: big.length, hexes: big.reduce((a, c) => a + c.size, 0), largest: Math.max(...big.map((c) => c.size)) })}</p>
          <p>${t("SDE.hexMap.unnamed.why")}</p>`,
        yes: { label: t("SDE.hexMap.btn.applyAnyway") }, no: { label: t("SDE.hexMap.btn.goBack") }, rejectClose: false, modal: true,
      });
      if (!ok) return;
    }
    applySheet(this._state, answers);
    // Persist the answers beside the corrections, and freeze a baseline if this
    // map has never had one: a scene that is only ever legended used to leave no
    // record of what the module managed at all.
    try {
      const scene = this._scene();
      if (scene && this._legendAnswered) {
        const log = decodeFixes(scene.getFlag(MODULE_ID, FIXES_FLAG));
        recordLegend(log, this._legendAnswered);
        await replaceModuleFlag(scene, FIXES_FLAG, encodeFixes(log));
      }
    } catch (err) { console.warn(`${MODULE_ID} | could not record the legend`, err); }
    await this._saveState();
    this._legend = null;
    if (!(await this._classify(cores))) {
      this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers(), reviewMargin: this._log().margin });
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

  /** @returns {Promise<boolean>} whether the scene's cells are now in hand */
  async _onSample() {
    this._syncScene();
    this._error = "";
    const geom = sceneCells(canvas);
    if (geom.error) { this._error = t(geom.error); this.render(); return false; }
    try {
      const image = await sourceImage(canvas);
      if (!this._requireCurrentScene()) return false;
      this._sampler = new CellSampler(image, geom, { size: BITMAP_SIZE });
      this._geom = geom; this._cells = geom.cells; this._bitmaps = new Map(); this._legend = null;
      if (!this._cells.length) throw new Error(t("SDE.hexMap.error.noCells"));
      this._sampler.bitmap(this._cells[0]);            // tainted-canvas check: throws on a cross-origin image
    } catch (err) {
      this._error = /SecurityError|tainted|insecure/i.test(String(err)) ? t("SDE.hexMap.error.tainted") : String(err?.message ?? err);
      this._cells = []; this.render(); return false;
    }
    this._loadState(); this._renumber();
    // Keep them for the next time this window is opened on this scene: they are
    // read from the image, not from the document, so a fresh instance would
    // otherwise show no Legend and no Classify until a 14-second re-read.
    HexTaggerApp._samples.set(this._scene()?.id, { geom, cells: this._cells, sampler: this._sampler });
    if (this._state.origin) this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers(), reviewMargin: this._log().margin });
    this.render();
    return true;
  }

  async _onNextSheet() {
    if (!this._requireCurrentScene()) return;
    this._readHeader();
    if (!this._numbered.size) { ui.notifications?.warn(t("SDE.hexMap.notify.readAndAnchor")); return; }
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers(), reviewMargin: this._log().margin });
    if (!this._sheet.length) ui.notifications?.info(this._mode === "random" ? t("SDE.hexMap.notify.allTagged") : t("SDE.hexMap.notify.noneInMode"));
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
    // Every cell on the sheet was looked at, so every one is a verdict on the
    // classifier — the corrections AND the ones left alone (tag-corrections.mjs).
    const verdicts = applySheet(this._state, answers);
    await this._saveState();
    await this._recordVerdicts(verdicts);
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers(), reviewMargin: this._log().margin });
    this.render();
  }

  /**
   * Keep what the GM judged, before the classifier's guess is overwritten.
   * Its own scene flag, so the tag flag's wholesale write never touches it.
   */
  async _recordVerdicts(transitions) {
    const scene = this._scene();
    if (!scene) return;
    const log = decodeFixes(scene.getFlag(MODULE_ID, FIXES_FLAG));
    const { judged } = recordEdits(log, transitions);
    if (!judged) return;
    await replaceModuleFlag(scene, FIXES_FLAG, encodeFixes(log));
  }

  /** Anchor: the GM typed the printed number of one cell on the alignment sheet. */
  async _onSetNumber(event, target) {
    if (!this._requireCurrentScene()) return;
    const i = Number(target.dataset.i), j = Number(target.dataset.j);
    const input = this.element.querySelector(`input[data-hxt-number][data-i="${i}"][data-j="${j}"]`);
    const num = String(input?.value ?? "").trim();
    if (!/^\d{3,4}$/.test(num)) { ui.notifications?.warn(t("SDE.hexMap.notify.typeNumber")); return; }
    const cell = this._cells.find((c) => c.i === i && c.j === j);
    if (!cell) return;
    const shifted = this.element.querySelector("select[data-hxt-shifted]")?.value === "even" ? "even" : "odd";
    this._state.origin = { i, j, q: cell.cube.q, r: cell.cube.r, num, shifted, bounds: this._state.origin?.bounds ?? null };
    await this._saveState();
    this._renumber();
    this._sheet = nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers(), reviewMargin: this._log().margin });
    this.render();
  }

  /** Map size in cells, so cells past the hex field (margins, legend) are skipped. */
  async _onSetBounds() {
    if (!this._requireCurrentScene()) return;
    if (!this._state.origin) { ui.notifications?.warn(t("SDE.hexMap.notify.setAnchor")); return; }
    const cols = parseInt(this.element.querySelector("input[data-hxt-cols]")?.value, 10);
    const rows = parseInt(this.element.querySelector("input[data-hxt-rows]")?.value, 10);
    const skipTop = !!this.element.querySelector("input[data-hxt-skip-top]")?.checked;
    // The lowered columns keep ending the same number of rows short (the image flow found that).
    const old = this._state.origin.bounds;
    const short = old?.rowsLowered && old.rows ? old.rows - old.rowsLowered : 0;
    this._state.origin.bounds = (cols > 0 && rows > 0)
      ? { cols, rows, ...(short > 0 && rows > short ? { rowsLowered: rows - short } : {}), ...(skipTop ? { firstRow: 1 } : {}) }
      : null;
    this._renumber();
    // Cells that just stopped being on the map keep no tags: they are frame, and
    // leaving them would send margin to Extras and keep serving them for review.
    //
    // ONLY when the scene has been sampled. Without its cells _numbered is empty,
    // so "not numbered any more" would mean every cell on the map, and applying
    // bounds from a freshly opened tagger would delete the lot.
    let dropped = 0;
    if (this._cells.length) {
      for (const num of [...this._state.cells.keys()]) if (!this._numbered.has(Number(num))) { this._state.cells.delete(num); dropped++; }
    }
    await this._saveState();
    this._sheet = this._sheet.filter((n) => this._numbered.has(n));
    if (dropped) ui.notifications?.info(t("SDE.hexMap.notify.dropped", { n: dropped }));
    else if (!this._cells.length) ui.notifications?.info(t("SDE.hexMap.notify.boundsSet"));
    this.render();
  }

  /**
   * The hand-off dataset for this map: its tags, the chosen crawl's keyed
   * pages, the GM's tile art and every hex's region. Null after telling the GM
   * why there is none.
   * @returns {Promise<{dataset:object, tags:object, chosen:JournalEntry[]}|null>}
   */
  async _handoffDataset() {
    if (!this._requireCurrentScene()) return null;
    this._readHeader();
    if (!this._state.origin) { ui.notifications?.warn(t("SDE.hexMap.notify.setAnchor")); return null; }
    const tags = tagsForDataset(this._state);
    const b = this._state.origin.bounds;
    // The numbering origin is NOT taken from the in-memory sample. It used to
    // be — "does any sampled cell sit in column 0 or row 0" — and the sample is
    // dropped on a reload while the tags are not. Sending the dataset without
    // re-reading the map therefore produced `origin: 1` over hexes numbered
    // from 0, and Extras rejected the first one: "hex 1 is outside the
    // published grid". buildHexDataset works it out from the hexes it is about
    // to emit, which cannot disagree with them.
    const gridHint = b?.cols ? { cols: b.cols, rows: b.rows, firstRow: b.firstRow, rowsLowered: b.rowsLowered } : undefined;
    const chosen = this._selectedEntries();
    const assignments = this._artAssignments();
    // Every hex's region as its Extras zone, from this print's border scan.
    // Only the tagged hexes: a scan older than the bounds can still hold
    // margin cells, and one hex outside the grid fails the whole build.
    const { sceneZones } = await import("./hex-region.mjs");
    const zones = new Map([...(await sceneZones(this._scene())).byNum].filter(([num]) => tags[String(num).padStart(3, "0")]));
    const dataset = chosen.length ? datasetFromEntries(chosen, { tags, gridHint, assignments, zones })
      : buildHexDataset({ name: this._scene()?.name ?? t("SDE.hexMap.app.defaultName"), source: "", tags, assignments, zones, gridHint });
    const check = validateHexDataset(dataset);
    if (!check.ok) { ui.notifications?.error(t("SDE.hexMap.notify.datasetInvalid", { error: check.errors[0] })); console.warn(`${MODULE_ID} | hex dataset`, check.errors); return null; }
    return { dataset, tags, chosen };
  }

  /**
   * Send to Extras: put the hex details on THIS map (shadowdark-enhancer#175).
   * Extras adopts the print and takes every hex's record; nothing is painted,
   * so the publisher's art and the pins stay. Without Extras the dataset
   * downloads, as before. Building a separate painted scene is under More.
   */
  async _onBuildDataset() {
    const built = await this._handoffDataset();
    if (!built) return;
    const { dataset, tags } = built;
    const cells = Object.keys(tags).length;
    if (!extrasHexApi()) {
      const res = await handoffDataset(dataset);
      if (res.via === "download") ui.notifications?.info(t("SDE.hexMap.notify.downloaded", { file: res.filename, hexes: dataset.hexes.length, cells, art: "" }));
      return;
    }
    const base = dataset.grid.origin ?? 1;
    if (!extrasNumbersAlike(this._originForGeometry(), base)) {
      ui.notifications?.warn(t("SDE.hexMap.notify.notTopLeft", { first: base ? "0101" : "0000" }));
      return;
    }
    const res = await handoffToPrint(this._scene().id, dataset);
    if (res.via === "extras") {
      const hexes = res.summary?.records ?? dataset.hexes.length;
      ui.notifications?.info(t(res.adopted ? "SDE.hexMap.notify.onPrintFirst" : "SDE.hexMap.notify.onPrint", { hexes }));
    } else if (res.reason === "no-adopt") ui.notifications?.warn(t("SDE.hexMap.notify.needsAdopt"));
    else if (res.reason === "extras-error" && res.error) ui.notifications?.error(t("SDE.hexMap.notify.adoptFailed", { error: res.error }));
  }

  /** Build painted map (More): a new Extras scene painted from the tags, the hand-off before #175. */
  async _onBuildPainted() {
    const built = await this._handoffDataset();
    if (!built) return;
    const { dataset, tags, chosen } = built;
    if (Object.values(tags).some((tag) => tag.overlays?.includes("coast"))) {
      ui.notifications?.warn(t("SDE.hexMap.notify.coastStays"));
    }
    // The painted scene must not share the print scene's name.
    const res = await handoffDataset(dataset, { sceneName: chosen.length ? dataset.name : `${dataset.name} (painted)` });
    const n = Object.keys(tags).length;
    const painted = dataset.hexes.filter((h) => h.art).length;
    const art = painted ? t("SDE.hexMap.notify.withArt", { n: painted }) : "";
    if (res.via === "extras") ui.notifications?.info(t("SDE.hexMap.notify.sent", { name: dataset.name, hexes: dataset.hexes.length, cells: n, art }));
    else if (res.via === "download") ui.notifications?.info(t("SDE.hexMap.notify.downloaded", { file: res.filename, hexes: dataset.hexes.length, cells: n, art }));
  }

  /** Side door in: a CSV (hex_id, tags or terrain_tags, source) or a JSON (the exported tag flag, or a dataset). */
  async _onImport() {
    if (!this._requireCurrentScene()) return;
    const file = await foundry.applications.api.DialogV2.wait({
      window: { title: t("SDE.hexMap.import.title") },
      content: `<p>${t("SDE.hexMap.import.hint")}</p>
        <input type="file" name="hex-tags-file" accept=".csv,.json,text/csv,application/json">`,
      buttons: [
        { action: "load", label: t("SDE.hexMap.btn.import"), default: true, callback: (ev, button, dialog) => (dialog.element ?? dialog)?.querySelector?.("input[name='hex-tags-file']")?.files?.[0] ?? null },
        { action: "cancel", label: t("SDE.hexMap.btn.cancel") },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!file || file === "cancel") return;
    let text;
    try { text = await file.text(); } catch (err) { ui.notifications?.error(t("SDE.hexMap.notify.readFailed", { file: file.name, error: err.message })); return; }
    let rows, origin = null;
    if (/^\s*[{[]/.test(text)) {
      let obj;
      try { obj = JSON.parse(text); } catch (_e) { ui.notifications?.error(t("SDE.hexMap.notify.badJson", { file: file.name })); return; }
      ({ rows, origin } = rowsFromJson(obj));
    } else {
      rows = parseTruthCsv(text);
    }
    if (!rows.length) { ui.notifications?.warn(t("SDE.hexMap.notify.importEmpty", { file: file.name })); return; }
    if (!this._requireCurrentScene()) return;
    const n = importTags(this._state, rows, { origin });
    await this._saveState();
    this._renumber();
    this._sheet = this._numbered.size ? nextSheet(this._state, { nums: [...this._numbered.keys()], size: SHEET_SIZE, mode: this._mode, keyed: this._keyedNumbers() }) : [];
    ui.notifications?.info(t("SDE.hexMap.notify.imported", { n, file: file.name }));
    this.render();
  }

  /**
   * Load the GM's own tile-art manifest for this map.
   *
   * Which hex gets which painted tile is curated by hand outside this module,
   * and it stays the GM's: the file is read, normalised and kept on the scene,
   * and nothing from it ships here. It travels with the dataset at hand-off and
   * Extras drops it again before writing the hex records — it paints, and that
   * is all it does.
   */
  async _onArtManifest() {
    if (!this._requireCurrentScene()) return;
    const file = await foundry.applications.api.DialogV2.wait({
      window: { title: t("SDE.hexMap.art.title") },
      content: `<p>${t("SDE.hexMap.art.hint")}</p>
        <p>${t("SDE.hexMap.art.skipped")}</p>
        <input type="file" name="hex-art-file" accept=".json,application/json">`,
      buttons: [
        { action: "load", label: t("SDE.hexMap.btn.load"), default: true, callback: (ev, button, dialog) => (dialog.element ?? dialog)?.querySelector?.("input[name='hex-art-file']")?.files?.[0] ?? null },
        { action: "clear", label: t("SDE.hexMap.btn.forgetArt") },
        { action: "cancel", label: t("SDE.hexMap.btn.cancel") },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!file || file === "cancel") return;
    const scene = this._scene();
    if (!scene) return;
    if (file === "clear") {
      await replaceModuleFlag(scene, ART_FLAG, null);
      ui.notifications?.info(t("SDE.hexMap.notify.artForgotten"));
      this.render();
      return;
    }
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch (err) { ui.notifications?.error(t("SDE.hexMap.notify.readFailed", { file: file.name, error: err.message })); return; }
    const assignments = assignmentsFromManifest(obj);
    const kept = Object.keys(assignments).length;
    if (!kept) { ui.notifications?.warn(t("SDE.hexMap.notify.artEmpty", { file: file.name })); return; }
    const total = Array.isArray(obj) ? obj.length : Object.keys(obj ?? {}).length;
    await replaceModuleFlag(scene, ART_FLAG, assignments);
    const icons = Object.values(assignments).filter((a) => a.icon).length;
    ui.notifications?.info(t("SDE.hexMap.notify.artLoaded", { kept, total, icons, skipped: total > kept ? t("SDE.hexMap.notify.artSkipped", { n: total - kept }) : "" }));
    this.render();
  }

  /** The tile art loaded for this scene, if any. */
  _artAssignments() {
    return this._scene()?.getFlag?.(MODULE_ID, ART_FLAG) ?? {};
  }

  /** Side door out: the raw tag flag as JSON (re-importable here; the dataset is Build dataset's job). */
  _onExport() {
    if (!this._requireCurrentScene()) return;
    const scene = this._scene();
    if (!this._state.cells.size) { ui.notifications?.warn(t("SDE.hexMap.notify.noTagsToExport")); return; }
    const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
    save(JSON.stringify(encodeTags(this._state), null, 2), "text/json", `${(scene?.name ?? "hex-map").slugify()}-hex-tags.json`);
  }

  /** Image-pixel box of the numbered cells: the print's hex field. */
  _imageCellBox() {
    if (!this._geom) return null;
    return cellBoxOf([...this._numbered.values()].map((c) => ({ x: c.u, y: c.v })), this._geom.cellW, this._geom.cellH);
  }

  /** Put this scene's print on `target` so the hex field covers its first cols × rows cells. */
  async _placeReferenceOn(target, src = this._scene()?.background?.src, { asMap = false } = {}) {
    const b = this._state.origin?.bounds;
    const imageBox = this._imageCellBox();
    if (!b?.cols || !imageBox) { ui.notifications?.warn(t("SDE.hexMap.notify.sampleFirst")); return null; }
    if (!src) { ui.notifications?.warn(t("SDE.hexMap.notify.noBackground")); return null; }
    const sceneBox = gridCellBox(target, b.cols, b.rows);
    if (!sceneBox) { ui.notifications?.warn(t("SDE.hexMap.notify.noHexGrid", { name: target.name })); return null; }
    const tf = this._geom.transform;
    const placement = referenceTilePlacement({ x: 0, y: 0, w: tf.texW, h: tf.texH }, imageBox, sceneBox);
    const tile = await placeReferenceTile(target, src, placement, { asMap });
    const shifted = this._state.origin.shifted ?? "odd", lowered = loweredColumns(target);
    if (lowered !== shifted) ui.notifications?.warn(t("SDE.hexMap.notify.parityMismatch", { name: target.name, lowered, shifted }));
    ui.notifications?.info(t("SDE.hexMap.notify.referencePlaced", { name: target.name }));
    return tile;
  }

  /** By hand: pick any other hex-columns scene (the one Extras built from the downloaded dataset, say). */
  async _onReferenceTile() {
    if (!this._requireCurrentScene()) return;
    const here = this._scene();
    const targets = game.scenes.filter((s) => s.id !== here?.id && s.grid?.isHexagonal && s.grid.columns).sort((a, b) => a.name.localeCompare(b.name));
    if (!targets.length) { ui.notifications?.warn(t("SDE.hexMap.notify.noTargetScene")); return; }
    const options = targets.map((s) => `<option value="${s.id}">${foundry.utils.escapeHTML(s.name)}</option>`).join("");
    const id = await foundry.applications.api.DialogV2.wait({
      window: { title: t("SDE.hexMap.btn.reference") },
      content: `<p>${t("SDE.hexMap.reference.hint", { cols: this._state.origin?.bounds?.cols ?? "?", rows: this._state.origin?.bounds?.rows ?? "?" })}</p>
        <label>${t("SDE.hexMap.reference.scene")} <select name="hex-ref-target">${options}</select></label>
        <div class="form-group"><div class="form-fields"><label class="checkbox" title="${t('SDE.hexMap.tip.asMap')}"><input type="checkbox" name="hex-ref-as-map"> ${t("SDE.hexMap.reference.asMap")}</label></div></div>`,
      buttons: [
        { action: "place", label: t("SDE.hexMap.btn.place"), default: true, callback: (ev, button, dialog) => {
          const root = dialog.element ?? dialog;
          return { id: root?.querySelector?.("select[name='hex-ref-target']")?.value ?? null, asMap: !!root?.querySelector?.("input[name='hex-ref-as-map']")?.checked };
        } },
        { action: "cancel", label: t("SDE.hexMap.btn.cancel") },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!id || id === "cancel" || !id.id) return;
    if (!this._requireCurrentScene()) return;
    const target = game.scenes.get(id.id);
    if (target) await this._placeReferenceOn(target, undefined, { asMap: id.asMap });
  }

  async _onClearTags() {
    if (!this._requireCurrentScene()) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("SDE.hexMap.clear.title") },
      content: `<p>${t("SDE.hexMap.clear.confirm", { scene: foundry.utils.escapeHTML(this._scene()?.name ?? "") })}</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (!ok) return;
    if (!this._requireCurrentScene()) return;
    await this._scene()?.unsetFlag(MODULE_ID, TAGS_FLAG);
    this._loadState(); this._bitmaps.clear(); this._renumber(); this._sheet = []; this._legend = null;
    this.render();
  }
}
