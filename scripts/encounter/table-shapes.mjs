/**
 * Shadowdark Enhancer — content registry + per-unlock table SHAPES.
 *
 * A small, precise structure descriptor for each unlockable table, so the paste
 * parser reconstructs it DETERMINISTICALLY instead of guessing the column count
 * and boundaries. This is the "smaller + more detailed" successor to the old
 * sealed AES blobs (sealed-content.mjs, retired) and to formula-only structure
 * seeds: each entry ships the exact column recipe — NO book text, only structure.
 *
 * DISPATCH MODEL (PDF-import review §05/§09 rec #2). Known content is keyed by a
 * persistent `contentId` (`{srcSlug}/{nameSlug}`) — stable across display-name
 * corrections, page shifts between printings, and same-name recurrences across
 * sources. `resolveShape({ contentId, name })` dispatches by EXACT contentId
 * first (collision-free), and only falls back to the suffix-tolerant name match
 * for freeform pastes that carry no seed id. New generators (rec #3) are added
 * to `CONTENT` by contentId, so a generically-named column ("Type", "Secret",
 * "Wealth") never has to rely on the fragile exact-name path.
 *
 * Shape kinds:
 *   { kind:"compound", split:"prayer", cols, size, labels }
 *     — WR god prayer generators (roll each column, combine). Detail 1 ends in a
 *       clause separator (, ; :), Detail 3 ends in "!", Detail 2 is the middle.
 *       buildTableData cartesian-expands it into a flat visible table.
 *   { kind:"lookup", cols, size, labels }
 *     — one roll → one row read across `cols` columns, cells joined by " | "
 *       (e.g. Carousing Outcome d14 Outcome|Benefit).
 */
const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Slugify a name/source into a contentId component. */
const _slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Compose a persistent contentId from a source key and a display name. */
export const makeContentId = (src, name) => `${_slug(src) || "misc"}/${_slug(name)}`;

const PRAYER = (size = 6) => ({
  kind: "compound", split: "prayer", cols: 3, size,
  labels: ["Detail 1", "Detail 2", "Detail 3"],
});

const GRID3 = (size, labels) => ({ kind: "compound", split: "grid", cols: 3, size, labels });

// ── Content registry — keyed by persistent contentId ─────────────────────────
// Each entry: { src, names:[displayName…], shape }. `names[0]` is the canonical
// display name; extra names are aliases the same content is known by. Adding a
// shaped generator here is all that rec #3 needs — TABLE_SHAPES, shapeForName,
// resolveShape, and contentIdForName all derive from this one table.
const _entry = (src, name, shape, aliases = []) =>
  [makeContentId(src, name), { src, names: [name, ...aliases], shape }];

export const CONTENT = Object.fromEntries([
  // WR god prayer generators (Western Reaches pp.191-205) — 3d6 compounds.
  _entry("WR", "Madeera the Covenant Prayers", PRAYER(6)),
  _entry("WR", "Saint Terragnis Prayers", PRAYER(6)),
  _entry("WR", "Gede Prayers", PRAYER(6)),
  _entry("WR", "Ord Prayers", PRAYER(6)),
  _entry("WR", "Memnon Prayers", PRAYER(6)),
  _entry("WR", "Shune the Vile Prayers", PRAYER(6)),
  _entry("WR", "Ramlaat Prayers", PRAYER(6)),
  _entry("WR", "The Lost Prayers", PRAYER(6)),
  // Core Rulebook carousing lookups (book pp.92-93).
  // Both wrap heavily with the die/cost vertically centered — the lookup parser
  // groups wrapped lines to their nearest row anchor. Event has no die column
  // (keyed by Cost), so dieIndexed:false.
  _entry("CORE", "Carousing Outcome",
    { kind: "lookup", cols: 2, size: 14, labels: ["Outcome", "Benefit"], col2Starts: "Gain" }),
  // Cost/Event/Bonus, no die. rowStart/colLast let the RAW (un-delimited,
  // wrapped) copy parse: Cost = leading "N gp", Bonus = trailing "+N", Event =
  // the wrapped middle. A manual "|" still wins when present.
  _entry("CORE", "Carousing Event",
    { kind: "lookup", cols: 3, size: 7, labels: ["Cost", "Event", "Bonus"], dieIndexed: false,
      rowStart: "[\\d,]+\\s*gp", colLast: "\\+\\d+" }),
  // Core Rulebook mix-and-match generators (roll each column, combine) — grid
  // splits deterministically to `cols` columns; cartesian-expanded at commit.
  // `reflow` splits a REFLOWED (single-spaced, PDF-copy) paste the aligned
  // header parser can't read: Trap → Trigger at the next Capitalized word,
  // Trigger → Damage at the first dice expression (1d6/2d8/3d10). One spec per
  // boundary (cols-1). A manual "|" still wins (parseGenerators handles it).
  _entry("CORE", "Traps",
    { kind: "compound", split: "grid", cols: 3, size: 12, labels: ["Trap", "Trigger", "Damage or Effect"],
      reflow: ["cap", "dice"] }),
  _entry("CORE", "Hazards",
    { kind: "compound", split: "grid", cols: 3, size: 12, labels: ["Movement", "Damage", "Weaken"] }),
  _entry("CORE", "Boons: Secrets",
    { kind: "compound", split: "grid", cols: 2, size: 12, labels: ["Detail 1", "Detail 2"] }),
  // Core Rulebook d20 × 3-column name/idea generators (roll each column,
  // combine). Cartesian = 20^3 = 8,000 rows exceeds the expansion cap (2,000),
  // so these stay roll-each-column compounds rather than an 8k-row table.
  _entry("CORE", "Tavern Generator", GRID3(20, ["Name 1", "Name 2", "Known For"])),
  _entry("CORE", "Shop Generator", GRID3(20, ["Name 1", "Name 2", "Known For"])),
  _entry("CORE", "Party Name", GRID3(20, ["Name 1", "Name 2", "Known For"])),
  _entry("CORE", "Adventure Generator", GRID3(20, ["Detail 1", "Detail 2", "Detail 3"])),
  _entry("CORE", "Adventuring Site Name", GRID3(20, ["Name 1", "Name 2", "Name 3"])),
  _entry("CORE", "Magic Item Idea Generator", GRID3(20, ["Name 1", "Name 2", "Name 3"])),
  _entry("CORE", "NPC Qualities", GRID3(20, ["Appearance", "Does", "Secret"])),
]);

// Legacy display-name → shape map, derived from CONTENT. Kept exported for the
// freeform (no contentId) path, node tests, and any external reference. Every
// alias of a shaped entry resolves to the same shape.
export const TABLE_SHAPES = Object.fromEntries(
  Object.values(CONTENT).flatMap((e) => (e.shape ? e.names.map((n) => [n, e.shape]) : [])),
);

// Reverse index: normalized display name → contentId, for stamping manage-tree
// entries and any name→id lookup.
const _NAME_TO_ID = new Map();
for (const [id, e] of Object.entries(CONTENT)) {
  for (const n of e.names) _NAME_TO_ID.set(_norm(n), id);
}

/** Resolve a table name (suffix-tolerant) to its shape descriptor, or null. */
export function shapeForName(name) {
  if (!name) return null;
  if (TABLE_SHAPES[name]) return TABLE_SHAPES[name];
  const n = _norm(name);
  for (const [k, v] of Object.entries(TABLE_SHAPES)) {
    const kn = _norm(k);
    if (kn === n || n.endsWith(`- ${kn}`) || n.endsWith(`: ${kn}`)) return v;
  }
  return null;
}

/**
 * Resolve the known contentId for a display name (suffix-tolerant), or null.
 * Used to stamp manage-tree entries so dispatch can key on a stable id.
 */
export function contentIdForName(name) {
  if (!name) return null;
  const n = _norm(name);
  if (_NAME_TO_ID.has(n)) return _NAME_TO_ID.get(n);
  for (const [kn, id] of _NAME_TO_ID) {
    if (n.endsWith(`- ${kn}`) || n.endsWith(`: ${kn}`)) return id;
  }
  return null;
}

/**
 * Primary dispatch: resolve an entry to its shape descriptor. A persistent
 * `contentId` wins by EXACT lookup (no name-collision risk); otherwise fall
 * back to the suffix-tolerant name match for freeform pastes with no seed id.
 * @param {{contentId?:string, name?:string}} entry
 */
export function resolveShape({ contentId, name } = {}) {
  if (contentId && CONTENT[contentId]?.shape) return CONTENT[contentId].shape;
  return shapeForName(name);
}
