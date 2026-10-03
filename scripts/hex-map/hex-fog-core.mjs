/** Offset-only discovery logic. No Foundry globals or competing tag store. */
const keyOf = ({ i, j }) => `${i}_${j}`;
const parse = value => {
  const m = String(value).match(/^(-?\d+)[_-](-?\d+)$/);
  return m && Number.isSafeInteger(Number(m[1])) && Number.isSafeInteger(Number(m[2])) ? { i: Number(m[1]), j: Number(m[2]) } : null;
};
/** The single ordinary-play predicate. Conceal overrides a visit, never its history. */
export function disclosure(state, kind = "terrain", { isGM = false, owner = false } = {}) {
  if (isGM || owner) return true;
  if (state?.revealed !== true) return false;
  return kind !== "location" || (state.locationRevealed ?? state.visited) === true;
}
export function overlapAllowed({ active = false, disabled = false, guardVersion = 0 } = {}) {
  return !active || disabled || guardVersion >= 1;
}
/** Keep a full archival copy, including malformed/unknown inputs. Native values win. */
export function importFog(existing, flags = {}) {
  const cells = structuredClone(existing), legacy = structuredClone(flags);
  const merge = (key, discovery, rolled = false) => {
    const offset = parse(key);
    if (!offset) return;
    const k = keyOf(offset), old = cells[k] ?? {};
    cells[k] = { ...old, discovery: { ...old.discovery, ...discovery, ...existing[k]?.discovery },
      ...(rolled && old.arrivalRolled === undefined ? { arrivalRolled: true } : {}) };
  };
  for (const [key, revealed] of Object.entries(flags.hexFogRevealed ?? {})) if (revealed === true) merge(key, { revealed: true });
  for (const [key, value] of Object.entries(flags.hexFogDiscovery ?? {})) if (["near", "terrain"].includes(value)) merge(key, { revealed: true });
  for (const [key, rolled] of Object.entries(flags.hexRolledCells ?? {})) if (rolled) merge(key, {}, true);
  for (const cell of Object.values(cells)) cell.discovery = { revealed: false, visited: false, ...cell.discovery };
  return { cells, legacy };
}
const terrainKey = value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
export function revealRadius(rules, terrain, night, weather) {
  const elevation = rules.elevation?.[terrainKey(terrain)];
  return Math.max(0, Math.floor(1 + (night ? rules.darkness : 0)
    + (weather === "stormy" ? rules.stormy : weather === "excellent" ? rules.excellent : 0)
    + (["slight", "high"].includes(elevation) ? rules[elevation] : 0)));
}
/** Use supplied native grid geometry for all paths; endpoints don't obstruct. */
export function revealCells({ grid, origin, cells, radius, mountain, night, weather }) {
  const allowed = new Set(cells.map(keyOf)), seen = new Set([keyOf(origin)]), revealed = new Set([keyOf(origin)]);
  const sight = target => !grid.getDirectPath([origin, target]).slice(1, -1).some(mountain);
  let frontier = [origin];
  for (let depth = 0; depth < radius && frontier.length; depth++) {
    const next = [];
    for (const cell of frontier) for (const n of grid.getAdjacentOffsets(cell)) {
      const key = keyOf(n);
      if (!allowed.has(key) || seen.has(key)) continue;
      seen.add(key); next.push(n);
      if (sight(n)) revealed.add(key);
    }
    frontier = next;
  }
  if (!night && weather !== "stormy") for (const cell of cells) if (mountain(cell) && sight(cell)) revealed.add(keyOf(cell));
  return revealed;
}
/** Dawn/manual/reveal-only never enter this branch. Import history survives any conceal. */
export function arrivalDue(record, { entered = false } = {}) {
  return entered && !!record?.rollTable && !(record.rollTableFirstOnly && record.arrivalRolled);
}
