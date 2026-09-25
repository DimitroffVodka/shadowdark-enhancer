/**
 * Shadowdark Enhancer — the tag overlay: the scene's hex tags drawn on the map.
 *
 * Patrick's complaint about the tagger: "it is really hard to review the data
 * afterwards to see if it is correct". A contact sheet shows 40 cells out of
 * 4768; the map shows all of them at once. This draws one translucent fill per
 * numbered cell coloured by its terrain, a dot per overlay (river, path,
 * coast) and an amber outline around the automatic cells the classifier is
 * unsure of, so a wrong patch is a stain you can see from the whole-map zoom.
 * Hovering a cell names it; clicking one edits its tags in place through the
 * same store write the tagger uses.
 *
 * Everything is ONE PIXI.Graphics in the interface group — 4768 Drawing
 * documents would be a different kind of mistake. Cell centres come from
 * sceneCells and cellNumber on the scene's stored anchor, so no image is read
 * and the overlay works without the tagger open. zIndex 1 keeps it above the
 * grid and below regions, tokens and notes, which therefore still take their
 * own clicks. Phase 6 of docs/plans/hex-map-dataset.md.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { sceneCells } from "./sampler.mjs";
import { cellNumber, foundryOffsetToCube } from "./geometry.mjs";
import { decodeTags, encodeTags, applySheet, strandedRiver, OVERLAYS } from "./tag-store.mjs";
import { FIXES_FLAG, DEFAULT_REVIEW_MARGIN, decodeFixes, encodeFixes, recordEdits, withdrawEdits, sameTags } from "./tag-corrections.mjs";
import { TERRAIN_TAGS, SETTLEMENTS } from "../importer/hex/hex-summary.mjs";
import { pickZoneTable, encounterZonesByRegion } from "../encounter/encounter-terrain.mjs";
import { neighbourNumbers, encodeRegions, REGIONS_FLAG } from "./region-scan.mjs";

/** Scene flag key holding the tag store (hex-tagger-app.mjs owns it; the literal avoids an import cycle). */
const TAGS_FLAG = "hexTags";

/**
 * Fill colour per dataset terrain tag (the values of TERRAIN_TAGS). Every one of
 * them has to be visibly tinted against the print's own paper: on the Western
 * Reaches render a near-white arctic_sea or salt_flat made a tagged hex look
 * untagged, which is the one thing this overlay must not do.
 */
export const TERRAIN_COLORS = {
  arctic_sea: 0x8fd4e8,
  ocean: 0x1f5f9e,
  lake: 0x4aa3d9,
  coast: 0xe8c877,
  river: 0x3f93cf,
  mountain: 0x8b7d6b,
  volcano: 0x6e2f22,
  lava: 0xd9531e,
  canyon: 0xb3763f,
  forest: 0x2f7d4f,
  jungle: 0x186b3a,
  grassland: 0x9ec46a,
  swamp: 0x5b6b39,
  desert: 0xe7cd84,
  salt_flat: 0xd2c9a0,
  deep_tunnels: 0x584a6b,
  path: 0xc9a05f,
};

/**
 * Colours for terrain the GM typed themselves (the legend's "other…" box takes
 * any word). One stable colour per word beats one colour for "everything else":
 * two free-text terrains next to each other have to look different or the map
 * cannot be reviewed. ponytail: a fixed spare list, collisions and all; a hue
 * hash if a map ever carries more than a handful of invented terrains.
 */
export const SPARE_COLORS = [0xb05fc9, 0xd9478a, 0x4fc9b0, 0xc98f2f, 0x7a86d9, 0x59a02f, 0xd96f4f, 0x2f9ec9];

/**
 * Region fills, from Shadowdark Extras' own zone palette.
 *
 * Mirrors ZONE_COLORS in its scripts/hex/HexTooltipSD.mjs, minus its "Default"
 * entry, so a region painted here and the same region given a zone colour in an
 * Extras hex record look like each other. Patrick: "You should have color zones
 * that are available in Shadow Dark Extra."
 *
 * This is the FALLBACK. Extras now exposes the list as api.hex.getZoneColors()
 * and extrasPalette() below reads it, so an installed Extras is the authority
 * and this copy only answers when it is absent or its hex feature is off.
 */
export const REGION_COLORS = [
  0xe74c3c, 0xe67e22, 0xf1c40f, 0x8bc34a, 0x2ecc71, 0x1e7e34, 0x808000,
  0x1abc9c, 0x00bcd4, 0x3498db, 0x1f3a93, 0x9b59b6, 0xc9a7eb, 0xe91e9b,
  0x7b241c, 0xd4b483, 0x8b6914, 0xecf0f1, 0x95a5a6, 0x2c3e50,
];

/**
 * Shadowdark Extras' own zone palette, when it is installed and offering it.
 *
 * REGION_COLORS above is a copy of that list, and a copy drifts: restyle the
 * palette there and nothing fails here, the colours just quietly stop matching.
 * Extras exposes `api.hex.getZoneColors()` as of the change agreed for this
 * (shadowdark-extras, zoneColor + palette accessor), so when it is there the
 * copy is not used at all.
 *
 * Detected per call rather than cached at startup: `api.hex` is structurally
 * absent when Extras' hex painter feature is off — the whole namespace, not
 * some of its keys — so a feature toggled mid-session must degrade rather than
 * throw. Its "Default" entry carries an empty `value` and is skipped: that
 * means "no colour set", not a colour.
 * @returns {number[]|null} fills, or null when Extras cannot answer
 */
export function extrasPalette() {
  const get = globalThis.game?.shadowdarkExtras?.hex?.getZoneColors
    ?? globalThis.game?.modules?.get?.("shadowdark-extras")?.api?.hex?.getZoneColors;
  if (typeof get !== "function") return null;
  try {
    const out = [];
    for (const entry of get() ?? []) {
      const value = String(entry?.value ?? "").trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) out.push(Number.parseInt(value.slice(1), 16));
    }
    return out.length ? out : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Extras zone palette`, err);
    return null;
  }
}

/** Fill colour for a region name when nothing has assigned one; stable because it is hashed. */
export function regionColor(name) {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return 0x8a8a8a;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return REGION_COLORS[h % REGION_COLORS.length];
}

/**
 * A colour per region such that NO TWO TOUCHING REGIONS SHARE ONE.
 *
 * Hashing a name to a colour is stable but blind: two regions that happen to
 * collide are indistinguishable exactly when they are side by side, which is
 * the one case the picture has to get right. Patrick: "Some of them have the
 * same color, even though they're right next to each other."
 *
 * So the regions are coloured as a map instead — greedy, most-constrained
 * first, each taking a palette colour none of its neighbours has. Ties break on
 * the name, so one map always paints the same way.
 *
 * Of the colours still free it takes the LEAST USED, which matters more than it
 * sounds: taking the first free one is the textbook rule and it minimises the
 * number of colours, so a fifteen-region map came out in four. Minimising
 * colours is the opposite of what a map wants. Least-used spreads them, so
 * fifteen regions get fifteen colours and the constraint still holds.
 * @param {Map<number, string>} keyByNum  published number → whatever is being drawn as one area
 * @returns {Map<string, number>} that key → fill colour
 */
export function assignRegionColors(keyByNum, { shifted = "odd", palette = REGION_COLORS } = {}) {
  const adj = new Map();
  for (const [num, key] of keyByNum ?? []) {
    if (!adj.has(key)) adj.set(key, new Set());
    for (const n of neighbourNumbers(num, shifted)) {
      const other = keyByNum.get(n);
      if (other !== undefined && other !== key) adj.get(key).add(other);
    }
  }
  const order = [...adj.keys()].sort((a, b) => (adj.get(b).size - adj.get(a).size) || String(a).localeCompare(String(b)));
  const index = new Map();
  const used = new Array(palette.length).fill(0);
  for (const key of order) {
    const taken = new Set([...adj.get(key)].map((k) => index.get(k)).filter((i) => i !== undefined));
    let pick = -1;
    for (let i = 0; i < palette.length; i++) {
      if (taken.has(i)) continue;
      if (pick === -1 || used[i] < used[pick]) pick = i;
    }
    if (pick === -1) pick = index.size % palette.length;   // touches every colour: unavoidable
    used[pick]++;
    index.set(key, pick);
  }
  return new Map([...index].map(([k, i]) => [k, palette[i]]));
}

/**
 * Encounter-zone fills. This overlay answers one question — would a wandering
 * check on this hex find a table? — so it is deliberately a three-colour
 * picture rather than one colour per table: green rolls, amber needs something
 * the map cannot say (a time of day, a moon, a compass half), grey has no
 * table for that region at all.
 */
export const ZONE_COLORS = { ok: 0x3f8f4f, ambiguous: 0xe0a72c, none: 0x8a8a8a };

/** What the overlay is showing. */
export const MODES = ["terrain", "region", "encounter"];

/** Dot colour per overlay tag. */
export const OVERLAY_COLORS = { river: 0x2f6fd0, path: 0x7a4a1e, coast: 0xf0e08a };

/** Outline on unsure automatic cells; the margin is the scene's (tag-corrections.mjs). */
export const REVIEW_COLOR = 0xffc400;

/** How much of the print shows through a fill. The right value depends on the map's
 * own ink, so it is an argument to showTags({ alpha }) rather than one more thing in
 * the settings window. */
const FILL_ALPHA = 0.45;
/** The review ring sits inside the cell: at a third of the map flagged, rings on the cell
 * edge merge with the neighbours' into a mesh and stop meaning anything. */
const REVIEW_INSET = 0.78;

/** Fill colour for a terrain tag; unknown words get a stable spare colour. */
export function terrainColor(terrain) {
  const key = String(terrain ?? "").trim().toLowerCase();
  if (!key) return SPARE_COLORS[0];
  if (TERRAIN_COLORS[key] !== undefined) return TERRAIN_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SPARE_COLORS[h % SPARE_COLORS.length];
}

/**
 * True when a cell is one the classifier was unsure about (the review pool).
 * `stranded` is the one thing a margin cannot say: a river hex with no wet
 * neighbour is wrong regardless of how confident the glyph looked.
 */
export function needsReview(cell, margin = DEFAULT_REVIEW_MARGIN, stranded = false) {
  if (!cell || cell.source !== "auto") return false;
  return stranded || !!cell.review || (cell.margin !== undefined && cell.margin < margin);
}

/** Hover text for a cell: "1403 — forest, river (auto 1.42, review)". */
export function cellLabel(num, cell, margin = DEFAULT_REVIEW_MARGIN, stranded = false) {
  if (!cell) return `${num} — not tagged`;
  const tags = [cell.terrain, ...(cell.overlays ?? [])].join(", ");
  const notes = [];
  if (cell.source === "auto") notes.push(cell.margin !== undefined ? `auto ${Number(cell.margin).toFixed(2)}` : "auto");
  // Say WHY it is ringed. An amber ring the GM cannot explain is a ring they
  // learn to ignore.
  if (stranded) notes.push("river with nothing wet beside it");
  else if (needsReview(cell, margin)) notes.push("review");
  return `${num} — ${tags}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** Sentinel value of the "other…" option, as the tagger's own selects use. */
export const OTHER = "__other";

/**
 * The terrain dropdown's options, alphabetical by label so the browser's own
 * type-ahead lands where you expect ("j" → jungle). Every printed terrain plus
 * every word already used on this scene, so a legend card named "Keyed
 * Location" is one keystroke away instead of retyped.
 * @param {Map<string, {terrain?:string}>} cells  the store's cells
 */
export function terrainOptions(cells = new Map()) {
  const used = new Set([...Object.values(TERRAIN_TAGS), ...Object.values(SETTLEMENTS), "keyed_location"]);
  for (const c of cells.values()) if (c?.terrain) used.add(c.terrain);
  return [...used]
    .map((tag) => ({ value: tag, label: tag.replace(/_/g, " ") }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The overlay on the active scene. One instance; toggled from the tagger's
 * header or game.shadowdarkEnhancer.hexMaps.showTags().
 */
/** One string from `languages/en.json`; the key when no i18n is mounted. */
const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

export class HexTagOverlay {
  /** @type {HexTagOverlay|null} */
  static current = null;

  /** Fill opacity; see FILL_ALPHA. Set it before toggling, or redraw after. */
  static fillAlpha = FILL_ALPHA;

  /**
   * Show it, hide it, or switch what it draws. `alpha` tunes the fill against
   * this map. GM only.
   *
   * Pressing the mode that is already up hides the overlay; pressing a
   * different one SWITCHES it, because hiding and reopening to change picture
   * is the round trip this exists to avoid.
   * @param {{alpha?:number, mode?:"terrain"|"region"|"encounter"}} [opts]
   */
  static async toggle({ alpha, mode = "terrain" } = {}) {
    if (alpha !== undefined) HexTagOverlay.fillAlpha = Number(alpha);
    const showing = HexTagOverlay.current;
    if (showing && showing.mode === mode) { showing.hide(); return false; }
    if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.hexMap.notify.gmOnlyReview")); return false; }
    const scene = canvas?.scene;
    const flag = scene?.getFlag(MODULE_ID, TAGS_FLAG);
    if (!flag?.origin) { ui.notifications?.warn(t("SDE.hexMap.notify.noNumbering")); return false; }
    const geom = sceneCells(canvas);
    if (geom.error) { ui.notifications?.warn(t(geom.error)); return false; }
    const extra = await HexTagOverlay._regionContext(mode, scene);
    if (showing) { showing.mode = mode; Object.assign(showing, extra); showing.draw(); return true; }
    const o = flag.origin;
    const overlay = new HexTagOverlay(scene, geom, { cube: { q: o.q, r: o.r }, num: o.num, shifted: o.shifted ?? "odd", bounds: o.bounds });
    overlay.mode = mode;
    Object.assign(overlay, extra);
    overlay.show();
    return true;
  }

  /**
   * What the region and encounter pictures need, loaded once per toggle: the
   * scanned enclosures named by the filed crawls, and the region's imported
   * encounter grids. The terrain picture needs neither, so it pays for neither.
   */
  static async _regionContext(mode, scene) {
    if (mode === "terrain") return { regionByNum: new Map(), componentByNum: new Map(), zonesByRegion: new Map() };
    const { sceneRegions, sceneRegionFixes, regionSeeds, nameComponents, nearestRegion, crawlEntries } = await import("./hex-region.mjs");
    // The enclosures are worth looking at BEFORE a hex key names them: that is
    // the scan's own output, and checking it is the reason to draw this at all.
    const componentByNum = sceneRegions(scene);
    const fixByNum = sceneRegionFixes(scene);
    const seeds = regionSeeds(await crawlEntries());
    const { byNum } = nameComponents(componentByNum, seeds);
    for (const [num, region] of fixByNum) byNum.set(num, region);   // the GM's word outranks the scan
    // An enclosure with no keyed hex in it is usually not a region at all: a
    // coastline closes a ring round a one-hex island, a lake draws its own. The
    // nearest keyed hex names those, which beats joining them to whatever
    // surrounds them — an island in open sea is likelier to belong with the
    // other islands than with the water. Kept apart from `byNum` so the map can
    // show which answers were read and which were reasoned.
    const inferredByNum = new Map();
    if (seeds.length) {
      for (const num of componentByNum.keys()) {
        if (byNum.has(num)) continue;
        const near = nearestRegion(num, seeds);
        if (near) inferredByNum.set(num, near.region);
      }
    }
    // One key per drawn area — a name where there is one, the enclosure itself
    // where there is not — so the colouring treats both the same way.
    const keyByNum = new Map();
    for (const [num, id] of componentByNum) keyByNum.set(num, byNum.get(num) ?? inferredByNum.get(num) ?? `#${id}`);
    const colorByKey = assignRegionColors(keyByNum, {
      shifted: scene?.getFlag(MODULE_ID, TAGS_FLAG)?.origin?.shifted ?? "odd",
      palette: extrasPalette() ?? REGION_COLORS,
    });
    const ctx = { regionByNum: byNum, inferredByNum, componentByNum, fixByNum, keyByNum, colorByKey };
    if (mode === "region") return { ...ctx, zonesByRegion: new Map() };
    return { ...ctx, zonesByRegion: await encounterZonesByRegion() };
  }

  constructor(scene, geom, origin) {
    this.scene = scene;
    this.origin = origin;
    this.cells = new Map();
    for (const c of geom.cells) {
      const n = cellNumber(c.cube, origin);
      if (n.num !== null) this.cells.set(n.num, { x: c.x, y: c.y });
    }
    this.state = decodeTags(scene.getFlag(MODULE_ID, TAGS_FLAG));
    this.reviewMargin = decodeFixes(scene.getFlag(MODULE_ID, FIXES_FLAG)).margin;
    this._hooks = [];
    this._down = null;
    this._writing = false;
    /** @type {{terrain:string, overlays:string[]}|null} set by the brush window */
    this.brush = null;
    /** Cells this stroke has painted, and what each was before it (for Undo). */
    this.stroke = new Map();
    this.lastStroke = new Map();
    /** @type {object|null} the open one-hex editor, so a second click replaces it */
    this._editor = null;
    /** @type {"terrain"|"region"|"encounter"} */
    this.mode = "terrain";
    /** @type {Map<number, string>} published number → region name */
    this.regionByNum = new Map();
    /** @type {Map<number, number>} published number → the enclosure it sits in */
    this.componentByNum = new Map();
    /** @type {Map<number, string>} region guessed from the nearest keyed hex, not read off the print */
    this.inferredByNum = new Map();
    /** @type {Map<number, string>} published number → the area it is drawn as */
    this.keyByNum = new Map();
    /** @type {Map<string, number>} that area → its fill, no two touching areas alike */
    this.colorByKey = new Map();
    /** @type {Map<number, string>} regions the GM set by hand */
    this.fixByNum = new Map();
    /** @type {Map<string, object[]>} region → its imported encounter columns */
    this.zonesByRegion = new Map();
  }

  show() {
    const container = new PIXI.Container();
    container.zIndex = 1;
    container.eventMode = "static";
    container.hitArea = canvas.dimensions.rect;
    this.graphics = container.addChild(new PIXI.Graphics());
    const { PreciseText } = foundry.canvas.containers;
    this.label = container.addChild(new PreciseText("", PreciseText.getTextStyle({ fontSize: 24, fill: "#ffffff", stroke: "#000000", strokeThickness: 5 })));
    this.label.anchor.set(0.5, 1.4);
    this.label.visible = false;
    container.on("pointermove", (event) => {
      this._onHover(event);
      // Held down with a brush: every hex the pointer crosses takes it.
      if (this._down && this.brush && (event.buttons & 1)) this._paintAt(event.getLocalPosition(container));
    });
    container.on("pointerdown", (event) => {
      if (event.button !== 0) return;
      this._down = event.getLocalPosition(container);
      if (this.brush) this._paintAt(this._down);
    });
    container.on("pointerup", (event) => this._onUp(event, container));
    container.on("pointerupoutside", () => { if (this.stroke.size) this._endStroke(); this._down = null; });
    this.container = canvas.interface.addChild(container);
    canvas.interface.sortChildren();
    this.draw();
    HexTagOverlay.current = this;
    // A sheet applied in the tagger, a hand-off or a cleared flag all arrive here.
    this._hooks.push(["updateScene", Hooks.on("updateScene", (doc) => {
      if (doc.id !== this.scene.id || this._writing) return;
      this.state = decodeTags(doc.getFlag(MODULE_ID, TAGS_FLAG));
      this.reviewMargin = decodeFixes(doc.getFlag(MODULE_ID, FIXES_FLAG)).margin;
      this.draw();
    })]);
    this._hooks.push(["canvasTearDown", Hooks.on("canvasTearDown", () => this.hide())]);
    ui.notifications?.info(t("SDE.hexMap.notify.overlayShown"));
  }

  hide() {
    this._editor?.close();
    this._editor = null;
    for (const [name, id] of this._hooks) Hooks.off(name, id);
    this._hooks = [];
    this.container?.destroy({ children: true });
    this.container = null;
    if (HexTagOverlay.current === this) HexTagOverlay.current = null;
  }

  /** The encounter verdict for one hex: which column it would roll on. */
  zoneFor(num) {
    const cell = this.state.cells.get(String(num));
    const region = this.regionByNum.get(num) ?? this.inferredByNum.get(num);
    if (!region) return { status: "none", region: null };
    return { ...pickZoneTable(region, cell?.terrain, cell?.overlays, this.zonesByRegion), region };
  }

  /** Fill colour for a hex in the current mode, or null to leave it unpainted. */
  fillFor(num) {
    if (this.mode === "region") {
      const key = this.keyByNum.get(num);
      if (key === undefined) return null;
      return this.colorByKey.get(key) ?? regionColor(key);
    }
    if (this.mode === "encounter") {
      const { status, region } = this.zoneFor(num);
      // A hex with no region at all is not "no table" — nothing was asked.
      return region ? ZONE_COLORS[status] : null;
    }
    const cell = this.state.cells.get(String(num));
    return cell?.terrain ? terrainColor(cell.terrain) : null;
  }

  draw() {
    const g = this.graphics;
    if (!g || g.destroyed) return;
    g.clear();
    const grid = canvas.grid;
    const shape = grid.getShape();
    const dot = Math.min(grid.sizeX, grid.sizeY) * 0.09;
    for (const [num, at] of this.cells) {
      const cell = this.state.cells.get(String(num));
      const fill = this.fillFor(num);
      if (fill === null) continue;
      g.lineStyle({ width: 0, alpha: 0 });
      g.beginFill(fill, HexTagOverlay.fillAlpha);
      g.drawPolygon(shape.map((p) => new PIXI.Point(p.x + at.x, p.y + at.y)));
      g.endFill();
      if (this.mode !== "terrain") {
        if (this.inferredByNum.has(num) && !this.regionByNum.has(num)) {
          g.lineStyle({ width: Math.max(1.5, dot * 0.4), color: REVIEW_COLOR, alpha: 0.7 });
          g.drawPolygon(shape.map((p) => new PIXI.Point(p.x * REVIEW_INSET + at.x, p.y * REVIEW_INSET + at.y)));
          g.lineStyle({ width: 0, alpha: 0 });
        }
        continue;
      }
      if (needsReview(cell, this.reviewMargin, strandedRiver(this.state, num))) {
        g.lineStyle({ width: Math.max(2, dot * 0.6), color: REVIEW_COLOR, alpha: 0.95 });
        g.drawPolygon(shape.map((p) => new PIXI.Point(p.x * REVIEW_INSET + at.x, p.y * REVIEW_INSET + at.y)));
        g.lineStyle({ width: 0, alpha: 0 });
      }
      const marks = (cell.overlays ?? []).filter((o) => OVERLAY_COLORS[o]);
      marks.forEach((o, k) => {
        g.beginFill(OVERLAY_COLORS[o], 0.95);
        g.drawCircle(at.x + (k - (marks.length - 1) / 2) * dot * 2.6, at.y, dot);
        g.endFill();
      });
    }
  }

  /**
   * Write the tags, and the verdicts they imply, in one go.
   *
   * `_writing` holds off this overlay's own updateScene hook: the flag is
   * briefly absent between replaceModuleFlag's delete and its set, and adopting
   * that empty state as the in-memory one is how a map got wiped once already.
   */
  async _save(verdicts, { withdraw = null } = {}) {
    this._writing = true;
    try {
      const log = decodeFixes(this.scene.getFlag(MODULE_ID, FIXES_FLAG));
      let touched = false;
      if (withdraw) touched = withdrawEdits(log, withdraw) > 0;
      else if (verdicts) touched = recordEdits(log, verdicts).judged > 0;
      await replaceModuleFlag(this.scene, TAGS_FLAG, encodeTags(this.state));
      if (touched) await replaceModuleFlag(this.scene, FIXES_FLAG, encodeFixes(log));
    } finally {
      this._writing = false;
    }
  }

  /** Hover text for the picture currently drawn. */
  _labelFor(num) {
    if (this.mode === "terrain") {
      return cellLabel(num, this.state.cells.get(String(num)), this.reviewMargin, strandedRiver(this.state, num));
    }
    const region = this.regionByNum.get(num) ?? this.inferredByNum.get(num);
    if (this.mode === "region") {
      if (this.regionByNum.has(num)) return `${num} — ${region}`;
      // Say which answers were reasoned rather than read: this one has no keyed
      // hex inside its own enclosure.
      if (region) return `${num} — ${t("SDE.hexMap.zone.inferred", { region })}`;
      const id = this.componentByNum.get(num);
      return `${num} — ${id === undefined ? t("SDE.hexMap.zone.noRegion") : t("SDE.hexMap.zone.unnamed", { id })}`;
    }
    const verdict = this.zoneFor(num);
    if (!region) return `${num} — ${t("SDE.hexMap.zone.noRegion")}`;
    if (verdict.status === "ok") return `${num} — ${region}: ${verdict.column.column}`;
    // Name the columns it is stuck between: that is the whole diagnostic.
    if (verdict.status === "ambiguous") {
      return `${num} — ${region}: ${t("SDE.hexMap.zone.ambiguous", { columns: verdict.columns.map((c) => c.column).join(", ") })}`;
    }
    return `${num} — ${region}: ${t("SDE.hexMap.zone.noTable")}`;
  }

  /** Published number of the cell under a scene point, or null. */
  numberAt(point) {
    const offset = canvas.grid.getOffset(point);
    const n = cellNumber(foundryOffsetToCube(offset, !!canvas.grid.even), this.origin);
    return n.num !== null && this.cells.has(n.num) ? n.num : null;
  }

  _onHover(event) {
    const point = event.getLocalPosition(this.container);
    const num = this.numberAt(point);
    if (num === null) { this.label.visible = false; return; }
    this.label.text = this._labelFor(num);
    const at = this.cells.get(num);
    this.label.position.set(at.x, at.y);
    this.label.scale.set(1 / canvas.stage.scale.x);
    this.label.visible = true;
  }

  /** A stroke ends here; without a brush, a click (not a drag) opens the editor. */
  _onUp(event, container) {
    const up = event.getLocalPosition(container);
    const down = this._down;
    this._down = null;
    if (this.stroke.size) { this._endStroke(); return; }
    if (this.brush) return;
    if (!down || Math.hypot(up.x - down.x, up.y - down.y) > 8) return;
    const num = this.numberAt(up);
    if (num !== null) this.edit(num);
  }

  /** Paint one hex in memory; the scene is written once, when the stroke ends. */
  _paintAt(point) {
    const num = this.numberAt(point);
    if (num === null || this.stroke.has(num)) return;
    const key = String(num);
    const before = this.state.cells.get(key) ?? null;
    // A hex that ALREADY says what the brush says is still worth painting when
    // the classifier is the one who said it: that makes it yours, takes it out
    // of the review queue, and records a confirmation. Only a cell you have
    // already confirmed by hand is nothing to do.
    if (before && sameTags(before, this.brush) && before.source !== "auto") return;
    this.stroke.set(num, before);
    this.state.cells.set(key, { terrain: this.brush.terrain, overlays: [...this.brush.overlays], source: "gm" });
    this.draw();
  }

  /** One write per stroke, and one pass of verdicts, however many hexes it covered. */
  async _endStroke() {
    const painted = this.stroke;
    this.stroke = new Map();
    if (!painted.size) return 0;
    this.lastStroke = painted;
    const verdicts = [...painted].map(([num, before]) => ({ num, before, after: this.state.cells.get(String(num)) ?? null }));
    await this._save(verdicts);
    const confirmed = verdicts.filter((v) => v.before && sameTags(v.before, v.after)).length;
    const changed = painted.size - confirmed;
    const word = this.brush.terrain.replace(/_/g, " ");
    const bits = [];
    if (changed) bits.push(`${changed} changed to ${word}`);
    if (confirmed) bits.push(`${confirmed} confirmed as ${word}`);
    ui.notifications?.info(t(painted.size === 1 ? "SDE.hexMap.brush.paintedOne" : "SDE.hexMap.brush.paintedMany", { n: painted.size, tags: bits.join(", ") }));
    // The brush window shows what Undo would put back, so tell it.
    Hooks.callAll(`${MODULE_ID}.hexStroke`, this);
    return painted.size;
  }

  /** Put the last stroke back exactly as it was, verdicts included. */
  async undoStroke() {
    const last = this.lastStroke;
    if (!last?.size) return 0;
    this.lastStroke = new Map();
    for (const [num, before] of last) {
      if (before) this.state.cells.set(String(num), before);
      else this.state.cells.delete(String(num));
    }
    // Undoing is not a verdict on the classifier: it withdraws one.
    await this._save(null, { withdraw: [...last.keys()] });
    this.draw();
    Hooks.callAll(`${MODULE_ID}.hexStroke`, this);
    return last.size;
  }

  /**
   * Small dialog on one cell, for whatever is being drawn.
   *
   * Clicking a hex while looking at the regions used to open the TERRAIN box,
   * which is the one thing it cannot be about. Patrick: "when you click on the
   * hex, it only allows you to change the terrain type, not the region type."
   */
  async edit(num) {
    if (this.mode !== "terrain") return this.editRegion(num);
    return this.editTerrain(num);
  }

  /**
   * Put a hex in a different region, or the whole enclosure it belongs to.
   *
   * Per-hex because a border can be read a cell wrong; whole-enclosure because
   * when the answer is wrong it is usually wrong for the entire shape, and
   * correcting 500 hexes one at a time is not a correction, it is a punishment.
   */
  async editRegion(num) {
    await this._editor?.close();
    const esc = foundry.utils.escapeHTML;
    const current = this.regionByNum.get(num) ?? this.inferredByNum.get(num) ?? "";
    const id = this.componentByNum.get(num);
    const size = id === undefined ? 0 : [...this.componentByNum.values()].filter((c) => c === id).length;
    // Every region already on this map, plus whatever the GM has typed before.
    const names = [...new Set([...this.regionByNum.values(), ...this.inferredByNum.values()])].sort();
    const content = `<form class="standard-form">
      <div class="form-group"><label>${t("SDE.hexMap.label.region")}</label><div class="form-fields">
        <select name="region" autofocus>
          <option value="">${t("SDE.hexMap.label.asScanned")}</option>
          ${names.map((n) => `<option value="${esc(n)}" ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("")}
          <option value="${OTHER}">${t("SDE.hexMap.label.otherOption")}</option>
        </select>
        <input type="text" name="other" placeholder="${t('SDE.hexMap.brush.ownWord')}" hidden>
      </div></div>
      ${size > 1 ? `<div class="form-group"><div class="form-fields"><label class="checkbox"><input type="checkbox" name="whole"> ${t("SDE.hexMap.label.wholeEnclosure", { n: size })}</label></div></div>` : ""}
    </form>`;
    const answer = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("SDE.hexMap.edit.title", { num }), icon: "fa-solid fa-draw-polygon" },
      content,
      render: (_event, dialog) => {
        this._editor = dialog;
        const form = dialog.element.querySelector("form");
        const select = form.elements.region, other = form.elements.other;
        select.addEventListener("change", () => {
          other.hidden = select.value !== OTHER;
          if (!other.hidden) other.focus();
        });
      },
      ok: { label: t("SDE.hexMap.btn.save"), callback: (_event, button) => new FormDataExtended(button.form).object },
      rejectClose: false,
    });
    this._editor = null;
    if (!answer) return;
    const chosen = answer.region === OTHER ? String(answer.other ?? "").trim() : answer.region;
    if (answer.region === OTHER && !chosen) return;
    const targets = (answer.whole && id !== undefined)
      ? [...this.componentByNum].filter(([, c]) => c === id).map(([n]) => n)
      : [num];
    for (const n of targets) {
      if (chosen) this.fixByNum.set(n, chosen);
      else this.fixByNum.delete(n);       // "(as scanned)" withdraws the correction
    }
    await this._saveRegions();
    ui.notifications?.info(chosen
      ? t("SDE.hexMap.notify.regionSet", { n: targets.length, region: chosen })
      : t("SDE.hexMap.notify.regionCleared", { n: targets.length }));
    Object.assign(this, await HexTagOverlay._regionContext(this.mode, this.scene));
    this.draw();
  }

  /** Write the corrections back, keeping the scan's own enclosures untouched. */
  async _saveRegions() {
    this._writing = true;
    try {
      await replaceModuleFlag(this.scene, REGIONS_FLAG, encodeRegions(this.componentByNum, this.fixByNum));
    } finally {
      this._writing = false;
    }
  }

  /** Small dialog on one cell; saves through the tagger's own flag write. */
  async editTerrain(num) {
    // One at a time: clicking another hex moves this box to it rather than
    // stacking a second one on top.
    await this._editor?.close();
    const cell = this.state.cells.get(String(num));
    const options = terrainOptions(this.state.cells);
    const esc = foundry.utils.escapeHTML;
    const content = `<form class="standard-form">
      <div class="form-group"><label>${t("SDE.hexMap.brush.terrain")}</label><div class="form-fields">
        <select name="terrain" autofocus>
          <option value="">${t("SDE.hexMap.label.clearHex")}</option>
          ${options.map((o) => `<option value="${esc(o.value)}" ${o.value === cell?.terrain ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
          <option value="${OTHER}">${t("SDE.hexMap.label.otherOption")}</option>
        </select>
        <input type="text" name="other" placeholder="${t('SDE.hexMap.brush.ownWord')}" hidden>
      </div></div>
      <div class="form-group"><label>${t("SDE.hexMap.brush.onTheHex")}</label><div class="form-fields">
        ${OVERLAYS.map((o) => `<label class="checkbox"><input type="checkbox" name="${o}" ${cell?.overlays?.includes(o) ? "checked" : ""}> ${o}</label>`).join("")}
      </div></div>
    </form>`;
    const answer = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("SDE.hexMap.edit.title", { num }), icon: "fa-solid fa-hexagon" },
      content,
      // The free-text box appears only for "other…", as it does in the tagger.
      render: (_event, dialog) => {
        this._editor = dialog;
        const form = dialog.element.querySelector("form");
        const select = form.elements.terrain, other = form.elements.other;
        select.addEventListener("change", () => {
          other.hidden = select.value !== OTHER;
          if (!other.hidden) other.focus();
        });
      },
      ok: { label: t("SDE.hexMap.btn.save"), callback: (_event, button) => new FormDataExtended(button.form).object },
      rejectClose: false,
    });
    this._editor = null;
    if (!answer) return;
    const chosen = answer.terrain === OTHER ? answer.other : answer.terrain;
    if (answer.terrain === OTHER && !String(chosen ?? "").trim()) return;  // "other…" with nothing typed: no change
    const terrain = String(chosen ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    // Through applySheet so this is the same write the tagger's sheet makes,
    // and so the verdict on the classifier is recorded the same way.
    const verdicts = applySheet(this.state, { [num]: { terrain, overlays: OVERLAYS.filter((o) => answer[o]) } });
    await this._save(verdicts);
    this.draw();
  }
}
