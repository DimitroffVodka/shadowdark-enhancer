/**
 * Shadowdark Enhancer — per-unlock table SHAPES.
 *
 * A small, precise structure descriptor for each unlockable table, so the paste
 * parser reconstructs it DETERMINISTICALLY instead of guessing the column count
 * and boundaries. This is the "smaller + more detailed" successor to the old
 * sealed AES blobs (sealed-content.mjs, retired) and to formula-only structure
 * seeds: each entry ships the exact column recipe — NO book text, only structure.
 *
 * Shape kinds:
 *   { kind:"compound", split:"prayer", cols, size, labels }
 *     — WR god prayer generators (roll each column, combine). Detail 1 ends in a
 *       clause separator (, ; :), Detail 3 ends in "!", Detail 2 is the middle.
 *       buildTableData cartesian-expands it into a flat visible table.
 *   { kind:"lookup", cols, size, labels }
 *     — one roll → one row read across `cols` columns, cells joined by " | "
 *       (e.g. Carousing Outcome d14 Outcome|Benefit).
 *
 * Names are matched suffix-tolerantly (a "Source - Name" / "…: Name" import
 * prefix still resolves), the same convention as table-structure-seeds.
 */
const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

const PRAYER = (size = 6) => ({
  kind: "compound", split: "prayer", cols: 3, size,
  labels: ["Detail 1", "Detail 2", "Detail 3"],
});

export const TABLE_SHAPES = {
  // WR god prayer generators (Western Reaches pp.191-205) — 3d6 compounds.
  "Madeera the Covenant Prayers": PRAYER(6),
  "Saint Terragnis Prayers": PRAYER(6),
  "Gede Prayers": PRAYER(6),
  "Ord Prayers": PRAYER(6),
  "Memnon Prayers": PRAYER(6),
  "Shune the Vile Prayers": PRAYER(6),
  "Ramlaat Prayers": PRAYER(6),
  "The Lost Prayers": PRAYER(6),
  // Core Rulebook carousing lookups (book pp.92-93).
  "Carousing Outcome": { kind: "lookup", cols: 2, size: 14, labels: ["Outcome", "Benefit"] },
  "Carousing Event": { kind: "lookup", cols: 3, size: 7, labels: ["Cost", "Event", "Bonus"] },
};

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
