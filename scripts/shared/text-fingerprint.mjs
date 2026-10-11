/**
 * Shadowdark Enhancer — text fingerprints for book-owned wording. Pure.
 *
 * No book text ships in this module: the GM's own PDF supplies it at import
 * time. The three Cursed Scroll treasure tables still have to be RECOGNISED
 * when the importer hands their rows over, so the shipped data holds a hash of
 * each row's normalised text instead of the text, and the runtime hashes the
 * text it was given and looks that up. The hash is one-way: it answers "is this
 * row the one I expect" and cannot print the row.
 *
 * Exports:
 *   textFingerprint(text)  — 14-hex-digit cyrb53 of `curatedNameKey(text)`
 *   cleanBookText(text)    — quotes folded, whitespace collapsed, case KEPT
 *   bookItemName(text)     — `cleanBookText` with the first letter capitalised
 */
import { curatedNameKey } from "./curated-icons.mjs";

/**
 * cyrb53 (public domain, bryc): a 53-bit string hash, synchronous and identical
 * in a browser and in Node. Not cryptographic and not meant to be.
 *
 * @param {string} str
 * @returns {number}
 */
function cyrb53(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The stable fingerprint of a piece of text. It hashes the same normalisation
 * the curated icon maps use, so differences of case and spacing do not matter.
 *
 * @param {unknown} text
 * @returns {string} "" when there is no usable text
 */
export function textFingerprint(text) {
  const key = curatedNameKey(text);
  return key ? cyrb53(key).toString(16).padStart(14, "0") : "";
}

/**
 * The text as the GM's book printed it, tidied: curly quotes folded to ASCII
 * (as `curatedNameKey` does for its key) and whitespace collapsed. Case and
 * punctuation are untouched — this is what a minted Item is named from.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function cleanBookText(text) {
  return String(text ?? "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** An Item name from book text: tidied, first letter capitalised. */
export function bookItemName(text) {
  const name = cleanBookText(text);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
