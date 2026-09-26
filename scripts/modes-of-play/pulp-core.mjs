/**
 * Shadowdark Enhancer — Pulp Mode (core rulebook p.111), the pure half: what a
 * luck crit adds to a damage formula, and when each Pulp button shows. The
 * Foundry half is pulp.mjs.
 */

/** Dice terms as the system's applyCriticalHit reads them: "d8", "2d6", "1d8x". */
const DICE = /(\d*)d(\d+[a-z0-9]*)/gi;

/**
 * The dice a critical hit adds to a damage formula, so a luck crit can roll
 * only those and keep the dice already on the card. Mirrors the system's
 * applyCriticalHit (each dice term's count times the multiplier) minus the
 * original: a 1d8 weapon at ×2 adds 1d8; 2d6 + 1d4 at ×3 adds 4d6 + 2d4.
 * Flat bonuses add nothing. Under Momentum Mode the system explodes the
 * first dice term of a crit, so the extra dice of that term explode too.
 * @param {string} formula     the damage roll's formula as rolled
 * @param {number} [multiplier]  the attack's critical multiplier (system default 2)
 * @param {boolean} [momentum]  Momentum Mode's exploding damage is on
 * @returns {string}  "" when the formula has no dice
 */
export function critExtraFormula(formula, multiplier = 2, momentum = false) {
  const extra = Math.max(0, Math.floor(Number(multiplier) || 2) - 1);
  if (!extra) return "";
  const terms = [];
  for (const m of String(formula ?? "").matchAll(DICE)) {
    const count = m[1] === "" ? 1 : Number(m[1]);
    let faces = m[2];
    if (momentum && terms.length === 0 && !/x/i.test(faces)) faces = `${faces}x`;
    terms.push(`${count * extra}d${faces}`);
  }
  return terms.join(" + ");
}

/**
 * Does the "Luck: critical hit" button belong on this card, for this user?
 * The rule turns a HIT into a crit: a miss never shows it, a natural crit
 * needs no help, and a card already turned once is done. With no target the
 * card cannot say hit or miss, so the button trusts the table.
 * @param {object} s
 * @param {boolean} s.enabled       the rule is on
 * @param {string}  s.type          the roll config's type ("attack", "spell", ...)
 * @param {boolean|null} s.success  the main roll's success (null: no target DC)
 * @param {boolean} s.naturalCrit   the main roll is already a critical success
 * @param {boolean} s.done          the card already carries a luck crit
 * @param {boolean} s.owner         this user owns the attacker
 * @param {boolean} s.hasLuck       the attacker has a luck token
 * @returns {boolean}
 */
export function showLuckCrit({ enabled, type, success, naturalCrit, done, owner, hasLuck }) {
  return !!enabled && type === "attack" && success !== false && !naturalCrit && !done && !!owner && !!hasLuck;
}

/**
 * Does the "Luck: force a reroll" button belong on this card, for this user?
 * Only a GM's roll that this player can see; a blind or whispered-away roll
 * can't be forced, since the player never saw it. Once per card.
 * @param {object} s
 * @param {boolean} s.enabled
 * @param {boolean} s.isGM          the viewing user is a GM
 * @param {boolean} s.gmAuthored    the card is a GM's
 * @param {string|null} s.shape     forceShape(): a card this rule can reroll, or null
 * @param {boolean} s.blind
 * @param {string[]} s.whisper      user ids the card is whispered to ([] = public)
 * @param {string} s.userId
 * @param {boolean} s.done          already forced once
 * @param {boolean} s.hasLuck       the player's character has a luck token
 * @returns {boolean}
 */
export function showForceReroll({ enabled, isGM, gmAuthored, shape, blind, whisper = [], userId, done, hasLuck }) {
  if (!enabled || isGM || !gmAuthored || !shape || blind || done || !hasLuck) return false;
  return !whisper.length || whisper.includes(userId);
}

/**
 * Which GM cards a forced reroll can redo, so a token is never spent on a roll
 * whose reroll changes nothing: a system roll card (re-rendered), or a bare
 * roll whose card shows just its total. Not an initiative roll (the tracker
 * keeps its number), and not a card that dresses its rolls in HTML (session
 * luck, Chaos, table draws), whose text a reroll would leave stale.
 * @param {object} s
 * @param {boolean} s.systemCard  a Shadowdark roll card with a main roll
 * @param {boolean} s.initiative  core's initiative message
 * @param {number}  s.rollCount
 * @param {string}  s.content     the card's content
 * @param {number}  s.total       the first roll's total
 * @returns {"system"|"bare"|null}
 */
export function forceShape({ systemCard, initiative, rollCount, content, total }) {
  if (initiative) return null;
  if (systemCard) return "system";
  return rollCount === 1 && String(content ?? "").trim() === String(total) ? "bare" : null;
}

/**
 * A crit's formula back to the one it doubled: applyCriticalHit's inverse
 * (every dice count divided by the multiplier). The system writes the crit
 * formula into the stored roll config, so this is the only way back.
 * @param {string} formula
 * @param {number} [multiplier=2]
 * @returns {string}
 */
export function uncritFormula(formula, multiplier = 2) {
  const mult = Math.max(1, Math.floor(Number(multiplier) || 2));
  return String(formula ?? "").replace(/(\d*)d(\d+[a-z0-9]*)/gi, (m, n, faces) => {
    const count = n === "" ? 1 : Number(n);
    return count % mult === 0 ? `${count / mult}d${faces}` : m;
  });
}

/**
 * A forced reroll of an attack: what happens to its damage. The new roll
 * decides whether damage is due, by the system's own rule (rollFromConfig:
 * on a hit, or always for a weapon with no target). Damage already rolled
 * stays when the reroll lands the same kind of hit; a hit that became a
 * crit, or a crit that became a plain hit, is rolled again.
 * @param {object} s
 * @param {boolean} s.hadDamage  the card carries a damage roll
 * @param {boolean} s.needed     the new roll calls for damage
 * @param {boolean} s.oldCrit    the damage on the card was rolled as a crit
 * @param {boolean} s.newCrit    the new roll is a critical success
 * @returns {"keep"|"reroll"|"drop"}
 */
export function forcedDamage({ hadDamage, needed, oldCrit, newCrit }) {
  if (!needed) return "drop";
  return hadDamage && !!oldCrit === !!newCrit ? "keep" : "reroll";
}
