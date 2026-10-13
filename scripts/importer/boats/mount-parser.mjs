/**
 * Shadowdark Enhancer — mounts manifest.
 *
 * The WR Player's Guide pp.116-117 lists 15 mounts. Seven are WR-exclusive
 * (not in the core system bestiary) and import from the book. The other eight
 * (Camel, Elephant, Griffon, Hippogriff, Horse, Moose, Pegasus, Worg) already
 * ship in shadowdark.monsters, but as NPCs, and an NPC cannot be ridden on the
 * map, seated on the Riders tab or fed at camp. They are copied from that
 * bestiary as Mount actors (SYSTEM_MOUNTS), so no book is needed for them.
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

/**
 * The core-rulebook mounts, copied from the system bestiary rather than a book.
 * Spelled exactly as the `NPC` entries of the system's `shadowdark.monsters`
 * pack (checked against system 4.0.6 and the declared floor, release-3.6.2); a
 * name that drifts only shows at click time, as "not in the system's bestiary".
 */
export const SYSTEM_MOUNTS = ["Camel", "Elephant", "Griffon", "Hippogriff", "Horse", "Moose", "Pegasus", "Worg"];

/** Manage-tree `src` of a row that unlocks from the system bestiary (CHAR_SOURCES key). */
export const SYSTEM_MOUNT_SRC = "CORE";

/** Whether a Manage-tree row is a Mount that comes from the system bestiary, not a book page. */
export const isSystemMountEntry = (entry) => entry?.type === "Mount" && entry?.src === SYSTEM_MOUNT_SRC;

const _norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Every spelling one mount name can take. The manifest (and the book's MOUNTS
 * table) lists mounts index-style — "Horse, War" — while the statblock heading
 * above the stat line prints the name naturally, "WAR HORSE". Matching on the
 * literal string alone drops the statblock the GM asked for, which is how a
 * mount unlock ended up with nothing to create.
 *
 * Shared with the Manage-tree census (manage-tree.mjs), so a mount already in
 * the world under the book's heading reconciles against its manifest row rather
 * than sitting locked with an Import button it can never satisfy.
 */
export function mountNameKeys(value) {
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
  const wanted = mountNameKeys(selectedName);
  if (!wanted.size) return [];
  return (parsed ?? []).filter((entry) =>
    [...mountNameKeys(entry?.draft?.name)].some((key) => wanted.has(key)));
}

/**
 * Whether a pack entry already holds this creature: the same name and the same
 * actor type. An NPC of the same name is another actor (#286 review), and a
 * mount imported from a bestiary NPC must not stop the Mount actor (and its
 * sheet) from being made.
 */
export function alreadyImported(entry, { name, type }) {
  return (entry?.name ?? "").toLowerCase() === String(name ?? "").toLowerCase() && entry?.type === type;
}
