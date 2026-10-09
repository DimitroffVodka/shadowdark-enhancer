/**
 * Shadowdark Enhancer — the battle map picker, as plain data.
 *
 * What the picker lists and what a choice means, with no Foundry in it, so
 * tests import this file. The window (battle-map-picker.mjs) hands it the
 * library's maps, the GM's per-terrain choices and the world's scenes, and
 * renders what comes back. docs/plans/encounter-battle-maps.md, part D.
 *
 * Everything the map library owns (which maps suit a terrain, which have camp
 * art) arrives as an argument, so this file imports only the shared names.
 */

import { ASSET_DIR, TERRAINS } from "./constants.mjs";

/**
 * en.json key of each terrain's name. Written out in full because the strings
 * test finds keys by scanning the source, and a key built from pieces would be
 * reported as unused.
 */
export const TERRAIN_LABEL_KEYS = Object.freeze({
  forest: "SDE.encounterMaps.picker.terrain.forest",
  path: "SDE.encounterMaps.picker.terrain.path",
  grassland: "SDE.encounterMaps.picker.terrain.grassland",
  jungle: "SDE.encounterMaps.picker.terrain.jungle",
  swamp: "SDE.encounterMaps.picker.terrain.swamp",
  river: "SDE.encounterMaps.picker.terrain.river",
  lake: "SDE.encounterMaps.picker.terrain.lake",
  ocean: "SDE.encounterMaps.picker.terrain.ocean",
  arctic_sea: "SDE.encounterMaps.picker.terrain.arctic_sea",
  desert: "SDE.encounterMaps.picker.terrain.desert",
  salt_flat: "SDE.encounterMaps.picker.terrain.salt_flat",
  canyon: "SDE.encounterMaps.picker.terrain.canyon",
  mountain: "SDE.encounterMaps.picker.terrain.mountain",
  coast: "SDE.encounterMaps.picker.terrain.coast",
  volcano: "SDE.encounterMaps.picker.terrain.volcano",
  lava: "SDE.encounterMaps.picker.terrain.lava",
  deep_tunnels: "SDE.encounterMaps.picker.terrain.deep_tunnels",
});

/** The line under a terrain's heading, by how the Battle map button chooses (see defaultRule). Written out in full, as above. */
const HINT_KEYS = Object.freeze({
  none: "SDE.encounterMaps.picker.terrainAllOff",
  default: "SDE.encounterMaps.picker.terrainHintDefault",
  pinned: "SDE.encounterMaps.picker.terrainHintPinned",
  random: "SDE.encounterMaps.picker.terrainHintRandom",
});

/** A terrain as the module keys it ("Arctic Sea" -> "arctic_sea"), for a caller that hands over the legend's own word. */
export function terrainKeyOf(terrain) {
  return String(terrain ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** A terrain the GM typed into the map legend has no shipped name: its key as words ("salt_flat" -> "Salt flat"). */
export function terrainWords(terrain) {
  const words = String(terrain ?? "").trim().replace(/_+/g, " ");
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * Where a shipped picture is. The library says "module-relative path under
 * ASSET_DIR", which reads either as the whole path or as a file name in that
 * folder; both work here.
 */
function shippedSrc(path) {
  const src = String(path ?? "");
  if (!src || /^(?:modules\/|systems\/|\/|https?:|data:|blob:)/.test(src)) return src;
  return `${ASSET_DIR}/${src}`;
}

/** A map's own picture, the full-size art a scene is built from. */
export const imageSrc = (map) => shippedSrc(map?.image);

/**
 * What a card draws: the library's small thumbnail. The full-size art is tens of
 * megabytes across the whole library, and a card is a few hundred pixels wide, so
 * the picker must not draw it; `image` is only the fallback for an entry that has
 * no thumbnail.
 */
export const thumbSrc = (map) => shippedSrc(map?.thumb ?? map?.image);

/** The products a map is made from, once each, for its hover text ("A, B"). */
export function creditNames(map) {
  const names = (map?.sources ?? []).map((s) => String(s?.name ?? "").trim()).filter(Boolean);
  return [...new Set(names)].join(", ");
}

/**
 * What is saved for one terrain, read defensively (the setting is world data a GM
 * or a macro can put anything in), or null when nothing is. Null is not the same
 * as an entry with no pin: see defaultRule().
 * @returns {{pinned: string|null, disabled: string[]}|null}
 */
export function savedEntry(prefs, terrain) {
  const raw = prefs?.[terrain];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => typeof id === "string" && id))] : []);
  return { pinned: typeof raw.pinned === "string" && raw.pinned ? raw.pinned : null, disabled: ids(raw.disabled) };
}

/**
 * How the Battle map button chooses for a terrain, and the map it would open if
 * that is settled. This mirrors the library's resolveDefaultMap exactly (a test
 * holds the two together):
 *  - "none": every map is switched off (or there are none), so the picker opens;
 *  - "default": nothing is saved for the terrain, so the first map, the shipped default;
 *  - "pinned": a saved pin that is still on;
 *  - "random": a saved entry with no pin that is on, which is the GM's choice of
 *    random (and what a pin that was switched off falls back to). `map` is null.
 * @param {object[]} maps  this terrain's maps, library order
 * @param {{pinned: string|null, disabled: string[]}|null} saved  savedEntry()
 * @returns {{mode: "none"|"default"|"pinned"|"random", map: object|null}}
 */
export function defaultRule(maps, saved) {
  const on = maps.filter((m) => !saved?.disabled.includes(m.id));
  if (!on.length) return { mode: "none", map: null };
  if (!saved) return { mode: "default", map: on[0] };
  const pin = on.find((m) => m.id === saved.pinned);
  return pin ? { mode: "pinned", map: pin } : { mode: "random", map: null };
}

/** Does a scene's name match what was typed? Every word must appear, any case. */
export function sceneMatches(name, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hay = String(name ?? "").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * What a confirm hands back. A map's variant is the look that applies: camp art
 * when it was asked for and the map has some, else night or day. `night` rides
 * along because a camp can be lit or dark and the variant alone cannot say.
 * A scene is used as it is.
 * @returns {{mapId: string, variant: "day"|"night"|"camp", night: boolean}|{sceneId: string}|null}
 */
export function resultFor(selection, { night = false, camp = false, hasCamp = false } = {}) {
  if (selection?.sceneId) return { sceneId: selection.sceneId };
  if (!selection?.mapId) return null;
  const variant = camp && hasCamp ? "camp" : night ? "night" : "day";
  return { mapId: selection.mapId, variant, night: !!night };
}

/*
 * The three ways the GM changes a terrain, as the next saved value. None of them
 * changes what it is given, and each writes the terrain's entry, because an entry
 * is how a choice is kept: with no entry the library's first map is the default,
 * and an entry with no pin that is on means "random". So a change that saves an
 * entry must save the default the GM sees, or the terrain would flip to random
 * without anyone asking for it.
 */

/**
 * Pin a map as the terrain's default. Pinning a map that is switched off switches it on.
 */
export function withPinned(prefs, terrain, mapId) {
  const saved = savedEntry(prefs, terrain);
  return putEntry(prefs, terrain, { pinned: mapId, disabled: (saved?.disabled ?? []).filter((id) => id !== mapId) });
}

/**
 * Pick at random on purpose (`random` true: no pin), or stop doing so (the first
 * map that is on becomes the pin, which is what the GM then sees as the default).
 * Stopping changes nothing when a pin is already on, or when every map is off and
 * there is nothing to pin.
 * @param {object[]} maps  this terrain's maps, library order
 */
export function withRandom(prefs, terrain, maps, random) {
  const saved = savedEntry(prefs, terrain);
  const disabled = saved?.disabled ?? [];
  if (random) return putEntry(prefs, terrain, { pinned: null, disabled });
  const first = defaultRule(maps, saved).mode === "pinned" ? null : maps.find((m) => !disabled.includes(m.id));
  return putEntry(prefs, terrain, first ? { pinned: first.id, disabled } : null);
}

/**
 * Switch a map on or off for the terrain. The default the GM sees stays the
 * default: with nothing saved it is the first map that is on, written as a pin;
 * a pin that is switched off moves to the first map still on; a saved "random"
 * stays random. With every map off there was no default, and the first map
 * switched back on becomes the pin: random is only ever asked for.
 * @param {object[]} maps  this terrain's maps, library order
 */
export function withEnabled(prefs, terrain, maps, mapId, enabled) {
  const saved = savedEntry(prefs, terrain);
  const before = saved?.disabled ?? [];
  const disabled = enabled ? before.filter((id) => id !== mapId) : [...new Set([...before, mapId])];
  const firstOn = maps.find((m) => !disabled.includes(m.id))?.id ?? null;
  const nothingWasOn = !maps.some((m) => !before.includes(m.id));
  const pinned = !saved || nothingWasOn || (!enabled && saved.pinned === mapId) ? firstOn : saved.pinned;
  return putEntry(prefs, terrain, { pinned, disabled });
}

/** A copy of the saved choices with one terrain's entry written; with no entry, or no terrain, just the copy. */
function putEntry(prefs, terrain, entry) {
  const next = { ...(prefs && typeof prefs === "object" && !Array.isArray(prefs) ? prefs : {}) };
  if (terrain && entry) next[terrain] = entry;
  return next;
}

/**
 * Everything the picker window shows, from plain inputs.
 *
 * `sections` is always three, in the order they are listed on screen:
 *   1. "terrain": this terrain's maps, switched-off ones dimmed (shown only when
 *      a terrain is given). The default is marked by the library's own rule
 *      (defaultRule): the first map when nothing is saved, the pin when it is on,
 *      and when the GM chose random, no map is the default and every map that is
 *      on says it is in the draw;
 *   2. "others": every other day map, with a chip for each ground they suit
 *      (`terrainFilter` narrows them);
 *   3. "scenes": the world's scenes by name. Each row carries `hidden` when
 *      `query` does not match it, rather than being dropped: the window hides
 *      rows in place while the GM types, so the search box keeps its focus, and
 *      the two must agree on which rows are in the page.
 *
 * What is chosen is `selected` when it names something listed, else the
 * terrain's default. A scene is used as it is, so Day, Night and Camp go quiet
 * while one is chosen; Camp is on only when asked for and the chosen map has
 * camp art (`campOf`), and the ask is kept for the next map that has some.
 *
 * @param {object} p
 * @param {string}   [p.terrain]        hex terrain key of the party's hex, "" when unknown
 * @param {object[]} [p.maps]           the library's day maps for that terrain, library order
 * @param {object[]} [p.otherMaps]      every other day map
 * @param {object}   [p.prefs]          the saved per-terrain choices
 * @param {{id: string, name: string, thumb?: string|null}[]} [p.scenes]  world scenes worth offering
 * @param {string|null} [p.terrainFilter]  a terrain chip of the others list
 * @param {string}   [p.query]          scene search text
 * @param {boolean}  [p.night]          the Night toggle
 * @param {boolean}  [p.camping]        the Camp toggle
 * @param {{mapId?: string, sceneId?: string}|null} [p.selected]
 * @param {boolean}  [p.canEdit]        show the GM's pin and switch-off controls
 * @param {(map: object) => object|null} [p.campOf]  a day map's camp version, if it has one
 */
export function pickerModel({
  terrain = "", maps = [], otherMaps = [], prefs = {}, scenes = [],
  terrainFilter = null, query = "", night = false, camping = false,
  selected = null, canEdit = false, campOf = () => null,
} = {}) {
  const key = terrainKeyOf(terrain);
  const saved = savedEntry(prefs, key);
  const byId = new Map([...maps, ...otherMaps].map((m) => [m.id, m]));
  const sceneList = scenes.filter((s) => s?.id)
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { numeric: true, sensitivity: "base" }));
  const rule = defaultRule(key ? maps : [], saved);
  const def = rule.map;

  let sel = null;
  if (selected?.mapId && byId.has(selected.mapId)) sel = { mapId: selected.mapId };
  else if (selected?.sceneId && sceneList.some((s) => s.id === selected.sceneId)) sel = { sceneId: selected.sceneId };
  else if (def) sel = { mapId: def.id };

  const chosenMap = sel?.mapId ? byId.get(sel.mapId) : null;
  const campAvailable = !!(chosenMap && campOf(chosenMap));
  const camp = !!camping && campAvailable;

  const card = (map, extra) => {
    const campMap = campOf(map);
    return {
      id: map.id,
      labelKey: map.labelKey,
      // With Camp on, a card that has camp art shows it, so the toggle does something you can see.
      thumb: thumbSrc(camping && campMap ? campMap : map),
      credit: creditNames(map),
      hasCamp: !!campMap,
      selected: sel?.mapId === map.id,
      ...extra,
    };
  };

  const terrainSection = {
    key: "terrain",
    show: !!key,
    headingKey: "SDE.encounterMaps.picker.terrainHeading",
    count: maps.length,
    controls: !!canEdit,
    mode: rule.mode,
    defaultId: def?.id ?? null,
    // The GM's "Pick at random" switch: shown when there are maps to pick from, and idle while every one is off.
    random: rule.mode === "random",
    canRandom: !!canEdit && maps.length > 0,
    randomOff: rule.mode === "none",
    empty: maps.length === 0,
    emptyKey: "SDE.encounterMaps.picker.terrainNone",
    hintKey: maps.length === 0 ? null : HINT_KEYS[rule.mode],
    cards: maps.map((m) => {
      const enabled = !(saved?.disabled ?? []).includes(m.id);
      return card(m, {
        enabled,
        dimmed: !enabled,
        isDefault: m.id === def?.id,
        isPinned: rule.mode === "pinned" && m.id === def.id,
        // With random on there is no one default to mark: every map that is on is in the draw.
        isRandom: rule.mode === "random" && enabled,
      });
    }),
  };

  const present = new Set(otherMaps.flatMap((m) => m.terrains ?? []));
  const grounds = [...TERRAINS.filter((t) => present.has(t)), ...[...present].filter((t) => !TERRAINS.includes(t))];
  const filter = grounds.includes(terrainFilter) ? terrainFilter : "";
  const suiting = (t) => otherMaps.filter((m) => m.terrains?.includes(t));
  const othersSection = {
    key: "others",
    show: true,
    headingKey: key ? "SDE.encounterMaps.picker.othersHeading" : "SDE.encounterMaps.picker.othersHeadingAll",
    count: otherMaps.length,
    controls: false,
    filter,
    empty: otherMaps.length === 0,
    emptyKey: "SDE.encounterMaps.picker.othersNone",
    hintKey: null,
    chips: [
      { terrain: "", labelKey: "SDE.encounterMaps.picker.filterAll", text: "", count: otherMaps.length, active: !filter },
      ...grounds.map((t) => ({
        terrain: t, labelKey: TERRAIN_LABEL_KEYS[t] ?? null, text: terrainWords(t), count: suiting(t).length, active: filter === t,
      })),
    ],
    cards: (filter ? suiting(filter) : otherMaps)
      .map((m) => card(m, { enabled: true, dimmed: false, isDefault: false, isPinned: false, isRandom: false })),
  };

  const rows = sceneList.map((s) => ({
    id: s.id,
    name: String(s.name ?? ""),
    thumb: s.thumb || null,
    selected: sel?.sceneId === s.id,
    hidden: !sceneMatches(s.name, query),
  }));
  const scenesSection = {
    key: "scenes",
    show: true,
    isScenes: true,
    headingKey: "SDE.encounterMaps.picker.scenesHeading",
    hintKey: "SDE.encounterMaps.picker.scenesHint",
    emptyKey: "SDE.encounterMaps.picker.scenesNone",
    count: rows.length,
    query: String(query ?? ""),
    rows,
    empty: rows.length === 0,
    noMatch: rows.length > 0 && rows.every((r) => r.hidden),
  };

  const sceneRow = sel?.sceneId ? rows.find((r) => r.id === sel.sceneId) : null;
  const result = resultFor(sel, { night, camp: camping, hasCamp: campAvailable });
  return {
    terrain: key,
    terrainLabelKey: TERRAIN_LABEL_KEYS[key] ?? null,
    terrainText: terrainWords(key),
    canEdit: !!canEdit,
    night: !!night,
    camp,
    campAvailable,
    looksOff: !!sel?.sceneId,
    selected: sel,
    chosen: chosenMap
      ? { isMap: true, labelKey: chosenMap.labelKey, night: !!night, camp }
      : sceneRow ? { isScene: true, name: sceneRow.name } : null,
    result,
    canConfirm: !!result,
    sections: [terrainSection, othersSection, scenesSection],
  };
}
