/**
 * Shadowdark Enhancer — rivers, roads and beaches on the drawn hex map (pure, Foundry-free, node-tested).
 *
 * Step 3 of docs/plans/hex-painting.md. Ported from Shadowdark Extras (MIT, © 2025 gmdima; see CREDITS.md):
 * the piece tables and the cover search are canvas/map-network-art.mjs, the river network rules (a spanning
 * forest, so marked hexes don't close into triangles; a dead end opens into the water ahead) are
 * canvas/drawing-geometry.mjs buildMapPathNetwork, and the shore rules (sand on the WATER hex along its land
 * edges, ice on arctic water, the GM's coast marks choosing the pairs) are HexcrawlBuilderSD coastTileData.
 * Extras' hex-water-terrain.mjs is a copy of tag-store COASTAL_WATER, so that list is used directly.
 *
 * The Enhancer reads all of it from the tag store's features instead of Extras' stored polylines and records, and
 * works in printed hex numbers, so nothing here needs the canvas grid.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { offsetToCube } from "./geometry.mjs";
import { COASTAL_WATER } from "./tag-store.mjs";

/** Water for the shore rules: the coastal water terrains, and an island hex, which is sea around its island. */
const WATER = new Set([...COASTAL_WATER, "island"]);

const ROOT = `modules/${MODULE_ID}/assets/`;
const PIECE_FILES = {
  river: `${ROOT}hex-overlays/Paths/Hex - River`,
  path: `${ROOT}hex-overlays/Paths/Hex - Dirt Path`,
  beach: `${ROOT}hex-overlays/Coast/Hex - Coast - Beach`,
  // The three ice pieces ship at a quarter of the beach size with the hex placed identically, so they scale alike.
  ice: `${ROOT}hexes/Specials/Hex - Coast - Ice Floats`,
};

/** Draw order over the ground: shore, then rivers, then roads, so a road over a river reads as a bridge. */
export const LAYERS = { beach: 1, ice: 1, river: 2, path: 3 };

// Edges run clockwise on screen from the top: N=0 NE=1 SE=2 S=3 SW=4 NW=5 (flat-top hexes).
const N = 0, NE = 1, SE = 2, S = 3, SW = 4, NW = 5;

/** Piece name (after "Hex - River " / "Hex - Dirt Path ") → the edges its channel reaches. */
export const ART_PIECES = {
  "1 N": [N], "1 NE": [NE], "1 SE": [SE], "1 S": [S],
  "6 N": [N], "6 NE": [NE], "6 SE": [SE], "6 S": [S],
  "10 N": [N], "10 NW": [NW], "10 S": [S], "10 SW": [SW],
  "2 N": [N, S], "2 NE": [NE, SW], "9 N": [N, S], "9 SE": [SE, NW],
  "4 N": [N, SW], "4 NE": [NE, NW], "4 S": [S, NW], "4 SE": [SE, SW],
  "5 NE": [N, NE], "5 E": [NE, SE], "5 SE": [SE, S],
  "8 NW": [N, NW], "8 SW": [S, SW], "8 W": [SW, NW],
  "3 N": [N, S, SW], "3 NE": [NE, SW, NW], "3 SE": [N, SE, NW],
  "7 N": [N, SE, S], "7 NW": [NE, SE, NW], "7 S": [N, NE, S],
  "7 SE": [N, SE, NW], "7 SW": [NE, SE, SW],
  "11 N": [N, NE, NW], "11 NE": [N, NE, SE], "11 S": [SE, S, SW], "11 SE": [NE, SE, S],
  "12 E": [NE, SE, SW, NW], "12 N": [N, SE, S, NW],
  "13 N": [N, SE, S, SW], "13 NE": [NE, S, SW, NW],
  "13 S": [N, NE, S, NW], "13 SE": [N, SE, SW, NW],
};

/** Piece name (after "Hex - Coast - Beach ") → the edges its sand lies along. */
export const COAST_PIECES = {
  "(small) N": [N], "(small) NW": [NW], "(small) S": [S], "(small) SW": [SW],
  "(medium) NW": [N, NW], "(medium) SW": [S, SW], "(medium) W": [SW, NW],
  "(big) N": [NW, N, NE], "(big) NW": [SW, NW, N], "(big) S": [SE, S, SW], "(big) SW": [S, SW, NW],
};

/** Piece name (after "Hex - Coast - Ice Floats ") → the edges the shelf lies along. */
export const ICE_PIECES = { "(small) N": [N], "(medium) NW": [N, NW], "(big) N": [NW, N, NE] };

const edgeKey = (edges) => [...edges].sort().join("");
// Mirror across the vertical axis first (N and S stay put), then turn clockwise: the order PIXI applies a
// sprite's scale and rotation in.
const orient = (edges, rotation, mirror) => edges.map((k) => ((mirror ? (6 - k) % 6 : k) + rotation) % 6).sort();

/**
 * Every orientation of every piece, indexed by the edge set it serves. `lone` says which pieces may stand alone on a
 * single edge: the river's lake piece (10) spills into the neighbours, so it is never placed unasked.
 * @returns {(edges:number[], seed?:number) => {name:string, rotation:number, mirror:boolean}[]}
 */
function makeCover(pieces, { lone = () => true } = {}) {
  const variants = [];
  const exact = new Map();
  for (const [name, edges] of Object.entries(pieces)) {
    for (const mirror of [false, true]) {
      for (let rotation = 0; rotation < 6; rotation++) {
        const variant = { name, rotation, mirror, edges: orient(edges, rotation, mirror) };
        variants.push(variant);
        const key = edgeKey(variant.edges);
        if (!exact.has(key)) exact.set(key, []);
        exact.get(key).push(variant);
      }
    }
  }
  // Bigger pieces first, then unmirrored, then the artist's own turn: the greedy cover reaches for one stroke.
  variants.sort((a, b) => (b.edges.length - a.edges.length) || (a.mirror - b.mirror) || (a.rotation - b.rotation));
  return function cover(edges, seed = 0) {
    const wanted = [...new Set(edges)].filter((k) => k >= 0 && k < 6).sort();
    if (!wanted.length) return [];
    let candidates = exact.get(edgeKey(wanted)) ?? [];
    if (wanted.length === 1) candidates = candidates.filter(lone);
    if (candidates.length) {
      const unmirrored = candidates.filter((v) => !v.mirror);
      const pool = unmirrored.length ? unmirrored : candidates;
      return [pool[Math.abs(seed) % pool.length]];
    }
    // No single piece: the fewest pieces whose edges lie inside the set and together cover it.
    const inside = variants.filter((v) => v.edges.every((k) => wanted.includes(k)) && (v.edges.length > 1 || lone(v)));
    const picked = [];
    const uncovered = new Set(wanted);
    while (uncovered.size) {
      let best = null, bestGain = 0;
      for (const variant of inside) {
        const gain = variant.edges.filter((k) => uncovered.has(k)).length;
        if (gain > bestGain) { best = variant; bestGain = gain; }
      }
      if (!best) break;
      picked.push(best);
      for (const k of best.edges) uncovered.delete(k);
    }
    return picked;
  };
}

export const coverEdges = makeCover(ART_PIECES, { lone: (v) => !v.name.startsWith("10 ") });
export const coverCoastEdges = makeCover(COAST_PIECES);
export const coverIceEdges = makeCover(ICE_PIECES);
const COVERS = { river: coverEdges, path: coverEdges, beach: coverCoastEdges, ice: coverIceEdges };

/** Cube step → the edge it crosses. */
const EDGE_OF_STEP = new Map([["0,-1", N], ["1,-1", NE], ["1,0", SE], ["0,1", S], ["-1,1", SW], ["-1,0", NW]]);
const STEPS = [...EDGE_OF_STEP.keys()].map((k) => k.split(",").map(Number));

/**
 * The hex numbers next to each hex, by edge.
 * @param {Map<string, {col:number, row:number}>} cells  published number → printed offset
 * @returns {Map<string, (string|null)[]>} number → six neighbour numbers (null off the tagged map), index = edge
 */
function neighbourTable(cells, shifted) {
  const byCube = new Map();
  for (const [num, { col, row }] of cells) { const c = offsetToCube(col, row, shifted); byCube.set(`${c.q},${c.r}`, num); }
  const table = new Map();
  for (const [num, { col, row }] of cells) {
    const c = offsetToCube(col, row, shifted), around = [null, null, null, null, null, null];
    for (const [dq, dr] of STEPS) around[EDGE_OF_STEP.get(`${dq},${dr}`)] = byCube.get(`${c.q + dq},${c.r + dr}`) ?? null;
    table.set(num, around);
  }
  return table;
}

/**
 * Edges of a river or road network: each marked hex reaches the marked neighbours a spanning forest keeps (marked
 * hexes are an area, and three that touch would otherwise draw as a triangle). A river that dead-ends beside water
 * runs on into the water hex most nearly straight ahead.
 * @param {Set<string>} marked  numbers of the hexes carrying the feature
 * @param {Map<string, (string|null)[]>} around  neighbourTable()
 * @param {(num:string) => boolean} [isWater]  rivers only
 * @returns {Map<string, number[]>} number → edges
 */
export function networkEdges(marked, around, isWater = null) {
  const links = new Map([...marked].map((num) => [num, new Set()]));
  const reached = new Set();
  for (const root of [...marked].sort()) {
    if (reached.has(root)) continue;
    reached.add(root);
    const queue = [root];
    while (queue.length) {
      const here = queue.shift();
      around.get(here)?.forEach((there, edge) => {
        if (!there || !marked.has(there) || reached.has(there)) return;
        reached.add(there);
        links.get(here).add(edge);
        links.get(there).add((edge + 3) % 6);
        queue.push(there);
      });
    }
  }
  if (isWater) {
    for (const [num, edges] of links) {
      if (edges.size !== 1 || isWater(num)) continue;
      const ahead = ([...edges][0] + 3) % 6;
      // The water most nearly straight ahead: on, then a sixth of a turn either way, then a third.
      const out = [0, 1, 5, 2, 4].map((turn) => (ahead + turn) % 6).find((edge) => {
        const there = around.get(num)?.[edge];
        return there && !marked.has(there) && isWater(there);
      });
      if (out !== undefined) edges.add(out);
    }
  }
  return new Map([...links].filter(([, edges]) => edges.size).map(([num, edges]) => [num, [...edges].sort()]));
}

/**
 * The sand (or ice) each water hex wears along the edges it shares with land. Once any hex carries a coast mark, a
 * pair is lined only when the land or the water side carries one, so taking a mark off takes its beach away.
 * @returns {Map<string, {style:"beach"|"ice", edges:number[]}>}
 */
export function shoreEdges(terrainOf, coastal, around) {
  const marked = coastal.size > 0;
  const out = new Map();
  for (const [num, terrain] of terrainOf) {
    if (!WATER.has(terrain)) continue;
    const edges = [];
    around.get(num)?.forEach((there, edge) => {
      const land = there && terrainOf.has(there) && !WATER.has(terrainOf.get(there));
      if (land && (!marked || coastal.has(there) || coastal.has(num))) edges.push(edge);
    });
    if (edges.length) out.set(num, { style: terrain === "arctic_sea" ? "ice" : "beach", edges });
  }
  return out;
}

/**
 * Every overlay piece per hex: what to draw over the ground, and how to turn it.
 * @param {Map<string, {col:number, row:number, terrain:string, features:string[]}>} cells  the tagged hexes
 * @param {"odd"|"even"} [shifted]
 * @returns {Map<string, {src:string, rotation:number, mirror:boolean, layer:number}[]>} rotation in radians
 */
export function overlaysOf(cells, shifted = "odd") {
  const around = neighbourTable(cells, shifted);
  const terrainOf = new Map([...cells].map(([num, c]) => [num, c.terrain]));
  const having = (feature) => new Set([...cells].filter(([, c]) => c.features?.includes(feature)).map(([num]) => num));
  const isWater = (num) => WATER.has(terrainOf.get(num));
  const wanted = [
    ...[...shoreEdges(terrainOf, having("coast"), around)].map(([num, { style, edges }]) => [num, style, edges]),
    ...[...networkEdges(having("river"), around, isWater)].map(([num, edges]) => [num, "river", edges]),
    ...[...networkEdges(having("path"), around)].map(([num, edges]) => [num, "path", edges]),
  ];
  const out = new Map();
  for (const [num, kind, edges] of wanted) {
    const { col, row } = cells.get(num);
    for (const piece of COVERS[kind](edges, Math.abs((col * 31) + (row * 17)))) {
      if (!out.has(num)) out.set(num, []);
      out.get(num).push({
        src: `${PIECE_FILES[kind]} ${piece.name}.webp`, rotation: piece.rotation * Math.PI / 3, mirror: piece.mirror, layer: LAYERS[kind],
      });
    }
  }
  return out;
}
