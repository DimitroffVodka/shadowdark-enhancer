/** Fixed formation and conservative wall-safe placement. No Foundry globals. */
const DEFAULT_SLOTS = [[0, -1], [0, 0], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
export function fillFormation(data, rows) {
  const saved = data.formation?.slots ?? [];
  if (saved.some(s => ![-1, 0, 1].includes(s.col) || ![-1, 0, 1].includes(s.row))) return { ...data.formation, needsReview: true };
  const eligible = rows.filter(r => r.group === "characters" || r.group === "hirelings").map(r => r.uuid);
  const slots = [], occupied = new Set(), assigned = new Set();
  for (const s of saved) {
    const key = `${s.col},${s.row}`;
    if (!eligible.includes(s.memberUuid) || assigned.has(s.memberUuid) || occupied.has(key)) continue;
    slots.push({ ...s }); occupied.add(key); assigned.add(s.memberUuid);
  }
  for (const memberUuid of eligible) {
    if (assigned.has(memberUuid)) continue;
    const position = DEFAULT_SLOTS.find(([col, row]) => !occupied.has(`${col},${row}`));
    if (!position) break;
    const [col, row] = position;
    slots.push({ memberUuid, col, row }); occupied.add(`${col},${row}`);
  }
  return { slots };
}
export function deploymentOrder(data, rows) {
  const formation = fillFormation(data, rows);
  // An older larger formation is retained but not used without review.
  const slots = formation.needsReview ? fillFormation({ formation: { slots: [] } }, rows).slots : formation.slots;
  const members = rows.filter(r => r.group === "characters" || r.group === "hirelings");
  const out = [...slots].sort((a, b) => a.row - b.row || a.col - b.col);
  const assigned = new Set(out.map(s => s.memberUuid));
  const overflow = members.filter(r => !assigned.has(r.uuid));
  overflow.forEach((r, n) => out.push({ memberUuid: r.uuid, col: n % 3 - 1, row: 2 + Math.floor(n / 3) }));
  return out;
}
export function followOrder(data, rows) {
  const order = deploymentOrder(data, rows).map(s => s.memberUuid);
  return order.includes(data.leaderUuid) ? [data.leaderUuid, ...order.filter(u => u !== data.leaderUuid)] : order;
}
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
/**
 * Core's own test for a token moving between two squares: inside the scene, and a clear line between the
 * two squares' centres. A square that only touches a pillar's corner is fine to stand on or walk through.
 * Followers use it along the leader's trail; placement uses it from the party token to each slot.
 */
export function safeTrail(from, to, width, height, bounds, blocked) {
  if (to.x < bounds.x || to.y < bounds.y || to.x + width > bounds.x + bounds.width || to.y + height > bounds.y + bounds.height) return false;
  const mid = p => ({ x: p.x + width / 2, y: p.y + height / 2 });
  return !blocked(mid(from), mid(to));
}
/**
 * Quarter turns clockwise from north for a step (dx, dy) in screen coordinates, snapped to the dominant axis:
 * 0 north, 1 east, 2 south, 3 west. A zero step has no heading.
 */
export function headingTurns(dx, dy) {
  if (!dx && !dy) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy < 0 ? 0 : 2);
}
/** A slot offset turned `turns` quarter turns clockwise, so the grid's top row ("front") faces the heading. */
export function turnSlot({ col, row }, turns) {
  let c = col, r = row;
  for (let n = 0; n < turns; n++) [c, r] = [0 - r, c];
  return { col: c, row: r };
}
/**
 * The squares to walk, one adjacent square at a time, from `from` toward the grid slot `slot` (both top-left
 * points) without crossing a wall. The search runs outward over the whole scene (scene bounds are part of
 * safeTrail) and stops at the slot; if the slot cannot be had (rock, or already taken: `avoid`, "i,j" keys)
 * it takes the reachable square nearest the slot. `maxCells` bounds one search on a huge scene (about 11 µs a
 * collision call, 8 per square). [] means stay put, null means nothing at all is reachable.
 */
export function routeToward({ from, slot, grid, sizeX, sizeY, bounds, blocked, avoid = new Set(), maxCells = 5000 }) {
  const key = o => `${o.i},${o.j}`, point = o => grid.getTopLeftPoint(o);
  const startOffset = grid.getOffset({ x: from.x + sizeX / 2, y: from.y + sizeY / 2 });
  const goal = key(grid.getOffset({ x: slot.x + sizeX / 2, y: slot.y + sizeY / 2 })), wantGoal = !avoid.has(goal);
  // One search asks about the same pair of squares from both ends.
  const memo = new Map();
  const clear = (a, b) => { const k = `${a.x},${a.y},${b.x},${b.y}`; if (!memo.has(k)) memo.set(k, safeTrail(a, b, sizeX, sizeY, bounds, blocked)); return memo.get(k); };
  const seen = new Map([[key(startOffset), { offset: startOffset, depth: 0, prev: null }]]);
  let queue = [startOffset], found = key(startOffset) === goal && wantGoal;
  for (let depth = 1; queue.length && !found && seen.size < maxCells; depth++) {
    const next = [];
    for (const here of queue) {
      for (const offset of grid.getAdjacentOffsets(here)) {
        if (seen.has(key(offset)) || !clear(point(here), point(offset))) continue;
        seen.set(key(offset), { offset, depth, prev: seen.get(key(here)) });
        next.push(offset);
        if (wantGoal && key(offset) === goal) found = true;
      }
      if (found) break;
    }
    queue = next;
  }
  let best = null, bestDistance = Infinity;
  for (const [k, cell] of seen) {
    if (avoid.has(k) && cell.depth) continue;
    const at = point(cell.offset), distance = Math.hypot(at.x - slot.x, at.y - slot.y);
    if (distance < bestDistance) { best = cell; bestDistance = distance; }
  }
  if (!best) return null;
  const path = [];
  for (let cell = best; cell.prev; cell = cell.prev) path.unshift(point(cell.offset));
  return path;
}
/** Native grid offsets supply square/hex positions; a wall between the party token and a slot outranks spacing. */
export function planPlacement({ entries, anchor, grid, sizeX, sizeY, bounds, blocked, occupied = [] }) {
  const origin = grid.getOffset({ x: anchor.x + sizeX / 2, y: anchor.y + sizeY / 2 });
  const used = [...occupied], out = [];
  // The search window is the formation's own span plus three rings. A member that
  // cannot fit there stacks near the anchor (the documented fallback); it never
  // sweeps a whole large map with a walls scan per candidate.
  const span = entries.reduce((n, e) => Math.max(n, Math.abs(e.row), Math.abs(e.col)), 1);
  const radius = span + 3;
  for (const entry of entries) {
    const width = entry.width * sizeX, height = entry.height * sizeY;
    const preferred = grid.getTopLeftPoint({ i: origin.i + entry.row, j: origin.j + entry.col });
    const candidates = [];
    for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
      const p = grid.getTopLeftPoint({ i: origin.i + di, j: origin.j + dj });
      if (p.x >= bounds.x && p.y >= bounds.y && p.x + width <= bounds.x + bounds.width && p.y + height <= bounds.y + bounds.height) candidates.push(p);
    }
    candidates.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y));
    const safe = p => safeTrail(anchor, p, width, height, bounds, blocked);
    const free = candidates.find(p => !used.some(r => overlaps({ ...p, width, height }, r)) && safe(p));
    const stack = free ? null : candidates.sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y)).find(safe);
    const p = free ?? stack;
    if (!p) { out.push({ ...entry, blocked: true }); continue; }
    out.push({ ...entry, ...p, stacked: !free }); used.push({ ...p, width, height });
  }
  return out;
}
