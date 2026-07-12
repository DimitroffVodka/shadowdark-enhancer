/**
 * Shadowdark Enhancer — Roll-table folder taxonomy (pure, node-testable).
 *
 * Single source of truth for WHERE an imported table files inside the
 * sde-tables pack. The folder tree mirrors the Manage strip's tree exactly
 * (user req 2026-07-11), category-first:
 *
 *   Character Content → Ancestries → Names / Trinkets
 *                     → Backgrounds · Class Talents · Patrons & Deities
 *   Gameplay          → Core Rulebook → Carousing / Traps & Hazards / Boons
 *                     → <source>       (CS/WR gameplay-chapter tables)
 *   Roll Tables       → Core Rulebook → <group header>
 *                     → <source>       (everything else)
 *   <custom label>    →                (GM typed a Custom… folder name)
 *
 * GAMEPLAY_TABLES / PATRON_TABLES routing sets live here (moved from
 * manage-tree.mjs, which now imports them) so the Manage tree and the pack
 * folders can never drift apart.
 */
import { CUSTOM_ID } from "./table-categories.mjs";
import { CORE_TABLE_GROUPS } from "./core-table-groups.mjs";

const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Manifest table names that are GAMEPLAY mechanics (books' Gameplay chapters). */
export const GAMEPLAY_TABLES = new Set([
  "Core PDF p97: Carousing Outcome",
  "Core PDF p118: Traps",
  "Core PDF p284: Boons: Oaths",
  "Diabolical Mishap 1-3",
  "Diabolical Mishap 4-5",
  "Cursed Scroll 2 p26: Enduring Wounds",
  "Carousing Outcome",
  "Carousing Event",
  "Carousing Outcome - Benefit",
  "Carousing Outcome - Mishap",
  "Carousing Mishap",
  "Carousing Benefit",
].map(_norm));

/** Manifest table names that belong under Character Content → Patrons & Deities:
 *  the 8 god prayer generators (3d6 compounds) + the 17 patron boon tables.
 *  Six patrons (Almazzat, Kytheros, Mugdulblub, Shune the Vile, The Willowman,
 *  Titania) already ship as SYSTEM tables ("Patron Boons: X" in
 *  shadowdark.rollable-tables) — those keep the system name so the census
 *  resolves them present without a re-import (user req 2026-07-11). Kept in
 *  sync with the WR Gods & Patrons block in char-content-manifest.mjs. */
export const PATRON_TABLES = new Set([
  // Gods — prayer generators
  "Madeera the Covenant Prayers", "Saint Terragnis Prayers", "Gede Prayers",
  "Ord Prayers", "Memnon Prayers", "Shune the Vile Prayers",
  "Ramlaat Prayers", "The Lost Prayers",
  // Patrons — WR boon tables (WR-revised, no system copy)
  "Freya Boons", "Krraktanamak Boons", "Loki Boons",
  "Molek Boons", "Oatali Boons", "Obe-Ixx Boons",
  "Odin Boons", "Oros Boons", "Rathgamnon Boons", "Saint Ydris Boons",
  "Yag-Kesh Boons",
  // Patrons already in the SYSTEM pack — linked, never duplicated
  "Patron Boons: Almazzat", "Patron Boons: Kytheros", "Patron Boons: Mugdulblub",
  "Patron Boons: Shune the Vile", "Patron Boons: The Willowman", "Patron Boons: Titania",
].map(_norm));

// name (normalized) → { section, header } for every core-group member table.
const _coreByName = new Map();
for (const g of CORE_TABLE_GROUPS) {
  for (const t of g.tables) _coreByName.set(_norm(t.name), { section: g.section, header: g.header });
}

/** Match a table name against the core groups, tolerating the "Source - Name"
 *  and "Core PDF pN: Name" import-prefix conventions. */
function coreGroupFor(name) {
  const n = _norm(name);
  if (_coreByName.has(n)) return _coreByName.get(n);
  for (const [key, val] of _coreByName) {
    if (n.endsWith(`- ${key}`) || n.endsWith(`: ${key}`)) return val;
  }
  return null;
}

/** Suffix-tolerant set membership (same conventions as coreGroupFor). */
function _inSet(set, name) {
  const n = _norm(name);
  if (set.has(n)) return true;
  for (const key of set) if (n.endsWith(`- ${key}`) || n.endsWith(`: ${key}`)) return true;
  return false;
}

/** Normalize a free-text source label for use as a folder segment. */
function sourceSegment(source) {
  const s = String(source ?? "").trim();
  return s || "Custom";
}

/**
 * Resolve a ParsedTable to its folder path (array of segment names, outermost
 * first) inside the sde-tables pack. Mirrors the Manage tree; see module doc.
 * @param {object} pt  ParsedTable-ish: { name, category, customLabel, source, folderPath }
 * @returns {string[]}
 */
export function resolveTableFolderPath(pt) {
  const name = pt?.name ?? "";
  const src = sourceSegment(pt?.source);

  // 1. GM typed a Custom… folder — explicit intent wins outright.
  if (pt?.category === CUSTOM_ID && String(pt?.customLabel ?? "").trim()) {
    return [String(pt.customLabel).trim()];
  }
  // 2. Known Core Rulebook table → its Manage-tree group.
  const g = coreGroupFor(name);
  if (g) return [g.section === "gameplay" ? "Gameplay" : "Roll Tables", "Core Rulebook", g.header];
  // 3. Gods & patrons.
  if (_inSet(PATRON_TABLES, name)) return ["Character Content", "Patrons & Deities"];
  // 4. Character-content categories.
  const charPath = ({
    "character-names": ["Character Content", "Ancestries", "Names"],
    "trinkets": ["Character Content", "Ancestries", "Trinkets"],
    "background": ["Character Content", "Backgrounds"],
    "talents": ["Character Content", "Class Talents"],
  })[pt?.category];
  if (charPath) return charPath;
  // 5. Gameplay-chapter mechanics.
  if (_inSet(GAMEPLAY_TABLES, name) || ["carousing", "traps", "hazards"].includes(pt?.category)) {
    return ["Gameplay", src];
  }
  // 6. Legacy manifest seeds carried an explicit folderPath — honor it.
  if (Array.isArray(pt?.folderPath) && pt.folderPath.filter(Boolean).length) {
    return pt.folderPath.filter(Boolean).map(String);
  }
  // 7. Everything else → Roll Tables by source.
  return ["Roll Tables", src];
}
