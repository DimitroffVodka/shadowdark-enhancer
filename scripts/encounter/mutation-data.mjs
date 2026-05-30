/**
 * Shadowdark Enhancer — Mutation Catalog
 *
 * Grounded in the Shadowdark rules-as-written, not a literal Vagabond port:
 *
 *   - "Make it Weird" (Monster Mutation d12 table) — three columns become
 *     three categories: Physical Form, Combat, and Mind & Magic. 36 entries.
 *   - "Monster Generator" (d20) — its Strength and Weakness columns become
 *     the Strengths and Weaknesses categories. 40 entries.
 *
 * Shadowdark's NPC schema has no fields for most of these effects, so each
 * mutation re-expresses the rule against what a Shadowdark NPC actually
 * exposes:
 *
 *   - AC / level changes → delta on draft.ac / draft.level
 *   - New attacks        → pushed onto draft.actions (NPC Attack / Special)
 *   - Flight/swim/burrow/teleport → draft.moveNote + an NPC Feature
 *   - Spellcasting        → draft.spellcasting populated
 *   - Everything abstract (immunities, gazes, senses, behaviors, weaknesses)
 *     → an NPC Feature item (draft.features), the only place a Shadowdark NPC
 *     can carry free-form special rules.
 *
 * Each mutation's `apply(draft)` mutates the Monster Creator's DRAFT model
 * (see _defaultDraft in encounter-creator.mjs) in place. Both integration
 * paths — "Apply to Draft" and "Create Mutated Copy" — run the same apply()
 * functions, so a mutation is defined exactly once.
 *
 * Per RAW, a mutated monster is treated as two levels higher for treasure;
 * that's a GM-side ruling, so it isn't encoded here. "Roll up to three
 * mutations" is left to manual selection.
 */

/* -------------------------------------------- */
/*  Categories                                  */
/* -------------------------------------------- */

export const MUTATION_CATEGORIES = {
  form:       { label: "Physical Form", icon: "fa-dna" },
  combat:     { label: "Combat",        icon: "fa-swords" },
  mind:       { label: "Mind & Magic",  icon: "fa-brain" },
  strengths:  { label: "Strengths",     icon: "fa-star" },
  weaknesses: { label: "Weaknesses",    icon: "fa-heart-crack" },
};

/* -------------------------------------------- */
/*  Draft mutation helpers                      */
/* -------------------------------------------- */

/** Adjust AC, floored at 0. */
function _addAc(draft, delta) {
  draft.ac = Math.max(0, Number(draft.ac ?? 10) + delta);
}

/** Adjust level, floored at 0. */
function _addLevel(draft, delta) {
  draft.level = Math.max(0, Number(draft.level ?? 1) + delta);
}

/** Push a new NPC Attack onto the draft. */
function _addAttack(draft, { name, damage, bonus = 0, ranges = ["close"], description = "" }) {
  draft.actions.push({
    id: foundry.utils.randomID(),
    name,
    type: "NPC Attack",
    num: 1,
    bonus,
    damage,
    ranges,
    description,
  });
}

/** Push a new NPC Special Attack onto the draft. */
function _addSpecial(draft, { name, description }) {
  draft.actions.push({
    id: foundry.utils.randomID(),
    name,
    type: "NPC Special Attack",
    description,
  });
}

/** Push a named NPC Feature, skipping exact-name duplicates. */
function _addFeature(draft, name, description) {
  if (draft.features.some(f => f.name === name)) return;
  draft.features.push({ id: foundry.utils.randomID(), name, description });
}

/** Append a movement-note fragment without duplicating it. */
function _addMoveNote(draft, fragment) {
  const cur = (draft.moveNote || "").trim();
  if (cur.toLowerCase().includes(fragment.toLowerCase())) return;
  draft.moveNote = cur ? `${cur}, ${fragment}` : fragment;
}

/** Raise an ability modifier to at least `min` (never lowers it). */
function _bumpAbility(draft, key, min) {
  const cur = Number(draft.abilities?.[key] ?? 0);
  if (cur < min) draft.abilities = { ...draft.abilities, [key]: min };
}

/** Make the draft an innate spellcaster if it isn't one already. The
 *  attack bonus tracks level per RAW ("rarely exceed its level"). A draft
 *  is "already a caster" only when it has spell attacks — the default draft
 *  always carries a placeholder ability, so that can't be the gate. */
function _makeSpellcaster(draft, ability = "int") {
  const sc = draft.spellcasting ?? {};
  if (Number(sc.attacks ?? 0) > 0) return;
  draft.spellcasting = {
    ability: sc.ability || ability,
    bonus: Math.max(Number(sc.bonus ?? 0), 1, Number(draft.level ?? 1)),
    attacks: 1,
  };
}

/* -------------------------------------------- */
/*  Make it Weird — Column 1: Physical Form     */
/* -------------------------------------------- */

const _formMutations = [
  {
    id: "form-shapechanger", name: "Shapechanger", category: "form", type: "boon",
    description: "Can take the form of another creature it has seen.",
    namePrefix: "Shapeshifting",
    apply(d) { _addFeature(d, "Shapechanger", "Can magically assume the form of any beast or humanoid it has seen, reverting on death."); },
  },
  {
    id: "form-fins-gills", name: "Fins and Gills", category: "form", type: "boon",
    description: "Gains a swim mode and water-breathing.",
    namePrefix: "Aquatic",
    apply(d) {
      _addMoveNote(d, "swim");
      _addFeature(d, "Amphibious", "Breathes both air and water and swims at its normal movement speed.");
    },
  },
  {
    id: "form-insulating-fur", name: "Insulating Fur", category: "form", type: "boon",
    description: "Thick fur shrugs off cold.",
    namePrefix: "Shaggy",
    apply(d) { _addFeature(d, "Insulating Fur", "Takes no damage from natural cold and half damage from cold attacks."); },
  },
  {
    id: "form-iron-scales", name: "Ironlike Scales", category: "form", type: "boon",
    description: "+2 AC — hard metallic scales.",
    namePrefix: "Iron-Scaled",
    apply(d) { _addAc(d, 2); },
  },
  {
    id: "form-extra-limbs", name: "Extra Limbs", category: "form", type: "boon",
    description: "Makes an additional attack each turn.",
    namePrefix: "Many-Armed",
    apply(d) { _addFeature(d, "Extra Limbs", "Makes one additional melee attack on its turn."); },
  },
  {
    id: "form-tentacles", name: "Tentacles", category: "form", type: "boon",
    description: "Adds a 1d6 tentacle that restrains on a hit.",
    namePrefix: "Tentacled",
    apply(d) {
      _addAttack(d, {
        name: "Tentacle", damage: "1d6", ranges: ["close", "near"],
        description: "On a hit, the target is restrained. It can free itself with a DC 12 STR check on its turn.",
      });
    },
  },
  {
    id: "form-boneless", name: "Boneless", category: "form", type: "boon",
    description: "Squeezes through any gap; can't be knocked prone.",
    namePrefix: "Boneless",
    apply(d) { _addFeature(d, "Boneless", "Can squeeze through any gap a small animal could fit through and cannot be knocked prone."); },
  },
  {
    id: "form-gigantic", name: "Gigantic", category: "form", type: "boon",
    description: "Huge size; moves double near.",
    namePrefix: "Gigantic",
    apply(d) {
      _addMoveNote(d, "double near");
      _addFeature(d, "Gigantic", "Towering size. Its melee attacks reach out to near and it moves double near each turn.");
    },
  },
  {
    id: "form-flings-spikes", name: "Flings Spikes", category: "form", type: "boon",
    description: "Adds a 1d6 ranged spike volley.",
    namePrefix: "Spiked",
    apply(d) {
      _addAttack(d, {
        name: "Fling Spikes", damage: "1d6", ranges: ["near"],
        description: "Launches a volley of bony spikes at a target within near.",
      });
    },
  },
  {
    id: "form-two-heads", name: "Two Heads", category: "form", type: "boon",
    description: "Can't be surprised; one extra attack.",
    namePrefix: "Two-Headed",
    apply(d) { _addFeature(d, "Two Heads", "Cannot be surprised, has advantage on checks to notice hidden things, and makes one additional attack on its turn."); },
  },
  {
    id: "form-burrows", name: "Burrows", category: "form", type: "boon",
    description: "Can tunnel through earth and loose stone.",
    namePrefix: "Burrowing",
    apply(d) {
      _addMoveNote(d, "burrow");
      _addFeature(d, "Burrower", "Tunnels through earth and loose stone at half its movement speed.");
    },
  },
  {
    id: "form-wings", name: "Wings", category: "form", type: "boon",
    description: "Gains flight at its normal speed.",
    namePrefix: "Winged",
    apply(d) {
      _addMoveNote(d, "fly");
      _addFeature(d, "Flight", "Can fly at its normal movement speed.");
    },
  },
];

/* -------------------------------------------- */
/*  Make it Weird — Column 2: Combat            */
/* -------------------------------------------- */

const _combatMutations = [
  {
    id: "combat-double-damage", name: "Double Damage", category: "combat", type: "boon",
    description: "Deals double damage with its weapon attacks.",
    namePrefix: "Brutal",
    apply(d) { _addFeature(d, "Savage Strength", "Rolls double the normal number of damage dice on its weapon attacks."); },
  },
  {
    id: "combat-fire-breath", name: "Breathes Fire", category: "combat", type: "boon",
    description: "Adds a recharging cone of fire.",
    namePrefix: "Fire-Breathing",
    apply(d) {
      _addSpecial(d, {
        name: "Fire Breath",
        description: "Recharge 5-6. Exhales fire in a cone out to near. Each creature in the area takes 2d6 fire damage, or half with a successful DC 12 DEX check.",
      });
    },
  },
  {
    id: "combat-fast-healing", name: "Fast Healing", category: "combat", type: "boon",
    description: "Heals 1d4 HP at the start of its turn.",
    namePrefix: "Regenerating",
    apply(d) { _addFeature(d, "Fast Healing", "Regains 1d4 HP at the start of its turn unless it took fire or acid damage since its last turn."); },
  },
  {
    id: "combat-plus-attack", name: "+1 Attack", category: "combat", type: "boon",
    description: "Makes one extra attack each turn.",
    apply(d) { _addFeature(d, "Extra Attack", "Makes one additional attack on its turn."); },
  },
  {
    id: "combat-plus-ac", name: "+2 AC", category: "combat", type: "boon",
    description: "+2 AC.",
    apply(d) { _addAc(d, 2); },
  },
  {
    id: "combat-plus-levels", name: "+2 Levels", category: "combat", type: "boon",
    description: "Raises the monster's level by 2.",
    apply(d) { _addLevel(d, 2); },
  },
  {
    id: "combat-plus-d6", name: "+1d6 Damage", category: "combat", type: "boon",
    description: "Attacks deal an extra 1d6 damage.",
    namePrefix: "Savage",
    apply(d) { _addFeature(d, "Vicious", "Its attacks deal an additional 1d6 damage on a hit."); },
  },
  {
    id: "combat-life-drain", name: "Life-Draining Touch", category: "combat", type: "boon",
    description: "Adds a touch that drains life and heals it.",
    namePrefix: "Life-Draining",
    apply(d) {
      _addAttack(d, {
        name: "Draining Touch", damage: "1d8", ranges: ["close"],
        description: "Necrotic. The creature regains HP equal to the damage dealt, and the target's maximum HP is reduced by the same amount until it rests.",
      });
    },
  },
  {
    id: "combat-very-fast", name: "Very Fast", category: "combat", type: "boon",
    description: "Doubles its movement speed.",
    namePrefix: "Swift",
    apply(d) {
      _addMoveNote(d, "fast (double movement)");
      _addFeature(d, "Very Fast", "Moves at double its normal movement speed.");
    },
  },
  {
    id: "combat-reflects-spells", name: "Reflects Spells", category: "combat", type: "boon",
    description: "Can turn a spell back on its caster.",
    namePrefix: "Spell-Warding",
    apply(d) { _addFeature(d, "Spell Reflection", "Once per round, on a failed spell save it may instead reflect the spell back at its caster (caster makes the save)."); },
  },
  {
    id: "combat-electrified", name: "Electrified Weapon", category: "combat", type: "boon",
    description: "Attacks deal extra lightning damage.",
    namePrefix: "Electrified",
    apply(d) { _addFeature(d, "Electrified", "Its weapon attacks deal an additional 1d6 lightning damage on a hit."); },
  },
  {
    id: "combat-acidic-saliva", name: "Acidic Saliva", category: "combat", type: "boon",
    description: "Adds a corrosive bite that ruins armor.",
    namePrefix: "Acidic",
    apply(d) {
      _addAttack(d, {
        name: "Acidic Bite", damage: "1d6", ranges: ["close"],
        description: "Acid. Non-magical armor struck by this attack takes a permanent -1 penalty to AC (to a minimum of the wearer's base).",
      });
    },
  },
];

/* -------------------------------------------- */
/*  Make it Weird — Column 3: Mind & Magic      */
/* -------------------------------------------- */

const _mindMutations = [
  {
    id: "mind-speaks-common", name: "Speaks Common", category: "mind", type: "boon",
    description: "Can understand and speak Common.",
    apply(d) { _addFeature(d, "Speaks Common", "Understands and speaks the Common tongue."); },
  },
  {
    id: "mind-knows-spells", name: "Knows 1d4 Spells", category: "mind", type: "boon",
    description: "Becomes an innate spellcaster.",
    apply(d) {
      _makeSpellcaster(d, "int");
      _addFeature(d, "Innate Magic", "Knows 1d4 spells (GM's choice) and can cast them using its spellcasting ability.");
    },
  },
  {
    id: "mind-telepathic", name: "Telepathic", category: "mind", type: "boon",
    description: "Communicates mind-to-mind.",
    namePrefix: "Telepathic",
    apply(d) { _addFeature(d, "Telepathy", "Can communicate telepathically with any creature within far that shares a language."); },
  },
  {
    id: "mind-toxic-spores", name: "Toxic Spores", category: "mind", type: "boon",
    description: "Adds a cloud of poisonous spores.",
    namePrefix: "Spored",
    apply(d) {
      _addSpecial(d, {
        name: "Toxic Spores",
        description: "Releases a cloud of spores filling a near-radius. Each creature in the area must succeed on a DC 12 CON check or be poisoned until the end of its next turn.",
      });
    },
  },
  {
    id: "mind-sonic-blast", name: "Sonic Blasts", category: "mind", type: "boon",
    description: "Adds a ranged thunderous shriek.",
    namePrefix: "Shrieking",
    apply(d) {
      _addAttack(d, {
        name: "Sonic Blast", damage: "1d8", ranges: ["near"],
        description: "Thunder. On a hit, the target must succeed on a DC 12 CON check or be deafened until the end of its next turn.",
      });
    },
  },
  {
    id: "mind-teleport", name: "Teleports in Bursts", category: "mind", type: "boon",
    description: "Can blink short distances.",
    namePrefix: "Blinking",
    apply(d) {
      _addMoveNote(d, "teleport (near)");
      _addFeature(d, "Blink", "As part of its movement, it can teleport up to near to a space it can see.");
    },
  },
  {
    id: "mind-paralytic-touch", name: "Paralytic Touch", category: "mind", type: "boon",
    description: "Adds a touch that paralyzes.",
    namePrefix: "Paralytic",
    apply(d) {
      _addAttack(d, {
        name: "Paralytic Touch", damage: "1d4", ranges: ["close"],
        description: "On a hit, the target must succeed on a DC 12 CON check or be paralyzed until the end of its next turn.",
      });
    },
  },
  {
    id: "mind-genius", name: "Genius Intellect", category: "mind", type: "boon",
    description: "Cunning and brilliant (INT becomes +4).",
    namePrefix: "Cunning",
    apply(d) {
      _bumpAbility(d, "int", 4);
      _addFeature(d, "Genius Intellect", "Brilliant and calculating; plans ambushes, exploits weaknesses, and is nearly impossible to deceive.");
    },
  },
  {
    id: "mind-antimagic", name: "Antimagic Field", category: "mind", type: "boon",
    description: "Suppresses magic around it.",
    namePrefix: "Null",
    apply(d) { _addFeature(d, "Antimagic Field", "Spells and magical effects are suppressed within near of this creature; spells cast there automatically fail."); },
  },
  {
    id: "mind-blood-bite", name: "Blood-Draining Bite", category: "mind", type: "boon",
    description: "Adds a bite that drains blood to heal.",
    namePrefix: "Bloodthirsty",
    apply(d) {
      _addAttack(d, {
        name: "Bloodletting Bite", damage: "1d6", ranges: ["close"],
        description: "On a hit, it latches on and drains blood, regaining HP equal to the damage dealt.",
      });
    },
  },
  {
    id: "mind-swamp-fever", name: "Carries Swamp Fever", category: "mind", type: "boon",
    description: "Its wounds may infect with disease.",
    namePrefix: "Plagued",
    apply(d) { _addFeature(d, "Diseased", "A creature damaged by this monster must succeed on a DC 12 CON check or contract swamp fever."); },
  },
  {
    id: "mind-blessed", name: "Blessed by a God", category: "mind", type: "boon",
    description: "Divine favor wards it from harm.",
    namePrefix: "Blessed",
    apply(d) { _addFeature(d, "Divine Blessing", "Once per day, it can reroll a failed check or roll. It has advantage on checks to resist being turned or banished."); },
  },
];

/* -------------------------------------------- */
/*  Monster Generator — Strengths               */
/* -------------------------------------------- */

const _strengthMutations = [
  {
    id: "str-extra-attack", name: "Frenzied (+1 Attack)", category: "strengths", type: "boon",
    description: "Makes one extra attack each turn.",
    apply(d) { _addFeature(d, "Frenzied", "Makes one additional attack on its turn."); },
  },
  {
    id: "str-absorbs-magic", name: "Absorbs Magic", category: "strengths", type: "boon",
    description: "Heals when targeted by a spell.",
    namePrefix: "Spell-Eating",
    apply(d) { _addFeature(d, "Magic Absorption", "When targeted by a spell, it takes no damage and instead regains HP equal to the spell's tier × 2."); },
  },
  {
    id: "str-swarm", name: "Swarm", category: "strengths", type: "boon",
    description: "A mass of creatures; resists single hits.",
    namePrefix: "Swarming",
    apply(d) { _addFeature(d, "Swarm", "Composed of many small creatures. Takes half damage from non-area attacks and can occupy other creatures' spaces."); },
  },
  {
    id: "str-1d10-damage", name: "1d10 Damage", category: "strengths", type: "boon",
    description: "Adds a heavy 1d10 strike.",
    apply(d) { _addAttack(d, { name: "Heavy Strike", damage: "1d10", description: "" }); },
  },
  {
    id: "str-poison-sting", name: "Poison Sting", category: "strengths", type: "boon",
    description: "Adds a 1d6 sting that poisons.",
    namePrefix: "Venomous",
    apply(d) {
      _addAttack(d, {
        name: "Sting", damage: "1d6", ranges: ["close"],
        description: "On a hit, the target must succeed on a DC 12 CON check or be poisoned, taking 1d4 damage at the start of each of its turns until it succeeds.",
      });
    },
  },
  {
    id: "str-confusing-gaze", name: "Confusing Gaze", category: "strengths", type: "boon",
    description: "Adds a gaze that bewilders.",
    apply(d) {
      _addSpecial(d, {
        name: "Confusing Gaze",
        description: "A creature that starts its turn within near and can see the monster must succeed on a DC 12 WIS check or act randomly (GM's choice) on its turn.",
      });
    },
  },
  {
    id: "str-eats-metal", name: "Eats Metal", category: "strengths", type: "boon",
    description: "Corrodes and devours metal gear.",
    apply(d) { _addFeature(d, "Metal Eater", "On a hit against a creature wearing metal armor or a metal weapon, that item takes a permanent -1 penalty; at -3 it is destroyed."); },
  },
  {
    id: "str-ranged-attacks", name: "Ranged Attacks", category: "strengths", type: "boon",
    description: "Adds a 1d6 attack out to far.",
    apply(d) { _addAttack(d, { name: "Ranged Attack", damage: "1d6", ranges: ["far"], description: "A ranged attack out to far." }); },
  },
  {
    id: "str-highly-intelligent", name: "Highly Intelligent", category: "strengths", type: "boon",
    description: "Cunning tactician (INT becomes +3).",
    namePrefix: "Clever",
    apply(d) {
      _bumpAbility(d, "int", 3);
      _addFeature(d, "Highly Intelligent", "Fights with cunning tactics, sets ambushes, and targets the most dangerous foes first.");
    },
  },
  {
    id: "str-crushing-grasp", name: "Crushing Grasp", category: "strengths", type: "boon",
    description: "Adds a grab that crushes.",
    namePrefix: "Crushing",
    apply(d) {
      _addAttack(d, {
        name: "Crushing Grasp", damage: "1d8", ranges: ["close"],
        description: "On a hit, the target is grabbed (escape DC 12 STR) and takes the damage again at the start of each of its turns until it escapes.",
      });
    },
  },
  {
    id: "str-psychic-blast", name: "Psychic Blast", category: "strengths", type: "boon",
    description: "Adds a mind-rending blast.",
    namePrefix: "Psychic",
    apply(d) {
      _addAttack(d, {
        name: "Psychic Blast", damage: "1d8", ranges: ["near"],
        description: "Psychic. Ignores armor (resolve vs. a flat DC 12 WIS check instead of AC).",
      });
    },
  },
  {
    id: "str-stealthy", name: "Stealthy", category: "strengths", type: "boon",
    description: "Hides and strikes from concealment.",
    namePrefix: "Stalking",
    apply(d) { _addFeature(d, "Stealthy", "Has advantage on checks to hide and on attacks against creatures that cannot see it."); },
  },
  {
    id: "str-petrifying-gaze", name: "Petrifying Gaze", category: "strengths", type: "boon",
    description: "Adds a gaze that turns flesh to stone.",
    namePrefix: "Petrifying",
    apply(d) {
      _addSpecial(d, {
        name: "Petrifying Gaze",
        description: "A creature that starts its turn within near and meets the monster's gaze must succeed on a DC 12 CON check or begin to petrify, becoming fully stone on a second failed check.",
      });
    },
  },
  {
    id: "str-1d12-damage", name: "1d12 Damage", category: "strengths", type: "boon",
    description: "Adds a devastating 1d12 blow.",
    apply(d) { _addAttack(d, { name: "Devastating Blow", damage: "1d12", description: "" }); },
  },
  {
    id: "str-impersonation", name: "Impersonation", category: "strengths", type: "boon",
    description: "Mimics the appearance of others.",
    apply(d) { _addFeature(d, "Impersonation", "Can perfectly mimic the voice and appearance of a creature it has seen, fooling all but the most careful inspection."); },
  },
  {
    id: "str-blinding-aura", name: "Blinding Aura", category: "strengths", type: "boon",
    description: "Adds a burst of blinding light.",
    namePrefix: "Radiant",
    apply(d) {
      _addSpecial(d, {
        name: "Blinding Aura",
        description: "Flares with light. Each creature within near must succeed on a DC 12 CON check or be blinded until the end of its next turn.",
      });
    },
  },
  {
    id: "str-invisible", name: "Turns Invisible", category: "strengths", type: "boon",
    description: "Can vanish from sight.",
    namePrefix: "Unseen",
    apply(d) { _addFeature(d, "Invisibility", "Can turn invisible at will as an action; it becomes visible again when it attacks or casts a spell."); },
  },
  {
    id: "str-2d6-damage", name: "2d6 Damage", category: "strengths", type: "boon",
    description: "Adds a brutal 2d6 attack.",
    apply(d) { _addAttack(d, { name: "Brutal Strike", damage: "2d6", description: "" }); },
  },
  {
    id: "str-swallows-whole", name: "Swallows Whole", category: "strengths", type: "boon",
    description: "Adds a bite that can engulf a foe.",
    namePrefix: "Devouring",
    apply(d) {
      _addSpecial(d, {
        name: "Swallow Whole",
        description: "On a hit against a grabbed creature of its size or smaller, it swallows the target, which is restrained and takes 2d6 damage at the start of each of the monster's turns.",
      });
    },
  },
  {
    id: "str-plus-2-attacks", name: "+2 Attacks", category: "strengths", type: "boon",
    description: "Makes two extra attacks each turn.",
    namePrefix: "Multi-Limbed",
    apply(d) { _addFeature(d, "Flurry", "Makes two additional attacks on its turn."); },
  },
];

/* -------------------------------------------- */
/*  Monster Generator — Weaknesses (banes)      */
/* -------------------------------------------- */

/** A damage-type vulnerability from the Monster Generator weakness column. */
function _dmgWeakness(id, label, dtype) {
  const name = `${label} Weakness`;
  const description = `Takes double damage from ${dtype}.`;
  return {
    id, name, category: "weaknesses", type: "bane", description,
    apply(d) { _addFeature(d, name, description); },
  };
}

/** A behavioral / banishment vulnerability from the weakness column. */
function _quirkWeakness(id, name, description) {
  return {
    id, name, category: "weaknesses", type: "bane", description,
    apply(d) { _addFeature(d, name, description); },
  };
}

const _weaknessMutations = [
  _dmgWeakness("weak-cold", "Cold", "cold"),
  _quirkWeakness("weak-greed", "Greed", "Compulsively covets treasure; it can be distracted, bribed, or lured with valuables."),
  _quirkWeakness("weak-light", "Light", "Hindered in bright light, taking disadvantage on attacks while brightly illuminated."),
  _quirkWeakness("weak-salt", "Salt", "Burned by salt as if by acid; a line of salt blocks its passage."),
  _quirkWeakness("weak-vanity", "Vanity", "Obsessed with its own image; flattery and displays of beauty can transfix it."),
  _quirkWeakness("weak-mirrors", "Mirrors", "Cannot bear its own reflection; a held-up mirror drives it back."),
  _dmgWeakness("weak-electricity", "Electricity", "lightning"),
  _quirkWeakness("weak-fragile-body", "Fragile Body", "Easily crippled. The first hit it takes each combat is automatically a critical hit."),
  _quirkWeakness("weak-sunlight", "Sunlight", "Sears in direct sunlight, taking 1d6 damage at the start of each turn it stands in the sun."),
  _dmgWeakness("weak-silver", "Silver", "silvered weapons"),
  _dmgWeakness("weak-fire", "Fire", "fire"),
  _quirkWeakness("weak-food", "Food", "Gluttonous; a tempting meal can lure or pacify it."),
  _dmgWeakness("weak-acid", "Acid", "acid"),
  _quirkWeakness("weak-garlic", "Garlic", "Repelled by garlic and cannot approach within close of it."),
  _dmgWeakness("weak-iron", "Iron", "cold-forged iron weapons"),
  _quirkWeakness("weak-water", "Water", "Harmed by water; running water blocks it and immersion burns like acid."),
  _quirkWeakness("weak-true-name", "Its True Name", "Bound by its true name; one who speaks it can command or banish the creature."),
  _quirkWeakness("weak-loud-sounds", "Loud Sounds", "Disoriented by loud sounds; a thunderous noise stuns it until the end of its next turn (DC 12 CON negates)."),
  _quirkWeakness("weak-holy-water", "Holy Water", "Seared by holy water and blessed symbols, taking 2d6 damage from a holy-water flask."),
  _quirkWeakness("weak-music", "Music", "Entranced by music; a successful performance holds it transfixed while it can hear the song."),
];

/* -------------------------------------------- */
/*  Catalog                                     */
/* -------------------------------------------- */

export const MUTATIONS = [
  ..._formMutations,
  ..._combatMutations,
  ..._mindMutations,
  ..._strengthMutations,
  ..._weaknessMutations,
];

/* -------------------------------------------- */
/*  Lookup helpers                              */
/* -------------------------------------------- */

export function getMutation(id) {
  return MUTATIONS.find(m => m.id === id) || null;
}

export function getMutationsByCategory(category) {
  if (!category || category === "all") return [...MUTATIONS];
  return MUTATIONS.filter(m => m.category === category);
}

/**
 * Return the name of an already-selected mutation that conflicts with the
 * given one (same conflictGroup), or null if there is no conflict. No RAW
 * mutation currently declares a conflictGroup, so this presently always
 * returns null — the machinery is kept so future mutually-exclusive
 * mutations stay a one-line change.
 * @param {string} mutationId
 * @param {Iterable<string>} selectedIds
 * @returns {string|null}
 */
export function getConflict(mutationId, selectedIds) {
  const mutation = getMutation(mutationId);
  if (!mutation?.conflictGroup) return null;
  for (const id of selectedIds) {
    if (id === mutationId) continue;
    const other = getMutation(id);
    if (other?.conflictGroup === mutation.conflictGroup) return other.name;
  }
  return null;
}

/**
 * Apply a list of mutations to a Monster Creator draft, in place.
 * @param {object} draft — the creator draft model (see _defaultDraft)
 * @param {string[]} mutationIds
 * @returns {{applied: object[], prefixes: string[], suffixes: string[]}}
 */
export function applyMutations(draft, mutationIds) {
  const applied = [];
  const prefixes = [];
  const suffixes = [];
  for (const id of mutationIds) {
    const mutation = getMutation(id);
    if (!mutation) continue;
    mutation.apply(draft);
    applied.push(mutation);
    if (mutation.namePrefix) prefixes.push(mutation.namePrefix);
    if (mutation.nameSuffix) suffixes.push(mutation.nameSuffix);
  }
  return { applied, prefixes, suffixes };
}

/**
 * Build a mutated name from a base name plus prefix/suffix fragments.
 * Guards against re-stacking a prefix already leading the name.
 * @param {string} baseName
 * @param {string[]} prefixes
 * @param {string[]} suffixes
 * @returns {string}
 */
export function generateMutatedName(baseName, prefixes = [], suffixes = []) {
  const base = (baseName || "Creature").trim();
  const lead = base.toLowerCase();
  const newPrefixes = prefixes.filter(p => !lead.startsWith(p.toLowerCase()));
  const parts = [...newPrefixes, base];
  if (suffixes.length) parts.push(suffixes.join(" "));
  return parts.join(" ");
}
