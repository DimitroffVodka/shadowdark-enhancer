/**
 * Shadowdark Enhancer — stat damage, the pure half (#182)
 *
 * Stat damage is one Active Effect per damaged ability: a negative ADD on
 * `system.abilities.<key>.value`, flagged
 * `flags["shadowdark-enhancer"].statDamage = { ability: "<key>" }`. Nothing
 * else stores it. The system's ability modifier is a getter on that value
 * (`attributeModel.mod` in shadowdark-compiled.mjs), so the modifier drops
 * with the score and there is nothing more to write.
 *
 * THE SHAPE IS A CONTRACT. Shadowdark Extras' Effects library
 * (shadowdark-extras#148) builds one-point entries in exactly this form, so an
 * ability can carry several stat-damage effects at once. Every read here sums
 * them; nothing assumes there is only one.
 *
 * Node-testable: no Foundry globals.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** The system's six ability keys, in sheet order. */
export const ABILITIES = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);

/** Core icon for a stat-damage effect. */
export const STAT_DAMAGE_ICON = "icons/svg/downgrade.svg";

/** Each key, and the full name the book also uses, to the key. */
const ABILITY_NAMES = Object.freeze({
  str: "str", strength: "str",
  dex: "dex", dexterity: "dex",
  con: "con", constitution: "con",
  int: "int", intelligence: "int",
  wis: "wis", wisdom: "wis",
  cha: "cha", charisma: "cha",
});

/**
 * "STR", "str" or "Strength" → "str"; anything else → null. Exact words
 * only: "strike", "control" and "charm" are not abilities.
 */
export function abilityKey(ability) {
  const word = String(ability ?? "").trim().toLowerCase();
  return Object.hasOwn(ABILITY_NAMES, word) ? ABILITY_NAMES[word] : null;
}

/** The field a stat-damage effect changes. */
export const changeKey = (ability) => `system.abilities.${ability}.value`;

/** The ability a stat-damage effect lowers, or null for any other effect. */
export function damagedAbility(effect) {
  return abilityKey(effect?.flags?.[MODULE_ID]?.statDamage?.ability);
}

/**
 * Points of damage one effect carries: its ADDs on that ability, negated.
 * v13 keeps `changes` with string values; v14 moved them to `system.changes`
 * with parsed numbers, so read either and let Number() settle the type.
 */
export function effectAmount(effect) {
  const ability = damagedAbility(effect);
  if (!ability) return 0;
  const changes = effect.changes ?? effect.system?.changes ?? [];
  const sum = changes
    .filter((c) => c?.key === changeKey(ability))
    .reduce((n, c) => n + (Number(c.value) || 0), 0);
  return Math.max(0, -sum);
}

/**
 * Damage per ability, summed over every stat-damage effect. All six keys are
 * present, zero when clean, so two one-point effects and one two-point effect
 * read the same.
 */
export function damageOf(effects) {
  const out = Object.fromEntries(ABILITIES.map((a) => [a, 0]));
  for (const effect of effects ?? []) {
    const ability = damagedAbility(effect);
    if (ability) out[ability] += effectAmount(effect);
  }
  return out;
}

/**
 * What each ability's damage becomes after a rest.
 *
 * `{ perAbility: n }` takes n off every damaged ability (Grinder Mode: 1).
 * No options, or `{ all: true }`, clears it all. `all` wins when both are
 * given, and `perAbility: 0` heals nothing rather than falling back to all.
 */
export function afterHeal(totals, { perAbility, all = false } = {}) {
  const step = (all || perAbility == null)
    ? Infinity
    : Math.max(0, Math.floor(Number(perAbility) || 0));
  return Object.fromEntries(ABILITIES.map((a) => [a, Math.max(0, (totals?.[a] ?? 0) - step)]));
}

/**
 * Creation data for one ability's stat damage.
 *
 * Written in the v13 shape on purpose: v14 migrates `changes` + numeric
 * `mode` into `system.changes` + string `type` on creation, so one shape works
 * on both. The mode is the literal 2 (ADD) because v14's
 * `CONST.ACTIVE_EFFECT_MODES` is a proxy that logs a deprecation warning.
 */
export function statDamageEffect(ability, amount, name) {
  return {
    name,
    img: STAT_DAMAGE_ICON,
    changes: [{ key: changeKey(ability), mode: 2, value: String(-amount) }],
    flags: { [MODULE_ID]: { statDamage: { ability } } },
  };
}

// ─── Monster riders (#183) ─────────────────────────────────────────────────

const ABILITY_WORD = "str|dex|con|int|wis|cha|strength|dexterity|constitution|intelligence|wisdom|charisma";

/**
 * "1 STR damage", "1d4 CON damage", and the same behind a save:
 * "DC 12 CON or 1d4 STR damage" (also "... CON check or takes ...").
 * Groups: 1 save DC, 2 save ability, 3 amount, 4 damaged ability.
 */
const RIDER_RE = new RegExp(
  `(?:\\bDC\\s*(\\d+)\\s+(${ABILITY_WORD})\\b(?:\\s+(?:check|save))?[\\s,;:]+or\\s+(?:takes?\\s+)?)?`
  + `\\b(\\d+d\\d+|\\d+)\\s+(${ABILITY_WORD})\\s+damage\\b`,
  "gi",
);

/**
 * Imported monster text back to prose. The importer's enricher turns a
 * monster's "DC 12 CON" into `[[request 12 con]]` and "1d4" into
 * `[[/r 1d4]]` (contextual-enricher.mjs), and features are HTML; the rider
 * reads the same either way.
 */
export function plainRiderText(text) {
  return String(text ?? "")
    .replace(/\[\[(?:check|request)\s+(\d+)\s+(\w+)\]\]/gi, "DC $1 $2")
    .replace(/\[\[\/r(?:oll)?\s+([^\]]+)\]\]/gi, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ");
}

/**
 * Every stat-damage rider in a piece of text.
 * @returns {{ability: string, amount: string, save: ?{ability: string, dc: number}}[]}
 *   `amount` is a roll formula ("1", "1d4").
 */
export function parseStatRiders(text) {
  return [...plainRiderText(text).matchAll(RIDER_RE)].map((m) => ({
    ability: abilityKey(m[4]),
    amount: m[3],
    save: m[1] ? { ability: abilityKey(m[2]), dc: Number(m[1]) } : null,
  }));
}

/**
 * The riders an NPC attack carries. They live in the attack's own rider
 * (`system.damage.special`, which the importer also mirrors into its
 * description) or in an NPC Feature that rider names: "1d6 + drain" points at
 * the monster's *Drain* feature, the way the system's own attack card links
 * them (NpcAttackSD.render). An attack with no rider of its own takes the
 * feature that shares its name: the system bestiary's Wight and Will-o'-Wisp
 * roll a bare "Life Drain" attack whose rider lives only in a "Life Drain"
 * feature. A rider found in two of those places counts once.
 *
 * @param {object} attack      The attack item.
 * @param {Iterable<object>} actorItems  The attacker's items.
 */
export function attackRiders(attack, actorItems = []) {
  const special = String(attack?.system?.damage?.special ?? "");
  const named = (special.trim() ? special.split(/[,+]/) : [String(attack?.name ?? "")])
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  const features = [...actorItems].filter((i) =>
    i?.type === "NPC Feature" && named.includes(String(i.name ?? "").trim().toLowerCase()));
  const texts = [special, attack?.system?.description, ...features.map((f) => f.system?.description)];
  const seen = new Set();
  return texts.flatMap(parseStatRiders).filter((r) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * May this attack card deal stat damage? Anyone can post a chat card, and its
 * rollConfig is whatever the poster wrote. So the author must be a GM or own
 * the attacking actor (a player's allied NPC), and the attack must be that
 * actor's own item, not another monster's attack borrowed by uuid.
 */
export function cardMayApply({ authorIsGM, authorOwnsAttacker, attackOwnerUuid, attackerUuid } = {}) {
  if (!attackerUuid || attackOwnerUuid !== attackerUuid) return false;
  return !!(authorIsGM || authorOwnsAttacker);
}

/**
 * Does reaching CON 0 kill this character? Always, today.
 *
 * The seam for #181: its dying modifiers are read from Active Effects, and
 * "no death at 0 CON" (the Necromancer's River of Death) answers false here.
 * This is the only place that asks.
 */
export function diesAtZeroCon() {
  return true;
}
