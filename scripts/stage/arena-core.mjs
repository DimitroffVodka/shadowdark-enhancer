/**
 * Arena fight, pure core: the six looks, the ring geometry and where the tokens stand.
 * No `game`, no `canvas`; the scene builder and the opener code against these exports.
 *
 * RETIRED flag keys, never to be reused for anything: `zoneFight`, `zone`, `zoneClone`, `zoneFoes`
 * (the old tokenless zone fight left them in live worlds).
 *
 * Units: the scene is gridless, S = the picture's short side = 160 ft on every look,
 * g = round(S / 32) px per 5-ft square, so 1 ft = g / 5 px. Positions are top-left token corners in map pixels.
 */
import { getArenaMap } from "../pit-fighting/arena-maps.mjs";
import { readyById } from "./places-core.mjs";

export const RING_BANDS = Object.freeze(["close", "near", "far"]);
/** Ring centre radii in feet. */
export const RING_FEET = Object.freeze({ close: 15, near: 40, far: 70 });
export const RINGS_TILE_PATH = "modules/shadowdark-enhancer/assets/scenes/arena-fight/rings.webp";

const THUMBS = "modules/shadowdark-enhancer/assets/scenes/arena-fight/thumbs/";
const arenaLook = (id, labelKey, mapId) => {
  const m = getArenaMap(mapId);
  return Object.freeze({ id, labelKey, image: m.image, thumb: `${THUMBS}${id}.webp`, width: m.width, height: m.height });
};
// Pixel sizes of the shipped files in assets/scenes/places/ (the test reads the WebP headers).
const placeLook = (id, labelKey, placeId, width, height) => {
  const p = readyById(placeId);
  return Object.freeze({ id, labelKey, image: p.image, thumb: p.thumb, width, height });
};

export const ARENA_LOOKS = Object.freeze([
  arenaLook("arena-pit", "SDE.stage.arena.lookPit", "greybanner-arena"),
  arenaLook("arena-coliseum", "SDE.stage.arena.lookColiseum", "greybanner-coliseum-day"),
  arenaLook("arena-ring", "SDE.stage.arena.lookRing", "tournament-ring-tourney-day"),
  placeLook("arena-tavern", "SDE.stage.arena.lookTavern", "ready-tavern", 1584, 1152),
  placeLook("arena-town", "SDE.stage.arena.lookTown", "ready-town", 2048, 1489),
  placeLook("arena-market", "SDE.stage.arena.lookMarket", "ready-market", 2048, 1425),
]);

export const arenaLookById = (id) => ARENA_LOOKS.find((l) => l.id === id) ?? null;
export const isArenaLook = (id) => arenaLookById(id) !== null;

const PLACE_LOOK = { "ready-tavern": "arena-tavern", "ready-town": "arena-town", "ready-market": "arena-market" };
/** The look for the Backdrop's ready place when one is showing, else the pit. Never null. */
export function defaultLook(stage) {
  const id = stage?.shown ? PLACE_LOOK[stage.place] : null;
  return arenaLookById(id ?? "arena-pit");
}

/**
 * Ring and label geometry for a picture. A label is a text whose LEFT edge sits at x and whose vertical centre sits at y:
 * 3 o'clock, on the picture's centre line, just outside its ring (the Combat tracker covers 12 o'clock at game zoom).
 * Foes start at 6 o'clock, so nothing stands there. The scene builder places the text box.
 */
export function arenaGeometry(width, height) {
  const S = Math.min(width, height);
  const g = Math.round(S / 32);
  const cx = width / 2, cy = height / 2;
  const rings = {}, labels = [];
  for (const band of RING_BANDS) {
    rings[band] = RING_FEET[band] * g / 5;
    labels.push({ band, x: cx + rings[band] + g * 0.25, y: cy, fontSize: Math.round(0.9 * g) });
  }
  return { S, g, cx, cy, rings, tile: { x: cx - S / 2, y: cy - S / 2, width: S, height: S }, labels };
}

const ROW_FEET = { close: 12.5, near: 37.5, far: 70 };
const ROW_MIN = 12.5, ROW_MAX = 77.5;

/** Foe row radii in feet for a band: the band row first, then -5, +5, -10, +10 ... clamped, no duplicates. */
export function foeRowRadii(band) {
  const base = ROW_FEET[band] ?? ROW_FEET.near;
  const out = [];
  for (let k = 0; k <= 13; k++) {
    for (const off of k === 0 ? [0] : [-5 * k, 5 * k]) {
      const r = Math.min(ROW_MAX, Math.max(ROW_MIN, base + off));
      if (!out.includes(r)) out.push(r);
    }
  }
  return out;
}

const size1 = (n) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.ceil(Number(n)) : 1);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Token positions (top-left, map px, input order) for the party and the foes. Deterministic.
 * `occupied` is the tokens already on the scene, `{ x, y, s }` centres in map px with `s` the footprint in squares:
 * they count as placed before the party, so nobody is laid over them.
 */
export function arenaLayout({ geometry, pcSizes = [], foeSizes = [], band = null, occupied = [] } = {}) {
  const { g, cx, cy } = geometry;
  const W = cx * 2, H = cy * 2;
  const ft = g / 5;
  const placed = occupied.map(({ x, y, s }) => ({ x, y, s: size1(s) }));   // { x, y, s } centres, for the overlap test
  const clampTL = (x, y, s) => ({
    x: round2(Math.min(Math.max(x - s * g / 2, 0), W - s * g)),
    y: round2(Math.min(Math.max(y - s * g / 2, 0), H - s * g)),
  });
  const inside = (x, y, s) => x - s * g / 2 >= -1e-6 && y - s * g / 2 >= -1e-6 && x + s * g / 2 <= W + 1e-6 && y + s * g / 2 <= H + 1e-6;
  const free = (x, y, s) => inside(x, y, s) && placed.every((p) => Math.hypot(p.x - x, p.y - y) >= (p.s + s) / 2 * g - 1e-6);

  // The first free slot on the rows (feet from the centre), arcs from 6 o'clock alternating right and left; chord step = s * 5 + 1 ft.
  const slot = (s, rows) => {
    for (const R of rows) {
      const step = 2 * Math.asin(Math.min(1, (s * 5 + 1) * ft / (2 * R)));
      const max = Math.floor(Math.PI / step);
      for (let j = 0; j <= 2 * max; j++) {
        const k = j % 2 ? (j + 1) / 2 : -j / 2;   // 0, 1, -1, 2, -2 ...
        const a = k * step, x = cx + R * Math.sin(a), y = cy + R * Math.cos(a);
        if (free(x, y, s)) return { x, y };
      }
    }
    return null;
  };

  const pcs = pcSizes.map(size1);
  const n = pcs.length, sMax = Math.max(1, ...pcs);
  const pcR = n < 2 ? 0 : Math.max(2.5, sMax * 5 / (2 * Math.sin(Math.PI / n))) * ft;
  const pcRows = foeRowRadii("close").map((r) => r * ft);
  const pcOut = pcs.map((s, i) => {
    const a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(n, 1);
    let x = cx + pcR * Math.cos(a), y = cy + pcR * Math.sin(a);
    // Only a token already on the scene can take the circle spot; without any, the circle is as it always was.
    if (occupied.length && !free(x, y, s)) ({ x, y } = slot(s, pcRows) ?? { x, y });
    placed.push({ x, y, s });
    return clampTL(x, y, s);
  });

  const rows = foeRowRadii(band).map((r) => r * ft);
  const foeOut = foeSizes.map(size1).map((s) => {
    const spot = slot(s, rows);
    if (spot) { placed.push({ ...spot, s }); return clampTL(spot.x, spot.y, s); }
    // Nothing fits: stack at 6 o'clock on the last row; a token is never lost.
    const R = rows[rows.length - 1];
    placed.push({ x: cx, y: cy + R, s });
    return clampTL(cx, cy + R, s);
  });
  return { pcs: pcOut, foes: foeOut };
}

/**
 * The first view of a fight: Foundry's scene `initial` ({ x, y } map-pixel centre, `scale` the canvas scale).
 * `placements` is `{ pcs, foes }`, each `{ x, y, s? }` top-left (what arenaLayout returns) plus `s`, the footprint in
 * squares (default 1). The box holds every token with a 12 ft margin; with no foes (a party-only start) the party's
 * box is not framed, the view is maxScale centred on the party.
 * Assumes a usable viewport of about 1000 x 560 CSS px (Foundry's tracker row, hotbar and side bars take the rest).
 * Scale is the largest that fits both axes, clamped to [22/g, 50/g]: a token never under ~22 px, never over the engine's ~50 px.
 * Below the floor (a huge spread) the far side is cut off rather than shrinking the tokens to dots.
 * The centre is the box middle, clamped into the picture.
 */
export const VIEW_PX = Object.freeze({ width: 1000, height: 560 });
export function fightView({ geometry, placements = {} } = {}) {
  const { g, cx, cy } = geometry;
  const maxScale = 50 / g, minScale = 22 / g, margin = g * 12 / 5;
  const pcs = placements.pcs ?? [], foes = placements.foes ?? [];
  const boxOf = (list) => {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const t of list) {
      const s = size1(t.s);
      b.x0 = Math.min(b.x0, t.x); b.y0 = Math.min(b.y0, t.y);
      b.x1 = Math.max(b.x1, t.x + s * g); b.y1 = Math.max(b.y1, t.y + s * g);
    }
    return b;
  };
  const clampIn = (v, max) => Math.round(Math.min(Math.max(v, 0), max));
  const all = [...pcs, ...foes];
  if (!all.length) return { x: Math.round(cx), y: Math.round(cy), scale: maxScale };
  const b = boxOf(foes.length ? all : pcs);
  const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
  const scale = foes.length
    ? Math.min(maxScale, Math.max(minScale, Math.min(VIEW_PX.width / (b.x1 - b.x0 + 2 * margin), VIEW_PX.height / (b.y1 - b.y0 + 2 * margin))))
    : maxScale;
  return { x: clampIn(mx, cx * 2), y: clampIn(my, cy * 2), scale };
}
