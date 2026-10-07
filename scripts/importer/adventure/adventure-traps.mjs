/**
 * Shadowdark Enhancer — where an adventure's traps sit on its map.
 *
 * Positions only, like the pins (adventure-layouts.mjs) and the walls (adventure-walls.mjs): for a trap the book prints
 * under a numbered area, "it is the Nth trap line of area 12, here is how far around the pin it reaches". No book text
 * ships. What the trap IS (its name, check, damage, how often it fires) is read out of the GM's own book when the scene is
 * built, by the same reader the hand-built traps use (traps/trap-core.mjs parseTrapText), and filed on the GM's scene.
 *
 *   pin     the area number the trap is printed under
 *   nth     which of that area's trap lines it is (1 for the first): trapCandidates counts them in book order
 *   dc      the DC the book prints for the check, as a sanity check: a line that does not carry it is not the line this
 *           data was made for (a different edition of the book), and no trap is made from it. Left out for a trap with no check
 *   radius  how many squares around the pin the trap reaches, along walkable floor (the walls stop it, so it fills the
 *           room, never the rock beside it); half squares are fine
 *   box     instead of a radius, a plain rectangle [x, y, width, height] as fractions of the map: the room the trap fills, or the
 *           square the book's own map draws for it (the three acid quicksand traps are dashed squares about two squares across,
 *           measured off the book's map spread), one shape a GM resizes by its corners
 *   shape   instead of a radius, the area itself: a polygon as [x, y] fractions of the map, for a hazard the floor does not
 *           describe (a river runs between the banks, which the walls do not draw)
 *   when    optional: how the trap fires, for one the words do not tell (a shrine that fires when touched is "manual")
 */
import { parseTrapText } from "../../traps/trap-core.mjs";
import { stripBold } from "../pdf-text-utils.mjs";

export const ADVENTURE_TRAPS = {
  // The Hideous Halls of Mugdulblub. Areas 23 (a table of what the river carries) and 30 (a chance of an encounter) also
  // read like hazards in the book but are not traps, so they are not here.
  "cs1-mugdulblub": [
    { pin: 2, nth: 1, dc: 12, box: [0.7794, 0.1368, 0.0309, 0.0477] },
    { pin: 3, nth: 2, dc: 15, box: [0.7353, 0.0682, 0.0882, 0.0455] },
    { pin: 12, nth: 1, dc: 18, box: [0.3235, 0.341, 0.0588, 0.1591] },
    { pin: 13, nth: 1, dc: 12, box: [0.3293, 0.1109, 0.0309, 0.0477] },
    { pin: 15, nth: 1, dc: 12, box: [0.1912, 0.0455, 0.0735, 0.0909] },
    { pin: 20, nth: 1, dc: 12, box: [0.0425, 0.6365, 0.0309, 0.0477] },
    { pin: 24, nth: 1, dc: 12, shape: [[0.3706, 0.7729], [0.3809, 0.741], [0.4674, 0.6965], [0.4746, 0.636], [0.4859, 0.6042], [0.5147, 0.5803], [0.5147, 0.6137], [0.49, 0.6519], [0.4818, 0.7124], [0.4076, 0.7474], [0.3871, 0.7729]] },
    { pin: 28, nth: 1, dc: 12, box: [0.7941, 0.8411, 0.0441, 0.0682], when: "manual" },
    { pin: 29, nth: 1, dc: 18, box: [0.8971, 0.8183, 0.0588, 0.0909] },
    { pin: 31, nth: 1, dc: 12, shape: [[0.8987, 0.6126], [0.8977, 0.6658], [0.913, 0.6983], [0.8987, 0.7426], [0.8719, 0.7574], [0.8241, 0.7412], [0.8088, 0.7426], [0.8088, 0.75], [0.8566, 0.7796], [0.8949, 0.7633], [0.9235, 0.7279], [0.9283, 0.6924], [0.9254, 0.6747], [0.9121, 0.6628], [0.9121, 0.6126]] },
  ],
};

/**
 * Whether the importer places these traps on a scene. Off for now: the Trap behavior ships (a GM adds it to any Region), but no
 * map gets its book traps built in yet. Turn it on and the build, the placer's Add traps button and
 * `game.shadowdarkEnhancer.traps.placeAdventure()` use the data below again.
 */
export const PLACE_ADVENTURE_TRAPS = false;

export const trapsFor = (siteId) => (PLACE_ADVENTURE_TRAPS ? ADVENTURE_TRAPS[siteId] : null) ?? null;

/** Flag on every region this module made from this data, so a run can tell its own traps from the GM's. */
export const TRAP_REGION_FLAG = "adventureTrap";

/**
 * A line that opens with a label the books put in front of a hazard ("Floor.", "Trap.", "River."). A "Door." or "Wall." line is a lock
 * or a barrier with a DC, not a trap, so it is not a candidate: counting it would move every `nth` after it.
 */
const LABELLED = /^(?:trap|floor|ceiling|stalagmites?|rock pillar|river)\b/i;
/** ...and talks like one: a DC, the word trap, damage each round. */
const TRAPISH = /\bDC\s*\d+|\btrap\b|damage\/round|\bper round\b/i;

/**
 * Pure: the lines of an area that may be traps, in book order. Counting them the same way when the data was made and when a
 * GM imports is what ties `nth` to a line, so this is the one definition of "a candidate".
 * @param {Array<{kind:string, text:string}>} blocks  bodyBlocks of the area
 * @returns {string[]} plain text of each candidate
 */
export function trapCandidates(blocks) {
  return (blocks ?? [])
    .filter((b) => b.kind === "li")
    .map((b) => stripBold(b.text).replace(/\s+/g, " ").trim())
    .filter((text) => LABELLED.test(text) && TRAPISH.test(text));
}

/**
 * Pure: the outline of a set of squares as polygon shapes: one polygon around each connected patch, so a trap's area is one
 * shape a GM can reshape by its corners, not a stack of rectangles. A patch with a gap inside it (a pillar) also gets the gap
 * as a `hole` polygon, listed after the outlines.
 * @param {Array<[number, number]>} squares  [column, row]
 * @param {{x:number, y:number}} rect  the scene's image area
 * @param {number} gridSize
 */
export function squareOutline(squares, rect, gridSize) {
  const cells = new Set(squares.map(([c, r]) => `${c},${r}`));
  const has = (c, r) => cells.has(`${c},${r}`);
  // Each square's sides that face nothing, directed so the square is on the right (clockwise on screen); two squares' shared side cancels.
  const out = new Map();
  const add = (x1, y1, x2, y2) => { const k = `${x1},${y1}`; (out.get(k) ?? out.set(k, []).get(k)).push([x2, y2]); };
  for (const [c, r] of squares) {
    if (!has(c, r - 1)) add(c, r, c + 1, r);
    if (!has(c + 1, r)) add(c + 1, r, c + 1, r + 1);
    if (!has(c, r + 1)) add(c + 1, r + 1, c, r + 1);
    if (!has(c - 1, r)) add(c, r + 1, c, r);
  }
  const loops = [];
  for (const [startKey] of out) {
    while (out.get(startKey)?.length) {
      const start = startKey.split(",").map(Number), ring = [start];
      let at = start;
      for (;;) {
        const next = out.get(`${at}`)?.pop();
        if (!next) break;
        if (next[0] === start[0] && next[1] === start[1]) break;
        ring.push(next);
        at = next;
      }
      // Drop a corner that is not one: three points in a line.
      const kept = ring.filter((p, i) => {
        const a = ring[(i + ring.length - 1) % ring.length], b = ring[(i + 1) % ring.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      if (kept.length >= 3) loops.push(kept);
    }
  }
  // Clockwise on screen (the shoelace sum is positive) is an outline; anticlockwise is a gap.
  const area = (ring) => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + (p[0] * q[1] - q[0] * p[1]); }, 0);
  const shape = (ring) => ({
    type: "polygon", hole: area(ring) < 0,
    points: ring.flatMap(([x, y]) => [rect.x + x * gridSize, rect.y + y * gridSize]),
  });
  return [...loops.filter((r) => area(r) > 0), ...loops.filter((r) => area(r) < 0)].map(shape);
}

/**
 * Pure: the traps to make on a scene.
 * @param {object} args
 * @param {Array<{pin:number, nth:number, dc?:number, radius?:number, when?:string}>} args.entries  the shipped data for the site
 * @param {Record<number, string[]>} args.texts  trapCandidates per area number, read from the GM's book
 * @param {Record<number, {x:number, y:number}>} args.pins  the scene's pins, in scene pixels
 * @param {{x:number, y:number, width:number, height:number}} args.rect  the scene's image area
 * @param {number} args.gridSize
 * @param {(pin:{x:number, y:number}) => Array<[number, number, number?]>} args.squaresOf  the floor squares reachable from a pin as [column, row, steps walked from the pin]
 * @returns {{traps: Array<{pin:number, nth:number, name:string, system:object, shapes:object[]}>, skipped: Array<{pin:number, nth:number, why:"text"|"dc"|"pin"|"floor"}>}}
 */
export function planSiteTraps({ entries, texts, pins, rect, gridSize, squaresOf }) {
  const traps = [], skipped = [];
  for (const e of entries ?? []) {
    const skip = (why) => skipped.push({ pin: e.pin, nth: e.nth, why });
    const text = texts?.[e.pin]?.[e.nth - 1];
    if (!text) { skip("text"); continue; }
    const record = parseTrapText(text);
    if (e.dc !== undefined && !(record.checkAbility !== "none" && record.checkDc === e.dc)) { skip("dc"); continue; }
    let shapes;
    if (e.box) {
      const [u, v, w, h] = e.box;
      shapes = [{ type: "rectangle", x: Math.round(rect.x + u * rect.width), y: Math.round(rect.y + v * rect.height), width: Math.round(w * rect.width), height: Math.round(h * rect.height), rotation: 0, hole: false }];
    } else if (e.shape) {
      shapes = [{ type: "polygon", points: e.shape.flatMap(([u, v]) => [Math.round(rect.x + u * rect.width), Math.round(rect.y + v * rect.height)]), hole: false }];
    } else {
      const pin = pins?.[e.pin];
      if (!pin) { skip("pin"); continue; }
      const pc = Math.floor((pin.x - rect.x) / gridSize), pr = Math.floor((pin.y - rect.y) / gridSize);
      const reach = e.radius ?? 2;
      // Near in a straight line AND on foot (twice the radius at most): a square on the far side of a thin wall is not in the room.
      const squares = squaresOf(pin).filter(([c, r, steps]) => Math.hypot(c - pc, r - pr) <= reach && (steps === undefined || steps <= 2 * reach));
      if (!squares.length) { skip("floor"); continue; }
      shapes = squareOutline(squares, rect, gridSize);
    }
    const system = { ...record, ...(e.when ? { when: e.when } : {}) };
    traps.push({ pin: e.pin, nth: e.nth, name: `${e.pin}. ${record.trap || "Trap"}`, system, shapes });
  }
  return { traps, skipped };
}
