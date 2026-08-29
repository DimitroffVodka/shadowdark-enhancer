/**
 * Shadowdark Enhancer — Western Reaches mounts manifest.
 *
 * The WR Player's Guide pp.116-117 lists 15 mounts as standard statblocks.
 * Seven are WR-exclusive (not in the core system bestiary); the rest
 * (Camel, Elephant, Griffon, Hippogriff, Horse, Moose, Pegasus, Worg)
 * already ship in shadowdark.monsters and are omitted from the importable list.
 *
 * This manifest holds NAMES + SOURCE only — no stats are bundled.
 * Presence is checked against the sde-actors pack (Mount-type actors).
 */

export const MOUNT_SOURCE = { key: "WR", pages: "116-117", label: "Western Reaches" };

/** The 7 WR-exclusive mounts not in the core system bestiary. */
export const MOUNT_MANIFEST = [
  "Camel, Silver",
  "Donkey",
  "Horse, Prized",
  "Horse, War",
  "Pony",
  "Scrag",
  "Scrag, War",
].map((name) => ({ name, src: MOUNT_SOURCE.key, pages: MOUNT_SOURCE.pages }));

const _norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Every spelling one mount name can take. The manifest (and the book's MOUNTS
 * table) lists mounts index-style — "Horse, War" — while the statblock heading
 * above the stat line prints the name naturally, "WAR HORSE". Matching on the
 * literal string alone drops the statblock the GM asked for, which is how a
 * mount unlock ended up with nothing to create.
 */
function nameKeys(value) {
  const base = _norm(value);
  if (!base) return new Set();
  const keys = new Set([base, base.replace(/,/g, "").replace(/\s+/g, " ").trim()]);
  const parts = base.split(/\s*,\s*/).filter(Boolean);
  // "Horse, War" → "war horse"; "Camel, Silver" → "silver camel".
  if (parts.length > 1) keys.add([...parts.slice(1), parts[0]].join(" "));
  return keys;
}

/** Keep only the mount selected by a Manage-tree unlock from a full page grab. */
export function selectMountDrafts(parsed, selectedName) {
  const wanted = nameKeys(selectedName);
  if (!wanted.size) return [];
  return (parsed ?? []).filter((entry) =>
    [...nameKeys(entry?.draft?.name)].some((key) => wanted.has(key)));
}
