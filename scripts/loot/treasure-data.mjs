/**
 * Shadowdark Enhancer — Treasure band metadata.
 *
 * Level→tier band boundaries used by the Loot Generator's tier resolver
 * (tierForLevel / tableForLevel / tierForTable / levelForTier). METADATA ONLY —
 * this module ships NO treasure table content. The actual treasure tables are
 * GM-supplied RollTables loaded from the GM's own Shadowdark rules (via the
 * Roll Table Importer / Loot Setup) and bound per band in `lootTierTables`.
 */
export const TREASURE_TABLES = [
  { id: "0-3", min: 0,  max: 3,        label: "Treasure (Levels 0-3)" },
  { id: "4-6", min: 4,  max: 6,        label: "Treasure (Levels 4-6)" },
  { id: "7-9", min: 7,  max: 9,        label: "Treasure (Levels 7-9)" },
  { id: "10+", min: 10, max: Infinity, label: "Treasure (Levels 10+)" },
];
