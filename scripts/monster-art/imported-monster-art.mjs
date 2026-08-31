/**
 * Curated art for the managed imported-monster census (F4/#87).
 *
 * The book/source half of a monster identity is deliberately separate from the
 * art-provider half.  The former is the N6 `SRC:normalizedName` key; the latter
 * is the installed module or system that owns the reviewed file.  Keeping both
 * in each row makes it impossible for a bare-name lookup to decide which
 * imported copy should receive an image.
 *
 * This module is Foundry-free.  It owns the reviewed constants and the pure
 * state transition used by Token Art Manager.  The Foundry adapter supplies an
 * exact-path resolver so a missing installed source degrades to Browse rather
 * than turning into an invented or fuzzy suggestion.
 */
import { sourceKey } from "../shared/source-keys.mjs";

/** The marker carried by a manager pick made by this curated map. */
export const CURATED_IMPORTED_MONSTER_ART_ORIGIN = "curated";

/**
 * The same name normalization used by the imported-monster census. Punctuation
 * remains significant: `horse, war` and `horse` are different reviewed rows.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeImportedMonsterName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Canonical source spelling used by N6's source-aware keys. The shared source
 * vocabulary returns lower-case ids; the evidence deliberately displays CS/WR
 * in upper case, so only those supported census ids are promoted here.
 * Unknown sources pass through in their normalized shared form and therefore
 * cannot accidentally match one of the reviewed rows.
 *
 * @param {unknown} source
 * @returns {string}
 */
export function importedMonsterSourceKey(source) {
  const key = sourceKey(source);
  if (!key) return "";
  if (/^cs[1-6]$/.test(key) || key === "wr") return key.toUpperCase();
  return key;
}

/**
 * Stable N6 identity: `<SRC>:<normalizedName>`.
 *
 * @param {unknown} source book/source spelling
 * @param {unknown} name monster display name
 * @returns {string} empty when either half is unusable
 */
export function importedMonsterArtKey(source, name) {
  const src = importedMonsterSourceKey(source);
  const monster = normalizeImportedMonsterName(name);
  return src && monster ? `${src}:${monster}` : "";
}

/**
 * N6's 16 reviewed rows. `book` is the imported monster's source identity;
 * `source` is the authorizing installed art package. Paths are relative to
 * Foundry's Data root and are never copied into this module.
 */
const ROWS = [
  {
    book: "CS2", name: "Horse, War", source: "pf2e-tokens-monster-core",
    token: "modules/pf2e-tokens-monster-core/assets/tokens/horse-war.webp",
    portrait: "modules/pf2e-tokens-monster-core/assets/portraits/horse-war.webp",
  },
  {
    book: "CS3", name: "Sea Serpent", source: "pf2e-tokens-monster-core",
    token: "modules/pf2e-tokens-monster-core/assets/tokens/sea-serpent.webp",
    portrait: "modules/pf2e-tokens-monster-core/assets/portraits/sea-serpent.webp",
  },
  {
    book: "CS3", name: "Werebear", source: "dnd-monster-manual",
    token: "modules/dnd-monster-manual/assets/tokens/werebear.webp",
    portrait: "modules/dnd-monster-manual/assets/portraits/werebear.webp",
  },
  {
    book: "CS4", name: "Anaconda, Giant", source: "pf2e-tokens-monster-core",
    token: "modules/pf2e-tokens-monster-core/assets/tokens/snake-giant-anaconda.webp",
    portrait: "modules/pf2e-tokens-monster-core/assets/portraits/snake-giant-anaconda.webp",
  },
  {
    book: "CS4", name: "Ant, Giant", source: "pf2e-tokens-monster-core",
    token: "modules/pf2e-tokens-monster-core/assets/tokens/ant-giant.webp",
    portrait: "modules/pf2e-tokens-monster-core/assets/portraits/ant-giant.webp",
  },
  {
    book: "CS4", name: "Basilisk Hatchling", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/basilisk-hatchling.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/basilisk-hatchling.webp",
  },
  {
    book: "WR", name: "Camel", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/camel.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/camel.webp",
  },
  {
    book: "WR", name: "Elephant", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/elephant.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/elephant.webp",
  },
  {
    book: "WR", name: "Griffon", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/griffon.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/griffon.webp",
  },
  {
    book: "WR", name: "Hippogriff", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/hippogriff.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/hippogriff.webp",
  },
  {
    book: "WR", name: "Horse", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/horse.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/horse.webp",
  },
  {
    book: "WR", name: "Horse, War", source: "pf2e-tokens-monster-core",
    token: "modules/pf2e-tokens-monster-core/assets/tokens/horse-war.webp",
    portrait: "modules/pf2e-tokens-monster-core/assets/portraits/horse-war.webp",
  },
  {
    book: "WR", name: "Moose", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/moose.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/moose.webp",
  },
  {
    book: "WR", name: "Pegasus", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/pegasus.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/pegasus.webp",
  },
  {
    book: "WR", name: "Pony", source: "dnd5e-fa",
    token: "systems/dnd5e/tokens/beast/Pony.webp",
    portrait: "systems/dnd5e/tokens/beast/Pony.webp",
  },
  {
    book: "WR", name: "Worg", source: "shadowdark-community-tokens",
    token: "modules/shadowdark-community-tokens/artwork/tokens/worg.webp",
    portrait: "modules/shadowdark-community-tokens/artwork/portraits/worg.webp",
  },
];

/** Detached, frozen rows with the derived key exposed for audits and callers. */
export const IMPORTED_MONSTER_ART_ROWS = Object.freeze(ROWS.map((row) => Object.freeze({
  ...row,
  key: importedMonsterArtKey(row.book, row.name),
  display: row.name,
})));

/** Key → reviewed row, with keys derived from each row's book + display name. */
export const IMPORTED_MONSTER_ART = Object.freeze(
  Object.fromEntries(IMPORTED_MONSTER_ART_ROWS.map((row) => [row.key, row])),
);

// Descriptive aliases keep the map discoverable to callers without creating a
// second mutable data set.
export const CURATED_IMPORTED_MONSTER_ART = IMPORTED_MONSTER_ART;
export const IMPORTED_MONSTER_ART_MAP = IMPORTED_MONSTER_ART;

/**
 * Exact source-aware lookup. No fuzzy, alias, substring, or bare-name fallback
 * is permitted on this path.
 *
 * @param {unknown} source imported book/source
 * @param {unknown} name monster display name
 * @param {object} [map] key → row map, injectable for pure tests
 * @returns {object|null}
 */
export function curatedImportedMonsterArtFor(source, name, map = IMPORTED_MONSTER_ART) {
  const key = importedMonsterArtKey(source, name);
  return key ? (map?.[key] ?? null) : null;
}

const clone = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const basename = (path) => String(path ?? "").split("/").pop() ?? "";

/**
 * Construct the existing manager pick shape from an exact validated candidate.
 * A candidate normally comes from TokenArtCatalog.buildLibrary(); the fallback
 * token object is intentionally flat and is used only by pure callers that
 * have already validated the two paths themselves. A missing candidate never
 * falls back to the static row: paths must be validated before they become a
 * persisted pick.
 */
export function curatedMonsterPick(_row, candidate) {
  // A nullish candidate is the adapter's explicit "the installed file is
  // unavailable" result. Do not fall back to the static row in that case;
  // doing so would turn a stale path into a broken pick instead of leaving
  // Browse visible.
  if (candidate == null) return null;
  const selected = candidate;
  const token = String(selected?.token ?? "").trim();
  const portrait = String(selected?.portrait ?? "").trim();
  const source = String(selected?.source ?? "").trim();
  if (!source || !token || !portrait) return null;
  const rawTokenObj = clone(selected?.tokenObj);
  if (rawTokenObj !== undefined && (rawTokenObj === null || typeof rawTokenObj !== "object" || Array.isArray(rawTokenObj))) return null;
  const tokenObj = rawTokenObj ?? { texture: { src: token } };
  if (tokenObj.texture !== undefined
    && (tokenObj.texture === null || typeof tokenObj.texture !== "object" || Array.isArray(tokenObj.texture))) return null;
  if (tokenObj.texture?.src && tokenObj.texture.src !== token) return null;
  tokenObj.texture ??= { src: token };
  tokenObj.texture.src = token;
  const file = String(selected?.file ?? "").trim() || basename(token);
  return {
    source,
    file,
    token,
    portrait,
    tokenObj,
    origin: CURATED_IMPORTED_MONSTER_ART_ORIGIN,
  };
}

/**
 * Purely plan the state transition that bulk curation makes to Token Art
 * Manager's existing `picks`/`managedPaths` machinery.
 *
 * `records` are managed imported NPC records ({id, name, source}). `candidates`
 * is an exact-key resolver result: a Map/object of key → {token, portrait,
 * tokenObj, file, source}, or a function returning that value/null. Passing
 * null for a reviewed row means its installed file/portrait was unavailable;
 * the row is reported as unmatched and an old curated pick is removed. A
 * non-curated existing pick is always preserved. A GM source override is also
 * treated as authoritative and prevents a later curation run from re-adding a
 * module pick after the GM deliberately chose another option.
 *
 * @param {Array<{id:string,name:string,source?:string|null}>} records
 * @param {object} [options]
 * @returns {{picks:object, managedPaths:string[], applied:Array, preserved:Array,
 *   unmatched:Array, removed:Array, changed:boolean}}
 */
export function planCuratedImportedMonsterArt(records, {
  picks = {},
  overrides = {},
  managedPaths = [],
  candidates = {},
  map = IMPORTED_MONSTER_ART,
} = {}) {
  const nextPicks = { ...(picks ?? {}) };
  const nextPaths = [...new Set((Array.isArray(managedPaths) ? managedPaths : [])
    .filter((path) => typeof path === "string" && path.trim())
    .map((path) => path.trim()))];
  const applied = [];
  const preserved = [];
  const unmatched = [];
  const removed = [];
  let changed = false;

  const getCandidate = (key, row, record) => {
    if (typeof candidates === "function") return candidates(row, record, key) ?? null;
    if (candidates instanceof Map) return candidates.get(key) ?? null;
    return candidates?.[key] ?? null;
  };

  for (const record of records ?? []) {
    const id = String(record?.id ?? "").trim();
    const name = String(record?.name ?? "").trim();
    const key = importedMonsterArtKey(record?.source, name);
    if (!id || !key) {
      unmatched.push({ id, name, key, reason: "unusable-source-or-name" });
      continue;
    }

    const row = map?.[key];
    const existing = nextPicks[id];
    const isCurated = existing?.origin === CURATED_IMPORTED_MONSTER_ART_ORIGIN;

    // An explicit source choice is a later GM decision. Drop only our prior
    // curated pick so resolve() can see the GM override again; hand picks stay.
    if (Object.prototype.hasOwnProperty.call(overrides ?? {}, id)) {
      if (isCurated) {
        delete nextPicks[id];
        removed.push({ id, name, key, reason: "gm-override" });
        changed = true;
      }
      preserved.push({ id, name, key, reason: "gm-override" });
      continue;
    }

    // No reviewed row: do not synthesize anything. This is the Browse lane for
    // N6's explicit unmatched set (and for any future census additions).
    if (!row) {
      preserved.push({ id, name, key, reason: "unmatched" });
      unmatched.push({ id, name, key, reason: "unmatched" });
      continue;
    }

    // A Browser pick has no origin marker, so it remains authoritative. This
    // also preserves legacy picks created before F4 added the marker.
    if (existing && !isCurated) {
      preserved.push({ id, name, key, reason: "gm-pick" });
      continue;
    }

    const candidate = getCandidate(key, row, record);
    const pick = curatedMonsterPick(row, candidate);
    if (!pick) {
      if (isCurated) {
        delete nextPicks[id];
        removed.push({ id, name, key, reason: "path-unavailable" });
        changed = true;
      }
      unmatched.push({ id, name, key, reason: "path-unavailable" });
      continue;
    }

    if (!sameValue(existing, pick)) {
      nextPicks[id] = pick;
      changed = true;
      applied.push({ id, name, key, source: pick.source, token: pick.token, portrait: pick.portrait });
    } else {
      preserved.push({ id, name, key, reason: "already-curated" });
    }

    for (const path of [pick.token, pick.portrait]) {
      if (!nextPaths.includes(path)) {
        nextPaths.push(path);
        changed = true;
      }
    }
  }

  return { picks: nextPicks, managedPaths: nextPaths, applied, preserved, unmatched, removed, changed };
}
