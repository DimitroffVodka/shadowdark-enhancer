/**
 * Shadowdark Enhancer — the Hex Data window's tile picker, the pure part: what it lists for a terrain's pool.
 * The pictures are the Enhancer's own (tile-sets.mjs); the choice is kept on the drawn scene (hex-explorer-app.mjs).
 */

const decoded = (path) => { try { return decodeURIComponent(path); } catch { return String(path); } };

/** A tile file as a person would say it: ".../Hex - Salt Flat gen3.webp" is "Salt Flat gen3". */
export function tileName(path) {
  const file = decoded(path).split("/").pop() ?? "";
  return file.replace(/\.(webp|png|jpg|jpeg)$/i, "").replace(/^Hex\s*-\s*/i, "");
}

/**
 * The picker's options for one pool, the current tile marked. Two spellings of
 * one file (encoded or not) are the same tile.
 * @param {string[]} pool
 * @param {string|null} currentSrc
 * @returns {{src: string, name: string, current: boolean}[]}
 */
export function tileChoices(pool, currentSrc) {
  const now = currentSrc ? decoded(currentSrc) : null;
  return (pool ?? []).map((src) => ({ src, name: tileName(src), current: now !== null && decoded(src) === now }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
