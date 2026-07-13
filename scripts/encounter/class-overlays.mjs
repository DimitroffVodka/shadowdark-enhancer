/**
 * Shadowdark Enhancer — Class wiring overlays
 *
 * SDE-original automation that the class parser cannot derive from a book
 * paste because it is NOT in the book text: ActiveEffect wiring, our invented
 * names for unnamed talent-table outcomes, WR-only weapon stat lines, and
 * class-level flags. Applied on top of parseClassSection() output at commit
 * (class-unit-importer.mjs) — the paste supplies every word of rules text,
 * these overlays supply the plumbing. Extracted from the authored gold
 * masters via in-memory unseal, 2026-07-10.
 *
 * CONTENT CONTRACT (enforced by verify.sh, blocking): no rules text, no
 * flavor, no sentences from any book — mechanics, labels, and effect keys
 * only. Descriptions for overlay-named talents come from the pasted row text
 * at import time; weapon items ship stats only, no description.
 *
 * Shapes:
 *   features:    { "<Feature Name>": { talentClass?, effects? } } — matched
 *                case-insensitively against parsed feature names
 *   rowTalents:  { "<lo>" | "<lo>-<hi>": [{ name, talentClass?, effects? }] }
 *                — a QUEUE per row: options that resolve to system talents
 *                take those; remaining options consume these entries in order
 *   items:       WR-only gear the class references — created before the
 *                class so its wield list resolves ({ name, type, img, system })
 *   weaponNames / armorNames: wield-list overrides for grants the text
 *                states as categories ("all swords", "strikes")
 *   classFlags:  merged into the class's module flags (e.g. fixedDeity)
 *   effects[]:   embedded ActiveEffect data — { name, img, transfer,
 *                changes: [{ key, value, type, phase }] } (SD change schema)
 */

/** Effect-change factory for the system's four weapon-choice bonus keys. */
const _weaponChoiceBonus = (value) => [
  "system.roll.melee.bonus.REPLACEME",
  "system.roll.melee.damage.REPLACEME",
  "system.roll.ranged.bonus.REPLACEME",
  "system.roll.ranged.damage.REPLACEME",
].map((key) => ({ key, value, type: "add", phase: "initial" }));

const _FINESSE   = "Compendium.shadowdark.properties.Item.rqQwpoeWEqi0ZcYK";
const _TWOHANDED = "Compendium.shadowdark.properties.Item.b6Gm2ULKj2qyy2xJ";
const _THROWN    = "Compendium.shadowdark.properties.Item.c35ROL1nXwC840kC";

const _weapon = (name, img, system) => ({
  name, type: "Weapon", img, folder: "Gear/Weapons",
  system: { range: "close", magicItem: false, baseWeapon: "",
    cost: { gp: 0, sp: 0, cp: 0 },
    slots: { free_carry: 0, per_slot: 1, slots_used: 1 },
    ...system },
});

export const CLASS_OVERLAYS = {
  delver: {
    source: "WR", pages: "38",
    features: {
      "Trusty Gear": {
        effects: [{
          name: "Trusty Gear",
          img: "icons/skills/melee/weapons-crossed-swords-white-blue.webp",
          transfer: true,
          changes: _weaponChoiceBonus("1+floor(@level.value/2)"),
        }],
      },
    },
    rowTalents: {
      "2": [{
        name: "Deep Pockets",
        effects: [{
          name: "Deep Pockets", img: "icons/svg/aura.svg", transfer: true,
          changes: [{ key: "system.slots", value: 2, type: "add", phase: "initial" }],
        }],
      }],
      "10-11": [{ name: "Master Scavenger" }],
    },
  },

  duelist: {
    source: "WR", pages: "42",
    rowTalents: {
      "2": [{ name: "All Attacks Miss (1/Day)" }],
      "3-6": [{ name: "+1 Parry Use Per Day" }],
      "10-11": [{ name: "Cutting Remark" }],
    },
    items: [
      _weapon("Rapier", "icons/weapons/swords/sword-guard-purple.webp",
        { type: "melee", damage: { oneHanded: "d8", twoHanded: "" }, properties: [_FINESSE], cost: { gp: 8, sp: 0, cp: 0 } }),
      _weapon("Falchion", "icons/weapons/swords/sword-guard-purple.webp",
        { type: "melee", damage: { oneHanded: "d8", twoHanded: "" }, properties: [_FINESSE, _TWOHANDED], cost: { gp: 12, sp: 0, cp: 0 } }),
    ],
    weaponNames: ["Dagger", "Bastard Sword", "Greatsword", "Longsword", "Scimitar", "Shortsword", "Rapier", "Falchion"],
    armorNames: ["Leather Armor", "Mithral Chainmail"],
  },

  "green knight": {
    source: "WR", pages: "44",
    rowTalents: {
      "2": [{ name: "Treewalk" }],
    },
    weaponNames: ["Bastard Sword", "Crossbow", "Dagger", "Greataxe", "Greatsword", "Handaxe", "Spear", "Staff"],
    classFlags: { fixedDeity: "Compendium.shadowdark.patrons-and-deities.Item.FhDBOHUircue27aV" },
  },

  "kyzian archer": {
    source: "WR", pages: "49",
    rowTalents: {
      "2": [{ name: "Weapon Damage Die (d10)" }],
      "10-11": [{ name: "Additional Hawk Eye Use" }],
    },
    weaponNames: ["Dagger", "Longbow", "Shortbow", "Sling", "Scimitar"],
    armorNames: ["Leather Armor"],
  },

  "monk of yag-kesh": {
    source: "WR", pages: "50",
    features: {
      "Eye of Yag-Kesh": {
        effects: [{
          name: "Eye of Yag-Kesh",
          img: "icons/magic/earth/strike-fist-stone-gray.webp",
          transfer: true,
          changes: [{ key: "system.attributes.ac.unarmored", value: "max(0,@abilities.wis.mod)", type: "add", phase: "initial" }],
        }],
      },
    },
    rowTalents: {
      "2": [{ name: "Double Movement Speed" }],
      "10-11": [{ name: "Additional Sun on the Water Use" }],
    },
    items: [
      _weapon("Strike", "icons/skills/melee/unarmed-punch-fist.webp",
        { type: "melee", damage: { oneHanded: "d8", twoHanded: "d8" }, properties: [_TWOHANDED], magicItem: true }),
    ],
    weaponNames: ["Staff", "Strike"],
  },

  necromancer: {
    source: "WR", pages: "52",
    rowTalents: {
      "2": [{ name: "Return to Life" }],
    },
    items: [
      _weapon("Stave", "icons/weapons/staves/staff-ornate-purple.webp",
        { type: "melee", damage: { oneHanded: "d6", twoHanded: "d6" }, properties: [_TWOHANDED], cost: { gp: 2, sp: 0, cp: 0 } }),
    ],
    weaponNames: ["Crossbow", "Dagger", "Longsword", "Scimitar", "Staff", "Stave"],
    armorNames: ["Leather Armor", "Chainmail"],
  },

  paladin: {
    source: "WR", pages: "54",
    rowTalents: {
      "2": [{ name: "Named Blade Magic Benefit" }],
      "3-6": [{ name: "+1 to Named Blade Attacks and Damage" }],
      "10-11": [{ name: "Improved Inspiring Presence" }],
    },
    items: [
      _weapon("Lance", "icons/skills/melee/strike-polearm-light-orange.webp",
        { type: "melee", damage: { oneHanded: "", twoHanded: "d12" }, properties: [_TWOHANDED], cost: { gp: 15, sp: 0, cp: 0 },
          slots: { free_carry: 0, per_slot: 1, slots_used: 3 } }),
    ],
    weaponNames: ["Bastard Sword", "Dagger", "Greatsword", "Javelin", "Lance", "Longsword", "Shortsword"],
  },

  roustabout: {
    source: "WR", pages: "63",
    rowTalents: {
      "2": [{ name: "+1 to Any Stat and Roll Again" }],
      "3-6": [{ name: "Gain a New Weapon or Armor Proficiency" }],
      "7-9": [{ name: "+1 to Any Two Stats" }],
      "10-11": [{ name: "Extra Hit Points Die" }],
      "12": [{ name: "Learn Any Spell" }],
    },
    weaponNames: ["Club", "Dagger", "Staff"],
    armorNames: ["Leather Armor"],
  },

  wyrdling: {
    source: "WR", pages: "72-73",   // writeup p72 + Corruption d10 table p73
    rowTalents: {
      "2": [{ name: "Gain Two Corruption Talents" }],
      "7-9": [{ name: "Gain a Corruption Talent" }],
      "10-11": [{ name: "+1 to Pseudopod Attacks and Damage" }],
    },
    items: [
      _weapon("Pseudopod", "icons/creatures/slimes/slime-movement-dripping-pseudopods-green.webp",
        { type: "melee", damage: { oneHanded: "d6", twoHanded: "d6" }, range: "near", properties: [_FINESSE, _THROWN] }),
    ],
    weaponNames: ["Club", "Crossbow", "Dagger", "Pseudopod", "Shortbow", "Shortsword", "Spear"],
    armorNames: ["Leather Armor", "Chainmail", "Shield"],
  },
};

/** Overlay for a parsed class unit, or null. */
export function overlayFor(className) {
  return CLASS_OVERLAYS[String(className ?? "").toLowerCase()] ?? null;
}
