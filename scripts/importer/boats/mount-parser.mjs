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

/** Keep only the mount selected by a Manage-tree unlock from a full page grab. */
export function selectMountDrafts(parsed, selectedName) {
  const norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const wanted = norm(selectedName);
  if (!wanted) return [];
  return (parsed ?? []).filter((entry) => norm(entry?.draft?.name) === wanted);
}
