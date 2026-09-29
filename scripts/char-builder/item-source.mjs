/**
 * Stamp a compendium link onto an item source object the builder is about to
 * embed. `doc.toObject()` + `createEmbeddedDocuments` leaves
 * `_stats.compendiumSource` null, so a built character carries no record of
 * which entry each talent, spell or gear row came from. Later hydration of an
 * existing actor reads this link first (then `flags.core.sourceId`, then name).
 *
 * Pure: plain data in, the same object out. Never overwrites an existing
 * source and does nothing without a uuid.
 *
 * @param {object|null} obj   item source data (mutated)
 * @param {string} [uuid]     the compendium document's uuid
 * @returns {object|null} `obj`
 */
export function stampSource(obj, uuid) {
  if (!obj || !uuid || obj._stats?.compendiumSource) return obj;
  obj._stats = { ...obj._stats, compendiumSource: uuid };
  return obj;
}
