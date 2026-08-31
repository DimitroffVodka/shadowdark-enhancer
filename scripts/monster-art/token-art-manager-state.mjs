/**
 * Normalize the persisted Token Art Manager state at every boundary.
 *
 * The setting started life as `{ priority, overrides, picks }`. Keep that
 * shape usable for existing worlds while adding the optional named Browse
 * folders. The top-level spread is intentional: a future version may add a
 * field we do not know about yet, and a read/write round-trip must not erase
 * it. Folder records get the same treatment so a future folder-level field
 * can survive an older manager opening the setting.
 */

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Return a safe, detached Token Art Manager setting value.
 *
 * Invalid known fields fall back to their empty shape. Invalid folder records
 * are ignored; a folder needs both a non-blank label and a non-blank path to
 * be useful to the Browse catalog. Paths are deliberately not probed here —
 * normalization is pure and missing/unreadable folders are handled locally by
 * the catalog/UI boundary.
 *
 * @param {unknown} value persisted setting value
 * @returns {object} normalized state
 */
export function normalizeTokenArtManagerState(value) {
  const raw = isRecord(value) ? value : {};
  const folders = Array.isArray(raw.folders)
    ? raw.folders.flatMap((folder) => {
      if (!isRecord(folder)) return [];
      const label = typeof folder.label === "string" ? folder.label.trim() : "";
      const path = typeof folder.path === "string" ? folder.path.trim() : "";
      if (!label || !path) return [];
      return [{ ...folder, label, path }];
    })
    : [];
  return {
    ...raw,
    priority: Array.isArray(raw.priority) ? [...raw.priority] : [],
    overrides: isRecord(raw.overrides) ? { ...raw.overrides } : {},
    picks: isRecord(raw.picks) ? { ...raw.picks } : {},
    folders,
  };
}

/**
 * Stable source id for a named manual Browse folder. Labels can be edited
 * without invalidating a saved hand-pick; changing the path intentionally
 * creates a new source while the pick's concrete token path remains intact.
 *
 * @param {{path:string}} folder normalized folder record
 * @returns {string} internal Browse source id
 */
export function tokenArtFolderSourceId(folder) {
  return `manual-folder:${folder.path}`;
}
