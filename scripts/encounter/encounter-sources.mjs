/**
 * Shadowdark Enhancer — Encounter sources core (pure, Foundry-free, node-testable).
 *
 * Single home for the `encounterSources` world setting's default and for the
 * compendium-id renames the Shadowdark system has made across major versions.
 * The setting default is sourced from here so the registration in settings.mjs
 * and the fallbacks in the two consumers (encounter-roller-app, the Monster
 * Creator's bestiary loader) can't drift apart — the same split as
 * crawl-state-core.mjs / party-xp-core.mjs.
 *
 * Why the rename map exists: Shadowdark 4.x renamed the bundled monster pack
 * `shadowdark.bestiary` → `shadowdark.monsters`. A world whose GM never touched
 * the Browse tab's source pills reads the registered default and is fixed by
 * changing it; a world whose GM DID toggle sources has a stored array still
 * naming the old pack, which now resolves to nothing. migrateEncounterSources
 * repairs those stored arrays.
 */

/** Sources a fresh world browses: its own NPC actors plus the system's monsters. */
export const DEFAULT_ENCOUNTER_SOURCES = Object.freeze(["world", "shadowdark.monsters"]);

/**
 * Compendium ids the Shadowdark system has renamed, old → new.
 * Add an entry here (and a case to the test) whenever the system renames a pack
 * the encounter browser can read from.
 */
export const SOURCE_ID_RENAMES = Object.freeze({
  // Shadowdark 4.x (verified against 4.0.6 / Foundry 14.365).
  "shadowdark.bestiary": "shadowdark.monsters",
});

/**
 * Rewrite a stored source list through SOURCE_ID_RENAMES.
 *
 * Order is preserved and ids are de-duplicated, so a list that already names
 * BOTH the old and the new pack collapses to one entry rather than listing the
 * new pack twice. An empty list is left empty — that's a GM who deliberately
 * deselected every source, not a broken value.
 *
 * @param {unknown} sources The stored setting value.
 * @returns {Array<string>|null} The migrated list, or `null` when nothing
 *   needed changing (so callers can skip a pointless settings write).
 */
export function migrateEncounterSources(sources) {
  if (!Array.isArray(sources)) return null;

  const out = [];
  for (const raw of sources) {
    if (typeof raw !== "string" || !raw) continue;
    const id = SOURCE_ID_RENAMES[raw] ?? raw;
    if (!out.includes(id)) out.push(id);
  }

  const unchanged = out.length === sources.length && out.every((id, i) => id === sources[i]);
  return unchanged ? null : out;
}
