/**
 * Shadowdark Enhancer — encounter battle maps: where the tokens go, and which
 * tokens a battle owns (pure; no Foundry, so node tests import it).
 *
 * Every position here is in MAP pixels, counted from the top-left of the map
 * image, and every zone is `[x0, y0, x1, y1]`. The Foundry-bound caller adds the
 * scene rect's origin (`scene.dimensions.sceneX/sceneY`) when it writes tokens:
 * padding shifts the canvas, and a position that forgot it is off by the padding.
 * That is a whole number of squares, so a spot on the grid here is on it there.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { BATTLE_STATUS, FLAGS, GRID_PX } from "./constants.mjs";

const EPS = 1e-6;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const cellKey = (c, r) => `${c},${r}`;

/** Squares between the party zone's edge and the nearest foe, by the distance band. */
export const FOE_GAP_SQUARES = Object.freeze({ close: 2, near: 6, far: 12 });
/** The least depth (in squares) of the strip the foes arrive in, and the least width along the party's side. */
export const FOE_DEPTH_SQUARES = 4;
export const FOE_MIN_CROSS_SQUARES = 12;

/**
 * The distance d6's band, the way encounter-result.mjs DISTANCE reads it: 1 is
 * close, 2-4 near, 5-6 far. A roll the table could not have made (an encounter
 * a GM typed in has none) is "near", the middle one.
 * @param {number} roll
 * @returns {"close"|"near"|"far"}
 */
export function distanceBand(roll) {
  const n = Number(roll);
  if (n === 1) return "close";
  if (n === 5 || n === 6) return "far";
  return "near";
}

/** A token's footprint in whole squares: 1 for anything up to a square (a tiny token still holds a cell), else rounded up. */
const cellsFor = (size) => {
  const n = Number(size);
  return Number.isFinite(n) && n > 1 ? Math.ceil(n - EPS) : 1;
};

/** Is this a zone worth believing: four finite numbers that enclose some area? A catalog entry's own `foes` is checked by it. */
const isZone = (zone) => Array.isArray(zone) && zone.length === 4 && zone.every(Number.isFinite) && zone[2] > zone[0] && zone[3] > zone[1];

function checkZone(zone, who) {
  if (!Array.isArray(zone) || zone.length !== 4 || !zone.every(Number.isFinite)) {
    throw new TypeError(`${who}: a zone is [x0, y0, x1, y1] in px, got ${JSON.stringify(zone)}`);
  }
  return zone;
}

/** The whole squares inside a px zone: c0/r0 inclusive, c1/r1 exclusive. Empty or inverted when the zone is smaller than a square. */
function innerCells(zone, grid) {
  const [x0, y0, x1, y1] = zone;
  return {
    c0: Math.ceil(x0 / grid - EPS), r0: Math.ceil(y0 / grid - EPS),
    c1: Math.floor(x1 / grid + EPS), r1: Math.floor(y1 / grid + EPS),
  };
}

/** Every square a list of `{x, y, width, height}` px rects touches, as "c,r" keys. */
function blockedCells(rects, grid) {
  const out = new Set();
  for (const o of rects ?? []) {
    const c0 = Math.floor(o.x / grid + EPS), r0 = Math.floor(o.y / grid + EPS);
    const c1 = Math.ceil((o.x + o.width) / grid - EPS), r1 = Math.ceil((o.y + o.height) / grid - EPS);
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) out.add(cellKey(c, r));
  }
  return out;
}

/**
 * A slot is a spot on the zone's own lattice (steps of one footprint). `u` runs
 * across a rank and `v` is the rank's depth; with `from` set the ranks run along
 * the other axis, so left/right swap which of them is x.
 */
function slotCell(cells, s, from, u, v) {
  return from === "left" || from === "right"
    ? [cells.c0 + v * s, cells.r0 + u * s]
    : [cells.c0 + u * s, cells.r0 + v * s];
}

/** How many slots fit across a rank and in depth. */
function slotCounts(cells, s, from) {
  const sideways = from === "left" || from === "right";
  const W = cells.c1 - cells.c0, H = cells.r1 - cells.r0;
  return { cross: Math.floor((sideways ? H : W) / s), depth: Math.floor((sideways ? W : H) / s) };
}

/** True when rank 0 sits on the high side (bottom/right) of the zone. */
const fromHigh = (from) => from === "bottom" || from === "right";

/**
 * The block the tokens settle into: ranks of about the zone's own shape, the
 * block centred (rank 0 on the `from` edge when there is one), a short last rank
 * centred under the others. Packed rows, not a scatter, and never more than the
 * zone holds.
 */
function idealSlots(cells, s, n, from) {
  const { cross, depth } = slotCounts(cells, s, from);
  if (cross < 1 || depth < 1) return [];
  const total = Math.min(n, cross * depth);
  let cols = clamp(Math.round(Math.sqrt((total * cross) / depth)), 1, cross);
  let ranks = Math.ceil(total / cols);
  if (ranks > depth) ranks = depth;
  cols = Math.ceil(total / ranks);          // even the ranks out: 7 tokens in two ranks are 4+3, not 6+1
  const lead = Math.floor((cross - cols) / 2);
  const first = from ? 0 : Math.floor((depth - ranks) / 2);
  const out = [];
  for (let k = 0; k < ranks; k++) {
    const inRank = Math.max(0, Math.min(cols, total - k * cols));
    const start = lead + Math.floor((cols - inRank) / 2);
    const v = fromHigh(from) ? depth - 1 - k : first + k;
    for (let j = 0; j < inRank; j++) out.push(slotCell(cells, s, from, start + j, v));
  }
  return out;
}

/** The zone's other slots, for when part of the block is taken: nearest the middle first, or the `from` edge first. */
function latticeSlots(cells, s, from) {
  const { cross, depth } = slotCounts(cells, s, from);
  const list = [];
  for (let u = 0; u < cross; u++) {
    for (let v = 0; v < depth; v++) {
      const du = Math.abs(u - (cross - 1) / 2);
      list.push({
        at: slotCell(cells, s, from, u, v), u, v, du,
        rank: from ? (fromHigh(from) ? depth - 1 - v : v) : 0,
        mid: Math.hypot(du, v - (depth - 1) / 2),
      });
    }
  }
  return list
    .sort((a, b) => a.rank - b.rank || (from ? a.du - b.du : a.mid - b.mid) || a.v - b.v || a.u - b.u)
    .map((slot) => slot.at);
}

/** Every square outside (or beside) the zone, nearest the zone first: where the tokens go when it is full. */
function spillSlots({ zone, s, n, grid, blocked, room }) {
  const [x0, y0, x1, y1] = zone.map((v) => v / grid);
  const pad = Math.ceil(Math.sqrt(n + blocked)) * s + 2 * s;
  let c0 = Math.floor(x0) - pad, c1 = Math.ceil(x1) + pad;
  let r0 = Math.floor(y0) - pad, r1 = Math.ceil(y1) + pad;
  if (room) {
    c0 = Math.max(c0, room.c0); r0 = Math.max(r0, room.r0);
    c1 = Math.min(c1, room.c1 - s + 1); r1 = Math.min(r1, room.r1 - s + 1);
  }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const list = [];
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const gap = Math.hypot(Math.max(x0 - (c + s), c - x1, 0), Math.max(y0 - (r + s), r - y1, 0));
      list.push({ c, r, gap, mid: Math.hypot(c + s / 2 - mx, r + s / 2 - my) });
    }
  }
  return list.sort((a, b) => a.gap - b.gap || a.mid - b.mid || a.r - b.r || a.c - b.c).map((p) => [p.c, p.r]);
}

/**
 * Where `count` tokens of one size go inside a zone: packed rows, snapped to the
 * grid, never on a square `occupied` touches. Without `from` the block sits in
 * the middle of the zone (the party); with `from` ("top" | "bottom" | "left" |
 * "right") its first rank sits on that edge (foes arriving, so the nearest rank
 * is exactly the distance asked for).
 *
 * A zone too small for them is not a reason to lose one: the rest take the
 * nearest free squares around it, inside `bounds` when it is given (the map,
 * `[0, 0, width, height]`). If even that is full they stack on the zone's middle.
 *
 * @param {object} p
 * @param {number[]} p.zone       [x0, y0, x1, y1] px
 * @param {number}   p.count
 * @param {number}   [p.size=1]   footprint in squares (2 = a 2x2 token)
 * @param {number}   [p.grid]     px per square
 * @param {Array<{x:number,y:number,width:number,height:number}>} [p.occupied]  px rects to keep off
 * @param {number[]|null} [p.bounds]  [x0, y0, x1, y1] px nothing may leave
 * @param {"top"|"bottom"|"left"|"right"|null} [p.from]
 * @returns {Array<{x:number, y:number}>} top-left px, one per token, in placing order
 */
export function layoutTokens({ zone, count, size = 1, grid = GRID_PX, occupied = [], bounds = null, from = null }) {
  checkZone(zone, "layoutTokens");
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return [];
  const s = cellsFor(size);
  const cells = innerCells(zone, grid);
  const taken = blockedCells(occupied, grid);
  const room = bounds ? innerCells(checkZone(bounds, "layoutTokens bounds"), grid) : null;
  const priorBlocked = taken.size;

  const free = (c, r) => {
    if (room && (c < room.c0 || r < room.r0 || c + s > room.c1 || r + s > room.r1)) return false;
    for (let dr = 0; dr < s; dr++) for (let dc = 0; dc < s; dc++) if (taken.has(cellKey(c + dc, r + dr))) return false;
    return true;
  };
  const out = [];
  const place = ([c, r]) => {
    if (out.length >= n || !free(c, r)) return;
    for (let dr = 0; dr < s; dr++) for (let dc = 0; dc < s; dc++) taken.add(cellKey(c + dc, r + dr));
    out.push({ x: c * grid, y: r * grid });
  };

  idealSlots(cells, s, n, from).forEach(place);
  if (out.length < n) latticeSlots(cells, s, from).forEach(place);
  if (out.length < n) spillSlots({ zone, s, n, grid, blocked: priorBlocked, room }).forEach(place);

  // Nowhere free at all: stack the rest on the middle of the zone rather than lose a token.
  const middle = {
    x: Math.round((zone[0] + zone[2]) / 2 / grid) * grid,
    y: Math.round((zone[1] + zone[3]) / 2 / grid) * grid,
  };
  while (out.length < n) out.push({ ...middle });
  return out;
}

/**
 * `layoutTokens` for tokens of different sizes (a party with one large member):
 * the biggest are placed first, since they are the hardest to fit, and each group
 * keeps off the ones before it. The answer lines up with `sizes`.
 * @param {object} p  layoutTokens' arguments, with `sizes` (one per token) instead of `count` and `size`
 * @returns {Array<{x:number, y:number}>}
 */
export function layoutMixed({ sizes, grid = GRID_PX, occupied = [], ...rest }) {
  const foot = sizes.map(cellsFor);
  const out = new Array(sizes.length);
  const kept = [...occupied];
  for (const s of [...new Set(foot)].sort((a, b) => b - a)) {
    const idx = foot.flatMap((f, i) => (f === s ? [i] : []));
    const spots = layoutTokens({ ...rest, count: idx.length, size: s, grid, occupied: kept });
    idx.forEach((i, k) => {
      out[i] = spots[k];
      kept.push({ x: spots[k].x, y: spots[k].y, width: s * grid, height: s * grid });
    });
  }
  return out;
}

/** A token spot as a rect, for the next layout's `occupied`. */
export const rectOf = (pos, size = 1, grid = GRID_PX) => {
  const px = cellsFor(size) * grid;
  return { x: pos.x, y: pos.y, width: px, height: px };
};

/**
 * The middle of a map, for a scene that has no party zone of its own (any scene
 * the GM picks from the world): the central `fraction` of each side, on the grid.
 * @returns {number[]} [x0, y0, x1, y1] px
 */
export function centralZone(width, height, grid = GRID_PX, fraction = 0.3) {
  const snap = (v) => Math.round(v / grid) * grid;
  // Snap the centre and the half-extent, not the four edges: rounding each edge would leave the zone lopsided.
  const cx = snap(width / 2), cy = snap(height / 2);
  const hw = Math.max(grid, snap((width * fraction) / 2)), hh = Math.max(grid, snap((height * fraction) / 2));
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

/**
 * Where the foes arrive, and which edge of that strip faces the party.
 *
 * The strip is `FOE_GAP_SQUARES[band]` squares from the party zone's edge (close
 * 2, near 6, far 12), on the side of the party zone with the most room (a tie
 * goes right, left, bottom, top), as wide as the party zone's own side with a
 * floor of `FOE_MIN_CROSS_SQUARES`, and as deep as the foes need. It is pushed
 * inside the map when the gap would run off it: nearer than asked beats off the
 * map. A water map is no different; its party zone is the boat's deck and the
 * strip lands on the water around it.
 *
 * A map that names its own foes zone (`map.foes`, for a hazard map: the far island, the other end of the bridge) is
 * believed over all of this. The foes pack inside that zone and the distance roll is not asked, because a roll that put
 * them in the chasm would be wrong by the map's own account. Both sides are then centred in their zones: with no
 * distance to keep there is nothing for the party to stand against.
 *
 * @param {object} p
 * @param {{width:number, height:number, foes?:number[]}} p.map   the map's size in px, and where its foes go if it says
 * @param {number[]} p.partyZone  [x0, y0, x1, y1] px
 * @param {number} p.distanceRoll the distance d6
 * @param {number} [p.grid]
 * @param {number} [p.size=1]     the largest foe's footprint in squares (the strip is at least twice as deep)
 * @returns {{zone:number[], from:"top"|"bottom"|"left"|"right"|null, side:"top"|"bottom"|"left"|"right"|null}}
 *   `side` is where the strip is, relative to the party zone; `from` is the strip's own edge facing the party. The
 *   party packs against the edge named `side`, so the gap is real: it is measured from where the party stands.
 */
export function foePlan({ map, partyZone, distanceRoll, grid = GRID_PX, size = 1 }) {
  checkZone(partyZone, "foeZone");
  if (isZone(map.foes)) return { zone: [...map.foes], from: null, side: null };
  const mapW = map.width, mapH = map.height;
  const down = (v) => Math.floor(v / grid + EPS) * grid;

  // The squares the party can stand on; a zone smaller than one square falls back to where it rounds to.
  const inner = innerCells(partyZone, grid);
  const [px0, py0, px1, py1] = inner.c1 > inner.c0 && inner.r1 > inner.r0
    ? [inner.c0 * grid, inner.r0 * grid, inner.c1 * grid, inner.r1 * grid]
    : partyZone.map((v) => Math.round(v / grid) * grid);

  const gap = FOE_GAP_SQUARES[distanceBand(distanceRoll)] * grid;
  const depthPx = Math.max(FOE_DEPTH_SQUARES, 2 * cellsFor(size)) * grid;
  const room = { right: mapW - px1, left: px0, bottom: mapH - py1, top: py0 };
  const side = ["left", "bottom", "top"].reduce((best, k) => (room[k] > room[best] ? k : best), "right");
  if (!(room[side] > 0)) return { zone: [0, 0, mapW, mapH], from: null, side: null };   // the party fills the map; `occupied` keeps the foes off it

  // Across the party's side: centred on it, at least as wide, shifted (not shrunk) to stay on the map.
  const horizontal = side === "left" || side === "right";
  const lo0 = horizontal ? py0 : px0, hi0 = horizontal ? py1 : px1;
  const crossMax = horizontal ? mapH : mapW;
  const want = Math.max(hi0 - lo0, FOE_MIN_CROSS_SQUARES * grid);
  const lo = clamp(Math.round(((lo0 + hi0) / 2 - want / 2) / grid) * grid, 0, Math.max(0, down(crossMax - want)));
  const hi = Math.min(lo + want, down(crossMax));

  // Along the gap: past it, but never into the party zone and never off the map.
  let a, b, from;
  if (side === "right") {
    a = Math.max(Math.min(px1 + gap, down(mapW - depthPx)), px1); b = Math.min(a + depthPx, down(mapW)); from = "left";
  } else if (side === "left") {
    b = Math.min(Math.max(px0 - gap, depthPx), px0); a = Math.max(b - depthPx, 0); from = "right";
  } else if (side === "bottom") {
    a = Math.max(Math.min(py1 + gap, down(mapH - depthPx)), py1); b = Math.min(a + depthPx, down(mapH)); from = "top";
  } else {
    b = Math.min(Math.max(py0 - gap, depthPx), py0); a = Math.max(b - depthPx, 0); from = "bottom";
  }
  return { zone: horizontal ? [a, lo, b, hi] : [lo, a, hi, b], from, side };
}

/** The strip foes arrive in: `foePlan`'s zone. */
export const foeZone = (args) => foePlan(args).zone;

/**
 * What a setUp/changeMap `variant` ("day" | "night" | "camp") means, beside the
 * plain flags: a variant the GM chose wins, "camp" keeps whatever the clock says
 * about night (a camp is as often at dusk as at noon).
 * @returns {{night:boolean, camping:boolean}}
 */
export function resolveVariant({ variant = null, night = false, camping = false } = {}) {
  if (variant === "camp") return { night: !!night, camping: true };
  if (variant === "night") return { night: true, camping: false };
  if (variant === "day") return { night: false, camping: false };
  return { night: !!night, camping: !!camping };
}

/** What a battle records of its variant: the camp art, else night or day. */
export const variantName = ({ camp = false, night = false } = {}) => (camp ? "camp" : night ? "night" : "day");

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomId(length = 16) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

/**
 * A battle, as it is written to the scene's flag (`flags[MODULE_ID].battle`).
 *
 * @typedef {object} BattleRecord
 * @property {string} id            the battle's id; every token it places carries it on `flags[MODULE_ID].battleToken`
 * @property {number} at            when it was set up (ms); the newest open battle is "the" current one
 * @property {"staged"|"live"|"done"} status
 * @property {string|null} originSceneId  where Return to travel goes back to
 * @property {string|null} mapId    the library map, null for a scene the GM brought
 * @property {string|null} sceneId  the scene it is on
 * @property {"day"|"night"|"camp"} variant
 * @property {string|null} terrain
 * @property {*} hex
 * @property {string[]} tokenIds    the tokens this battle PLACED, by exact id: the only ones Return to travel deletes
 * @property {string[]} presentTokenIds  party tokens that were on the scene already, so none was placed: they are put
 *   in the combat and are never deleted. Absent from records written before they existed, which read as none.
 * @property {string|null} combatId the combat made by Bring the table
 * @property {{name:string, uuid:string|null, count:number, distanceRoll:number|null}} encounter
 */

/**
 * A fresh BattleRecord. `encounter` is the held encounter's monster entry; what is kept of it is what
 * a later Change map needs to place the same foes again (the distance among it).
 * @param {object} p
 * @returns {BattleRecord} staged, no combat yet
 */
export function newBattleRecord({
  encounter = null, terrain = null, map = null, variant = "day", originSceneId = null, hex = null,
  now = Date.now(), id = randomId(), sceneId = null, tokenIds = [], presentTokenIds = [],
} = {}) {
  const uuid = encounter?.uuid ?? null;
  const roll = encounter?.distanceRoll == null ? NaN : Number(encounter.distanceRoll);   // Number(null) is 0
  return {
    id,
    at: now,
    status: BATTLE_STATUS.staged,
    originSceneId: originSceneId ?? null,
    mapId: map?.id ?? null,
    sceneId,
    variant,
    terrain: terrain ?? null,
    hex: hex ?? null,
    tokenIds: [...tokenIds],
    presentTokenIds: [...presentTokenIds],
    combatId: null,
    encounter: {
      name: String(encounter?.name ?? ""),
      uuid,
      count: uuid ? Math.max(1, Math.floor(Number(encounter?.count)) || 1) : 0,
      distanceRoll: Number.isFinite(roll) ? roll : null,
    },
  };
}

/**
 * Names for `count` more tokens of an actor whose prototype token numbers its tokens ("Wolf (1)", "Wolf (2)"): each
 * takes the lowest "(n)" that no token of that actor on the scene has, the way Actor#getTokenDocument picks one.
 * That picks for ONE token at a time, from the tokens the scene already has, so a batch made from a single source
 * would be "(1)" all through.
 * @param {string} base            the prototype token's name
 * @param {string[]} existingNames the names of that actor's tokens already on the scene
 * @param {number} count
 * @returns {string[]}
 */
export function numberedNames(base, existingNames, count) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped} \\((\\d+)\\)$`);
  const used = new Set(existingNames.map((name) => Number(pattern.exec(name)?.[1]) || 0));
  return Array.from({ length: count }, () => {
    let n = 1;
    while (used.has(n)) n++;
    used.add(n);
    return `${base} (${n})`;
  });
}

/**
 * The tokens this battle placed and that are still its: listed in the record AND
 * still carrying the battle's id on their flag. Both, because either alone is a
 * guess: an id in the record may have been reused by a token that is not ours,
 * and a flag with no record entry is a token the GM added by hand.
 * @param {object} record
 * @param {Iterable<object>} tokenDocs  token documents (anything with `id` and `flags`)
 * @returns {object[]}
 */
export function battleTokens(record, tokenDocs) {
  if (!record?.id) return [];
  const listed = new Set(record.tokenIds ?? []);
  return [...(tokenDocs ?? [])].filter((t) => listed.has(t?.id) && t.flags?.[MODULE_ID]?.[FLAGS.token] === record.id);
}

/**
 * The exact token ids Return to travel may delete. Never "every token carrying
 * the flag" and never a count: this is the whole list, read from the record.
 * @returns {string[]}
 */
export const tokensToRemove = (record, tokenDocs) => [...new Set(battleTokens(record, tokenDocs).map((t) => t.id))];
