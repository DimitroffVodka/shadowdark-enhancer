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
  if (data.includeMounts) overflow.push(...rows.filter(r => r.group === "mounts"));
  overflow.forEach((r, n) => out.push({ memberUuid: r.uuid, col: n % 3 - 1, row: 2 + Math.floor(n / 3) }));
  return out;
}
export function followOrder(data, rows) {
  const order = deploymentOrder(data, rows).map(s => s.memberUuid);
  return order.includes(data.leaderUuid) ? [data.leaderUuid, ...order.filter(u => u !== data.leaderUuid)] : order;
}
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
/** Check destination edges/diagonals and swept footprint, not just a centre ray. */
export function safeFootprint(from, to, width, height, bounds, blocked, footprintBlocked = () => false) {
  if (to.x < bounds.x || to.y < bounds.y || to.x + width > bounds.x + bounds.width || to.y + height > bounds.y + bounds.height) return false;
  if (footprintBlocked(to, width, height)) return false;
  // Foundry's collision backend rounds pixels. Subpixel inset lands on the wall.
  const e = Math.min(1, width / 4, height / 4);
  const corners = [[e, e], [width - e, e], [width - e, height - e], [e, height - e]];
  const at = (p, [x, y]) => ({ x: p.x + x, y: p.y + y });
  const points = corners.map(c => at(to, c));
  for (let i = 0; i < 4; i++) {
    if (blocked(points[i], points[(i + 1) % 4]) || blocked(points[i], points[(i + 2) % 4]) || blocked(at(from, corners[i]), points[i])) return false;
  }
  return true;
}
/** Native grid offsets supply square/hex positions; safety always outranks spacing. */
export function planPlacement({ entries, anchor, grid, sizeX, sizeY, bounds, blocked, footprintBlocked, occupied = [] }) {
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
    const safe = p => safeFootprint(anchor, p, width, height, bounds, blocked, footprintBlocked);
    const free = candidates.find(p => !used.some(r => overlaps({ ...p, width, height }, r)) && safe(p));
    const stack = free ? null : candidates.sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y)).find(safe);
    const p = free ?? stack;
    if (!p) { out.push({ ...entry, blocked: true }); continue; }
    out.push({ ...entry, ...p, stacked: !free }); used.push({ ...p, width, height });
  }
  return out;
}
