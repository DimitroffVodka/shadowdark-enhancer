/**
 * Shadowdark Enhancer — Loot Setup slot manifest (data only).
 *
 * Defines which treasure tables the Loot Generator needs and how each binds.
 * METADATA ONLY: labels, page references, and a SYNTHETIC format example that
 * is our own invention. Ships NO Shadowdark table content.
 */
export const LOOT_SETUP_SLOTS = [
  { id: "treasure-0-3", tier: "0-3", label: "Treasure — Levels 0-3", pageRef: "Shadowdark Core Rulebook, p. 274",
    formatHint: "01 Rusty key (2cp)\n02-05 Cracked clay cup (5cp)\n54-55 Iron shield (20gp)" },
  { id: "treasure-4-6", tier: "4-6", label: "Treasure — Levels 4-6", pageRef: "Shadowdark Core Rulebook, p. 276",
    formatHint: "01 Tarnished silver ring (10gp)\n50-52 Engraved chalice (60gp)" },
  { id: "treasure-7-9", tier: "7-9", label: "Treasure — Levels 7-9", pageRef: "Shadowdark Core Rulebook, p. 278",
    formatHint: "01 Jeweled dagger (90gp)\n88-90 Gilded circlet (400gp)" },
  { id: "treasure-10", tier: "10+", label: "Treasure — Levels 10+", pageRef: "Shadowdark Core Rulebook, p. 280",
    formatHint: "01 Platinum idol (250gp)\n95-99 Flawless gemstone (1000gp)" },
];

/** Per-slot bound state from a lootTierTables map (pure). */
export function slotStatus(map = {}) {
  return LOOT_SETUP_SLOTS.map(s => ({ ...s, boundUuid: map[s.tier] || null, bound: Boolean(map[s.tier]) }));
}

/** Count of the manifest tiers that are bound (pure). */
export function boundCount(map = {}) {
  return LOOT_SETUP_SLOTS.filter(s => map[s.tier]).length;
}
