/**
 * Shadowdark Enhancer — one string from `languages/en.json`.
 *
 * Every user-facing string comes from en.json (#169), and most files want the
 * same two-way helper: localize a key, or format it when there is data to put
 * in. Before Foundry's i18n is mounted (and in node tests) it returns the key
 * itself rather than throwing.
 */

/**
 * @param {string} key   an `SDE.*` (or system) key
 * @param {object} [data] placeholder values; when present the key is formatted
 * @returns {string}
 */
export const L = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};
