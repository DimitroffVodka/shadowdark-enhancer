/**
 * Shadowdark Enhancer — clipboard helper.
 *
 * `navigator.clipboard` is undefined on insecure origins (plain-HTTP LAN
 * Foundry installs), so the write must fall back to a hidden <textarea> +
 * `document.execCommand("copy")`. Never throws: callers surface a failure
 * via `ui.notifications` when this returns false.
 *
 * @param {string} text — plain text to copy
 * @returns {Promise<boolean>} true if the text reached the clipboard
 */
export async function copyText(text) {
  // Preferred path: the async Clipboard API, when the browser exposes it.
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or similar — fall through to the legacy path.
    }
  }

  // Fallback: a visually-hidden textarea selected for a synchronous
  // execCommand copy. Removed from the DOM even if select/copy throws, and
  // focus is handed back so a user copying mid-typing keeps their cursor.
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    const previouslyFocused = document.activeElement;
    try {
      textarea.select();
      return document.execCommand("copy");
    } finally {
      textarea.remove();
      // Restore focus unless it moved on (null or no longer in the document).
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    }
  } catch {
    return false;
  }
}
