/**
 * Shadowdark Enhancer — Action Templates
 * Quick-pick catalog of common NPC attacks and special actions
 * for the Monster Creator.
 */

export const ACTION_QUICK_PICKS = [
  // ─── Basic Melee ──────────────────────────────────────────────────
  {
    name: "Fist",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d4",
    ranges: ["close"],
    description: "",
    icon: "fa-hand-fist",
  },
  {
    name: "Bite",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d6",
    ranges: ["close"],
    description: "",
    icon: "fa-tooth",
  },
  {
    name: "Claw",
    type: "NPC Attack",
    num: 2,
    bonus: 2,
    damage: "1d4",
    ranges: ["close"],
    description: "",
    icon: "fa-hand-back-fist",
  },
  {
    name: "Longsword",
    type: "NPC Attack",
    num: 1,
    bonus: 3,
    damage: "1d8",
    ranges: ["close"],
    description: "",
    icon: "fa-sword",
  },
  {
    name: "Greataxe",
    type: "NPC Attack",
    num: 1,
    bonus: 3,
    damage: "1d10",
    ranges: ["close"],
    description: "",
    icon: "fa-axe",
  },

  // ─── Basic Ranged ─────────────────────────────────────────────────
  {
    name: "Shortbow",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d6",
    ranges: ["near", "far"],
    description: "",
    icon: "fa-bow-arrow",
  },
  {
    name: "Sling",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d4",
    ranges: ["near"],
    description: "",
    icon: "fa-staff-snake", // closest icon for sling
  },
  {
    name: "Throwing Knife",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d4",
    ranges: ["near"],
    description: "",
    icon: "fa-dagger",
  },

  // ─── Special / Status ─────────────────────────────────────────────
  {
    name: "Gaze",
    type: "NPC Special Attack",
    description: "DC 12 CON or paralyzed 1d4 rounds.",
    icon: "fa-eye",
  },
  {
    name: "Breath Weapon",
    type: "NPC Special Attack",
    description: "Near. 3d6 fire (DC 12 DEX half).",
    icon: "fa-fire-breathing",
  },
  {
    name: "Poison",
    type: "NPC Special Attack",
    description: "DC 12 CON or die in 1d4 rounds.",
    icon: "fa-flask-poison",
  },
  {
    name: "Sting",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d4",
    ranges: ["close"],
    description: "plus DC 12 CON or paralyzed 1 hour.",
    icon: "fa-bug",
  },
];
