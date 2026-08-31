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

/** Trailing sentence punctuation a book row carries but a name never does. */
const _TRAILING_PUNCT = /[\s.,;:!?]+$/;

/**
 * The text a row is resolved BY: price, "each" and sentence punctuation
 * removed, applied repeatedly until it stops changing.
 *
 * The loop is what makes the order of those strips irrelevant. `stripPrice`'s
 * price pattern is `$`-anchored, so it cannot see a price that something else
 * is sitting behind — `"Dagger (1 gp)."` and `"Dagger (1 gp) each"` both defeat
 * a single pass, and both are ordinary book wording. Running to a fixed point
 * resolves them at the EXACT tier instead of leaning on the alias fold.
 *
 * Match-only. `stripPrice` remains the name-shaped answer for fabrication.
 */
export function matchQuery(text) {
  let s = String(text ?? "");
  for (let pass = 0; pass < 4; pass += 1) {
    const before = s;
    s = stripPrice(s.replace(_TRAILING_PUNCT, ""));
    if (s === before) break;
  }
  return s.trim();
}

/** Words whose trailing `s` is part of the word, not a plural. */
const _NOT_PLURAL = /(?:ss|us|is|ous)$/;

/**
 * Every singular this word could plausibly be, itself included.
 *
 * A SET rather than one answer, because English does not have one: "axes" is
 * the plural of both "axe" and "ax", and the `(ch|sh|x|z|s)es → -2` rule that
 * correctly gives "torches" → "torch" gives "axes" → "ax" and loses the
 * installed `Axe`. Offering both and letting the index decide keeps the rule
 * simple; if a world really does own both spellings, they collide on lookup and
 * the ambiguity refusal — not the stemmer — is what protects the caller.
 */
function _singularCandidates(word) {
  const out = [word];
  if (word.length > 3 && !_NOT_PLURAL.test(word)) {
    if (word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
    if (/(?:ch|sh|x|z|s)es$/.test(word)) out.push(word.slice(0, -2));  // torches → torch
    if (word.endsWith("s")) out.push(word.slice(0, -1));               // axes → axe, daggers → dagger
  }
  return [...new Set(out)];
}

/**
 * The alias-tier keys: the same name with the decorations that carry no
 * identity folded away, once per plausible singular of its final word.
 *
 * Each fold is anchored — a LEADING article or count, a TRAILING parenthetical
 * or punctuation, the FINAL word's plural. None of them can shorten the phrase
 * to one of its interior words, which is the whole point: "unopened bottle of
 * exceptionally potent murgazi wine" folds to itself, never to "bottle".
 *
 * The trailing strips also run to a fixed point, so `"rope (60 ft)."` loses the
 * period, then the parenthetical, rather than only the one it reaches first.
 */
export function lootAliasKeys(text) {
  let s = curatedNameKey(text);
  if (!s) return [];
  s = s.replace(/^(?:an?|the)\s+/, "");         // "A dagger"     → "dagger"
  s = s.replace(/^\d+\s+/, "");                 // "2 daggers"    → "daggers"
  for (let pass = 0; pass < 4; pass += 1) {
    const before = s;
    s = s.replace(/[,;.:!?]+$/, "").replace(/\s*\([^)]*\)$/, "").trim();
    if (s === before) break;
  }
  if (!s) return [];
  const words = s.split(" ");
  const last = words[words.length - 1];
  return _singularCandidates(last).map((w) => [...words.slice(0, -1), w].join(" "));
}

/** The canonical alias key — the singular fold used by older callers. */
export function lootAliasKey(text) {
  const keys = lootAliasKeys(text);
  return keys[keys.length - 1] ?? "";
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
    // Under EVERY candidate, so the fold matches in both directions: a row
    // saying "Axes" finds the installed `Axe`, and a row saying "Axe" finds an
    // installed `Axes`. The exact tier still answers first when it can.
    for (const key of lootAliasKeys(name)) _push(alias, key, item);
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
  const query = matchQuery(text);
  const out = (status, extra = {}) => ({ status, query, ...extra });
  if (!query) return out(LOOT_MATCH.UNRESOLVED);

  const index = _isIndex(items) ? items : buildLootNameIndex(items);

  const exact = _distinct(index.exact.get(curatedNameKey(query)));
  if (exact.length === 1) {
    return out(LOOT_MATCH.EXACT, { uuid: exact[0].uuid, name: exact[0].name, matched: query });
  }
  if (exact.length > 1) return out(LOOT_MATCH.AMBIGUOUS, { candidates: exact.map(_summary) });

  // Every candidate fold, pooled: hits from different candidates are still one
  // answer when they name the same item, and two distinct items across the pool
  // are ambiguous exactly as they would be under one key.
  const alias = _distinct(lootAliasKeys(query).flatMap((k) => index.alias.get(k) ?? []));
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
