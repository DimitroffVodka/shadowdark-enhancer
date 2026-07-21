/**
 * HTML-escape a string for safe interpolation into innerHTML.
 * Encodes & < > " '
 *
 * @param {*} s — coerced to string; null/undefined becomes empty string
 * @returns {string}
 */
export function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
