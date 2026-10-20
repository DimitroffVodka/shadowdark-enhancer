/**
 * Shadowdark Enhancer — the landing page as a table you sit at (pure).
 *
 * The page is the module's own render of a candle-lit table (tools/landing-table, Blender), seen from a seat. The props
 * on it are the buttons: the quest tome (Quests), the coin chest (Market), the dice cup (Games), the tankard (Carouse),
 * the framed map (Map), the sealed letter (Rumors), the hourglass (Downtime), the journal (Journals), the tied scrolls
 * (Session recaps). The session
 * title card and the day dial are read-outs. The party's portraits sit round the table's far side. Everything is laid
 * out in the picture's own pixels (landing-table-layout.mjs, written with the render), and the window scales the
 * whole picture as one, so props, seats and overlays stay together at any screen size.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import LAYOUT from "./landing-table-layout.mjs";

const DIR = `modules/${MODULE_ID}/assets/landing-table`;
export const TABLE = { src: `${DIR}/table.webp`, hit: `${DIR}/hit.webp`, width: LAYOUT.width, height: LAYOUT.height, layout: LAYOUT };
export const propSrc = (id) => `${DIR}/props/${id}.webp`;

/** The props that are buttons, in the order the hit map numbers them (1-based): the same order the render uses. */
export const HIT_ORDER = ["quests", "market", "games", "carouse", "map", "rumors", "downtime", "journals", "title", "dial", "recaps"];
/** Props that open something; the title card and the dial only show. */
export const BUTTON_PROPS = ["quests", "market", "games", "carouse", "map", "rumors", "downtime", "journals", "recaps"];
export const SEATS_MAX = 6;

/** The prop under a hit-map value (the map stores 20 per step so a lossy pixel still rounds right), or null. */
export const propAtHit = (value) => HIT_ORDER[Math.round(value / 20) - 1] ?? null;

/**
 * The props this page shows as buttons: the market when it has a merchant, games when it offers any, and every tile
 * the GM left on that has a prop. `labels[id]` gives `{ name, sub, tag, disabled, hint }`.
 */
export function tableProps(page, { hasMerchant, labels = {}, layout = LAYOUT }) {
  const on = new Set([...page.places, ...(page.games?.on ? ["games"] : []), ...(hasMerchant ? ["market"] : [])]);
  return BUTTON_PROPS.filter((id) => on.has(id) && layout.props[id]).map((id) => ({ id, ...layout.props[id], src: propSrc(id), ...(labels[id] ?? {}) }));
}

/** Where the first `n` party portraits sit (at most six): `[{ x, y }]` in picture pixels, the far side first. */
export const seatsFor = (n, layout = LAYOUT) => layout.seats.slice(0, Math.min(n, SEATS_MAX)).map(([x, y]) => ({ x, y }));

/**
 * The CSS matrix3d that lays a `w` x `h` box (origin top left) onto `quad`, four picture points in the order top left,
 * top right, bottom right, bottom left: how the quest lines, the session title and the dial sit on their props in
 * perspective. Solves the 8 unknowns of the projective map from the four corner pairs.
 */
export function homography(w, h, quad) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const [a, bb, cc, d, e, f, g, hh] = b.map((v, i) => v / A[i][i]);
  const n = (v) => +v.toFixed(9);
  return `matrix3d(${[a, d, 0, g, bb, e, 0, hh, 0, 0, 1, 0, cc, f, 0, 1].map(n).join(",")})`;
}

/** The settlement size a hex's tagged ground names (the hex data's own words), or null for open country. */
export const sizeOfGround = (terrain) => (["village", "town", "city", "city_state"].includes(terrain) ? terrain : null);

/**
 * The quest tome's two pages: each active quest's name and its steps with a tick box, filled left page first.
 * `quests` are Quest Log summaries (a player's already without what they may not see); a page holds `perPage` lines.
 */
export function tomePages(quests, perPage = 7) {
  const lines = [];
  for (const q of quests) {
    lines.push({ kind: "quest", text: q.name, done: q.status === "completed" });
    for (const o of (q.objectives ?? []).filter((x) => !x.parent && !x.secret)) lines.push({ kind: "step", text: o.text, done: o.done });
  }
  return [lines.slice(0, perPage), lines.slice(perPage, perPage * 2)];
}

/** The day dial's hand, in degrees clockwise from noon at the top (the sun's half), for a time of day in hours. */
export const dialAngle = (hours) => ((((Number(hours) || 0) + 12) % 24 + 24) % 24) * 15;
