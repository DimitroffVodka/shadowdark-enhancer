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
/**
 * A hex's discovery as the given parties see it. The top-level fields are what every party knows (the GM's reveal,
 * or a world from before parties were tracked apart); `by[partyId]` is one party's own and wins over them for that
 * party. Several parties (one player in two) see the union. No party: only what everyone knows.
 */
export function effectiveDiscovery(discovery, partyIds = []) {
  const all = discovery ?? {}, { by, ...shared } = all, ids = partyIds.filter(Boolean);
  if (!ids.length) return { revealed: false, visited: false, ...shared };
  const each = field => ids.map(id => by?.[id]?.[field] ?? shared[field]);
  const location = each("locationRevealed");
  const out = { ...shared, revealed: each("revealed").includes(true), visited: each("visited").includes(true) };
  if (location.includes(true)) out.locationRevealed = true;
  else if (location.includes(false)) out.locationRevealed = false;
  else delete out.locationRevealed;
  return out;
}
/** `discovery` with one party's own entry patched; an undefined field is removed from it. Nothing is mutated. */
export function withPartyDiscovery(discovery, partyId, patch) {
  const own = { ...discovery?.by?.[partyId] };
  for (const [field, value] of Object.entries(patch)) if (value === undefined) delete own[field]; else own[field] = value;
  return { ...discovery, by: { ...discovery?.by, [partyId]: own } };
}
/** Of the projections one player can see for a hex (one per party, plus what everyone knows), the most revealing. */
export function bestProjection(projections) {
  const rank = p => (p.discovery?.locationRevealed ? 2 : 0) + (p.discovery?.visited ? 1 : 0);
  return projections.filter(Boolean).sort((a, b) => rank(b) - rank(a))[0] ?? null;
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
/** Dawn/manual/reveal-only never enter this branch. Import history survives any conceal. A first-entry table is once per party. */
export function arrivalDue(record, { entered = false, partyId = null } = {}) {
  const rolled = record?.arrivalRolled || (!!partyId && record?.arrivalRolledBy?.includes(partyId));
  return entered && !!record?.rollTable && !(record.rollTableFirstOnly && rolled);
}
