/**
 * Shadowdark Enhancer — Action Templates
 * Quick-pick catalog of common NPC attacks and special actions
 * for the Monster Creator.
 *
 * Icons must be FontAwesome 6 FREE glyphs — Foundry doesn't ship the
 * Pro set, so Pro-only icons (e.g. fa-bow-arrow, fa-axe, fa-dagger,
 * fa-fire-breathing, fa-flask-poison) render as empty squares. Stuck
 * to free-tier glyphs throughout. fa-swords IS free in FA6.
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
    icon: "fa-hand-fist",     // fa-hand-back-fist is Pro; reuse free fa-hand-fist
  },
  {
    name: "Longsword",
    type: "NPC Attack",
    num: 1,
    bonus: 3,
    damage: "1d8",
    ranges: ["close"],
    description: "",
    icon: "fa-swords",        // free in FA6; we already use this elsewhere
  },
  {
    name: "Greataxe",
    type: "NPC Attack",
    num: 1,
    bonus: 3,
    damage: "1d10",
    ranges: ["close"],
    description: "",
    icon: "fa-khanda",        // free; closest "heavy weapon" glyph
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
    icon: "fa-crosshairs",    // free; we already use this for ranged in action menu
  },
  {
    name: "Sling",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d4",
    ranges: ["near"],
    description: "",
    icon: "fa-circle",        // free; small projectile / stone
  },
  {
    name: "Throwing Knife",
    type: "NPC Attack",
    num: 1,
    bonus: 2,
    damage: "1d4",
    ranges: ["near"],
    description: "",
    icon: "fa-location-arrow", // free; thrown / pointed shape
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
    icon: "fa-fire",          // free; was fa-fire-breathing (Pro)
  },
  {
    name: "Poison",
    type: "NPC Special Attack",
    description: "DC 12 CON or die in 1d4 rounds.",
    icon: "fa-skull-crossbones", // free; was fa-flask-poison (Pro)
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
