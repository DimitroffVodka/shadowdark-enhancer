/**
 * Shadowdark Enhancer — Stage zone fight: the Foundry-free core (zones, clone
 * names and data, who may move, band layout, the player-facing HP bar).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { distanceBand } from "../encounter/battle-maps/encounter-battle-core.mjs";

export const ZONES = ["close", "near", "far"];

export const normalizeZone = (z) => (ZONES.includes(z) ? z : "close");

/** One band closer or farther, clamped at the ends. */
export function stepZone(zone, dir) {
  const z = normalizeZone(zone);
  const delta = dir === "closer" ? -1 : dir === "farther" ? 1 : 0;
  return ZONES[Math.max(0, Math.min(ZONES.length - 1, ZONES.indexOf(z) + delta))];
}

export const foeZoneFor = (distanceRoll) => distanceBand(distanceRoll);

/** `count` unique "<name> N" names that skip any in `taken` (Set or array). */
export function cloneNames(name, count, taken, fallback = "Foe") {
  const n = Math.floor(Number(count));
  if (!(n >= 1)) return [];
  const base = typeof name === "string" && name.trim() ? name.trim() : (fallback || "Foe");
  const used = new Set(taken instanceof Set ? taken : Array.isArray(taken) ? taken : []);
  const out = [];
  for (let i = 1; out.length < n; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate)) out.push(candidate);
  }
  return out;
}

/** Create data for a zone-fight clone of `source` (an `actor.toObject()`); never mutates it. */
export function cloneActorData(source, { name, folder, fightId } = {}) {
  const { _id, ...rest } = source ?? {};
  const { zoneClone: _c, zoneFight: _f, ...keep } = rest.flags?.[MODULE_ID] ?? {};
  return {
    ...rest,
    name,
    folder,
    ownership: { default: 0 },
    flags: { ...rest.flags, [MODULE_ID]: { ...keep, zoneClone: fightId } },
  };
}

/** GM moves anyone; anyone else only a non-foe combatant whose actor they own. */
export const canMoveZone = ({ isGM, ownsActor, isFoe } = {}) => !!isGM || (!!ownsActor && !isFoe);

/** Group combatants into the three bands, input order kept. */
export function layoutBands(combatants) {
  const bands = { close: [], near: [], far: [] };
  if (!Array.isArray(combatants)) return bands;
  for (const c of combatants) if (c && typeof c === "object") bands[normalizeZone(c.zone)].push(c);
  return bands;
}

/** Player-facing HP bar, no numbers: the Crawl Strip's five tiers (dead, critical, low, mid, ok). */
export function hpBand(hp, max) {
  const m = Number(max), h = Number(hp);
  if (!(m > 0) || !Number.isFinite(h)) return { ratio: 0, tone: "dead" };
  const ratio = Math.max(0, Math.min(1, h / m));
  const tone = h <= 0 ? "dead" : h <= m * 0.25 ? "critical" : h <= m * 0.5 ? "low" : h <= m * 0.75 ? "mid" : "ok";
  return { ratio, tone };
}

/** An actor made as a foe copy for some zone fight. */
export const isZoneClone = (actor) => {
  const id = actor?.flags?.[MODULE_ID]?.zoneClone;
  return typeof id === "string" && id !== "";
};

const zoneFightRaw = (combat) => combat?.flags?.[MODULE_ID]?.zoneFight;
export const isZoneFight = (combat) => typeof zoneFightRaw(combat)?.id === "string" && zoneFightRaw(combat).id !== "";

export function zoneFightOf(combat) {
  if (!isZoneFight(combat)) return null;
  const f = zoneFightRaw(combat);
  const clones = Array.isArray(f.clones) ? [...new Set(f.clones.filter((c) => typeof c === "string" && c))] : [];
  return { id: f.id, at: f.at ?? null, clones, source: f.source ?? null };
}
