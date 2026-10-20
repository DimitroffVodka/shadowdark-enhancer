/**
 * Shadowdark Enhancer — Merchant: the names of weapon properties (Finesse, Thrown...) for the shop windows.
 *
 * The system keeps a weapon's properties as compendium links; a ware's facts need their names. One cache,
 * filled by `loadPropertyNames`, read synchronously by `propName`.
 */

import { wareFacts, plainText } from "../town/town-view.mjs";

const cache = new Map();

/** The name of a property link read so far, or "" (not read yet, or it could not be read). */
export const propName = (link) => cache.get(link) ?? "";

/** Read the names of the properties of these items (plain objects or documents) that are not read yet. */
export async function loadPropertyNames(items, fromUuidFn = (link) => fromUuid(link)) {
  const todo = [...new Set(items.flatMap((i) => i?.system?.properties ?? []))].filter((link) => typeof link === "string" && !cache.has(link));
  await Promise.all(todo.map(async (link) => {
    const doc = await (async () => fromUuidFn(link))().catch(() => null);
    cache.set(link, doc?.name ?? "");   // an unreadable link is remembered, not fetched again on every redraw
  }));
}

/** A ware's fact chips and its short description, for a row of a shop window. */
export function factsOf(item, t, max = 110) {
  return { facts: wareFacts(item, { t, propName }), blurb: plainText(item?.system?.description, max) };
}

/** Forget what was read (tests). */
export const clearPropertyNames = () => cache.clear();
