/**
 * Pure rules for how the crawl strip lays itself out: which edge, which art,
 * which cards a crowded strip shows, and whose turn comes next. No Foundry globals, so the node tests can drive them.
 *
 * Ideas from Roll Call's combat dock (github.com/Sayshal/roll-call, MIT):
 * the crowded-dock window, the Up Next marker and the VS screen.
 */

import { isTurnless } from "./turn-skip-core.mjs";

export const STRIP_EDGES = ["top", "left", "right"];
export const STRIP_ART = ["token", "portrait"];

/**
 * The GM's choice for everyone wins over the user's own, the way the slim and
 * off switches work. A blank (or unknown) GM value leaves it to the user.
 * @param {string} forAll   The GM's world setting ("" = each user picks).
 * @param {string} mine     This user's client setting.
 * @param {string[]} allowed
 * @param {string} fallback
 * @returns {string}
 */
export function pickStripChoice(forAll, mine, allowed, fallback) {
  if (allowed.includes(forAll)) return forAll;
  return allowed.includes(mine) ? mine : fallback;
}

/**
 * Which cards a crowded strip shows: as many as fit, starting one before the
 * active card when three fit (so the last mover stays in view), moved by the
 * mouse wheel. `shift` comes back clamped, so the caller can keep it.
 * @param {object} o
 * @param {number} o.count   Cards on the strip.
 * @param {number} o.fit     Cards that fit at a readable size.
 * @param {number} [o.active] Index of the active card, -1 when none.
 * @param {number} [o.shift] Cards the wheel has moved the window.
 * @returns {{from: number, to: number, shift: number}}
 */
export function cardWindow({ count, fit, active = -1, shift = 0 }) {
  if (fit >= count) return { from: 0, to: count - 1, shift: 0 };
  const size = Math.max(1, fit);
  const anchor = active > 0 && size >= 3 ? active - 1 : Math.max(0, active);
  const from = Math.min(Math.max(anchor + shift, 0), count - size);
  return { from, to: from + size - 1, shift: from - anchor };
}

/**
 * The turn index that will act next: the first turn after `turn`, wrapping
 * into the next round, that has a turn to take (the strip's own skip rule).
 * Null when nobody else can act.
 * @param {object[]} entries  Turn entries (turn-skip-core's combatantEntry).
 * @param {number|null} turn
 * @returns {number|null}
 */
export function nextLiveTurn(entries, turn) {
  const n = entries?.length ?? 0;
  if (!n || !Number.isInteger(turn)) return null;
  for (let step = 1; step < n; step++) {
    const i = (turn + step) % n;
    if (!isTurnless(entries[i])) return i;
  }
  return null;
}

/**
 * The splash's merge key: the same monster on the same side AND the same
 * initiative, so a ×N tile only ever stands for monsters that act together.
 * Player characters never merge.
 * @param {{isPlayer: boolean, actorId: string, disposition: (number|undefined), initiative: (number|null)}} c
 * @returns {string|null}
 */
export const vsGroupKey = ({ isPlayer, actorId, disposition, initiative }) =>
  isPlayer || !actorId ? null : `${actorId}:${disposition ?? ""}:${initiative ?? ""}`;

/**
 * Tiles for the combat splash: one per side, the same monster counted once
 * with ×N. Order is turn order.
 * @param {{name: string, img: string, initiative: (number|null), ally: boolean, groupKey: (string|null)}[]} entries
 * @returns {{allies: object[], enemies: object[]}}
 */
export function vsTiles(entries) {
  const sides = { allies: [], enemies: [] };
  const byKey = new Map();
  for (const e of entries) {
    const seen = e.groupKey ? byKey.get(e.groupKey) : null;
    if (seen) { seen.count++; continue; }
    const tile = { name: e.name, img: e.img, initiative: e.initiative ?? null, count: 1 };
    if (e.groupKey) byKey.set(e.groupKey, tile);
    sides[e.ally ? "allies" : "enemies"].push(tile);
  }
  return sides;
}
