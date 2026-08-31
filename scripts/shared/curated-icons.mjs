/**
 * Shadowdark Enhancer — the one curated-icon resolver (A4). Pure.
 *
 * Six issue paths want the same thing: a reviewed Foundry-native icon for an
 * item this module imported or generated. Before A4 each of them would have
 * grown its own name-matching, and the module already has one such resolver per
 * content type (`core-monster-spell-icons.mjs` for Monster Spells) to show what
 * that costs. This module is the generic version of that precedent: ONE
 * mechanism, four data maps, two key spaces, no per-issue lookup logic.
 *
 * ── Two key spaces, and why the split is structural ──────────────────────────
 *
 * Weapons, Armor and Basic Gear are keyed by NAME ALONE:
 *
 *     normalize(finalDocument.name)                    → "bastard sword"
 *
 * Treasure is keyed by name QUALIFIED BY BOOK:
 *
 *     `${sourceKey(source)}:${normalize(name)}`         → "cs3:a golden skull…"
 *
 * That is not a stylistic choice. `buildItemData(draft)` — this module's single
 * item-construction choke point — structurally CANNOT know which book a draft
 * came from: the source is a commit-time batch option threaded through
 * `createItems(drafts, {source})`, and it reaches the document only afterwards
 * as `flags[MODULE_ID].source`. So a gear key that needed the book would be
 * unresolvable at the only place gear art is decided. Gear names are globally
 * distinct across every supported book (N3 verifies this), so one mapping
 * legitimately applies to every imported copy regardless of which book prints
 * it.
 *
 * Treasure has the opposite shape. Its items are minted by materializers that
 * know exactly which table they are draining, and its names are prose lifted
 * from a book ("Cracked mirror", "Vial of poison") — generic enough that two
 * Cursed Scrolls could easily print the same phrase for different objects.
 * Qualifying by source is cheap there and forward-proof.
 *
 * ── Semantic category before broad fallback ──────────────────────────────────
 *
 * The curated maps ARE the semantic-category layer: every entry was chosen by
 * searching the matching `icons/weapons/…`, `icons/equipment/…`,
 * `icons/sundries/…` folder first, and each accepted fallback is documented in
 * N3. So the runtime order is simply: curated map (semantic) → caller's
 * existing broad fallback (`pickTreasureIcon`'s keyword chain, or the type
 * default). This module never scans the filesystem; it is Foundry-free and
 * node-testable, and a curated pick is a reviewed constant, not a search.
 *
 * ── Unmatched degrades, it does not fail ─────────────────────────────────────
 *
 * `resolveCuratedIcon` returns `null` for anything it does not have a reviewed
 * pick for. Null means "I have no opinion" — the caller keeps whatever art it
 * already had. There is no guessing tier here on purpose: a wrong curated icon
 * is worse than a generic one, because it looks deliberate.
 *
 * ── Keys are DERIVED, never hand-written ─────────────────────────────────────
 *
 * A map row is `"Display Name": "icons/…webp"`. The lookup key is computed from
 * the display name by `curatedNameKey`, at load. Hand-maintaining a second
 * normalized column alongside the name is how the source spec drifted (one of
 * its 154 rows carries `…St. Terragnis…` un-lowercased), and a data shape that
 * makes that mistake unrepresentable is worth more than a test that catches it.
 *
 * ── Drift is recorded, not thrown ────────────────────────────────────────────
 *
 * Map construction is TOTAL. A duplicate key, a blank name or a path that is
 * not a native `icons/**.webp` never throws — the offending row is dropped and
 * written to `problems`, which `auditCuratedIconRegistry` aggregates. The audit
 * can additionally check accepted paths through a caller-injected existence
 * predicate; D1-D6's category gates supply that predicate from the real Foundry
 * icon inventory. Throwing at module load would take the whole module down over
 * an icon; dropping the row degrades exactly one item to its fallback while
 * leaving the failure visible and mechanically checkable.
 *
 * Exports:
 *   CURATED_KEY_SPACES
 *   curatedNameKey(name)                  — the one normalization
 *   curatedSourcedKey(source, name)       — `<sourceId>:<name>`
 *   defineCuratedIconMap(label, rows, o)  — validate + freeze one N3 map
 *   registerCuratedIconMap(label, rows, o)— define + publish it to the registry
 *   curatedIconRegistry()                 — the live registry (memoized)
 *   buildCuratedIconRegistry(maps)        — merge maps into the two key spaces
 *   EMPTY_CURATED_ICON_REGISTRY
 *   resolveCuratedIcon(query, registry)   — the lookup; null when unmatched
 *   curatedArtFor(query, registry)        — lookup + its A3 provenance state
 *   isCuratedApplyTarget(packCollection)  — the base-system write guard
 *   auditCuratedIconRegistry(registry, o) — coverage/drift report
 */
import { sourceKey } from "./source-keys.mjs";
import { ART_STATES } from "./art-provenance.mjs";

/** The two key spaces. A map declares which one it populates. */
export const CURATED_KEY_SPACES = Object.freeze({
  /** `<name>` — Weapons, Armor, Basic Gear. Source-agnostic by contract. */
  BARE: "bare",
  /** `<sourceId>:<name>` — Treasure and plunder. */
  SOURCED: "sourced",
});

const SPACES = new Set(Object.values(CURATED_KEY_SPACES));

/**
 * A reviewed curated path is a native Foundry `icons/…webp`.
 *
 * This is the syntactic half of N3's curation rule. The registry audit enforces
 * actual existence when its consumer supplies the real Foundry icon inventory
 * as `pathExists`; keeping that dependency outside this module is what leaves
 * the resolver pure and Node-testable. A syntactically invalid row is dropped —
 * a broken image on the GM's sheet is worse than the generic icon it would
 * otherwise have kept.
 */
const CURATED_PATH_RE = /^icons\/[^\s]+\.webp$/;

/**
 * The lookup key for an item name.
 *
 * Case-folded, whitespace-collapsed, trimmed — and nothing else. Punctuation is
 * SIGNIFICANT and deliberately preserved: `Rope, 60'`, `Miner's putty, jar` and
 * `Thieves' Tools` are real distinct names, and stripping their commas and
 * apostrophes would collide names the maps need to tell apart. Parenthesised
 * quantities are likewise kept, because the maps carry `Arrows` and
 * `Arrows (20)` as separate rows that happen to share art.
 *
 * Curly quotes are folded to ASCII. The PDF pipeline already does this
 * (`pdf-text-utils` normalizes `‘’‚′` before parsing), but a name can also
 * arrive from a GM's hand-pasted text that never passed through it, and a
 * possessive gear name silently missing its curated icon is an unpleasant way
 * to discover that.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`: these keys are matched against
 * committed ASCII constants, and a Turkish locale lowercasing `I` to `ı` would
 * make the same map miss on one GM's machine and hit on another.
 *
 * @param {unknown} name
 * @returns {string} "" when there is no usable name
 */
export function curatedNameKey(name) {
  return String(name ?? "")
    .replace(/[‘’‚′]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The source-qualified key for a treasure name.
 *
 * The book passes through `sourceKey`, so every spelling the codebase and the
 * GM's Source box use — "CS3", "Cursed Scroll #3", "Midnight Sun" — lands on
 * the same `cs3`, and both Western Reaches guides collapse to `wr`. That is the
 * module's existing canonical vocabulary; A4 does not add a fifth one.
 *
 * @param {unknown} source  any spelling of a book
 * @param {unknown} name
 * @returns {string} "" when either half is missing
 */
export function curatedSourcedKey(source, name) {
  const src = sourceKey(source);
  const key = curatedNameKey(name);
  return src && key ? `${src}:${key}` : "";
}

/** A dropped row and why, for the audit. */
function _problem(map, kind, detail) {
  return { map, kind, detail };
}

/**
 * Validate and freeze one N3 map.
 *
 * Bare-space rows are `{ "Display Name": "icons/…webp" }`. Sourced-space rows
 * are nested by book: `{ cs3: { "Display Name": "icons/…webp" } }` — the
 * qualification is structural in the data rather than a `"cs3:…"` string
 * convention a future editor could forget to follow.
 *
 * Duplicates resolve FIRST-WINS, matching the dedup direction `LootLinker` and
 * the pack index already use, and the loser is recorded. Deterministic beats
 * clever: two rows claiming one key is a data bug either way, and the audit is
 * where it gets fixed.
 *
 * @param {string} label   the map's name, for problem reports
 * @param {object} rows    the data, shaped per `space`
 * @param {{space?: string}} [opts]
 * @returns {{label: string, space: string, entries: Map<string,string>, problems: Array}}
 */
export function defineCuratedIconMap(label, rows, { space = CURATED_KEY_SPACES.BARE } = {}) {
  const name = String(label ?? "unnamed");
  const entries = new Map();
  const problems = [];

  if (!SPACES.has(space)) {
    problems.push(_problem(name, "unknown-space", String(space)));
    return Object.freeze({ label: name, space: CURATED_KEY_SPACES.BARE, entries, problems: Object.freeze(problems) });
  }

  const add = (key, displayName, img, sourceLabel = "") => {
    const path = String(img ?? "").trim();
    if (!key) {
      problems.push(_problem(name, "unusable-name", `${sourceLabel}${JSON.stringify(displayName)}`));
      return;
    }
    if (!CURATED_PATH_RE.test(path)) {
      problems.push(_problem(name, "malformed-path", `${key} → ${JSON.stringify(path)}`));
      return;
    }
    if (entries.has(key)) {
      problems.push(_problem(name, "duplicate-key", `${key} (kept ${entries.get(key)}, dropped ${path})`));
      return;
    }
    entries.set(key, path);
  };

  if (space === CURATED_KEY_SPACES.BARE) {
    for (const [displayName, img] of Object.entries(rows ?? {})) {
      add(curatedNameKey(displayName), displayName, img);
    }
  } else {
    for (const [book, group] of Object.entries(rows ?? {})) {
      const src = sourceKey(book);
      if (!src) {
        problems.push(_problem(name, "unusable-source", JSON.stringify(book)));
        continue;
      }
      for (const [displayName, img] of Object.entries(group ?? {})) {
        add(curatedSourcedKey(book, displayName), displayName, img, `${src}:`);
      }
    }
  }

  return Object.freeze({ label: name, space, entries, problems: Object.freeze(problems) });
}

/**
 * Merge maps into the two key spaces the resolver reads.
 *
 * This is where the "gear names are globally distinct" contract is actually
 * enforced: the bare space is shared by the weapon, armor and gear maps, so a
 * name claimed by two of them is a cross-map `duplicate-key` problem here even
 * though neither map is internally inconsistent. That check is the whole reason
 * the three bare maps merge into one space instead of being consulted in turn.
 *
 * @param {Array<ReturnType<typeof defineCuratedIconMap>>} maps
 * @returns {{bare: Map<string,string>, sourced: Map<string,string>, maps: Array, problems: Array}}
 */
export function buildCuratedIconRegistry(maps = []) {
  const bare = new Map();
  const sourced = new Map();
  const problems = [];
  const used = [];

  for (const map of maps) {
    if (!map?.entries) continue;
    used.push(map);
    problems.push(...(map.problems ?? []));
    const target = map.space === CURATED_KEY_SPACES.SOURCED ? sourced : bare;
    for (const [key, img] of map.entries) {
      if (target.has(key)) {
        problems.push(_problem(map.label, "duplicate-key", `${key} (kept ${target.get(key)}, dropped ${img})`));
        continue;
      }
      target.set(key, img);
    }
  }

  return Object.freeze({ bare, sourced, maps: Object.freeze(used), problems: Object.freeze(problems) });
}

/**
 * The registry with no maps loaded.
 *
 * This resolver ships the mechanism and ZERO reviewed rows. Each consuming
 * ticket owns exactly one map — weapons, armor, basic gear, and one per
 * treasure table — so the data arrives with the work that needs it and no two
 * tickets edit the same data file.
 *
 * An empty registry is fully functional and completely inert: every lookup
 * returns `null`, every caller keeps the fallback art it would have chosen
 * anyway, and no image or provenance classification changes anywhere in the
 * module. That is the same behaviour a name the maps do not cover must produce,
 * so "no maps yet" needs no special case.
 */
export const EMPTY_CURATED_ICON_REGISTRY = buildCuratedIconRegistry([]);

// ─── Discovery-based registration ────────────────────────────────────────────

/**
 * Maps published by data modules, in registration order.
 *
 * A shared ARRAY LITERAL listing every map would put six tickets into one file
 * and one merge conflict. Instead each data module publishes itself by calling
 * `registerCuratedIconMap` at import time, and the only shared file is the
 * side-effect index next door (`curated-icon-maps/index.mjs`), where a ticket
 * appends a single `import` line that never touches another ticket's line.
 */
const _registered = [];

/** Memoized merge of `_registered`; dropped whenever a map registers. */
let _live = null;

/**
 * Define a map and publish it to the live registry.
 *
 * Called at module scope by each data module, so importing the data module IS
 * the registration. Returns the frozen map so a data module can export it for
 * its own focused tests without reaching back into the registry.
 *
 * @param {string} label
 * @param {object} rows
 * @param {{space?: string}} [opts]
 * @returns {ReturnType<typeof defineCuratedIconMap>}
 */
export function registerCuratedIconMap(label, rows, opts) {
  const map = defineCuratedIconMap(label, rows, opts);
  _registered.push(map);
  _live = null;
  return map;
}

/**
 * The live registry, merged from every registered map.
 *
 * Memoized because it is consulted on every item build and the inputs are
 * frozen module-scope constants that only change when a data module is
 * imported.
 *
 * @returns {ReturnType<typeof buildCuratedIconRegistry>}
 */
export function curatedIconRegistry() {
  return (_live ??= buildCuratedIconRegistry(_registered));
}

/**
 * Drop every registered map. Test-only — a registry assembled by import side
 * effects is otherwise impossible to isolate between cases.
 */
export function _resetCuratedIconMaps() {
  _registered.length = 0;
  _live = null;
}

/**
 * The reviewed icon for an item, or `null`.
 *
 * A source is consulted only when the caller supplies one, and the qualified
 * space is tried FIRST: a book-specific pick is more specific than a global
 * one, so it should win any future overlap. The two spaces do not currently
 * intersect at all, so this order is a forward guarantee rather than a live
 * tie-break.
 *
 * Callers that cannot know the book (the generic item-construction choke point)
 * simply omit `source` and get the bare space, which is the space designed for
 * them.
 *
 * @param {{name?: unknown, source?: unknown}} query
 * @param {ReturnType<typeof buildCuratedIconRegistry>} [registry]
 * @returns {string|null}
 */
export function resolveCuratedIcon({ name, source } = {}, registry = curatedIconRegistry()) {
  const key = curatedNameKey(name);
  if (!key) return null;

  if (String(source ?? "").trim()) {
    const qualified = registry.sourced?.get(curatedSourcedKey(source, name));
    if (qualified) return qualified;
  }
  return registry.bare?.get(key) ?? null;
}

/**
 * The curated pick together with the A3 provenance state it must be stamped
 * with, or `null` when there is no reviewed pick.
 *
 * Both halves come back together on purpose. A3 preserves GM art by comparing a
 * stored image against a recorded witness, so an image written WITHOUT its
 * `curated` stamp is indistinguishable from art a human chose — it would be
 * frozen as `custom` on the next import and could never be upgraded again. A
 * caller that can only get the path from this module cannot make that mistake.
 *
 * @param {{name?: unknown, source?: unknown}} query
 * @param {ReturnType<typeof buildCuratedIconRegistry>} [registry]
 * @returns {{img: string, artState: string}|null}
 */
export function curatedArtFor(query, registry = curatedIconRegistry()) {
  const img = resolveCuratedIcon(query, registry);
  return img ? { img, artState: ART_STATES.CURATED } : null;
}

/**
 * May curated art be written into this pack?
 *
 * An ALLOWLIST, not a denylist of known system packs. Curated art applies only
 * to copies this module imported or generated, and those live in world
 * compendiums — the managed suite packs are all `world.…`. Everything else is
 * refused: `shadowdark.gear` and `shadowdark.magic-items` obviously, but also
 * any other system or module pack a future consumer might reach.
 *
 * The risk this guards is real and specific. `LootLinker` resolves table rows
 * system-pack-first BY DESIGN, so a plunder row's resolved uuid routinely
 * points into `shadowdark.gear`; nothing writes back today, but a materializer
 * that applies art to whatever it just resolved is one update call away from
 * editing the base system compendium in the GM's install. The base-system
 * items that share names with curated entries — `Basilisk Egg`, `Holy Symbol`,
 * `Crawling Kit`, the obsidian weapons — are exactly the ones a name-keyed
 * resolver would otherwise happily match.
 *
 * This is a WIDER boundary than `MANAGED_ITEMS_PACK` in art-provenance, and
 * deliberately so: that one marks where generated artifacts are replace-always
 * (one exact pack), this one marks where curated art may be written at all
 * (any world pack this module owns content in).
 *
 * @param {unknown} packCollection  a pack's `collection` id
 * @returns {boolean}
 */
export function isCuratedApplyTarget(packCollection) {
  return String(packCollection ?? "").trim().startsWith("world.");
}

/**
 * Coverage and drift report for a registry.
 *
 * `problems` empty is the contract. Structural problems are carried from map
 * construction; when `pathExists` is supplied, every accepted syntactically
 * valid row is also checked and a missing asset becomes a stable `missing-path`
 * problem. The resolver never performs I/O itself, so D1-D6's owned-category
 * tests MUST inject a synchronous predicate backed by the real Foundry icon
 * inventory while separately asserting their exact census and expected names.
 * Omitting it deliberately leaves the report structural-only for callers that
 * do not own an asset inventory.
 *
 * `crossSpaceNames` is informational, NOT a problem: a treasure name that also
 * exists as gear resolves correctly (qualified wins), and counting them is how
 * a future overlap gets noticed rather than feared.
 *
 * @param {ReturnType<typeof buildCuratedIconRegistry>} [registry]
 * @param {{pathExists?: (path: string) => boolean}} [opts]
 * @returns {{total: number, bare: number, sourced: number, perMap: object[], problems: Array, crossSpaceNames: string[]}}
 */
export function auditCuratedIconRegistry(registry = curatedIconRegistry(), { pathExists } = {}) {
  const bare = registry.bare ?? new Map();
  const sourced = registry.sourced ?? new Map();
  const problems = [...(registry.problems ?? [])];

  if (typeof pathExists === "function") {
    // Walk the maps in merge order and check only each space's accepted winner.
    // A cross-map duplicate already has its own problem and is not a live row.
    const accepted = {
      [CURATED_KEY_SPACES.BARE]: new Set(),
      [CURATED_KEY_SPACES.SOURCED]: new Set(),
    };
    for (const map of registry.maps ?? []) {
      const seen = accepted[map.space] ?? accepted[CURATED_KEY_SPACES.BARE];
      for (const [key, path] of map.entries ?? []) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (!pathExists(path)) {
          problems.push(_problem(map.label, "missing-path", `${key} → ${JSON.stringify(path)}`));
        }
      }
    }
  }

  // Deduped: the same name qualified by three books is ONE name that overlaps
  // the bare space, not three findings.
  const crossSpace = new Set();
  for (const key of sourced.keys()) {
    const bareHalf = key.slice(key.indexOf(":") + 1);
    if (bare.has(bareHalf)) crossSpace.add(bareHalf);
  }
  const crossSpaceNames = [...crossSpace];

  return {
    total: bare.size + sourced.size,
    bare: bare.size,
    sourced: sourced.size,
    perMap: (registry.maps ?? []).map((m) => ({ label: m.label, space: m.space, entries: m.entries.size })),
    problems,
    crossSpaceNames,
  };
}
