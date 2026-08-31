/**
 * Shadowdark Enhancer — precise loot-row → Item resolution (pure).
 *
 * A loot table row is prose, not a name: "Unopened bottle of exceptionally
 * potent Murgazi wine (25 gp)". The old resolver asked whether the row
 * CONTAINED any known item name as a word — `\b<name>s?\b` over the whole row,
 * longest candidate first — which is a containment test wearing a word-boundary
 * costume. Every generic container, material or body part in the system gear
 * pack is a landmine: that row resolved to the plain system `Bottle`
 * (`Compendium.shadowdark.gear.Item.bGrhQMkhE2qwjL4j`), and the GM's 25 gp
 * vintage became a 1 gp empty bottle (#58). "A flask of oil" → `Flask`,
 * "Bolt of fine silk" → `Bolt`, and so on: the failure is systematic, not a
 * single unlucky row.
 *
 * The replacement resolves the row AS A NAME, in two tiers, and refuses
 * everything else:
 *
 * | Tier    | Rule                                                              |
 * |---------|-------------------------------------------------------------------|
 * | `exact` | the priced row, stripped, IS the item's name (case/spacing folded) |
 * | `alias` | it is that name modulo a leading article or count, a trailing      |
 * |         | parenthetical, and the plural of its final word                    |
 *
 * Anything else is `unresolved`. A row that lands on more than one distinct
 * item at the same tier is `ambiguous` and also resolves to nothing — two
 * plausible answers is not a confident match, and picking one by index order
 * would be the containment bug again with extra steps.
 *
 * This trades recall for precision DELIBERATELY, and the program plan says so:
 * D4/D5 accept "an explicit unresolved case" and put "loose generic-name
 * fallback" out of scope. An unresolved row keeps its text and can be
 * fabricated or linked by hand; a false positive silently hands the player the
 * wrong object and looks like it worked.
 *
 * Foundry-free and node-testable: every export takes plain objects.
 *
 * Exports:
 *   LOOT_MATCH                     — the four outcomes
 *   stripPrice(text)               — drop a trailing `(N gp)` / `each`
 *   lootNameKey(text)              — the exact-tier key
 *   lootAliasKey(text)             — the alias-tier key
 *   buildLootNameIndex(items)      — both keyed lookups, built once
 *   resolveLootItem(text, items)   — the whole decision, with a reason
 */
import { curatedNameKey } from "../shared/curated-icons.mjs";

/** The four outcomes of resolving one row. Only the first two are a link. */
export const LOOT_MATCH = Object.freeze({
  EXACT: "exact",
  ALIAS: "alias",
  AMBIGUOUS: "ambiguous",
  UNRESOLVED: "unresolved",
});

/** The outcomes that name a real item. */
const RESOLVED = new Set([LOOT_MATCH.EXACT, LOOT_MATCH.ALIAS]);

/**
 * Remove the trailing `(… gp …)` price suffix and a trailing "each".
 *
 * Byte-identical to the version this file took over from `loot-pack.mjs`, which
 * still re-exports it: the result is used as a fabricated Item's NAME, so it
 * must not acquire any of the folding below.
 */
export function stripPrice(text) {
  return String(text ?? "")
    .replace(/\s*\([^)]*\b\d+\s*(?:gp|sp|cp)\b[^)]*\)\s*$/i, "")
    .replace(/\s+each$/i, "")
    .trim();
}

/**
 * The exact-tier key: this module's ONE name vocabulary, shared with the
 * curated-icon resolver rather than forked into a third spelling of "lowercase
 * and collapse spaces".
 */
export { curatedNameKey as lootNameKey };

/** Words whose trailing `s` is part of the word, not a plural. */
const _NOT_PLURAL = /(?:ss|us|is|ous)$/;

/** Singular of ONE word. Deliberately small: English, not a stemmer. */
function _singularizeWord(word) {
  if (word.length <= 3 || _NOT_PLURAL.test(word)) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z|s)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/**
 * The alias-tier key: the same name with the decorations that carry no
 * identity folded away.
 *
 * Each fold is anchored — a LEADING article or count, a TRAILING parenthetical
 * or comma, the FINAL word's plural. None of them can shorten the phrase to one
 * of its interior words, which is the whole point: "unopened bottle of
 * exceptionally potent murgazi wine" folds to itself, never to "bottle".
 */
export function lootAliasKey(text) {
  let s = curatedNameKey(text);
  if (!s) return "";
  s = s.replace(/^(?:an?|the)\s+/, "");        // "A dagger"      → "dagger"
  s = s.replace(/^\d+\s+/, "");                 // "2 daggers"     → "daggers"
  s = s.replace(/\s*\([^)]*\)$/, "").trim();    // "rope (60 ft)"  → "rope"
  s = s.replace(/[,;.]+$/, "").trim();
  if (!s) return "";
  const words = s.split(" ");
  words[words.length - 1] = _singularizeWord(words[words.length - 1]);
  return words.join(" ");
}

function _push(map, key, entry) {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}

/** Distinct items in a bucket — the same uuid reached twice is one answer. */
function _distinct(bucket) {
  if (!bucket?.length) return [];
  const byUuid = new Map();
  for (const entry of bucket) if (!byUuid.has(entry.uuid)) byUuid.set(entry.uuid, entry);
  return [...byUuid.values()];
}

/**
 * Both keyed lookups for a candidate list, built once.
 *
 * Ambiguity is REACHABLE here even though `buildItemIndex` dedupes by
 * lowercased name: the alias fold is looser than that dedupe, so "Bolt" and
 * "Bolts", or a curly and a straight apostrophe, arrive as two entries and
 * collapse to one key. That collision is exactly what the `ambiguous` outcome
 * exists to refuse.
 *
 * @param {Array<{uuid:string,name:string}>} items
 * @returns {{exact: Map<string,object[]>, alias: Map<string,object[]>}}
 */
export function buildLootNameIndex(items) {
  const exact = new Map();
  const alias = new Map();
  for (const item of items ?? []) {
    const name = item?.name ?? "";
    _push(exact, curatedNameKey(name), item);
    _push(alias, lootAliasKey(name), item);
  }
  return { exact, alias };
}

const _isIndex = (v) => !!v && v.exact instanceof Map && v.alias instanceof Map;

/**
 * Resolve one loot row's text to a candidate Item.
 *
 * @param {string} text  the row's result text (book wording + price)
 * @param {Array<{uuid,name}>|{exact:Map,alias:Map}} items  candidates, or a
 *   prebuilt index from `buildLootNameIndex` when resolving many rows
 * @returns {{status:string, uuid?:string, name?:string, matched?:string,
 *            query:string, candidates?:Array<{uuid,name}>}}
 */
export function resolveLootItem(text, items) {
  const query = stripPrice(text);
  const out = (status, extra = {}) => ({ status, query, ...extra });
  if (!query) return out(LOOT_MATCH.UNRESOLVED);

  const index = _isIndex(items) ? items : buildLootNameIndex(items);

  const exact = _distinct(index.exact.get(curatedNameKey(query)));
  if (exact.length === 1) {
    return out(LOOT_MATCH.EXACT, { uuid: exact[0].uuid, name: exact[0].name, matched: query });
  }
  if (exact.length > 1) return out(LOOT_MATCH.AMBIGUOUS, { candidates: exact.map(_summary) });

  const alias = _distinct(index.alias.get(lootAliasKey(query)));
  if (alias.length === 1) {
    return out(LOOT_MATCH.ALIAS, { uuid: alias[0].uuid, name: alias[0].name, matched: query });
  }
  if (alias.length > 1) return out(LOOT_MATCH.AMBIGUOUS, { candidates: alias.map(_summary) });

  return out(LOOT_MATCH.UNRESOLVED);
}

const _summary = (e) => ({ uuid: e.uuid, name: e.name });

/** True when a `resolveLootItem` result names a real item. */
export function isResolvedLootMatch(result) {
  return RESOLVED.has(result?.status);
}
