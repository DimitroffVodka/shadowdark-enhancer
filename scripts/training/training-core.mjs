/**
 * Regional Training — the shipped metadata for the 21 trainers printed in the
 * Game Master's Guide to the Western Reaches.
 *
 * COPYRIGHT CONSTRAINT (hard), the same one downtime-skeleton.mjs lives under:
 * this file ships NO rules text. It carries trainer names, region names, page
 * numbers, the name of the RollTable each trainer's benefits import as, and
 * compressed labels written for this module. The book's own wording for a
 * benefit is read at grant time out of the GM's OWN imported table, matched by
 * `(table name, d4 result)` — never stored here and never stored in the repo.
 *
 * WHAT THE BOOK ACTUALLY PRINTS, because it shapes everything below: a trainer
 * spread is a portrait, four TASKS, and four BENEFITS, with one line of
 * connective rule — complete a task and the trainer teaches you a technique,
 * "once each". So the gate is an adventure, not a check: there is no DC here
 * and no cost, and a single trainer is worth four visits rather than one.
 * `once each` is the only hard mechanic, and it is enforced on the grant.
 *
 * Every benefit produces a Talent on the character, mechanical or not. The
 * 34 that have no mechanical surface still get a Talent carrying the trainer's
 * name and the book's own line, because a training a player earned should be
 * visible on the sheet whether or not Foundry can compute it.
 *
 * ── Recipe shape ──────────────────────────────────────────────────────────
 *   roll     1-4, the face on the trainer's d4. The join key to the table row.
 *   label    our compressed summary, <=6 words. Names the Talent when the
 *            GM's table is missing; otherwise it is the subtitle.
 *   changes  Active Effect changes, applied to the granted Talent.
 *   actions  one-time writes (HP, renown, an item). See training-grant.mjs.
 *   choice   two named alternatives, each its own {label, changes|actions}.
 *   todo     what a GM must still do by hand. Present ONLY when this module
 *            cannot do it — the window shows it as the honest caveat.
 *
 * A recipe with neither `changes`, `actions` nor `choice` is prose. That is a
 * derived fact (`isMechanical`), not a tier someone has to keep in sync.
 *
 * ── Effect keys ───────────────────────────────────────────────────────────
 * Verified against Shadowdark 4.0.6 rather than its docs:
 *   system.roll.melee.bonus.all / .damage.all          config.mjs:345,352
 *   system.attributes.ac.value                         PlayerSD.mjs:221
 *   system.abilities.<abl>.value                       config.mjs
 *   system.roll.initiative.bonus                       _ActorBaseSD.mjs:126
 *   system.roll.spell.bonus.all                        PlayerSD.mjs:456
 *   system.roll.<melee|ranged>.critical-success.<sel>  PlayerSD.mjs:270-280
 *   system.roll.attack.upgrade-damage-die.<sel>        config.mjs
 *   flags.shadowdark-enhancer.dyingTimerBonus / .stabilizeDC   dying-core.mjs
 *     (this module's own dying modifiers, #181; read by dying.mjs)
 *
 * Per-weapon keys work by SELECTOR: `all`, one of the item's property names,
 * its `baseWeapon`, or its slugified NAME (_ActorBaseSD.mjs:189-209). That is
 * what makes "+1 with bows" and "crit on 19 with bows" computable instead of
 * prose. A selector that matches nothing the character carries is inert, not
 * wrong, so listing three bow slugs costs nothing when they own one.
 *
 * Do NOT reuse the system's own `spellCastingBonus` predefined effect for a
 * spellcasting BONUS: config.mjs:422 points it at
 * `system.roll.spell.advantage.all`, which grants advantage instead. The bonus
 * key is `system.roll.spell.bonus.all` and is written here directly.
 *
 * Pure data + pure helpers: no Foundry globals, no Date, no Math.random.
 */

import { DYING_KEYS } from "../dying/dying-core.mjs";

/**
 * A change is `{key, value, type, phase}`, NOT the numeric `mode` of older
 * Foundry. Shadowdark 4.x replaces the ActiveEffect change schema, and its own
 * packs are the proof: "Condition: Enfeebled (Wis)" ships
 * `{key: "system.abilities.wis.value", value: 3, type: "override", phase: "initial"}`.
 * `value` is a number, not a string. Writing `mode: 2` here produces an effect
 * that saves cleanly and then does nothing at all.
 */
const add = (key, value = 1) => ({ key, value, type: "add", phase: "initial" });
const override = (key, value) => ({ key, value, type: "override", phase: "initial" });

/** Weapon-name selectors. Slugified item names, which is how the system keys them. */
const BOWS = ["longbow", "shortbow", "crossbow"];
const ASSASSIN_ARMS = ["sais", "scimitar", "razor-chain"];

/** `+1 to hit and damage` across a list of weapon selectors. */
const hitAndDamage = (selectors, n = 1) => selectors.flatMap((s) => [
  add(`system.roll.attack.bonus.${s}`, n),
  add(`system.roll.attack.damage.${s}`, n),
]);

/**
 * The 21 trainers, in page order.
 *
 * `table` is the name the importer gives the benefits table, which is how the
 * window finds the GM's copy — the same by-name convention pit-fighting uses,
 * and for the same reason: bulk-imported tables carry no manifest id.
 * `region` is null for the three trainers the book keys to a hex in the general
 * locations chapter rather than to one of the fifteen region spreads.
 */
export const TRAINERS = [
  {
    key: "yodeling",
    trainer: "Clementine",
    topic: "Yodeling",
    region: "Bastion Mountains",
    page: 91,
    manifestId: "gmgwr-yodeling-training-benefits",
    table: "Yodeling Training Benefits",
    benefits: [
      { roll: 1, label: "ADV on a CHA check, 1/day", todo: "Once-per-day, declared at the table." },
      { roll: 2, label: "+5 renown", actions: [{ type: "renown", value: 5 }] },
      { roll: 3, label: "Immune to sound effects", todo: "No damage-type surface without Shadowdark Extras." },
      {
        roll: 4,
        label: "+2 CHA, or better reactions",
        choice: [
          { key: "cha", label: "+2 CHA", changes: [add("system.abilities.cha.value", 2)] },
          { key: "reaction", label: "+1 to reaction rolls", todo: "Reaction rolls have no system field." },
        ],
      },
    ],
  },
  {
    key: "moon-fist",
    trainer: "Saida Mu Bo",
    topic: "Moon Fist",
    region: "Dhalpurna Mountains",
    page: 99,
    manifestId: "gmgwr-moon-fist-training-benefits",
    table: "Moon Fist Training Benefits",
    // Core Shadowdark ships no unarmed weapon item — its twelve base weapons
    // contain no strike — so all three mechanical rows key off an item named
    // "Strikes" that the grant creates if the character has none. Without it
    // the effects are inert rather than wrong, which is the failure the
    // ensureWeapon action exists to avoid.
    benefits: [
      {
        roll: 1,
        label: "+1 to hit with strikes",
        changes: [add("system.roll.attack.bonus.strikes")],
        actions: [{ type: "ensureWeapon", name: "Strikes", damage: "d4" }],
      },
      {
        roll: 2,
        label: "Strikes damage die up one step",
        changes: [add("system.roll.attack.upgrade-damage-die.strikes")],
        actions: [{ type: "ensureWeapon", name: "Strikes", damage: "d4" }],
      },
      {
        roll: 3,
        label: "+1 to damage with strikes",
        changes: [add("system.roll.attack.damage.strikes")],
        actions: [{ type: "ensureWeapon", name: "Strikes", damage: "d4" }],
      },
      { roll: 4, label: "Strikes become magical", todo: "Roll the magic weapon benefit in the Magic Forge, then apply it to Strikes." },
    ],
  },
  {
    key: "gladiator",
    trainer: "Rameer the Lion",
    topic: "Gladiator",
    region: "Djurum Desert",
    page: 111,
    manifestId: "gmgwr-gladiator-training-benefits",
    table: "Gladiator Training Benefits",
    benefits: [
      { roll: 1, label: "+1 to death timer rolls", changes: [add(DYING_KEYS.timerBonus)] },
      {
        roll: 2,
        label: "+1 melee attacks and damage",
        changes: [add("system.roll.melee.bonus.all"), add("system.roll.melee.damage.all")],
      },
      { roll: 3, label: "Next HP die up one step", todo: "Applies to the next level-up roll only." },
      { roll: 4, label: "+1 to initiative", changes: [add("system.roll.initiative.bonus")] },
    ],
  },
  {
    key: "wizardly-arts",
    trainer: "Ivanculus",
    topic: "Wizardly Arts",
    region: "Duchy of Montmar",
    page: 120,
    manifestId: "gmgwr-wizardly-arts-training-benefits",
    table: "Wizardly Arts Training Benefits",
    benefits: [
      { roll: 1, label: "1/day, regain a lost spell", todo: "Once-per-day, declared at the table." },
      { roll: 2, label: "ADV on mishap rolls", todo: "The Spell Mishap roller does not read this yet." },
      // "+1 to INT spellcasting": for an INT caster `.all` IS every spell they
      // cast, so the broad key is exact here. It is NOT exact for the witch and
      // necromancer rows below, which name a class — see those.
      { roll: 3, label: "+1 to INT spellcasting", changes: [add("system.roll.spell.bonus.all")] },
      { roll: 4, label: "1/day, reroll a failed cast", todo: "Once-per-day, declared at the table." },
    ],
  },
  {
    key: "healer",
    trainer: "The Heath Witch",
    topic: "Healer",
    region: "Duchy of Montmar",
    page: 121,
    manifestId: "gmgwr-healer-training-benefits",
    table: "Healer Training Benefits",
    benefits: [
      { roll: 1, label: "Stabilising is always DC 12", changes: [override(DYING_KEYS.stabilizeDC, 12)] },
      { roll: 2, label: "+1d4 HP on healing you give", todo: "Add the die to healing you administer." },
      { roll: 3, label: "Immune to snake venom", todo: "Narrower than any immunity the system models." },
      { roll: 4, label: "+2 CON", changes: [add("system.abilities.con.value", 2)] },
    ],
  },
  {
    key: "assassin",
    trainer: "Manazusa",
    topic: "Assassin",
    region: "Gilzai Mountains",
    page: 129,
    manifestId: "gmgwr-assassin-training-benefits",
    table: "Assassin Training Benefits",
    benefits: [
      { roll: 1, label: "Wield sais (d8)", actions: [{ type: "ensureWeapon", name: "Sais", damage: "d8" }] },
      { roll: 2, label: "+1 hit and damage, three arms", changes: hitAndDamage(ASSASSIN_ARMS) },
      { roll: 3, label: "ADV on damage, three arms", todo: "Damage rolls take no advantage in this system." },
      { roll: 4, label: "Smoke Step 1/day", todo: "Once-per-day, declared at the table." },
    ],
  },
  {
    key: "witch",
    trainer: "Uncle Grigor",
    topic: "Witch",
    region: "The Gloaming",
    page: 139,
    manifestId: "gmgwr-witch-training-benefits",
    table: "Witch Training Benefits",
    benefits: [
      { roll: 1, label: "Familiars revive in a week", todo: "Bookkeeping between sessions." },
      // A class-scoped spell bonus has no key. `_getActiveEffectKeys` builds a
      // spell's selectors from its NAME and properties, never its class, so
      // `.all` would buff every spell the character casts. Left as prose
      // rather than shipped as a wrong number. Same for the necromancer row.
      { roll: 2, label: "+1 to witch spellcasting", todo: "No class selector exists; a blanket bonus would buff every spell." },
      { roll: 3, label: "Broomstick lasts an hour", todo: "Duration is tracked on the spell effect." },
      { roll: 4, label: "Gain 1d4 HP", actions: [{ type: "hp", formula: "1d4" }] },
    ],
  },
  {
    key: "altering-fate",
    trainer: "The Norn",
    topic: "Altering Fate",
    region: "Isles of Andrik",
    page: 147,
    manifestId: "gmgwr-altering-fate-training-benefits",
    table: "Altering Fate Training Benefits",
    benefits: [
      { roll: 1, label: "+1d4 when spending luck", todo: "The Luck Reroll path does not read this yet." },
      { roll: 2, label: "Reroll a talent with ADV", todo: "Reroll on the class talent table, taking the better." },
      {
        roll: 3,
        label: "+2 WIS, or better casting",
        choice: [
          { key: "wis", label: "+2 WIS", changes: [add("system.abilities.wis.value", 2)] },
          { key: "cast", label: "+1 to spellcasting", changes: [add("system.roll.spell.bonus.all")] },
        ],
      },
      { roll: 4, label: "Reroll an HP die with ADV", todo: "Reroll one HP die, taking the better." },
    ],
  },
  {
    key: "kyzian-riding",
    trainer: "Jalia Tyr",
    topic: "Kyzian Riding",
    region: "Kyzian Steppes",
    page: 157,
    manifestId: "gmgwr-kyzian-riding-training-benefits",
    table: "Kyzian Riding Training Benefits",
    // Every row here targets a mount or a riding state, neither of which the
    // granted Talent can see. Mount demeanor lives on the mount actor's own
    // sheet (actors/mount-npc-sheet.mjs); "while riding" needs a toggle.
    benefits: [
      { roll: 1, label: "Mount demeanor up one step", todo: "Step the demeanor on the mount's own sheet." },
      { roll: 2, label: "+1 AC while riding", todo: "Conditional on riding; enable the effect while mounted." },
      { roll: 3, label: "Mount gains +4 HP", todo: "Raise the mount actor's HP." },
      { roll: 4, label: "Bow die up a step while riding", todo: "Conditional on riding; enable the effect while mounted." },
    ],
  },
  {
    key: "sea-diving",
    trainer: "Crokanis",
    topic: "Sea Diving",
    region: "The Last Sea",
    page: 166,
    manifestId: "gmgwr-sea-diving-training-benefits",
    table: "Sea Diving Training Benefits",
    benefits: [
      { roll: 1, label: "Full speed swimming", todo: "Movement rule, applied at the table." },
      { roll: 2, label: "+5 rounds of breath", todo: "Breath is tracked by the GM." },
      { roll: 3, label: "Swim in any armor", todo: "Remove the swim penalty property from the worn armor." },
      { roll: 4, label: "+2 XP from pearls", todo: "Award when pearls are cashed in." },
    ],
  },
  {
    key: "piracy",
    trainer: "The Brothers Lukahz",
    topic: "Piracy",
    region: "The Last Sea",
    page: 167,
    manifestId: "gmgwr-piracy-training-benefits",
    table: "Piracy Training Benefits",
    benefits: [
      { roll: 1, label: "+1 XP from treasure", todo: "Add to the treasure award in Party XP." },
      { roll: 2, label: "+1 to carousing rolls", todo: "Carousing is Shadowdark Extras' roll; it does not read this." },
      { roll: 3, label: "ADV vs getting drunk", todo: "Narrower than a blanket CON advantage." },
      { roll: 4, label: "Escape once per level", todo: "Once-per-level, declared at the table." },
    ],
  },
  {
    key: "survival",
    trainer: "Wendry Hogsfoot",
    topic: "Survival",
    region: "Lowland Moor",
    page: 175,
    manifestId: "gmgwr-survival-training-benefits",
    table: "Survival Training Benefits",
    benefits: [
      { roll: 1, label: "Bogs do not slow you", todo: "The Crawl Strip movement budget does not read this yet." },
      { roll: 2, label: "1/day, invisible one round", todo: "Once-per-day, declared at the table." },
      { roll: 3, label: "Forage two extra rations", todo: "Add to the downtime foraging result." },
      { roll: 4, label: "Smell edible poisons", todo: "Perception call at the table." },
    ],
  },
  {
    key: "sorcerous",
    trainer: "The Librarians of Leng",
    topic: "Sorcerous",
    region: "Morzomotha",
    page: 185,
    manifestId: "gmgwr-sorcerous-training-benefits",
    table: "Sorcerous Training Benefits",
    benefits: [
      { roll: 1, label: "ADV brewing potions", todo: "Downtime's potion check does not read this yet." },
      {
        roll: 2,
        label: "A robe granting +1 AC",
        actions: [{
          type: "ensureGear",
          name: "Morzo Silk Robe",
          changes: [add("system.attributes.ac.value")],
        }],
      },
      { roll: 3, label: "ADV on one known spell", todo: "Name the spell, then set advantage on that spell." },
      { roll: 4, label: "Learn a True Name", todo: "The GM names it." },
    ],
  },
  {
    key: "necromancy",
    trainer: "Rognolt Rattletrap",
    topic: "Necromancy",
    region: "Myre Swamp",
    page: 195,
    manifestId: "gmgwr-necromancy-training-benefits",
    table: "Necromancy Training Benefits",
    benefits: [
      { roll: 1, label: "Learn a necromancer spell", todo: "Add the chosen spell to the sheet." },
      { roll: 2, label: "1d4 HP per undead destroyed", todo: "Heal when the kill happens." },
      { roll: 3, label: "+1 to necromancer casting", todo: "No class selector exists; a blanket bonus would buff every spell." },
      { roll: 4, label: "1/day, regain a lost spell", todo: "Once-per-day, declared at the table." },
    ],
  },
  {
    key: "dwarvish-combat",
    trainer: "Hedrick Ironbones",
    topic: "Dwarvish Combat",
    region: "Rimespire Mountains",
    page: 203,
    manifestId: "gmgwr-dwarvish-combat-training-benefits",
    table: "Dwarvish Combat Training Benefits",
    benefits: [
      { roll: 1, label: "Warhammers become versatile", todo: "Add the versatile property to the warhammer itself." },
      { roll: 2, label: "Armor costs one less slot", todo: "Lower the slot cost on the worn armor." },
      { roll: 3, label: "Gain 1d6 HP", actions: [{ type: "hp", formula: "1d6" }] },
      { roll: 4, label: "+1 with greataxes", changes: hitAndDamage(["greataxe"]) },
    ],
  },
  {
    key: "bandit",
    trainer: "Lysandir",
    topic: "Bandit",
    region: "Sablewood",
    page: 214,
    manifestId: "gmgwr-bandit-training-benefits",
    table: "Bandit Training Benefits",
    benefits: [
      { roll: 1, label: "+1 hit and damage with bows", changes: hitAndDamage(BOWS) },
      {
        roll: 2,
        label: "Bow crits deal triple",
        changes: BOWS.map((s) => override(`system.roll.ranged.critical-multiplier.${s}`, 3)),
      },
      {
        roll: 3,
        label: "Bows crit on 19",
        changes: BOWS.map((s) => override(`system.roll.ranged.critical-success.${s}`, 19)),
      },
      { roll: 4, label: "+1 XP on stolen goods", todo: "Award when the goods are fenced." },
    ],
  },
  {
    key: "green-knight",
    trainer: "Sir Alerin",
    topic: "Green Knight",
    region: "Sablewood",
    page: 215,
    manifestId: "gmgwr-green-knight-training-benefits",
    table: "Green Knight Training Benefits",
    benefits: [
      { roll: 1, label: "Learn a druid spell", todo: "Add the chosen spell to the sheet." },
      {
        roll: 2,
        label: "+1 melee, or better casting",
        choice: [
          { key: "melee", label: "+1 to melee attacks", changes: [add("system.roll.melee.bonus.all")] },
          { key: "cast", label: "+1 to spellcasting", changes: [add("system.roll.spell.bonus.all")] },
        ],
      },
      { roll: 3, label: "HP back when Rooted", todo: "Heal when the Rooted talent is used." },
      { roll: 4, label: "+1 AC", changes: [add("system.attributes.ac.value")] },
    ],
  },
  {
    key: "mystical",
    trainer: "Mardak the Hidden",
    topic: "Mystical",
    region: "Silent Mountains",
    page: 223,
    manifestId: "gmgwr-mystical-training-benefits",
    table: "Mystical Training Benefits",
    benefits: [
      { roll: 1, label: "Reroll WIS, best three of six", actions: [{ type: "statRoll", ability: "wis", formula: "6d6kh3" }] },
      { roll: 2, label: "ADV on one known spell", todo: "Name the spell, then set advantage on that spell." },
      { roll: 3, label: "Foresight grants +1 AC", todo: "Conditional on the Foresight talent." },
      { roll: 4, label: "Roll another class talent", todo: "Roll once more on the class talent table." },
    ],
  },
  {
    key: "swashbuckler",
    trainer: "Daryos of Reme",
    topic: "Swashbuckler",
    region: null,
    page: 245,
    manifestId: "gmgwr-swashbuckler-training-benefits",
    table: "Swashbuckler Training Benefits",
    benefits: [
      { roll: 1, label: "+1 AC with rapier or scimitar", todo: "Conditional on what is drawn; set it on the weapon." },
      { roll: 2, label: "ADV on acrobatics", todo: "Narrower than a blanket DEX advantage." },
      { roll: 3, label: "Renown floors at 4", todo: "The renown ledger has no floor; hold it by hand." },
      {
        roll: 4,
        label: "+2 CHA, or +4 renown",
        choice: [
          { key: "cha", label: "+2 CHA", changes: [add("system.abilities.cha.value", 2)] },
          { key: "renown", label: "+4 renown", actions: [{ type: "renown", value: 4 }] },
        ],
      },
    ],
  },
  {
    key: "ancient-ritual",
    trainer: "Obe-Ixx",
    topic: "Ancient Ritual",
    region: null,
    page: 246,
    manifestId: "gmgwr-ancient-ritual-training-benefits",
    table: "Ancient Ritual Training Benefits",
    benefits: [
      { roll: 1, label: "1/day, become a panther", todo: "Once-per-day, declared at the table." },
      { roll: 2, label: "1/day, drink blood to heal", todo: "Once-per-day, declared at the table." },
      { roll: 3, label: "Gain 3d4 HP", actions: [{ type: "hp", formula: "3d4" }] },
      { roll: 4, label: "Survive 0 CON", todo: "Death rule, applied at the table." },
    ],
  },
  {
    key: "tomb-delver",
    trainer: "Hollin Wilkins",
    topic: "Tomb Delver",
    region: null,
    page: 247,
    manifestId: "gmgwr-tomb-delver-training-benefits",
    table: "Tomb Delver Training Benefits",
    // The one trainer where nothing automates honestly. All four are narrow
    // conditional advantages and the only core keys are whole-ability ones:
    // granting `system.roll.stat.advantage.dex` for "traps only" would buff
    // every DEX check in the game. Prose is the correct answer, not a shortcut.
    benefits: [
      { roll: 1, label: "ADV vs mechanical traps", todo: "Narrower than a blanket DEX advantage." },
      { roll: 2, label: "1d6 less fall damage", todo: "Subtract when a fall is resolved." },
      { roll: 3, label: "ADV vs poison, petrification", todo: "Narrower than a blanket CON advantage." },
      { roll: 4, label: "1/day, detect nearby traps", todo: "Once-per-day, declared at the table." },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** A trainer by key, or null. */
export function trainerByKey(key) {
  return TRAINERS.find((t) => t.key === key) ?? null;
}

/** One benefit off a trainer, by its d4 face. */
export function benefitFor(trainerKey, roll) {
  const trainer = trainerByKey(trainerKey);
  return trainer?.benefits.find((b) => b.roll === Number(roll)) ?? null;
}

/**
 * Does this module compute anything for this benefit, or is it prose?
 *
 * A `choice` counts as mechanical when EITHER branch is — picking the prose
 * branch of "+2 CHA or +1 reaction rolls" is still a real choice the player
 * made, and the window should not present the whole row as untouchable.
 */
export function isMechanical(benefit) {
  if (!benefit) return false;
  if (benefit.changes?.length || benefit.actions?.length) return true;
  return (benefit.choice ?? []).some((c) => c.changes?.length || c.actions?.length);
}

/**
 * The d4 faces a character has not yet taken from one trainer.
 *
 * The book's "once each" is the whole constraint: four tasks, four benefits,
 * one trainer worth four visits. `taken` is the list of rolls already granted,
 * read off the character's existing Talents by the caller.
 */
export function remainingRolls(trainerKey, taken = []) {
  const trainer = trainerByKey(trainerKey);
  if (!trainer) return [];
  const used = new Set((taken ?? []).map(Number));
  return trainer.benefits.map((b) => b.roll).filter((r) => !used.has(r));
}

/**
 * Pick one of the remaining faces from a d4 the caller already rolled.
 *
 * Rerolling until an untaken face comes up is the obvious implementation and
 * it can loop forever once three of four are gone. Walking UP from the rolled
 * face and wrapping is one pass, keeps the roll meaningful, and is the same
 * every time for a given (roll, taken) — which is what makes it testable.
 *
 * @returns {number|null} the face granted, or null when the trainer is spent
 */
export function resolveRoll(trainerKey, rolled, taken = []) {
  const remaining = remainingRolls(trainerKey, taken);
  if (!remaining.length) return null;
  const faces = trainerByKey(trainerKey).benefits.map((b) => b.roll);
  const start = faces.indexOf(Number(rolled));
  if (start < 0) return remaining[0];
  for (let i = 0; i < faces.length; i += 1) {
    const face = faces[(start + i) % faces.length];
    if (remaining.includes(face)) return face;
  }
  return null;
}

/** Trainers grouped by region, region order preserved, unkeyed ones last. */
export function trainersByRegion() {
  const groups = new Map();
  for (const t of TRAINERS) {
    const key = t.region ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const named = [...groups.entries()].filter(([r]) => r !== "");
  const loose = groups.get("") ?? [];
  return [...named.map(([region, trainers]) => ({ region, trainers })),
    ...(loose.length ? [{ region: null, trainers: loose }] : [])];
}
