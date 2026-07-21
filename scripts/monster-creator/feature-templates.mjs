/**
 * Shadowdark Enhancer — Feature Templates
 * Quick-pick catalog of common NPC features for the Monster Creator.
 *
 * Icons MUST be FA6 Free SOLID glyphs (the template renders them with
 * `class="fas"`). Pro-tier glyphs (fa-shield-magic, fa-heart-circle-bolt,
 * fa-flask-poison, etc.) and Brand glyphs (fa-wolf-pack-battalion —
 * needs `fab`, not `fas`) render as empty squares in Foundry, which
 * ships the Free + Solid set only.
 */

export const FEATURE_QUICK_PICKS = [
  {
    name: "Magic Resistance",
    description: "Advantage on saves against spells.",
    icon: "fa-shield-halved",   // fa-shield-magic is Pro
  },
  {
    name: "Mob",
    description: "Advantage on attacks if at least two other mooks are near the target.",
    icon: "fa-users",
  },
  {
    name: "Pack Tactics",
    description: "Advantage on attacks if an ally is within 5' of the target.",
    icon: "fa-paw",             // fa-wolf-pack-battalion is a Brand icon (needs fab)
  },
  {
    name: "Petrify",
    description: "DC 12 CON or turned to stone.",
    icon: "fa-gem",
  },
  {
    name: "Regenerate",
    description: "Regains 5 HP at the start of its turn if it has at least 1 HP.",
    icon: "fa-heart-pulse",     // fa-heart-circle-bolt is Pro
  },
  {
    name: "Brutal",
    description: "Adds an extra damage die on a critical hit.",
    icon: "fa-skull",
  },
  {
    name: "Ambush",
    description: "Advantage on initiative checks.",
    icon: "fa-user-ninja",
  },
  {
    name: "Keen Senses",
    description: "Advantage on perception checks.",
    icon: "fa-ear-listen",
  },
  {
    name: "Dodge",
    description: "Can use a reaction to add +2 to AC against one attack.",
    icon: "fa-person-running",
  },
  {
    name: "Burrow",
    description: "Can move through loose earth/sand at half speed.",
    icon: "fa-mound",
  },
  {
    name: "Blood Drain",
    description: "Attached; deals 1d4 damage each turn. DC 12 STR to remove.",
    icon: "fa-droplet",
  },
  {
    name: "Disease",
    description: "DC 12 CON or contracts a disease (1d4 days incubation).",
    icon: "fa-virus",
  },
  {
    name: "Poison",
    description: "DC 12 CON or 1d6 damage and poisoned for 1 hour.",
    icon: "fa-skull-crossbones", // fa-flask-poison is Pro; reuse the slug from 1e-iii
  },
  {
    name: "Undead",
    description: "Immune to sleep, charm, and poison.",
    icon: "fa-ghost",
  },
];
