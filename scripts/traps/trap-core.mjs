/**
 * Shadowdark Enhancer — traps, the parts that need no Foundry.
 *
 * A trap is a Scene Region carrying the `shadowdark-enhancer.trap` behavior
 * (traps.mjs): the trap's name, what sets it off, what it does, an optional
 * ability check (ability and DC) to avoid it, an optional damage roll, and notes
 * for the GM. The Shadowdark system ships the Core Rulebook's trap generator as
 * three tables (Trap, Trigger, Damage or Effect); `trapFromTexts` turns one roll
 * of each into the same record.
 */
import { esc } from "../shared/esc.mjs";

/** Fields a trap record carries, in the order the config form shows them. */
export const TRAP_FIELDS = ["trap", "trigger", "effect", "checkAbility", "checkDc", "damage", "applyDamage", "holds", "when", "chance", "gmNotes"];

/** The abilities a trap's check can ask for (the `[[request DC abil]]` link takes these). */
export const TRAP_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

const DICE = /\b\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?/i;

/** The first dice expression in a text ("[[/r 2d6]] / Sleep" → "2d6"), or "". */
export function damageOf(text) {
  const m = DICE.exec(String(text ?? ""));
  return m ? m[0].replace(/\s+/g, "") : "";
}

/**
 * The words of a table's Damage or Effect row, without its markup: inline rolls
 * are dropped (the dice go in the damage field) and a link keeps its label, so
 * "[[/r 1d6]] / @UUID[…]{Sleep}" reads "Sleep".
 */
export function plainEffect(text) {
  return String(text ?? "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/^[\s/]+|[\s/]+$/g, "")
    .replace(/\s+/g, " ");
}

/** One row each of the Trap, Trigger and Damage or Effect tables as a trap record. */
export function trapFromTexts([trap, trigger, effect] = []) {
  const clean = (s) => String(s ?? "").trim();
  return { trap: clean(trap), trigger: clean(trigger), effect: plainEffect(effect), damage: damageOf(effect) };
}

/**
 * A chance written the way the books write it ("1:6", a 1 in 6 chance), as { n, d }, or null for
 * always: blank, or anything that is not two whole numbers with 1 <= n < d.
 */
export function chanceOf(text) {
  const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1]), d = Number(m[2]);
  return n >= 1 && n < d ? { n, d } : null;
}

const ABILITY_DC = /\bDC\s*(\d+)\s*(STR|DEX|CON|INT|WIS|CHA)\b/i;
const EVERY_ROUND = /(?:\/|\bper |\beach |\bevery )round\b/i;
const ESCAPE = /\bto escape\b/i;
const CHANCE = /\b(\d+\s*:\s*\d+)\s*chance\b/i;
/** Labels a book puts in front of a trap's own name ("Floor. Acid quicksand trap."). */
const GENERIC_LABEL = /^(?:trap|floor|ceiling|walls?|doors?|room|area)$/i;

/**
 * One trap as an adventure prints it: a short label, then what it is and does, with the check
 * written "DC 12 DEX" and any damage as dice ("1d4 damage/round"). Reads what it finds into a trap
 * record; what it does not find stays at the default (no check, enters once, always fires). The
 * whole line is kept as the effect. Where a trap sits and how it is fired (touching something) is
 * not in the words, so `when` here is only enter or round. A line that gives the check "to escape" is a trap that
 * holds whoever it catches (`holds`): the check frees them, and the damage is theirs whether they pass or not.
 */
export function parseTrapText(text) {
  const plain = String(text ?? "").replace(/\s+/g, " ").trim();
  const [label = "", second = ""] = plain.split(/(?<=\.)\s+/).map((x) => x.replace(/\.$/, ""));
  const named = GENERIC_LABEL.test(label) && second ? second : label;
  const check = ABILITY_DC.exec(plain);
  return {
    trap: named.length > 60 ? `${named.slice(0, 57)}...` : named,
    trigger: "",
    effect: plain,
    checkAbility: check ? check[2].toLowerCase() : "none",
    checkDc: check ? Number(check[1]) : 12,
    damage: damageOf(plain),
    holds: ESCAPE.test(plain),
    when: EVERY_ROUND.test(plain) ? "round" : "enter",
    chance: chanceOf(CHANCE.exec(plain)?.[1]) ? CHANCE.exec(plain)[1].replace(/\s+/g, "") : "",
  };
}

/** A trap that has gone off stays quiet until it is re-armed, unless it resets. */
export const canSpring = ({ sprung, resets } = {}) => !sprung || !!resets;

/** The lines a trap's roll card says about it, as plain text (the card escapes them): its trigger, effect and damage. */
export function trapIntro({ trigger, effect, damage, holds } = {}, l) {
  const line = (label, body) => (String(body ?? "").trim() ? `${label}: ${String(body).trim()}` : "");
  return [line(l.trigger, trigger), line(l.effect, effect), line(l.damage, damage), holds ? l.held : ""].filter(Boolean);
}

/**
 * Should a token's move be cancelled because a trap holds it? Only a player's move of a token that is held, whose trap is
 * still there with the token still inside it: a hold on a region that is gone, or that the token has been moved out of by
 * other means, lets go rather than pin a character for good. A GM is never blocked.
 */
export const blocksHeldMove = ({ held = false, stillInside = false, isGM = false, movesPosition = false } = {}) =>
  held && stillInside && !isGM && movesPosition;

/** The check a trap asks for, or null: a known ability and a whole-number DC above zero. */
export function checkOf({ checkAbility, checkDc } = {}) {
  const dc = Math.trunc(Number(checkDc));
  return TRAP_ABILITIES.includes(checkAbility) && dc > 0 ? { ability: checkAbility, dc } : null;
}

/**
 * The chat card for a trap that went off. `l` is the localized labels
 * ({ trigger, effect, damage, fallbackName, check }; `check(ability, dc)` words the
 * check line). The check is the system's request link, so each player rolls
 * their own; the damage becomes an inline roll Foundry enriches when the card
 * renders. The GM's notes never appear on it.
 */
export function trapCard(trap, who, l) {
  const { trap: name, trigger, effect, damage } = trap;
  const check = checkOf(trap);
  const line = (label, body) => (body ? `<p><strong>${esc(label)}:</strong> ${esc(body)}</p>` : "");
  return `<div class="sde-trap-card">
    <header><i class="fa-solid fa-triangle-exclamation"></i> ${esc(name) || esc(l.fallbackName)}${who ? ` — ${esc(who)}` : ""}</header>
    ${line(l.trigger, trigger)}${line(l.effect, effect)}
    ${check ? `<p><strong>${esc(l.check(check.ability.toUpperCase(), check.dc))}:</strong> [[request ${check.dc} ${check.ability}]]</p>` : ""}
    ${damage ? `<p><strong>${esc(l.damage)}:</strong> [[/r ${esc(damage)}]]</p>` : ""}
  </div>`;
}
