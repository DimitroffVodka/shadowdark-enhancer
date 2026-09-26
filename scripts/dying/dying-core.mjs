/**
 * Shadowdark Enhancer — dying, death timers and stabilizing (pure).
 *
 * The core rule (p.89) with Deadly and Fatality (p.111) on top. No Foundry
 * globals: dying.mjs reads the actor and the settings and hands plain values in.
 *
 * ── Modifiers ─────────────────────────────────────────────────────────────
 * A small vocabulary read from Active Effects. Each is a flag key, so an
 * effect change `{ key: DYING_KEYS.timerDie, value: 6, type: "override" }`
 * lands as a derived `actor.flags["shadowdark-enhancer"].dyingTimerDie`. Use
 * `override` for everything except the timer bonus, which is `add`: Foundry's
 * upgrade/downgrade do nothing on a flag no effect has set yet.
 *
 *   timerDie        die of the death timer (4). Necromancer, River of Death: 6.
 *   timerBonus      added to the death timer roll. Gladiator training: +1.
 *   riseMin         lowest natural d20 that rises (20). Pit Fighter, Last Stand: 18.
 *   riseMinNear     the same, for dying ALLIES within near of whoever carries
 *                   it. Paladin, Inspiring Presence: 18 (17 with its talent).
 *   stabilizeDC     the stabilize DC when THIS character stabilizes someone.
 *                   Heath Witch training: 12. Beats Deadly's 18.
 *   stabilizeDCNear stabilizing a character within near of this creature
 *                   needs at least this DC. Draugr, Death Chill: 18.
 *   noDeathAtZeroCon  true: CON 0 does not kill. Necromancer, River of Death.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** The status this module registers for a dying character. */
export const DYING_STATUS = "sde-dying";

/** Core's defeated status (CONFIG.specialStatusEffects.DEFEATED). */
export const DEAD_STATUS = "dead";

/** Shadowdark's "near": up to 30 feet. */
export const NEAR_FEET = 30;

const FLAG_NAMES = {
  timerDie: "dyingTimerDie",
  timerBonus: "dyingTimerBonus",
  riseMin: "dyingRiseMin",
  riseMinNear: "dyingRiseMinNear",
  stabilizeDC: "stabilizeDC",
  stabilizeDCNear: "stabilizeDCNear",
  noDeathAtZeroCon: "noDeathAtZeroCon",
};

/** Active Effect change keys, by modifier name. */
export const DYING_KEYS = Object.fromEntries(
  Object.entries(FLAG_NAMES).map(([name, flag]) => [name, `flags.${MODULE_ID}.${flag}`]),
);

/**
 * A modifier's value on an actor, from its derived flags. Numbers may arrive as
 * strings from the effect sheet; anything that is not a number reads as unset.
 * `noDeathAtZeroCon` is a boolean: `true`, or any number above 0 (training
 * effects carry numbers).
 * @param {object} actor
 * @param {keyof DYING_KEYS} name
 * @returns {number|boolean|undefined}
 */
export function modifier(actor, name) {
  const raw = actor?.flags?.[MODULE_ID]?.[FLAG_NAMES[name]];
  if (name === "noDeathAtZeroCon") return raw === "true" || Number(raw) > 0;
  const n = Number(raw);
  return raw === undefined || raw === null || raw === "" || !Number.isFinite(n) ? undefined : n;
}

const signed = (n) => (n < 0 ? ` - ${-n}` : ` + ${n}`);

/**
 * The death timer's roll: 1d4 + CON modifier, with a die and a bonus from
 * modifiers. Null under Deadly, whose timer is always 1 and beats every die and
 * bonus.
 * @param {object} p
 * @param {boolean} [p.deadly]
 * @param {number} [p.die]    timer die faces (default 4)
 * @param {number} [p.bonus]
 * @param {number} [p.con]    the CON modifier
 * `mod` is what the GM adds to the natural die, so the total is never taken
 * from a player's client.
 * @returns {{formula: string, faces: number, mod: number}|null}
 */
export function timerRoll({ deadly = false, die, bonus = 0, con = 0 } = {}) {
  if (deadly) return null;
  const faces = Number.isInteger(die) && die > 1 ? die : 4;
  let formula = `1d${faces}`;
  if (con) formula += signed(con);
  if (bonus) formula += signed(bonus);
  return { formula, faces, mod: (con || 0) + (bonus || 0) };
}

/**
 * Rounds left once the timer is rolled: the total, minimum 1.
 * @param {number} total
 * @returns {number}
 */
export const deathTimer = (total) => Math.max(1, Math.floor(Number(total) || 0));

/**
 * The stabilize DC. The helper's own DC (Heath Witch, 12) beats everything,
 * Deadly's 18 included. Otherwise 15, or 18 under Deadly, raised by any
 * creature within near that sets a higher one (Draugr).
 * @param {object} p
 * @param {number} [p.ownDC]
 * @param {number[]} [p.nearDCs]
 * @param {boolean} [p.deadly]
 * @returns {number}
 */
export function stabilizeDC({ ownDC, nearDCs = [], deadly = false } = {}) {
  if (Number.isFinite(ownDC) && ownDC > 0) return ownDC;
  return Math.max(deadly ? 18 : 15, ...nearDCs.filter(Number.isFinite));
}

/**
 * The lowest natural d20 that rises: 20, lowered by the dying character's own
 * modifier or an ally's within near. Never below 2: a natural 1 never rises.
 * @param {object} p
 * @param {number} [p.own]
 * @param {number[]} [p.near]
 * @returns {number}
 */
export function riseMin({ own, near = [] } = {}) {
  return Math.max(2, Math.min(20, ...[own, ...near].filter(Number.isFinite)));
}

/**
 * What a dying character's turn start does with the natural d20.
 * @param {object} p
 * @param {number} p.natural  the d20 as rolled
 * @param {number} p.timer    rounds left before this turn
 * @param {number} [p.riseMin]
 * @returns {{result: "rise"|"dead"|"tick", timer: number}}
 */
export function turnOutcome({ natural, timer, riseMin: min = 20 }) {
  if (natural >= min) return { result: "rise", timer };
  const left = Math.max(0, timer - 1);
  return { result: left === 0 ? "dead" : "tick", timer: left };
}

/**
 * What an HP change means for a PC.
 * @param {object} p
 * @param {number} p.hp          HP after the change
 * @param {boolean} p.tracked    dying or stable (the module's flag is set)
 * @param {boolean} p.dead       already dead
 * @param {boolean} [p.fatality] Fatality: 0 HP is death
 * @returns {"dying"|"die"|"clear"|null}
 */
export function hpAction({ hp, tracked, dead, fatality = false }) {
  if (dead) return null;
  if (hp <= 0) return tracked ? null : (fatality ? "die" : "dying");
  return tracked ? "clear" : null;
}

/**
 * Does this turn start (or crawl round) cost a round? Once per round of a
 * scope, a combat's id or "crawl", and only moving forward: Foundry fires no
 * turn events on a rewind and then starts every turn passed again on the way
 * forward, so "a round I have not ticked yet" must mean a LATER round, not a
 * different one. Another scope (a new combat, back to the crawl) always counts.
 * @param {{scope: string, round: number}|null} last  the last tick recorded
 * @param {string} scope
 * @param {number} round
 * @returns {boolean}
 */
export function shouldTick(last, scope, round) {
  if (!Number.isFinite(round)) return false;
  if (!last || last.scope !== scope) return true;
  return round > last.round;
}

/**
 * Does a stabilize check's chat card stabilize? Anyone can post a card, and a
 * reroll repeats the original's config, so nothing on the card is taken on
 * trust but the dice: its author must be a GM or own the helper, the helper
 * is not the dying character, and the roll's total meets the DC the GM works
 * out itself, never the one the card carries.
 * @param {object} p
 * @returns {boolean}
 */
export function cardStabilizes({ authorIsGM, authorOwnsHelper, helperIsTarget, total, dc }) {
  if (helperIsTarget || !(authorIsGM || authorOwnsHelper)) return false;
  return Number.isFinite(total) && Number.isFinite(dc) && total >= dc;
}

/**
 * What the crawl strip's badge says. Players never see the count while the
 * hidden timer is on; the GM always does.
 * @param {object|null} state  the dying flag
 * @param {object} p
 * @param {boolean} p.hidden
 * @param {boolean} p.isGM
 * @returns {{kind: "dying"|"stable", rounds: number|null}|null}
 */
export function badge(state, { hidden, isGM }) {
  if (!state) return null;
  if (state.stable) return { kind: "stable", rounds: null };
  const known = Number.isInteger(state.timer) && (isGM || !hidden);
  return { kind: "dying", rounds: known ? state.timer : null };
}

/**
 * The natural die a player's client reports, checked before it is used. Only
 * the die travels: the GM adds the modifiers itself.
 * @param {object} reply
 * @param {number} faces
 * @returns {number|null}
 */
export function checkedNatural(reply, faces) {
  const natural = reply?.natural;
  return Number.isInteger(natural) && natural >= 1 && natural <= faces ? natural : null;
}
